import type { IncomingMessage } from "node:http";
import { BlockList, isIP } from "node:net";

const NAMED_RANGES: Record<string, [string, number][]> = {
    loopback: [
        ["127.0.0.0", 8],
        ["::1", 128],
    ],
    linklocal: [
        ["169.254.0.0", 16],
        ["fe80::", 10],
    ],
    uniquelocal: [
        ["10.0.0.0", 8],
        ["172.16.0.0", 12],
        ["192.168.0.0", 16],
        ["fc00::", 7],
    ],
};

const trustCache = new Map<string, BlockList | true>();

const trustList = (trustedProxies: string | boolean | null | undefined): BlockList | true => {
    if (trustedProxies === true) return true;
    const spec = typeof trustedProxies === "string" && trustedProxies.trim() ? trustedProxies : "loopback, linklocal, uniquelocal";
    const cached = trustCache.get(spec);
    if (cached) return cached;
    const list = new BlockList();
    for (const entry of spec.split(",").map((part) => part.trim().toLowerCase())) {
        for (const [network, prefix] of NAMED_RANGES[entry] ?? []) list.addSubnet(network, prefix, isIP(network) === 6 ? "ipv6" : "ipv4");
        if (NAMED_RANGES[entry]) continue;
        const [network, prefix] = entry.split("/");
        const family = isIP(network);
        if (!family) continue;
        const type = family === 6 ? "ipv6" : "ipv4";
        if (prefix === undefined) list.addAddress(network, type);
        else list.addSubnet(network, Number(prefix), type);
    }
    trustCache.set(spec, list);
    return list;
};

const unmapped = (address: string) => (address.toLowerCase().startsWith("::ffff:") && isIP(address.slice(7)) === 4 ? address.slice(7) : address);

export const isTrustedProxy = (address: string | undefined | null, trustedProxies?: string | boolean | null) => {
    if (!address) return false;
    const list = trustList(trustedProxies);
    if (list === true) return true;
    const plain = unmapped(address);
    const family = isIP(plain);
    return family !== 0 && list.check(plain, family === 6 ? "ipv6" : "ipv4");
};

export const clientAddress = (request: IncomingMessage, forwardedFor: string | null, trustedProxies?: string | boolean | null) => {
    const peer = request.socket.remoteAddress;
    if (!forwardedFor || !isTrustedProxy(peer, trustedProxies)) return peer;
    const forwarded = request.headers[forwardedFor.toLowerCase()];
    const last = typeof forwarded === "string" ? forwarded.split(",").at(-1)?.trim() : undefined;
    return (last && isIP(unmapped(last)) ? last : undefined) || peer;
};
