/* SPDX-License-Identifier: AGPL-3.0-only */
import { In } from "typeorm";
import { FederatedObject, User } from "@spacebar/database";
import { PublicUserProjection } from "@spacebar/schemas";
import {
    collectIncomingIds,
    collectOutgoingIds,
    JSONReplacer,
    parseCanonicalId,
    remoteHandle,
    rewriteIncoming,
    rewriteOutgoing,
    Snowflake,
    SNOWFLAKE,
    stripHandle,
} from "@spacebar/util";
import { rewriteRemoteMedia } from "./federationMedia";
import { ownInstance } from "./federationNetwork";

const CACHE_LIMIT = 50_000;
const toCanonicalCache = new Map<string, string>();
const toLocalCache = new Map<string, string>();

const remember = (canonical: string, local: string) => {
    if (toCanonicalCache.size > CACHE_LIMIT) toCanonicalCache.clear();
    if (toLocalCache.size > CACHE_LIMIT) toLocalCache.clear();
    toCanonicalCache.set(local, canonical);
    toLocalCache.set(canonical, local);
};

export const forgetMappings = (localIds: string[]) => {
    for (const id of localIds) {
        const canonical = toCanonicalCache.get(id);
        toCanonicalCache.delete(id);
        if (canonical) toLocalCache.delete(canonical);
    }
};

export const normalize = <T>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value, JSONReplacer)));

export async function canonicalIds(localIds: Iterable<string>) {
    const own = ownInstance();
    const result = new Map<string, string>();
    const missing: string[] = [];
    for (const id of new Set(localIds)) {
        if (!SNOWFLAKE.test(id)) continue;
        const cached = toCanonicalCache.get(id);
        if (cached) result.set(id, cached);
        else missing.push(id);
    }
    for (let offset = 0; offset < missing.length; offset += 500) {
        const rows = await FederatedObject.find({ where: { local_id: In(missing.slice(offset, offset + 500)) } });
        for (const row of rows) {
            remember(row.canonical, row.local_id);
            result.set(row.local_id, row.canonical);
        }
    }
    for (const id of missing) if (!result.has(id)) result.set(id, `@${id}@${own}`);
    return result;
}

export const canonicalOf = async (localId: string) => (await canonicalIds([localId])).get(localId) ?? `@${localId}@${ownInstance()}`;

export async function localIds(canonicals: Iterable<string>, options: { create?: boolean; sender?: string } = {}) {
    const own = ownInstance();
    const result = new Map<string, string>();
    const missing: string[] = [];
    for (const canonical of new Set(canonicals)) {
        const parsed = parseCanonicalId(canonical);
        if (!parsed) continue;
        if (parsed.instance === own) {
            result.set(canonical, parsed.id);
            continue;
        }
        const cached = toLocalCache.get(canonical);
        if (cached) result.set(canonical, cached);
        else missing.push(canonical);
    }
    for (let offset = 0; offset < missing.length; offset += 500) {
        const rows = await FederatedObject.find({ where: { canonical: In(missing.slice(offset, offset + 500)) } });
        for (const row of rows) {
            remember(row.canonical, row.local_id);
            result.set(row.canonical, row.local_id);
        }
    }
    if (options.create === false) return result;
    for (const canonical of missing) {
        if (result.has(canonical)) continue;
        const parsed = parseCanonicalId(canonical)!;
        const timestamp = SNOWFLAKE.test(parsed.id) ? Snowflake.timestampOf(parsed.id) : Date.now();
        for (let attempt = 0; attempt < 5 && !result.has(canonical); attempt++) {
            const local_id = Snowflake.generateAt(timestamp);
            try {
                await FederatedObject.insert({ canonical, local_id, instance: parsed.instance, created_at: new Date() });
                remember(canonical, local_id);
                result.set(canonical, local_id);
            } catch {
                const existing = await FederatedObject.findOne({ where: { canonical } });
                if (existing) {
                    remember(existing.canonical, existing.local_id);
                    result.set(canonical, existing.local_id);
                }
            }
        }
    }
    return result;
}

export const localOf = async (canonical: string, create = true) => (await localIds([canonical], { create })).get(canonical) ?? null;

export async function toWire<T>(value: T): Promise<T> {
    const own = ownInstance();
    const normalized = normalize(value);
    const map = await canonicalIds(collectOutgoingIds(normalized));
    return rewriteOutgoing(normalized, map, own, (user, original) => {
        const parsed = parseCanonicalId(map.get(original));
        if (parsed && parsed.instance !== own && typeof user.username === "string") user.username = stripHandle(user.username, parsed.instance);
    });
}

export interface WireUser {
    local_id: string;
    canonical: string;
    instance: string;
    object: Record<string, unknown>;
}

export async function fromWire<T>(value: T, sender: string, onUsers?: (users: WireUser[]) => Promise<void>): Promise<T> {
    const own = ownInstance();
    const normalized = normalize(value);
    const map = await localIds(collectIncomingIds(normalized), { sender });
    const remote: WireUser[] = [];
    const local: Record<string, unknown>[] = [];
    const result = rewriteIncoming(normalized, map, own, (user, original) => {
        const parsed = parseCanonicalId(original);
        if (!parsed || typeof user.id !== "string") return;
        if (parsed.instance === own) local.push(user);
        else {
            user.username = remoteHandle(String(user.username), parsed.instance);
            user.discriminator = "0";
            remote.push({ local_id: user.id, canonical: original, instance: parsed.instance, object: user });
        }
    });
    if (local.length) {
        const rows = await User.find({
            where: { id: In([...new Set(local.map((user) => user.id as string))]) },
            select: Object.fromEntries(PublicUserProjection.map((key) => [key, true])),
        });
        const byId = new Map(rows.map((row) => [row.id, row.toPublicUser()]));
        for (const user of local) {
            const row = byId.get(user.id as string);
            if (row) Object.assign(user, normalize(row));
        }
    }
    if (remote.length && onUsers) await onUsers(remote);
    return rewriteRemoteMedia(result, sender);
}
