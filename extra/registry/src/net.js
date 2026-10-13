const privateSuffixes = [".localhost", ".local", ".internal", ".intranet", ".lan", ".home", ".corp", ".private", ".arpa", ".test", ".invalid", ".example", ".onion", ".alt"];
const labelPattern = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

export function allowsPrivateHosts(env) {
    return env?.ALLOW_PRIVATE_HOSTS === "1" || env?.ALLOW_PRIVATE_HOSTS === "true";
}

export function isIpLiteral(host) {
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":") || host.startsWith("[");
}

export function isPrivateName(host) {
    if (host === "localhost" || !host.includes(".")) return true;
    return privateSuffixes.some((suffix) => host.endsWith(suffix));
}

export function parseInstanceId(value, { allowPrivate = false } = {}) {
    if (typeof value !== "string" || value.length > 253) return null;
    const match = /^([a-z0-9.-]+)(?::(\d{1,5}))?$/.exec(value);
    if (!match) return null;
    const [, host, portText] = match;
    if (portText !== undefined && (portText === "443" || /^0/.test(portText) || Number(portText) > 65535)) return null;
    const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
    if (!isIp && !host.split(".").every((label) => labelPattern.test(label))) return null;
    const local = isIp || isPrivateName(host);
    if (local && !allowPrivate) return null;
    const scheme = local && allowPrivate ? "http" : "https";
    return { id: value, host, port: portText ? Number(portText) : null, origin: `${scheme}://${value}` };
}

export function instanceIdFromUrl(urlText, options) {
    let url;
    try {
        url = new URL(urlText);
    } catch {
        return null;
    }
    if (url.protocol !== "https:" && !(options?.allowPrivate && url.protocol === "http:")) return null;
    if (url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    const id = url.port && url.port !== "443" ? `${host}:${url.port}` : host;
    return parseInstanceId(id, options);
}

export function sameOriginUrl(urlText, origin) {
    if (typeof urlText !== "string" || urlText.length > 2048) return null;
    try {
        const url = new URL(urlText);
        return url.origin === new URL(origin).origin ? url.toString() : null;
    } catch {
        return null;
    }
}

export function httpUrl(urlText) {
    if (typeof urlText !== "string" || !urlText || urlText.length > 2048) return null;
    try {
        const url = new URL(urlText);
        if (url.protocol !== "https:" && url.protocol !== "http:") return null;
        if (url.username || url.password) return null;
        return url.toString();
    } catch {
        return null;
    }
}

function ipv4IsPrivate(address) {
    const parts = address.split(".").map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
    const [a, b] = parts;
    return (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        a >= 224 ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 0) ||
        (a === 192 && b === 168) ||
        (a === 198 && (b === 18 || b === 19))
    );
}

export function isPrivateAddress(address) {
    if (!address.includes(":")) return ipv4IsPrivate(address);
    const lower = address.toLowerCase();
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(lower);
    if (mapped) return ipv4IsPrivate(mapped[1]);
    if (lower === "::" || lower === "::1") return true;
    const first = Number.parseInt(lower.split(":")[0] || "0", 16);
    return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00 || lower.startsWith("64:ff9b:") || lower.startsWith("2001:db8:");
}

const resolved = new Map();

async function resolvesPublicly(host) {
    const cached = resolved.get(host);
    if (cached && cached > Date.now()) return;
    const answers = await Promise.all(
        ["A", "AAAA"].map(async (type) => {
            const response = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`, {
                headers: { accept: "application/dns-json" },
                signal: AbortSignal.timeout(4000),
            });
            if (!response.ok) throw new Error(`DNS lookup failed with HTTP ${response.status}`);
            const body = await response.json();
            return (body.Answer ?? []).filter((answer) => answer.type === 1 || answer.type === 28).map((answer) => answer.data);
        }),
    );
    const addresses = answers.flat();
    if (addresses.length === 0) throw new Error(`${host} has no A or AAAA record`);
    const blocked = addresses.find(isPrivateAddress);
    if (blocked) throw new Error(`${host} resolves to a private address`);
    resolved.set(host, Date.now() + 5 * 60 * 1000);
}

export async function fetchJson(urlText, { env, maxBytes = 65536, timeoutMs = 8000 } = {}) {
    const url = new URL(urlText);
    const allowPrivate = allowsPrivateHosts(env);
    const host = url.hostname.toLowerCase();
    if (!allowPrivate) {
        if (url.protocol !== "https:") throw new Error("only https URLs are fetched");
        if (isIpLiteral(host) || isPrivateName(host)) throw new Error("refusing a private host");
        await resolvesPublicly(host);
    }
    const response = await fetch(url, {
        redirect: "manual",
        headers: { accept: "application/json", "user-agent": "meowcord-registry/1" },
        signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        throw new Error(`HTTP ${response.status} redirect, the registry does not follow redirects`);
    }
    if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`HTTP ${response.status}`);
    }
    const declared = Number(response.headers.get("content-length"));
    if (declared > maxBytes) {
        await response.body?.cancel();
        throw new Error(`response is larger than ${maxBytes} bytes`);
    }
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
            await reader.cancel();
            throw new Error(`response is larger than ${maxBytes} bytes`);
        }
        chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    try {
        return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
        throw new Error("response is not JSON");
    }
}
