/* SPDX-License-Identifier: AGPL-3.0-only */
import type { IncomingMessage } from "node:http";
import { Request } from "express";
import { FederationPeer } from "@spacebar/database";
import {
    Config,
    FederationKey,
    FederationRequestError,
    fetchPublicUrl,
    federationTrust,
    isPrivateInstanceId,
    NonceCache,
    parseWellKnown,
    signedRequestSender,
    signRequest,
    verifyRequest,
} from "@spacebar/util";
import { instanceId, liveDocument, localBlocks } from "./federation";
import { invalidateFederatedInstances } from "./federationMedia";

export const MAX_FEDERATION_BODY = 40 * 1024 * 1024;
const TRUST_TTL = 30_000;
const nonces = new NonceCache();
const trustCache = new Map<string, { at: number; value: Promise<{ public_key: string; source: "registry" | "peer" } | null> }>();

export const ownInstance = () => {
    const id = instanceId();
    if (!id || !FederationKey.ready) throw new FederationRequestError("not_configured", "This instance has no public address or federation key", 503);
    return id;
};

export const instanceBaseUrl = (id: string) =>
    id.endsWith(":80") || (isPrivateInstanceId(id) && Config.get().security.allowPrivateNetworkRequests) ? `http://${id.replace(/:80$/, "")}` : `https://${id}`;

const readJson = async (response: Response) => {
    const text = Buffer.from(await response.arrayBuffer()).toString("utf8");
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch {
        return { raw: text.slice(0, 2000) };
    }
};

const peerRecord = async (id: string) => {
    const row = (await FederationPeer.findOne({ where: { id } })) ?? FederationPeer.create({ id });
    if (row.public_key && row.well_known) return { public_key: row.public_key, protocol: Number(JSON.parse(row.well_known).protocol) || 0 };
    const response = await fetchPublicUrl(`${instanceBaseUrl(id)}/.well-known/meowcord`, { headers: { accept: "application/json" }, redirect: "error" }, 0, {
        maxBytes: 256 * 1024,
        timeoutMs: 10_000,
    });
    if (!response.ok) throw new Error(`${id} answered ${response.status} for its well-known document`);
    const wellKnown = parseWellKnown(await readJson(response), id);
    if (row.public_key && row.public_key !== wellKnown.public_key) throw new Error(`${id} serves a different key than the one first seen`);
    row.public_key = wellKnown.public_key;
    row.well_known = JSON.stringify(wellKnown);
    row.fetched_at = new Date();
    await row.save();
    return { public_key: wellKnown.public_key, protocol: wellKnown.protocol };
};

export const invalidateTrust = (id?: string) => {
    if (id) trustCache.delete(id);
    else trustCache.clear();
    invalidateFederatedInstances();
};

export const trustFor = (id: string) => {
    const cached = trustCache.get(id);
    if (cached && Date.now() - cached.at < TRUST_TTL) return cached.value;
    const value = (async () => {
        const { federation } = Config.get();
        const document = await liveDocument();
        const ownId = instanceId();
        const listed = document?.instances.some((instance) => instance.id === id);
        const peer =
            document && !listed && federation.allowUnlistedPeers && federation.peers.includes(id)
                ? await peerRecord(id).catch((error) => {
                      console.warn(`[Federation] Could not read the well-known document of ${id}:`, (error as Error).message);
                      return null;
                  })
                : null;
        const trust = federationTrust({
            id,
            ownId,
            enabled: federation.enabled,
            document,
            local: await localBlocks(),
            allowUnlistedPeers: federation.allowUnlistedPeers,
            peers: federation.peers,
            peerProtocol: peer?.protocol ?? null,
        });
        if (!trust) return null;
        if (trust.source === "peer") return peer ? { source: "peer" as const, public_key: peer.public_key } : null;
        return { source: "registry" as const, public_key: trust.public_key };
    })();
    trustCache.set(id, { at: Date.now(), value });
    value.catch(() => trustCache.delete(id));
    return value;
};

class Buckets {
    #buckets = new Map<string, { tokens: number; at: number }>();

    constructor(
        private capacity: number,
        private perSecond: number,
    ) {}

    take(key: string, now = Date.now()) {
        const bucket = this.#buckets.get(key) ?? { tokens: this.capacity, at: now };
        bucket.tokens = Math.min(this.capacity, bucket.tokens + ((now - bucket.at) / 1000) * this.perSecond);
        bucket.at = now;
        this.#buckets.set(key, bucket);
        if (bucket.tokens < 1) return false;
        bucket.tokens -= 1;
        return true;
    }
}

const inbound = new Buckets(600, 20);
const outbound = new Buckets(1200, 40);

export interface SignedResponse<T = unknown> {
    status: number;
    body: T;
}

export async function signedFetch<T = unknown>(instance: string, method: string, path: string, body?: unknown, timeoutMs = 20_000): Promise<SignedResponse<T>> {
    const own = ownInstance();
    const trust = await trustFor(instance);
    if (!trust) throw new FederationRequestError("not_federated", `This instance doesn't federate with ${instance}`, 403);
    if (!outbound.take(instance)) throw new FederationRequestError("rate_limited", `Too many requests to ${instance}`, 429);
    const url = new URL(path, instanceBaseUrl(instance));
    const signedPath = `${url.pathname}${url.search}`;
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body), "utf8");
    const headers = signRequest({ method, path: signedPath, target: instance, sender: own, body: payload ?? "", privateKey: FederationKey.privateKey });
    const response = await fetchPublicUrl(
        url.href,
        { method, headers: { ...headers, accept: "application/json", ...(payload && { "content-type": "application/json" }) }, body: payload, redirect: "error" },
        0,
        { maxBytes: MAX_FEDERATION_BODY, timeoutMs },
    );
    return { status: response.status, body: (await readJson(response)) as T };
}

export async function verifyInbound(req: Request) {
    const own = ownInstance();
    const sender = signedRequestSender(req.headers);
    const trust = await trustFor(sender);
    if (!trust) throw new FederationRequestError("not_federated", "This instance doesn't federate with the sender", 403);
    if (!inbound.take(sender)) throw new FederationRequestError("rate_limited", "Too many requests from this instance", 429);
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    verifyRequest({ method: req.method, path: req.originalUrl, target: own, headers: req.headers, body, publicKey: trust.public_key, nonces });
    return { sender, own, body };
}

export async function verifyUpgrade(req: IncomingMessage) {
    if (!Config.get().federation.enabled) throw new FederationRequestError("not_federated", "Federation is turned off on this instance", 403);
    const own = ownInstance();
    const sender = signedRequestSender(req.headers);
    const trust = await trustFor(sender);
    if (!trust) throw new FederationRequestError("not_federated", "This instance doesn't federate with the sender", 403);
    if (!inbound.take(sender)) throw new FederationRequestError("rate_limited", "Too many requests from this instance", 429);
    verifyRequest({ method: req.method ?? "GET", path: req.url ?? "/", target: own, headers: req.headers, body: Buffer.alloc(0), publicKey: trust.public_key, nonces });
    return sender;
}

export function signedUpgradeHeaders(instance: string, path: string) {
    return signRequest({ method: "GET", path, target: instance, sender: ownInstance(), body: Buffer.alloc(0), privateKey: FederationKey.privateKey });
}

export const inboundJson = (body: Buffer) => {
    if (!body.length) return {};
    try {
        const parsed = JSON.parse(body.toString("utf8"));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
        return parsed as Record<string, unknown>;
    } catch {
        throw new FederationRequestError("bad_request", "The body is not a JSON object", 400);
    }
};

export async function federationGate(req: Request, res: import("express").Response, next: import("express").NextFunction) {
    try {
        if (!Config.get().federation.enabled) throw new FederationRequestError("not_federated", "Federation is turned off on this instance", 403);
        const sender = signedRequestSender(req.headers);
        if (!(await trustFor(sender))) throw new FederationRequestError("not_federated", "This instance doesn't federate with the sender", 403);
        const limit = req.path.startsWith("/relay") ? MAX_FEDERATION_BODY : 4 * 1024 * 1024;
        if (Number(req.headers["content-length"] ?? 0) > limit) throw new FederationRequestError("too_large", "The body is too large", 413);
        next();
    } catch (error) {
        const { status, body } = federationError(error);
        res.status(status).json(body);
    }
}

export const federationHandler =
    (handler: (req: Request, sender: string, body: Record<string, unknown>) => Promise<{ status?: number; body: unknown }>) =>
    async (req: Request, res: import("express").Response) => {
        try {
            if (!Config.get().federation.enabled) throw new FederationRequestError("not_federated", "Federation is turned off on this instance", 403);
            const { sender, body } = await verifyInbound(req);
            const result = await handler(req, sender, req.method === "GET" ? {} : inboundJson(body));
            res.status(result.status ?? 200).json(result.body);
        } catch (error) {
            const { status, body } = federationError(error);
            res.status(status).json(body);
        }
    };

export const federationError = (error: unknown) => {
    if (error instanceof FederationRequestError) return { status: error.status, body: { code: error.code, error: error.message } };
    const status = (error as { httpStatus?: number; status?: number })?.httpStatus ?? (error as { status?: number })?.status;
    if (typeof status === "number" && status >= 400 && status < 600)
        return { status, body: { code: (error as { code?: unknown }).code ? String((error as { code?: unknown }).code) : "error", error: (error as Error).message } };
    console.error("[Federation] Request failed:", error);
    return { status: 500, body: { code: "internal", error: "Internal error" } };
};
