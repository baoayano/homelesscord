import { spawn, spawnSync } from "node:child_process";
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { mkdirSync, openSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { signRequest } from "../../src/util/util/federation/Protocol.ts";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");

const args = new Set(process.argv.slice(2));
const root = path.resolve(new URL("../..", import.meta.url).pathname);
const base = Number(process.env.ATTACK_PORT_BASE || 3600);
const registryPort = base;
const T = { port: base + 1, db: process.env.ATTACK_DB || "meowcord_attack_target" };
T.id = `localhost:${T.port}`;
T.origin = `http://localhost:${T.port}`;
T.api = `${T.origin}/api/v9`;
const ROGUE = { port: base + 3 };
ROGUE.id = `localhost:${ROGUE.port}`;
ROGUE.origin = `http://localhost:${ROGUE.port}`;
const UNLISTED = `localhost:${base + 4}`;
const THIRD = "third.example";
const runDir = process.env.ATTACK_DIR || path.join(tmpdir(), "meowcord-federation-attack-probe");
const LIMITS = { guildsPerInstance: 4, newObjectsPerRequest: 200, objectsPerInstance: 5000, shadowsPerInstance: 1000, inboxEventsPerInstance: 100000 };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let passed = 0;
const failures = [];
const check = (name, ok, detail = "") => {
    if (ok) passed++;
    else failures.push(name);
    console.log(`${ok ? "pass" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`);
    return ok;
};

const pg = ["--host=localhost", "--port=5432", `--username=${process.env.USER}`];
const psql = (sql, db = T.db) => {
    const result = spawnSync("psql", [...pg, db, "-Atc", sql], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(`psql: ${result.stderr}`);
    return result.stdout.trim();
};
const count = (sql) => Number(psql(sql) || 0);
const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;

const tc = (id) => `@${id}@${T.id}`;
const rc = (n) => `@${1300000000000000000n + BigInt(n)}@${ROGUE.id}`;
const localOf = (canonical) => psql(`SELECT local_id FROM federated_objects WHERE canonical = ${quote(canonical)}`);

const rogueKey = generateKeyPairSync("ed25519");
const unlistedKey = generateKeyPairSync("ed25519");
const registryKey = generateKeyPairSync("ed25519");
const rawKey = (key) => key.publicKey.export({ format: "jwk" }).x;

const rogueSeen = [];
let voiceReplyIp = "10.0.0.5";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

let registryFetches = 0;
const registry = createServer((req, res) => {
    if (req.url === "/v1/registry") registryFetches++;
    if (req.url !== "/v1/registry") {
        res.writeHead(202, { "content-type": "application/json" });
        return res.end('{"status":"pending"}');
    }
    const payload = Buffer.from(
        JSON.stringify({
            version: 1,
            sequence: Date.now(),
            issued_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 86_400_000).toISOString(),
            min_protocol: 1,
            instances: [],
            blocked: { instances: [], guilds: [], users: [] },
            discovery: [],
        }),
    );
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ payload: payload.toString("base64url"), signature: sign(null, payload, registryKey.privateKey).toString("base64url"), key_id: "registry-1" }));
});

const rogue = createServer((req, res) => {
    rogueSeen.push(`${req.method} ${req.url}`);
    const url = new URL(req.url, ROGUE.origin);
    req.resume();
    if (url.pathname === "/.well-known/meowcord") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(
            JSON.stringify({
                protocol: 2,
                software: "meowcord",
                version: "rogue",
                id: ROGUE.id,
                url: ROGUE.origin,
                name: "Rogue",
                description: "",
                icon_url: null,
                public_key: rawKey(rogueKey),
                registration: "open",
                federation: { enabled: true, accepts_unlisted: true },
            }),
        );
    }
    if (url.pathname.endsWith("/page.html")) {
        res.writeHead(200, { "content-type": "text/html" });
        return res.end("<script>alert(document.cookie)</script>");
    }
    if (url.pathname.endsWith("/image.svg")) {
        res.writeHead(200, { "content-type": "image/svg+xml" });
        return res.end('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    }
    if (url.pathname.endsWith("/hop.png")) {
        res.writeHead(302, { location: `${T.api}/users/@me` });
        return res.end();
    }
    if (url.pathname === "/federation/v2/inbox") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end('{"applied":0}');
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end('{"code":"not_found","error":"rogue"}');
});
const rogueVoice = new WebSocket.WebSocketServer({ noServer: true });
rogue.on("upgrade", (req, socket, head) => {
    rogueSeen.push(`UPGRADE ${req.url}`);
    rogueVoice.handleUpgrade(req, socket, head, (ws) => {
        ws.once("message", () => ws.send(JSON.stringify({ op: 2, d: { ssrc: 1, ip: voiceReplyIp, port: 50000, modes: ["aead_aes256_gcm_rtpsize"] } })));
    });
});

const listen = (server, port) => new Promise((resolve, reject) => server.once("error", reject).listen(port, "127.0.0.1", resolve));

let child = null;
async function startTarget() {
    mkdirSync(runDir, { recursive: true, mode: 0o700 });
    const exists = psql(`SELECT 1 FROM pg_database WHERE datname = ${quote(T.db)}`, "postgres");
    if (exists && !args.has("--fresh")) throw new Error(`${T.db} exists, pass --fresh to drop and recreate it`);
    if (exists) spawnSync("dropdb", [...pg, T.db], { stdio: "inherit" });
    spawnSync("createdb", [...pg, T.db], { stdio: "inherit" });
    writeFileSync(
        path.join(runDir, "config.json"),
        JSON.stringify({
            general: { serverName: T.origin },
            api: { endpointPublic: T.api },
            cdn: { endpointPublic: `${T.origin}/`, endpointPrivate: `${T.origin}/` },
            gateway: { endpointPublic: `ws://localhost:${T.port}/` },
            security: { allowPrivateNetworkRequests: true, captcha: { blockAutomatedBrowsers: false } },
            register: { requireCaptcha: false },
            federation: {
                enabled: true,
                announce: false,
                allowUnlistedPeers: true,
                peers: [ROGUE.id],
                registry: { url: `http://localhost:${registryPort}`, publicKey: rawKey(registryKey) },
                limits: LIMITS,
            },
            limits: { rate: { enabled: false, routes: { auth: { register: { count: 100, window: 60 } } } } },
        }),
    );
    const log = openSync(path.join(runDir, "server.log"), "a");
    child = spawn("bun", [path.join(root, "dist/bundle/start.js")], {
        cwd: runDir,
        env: {
            ...process.env,
            DATABASE: `postgres://${process.env.USER}@localhost:5432/${T.db}`,
            CONFIG_PATH: path.join(runDir, "config.json"),
            PORT: String(T.port),
            WRTC_WS_PORT: "",
            NODE_ENV: "development",
            PUBLIC_FETCH_PROXY: "direct",
            PION_SFU_BIN: "",
            TURN_SECRET: randomBytes(24).toString("base64url"),
            TURN_PUBLIC_IP: "127.0.0.1",
            TURN_ALLOW_PRIVATE_PEERS: "",
        },
        stdio: ["ignore", log, log],
    });
    for (let attempt = 0; attempt < 120; attempt++) {
        if (child.exitCode !== null) throw new Error(`the target exited, see ${path.join(runDir, "server.log")}`);
        if (
            registryFetches &&
            (await fetch(`${T.origin}/api/ping`).then(
                (response) => response.ok,
                () => false,
            ))
        )
            return sleep(1000);
        await sleep(1000);
    }
    throw new Error(`the target did not start, see ${path.join(runDir, "server.log")}`);
}

async function stopTarget() {
    if (!child || child.exitCode !== null) return;
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    await Promise.race([exited, sleep(15000)]);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

async function call(method, route, token, body) {
    const response = await fetch(route.startsWith("http") ? route : `${T.api}${route}`, {
        method,
        headers: { ...(body && { "content-type": "application/json" }), ...(token && { authorization: token }) },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let json = text;
    try {
        json = text ? JSON.parse(text) : null;
    } catch {}
    return { status: response.status, body: json, headers: response.headers };
}

async function register(name) {
    const response = await call("POST", "/auth/register", null, {
        email: `${name}-${randomBytes(3).toString("hex")}@attack.test`,
        username: `${name}${randomBytes(2).toString("hex")}`,
        password: randomBytes(12).toString("hex"),
        date_of_birth: "2000-01-01",
        consent: true,
    });
    if (!response.body?.token) throw new Error(`register ${name}: ${response.status} ${JSON.stringify(response.body)}`);
    const me = await call("GET", "/users/@me", response.body.token);
    return { token: response.body.token, id: me.body.id, username: me.body.username };
}

const signedHeaders = (method, route, body, { key = rogueKey.privateKey, sender = ROGUE.id, now, nonce } = {}) =>
    signRequest({ method, path: route, target: T.id, sender, body, privateKey: key, now, nonce });

async function federated(method, route, payload, options = {}) {
    const body = Buffer.from(payload === undefined ? "" : JSON.stringify(payload));
    const headers = options.headers ?? signedHeaders(method, route, body, options);
    const response = await fetch(`${T.origin}${route}`, {
        method,
        headers: { ...headers, ...(payload !== undefined && { "content-type": "application/json" }) },
        body: method === "GET" ? undefined : body,
    });
    const text = await response.text();
    let json = text;
    try {
        json = JSON.parse(text);
    } catch {}
    return { status: response.status, body: json };
}

let eventSeq = 0;
const inbox = (events) => federated("POST", "/federation/v2/inbox", { events: events.map((event) => ({ id: `attack-${Date.now()}-${eventSeq++}`, recipients: [], ...event })) });
const relay = (request) => federated("POST", "/federation/v2/relay", { actor: rogueUser.id, method: "GET", query: {}, profile: { username: "mallory" }, ...request });

const rogueUser = { id: rc(100), username: "mallory", discriminator: "0", global_name: "Mallory", avatar: null };
const rogueGuild = rc(1);
const rogueText = rc(2);
const rogueVoiceChannel = rc(3);
const rogueDm = rc(200);
const rogueGroup = rc(201);

function gateway(account) {
    const ws = new WebSocket(`ws://localhost:${T.port}/?v=9&encoding=json`, { headers: { origin: T.origin } });
    const events = [];
    let heartbeat;
    const ready = new Promise((resolve, reject) => {
        ws.on("message", (raw) => {
            const message = JSON.parse(raw.toString());
            if (message.op === 10) {
                heartbeat = setInterval(() => ws.send(JSON.stringify({ op: 1, d: null })), message.d.heartbeat_interval);
                ws.send(JSON.stringify({ op: 2, d: { token: account.token, capabilities: 0, properties: { os: "Mac OS X", browser: "Chrome", device: "" } } }));
            }
            if (message.op !== 0) return;
            events.push(message);
            if (message.t === "READY") resolve();
        });
        ws.on("error", reject);
        setTimeout(() => reject(new Error("gateway READY timed out")), 20000);
    });
    return {
        ready,
        events,
        close() {
            clearInterval(heartbeat);
            ws.close();
        },
    };
}

function rawRequest(lines, body, waitMs = 3000) {
    return new Promise((resolve) => {
        const socket = connect(T.port, "127.0.0.1");
        let answer = "";
        const done = () => {
            socket.destroy();
            resolve(answer);
        };
        socket.on("data", (chunk) => {
            answer += chunk.toString();
            if (answer.includes("\r\n\r\n")) done();
        });
        socket.on("error", done);
        socket.on("connect", () => {
            socket.write(`${lines.join("\r\n")}\r\n\r\n`);
            if (body) socket.write(body);
        });
        setTimeout(done, waitMs);
    });
}

function voiceAttempt(ip, identify) {
    voiceReplyIp = ip;
    return new Promise((resolve) => {
        const ws = new WebSocket(`ws://localhost:${T.port}/federated-voice?v=8`, { headers: { origin: T.origin } });
        const result = { ready: null, closed: null };
        const finish = () => {
            ws.terminate();
            resolve(result);
        };
        ws.on("open", () => ws.send(JSON.stringify({ op: 0, d: identify })));
        ws.on("message", (raw) => {
            const message = JSON.parse(raw.toString());
            if (message.op === 2) {
                result.ready = message.d;
                finish();
            }
        });
        ws.on("close", (code) => {
            result.closed = code;
            finish();
        });
        ws.on("error", finish);
        setTimeout(finish, 8000);
    });
}

async function main() {
    await listen(registry, registryPort);
    await listen(rogue, ROGUE.port);
    await startTarget();

    const alice = await register("alice");
    const bob = await register("bob");
    const guild = await call("POST", "/guilds", alice.token, { name: "Local" });
    if (!guild.body?.id) throw new Error(`guild: ${guild.status} ${JSON.stringify(guild.body)}`);
    const emoji = await call("POST", `/guilds/${guild.body.id}/emojis`, alice.token, { name: "cat", image: `data:image/png;base64,${PNG.toString("base64")}` });
    if (!emoji.body?.id) throw new Error(`emoji: ${emoji.status} ${JSON.stringify(emoji.body)}`);
    const G = guild.body.id;

    console.log("\nsigned requests");
    const first = await inbox([]);
    check("a signed request from the allowed peer goes through", first.status === 200, `${first.status} ${JSON.stringify(first.body)}`);
    {
        const body = Buffer.from(JSON.stringify({ events: [] }));
        const headers = signedHeaders("POST", "/federation/v2/inbox", body);
        const once = await federated("POST", "/federation/v2/inbox", { events: [] }, { headers });
        const twice = await federated("POST", "/federation/v2/inbox", { events: [] }, { headers });
        check("a replayed request is refused", once.status === 200 && twice.status !== 200, `${once.status} then ${twice.status}`);
    }
    {
        const stale = await federated("POST", "/federation/v2/inbox", { events: [] }, { now: Date.now() - 10 * 60_000 });
        check("a request signed 10 minutes ago is refused", stale.status === 401, String(stale.status));
        const body = Buffer.from(JSON.stringify({ events: [] }));
        const headers = signedHeaders("POST", "/federation/v2/inbox", body);
        const signature = Object.keys(headers).find((name) => /signature/i.test(name));
        headers[signature] = `${headers[signature][0] === "A" ? "B" : "A"}${headers[signature].slice(1)}`;
        const forged = await federated("POST", "/federation/v2/inbox", { events: [] }, { headers });
        check("a request with a bad signature is refused", forged.status === 401, String(forged.status));
        const tampered = signedHeaders("POST", "/federation/v2/inbox", Buffer.from(JSON.stringify({ events: [] })));
        const swapped = await federated("POST", "/federation/v2/inbox", { events: [{ id: "x", event: "PRESENCE_UPDATE", data: {} }] }, { headers: tampered });
        check("a signed request with a swapped body is refused", swapped.status === 401, String(swapped.status));
        const unlisted = await federated("POST", "/federation/v2/inbox", { events: [] }, { key: unlistedKey.privateKey, sender: UNLISTED });
        check("an instance that isn't listed or an allowed peer is refused", unlisted.status === 403, String(unlisted.status));
        const impostor = await federated("POST", "/federation/v2/inbox", { events: [] }, { key: unlistedKey.privateKey });
        check("a request claiming the peer's id with another key is refused", impostor.status === 401, String(impostor.status));
    }
    {
        const batch = await inbox(Array.from({ length: 101 }, () => ({ event: "PRESENCE_UPDATE", data: {} })));
        check("a batch of 101 events is refused", batch.status === 413, String(batch.status));
    }

    console.log("\nbodies before verification");
    {
        const started = Date.now();
        const answer = await rawRequest(
            ["POST /federation/v2/inbox HTTP/1.1", `Host: localhost:${T.port}`, "Content-Type: application/json", "Transfer-Encoding: chunked"],
            "100000\r\n",
        );
        check("an unsigned chunked body is refused before it is read", /^HTTP\/1\.1 4\d\d/.test(answer) && Date.now() - started < 2500, answer.split("\r\n")[0] || "no answer");
        const headers = signedHeaders("POST", "/federation/v2/inbox", Buffer.alloc(0));
        const lines = Object.entries(headers).map(([name, value]) => `${name}: ${value}`);
        const big = await rawRequest(
            ["POST /federation/v2/inbox HTTP/1.1", `Host: localhost:${T.port}`, "Content-Type: application/json", "Content-Length: 5000000", ...lines],
            "{",
        );
        check("a declared 5 MB inbox body is refused with 413 before it is read", /^HTTP\/1\.1 413/.test(big), big.split("\r\n")[0] || "no answer");
        const zipped = await rawRequest(
            ["POST /federation/v2/inbox HTTP/1.1", `Host: localhost:${T.port}`, "Content-Type: application/json", "Content-Encoding: gzip", "Content-Length: 1", ...lines],
            "{",
        );
        check("a compressed body is refused", /^HTTP\/1\.1 415/.test(zipped), zipped.split("\r\n")[0] || "no answer");
    }

    console.log("\nrelay into this instance as the host");
    {
        const traversal = await relay({ path: `/channels/${tc(G)}/%2e%2e/%2e%2e/users/@me` });
        check("a relay path with %2e%2e segments is refused", traversal.status === 400, `${traversal.status} ${JSON.stringify(traversal.body).slice(0, 120)}`);
        const backslash = await relay({ path: `/channels/${tc(G)}/..\\..\\users/@me` });
        check("a relay path with backslashes is refused", backslash.status === 400, String(backslash.status));
        const direct = await relay({ path: "/users/@me" });
        check("a relay to /users/@me is refused", direct.status === 403, String(direct.status));
        const apps = await relay({ path: "/applications" });
        check("a relay to /applications is refused", apps.status === 403, String(apps.status));
        const admin = await relay({ path: "/admin/federation" });
        check("a relay to an admin route is refused", admin.status === 403, String(admin.status));
        const webhooks = await relay({ path: `/guilds/${tc(G)}/webhooks` });
        check("a relay to a denied server route is refused", webhooks.status === 403, String(webhooks.status));
        const local = await relay({ actor: tc(alice.id), path: `/guilds/${tc(G)}` });
        check("a relay acting as a local user is refused", local.status === 403, String(local.status));
        const third = await relay({ actor: `@1300000000000000999@${THIRD}`, path: `/guilds/${tc(G)}` });
        check("a relay acting as a user of a third instance is refused", third.status === 403, String(third.status));
    }

    console.log("\ninbox as the home");
    await inbox([
        {
            event: "GUILD_CREATE",
            data: {
                id: rogueGuild,
                name: "Rogue",
                owner_id: rogueUser.id,
                roles: [{ id: rogueGuild, name: "@everyone", permissions: "0", position: 0 }],
                channels: [
                    { id: rogueText, type: 0, name: "general", guild_id: rogueGuild },
                    { id: rogueVoiceChannel, type: 2, name: "voice", guild_id: rogueGuild },
                ],
                members: [{ user: { ...rogueUser } }, { user: { id: tc(bob.id), username: "bob" } }],
                member: { user: { id: tc(alice.id), username: "alice" } },
            },
        },
    ]);
    const mirrorGuild = localOf(rogueGuild);
    check("the setup created a mirror server for the rogue", !!mirrorGuild && psql(`SELECT federated_instance FROM guilds WHERE id = ${quote(mirrorGuild)}`) === ROGUE.id);
    await inbox([{ event: "GUILD_MEMBER_ADD", guild_id: rogueGuild, data: { guild_id: rogueGuild, user: { id: tc(bob.id), username: "bob" }, roles: [] } }]);
    check(
        "a host can't put local users into its server",
        count(`SELECT count(*) FROM members WHERE guild_id = ${quote(mirrorGuild)} AND id IN (${quote(alice.id)}, ${quote(bob.id)})`) === 0,
    );
    const bobGuilds = await call("GET", "/users/@me/guilds", bob.token);
    check("the forced server doesn't show up for the user", Array.isArray(bobGuilds.body) && !bobGuilds.body.some((entry) => entry.id === mirrorGuild));

    await inbox([{ event: "GUILD_EMOJIS_UPDATE", guild_id: rogueGuild, data: { guild_id: rogueGuild, emojis: [{ id: tc(emoji.body.id), name: "pwned" }] } }]);
    check(
        "a host can't move a local emoji into its server",
        psql(`SELECT guild_id || ' ' || name FROM emojis WHERE id = ${quote(emoji.body.id)}`) === `${G} cat`,
        psql(`SELECT guild_id || ' ' || name FROM emojis WHERE id = ${quote(emoji.body.id)}`),
    );
    const localChannel = (await call("GET", `/guilds/${G}/channels`, alice.token)).body.find((channel) => channel.type === 0).id;
    await inbox([{ event: "CHANNEL_UPDATE", guild_id: rogueGuild, data: { id: tc(localChannel), type: 0, name: "stolen", guild_id: rogueGuild } }]);
    check(
        "a host can't take over a local channel as a mirror channel",
        psql(`SELECT guild_id || ' ' || name || ' ' || (federated_instance IS NULL) FROM channels WHERE id = ${quote(localChannel)}`).startsWith(`${G} `) &&
            !psql(`SELECT name FROM channels WHERE id = ${quote(localChannel)}`).includes("stolen"),
    );

    const aliceName = (await call("GET", "/users/@me", alice.token)).body.username;
    await inbox([
        {
            event: "GUILD_MEMBER_UPDATE",
            guild_id: rogueGuild,
            data: { guild_id: rogueGuild, user: { id: tc(alice.id), username: "hacked", global_name: "hacked", discriminator: "0" }, roles: [] },
        },
        {
            event: "GUILD_MEMBER_UPDATE",
            guild_id: rogueGuild,
            data: { guild_id: rogueGuild, user: { id: `@1300000000000000500@${THIRD}`, username: "carol", global_name: "Not Carol", discriminator: "0" }, roles: [] },
        },
    ]);
    const after = await call("GET", "/users/@me", alice.token);
    check("a host can't rewrite a local user's profile", after.body.username === aliceName && after.body.global_name !== "hacked");
    check(
        "a host can't mint ids or shadows for an instance this one doesn't federate with",
        count(`SELECT count(*) FROM federated_objects WHERE instance = ${quote(THIRD)}`) === 0 &&
            count(`SELECT count(*) FROM users WHERE federated_instance = ${quote(THIRD)}`) === 0,
    );

    await inbox([{ event: "PRESENCE_UPDATE", data: { user: { id: tc(alice.id) }, status: "dnd", activities: [] } }]);
    check("a host can't set the presence of a local user", count(`SELECT count(*) FROM sessions WHERE session_id = ${quote(`fed${alice.id}`)}`) === 0);

    await inbox([{ event: "RELATIONSHIP_ADD", recipients: [tc(alice.id)], data: { id: rogueUser.id, type: 3, user: { ...rogueUser } } }]);
    await inbox([
        {
            event: "CHANNEL_CREATE",
            recipients: [tc(alice.id), tc(bob.id)],
            data: {
                id: rogueGroup,
                type: 3,
                name: "trap",
                owner_id: rogueUser.id,
                recipients: [{ ...rogueUser }, { id: tc(alice.id), username: "a" }, { id: tc(bob.id), username: "b" }],
            },
        },
        {
            event: "CHANNEL_CREATE",
            recipients: [tc(alice.id)],
            data: { id: rogueDm, type: 1, recipients: [{ ...rogueUser }, { id: tc(alice.id), username: "a" }], e2ee_enabled_at: "2026-01-01T00:00:00.000Z" },
        },
    ]);
    const group = localOf(rogueGroup);
    check(
        "a host can't add a local user with no tie to its users to a group DM",
        !!group &&
            count(`SELECT count(*) FROM recipients WHERE channel_id = ${quote(group)} AND user_id = ${quote(bob.id)}`) === 0 &&
            count(`SELECT count(*) FROM recipients WHERE channel_id = ${quote(group)} AND user_id = ${quote(alice.id)}`) === 1,
        `group ${group}`,
    );
    const aliceGateway = gateway(alice);
    const bobGateway = gateway(bob);
    await Promise.all([aliceGateway.ready, bobGateway.ready]);
    await inbox([
        {
            event: "MESSAGE_CREATE",
            channel_id: rogueGroup,
            recipients: [tc(alice.id), tc(bob.id)],
            data: { id: rc(300), channel_id: rogueGroup, content: "spam", type: 0, author: { ...rogueUser }, mentions: [], timestamp: new Date().toISOString() },
        },
    ]);
    await sleep(2000);
    check(
        "events only reach recipients who are in the conversation",
        aliceGateway.events.some((event) => event.t === "MESSAGE_CREATE") && !bobGateway.events.some((event) => event.t === "MESSAGE_CREATE"),
        `alice ${aliceGateway.events.map((event) => event.t).join(",")}`,
    );
    aliceGateway.close();
    bobGateway.close();

    console.log("\nend-to-end encryption");
    const dm = localOf(rogueDm);
    await inbox([
        { event: "CHANNEL_UPDATE", recipients: [tc(alice.id)], data: { id: rogueDm, type: 0, e2ee_enabled_at: null, recipients: [{ ...rogueUser }, { id: tc(alice.id) }] } },
    ]);
    await inbox([{ event: "CHANNEL_E2EE_UPDATE", channel_id: rogueDm, recipients: [tc(alice.id)], data: { channel_id: rogueDm, enabled: false } }]);
    check(
        "a host can't switch encryption off on a mirrored DM",
        !!dm && psql(`SELECT type || ' ' || (e2ee_enabled_at IS NOT NULL) FROM channels WHERE id = ${quote(dm)}`) === "1 true",
        psql(`SELECT type || ' ' || (e2ee_enabled_at IS NOT NULL) FROM channels WHERE id = ${quote(dm)}`),
    );
    const relaysBefore = rogueSeen.filter((line) => line.includes("/federation/v2/relay")).length;
    const plain = await call("POST", `/channels/${dm}/messages`, alice.token, { content: "my secret" });
    check(
        "the home refuses to send plaintext into a conversation with another instance",
        plain.status === 400 && plain.body?.code === 90002 && rogueSeen.filter((line) => line.includes("/federation/v2/relay")).length === relaysBefore,
        `${plain.status} ${JSON.stringify(plain.body)}`,
    );

    console.log("\nmedia");
    {
        const prefix = `${T.origin}/federation-media/${ROGUE.id}/attachments/1300000000000000001/1300000000000000002`;
        const html = await fetch(`${prefix}/page.html`);
        const htmlType = html.headers.get("content-type") ?? "";
        check(
            "remote HTML is served as text with a sandbox",
            html.status === 200 && !/html/i.test(htmlType) && /sandbox/.test(html.headers.get("content-security-policy") ?? ""),
            `${html.status} ${htmlType}`,
        );
        const svg = await fetch(`${prefix}/image.svg`);
        check(
            "remote SVG gets a sandbox and nosniff",
            svg.status === 200 && /sandbox/.test(svg.headers.get("content-security-policy") ?? "") && svg.headers.get("x-content-type-options") === "nosniff",
            `${svg.status} ${svg.headers.get("content-security-policy")}`,
        );
        const hop = await fetch(`${prefix}/hop.png`, { redirect: "manual" });
        check("a redirect from the remote CDN isn't followed", hop.status >= 400, String(hop.status));
    }

    console.log("\nvoice and TURN");
    {
        const voiceChannel = localOf(rogueVoiceChannel);
        const session = randomBytes(8).toString("hex");
        const token = randomBytes(8).toString("hex");
        psql(
            `INSERT INTO voice_states (id, guild_id, channel_id, user_id, session_id, token, deaf, mute, self_deaf, self_mute, self_video, suppress) VALUES (${quote(
                `${BigInt(alice.id) + 7n}`,
            )}, ${quote(mirrorGuild)}, ${quote(voiceChannel)}, ${quote(alice.id)}, ${quote(session)}, ${quote(token)}, false, false, false, false, false, false)`,
        );
        const identify = { server_id: mirrorGuild, user_id: alice.id, session_id: session, token };
        const privatePeer = await voiceAttempt("10.0.0.5", identify);
        check("the home gives no TURN relay to a private address a host names", !privatePeer.ready?.meowcord_relay && privatePeer.closed === 4000, JSON.stringify(privatePeer));
        const loopback = await voiceAttempt("127.0.0.1", identify);
        check("the home gives no TURN relay to its own loopback", !loopback.ready?.meowcord_relay, JSON.stringify(loopback));
        const publicPeer = await voiceAttempt("203.0.113.7", identify);
        check("a public voice server still gets a TURN relay", !!publicPeer.ready?.meowcord_relay?.username?.includes(":203.0.113.7:"), JSON.stringify(publicPeer).slice(0, 200));
    }

    console.log("\nquotas");
    {
        await inbox(
            Array.from({ length: 6 }, (_, n) => ({
                event: "GUILD_CREATE",
                data: { id: rc(10 + n), name: `Spam ${n}`, roles: [{ id: rc(10 + n), name: "@everyone", permissions: "0" }], channels: [] },
            })),
        );
        const guilds = count(`SELECT count(*) FROM guilds WHERE federated_instance = ${quote(ROGUE.id)}`);
        check(`an instance can't store more than ${LIMITS.guildsPerInstance} servers`, guilds === LIMITS.guildsPerInstance, String(guilds));
        const before = count(`SELECT count(*) FROM federated_objects WHERE instance = ${quote(ROGUE.id)}`);
        await inbox([
            {
                event: "GUILD_MEMBER_UPDATE",
                guild_id: rogueGuild,
                data: { guild_id: rogueGuild, user: { ...rogueUser }, role_ids: Array.from({ length: 300 }, (_, n) => rc(1000 + n)) },
            },
        ]);
        const added = count(`SELECT count(*) FROM federated_objects WHERE instance = ${quote(ROGUE.id)}`) - before;
        check(`one request can't add more than ${LIMITS.newObjectsPerRequest} ids`, added === 0, `${added} rows`);
        const operator = await register("operator");
        psql(`UPDATE users SET rights = '1' WHERE id = ${quote(operator.id)}`);
        const usage = await call("GET", "/admin/federation/usage", operator.token);
        const row = usage.body?.instances?.find((entry) => entry.instance === ROGUE.id);
        check("admins see what each instance stores", usage.status === 200 && row?.guilds === guilds && usage.body.limits.guilds === LIMITS.guildsPerInstance, `${usage.status}`);
        const denied = await call("GET", "/admin/federation/usage", bob.token);
        check("the usage page needs the operator right", denied.status === 403, String(denied.status));
    }
}

let crashed = null;
try {
    await main();
} catch (error) {
    crashed = error;
    console.error(error);
} finally {
    await stopTarget();
    registry.close();
    rogue.close();
    rogueVoice.close();
    if (args.has("--drop")) {
        spawnSync("dropdb", [...pg, "--if-exists", T.db], { stdio: "inherit" });
        rmSync(runDir, { recursive: true, force: true });
    }
}
console.log(`\n${passed} passed, ${failures.length} failed${failures.length ? `: ${failures.join("; ")}` : ""}`);
process.exit(crashed || failures.length ? 1 : 0);
