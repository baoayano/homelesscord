/* SPDX-License-Identifier: AGPL-3.0-only */
import { Rights } from "@spacebar/util";

export const STAFF_RIGHTS = [
    "OPERATOR",
    "MANAGE_USERS",
    "MANAGE_GUILDS",
    "MANAGE_MESSAGES",
    "BYPASS_RATE_LIMITS",
    "SEND_BACKDATED_EVENTS",
    "VIEW_SERVER_STATS",
    "RESEND_VERIFICATION_EMAIL",
    "CREATE_REGISTRATION_TOKENS",
] as const;

type RightsValue = string | bigint | number | null | undefined;

export const isProtectedStaffTarget = (actor: { id: string; rights: RightsValue }, target: { id: string; rights: RightsValue }) => {
    if (actor.id === target.id) return false;
    if (new Rights(BigInt(actor.rights ?? 0)).has("OPERATOR")) return false;
    const targetRights = new Rights(BigInt(target.rights ?? 0));
    return STAFF_RIGHTS.some((right) => targetRights.has(right));
};
