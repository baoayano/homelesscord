import { blockFor, hitRateLimit, logEvent, nowIso, removeBlock, setBlock } from "../db.js";
import { refreshInstance } from "../instances.js";
import { allowsPrivateHosts, parseInstanceId, rateLimitBucket } from "../net.js";
import { currentPublication, instanceState, publish } from "../registry.js";
import { html, page, time } from "./html.js";
import { currentSession, endSession, finishLogin, oidcConfigured, startLogin } from "./oidc.js";

const instanceFilters = ["pending", "approved", "suspended", "blocked", "all"];
const discoveryFilters = ["pending", "verified", "rejected", "blocked", "all"];

function redirect(location, notice, isError = false) {
    const url = new URL(location, "https://registry.invalid");
    if (notice) url.searchParams.set(isError ? "error" : "notice", notice);
    return new Response(null, { status: 303, headers: { location: `${url.pathname}${url.search}`, "cache-control": "no-store" } });
}

function noticeFrom(url) {
    const error = url.searchParams.get("error");
    return error ? { notice: error, noticeError: true } : { notice: url.searchParams.get("notice") };
}

function safeBack(value, fallback) {
    return typeof value === "string" && /^\/admin(\/[a-z]*)?(\?[a-z0-9=&_-]*)?$/.test(value) ? value : fallback;
}

export function canonicalId(value, options) {
    const match = /^@(\d{1,20})@(.+)$/.exec(value ?? "");
    return match && parseInstanceId(match[2], options) ? value : null;
}

function stateBadge(state) {
    const tone =
        { active: "good", verified: "good", listed: "good", pending: "warn", suspended: "warn", blocked: "bad", rejected: "bad", error: "bad", warning: "warn" }[state] ?? "";
    return html`<span class="badge ${tone}">${state}</span>`;
}

function shortKey(key) {
    return key ? `${key.slice(0, 10)}…` : "none";
}

function reasonInput() {
    return html`<label class="reason">Reason<input type="text" name="reason" placeholder="Optional, published with blocks"></label>`;
}

function instanceItem(row, back) {
    const state = row.blocked ? "blocked" : instanceState(row);
    const actions = [];
    if (row.blocked) actions.push(["unblock", "Unblock", ""]);
    else {
        if (row.status !== "approved") actions.push(["approve", "Approve", "primary"]);
        if (row.status !== "suspended") actions.push(["suspend", "Suspend", ""]);
        actions.push(["block", "Block", "danger"]);
        if (row.status !== "pending") actions.push(["pending", "Move back to pending", ""]);
    }
    if (row.pending_public_key) actions.push(["accept_key", "Accept the new key", ""]);
    actions.push(["refresh", "Check now", ""]);
    return html`<article class="card item">
<div class="item-head"><h3>${row.name || row.id}</h3>${stateBadge(state)}${row.in_github ? html`<span class="badge">instances.json</span>` : ""}${row.pending_public_key ? html`<span class="badge bad">new key waiting</span>` : ""}</div>
${row.description ? html`<p class="description">${row.description}</p>` : ""}
<div class="meta">
<a href="${row.url}" rel="noreferrer noopener" target="_blank">${row.id}</a>
${row.source_url ? html`<a href="${row.source_url}" rel="noreferrer noopener" target="_blank">Source code</a>` : ""}
<span>Key ${shortKey(row.public_key)}${row.pending_public_key ? html`, new key ${shortKey(row.pending_public_key)}` : ""}</span>
<span>Protocol ${row.protocol ?? "unknown"}</span>
<span>Registration ${row.registration ?? "unknown"}</span>
<span>Federation ${row.federation_enabled ? "on" : "off"}</span>
<span>Version ${row.software_version ?? "unknown"}</span>
<span>Announced ${time(row.last_announce_at)}</span>
<span>Checked ${time(row.last_checked_at)}</span>
</div>
${row.block_reason || row.reason ? html`<div class="meta"><span>Reason: ${row.block_reason || row.reason}</span></div>` : ""}
${row.last_error ? html`<div class="error-text">Last error: ${row.last_error}</div>` : ""}
<form class="actions" method="post" action="/admin/instances">
<input type="hidden" name="id" value="${row.id}"><input type="hidden" name="back" value="${back}">
${reasonInput()}
${actions.map(([value, label, tone]) => html`<button type="submit" name="action" value="${value}" class="${tone}">${label}</button>`)}
</form>
</article>`;
}

function discoveryItem(row, back) {
    const state = row.blocked ? "blocked" : row.status;
    const actions = [];
    if (row.blocked) actions.push(["unblock", "Unblock", ""]);
    else {
        if (row.status !== "verified") actions.push(["verify", "List again", "primary"]);
        if (row.status !== "rejected") actions.push(["reject", "Remove from discovery", ""]);
        actions.push(["block", "Block", "danger"]);
    }
    return html`<article class="card item">
<div class="item-head"><h3>${row.name}</h3>${stateBadge(state)}${row.present ? "" : html`<span class="badge">no longer listed by its instance</span>`}${row.instance_status !== "approved" ? html`<span class="badge warn">instance ${row.instance_status ?? "unknown"}</span>` : ""}</div>
${row.description ? html`<p class="description">${row.description}</p>` : ""}
<div class="meta">
<span>${row.id}</span>
<span>${row.member_count} members</span>
<a href="${row.invite_url}" rel="noreferrer noopener" target="_blank">Invite page</a>
<span>Updated ${time(row.updated_at)}</span>
${row.verified_at ? html`<span>Listed ${time(row.verified_at)}</span>` : ""}
</div>
${row.block_reason || row.reason ? html`<div class="meta"><span>Reason: ${row.block_reason || row.reason}</span></div>` : ""}
<form class="actions" method="post" action="/admin/discovery">
<input type="hidden" name="id" value="${row.id}"><input type="hidden" name="back" value="${back}">
${reasonInput()}
${actions.map(([value, label, tone]) => html`<button type="submit" name="action" value="${value}" class="${tone}">${label}</button>`)}
</form>
</article>`;
}

const instanceSelect = "SELECT i.*, b.id IS NOT NULL AS blocked, b.reason AS block_reason FROM instances i LEFT JOIN blocks b ON b.kind = 'instance' AND b.id = i.id";
const discoverySelect =
    "SELECT d.*, b.id IS NOT NULL AS blocked, b.reason AS block_reason, i.status AS instance_status FROM discovery d LEFT JOIN blocks b ON b.kind = 'guild' AND b.id = d.id LEFT JOIN instances i ON i.id = d.instance";

function filterLinks(base, filters, current) {
    return html`<div class="filters" role="navigation" aria-label="Filter">${filters.map(
        (filter) => html`<a href="${base}?status=${filter}" aria-current="${filter === current ? "true" : "false"}">${filter[0].toUpperCase()}${filter.slice(1)}</a>`,
    )}</div>`;
}

async function overview(env, session, url) {
    const [counts, discoveryCounts, pendingInstances, pendingDiscovery, errors] = await env.DB.batch([
        env.DB.prepare(
            "SELECT SUM(status = 'pending' AND id NOT IN (SELECT id FROM blocks WHERE kind = 'instance')) AS pending, SUM(status = 'approved' AND id NOT IN (SELECT id FROM blocks WHERE kind = 'instance')) AS approved, COUNT(*) AS total FROM instances",
        ),
        env.DB.prepare("SELECT SUM(status = 'rejected' AND present = 1) AS pending, SUM(status = 'verified' AND present = 1) AS verified FROM discovery"),
        env.DB.prepare(`${instanceSelect} WHERE i.status = 'pending' AND b.id IS NULL ORDER BY i.created_at LIMIT 10`),
        env.DB.prepare(`${discoverySelect} WHERE d.status = 'verified' AND d.present = 1 AND b.id IS NULL ORDER BY d.created_at DESC LIMIT 10`),
        env.DB.prepare("SELECT COUNT(*) AS count FROM events WHERE level = 'error' AND at > ?").bind(nowIso(Date.now() - 24 * 60 * 60 * 1000)),
    ]);
    const publication = await currentPublication(env);
    const c = counts.results[0];
    const d = discoveryCounts.results[0];
    const body = html`<h1>Overview</h1>
<div class="stats">
<div class="card stat"><span class="muted">Instances waiting</span><strong>${c.pending ?? 0}</strong></div>
<div class="card stat"><span class="muted">Approved instances</span><strong>${c.approved ?? 0}</strong></div>
<div class="card stat"><span class="muted">Servers removed by us</span><strong>${d.pending ?? 0}</strong></div>
<div class="card stat"><span class="muted">Listed servers</span><strong>${d.verified ?? 0}</strong></div>
<div class="card stat"><span class="muted">Errors in the last day</span><strong><a href="/admin/activity?level=error">${errors.results[0].count}</a></strong></div>
</div>
<h2>Published document</h2>
<div class="card item">
${
    publication
        ? html`<div class="meta"><span>Sequence ${publication.sequence}</span><span>Signed ${time(publication.issued_at)}</span><span>Expires ${time(publication.expires_at)}</span><a href="/v1/registry">View the signed document</a></div>`
        : html`<p class="description">Nothing is published yet.</p>`
}
<form class="actions" method="post" action="/admin/publish"><button type="submit" class="primary">Sign and publish now</button></form>
</div>
<h2>Instances waiting for review</h2>
${pendingInstances.results.length ? html`<div class="list">${pendingInstances.results.map((row) => instanceItem(row, "/admin"))}</div>` : html`<div class="card empty">No instance is waiting. New ones show up here when they announce themselves.</div>`}
<h2>Servers listed most recently</h2>
${pendingDiscovery.results.length ? html`<div class="list">${pendingDiscovery.results.map((row) => discoveryItem(row, "/admin"))}</div>` : html`<div class="card empty">No server is listed yet. An approved instance's servers show up here when its admins list them for global discovery.</div>`}`;
    return page({ title: "Overview", body, session, path: "/admin", ...noticeFrom(url) });
}

async function instancesPage(env, session, url) {
    const status = instanceFilters.includes(url.searchParams.get("status")) ? url.searchParams.get("status") : "pending";
    const where = {
        pending: "i.status = 'pending' AND b.id IS NULL",
        approved: "i.status = 'approved' AND b.id IS NULL",
        suspended: "i.status = 'suspended' AND b.id IS NULL",
        blocked: "b.id IS NOT NULL",
        all: "1 = 1",
    }[status];
    const { results } = await env.DB.prepare(`${instanceSelect} WHERE ${where} ORDER BY i.status = 'pending' DESC, i.name COLLATE NOCASE LIMIT 500`).all();
    const back = `/admin/instances?status=${status}`;
    const body = html`<h1>Instances</h1>
${filterLinks("/admin/instances", instanceFilters, status)}
${results.length ? html`<div class="list">${results.map((row) => instanceItem(row, back))}</div>` : html`<div class="card empty">No instance has this status.</div>`}`;
    return page({ title: "Instances", body, session, path: "/admin/instances", ...noticeFrom(url) });
}

async function discoveryPage(env, session, url) {
    const status = discoveryFilters.includes(url.searchParams.get("status")) ? url.searchParams.get("status") : "pending";
    const where = {
        pending: "d.status = 'pending' AND d.present = 1 AND b.id IS NULL",
        verified: "d.status = 'verified' AND b.id IS NULL",
        rejected: "d.status = 'rejected' AND b.id IS NULL",
        blocked: "b.id IS NOT NULL",
        all: "1 = 1",
    }[status];
    const { results } = await env.DB.prepare(`${discoverySelect} WHERE ${where} ORDER BY d.instance, d.name COLLATE NOCASE LIMIT 500`).all();
    const back = `/admin/discovery?status=${status}`;
    const body = html`<h1>Discovery servers</h1>
${filterLinks("/admin/discovery", discoveryFilters, status)}
${results.length ? html`<div class="list">${results.map((row) => discoveryItem(row, back))}</div>` : html`<div class="card empty">No server has this status.</div>`}`;
    return page({ title: "Discovery", body, session, path: "/admin/discovery", ...noticeFrom(url) });
}

async function blocksPage(env, session, url) {
    const { results } = await env.DB.prepare("SELECT * FROM blocks ORDER BY at DESC").all();
    const body = html`<h1>Blocks</h1>
<p class="muted">Blocks are published in the signed registry document. Instances apply them within minutes and can't lift them. Servers and users use canonical ids such as @123@meow.example.com.</p>
<form class="card form-grid" method="post" action="/admin/blocks">
<input type="hidden" name="action" value="add">
<label>Kind<select name="kind"><option value="instance">Instance</option><option value="guild">Server</option><option value="user">User</option></select></label>
<label>Id<input type="text" name="id" required placeholder="spam.example.com or @123@meow.example.com" autocomplete="off" spellcheck="false"></label>
<label>Reason<input type="text" name="reason" placeholder="Shown to every instance"></label>
<button type="submit" class="danger">Add block</button>
</form>
<h2>Current blocks</h2>
${
    results.length
        ? html`<div class="table-wrap"><table><thead><tr><th>Kind</th><th>Id</th><th>Reason</th><th>Since</th><th></th></tr></thead><tbody>${results.map(
              (row) =>
                  html`<tr><td>${{ instance: "Instance", guild: "Server", user: "User" }[row.kind] ?? row.kind}</td><td class="wrap">${row.id}</td><td class="wrap">${row.reason || html`<span class="muted">none</span>`}</td><td>${time(row.at)}</td><td><form method="post" action="/admin/blocks"><input type="hidden" name="action" value="remove"><input type="hidden" name="kind" value="${row.kind}"><input type="hidden" name="id" value="${row.id}"><button type="submit">Remove block</button></form></td></tr>`,
          )}</tbody></table></div>`
        : html`<div class="card empty">Nothing is blocked. Add an instance, server or user above to block it everywhere.</div>`
}`;
    return page({ title: "Blocks", body, session, path: "/admin/blocks", ...noticeFrom(url) });
}

async function activityPage(env, session, url) {
    const errorsOnly = url.searchParams.get("level") === "error";
    const instance = url.searchParams.get("instance");
    const conditions = [];
    const params = [];
    if (errorsOnly) conditions.push("level = 'error'");
    if (instance) {
        conditions.push("instance = ?");
        params.push(instance);
    }
    const { results } = await env.DB.prepare(`SELECT * FROM events ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""} ORDER BY id DESC LIMIT 300`)
        .bind(...params)
        .all();
    const body = html`<h1>Activity</h1>
<div class="filters" role="navigation" aria-label="Filter"><a href="/admin/activity" aria-current="${errorsOnly ? "false" : "true"}">Everything</a><a href="/admin/activity?level=error" aria-current="${errorsOnly ? "true" : "false"}">Errors</a></div>
${
    results.length
        ? html`<div class="table-wrap"><table><thead><tr><th>When</th><th>Kind</th><th>Instance</th><th>Message</th><th>By</th></tr></thead><tbody>${results.map(
              (row) =>
                  html`<tr><td>${time(row.at)}</td><td>${row.level === "info" ? row.kind : html`${row.kind} ${stateBadge(row.level === "error" ? "error" : "warning")}`}</td><td class="wrap">${row.instance ? html`<a href="/admin/activity?instance=${encodeURIComponent(row.instance)}">${row.instance}</a>` : ""}</td><td class="wrap">${row.message}</td><td>${row.actor ?? row.ip ?? ""}</td></tr>`,
          )}</tbody></table></div>`
        : html`<div class="card empty">Nothing happened yet. Announces, checks, imports and admin actions show up here.</div>`
}`;
    return page({ title: "Activity", body, session, path: "/admin/activity", ...noticeFrom(url) });
}

async function instanceAction(env, form, actor) {
    const id = form.get("id");
    const action = form.get("action");
    const reason = String(form.get("reason") ?? "").slice(0, 500);
    const row = await env.DB.prepare("SELECT * FROM instances WHERE id = ?").bind(id).first();
    if (!row) return { error: `${id} is not a known instance` };
    const now = nowIso();
    const setStatus = (status) =>
        env.DB.prepare(
            "UPDATE instances SET status = ?, reason = ?, listed_at = CASE WHEN ? = 'approved' THEN COALESCE(listed_at, ?) ELSE listed_at END, updated_at = ? WHERE id = ?",
        )
            .bind(status, reason, status, now, now, id)
            .run();
    if (action === "approve" || action === "suspend" || action === "pending") {
        await setStatus({ approve: "approved", suspend: "suspended", pending: "pending" }[action]);
        await removeBlock(env, "instance", id);
    } else if (action === "block") await setBlock(env, "instance", id, reason);
    else if (action === "unblock") await removeBlock(env, "instance", id);
    else if (action === "accept_key") {
        if (!row.pending_public_key) return { error: "there is no new key to accept" };
        await env.DB.prepare("UPDATE instances SET public_key = pending_public_key, pending_public_key = NULL, updated_at = ? WHERE id = ?").bind(now, id).run();
    } else if (action === "refresh") {
        const instance = parseInstanceId(id, { allowPrivate: allowsPrivateHosts(env) });
        if (!instance) return { error: `${id} is not a public instance id` };
        try {
            const result = await refreshInstance(env, instance);
            await logEvent(env, { kind: "admin", actor, instance: id, message: "checked the instance" });
            return { notice: `Checked ${id}: well-known read${result.guilds === null ? "" : `, ${result.guilds} discovery servers`}` };
        } catch (error) {
            await env.DB.prepare("UPDATE instances SET last_checked_at = ?, last_error = ? WHERE id = ?").bind(now, error.message, id).run();
            return { error: `Checking ${id} failed: ${error.message}` };
        }
    } else return { error: "unknown action" };
    await logEvent(env, { kind: "admin", actor, instance: id, message: `${action}${reason ? `: ${reason}` : ""}` });
    return {
        notice: `${{ approve: "Approved", suspend: "Suspended", pending: "Moved back to pending", block: "Blocked", unblock: "Unblocked", accept_key: "Accepted the new key of" }[action]} ${id}`,
    };
}

async function discoveryAction(env, form, actor) {
    const id = form.get("id");
    const action = form.get("action");
    const reason = String(form.get("reason") ?? "").slice(0, 500);
    const row = await env.DB.prepare("SELECT * FROM discovery WHERE id = ?").bind(id).first();
    if (!row) return { error: `${id} is not a known discovery server` };
    const now = nowIso();
    if (action === "verify") {
        await env.DB.prepare("UPDATE discovery SET status = 'verified', reason = ?, verified_at = ?, updated_at = ? WHERE id = ?").bind(reason, now, now, id).run();
        await removeBlock(env, "guild", id);
    } else if (action === "reject") {
        await env.DB.prepare("UPDATE discovery SET status = 'rejected', reason = ?, verified_at = NULL, updated_at = ? WHERE id = ?").bind(reason, now, id).run();
    } else if (action === "block") {
        await env.DB.prepare("UPDATE discovery SET status = 'blocked', reason = ?, verified_at = NULL, updated_at = ? WHERE id = ?").bind(reason, now, id).run();
        await setBlock(env, "guild", id, reason);
    } else if (action === "unblock") {
        await env.DB.prepare("UPDATE discovery SET status = 'pending', updated_at = ? WHERE id = ?").bind(now, id).run();
        await removeBlock(env, "guild", id);
    } else return { error: "unknown action" };
    await logEvent(env, { kind: "admin", actor, instance: row.instance, message: `${action} server ${id}${reason ? `: ${reason}` : ""}` });
    return { notice: `${{ verify: "Listed", reject: "Removed", block: "Blocked", unblock: "Unblocked" }[action]} ${row.name}` };
}

async function blockAction(env, form, actor) {
    const action = form.get("action");
    const kind = form.get("kind");
    const id = String(form.get("id") ?? "").trim();
    const reason = String(form.get("reason") ?? "").slice(0, 500);
    if (!["instance", "guild", "user"].includes(kind)) return { error: "pick instance, server or user" };
    if (action === "remove") {
        await removeBlock(env, kind, id);
        if (kind === "guild") await env.DB.prepare("UPDATE discovery SET status = 'pending' WHERE id = ? AND status = 'blocked'").bind(id).run();
        await logEvent(env, { kind: "admin", actor, message: `removed the ${kind} block on ${id}` });
        return { notice: `Removed the block on ${id}` };
    }
    const options = { allowPrivate: allowsPrivateHosts(env) };
    const valid = kind === "instance" ? parseInstanceId(id.toLowerCase(), options)?.id : canonicalId(id, options);
    if (!valid) return { error: kind === "instance" ? "an instance id is a lowercase host such as meow.example.com" : "use a canonical id such as @123@meow.example.com" };
    if (await blockFor(env, kind, valid)) return { error: `${valid} is already blocked` };
    await setBlock(env, kind, valid, reason);
    if (kind === "guild") await env.DB.prepare("UPDATE discovery SET status = 'blocked', verified_at = NULL WHERE id = ?").bind(valid).run();
    await logEvent(env, { kind: "admin", actor, message: `blocked ${kind} ${valid}${reason ? `: ${reason}` : ""}` });
    return { notice: `Blocked ${valid}` };
}

function sameOrigin(request) {
    const origin = request.headers.get("origin");
    if (origin) return origin === new URL(request.url).origin;
    return request.headers.get("sec-fetch-site") === "same-origin";
}

function signInPage(env, message = null, status = 200) {
    const body = oidcConfigured(env)
        ? html`<div class="center card"><h1>Meowcord registry</h1><p class="muted">Sign in with your hrtID account to review instances and discovery servers.</p><p><a href="/admin/login">Sign in with hrtID</a></p></div>`
        : html`<div class="center card"><h1>Meowcord registry</h1><p class="muted">Admin sign-in isn't configured. Set OIDC_CLIENT_ID and the OIDC_CLIENT_SECRET secret.</p></div>`;
    return page({ title: "Sign in", body, notice: message, noticeError: Boolean(message), status });
}

export async function handleAdmin(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/admin";
    if (path === "/admin/login" && request.method === "GET") {
        if (!oidcConfigured(env)) return signInPage(env, null, 503);
        const limit = await hitRateLimit(env, `login:${rateLimitBucket(request.headers.get("cf-connecting-ip"))}`, 20, 10 * 60 * 1000);
        if (limit.limited) return signInPage(env, "Too many sign-in attempts. Try again in a few minutes.", 429);
        return startLogin(request, env);
    }
    if (path === "/admin/callback" && request.method === "GET") {
        try {
            return await finishLogin(request, env);
        } catch (error) {
            return signInPage(env, error.message, 400);
        }
    }
    if (path === "/admin/logout" && request.method === "POST") {
        if (!sameOrigin(request)) return new Response("cross-site request refused", { status: 403 });
        const clear = await endSession(request, env);
        return new Response(null, { status: 303, headers: { location: "/admin", "set-cookie": clear, "cache-control": "no-store" } });
    }
    const session = await currentSession(request, env);
    if (!session) return request.method === "GET" ? signInPage(env) : new Response("sign in first", { status: 401 });

    if (request.method === "GET") {
        if (path === "/admin") return overview(env, session, url);
        if (path === "/admin/instances") return instancesPage(env, session, url);
        if (path === "/admin/discovery") return discoveryPage(env, session, url);
        if (path === "/admin/blocks") return blocksPage(env, session, url);
        if (path === "/admin/activity") return activityPage(env, session, url);
        return page({ title: "Not found", body: html`<h1>Not found</h1><p><a href="/admin">Go to the overview</a></p>`, session, status: 404 });
    }
    if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
    if (!sameOrigin(request)) return new Response("cross-site request refused", { status: 403 });
    const form = await request.formData();
    if (path === "/admin/publish") {
        const publication = await publish(env, { force: true, actor: session.username });
        return redirect("/admin", `Published sequence ${publication.sequence}`);
    }
    const handlers = {
        "/admin/instances": [instanceAction, "/admin/instances"],
        "/admin/discovery": [discoveryAction, "/admin/discovery"],
        "/admin/blocks": [blockAction, "/admin/blocks"],
    };
    const handler = handlers[path];
    if (!handler) return new Response("not found", { status: 404 });
    const result = await handler[0](env, form, session.username);
    if (!result.error) ctx.waitUntil(publish(env, { actor: session.username }));
    return redirect(safeBack(form.get("back"), handler[1]), result.error ?? result.notice, Boolean(result.error));
}
