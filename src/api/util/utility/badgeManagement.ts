/* SPDX-License-Identifier: AGPL-3.0-only */
import { In, type EntityManager } from "typeorm";
import { Badge, User } from "@spacebar/database";
import type { BadgeDirectoryEntry, BadgeSettings, BadgeSettingsSchema, ProfileBadge } from "@spacebar/schemas";
import { Config, FieldErrors, getApexExperiments } from "@spacebar/util";
import { nitroBadge } from "./nitroBadges";
import { prideBadges, PRIDE_BADGES } from "./prideBadges";
import { isSubscriptionBadge } from "./profile";
import { STAFF_BADGE_ID } from "./staffBadge";

const MANAGEMENT_HASH = 3093904580;
const NITRO_MONTHS = [0, 1, 3, 6, 12, 24, 36, 60, 72];
const NITRO_TITLES = ["NITRO", "NITRO BRONZE", "NITRO SILVER", "NITRO GOLD", "NITRO PLATINUM", "NITRO DIAMOND", "NITRO EMERALD", "NITRO RUBY", "NITRO OPAL"];

export const badgeManagementVariant = (userId: string) =>
    getApexExperiments(userId).assignments[1]?.[userId]?.assignments.find((assignment) => assignment[0] === MANAGEMENT_HASH)?.[1] ?? 0;

export const badgeSettings = (user: Pick<User, "badge_settings">): BadgeSettings => ({
    display_order: user.badge_settings?.display_order ?? [],
    hidden_badges: user.badge_settings?.hidden_badges ?? [],
});

export function buildBadgeCatalog(user: User, assigned: ProfileBadge[], now = new Date()): BadgeDirectoryEntry[] {
    const { client, cdn } = Config.get();
    const image = (icon: string) => `${(cdn.endpointPublic ?? "").replace(/\/$/, "")}/badge-icons/${encodeURIComponent(icon)}.png`;
    const hidden = new Set(badgeSettings(user).hidden_badges);
    const tenureHideable = badgeManagementVariant(user.id) === 1;
    const entry = (badge: ProfileBadge, id: string | number, hideable: boolean, reorderable: boolean): BadgeDirectoryEntry => ({
        badge_id: id,
        legacy_id: badge.id,
        name: badge.description,
        description: badge.description,
        owned: true,
        hidden: hideable && hidden.has(String(id)),
        hideable,
        reorderable,
        is_earnable: false,
        simple_icon_url: image(badge.icon),
        simple_icon_raster_url: image(badge.icon),
        obtained_at: null,
        current_tier: "default",
        next_tier: null,
        tiers: [{ key: "default", name: badge.description, milestone_text: "", simple_icon_url: image(badge.icon), requirements: [] }],
        tier_obtained_at: {},
        progress: [],
        profile_badge: badge,
    });
    const byId = new Map(assigned.filter((badge) => !isSubscriptionBadge(badge)).map((badge) => [badge.id, badge]));
    const ordered = [...new Set(user.badge_ids ?? [])].flatMap((id) => {
        const badge = byId.get(id);
        return badge ? [badge] : [];
    });
    const result = ordered.map((badge) => entry(badge, badge.id === STAFF_BADGE_ID ? 22 : `custom:${badge.id}`, true, badge.id !== STAFF_BADGE_ID));
    result.push(...prideBadges(user.pride_badges).map((badge) => entry(badge, `pride:${PRIDE_BADGES.find((flag) => flag.id === badge.id)!.slug}`, false, true)));
    const nitro = nitroBadge(user, client.instanceName, now);
    if (nitro) {
        const badge = entry(nitro.badge, 1, tenureHideable, false);
        const months = Number(/^nitro_account_tenure_(\d+)_month$/.exec(nitro.badge.id)![1]);
        badge.name = NITRO_TITLES[NITRO_MONTHS.indexOf(months)];
        badge.obtained_at = nitro.since?.toISOString() ?? null;
        badge.current_tier = String(months);
        badge.next_tier = NITRO_MONTHS[NITRO_MONTHS.indexOf(months) + 1]?.toString() ?? null;
        badge.tiers = NITRO_MONTHS.map((months, index) => ({
            key: String(months),
            name: NITRO_TITLES[index],
            milestone_text: `${months} ${months === 1 ? "month" : "months"}`,
            simple_icon_url: image(months ? `premium_tenure_${months}_month_v2` : "2ba85e8026a8614b640c2837bcdfe21b"),
            requirements: [{ type: "months", threshold: months }],
        }));
        result.push(badge);
    }
    const rank = new Map(badgeSettings(user).display_order.map((id, index) => [id, index]));
    const priority = (badge: BadgeDirectoryEntry) => (badge.badge_id === 22 ? -2 : badge.badge_id === 1 ? -1 : (rank.get(String(badge.badge_id)) ?? Infinity));
    return result.sort((left, right) => priority(left) - priority(right));
}

export const visibleProfileBadges = (catalog: BadgeDirectoryEntry[]) => catalog.filter((badge) => !badge.hidden).map((badge) => badge.profile_badge);

export async function loadBadgeCatalog(userId: string, manager?: EntityManager) {
    if (!/^\d{1,20}$/.test(userId) || BigInt(userId) > 9223372036854775807n)
        throw FieldErrors({ user_id: { code: "BASE_TYPE_BAD_FORMAT", message: "User ID must be a valid snowflake." } });
    const user = await (manager ? manager.getRepository(User) : User.getRepository()).findOneOrFail({
        where: { id: userId },
        select: { id: true, bot: true, system: true, flags: true, created_at: true, registration_date: true, badge_ids: true, pride_badges: true, badge_settings: true },
    });
    const repository = manager ? manager.getRepository(Badge) : Badge.getRepository();
    const assigned = user.badge_ids?.length ? await repository.find({ where: { id: In(user.badge_ids) } }) : [];
    return { user, catalog: buildBadgeCatalog(user, assigned) };
}

export function updateBadgeSettings(user: User, catalog: BadgeDirectoryEntry[], body: BadgeSettingsSchema): BadgeSettings {
    const current = badgeSettings(user);
    const owned = new Map(catalog.map((badge) => [String(badge.badge_id), badge]));
    const read = (field: "display_order" | "hidden_badges") => {
        const value = body[field];
        if (value === undefined) return current[field].filter((id) => owned.has(id) && (field === "display_order" ? owned.get(id)!.reorderable : owned.get(id)!.hideable));
        if (!Array.isArray(value) || value.length > 512 || value.some((id) => typeof id !== "string" && typeof id !== "number"))
            throw FieldErrors({ [field]: { code: "BASE_TYPE_INVALID", message: "Provide up to 512 owned badge IDs." } });
        const ids = value.map(String);
        if (new Set(ids).size !== ids.length || ids.some((id) => !owned.has(id)))
            throw FieldErrors({ [field]: { code: "BASE_TYPE_INVALID", message: "Badge IDs must be unique and owned by this account." } });
        if (field === "hidden_badges" && ids.some((id) => !owned.get(id)!.hideable))
            throw FieldErrors({ [field]: { code: "BADGE_NOT_HIDEABLE", message: "This badge cannot be hidden." } });
        return ids.filter((id) => field !== "display_order" || owned.get(id)!.reorderable);
    };
    return { display_order: read("display_order"), hidden_badges: read("hidden_badges") };
}
