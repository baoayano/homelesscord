/* SPDX-License-Identifier: AGPL-3.0-only */
import crypto from "node:crypto";
import { isIP } from "node:net";

export interface VoiceStateRequest {
    guild_id?: string | null;
    channel_id?: string | null;
    self_mute: boolean;
    self_deaf: boolean;
    self_video?: boolean;
}

export type VoiceStateApplier = (user_id: string, session_id: string, body: VoiceStateRequest) => Promise<Record<string, unknown> | null>;
export type VoiceStateRelay = (user_id: string, session_id: string, body: VoiceStateRequest) => Promise<boolean>;

const hooks: { apply?: VoiceStateApplier; relay?: VoiceStateRelay } = {};

export const FederatedVoice = {
    connected: new Set<string>(),
    setApplier(apply: VoiceStateApplier) {
        hooks.apply = apply;
    },
    setRelay(relay: VoiceStateRelay | undefined) {
        hooks.relay = relay;
    },
    get canApply() {
        return !!hooks.apply;
    },
    apply(user_id: string, session_id: string, body: VoiceStateRequest) {
        if (!hooks.apply) throw new Error("Voice states can only change in a process that runs the gateway");
        return hooks.apply(user_id, session_id, body);
    },
    relay(user_id: string, session_id: string, body: VoiceStateRequest) {
        return hooks.relay ? hooks.relay(user_id, session_id, body) : Promise.resolve(false);
    },
};

export const FEDERATED_VOICE_PATH = "/federated-voice";
export const HOST_VOICE_PATH = "/federation/v2/voice";

export const hostVoiceSession = (sessionId: string) => crypto.createHash("sha256").update(`meowcord-voice:${sessionId}`).digest("hex").slice(0, 32);

let generatedSecret: string | undefined;

export const turnSecret = () => process.env.TURN_SECRET || (generatedSecret ??= crypto.randomBytes(32).toString("base64url"));

export const turnSettings = (env: NodeJS.ProcessEnv = process.env) => {
    const port = env.TURN_PORT === undefined || env.TURN_PORT === "" ? 3478 : Number(env.TURN_PORT);
    const host = (env.TURN_PUBLIC_IP || env.WRTC_PUBLIC_IP || "127.0.0.1").trim();
    const ttl = env.TURN_CREDENTIAL_TTL ? Number(env.TURN_CREDENTIAL_TTL) : 12 * 60 * 60;
    const shared = !!env.TURN_SECRET || !!env.PION_SFU_BIN;
    const enabled = Number.isInteger(port) && port > 0 && port <= 65535 && shared && !!host;
    return { enabled, port, host, ttl: Number.isFinite(ttl) && ttl >= 60 ? Math.floor(ttl) : 12 * 60 * 60 };
};

export interface TurnCredentials {
    urls: string[];
    username: string;
    credential: string;
    expires_at: number;
}

export function turnCredentials(peer: string, options: { secret?: string; now?: number; env?: NodeJS.ProcessEnv } = {}): TurnCredentials | null {
    const settings = turnSettings(options.env);
    if (!settings.enabled || isIP(peer) !== 4) return null;
    const expires_at = Math.floor((options.now ?? Date.now()) / 1000) + settings.ttl;
    const username = `${expires_at}:${peer}:${crypto.randomBytes(6).toString("hex")}`;
    const credential = crypto
        .createHmac("sha1", options.secret ?? turnSecret())
        .update(username)
        .digest("base64");
    const host = isIP(settings.host) === 6 ? `[${settings.host}]` : settings.host;
    return { urls: [`turn:${host}:${settings.port}?transport=udp`, `turn:${host}:${settings.port}?transport=tcp`], username, credential, expires_at };
}
