/* SPDX-License-Identifier: AGPL-3.0-only */
import { Guild, Member, User } from "@spacebar/database";
import { ApiError, FederationRequestError, isInstanceId } from "@spacebar/util";
import { fromWire } from "./federationIds";
import { emitGuildCreate, serialized, upsertMirrorGuild, upsertMirrorMember } from "./federationMirrors";
import { ownInstance, signedFetch, trustFor } from "./federationNetwork";
import { relayToHost } from "./federationRelay";
import { profileOf, upsertShadows } from "./federationShadows";
import { applyRemoteVoiceState } from "./federationVoice";

type Raw = Record<string, unknown>;

const PROFILE_SELECT = {
    id: true,
    username: true,
    global_name: true,
    avatar: true,
    avatar_decoration_data: true,
    banner: true,
    accent_color: true,
    pronouns: true,
    bio: true,
    public_flags: true,
} as const;

async function assertRemote(instance: string, code: string) {
    if (!isInstanceId(instance) || instance === ownInstance()) throw new ApiError("Unknown instance", 10_000, 404);
    if (!/^[A-Za-z0-9-]{1,64}$/.test(code)) throw new ApiError("Unknown Invite", 10_006, 404);
    if (!(await trustFor(instance))) throw new ApiError("This instance doesn't federate with that one", 50_001, 403);
}

export async function previewRemoteInvite(user_id: string, instance: string, code: string) {
    await assertRemote(instance, code);
    const user = await User.findOneOrFail({ where: { id: user_id }, select: PROFILE_SELECT });
    const response = await relayToHost(instance, user, "GET", `/invites/${encodeURIComponent(code)}`);
    return { status: response.status, body: response.body };
}

export async function joinRemoteInvite(user_id: string, instance: string, code: string) {
    await assertRemote(instance, code);
    const user = await User.findOneOrFail({ where: { id: user_id }, select: PROFILE_SELECT });
    const response = await signedFetch<Raw>(instance, "POST", "/federation/v2/join", { actor: `@${user_id}@${ownInstance()}`, code, profile: profileOf(user) }, 30_000);
    if (response.status !== 200) {
        const body = (response.body ?? {}) as Raw;
        if (typeof body.code === "string" && typeof body.error === "string")
            throw new FederationRequestError(body.code, body.error, response.status === 401 ? 502 : response.status);
        return { status: response.status, body: await fromWire(response.body, instance, upsertShadows) };
    }
    const data = (await fromWire(response.body, instance, upsertShadows)) as { invite?: Raw; snapshot?: { guild: Raw; members?: Raw[]; member?: Raw } | null; pending?: boolean };
    if (!data.snapshot) return { status: 200, body: { ...(data.invite ?? {}), new_member: true } };
    const snapshot = data.snapshot;
    const guild_id = await serialized(`guild:${String(snapshot.guild.id)}`, async () => {
        const id = await upsertMirrorGuild(snapshot.guild, instance);
        if (!id) throw new ApiError("That server clashes with an object on this instance", 0, 409);
        for (const member of snapshot.members ?? []) await upsertMirrorMember(member, id);
        if (snapshot.member) await upsertMirrorMember(snapshot.member, id);
        if (!(await Member.exists({ where: { id: user_id, guild_id: id } }))) await upsertMirrorMember({ user: { id: user_id }, roles: [] }, id);
        for (const state of Array.isArray(snapshot.guild.voice_states) ? snapshot.guild.voice_states : [])
            if (state && typeof state === "object") await applyRemoteVoiceState(state as Raw, id, false);
        const count = Number(snapshot.guild.member_count);
        if (Number.isSafeInteger(count)) await Guild.update({ id }, { member_count: count });
        return id;
    });
    await emitGuildCreate(guild_id, user_id);
    return { status: 200, body: { ...(data.invite ?? {}), guild_id, new_member: true } };
}
