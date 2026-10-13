import { spawn, spawnSync } from "node:child_process";
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

const { chromium } = createRequire(`${homedir()}/.cache/fosscord-tools/`)("playwright-core");

const args = process.argv.slice(2);
const flag = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? fallback : args[i + 1];
};
const has = (name) => args.includes(`--${name}`);
const root = path.resolve(new URL("../..", import.meta.url).pathname);
const sfu = process.env.PION_SFU_BIN || path.join(root, "extra/pion-sfu/pion-sfu");
const executablePath = flag("browser", process.env.CHROME_PATH);
const wait = Number(flag("wait", "10")) * 1000;
const registryPort = Number(process.env.FED_REGISTRY_PORT || 3120);
const runDir = process.env.FED_DIR || path.join(tmpdir(), "meowcord-federation-voice-probe");
const instances = [
    { name: "a", port: Number(process.env.FED_PORT_A || 3121), db: process.env.FED_DB_A || "meowcord_fvoice_a", turn: 3488, relay: [49300, 49319] },
    { name: "b", port: Number(process.env.FED_PORT_B || 3122), db: process.env.FED_DB_B || "meowcord_fvoice_b", turn: 3489, relay: [49320, 49339] },
];
for (const instance of instances) {
    instance.id = `localhost:${instance.port}`;
    instance.api = `http://localhost:${instance.port}/api/v9`;
    instance.origin = `http://fosscord.localhost:${instance.port}`;
    instance.dir = path.join(runDir, instance.name);
    instance.log = path.join(instance.dir, "server.log");
}
const [A, B] = instances;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const DAVE_MATCH = /_maybeRefuseDaveDowngrade\(([A-Za-z_$][\w$]*),([A-Za-z_$][\w$]*),[A-Za-z_$][\w$]*\)\{if\(0!==\2\)return!1;/;
const vencord = path.join(root, "assets/vencord/vencord.js");
const overlayDave = !(existsSync(vencord) && readFileSync(vencord, "utf8").includes("FosscordFederatedVoice"));
const overlaid = new Set();

let passed = 0;
let failed = 0;
const failures = [];
const check = (name, ok, detail = "") => {
    if (ok) passed++;
    else {
        failed++;
        failures.push(name);
    }
    console.log(`${ok ? "pass" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`);
    return ok;
};

const registryKey = generateKeyPairSync("ed25519");
const registry = createServer((req, res) => {
    if (req.url !== "/v1/registry") {
        res.writeHead(202, { "content-type": "application/json" });
        return res.end(JSON.stringify({ status: "pending" }));
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

const pg = ["--host=localhost", "--port=5432", `--username=${process.env.USER}`];
const psql = (db, sql) => {
    const result = spawnSync("psql", [...pg, db, "-Atc", sql], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(`psql ${db}: ${result.stderr}`);
    return result.stdout.trim();
};

const servers = [];
async function startInstance(instance) {
    rmSync(instance.dir, { recursive: true, force: true });
    mkdirSync(instance.dir, { recursive: true, mode: 0o700 });
    if (psql("postgres", `SELECT 1 FROM pg_database WHERE datname = '${instance.db}'`)) throw new Error(`database ${instance.db} already exists, drop it first`);
    spawnSync("createdb", [...pg, instance.db], { stdio: "inherit" });
    instance.created = true;
    const other = instances.find((entry) => entry !== instance);
    const origin = `http://localhost:${instance.port}`;
    writeFileSync(
        path.join(instance.dir, "config.json"),
        JSON.stringify({
            general: { serverName: origin },
            api: { endpointPublic: `${origin}/api/v9` },
            cdn: { endpointPublic: `${origin}/`, endpointPrivate: `${origin}/` },
            gateway: { endpointPublic: `ws://localhost:${instance.port}/` },
            security: { allowPrivateNetworkRequests: true, captcha: { blockAutomatedBrowsers: false } },
            register: { requireCaptcha: false },
            federation: {
                enabled: true,
                announce: false,
                allowUnlistedPeers: true,
                peers: [other.id],
                registry: { url: `http://localhost:${registryPort}`, publicKey: registryKey.publicKey.export({ format: "jwk" }).x },
            },
            limits: { rate: { enabled: false } },
        }),
    );
    const log = openSync(instance.log, "a");
    const child = spawn("bun", [path.join(root, "dist/bundle/start.js")], {
        cwd: instance.dir,
        env: {
            ...process.env,
            DATABASE: `postgres://${process.env.USER}@localhost:5432/${instance.db}`,
            CONFIG_PATH: path.join(instance.dir, "config.json"),
            PORT: String(instance.port),
            WRTC_WS_PORT: "",
            NODE_ENV: "development",
            PUBLIC_FETCH_PROXY: "direct",
            PION_SFU_BIN: sfu,
            PION_SFU_LOG: "1",
            WRTC_PUBLIC_IP: "127.0.0.1",
            WRTC_PORT_MIN: String(instance.port + 2000),
            WRTC_PORT_MAX: String(instance.port + 2000),
            TURN_PORT: String(instance.turn),
            TURN_SECRET: randomBytes(24).toString("base64url"),
            TURN_RELAY_PORT_MIN: String(instance.relay[0]),
            TURN_RELAY_PORT_MAX: String(instance.relay[1]),
        },
        stdio: ["ignore", log, log],
    });
    servers.push(child);
    for (let attempt = 0; attempt < 120; attempt++) {
        if (child.exitCode !== null) throw new Error(`instance ${instance.name} exited, see ${instance.log}`);
        if (
            await fetch(`${origin}/api/ping`).then(
                (response) => response.ok,
                () => false,
            )
        )
            return;
        await sleep(1000);
    }
    throw new Error(`instance ${instance.name} did not start, see ${instance.log}`);
}

async function call(instance, method, route, token, body) {
    const response = await fetch(`${instance.api}${route}`, {
        method,
        headers: { ...(body && { "content-type": "application/json" }), ...(token && { authorization: token }) },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    try {
        return { status: response.status, body: text ? JSON.parse(text) : null };
    } catch {
        return { status: response.status, body: text.slice(0, 300) };
    }
}

async function register(instance, username) {
    const response = await call(instance, "POST", "/auth/register", null, {
        email: `${username}-${randomBytes(3).toString("hex")}@fed.test`,
        username: `${username}${randomBytes(2).toString("hex")}`,
        password: randomBytes(12).toString("hex"),
        date_of_birth: "2000-01-01",
        consent: true,
    });
    if (!response.body?.token) throw new Error(`register ${username} on ${instance.name}: ${response.status} ${JSON.stringify(response.body)}`);
    const me = await call(instance, "GET", "/users/@me", response.body.token);
    return { token: response.body.token, id: me.body.id, username: me.body.username, instance };
}

async function openClient(browser, account) {
    const context = await browser.newContext({ permissions: ["microphone", "camera"] });
    await context.addInitScript((token) => {
        localStorage.setItem("token", JSON.stringify(token));
        window.__pcs = [];
        window.__voiceSockets = [];
        const NativeConnection = window.RTCPeerConnection;
        window.RTCPeerConnection = new Proxy(NativeConnection, {
            construct(target, ctorArgs) {
                const pc = new target(...ctorArgs);
                window.__pcs.push(pc);
                return pc;
            },
        });
        const NativeSocket = window.WebSocket;
        window.WebSocket = new Proxy(NativeSocket, {
            construct(target, ctorArgs) {
                const socket = new target(...ctorArgs);
                if (!String(ctorArgs[0]).includes("encoding=")) window.__voiceSockets.push({ url: socket.url, socket });
                return socket;
            },
        });
    }, account.token);
    await context.route(/^https:\/\/([a-z0-9-]+\.)*(discord|discordapp)\.(com|net|media|gg)\//, (route) => route.abort());
    if (overlayDave)
        await context.route(/\/assets\/web\.[0-9a-f]+\.js$/, async (route) => {
            const file = path.join(root, "assets/cache", new URL(route.request().url()).pathname.split("/").at(-1));
            const source = readFileSync(file, "utf8");
            const patched = source.replace(DAVE_MATCH, "$&if(window.FosscordFederatedVoice?.sharedCall())return!1;");
            if (patched === source) throw new Error("the DAVE downgrade patch no longer matches the cached client");
            overlaid.add(account.instance.name);
            await route.fulfill({ status: 200, contentType: "text/javascript", body: patched });
        });
    const page = await context.newPage();
    await page.goto(`${account.instance.origin}/channels/@me`);
    return page;
}

const invoke = (page, needle, method, arg) =>
    page.evaluate(
        ([needle, method, arg]) => {
            const requires = [];
            window.webpackChunkdiscord_app.push([[Symbol()], {}, (r) => requires.push(r)]);
            for (const req of requires)
                for (const mid of Object.keys(req.m)) {
                    if (!req.m[mid].toString().includes(needle)) continue;
                    const exports = req(mid);
                    for (const key of Object.keys(exports))
                        if (typeof exports[key]?.[method] === "function") {
                            exports[key][method](arg);
                            return true;
                        }
                }
            return false;
        },
        [needle, method, arg],
    );
const selectVoiceChannel = (page, channel_id) => invoke(page, "selectVoiceChannel(e){", "selectVoiceChannel", channel_id);
const setVideo = (page, enabled) => invoke(page, "setVideoEnabled(e){", "setVideoEnabled", enabled);

const callState = (page) =>
    page.evaluate(async () => {
        const connections = [];
        for (const pc of window.__pcs) {
            if (pc.connectionState === "closed") continue;
            const reports = [...(await pc.getStats()).values()];
            const byId = new Map(reports.map((report) => [report.id, report]));
            const pair = reports.find((report) => report.type === "candidate-pair" && report.nominated && report.state === "succeeded");
            connections.push({
                state: pc.connectionState,
                policy: pc.getConfiguration().iceTransportPolicy,
                iceServers: pc.getConfiguration().iceServers?.flatMap((server) => [server.urls].flat()),
                local: pair && byId.get(pair.localCandidateId),
                remote: pair && byId.get(pair.remoteCandidateId),
                media: reports
                    .filter((report) => report.type === "inbound-rtp" || report.type === "outbound-rtp")
                    .map((report) => ({ dir: report.type === "inbound-rtp" ? "in" : "out", kind: report.kind, packets: report.packetsReceived ?? report.packetsSent ?? 0 })),
            });
        }
        return {
            connections: connections.map(({ local, remote, ...rest }) => ({
                ...rest,
                local: local && { type: local.candidateType, address: local.address, port: local.port, relayProtocol: local.relayProtocol, url: local.url },
                remote: remote && { type: remote.candidateType, address: remote.address, port: remote.port },
            })),
            sockets: window.__voiceSockets.map((entry) => ({ url: entry.url, open: entry.socket.readyState === 1 })),
        };
    });

const logLines = (instance) => (existsSync(instance.log) ? readFileSync(instance.log, "utf8").split("\n") : []);
const inRange = (port, [min, max]) => port >= min && port <= max;

async function cleanup() {
    registry.close();
    await Promise.all(
        servers.map(
            (child) =>
                new Promise((resolve) => {
                    if (child.exitCode !== null) return resolve();
                    const force = setTimeout(() => child.kill("SIGKILL"), 15_000);
                    child.once("exit", () => {
                        clearTimeout(force);
                        resolve();
                    });
                    child.kill("SIGTERM");
                }),
        ),
    );
    if (has("keep")) return;
    for (const instance of instances) if (instance.created) spawnSync("dropdb", [...pg, "--if-exists", instance.db], { stdio: "inherit" });
    rmSync(runDir, { recursive: true, force: true });
}

async function main() {
    if (!existsSync(path.join(root, "dist/bundle/start.js"))) throw new Error("Build first with bun run build:src");
    if (!existsSync(sfu)) throw new Error(`Build the SFU first: cd extra/pion-sfu && go build -o pion-sfu .`);
    await new Promise((resolve) => registry.listen(registryPort, "127.0.0.1", resolve));
    await Promise.all(instances.map(startInstance));

    const alice = await register(A, "alice");
    const bob = await register(B, "bob");
    for (let attempt = 0; attempt < 40; attempt++) {
        const ready = await Promise.all([call(A, "GET", "/federation/discovery", alice.token), call(B, "GET", "/federation/discovery", bob.token)]);
        if (ready.every((response) => response.body?.available === true)) break;
        await sleep(1000);
    }

    const guild = await call(B, "POST", "/guilds", bob.token, { name: "Federated voice" });
    const channels = await call(B, "GET", `/guilds/${guild.body.id}/channels`, bob.token);
    const text = channels.body.find((channel) => channel.type === 0);
    const voice = channels.body.find((channel) => channel.type === 2) ?? (await call(B, "POST", `/guilds/${guild.body.id}/channels`, bob.token, { name: "Voice", type: 2 })).body;
    await call(B, "PATCH", `/guilds/${guild.body.id}/global-discovery`, bob.token, { enabled: true });
    const invite = await call(B, "POST", `/channels/${text.id}/invites`, bob.token, { max_age: 0 });
    const join = await call(A, "POST", `/federation/invites/${B.id}/${invite.body.code}`, alice.token);
    check("alice joins bob's server from her instance", join.status === 200 && !!join.body?.guild_id, `${join.status} ${JSON.stringify(join.body).slice(0, 200)}`);
    const mirror = join.body?.guild_id;
    await sleep(2000);
    const mirrorChannels = await call(A, "GET", `/guilds/${mirror}/channels`, alice.token);
    const mirrorVoice = mirrorChannels.body?.find?.((channel) => channel.name === voice.name && channel.type === 2);
    check("alice sees the voice channel in the mirror", !!mirrorVoice, JSON.stringify(mirrorChannels.body).slice(0, 200));
    const aliceShadow = psql(B.db, `SELECT id FROM users WHERE username = '${alice.username}@${A.id}'`);
    check("bob's instance has a shadow for alice", !!aliceShadow);

    const browser = await chromium.launch({
        ...(executablePath ? { executablePath } : { channel: "chrome" }),
        headless: true,
        args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
    });
    try {
        const pages = { alice: await openClient(browser, alice), bob: await openClient(browser, bob) };
        await sleep(15000);
        if (overlayDave)
            console.log(
                `note: assets/vencord predates the FosscordFederation DAVE patch, so the probe applied the same replacement to the client bundle for ${[...overlaid].join(" and ")}`,
            );
        check("bob joins the voice channel on his instance", await selectVoiceChannel(pages.bob, voice.id));
        await sleep(3000);
        check("alice joins the mirrored voice channel", await selectVoiceChannel(pages.alice, mirrorVoice?.id));
        await sleep(wait);

        const states = { alice: await callState(pages.alice), bob: await callState(pages.bob) };
        for (const [name, state] of Object.entries(states)) console.log(JSON.stringify({ label: "call", user: name, ...state }));

        const aliceSocket = states.alice.sockets.at(-1);
        check("alice's voice websocket goes to her own instance", aliceSocket?.url?.startsWith(`ws://localhost:${A.port}/federated-voice`), aliceSocket?.url);
        check(
            "bob's voice websocket stays local",
            states.bob.sockets.at(-1)?.url?.startsWith(`ws://127.0.0.1:${B.port}/voice`) || states.bob.sockets.at(-1)?.url?.includes(`:${B.port}/voice`),
            states.bob.sockets.at(-1)?.url,
        );
        const aliceCall = states.alice.connections.find((connection) => connection.state === "connected");
        const bobCall = states.bob.connections.find((connection) => connection.state === "connected");
        check("alice's peer connection is connected", !!aliceCall, JSON.stringify(states.alice.connections));
        check("bob's peer connection is connected", !!bobCall, JSON.stringify(states.bob.connections));
        check("alice's peer connection only allows relay candidates", aliceCall?.policy === "relay", aliceCall?.policy);
        check(
            "alice's only ICE server is her instance's TURN relay",
            aliceCall?.iceServers?.every((url) => url.startsWith(`turn:127.0.0.1:${A.turn}`)) && aliceCall.iceServers.length > 0,
            JSON.stringify(aliceCall?.iceServers),
        );
        check(
            "alice's selected local candidate is a relay on her instance",
            aliceCall?.local?.type === "relay" && inRange(aliceCall.local.port, A.relay),
            JSON.stringify(aliceCall?.local),
        );
        check("bob's call keeps its normal configuration", bobCall?.policy !== "relay" && bobCall?.local?.type !== "relay", JSON.stringify(bobCall));
        for (const [name, connection] of [
            ["alice", aliceCall],
            ["bob", bobCall],
        ]) {
            check(
                `${name} sends audio`,
                connection?.media.some((row) => row.kind === "audio" && row.dir === "out" && row.packets > 0),
                JSON.stringify(connection?.media),
            );
            check(
                `${name} receives audio`,
                connection?.media.some((row) => row.kind === "audio" && row.dir === "in" && row.packets > 0),
                JSON.stringify(connection?.media),
            );
        }

        const packets = (state, kind, dir) =>
            state.connections
                .filter((connection) => connection.state === "connected")
                .flatMap((connection) => connection.media)
                .filter((row) => row.kind === kind && row.dir === dir)
                .reduce((total, row) => total + row.packets, 0);
        check("alice turns her camera on", await setVideo(pages.alice, true));
        check("bob turns his camera on", await setVideo(pages.bob, true));
        await sleep(wait);
        const video = { alice: await callState(pages.alice), bob: await callState(pages.bob) };
        for (const [name, state] of Object.entries(video)) console.log(JSON.stringify({ label: "video", user: name, connections: state.connections }));
        check("alice sends video", packets(video.alice, "video", "out") > 0);
        check("bob receives alice's video", packets(video.bob, "video", "in") > 0);
        check("bob sends video", packets(video.bob, "video", "out") > 0);
        check("alice receives bob's video", packets(video.alice, "video", "in") > 0);
        check(
            "alice still sends media through the relay",
            video.alice.connections.every((connection) => connection.state !== "connected" || connection.local?.type === "relay"),
        );

        const mediaLine = logLines(B).find((line) => line.includes(`media of ${aliceShadow} from ${A.id}`));
        const source = mediaLine?.match(/comes from ([\d.]+):(\d+)/);
        console.log(JSON.stringify({ label: "host-sfu", line: mediaLine }));
        check("bob's SFU gets alice's media from a port in her instance's TURN relay range", !!source && inRange(Number(source[2]), A.relay), mediaLine ?? "no line");
        const allocation = logLines(A).find((line) => line.includes("TURN allocation for") && line.includes("relays from"));
        const permission = logLines(A).find((line) => line.includes("TURN relay") && line.includes(`may now reach 127.0.0.1`));
        console.log(JSON.stringify({ label: "home-turn", allocation, permission }));
        check("alice's instance allocated a relay for her", !!allocation);
        check(
            "the relay was only allowed to reach bob's SFU",
            !!permission && !logLines(A).some((line) => line.includes("TURN refused") && !line.includes("401")),
            permission ?? "no line",
        );
        const aliceSources = logLines(B).filter((line) => line.includes(`media of ${aliceShadow}`));
        check(
            "every media connection of alice on bob's instance came through the relay",
            aliceSources.length > 0 && aliceSources.every((line) => inRange(Number(line.match(/comes from [\d.]+:(\d+)/)?.[1]), A.relay)),
            aliceSources.join(" | "),
        );

        check("bob's instance has alice's shadow in the voice channel", psql(B.db, `SELECT channel_id FROM voice_states WHERE user_id = '${aliceShadow}'`) === voice.id);
        const bobShadow = psql(A.db, `SELECT id FROM users WHERE username = '${bob.username}@${B.id}'`);
        check(
            "alice's instance shows bob in the mirrored voice channel",
            !!bobShadow && psql(A.db, `SELECT channel_id FROM voice_states WHERE user_id = '${bobShadow}'`) === mirrorVoice?.id,
        );
        check("alice's own voice state points at the mirror", psql(A.db, `SELECT channel_id FROM voice_states WHERE user_id = '${alice.id}'`) === mirrorVoice?.id);

        await selectVoiceChannel(pages.alice, null);
        let left = false;
        for (let attempt = 0; attempt < 20 && !left; attempt++) {
            await sleep(500);
            left = !psql(B.db, `SELECT channel_id FROM voice_states WHERE user_id = '${aliceShadow}' AND channel_id IS NOT NULL`);
        }
        check("alice leaving clears her shadow's voice state on bob's instance", left);
        check("alice's instance clears her own voice state", !psql(A.db, `SELECT channel_id FROM voice_states WHERE user_id = '${alice.id}' AND channel_id IS NOT NULL`));
    } finally {
        await browser.close();
    }
}

try {
    await main();
} catch (error) {
    failed++;
    failures.push(String(error?.message ?? error));
    console.error(error);
} finally {
    console.log(`\n${passed} passed, ${failed} failed${failures.length ? `\nfailed: ${failures.join("; ")}` : ""}`);
    await cleanup();
    process.exit(failed ? 1 : 0);
}
