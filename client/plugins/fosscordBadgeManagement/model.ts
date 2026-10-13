/* SPDX-License-Identifier: AGPL-3.0-only */
export type BadgeId = string | number;
export type ProfileBadge = { id: string; icon: string; description: string; iconSrc?: string };
export type CatalogBadge = {
    badge_id: BadgeId;
    legacy_id: string;
    name: string;
    owned: boolean;
    hidden: boolean;
    hideable: boolean;
    reorderable: boolean;
    simple_icon_url: string;
    complex_icon_static_url?: string;
    current_tier: string | null;
    is_legacy: boolean;
    tiers: { key: string; name: string; simple_icon_url: string; complex_icon_static_url?: string }[];
    profile_badge: ProfileBadge;
};
export type Pending = { pendingBadgeDisplayOrder?: BadgeId[]; pendingBadgeHiddenBadges?: BadgeId[] };

export function nitroProgressContext<T extends { badge: CatalogBadge; viewerBadge?: CatalogBadge; isViewingOtherUser?: boolean }>(props: T): T {
    return props.badge.badge_id === 1 && props.isViewingOtherUser ? { ...props, viewerBadge: undefined, isViewingOtherUser: false } : props;
}

export function reorderHint(count: number): string {
    if (count === 0) return "Show or select badges to arrange them on your profile.";
    if (count === 1) return "Show or select another badge to change the order.";
    return "Drag badges to reorder. Use More options to hide eligible badges.";
}

export function applyCatalog(catalog: CatalogBadge[], pending: Pending): CatalogBadge[] {
    const hidden = pending.pendingBadgeHiddenBadges && new Set(pending.pendingBadgeHiddenBadges.map(String));
    const order = pending.pendingBadgeDisplayOrder;
    const ranks = order && new Map(order.map((id, index) => [String(id), index]));
    const priority = (badge: CatalogBadge) => ranks?.get(String(badge.badge_id)) ?? (badge.badge_id === 22 ? -2 : badge.badge_id === 1 ? -1 : Infinity);
    const updated = catalog.map((badge) => ({ ...badge, hidden: badge.hideable && (hidden ? hidden.has(String(badge.badge_id)) : badge.hidden) }));
    return ranks ? updated.sort((left, right) => priority(left) - priority(right)) : updated;
}

export function splitBadges(catalog: CatalogBadge[]) {
    return {
        fixedBadges: catalog.filter((badge) => badge.owned && !badge.hidden && !badge.reorderable),
        reorderableBadges: catalog.filter((badge) => badge.owned && !badge.hidden && badge.reorderable),
        hiddenBadges: catalog.filter((badge) => badge.owned && badge.hidden && badge.hideable),
    };
}

export function previewBadges(existing: ProfileBadge[], catalog: CatalogBadge[], pending: Pending): ProfileBadge[] {
    if (!catalog.length || (pending.pendingBadgeDisplayOrder === undefined && pending.pendingBadgeHiddenBadges === undefined)) return existing;
    const known = new Set(catalog.map((badge) => badge.legacy_id));
    return [
        ...applyCatalog(catalog, pending)
            .filter((badge) => badge.owned && !badge.hidden)
            .map((badge) => ({ ...badge.profile_badge, iconSrc: badge.simple_icon_url })),
        ...existing.filter((badge) => !known.has(badge.id)),
    ];
}

export class BadgeRegistry {
    private forward = new Map<string, BadgeId>();
    private reverse = new Map<BadgeId, string>();

    remember(catalog: CatalogBadge[]) {
        for (const badge of catalog) {
            this.forward.set(badge.legacy_id, badge.badge_id);
            this.reverse.set(badge.badge_id, badge.legacy_id);
        }
    }

    managementId(id: string): BadgeId | undefined {
        if (id === "1" || /^staff-role-\d{1,20}$/.test(id)) return 22;
        if (/^nitro_account_tenure_(?:0|1|3|6|12|24|36|60|72)_month$/.test(id)) return 1;
        return this.forward.get(id) ?? (/^\d+$/.test(id) ? `custom:${id}` : undefined);
    }

    legacyId(id: BadgeId): string | undefined {
        if (id === 22) return this.reverse.get(id) ?? "1";
        if (typeof id === "string" && id.startsWith("custom:")) return id.slice(7);
        return this.reverse.get(id);
    }

    clear() {
        this.forward.clear();
        this.reverse.clear();
    }
}
