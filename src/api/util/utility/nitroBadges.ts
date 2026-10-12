/* SPDX-License-Identifier: AGPL-3.0-only */
import type { User } from "@spacebar/database";
import { UserFlags } from "@spacebar/schemas";

const NITRO_MILESTONES = [0, 1, 3, 6, 12, 24, 36, 60, 72] as const;

const anniversary = (since: Date, months: number) => {
    const result = new Date(since.getTime());
    result.setUTCDate(1);
    result.setUTCMonth(result.getUTCMonth() + months);
    const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
    result.setUTCDate(Math.min(since.getUTCDate(), lastDay));
    return result.getTime();
};

export const nitroBadge = (user: Pick<User, "created_at" | "bot" | "system" | "flags">, instanceName: string, now = new Date()) => {
    if (user.bot || user.system || (BigInt(user.flags ?? 0) & UserFlags.FLAGS.SYSTEM) !== 0n) return null;

    const since = new Date(user.created_at);
    const validSince = Number.isFinite(since.getTime()) && since.getTime() <= now.getTime();
    const months = validSince ? (NITRO_MILESTONES.findLast((milestone) => anniversary(since, milestone) <= now.getTime()) ?? 0) : 0;
    const id = `nitro_account_tenure_${months}_month`;
    const tenure = months ? `${months} ${months === 1 ? "month" : "months"}` : "New member";
    return {
        since: validSince ? since : null,
        badge: {
            id,
            description: `${instanceName} Nitro badge: ${tenure}${validSince ? ` • Member since ${since.toISOString().slice(0, 10)}` : ""}`,
            icon: months ? `premium_tenure_${months}_month_v2` : "2ba85e8026a8614b640c2837bcdfe21b",
        },
    };
};
