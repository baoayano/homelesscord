(() => {
  const NativeSocket = window.WebSocket;
  const NativeConnection = window.RTCPeerConnection;
  if (!NativeSocket || !NativeConnection) return;
  const sockets = new Map();
  const shared = new Set();
  const relayed = new WeakMap();
  const pathOf = (url) => {
    try {
      const parsed = new URL(String(url), location.href);
      return parsed.searchParams.has("encoding") ? null : parsed.pathname;
    } catch {
      return null;
    }
  };
  const open = (socket) => socket.readyState <= NativeSocket.OPEN;
  window.WebSocket = new Proxy(NativeSocket, {
    construct(target, args) {
      const socket = new target(...args);
      const path = pathOf(args[0]);
      if (path === null) return socket;
      const federated = path.startsWith("/federated-voice");
      if (federated) sockets.set(socket, null);
      socket.addEventListener("message", (event) => {
        if (typeof event.data !== "string" || !event.data.includes("meowcord_")) return;
        try {
          const message = JSON.parse(event.data);
          if (federated && message.op === 2 && message.d?.meowcord_relay) sockets.set(socket, message.d.meowcord_relay);
          if (message.op === 4 && message.d?.meowcord_shared_call === true) shared.add(socket);
        } catch {}
      });
      socket.addEventListener("close", () => {
        sockets.delete(socket);
        shared.delete(socket);
      });
      return socket;
    },
  });
  window.FosscordFederatedVoice = {
    sharedCall: () => [...sockets.keys(), ...shared].some(open),
  };
  const relayFor = () => {
    const live = [...sockets].filter(([socket]) => open(socket));
    if (!live.length) return null;
    const credentials = live.map(([, value]) => value).filter(Boolean).at(-1);
    return {
      iceServers: credentials
        ? [{ urls: credentials.urls, username: credentials.username, credential: credentials.credential }]
        : [],
      iceTransportPolicy: "relay",
    };
  };
  window.RTCPeerConnection = new Proxy(NativeConnection, {
    construct(target, [config, ...rest]) {
      const relay = relayFor();
      const connection = new target(relay ? { ...(config ?? {}), ...relay } : config, ...rest);
      if (relay) relayed.set(connection, relay);
      return connection;
    },
  });
  const setConfiguration = NativeConnection.prototype.setConfiguration;
  NativeConnection.prototype.setConfiguration = function (config) {
    const relay = relayed.get(this);
    return setConfiguration.call(this, relay ? { ...(config ?? {}), ...relay } : config);
  };
})();
