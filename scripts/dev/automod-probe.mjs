import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";
import { solveCap } from "./cap-token.mjs";

const port = process.env.PORT || 3001;
const origin = process.env.ORIGIN || `http://localhost:${port}`;
assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname), "The automod probe only runs against a local instance");
const env = parseEnv(String(readFileSync(process.env.DOTENV_CONFIG_PATH || ".env")));
const database = process.env.DATABASE || env.DATABASE;
assert.ok(database, "Set DATABASE or run from a checkout with a .env");
assert.ok(["localhost", "127.0.0.1"].includes(new URL(database).hostname), "The automod probe only touches a local database");
assert.equal(
    new URL(database).pathname.slice(1),
    process.env.AUTOMOD_PROBE_DATABASE,
    "Set AUTOMOD_PROBE_DATABASE to the name of the database you created for this run, the probe grants rights and reads rows in it",
);

const require = createRequire(import.meta.url);
const { Client } = require("pg");
const { chromium } = createRequire(path.join(homedir(), ".cache/fosscord-tools/package.json"))("playwright-core");

const db = new Client({ connectionString: database });
await db.connect();
const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    headless: true,
});
const tag = randomBytes(3).toString("hex");
const results = [];
let failures = 0;

const request = async (method, route, token, body, extra = {}) => {
    const form = body instanceof FormData;
    const response = await fetch(route.startsWith("http") ? route : `${origin}/api/v9${route}`, {
        method,
        headers: { ...(token ? { authorization: token } : {}), ...(form || body === undefined ? {} : { "content-type": "application/json" }), ...extra.headers },
        ...(body === undefined ? {} : { body: form || extra.raw ? body : JSON.stringify(body) }),
        signal: AbortSignal.timeout(20000),
    });
    const text = await response.text();
    let data = null;
    try {
        data = text ? JSON.parse(text) : null;
    } catch {
        data = text;
    }
    return { status: response.status, data };
};
const call = (method, route, token, body) => request(method, route, token, body);
const ok = (response, label) => {
    assert.ok(response.status >= 200 && response.status < 300, `${label}: HTTP ${response.status} ${JSON.stringify(response.data)?.slice(0, 300)}`);
    return response.data;
};
const refused = (response, label) => {
    assert.ok(response.status >= 400, `${label}: expected a refusal, got HTTP ${response.status}`);
    return response.data;
};
const fieldCode = (data) => Object.values(data?.errors ?? {})[0]?._errors?.[0]?.code;
const step = async (name, run) => {
    try {
        await run();
        results.push(`ok   ${name}`);
    } catch (error) {
        failures++;
        results.push(`FAIL ${name}: ${error.message}`);
    }
};

const register = async (name, email = `${name}@automodprobe.test`) => {
    const password = randomBytes(12).toString("hex");
    const captcha_key = await solveCap({ origin, browser });
    const response = await call("POST", "/auth/register", null, {
        email,
        username: name,
        password,
        date_of_birth: "2000-01-01",
        consent: true,
        ...(captcha_key ? { captcha_key } : {}),
    });
    return { name, email, password, response };
};
const account = async (name) => {
    const created = await register(name);
    const { token } = ok(created.response, `register ${name}`);
    const me = ok(await call("GET", "/users/@me", token), `profile ${name}`);
    return { ...created, token, id: me.id };
};
const userId = async (name) => (await db.query("SELECT id, join_status FROM users WHERE username = $1", [name])).rows[0];

await db.query("DELETE FROM rate_limits");
const admin = await account(`amadmin${tag}`);
const rights = (await db.query("SELECT rights FROM users WHERE id = $1", [admin.id])).rows[0].rights;
await db.query("UPDATE users SET rights = $2 WHERE id = $1", [admin.id, (BigInt(rights) | 1n).toString()]);
admin.token = ok(await call("POST", "/auth/login", null, { login: admin.email, password: admin.password }), "admin login").token;

const original = ok(await call("GET", "/admin/automod", admin.token), "automod overview").settings;
const patch = async (body, label) => ok(await call("PATCH", "/admin/automod/settings", admin.token, body), label);
await patch({ spam: { escalateAfterStrikes: 0, burst: { enabled: false }, links: { linkLimit: 50 } } }, "probe spam settings");

const members = [];
for (const letter of ["a", "b", "c", "d", "e", "f", "h"]) members.push(await account(`am${letter}${tag}`));
const [a, b, c, d, e, f, h] = members;

const guild = ok(await call("POST", "/guilds", admin.token, { name: `Automod probe ${tag}` }), "create server");
const channels = ok(await call("GET", `/guilds/${guild.id}/channels`, admin.token), "channels");
const general = channels.find((channel) => channel.type === 0);
const second = ok(await call("POST", `/guilds/${guild.id}/channels`, admin.token, { name: "second", type: 0 }), "second channel");
const invite = ok(await call("POST", `/channels/${general.id}/invites`, admin.token, { max_age: 0, max_uses: 0 }), "invite");
for (const member of members) ok(await call("POST", `/invites/${invite.code}`, member.token, {}), `${member.name} joins`);

const say = (user, content, channel = general) => call("POST", `/channels/${channel.id}/messages`, user.token, { content });
const logged = async (rule, user_id) =>
    ok(await call("GET", `/admin/automod/actions?${new URLSearchParams({ rule, ...(user_id ? { user_id } : {}) })}`, admin.token), `log ${rule}`);
const upload = (user, channel, bytes, filename) => {
    const form = new FormData();
    form.append("payload_json", JSON.stringify({ content: "" }));
    form.append("files[0]", new Blob([bytes], { type: "image/png" }), filename);
    return request("POST", `/channels/${channel.id}/messages`, user.token, form);
};
const cloudUpload = async (user, channel, bytes, filename) => {
    const { attachments } = ok(
        await call("POST", `/channels/${channel.id}/attachments`, user.token, { files: [{ id: "0", filename, file_size: bytes.length }] }),
        "cloud upload slot",
    );
    ok(await request("PUT", attachments[0].upload_url, null, bytes, { raw: true, headers: { "content-type": "image/png" } }), "cloud upload");
    return {
        attachments,
        send: () =>
            call("POST", `/channels/${channel.id}/messages`, user.token, { content: "", attachments: [{ id: "0", filename, uploaded_filename: attachments[0].upload_filename }] }),
    };
};

await step("scam links are refused with a scam notice and logged, real links pass", async () => {
    const blocked = refused(await say(a, "claim your skins https://steam-gift.xyz/free"), "scam link");
    assert.equal(blocked.code, 200000);
    assert.match(blocked.message, /scam|phishing/i);
    const log = await logged("scam_link", a.id);
    assert.ok(log.total >= 1, "the scam link is logged");
    ok(await say(b, "docs at https://github.com/spacebarchat/server and https://discord.com/channels/1/2/3"), "github and discord.com links");
    ok(await say(b, `our own link ${origin}/channels/@me`), "an own instance link");
});

await step("the same file from three new accounts is refused on the third and its hash is stored on upload", async () => {
    const bytes = randomBytes(2048);
    ok(await upload(a, general, bytes, "same.png"), "first copy");
    ok(await upload(b, second, bytes, "same.png"), "second copy");
    const cloud = await cloudUpload(c, general, bytes, "same.png");
    const row = (await db.query("SELECT content_hash FROM cloud_attachments WHERE upload_filename = $1", [cloud.attachments[0].upload_filename])).rows[0];
    assert.match(row?.content_hash ?? "", /^[0-9a-f]{64}$/, "the CDN stores a sha256 on upload");
    const third = refused(await cloud.send(), "third copy");
    assert.equal(third.code, 200000);
    assert.ok((await logged("duplicate_attachment")).total >= 1, "the repeated file is logged");
    ok(await upload(d, general, randomBytes(2048), "different.png"), "a different file passes");
});

await step("opening many DMs and sending many friend requests trips DM spam", async () => {
    await patch({ spam: { dms: { openLimit: 3, friendRequestLimit: 2, sameContentLimit: 0, newAccountDmsPerHour: 0, exemptAccountAgeDays: 0 } } }, "dm limits");
    ok(await call("POST", "/users/@me/channels", d.token, { recipients: [a.id] }), "first DM");
    ok(await call("POST", "/users/@me/channels", d.token, { recipients: [b.id] }), "second DM");
    refused(await call("POST", "/users/@me/channels", d.token, { recipients: [c.id] }), "third DM");
    const opens = await logged("dm_spam", d.id);
    assert.equal(opens.actions[0].source, "direct_message");
    ok(await call("PUT", `/users/@me/relationships/${a.id}`, e.token, {}), "first friend request");
    refused(await call("PUT", `/users/@me/relationships/${b.id}`, e.token, {}), "second friend request");
    const requests = await logged("dm_spam", e.id);
    assert.equal(requests.actions[0].source, "friend_request");
});

await step("new accounts can only start a few DMs an hour", async () => {
    await patch({ spam: { dms: { openLimit: 0, friendRequestLimit: 0, newAccountDmsPerHour: 2, newAccountHours: 72 } } }, "new account DM limit");
    ok(await call("POST", "/users/@me/channels", f.token, { recipients: [a.id] }), "first DM");
    ok(await call("POST", "/users/@me/channels", f.token, { recipients: [b.id] }), "second DM");
    const third = await call("POST", "/users/@me/channels", f.token, { recipients: [c.id] });
    assert.equal(third.status, 429);
    assert.equal(third.data.code, 40003);
    ok(await call("POST", "/users/@me/channels", f.token, { recipients: [a.id] }), "an existing DM still opens");
});

await step("DM spam settings go back to the defaults", async () => {
    await patch({ spam: original.spam }, "restore spam settings");
    await patch({ spam: { escalateAfterStrikes: 0, burst: { enabled: false }, links: { linkLimit: 50 } } }, "probe spam settings again");
});

await step("signup scoring holds a disposable email signup and a moderator confirms or undoes it", async () => {
    await patch({ signup: { holdScore: 40, deniedEmailDomains: ["blocked-domain.test"] } }, "signup scoring");
    const held = await register(`amheld${tag}`, `held${tag}@mailinator.com`);
    assert.equal(fieldCode(held.response.data), "ACCOUNT_PENDING_APPROVAL");
    const heldRow = await userId(held.name);
    assert.equal(heldRow.join_status, "pending");
    const second = await register(`amkept${tag}`, `kept${tag}@mailinator.com`);
    assert.equal(fieldCode(second.response.data), "ACCOUNT_PENDING_APPROVAL");
    const keptRow = await userId(second.name);
    const queue = ok(await call("GET", "/admin/automod/actions?review=yes&limit=100", admin.token), "review queue").actions;
    const heldEntry = queue.find((entry) => entry.user_id === heldRow.id && entry.action === "hold");
    const keptEntry = queue.find((entry) => entry.user_id === keptRow.id && entry.action === "hold");
    assert.ok(heldEntry && keptEntry, "both holds are in the review queue");
    assert.equal(heldEntry.rule, "signup_bot");
    ok(await call("POST", `/admin/automod/actions/${heldEntry.id}/confirm`, admin.token, {}), "confirm");
    ok(await call("POST", `/admin/automod/actions/${keptEntry.id}/reverse`, admin.token, { reversal: "undo" }), "undo");
    assert.equal((await userId(held.name)).join_status, "rejected");
    assert.equal((await userId(second.name)).join_status, "approved");
    const after = ok(await call("GET", "/admin/automod/actions?review=yes&limit=100", admin.token), "review queue").actions;
    assert.ok(!after.some((entry) => entry.id === heldEntry.id || entry.id === keptEntry.id), "reviewed entries leave the queue");
    const denied = await register(`amdenied${tag}`, `x${tag}@blocked-domain.test`);
    assert.equal(denied.response.status, 400);
    assert.equal(fieldCode(denied.response.data), "EMAIL_DOMAIN_NOT_ALLOWED");
    await patch({ signup: original.signup }, "restore signup scoring");
});

await step("quarantined accounts can't post links until a moderator clears them", async () => {
    await patch({ quarantine: { enabled: true, hours: 24 } }, "quarantine on");
    const blocked = refused(await say(h, "look at https://example.com/page"), "link from a new account");
    assert.equal(blocked.restriction, "NEW_ACCOUNT_RESTRICTED");
    assert.equal(blocked.reason, "links");
    assert.ok(blocked.ends_at);
    ok(await say(h, "plain text is fine"), "plain text");
    const listed = ok(await call("GET", "/admin/automod/quarantine", admin.token), "quarantine list").users;
    assert.ok(
        listed.some((user) => user.id === h.id),
        "listed in quarantine",
    );
    assert.ok(!listed.some((user) => user.id === admin.id), "operators aren't quarantined");
    ok(await call("POST", "/admin/automod/quarantine", admin.token, { user_ids: [h.id] }), "clear");
    ok(await say(h, "look at https://example.com/page"), "link after clearing");
    await patch({ quarantine: { enabled: false } }, "quarantine off");
});

await step("server verification levels are enforced on message send", async () => {
    ok(await call("PATCH", `/guilds/${guild.id}`, admin.token, { verification_level: 2 }), "verification level 2");
    const blocked = refused(await say(a, "hello"), "message under the verification level");
    assert.equal(blocked.code, 50009);
    assert.equal(blocked.restriction, "GUILD_VERIFICATION_LEVEL");
    ok(await say(admin, "owners skip it"), "the owner still talks");
    ok(await call("PATCH", `/guilds/${guild.id}`, admin.token, { verification_level: 0 }), "verification level 0");
    ok(await say(a, "hello again"), "message after lowering the level");
    assert.ok((await logged("verification_level", a.id)).total >= 1);
});

await step("the explicit media filter marks matching files and logs a flag", async () => {
    ok(await call("PATCH", `/guilds/${guild.id}`, admin.token, { explicit_content_filter: 2 }), "filter on");
    const sent = ok(await upload(b, general, randomBytes(1024), "nsfw_pic.png"), "explicit file name");
    assert.equal(sent.attachments[0].flags & 16, 16, "CONTAINS_EXPLICIT_MEDIA is set");
    const clean = ok(await upload(b, general, randomBytes(1024), "cat.png"), "clean file name");
    assert.equal((clean.attachments[0].flags ?? 0) & 16, 0);
    assert.ok((await logged("explicit_content", b.id)).actions.some((entry) => entry.action === "flag"));
    ok(await call("PATCH", `/guilds/${guild.id}`, admin.token, { explicit_content_filter: 0 }), "filter off");
});

await step("the test box runs every rule", async () => {
    const result = ok(
        await call("POST", "/admin/automod/test", admin.token, {
            text: "free nitro https://discrod.com/gift <@1> <@2> <@3>",
            email: "x@mailinator.com",
            username: `am${tag}`,
            ip: "10.1.2.3",
        }),
        "test",
    );
    assert.equal(result.scam.older_account.kind, "lookalike");
    assert.equal(result.email.disposable, true);
    assert.equal(result.quarantine.blocks, "links");
    assert.equal(result.mentions.count, 3);
    assert.equal(result.ip.group, "10.1.2.3");
    const clean = ok(await call("POST", "/admin/automod/test", admin.token, { text: "https://github.com/spacebarchat/server" }), "clean test");
    assert.equal(clean.scam.older_account, null);
    assert.equal(clean.scam.new_account, null);
});

await step("rule stats count hits and reviews", async () => {
    const { rules } = ok(await call("GET", "/admin/automod/stats", admin.token), "stats");
    const byRule = Object.fromEntries(rules.map((row) => [row.rule, row]));
    assert.ok(byRule.scam_link.hits >= 1);
    assert.ok(byRule.duplicate_attachment.hits >= 1);
    assert.ok(byRule.signup_bot.confirmed >= 1 && byRule.signup_bot.undone >= 1);
    assert.equal(typeof byRule.signup_bot.false_positive_rate, "number");
});

await step("accounts per address caps refuse signups and sign-ins past the cap", async () => {
    const ip = (await db.query("SELECT registration_ip FROM users WHERE id = $1", [a.id])).rows[0].registration_ip;
    assert.ok(ip, "registration_ip is recorded");
    const lookup = ok(await call("GET", `/admin/automod/ip-caps?${new URLSearchParams({ ip })}`, admin.token), "lookup");
    assert.ok(lookup.registration.count >= members.length, "every probe account counts");
    assert.ok(!lookup.registration.users.some((user) => user.id === admin.id), "operators don't count");
    await patch({ registration: { maxAccountsPerIp: lookup.registration.count } }, "registration cap");
    const capped = await register(`amcapped${tag}`);
    assert.equal(fieldCode(capped.response.data), "TOO_MANY_ACCOUNTS_ON_IP");
    await patch({ ipAllowList: [ip.includes(":") && !ip.startsWith("::ffff:") ? `${ip}/128` : `${ip.replace(/^::ffff:/, "")}/32`] }, "allow list");
    ok((await register(`amallowed${tag}`)).response, "an exempt address can sign up");
    await patch({ ipAllowList: [], registration: { maxAccountsPerIp: 0 } }, "registration cap off");
    assert.ok((await logged("ip_account_limit")).actions.some((entry) => entry.source === "registration"));

    await patch({ login: { maxAccountsPerIp: 1 } }, "sign-in cap");
    const login = await call("POST", "/auth/login", null, { login: a.email, password: a.password });
    assert.equal(fieldCode(login.data), "TOO_MANY_ACCOUNTS_ON_IP");
    ok(await call("POST", "/auth/login", null, { login: admin.email, password: admin.password }), "operators can always sign in");
    await patch({ login: { maxAccountsPerIp: 0 } }, "sign-in cap off");
    ok(await call("POST", "/auth/login", null, { login: a.email, password: a.password }), "sign-in works with the cap off");
    assert.ok((await logged("ip_account_limit", a.id)).actions.some((entry) => entry.source === "login"));
});

await patch(
    {
        spam: original.spam,
        scam: { ...original.scam },
        signup: original.signup,
        quarantine: original.quarantine,
        registration: { maxAccountsPerIp: original.registration.maxAccountsPerIp },
        login: original.login,
        ipAllowList: original.ipAllowList,
    },
    "restore settings",
);
await browser.close();
await db.end();
for (const line of results) console.log(line);
console.log(`${results.length - failures} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
