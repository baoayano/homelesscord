package main

import (
	"fmt"
	"net"
	"strconv"
	"testing"
	"time"

	"github.com/pion/logging"
	"github.com/pion/turn/v4"
)

func TestParseTurnUsername(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	credential, err := parseTurnUsername("1800000600:203.0.113.10:abc", now)
	if err != nil {
		t.Fatal(err)
	}
	if !credential.peer.Equal(net.ParseIP("203.0.113.10")) {
		t.Fatalf("peer is %s", credential.peer)
	}
	for _, username := range []string{"1799999999:203.0.113.10:abc", "1800000600:abc", "soon:203.0.113.10:abc", "1800000600:2001:db8::1:abc", "1800000600:example.com:abc"} {
		if _, err := parseTurnUsername(username, now); err == nil {
			t.Fatalf("accepted %q", username)
		}
	}
}

func TestTurnGuardBindsTheClientToItsPeer(t *testing.T) {
	guard := newTurnGuard("secret")
	client := &net.UDPAddr{IP: net.ParseIP("198.51.100.7"), Port: 40000}
	username := fmt.Sprintf("%d:203.0.113.10:abc", time.Now().Add(time.Hour).Unix())
	key, ok := guard.authenticate(username, "meowcord", client)
	if !ok || string(key) != string(turn.GenerateAuthKey(username, "meowcord", turnPassword("secret", username))) {
		t.Fatal("a valid username was refused")
	}
	if !guard.permit(client, net.ParseIP("203.0.113.10")) {
		t.Fatal("the named peer was refused")
	}
	if guard.permit(client, net.ParseIP("127.0.0.1")) {
		t.Fatal("another peer was allowed")
	}
	if guard.permit(&net.UDPAddr{IP: net.ParseIP("198.51.100.8"), Port: 40000}, net.ParseIP("203.0.113.10")) {
		t.Fatal("a client that never authenticated was allowed")
	}
	guard.forget(client)
	if guard.permit(client, net.ParseIP("203.0.113.10")) {
		t.Fatal("a forgotten client was allowed")
	}
}

func freeUDPPort(t *testing.T) int {
	conn, err := net.ListenPacket("udp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	return conn.LocalAddr().(*net.UDPAddr).Port
}

func TestTurnRelaysOnlyToThePeerInTheCredential(t *testing.T) {
	port := freeUDPPort(t)
	relayPort := freeUDPPort(t)
	if relayPort > 65000 {
		relayPort = 40000
	}
	cfg := turnConfig{port: port, listenIP: "127.0.0.1", publicIP: "127.0.0.1", relayMin: relayPort, relayMax: relayPort + 20, realm: "meowcord", secret: "secret"}
	server, err := startTurn(cfg, logging.NewDefaultLoggerFactory())
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()

	peer, err := net.ListenPacket("udp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer peer.Close()

	allocate := func(peerIP string) (net.PacketConn, func()) {
		username := fmt.Sprintf("%d:%s:probe", time.Now().Add(time.Minute).Unix(), peerIP)
		conn, err := net.ListenPacket("udp4", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		client, err := turn.NewClient(&turn.ClientConfig{
			STUNServerAddr: net.JoinHostPort("127.0.0.1", strconv.Itoa(port)),
			TURNServerAddr: net.JoinHostPort("127.0.0.1", strconv.Itoa(port)),
			Conn:           conn,
			Username:       username,
			Password:       turnPassword("secret", username),
			Realm:          "meowcord",
		})
		if err != nil {
			t.Fatal(err)
		}
		if err := client.Listen(); err != nil {
			t.Fatal(err)
		}
		relayed, err := client.Allocate()
		if err != nil {
			t.Fatal(err)
		}
		return relayed, func() {
			relayed.Close()
			client.Close()
			conn.Close()
		}
	}

	relayed, release := allocate("127.0.0.1")
	if got := relayed.LocalAddr().(*net.UDPAddr).Port; got < relayPort || got > relayPort+20 {
		t.Fatalf("relay port %d is outside %d-%d", got, relayPort, relayPort+20)
	}
	if _, err := relayed.WriteTo([]byte("ping"), peer.LocalAddr()); err != nil {
		t.Fatal(err)
	}
	buffer := make([]byte, 64)
	peer.SetReadDeadline(time.Now().Add(5 * time.Second))
	n, from, err := peer.ReadFrom(buffer)
	if err != nil {
		t.Fatal(err)
	}
	if string(buffer[:n]) != "ping" || from.(*net.UDPAddr).Port != relayed.LocalAddr().(*net.UDPAddr).Port {
		t.Fatalf("peer got %q from %s", buffer[:n], from)
	}
	if _, err := peer.WriteTo([]byte("pong"), from); err != nil {
		t.Fatal(err)
	}
	relayed.SetReadDeadline(time.Now().Add(5 * time.Second))
	n, _, err = relayed.ReadFrom(buffer)
	if err != nil || string(buffer[:n]) != "pong" {
		t.Fatalf("relay read %q, %v", buffer[:n], err)
	}
	release()

	other, releaseOther := allocate("203.0.113.10")
	defer releaseOther()
	if _, err := other.WriteTo([]byte("ping"), peer.LocalAddr()); err == nil {
		peer.SetReadDeadline(time.Now().Add(time.Second))
		if n, _, err := peer.ReadFrom(buffer); err == nil {
			t.Fatalf("a relay for another peer reached this one: %q", buffer[:n])
		}
	}
}

func TestTurnConfigFromEnv(t *testing.T) {
	t.Setenv("TURN_SECRET", "")
	if _, enabled, err := turnConfigFromEnv("127.0.0.1"); err != nil || enabled {
		t.Fatalf("TURN without a secret: enabled %v, %v", enabled, err)
	}
	t.Setenv("TURN_SECRET", "secret")
	t.Setenv("TURN_PORT", "0")
	if _, enabled, _ := turnConfigFromEnv("127.0.0.1"); enabled {
		t.Fatal("TURN_PORT=0 left TURN on")
	}
	t.Setenv("TURN_PORT", "3479")
	t.Setenv("TURN_RELAY_PORT_MIN", "50010")
	t.Setenv("TURN_RELAY_PORT_MAX", "50000")
	if _, _, err := turnConfigFromEnv("127.0.0.1"); err == nil {
		t.Fatal("an inverted relay range was accepted")
	}
	t.Setenv("TURN_RELAY_PORT_MAX", "50020")
	cfg, enabled, err := turnConfigFromEnv("127.0.0.1")
	if err != nil || !enabled || cfg.port != 3479 || cfg.publicIP != "127.0.0.1" || cfg.relayMin != 50010 || cfg.relayMax != 50020 {
		t.Fatalf("unexpected config %+v, %v, %v", cfg, enabled, err)
	}
}
