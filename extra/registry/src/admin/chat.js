import { logEvent, nowIso } from "../db.js";
import { allowsPrivateHosts } from "../net.js";

export const ADMIN_CHAT_NAME = "Meowcord Admins";
const REQUEST_TIMEOUT = 15000;

export function adminChatConfig(env) {
    const token = typeof env.ADMIN_CHAT_TOKEN === "string" ? env.ADMIN_CHAT_TOKEN.trim() : "";
    let origin = null;
    try {
        const url = new URL(env.ADMIN_CHAT_ORIGIN ?? "");
        if (url.protocol === "https:" || (url.protocol === "http:" && allowsPrivateHosts(env))) origin = url.origin;
    } catch {}
    return token && origin ? { origin, token } : null;
}

export async function chatContacts(env) {
    const { results } = await env.DB.prepare(
        "SELECT c.instance, c.handles FROM instance_contacts c JOIN instances i ON i.id = c.instance WHERE i.status = 'approved' AND c.instance NOT IN (SELECT id FROM blocks WHERE kind = 'instance') ORDER BY c.instance",
    ).all();
    const handles = [];
    for (const row of results) {
        try {
            for (const handle of JSON.parse(row.handles)) if (typeof handle === "string" && !handles.includes(handle)) handles.push(handle);
        } catch {}
    }
    return handles;
}

export async function chatState(env) {
    const row = await env.DB.prepare("SELECT * FROM admin_chat WHERE slot = 'current'").first();
    if (!row) return null;
    return { ...row, members: JSON.parse(row.members || "{}"), failed: JSON.parse(row.failed || "[]") };
}

class ChatApiError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

async function api(config, method, path, body) {
    let response;
    try {
        response = await fetch(`${config.origin}/api/v9${path}`, {
            method,
            headers: { authorization: config.token, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
            body: body ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(REQUEST_TIMEOUT),
        });
    } catch (error) {
        throw new ChatApiError(0, `${config.origin} didn't answer: ${error.message}`);
    }
    const text = await response.text();
    let data = null;
    try {
        data = text ? JSON.parse(text) : null;
    } catch {}
    if (!response.ok) {
        const detail = data?.errors ? JSON.stringify(data.errors).slice(0, 200) : "";
        throw new ChatApiError(
            response.status,
            `${method} ${path.split("?")[0]} answered ${response.status}${data?.message ? `: ${data.message}` : ""}${detail ? ` ${detail}` : ""}`,
        );
    }
    return data;
}

async function resolveHandles(config, handles) {
    const resolved = {};
    const failed = [];
    for (const handle of handles) {
        try {
            const user = await api(config, "GET", `/federation/users/lookup?handle=${encodeURIComponent(handle)}`);
            if (typeof user?.id === "string") resolved[handle] = user.id;
            else failed.push({ handle, reason: "the lookup returned no user" });
        } catch (error) {
            failed.push({ handle, reason: error.status === 404 ? "no such user" : error.message });
        }
    }
    return { resolved, failed };
}

async function saveState(env, state) {
    await env.DB.prepare(
        "INSERT INTO admin_chat (slot, origin, channel_id, members, member_count, failed, opened_by, opened_at, updated_at) VALUES ('current', ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) ON CONFLICT (slot) DO UPDATE SET origin = excluded.origin, channel_id = excluded.channel_id, members = excluded.members, member_count = excluded.member_count, failed = excluded.failed, opened_by = excluded.opened_by, opened_at = excluded.opened_at, updated_at = excluded.updated_at",
    )
        .bind(state.origin, state.channel_id, JSON.stringify(state.members), state.member_count, JSON.stringify(state.failed), state.opened_by, state.opened_at, nowIso())
        .run();
}

async function existingChannel(config, channelId) {
    try {
        return await api(config, "GET", `/channels/${channelId}`);
    } catch (error) {
        if (error.status === 404) return null;
        throw error;
    }
}

function failureSummary(failed) {
    return failed.length ? `, ${failed.length} not added: ${failed.map((entry) => `${entry.handle} (${entry.reason})`).join("; ")}` : "";
}

export async function openAdminChat(env, actor) {
    const config = adminChatConfig(env);
    if (!config) return { error: "Set the ADMIN_CHAT_ORIGIN and ADMIN_CHAT_TOKEN secrets first" };
    const handles = await chatContacts(env);
    if (!handles.length) return { error: "No approved instance has announced admin contacts yet" };
    try {
        const me = await api(config, "GET", "/users/@me");
        const previous = await chatState(env);
        const channel = previous && previous.origin === config.origin ? await existingChannel(config, previous.channel_id) : null;
        const present = new Set((channel?.recipients ?? []).map((user) => user.id));
        const known = channel ? Object.fromEntries(Object.entries(previous.members).filter(([, id]) => present.has(id))) : {};
        const { resolved, failed } = await resolveHandles(
            config,
            handles.filter((handle) => !known[handle]),
        );
        const members = { ...known };
        const wanted = Object.entries(resolved).filter(([, id]) => id !== me.id);
        for (const [handle, id] of Object.entries(resolved)) if (id === me.id) members[handle] = id;
        let channelId = channel?.id;
        let memberCount;
        if (!channel) {
            if (wanted.length < 2) return await failOpen(env, actor, `A group DM needs at least two other people, ${wanted.length} resolved${failureSummary(failed)}`);
            const created = await api(config, "POST", "/users/@me/channels", { recipients: wanted.map(([, id]) => id), name: ADMIN_CHAT_NAME });
            channelId = created.id;
            const createdIds = new Set((created.recipients ?? []).map((user) => user.id));
            for (const [handle, id] of wanted) {
                if (createdIds.has(id)) members[handle] = id;
                else failed.push({ handle, reason: "left out of the new group DM" });
            }
            memberCount = createdIds.size + 1;
        } else {
            let added = 0;
            for (const [handle, id] of wanted) {
                if (present.has(id)) {
                    members[handle] = id;
                    continue;
                }
                try {
                    await api(config, "PUT", `/channels/${channelId}/recipients/${id}`);
                    members[handle] = id;
                    added++;
                } catch (error) {
                    failed.push({ handle, reason: error.message });
                }
            }
            memberCount = present.size + added + 1;
        }
        const reopened = Boolean(channel);
        await saveState(env, {
            origin: config.origin,
            channel_id: channelId,
            members,
            member_count: memberCount,
            failed,
            opened_by: reopened ? previous.opened_by : actor,
            opened_at: reopened ? previous.opened_at : nowIso(),
        });
        const message = `${reopened ? "updated" : "opened"} the admin group chat ${channelId} with ${memberCount} members${failureSummary(failed)}`;
        await logEvent(env, { kind: "admin-chat", level: failed.length ? "warn" : "info", actor, message });
        return { notice: `${reopened ? "Updated" : "Opened"} the admin group chat with ${memberCount} members${failed.length ? `, ${failed.length} could not be added` : ""}` };
    } catch (error) {
        return failOpen(env, actor, error.message);
    }
}

async function failOpen(env, actor, message) {
    await logEvent(env, { kind: "admin-chat", level: "error", actor, message: `opening the admin group chat failed: ${message}` });
    return { error: `Opening the admin group chat failed: ${message}` };
}

export async function closeAdminChat(env, actor) {
    const config = adminChatConfig(env);
    if (!config) return { error: "Set the ADMIN_CHAT_ORIGIN and ADMIN_CHAT_TOKEN secrets first" };
    const state = await chatState(env);
    if (!state) return { error: "The admin group chat isn't open" };
    try {
        if (state.origin !== config.origin) throw new Error(`the chat lives on ${state.origin}, but ADMIN_CHAT_ORIGIN is ${config.origin}`);
        const channel = await existingChannel(config, state.channel_id);
        if (channel) {
            const me = await api(config, "GET", "/users/@me");
            for (const user of channel.recipients ?? []) if (user.id !== me.id) await api(config, "DELETE", `/channels/${state.channel_id}/recipients/${user.id}`);
            await api(config, "DELETE", `/channels/${state.channel_id}`);
        }
        await env.DB.prepare("DELETE FROM admin_chat WHERE slot = 'current'").run();
        await logEvent(env, { kind: "admin-chat", actor, message: `closed the admin group chat ${state.channel_id}${channel ? "" : ", it was already gone"}` });
        return { notice: "Closed the admin group chat" };
    } catch (error) {
        await logEvent(env, { kind: "admin-chat", level: "error", actor, message: `closing the admin group chat failed: ${error.message}` });
        return { error: `Closing the admin group chat failed: ${error.message}` };
    }
}
