/* SPDX-License-Identifier: AGPL-3.0-only */
import { findStoreLazy, filters, mapMangledModuleLazy } from "@webpack";
import { RestAPI, UserStore } from "@webpack/common";

import { Button, SettingsSection } from "../fosscordCore/ui";
import { applyCatalog, BadgeRegistry, CatalogBadge, previewBadges, splitBadges } from "./model";

const registry = new BadgeRegistry();
const DirectoryStore = findStoreLazy("BadgeDirectoryStore") as { getBadges(id?: string): CatalogBadge[] };
const Directory = mapMangledModuleLazy('"badge-directory-modal"', { open: filters.byCode('"badge-directory-modal"') });
const Artwork = mapMangledModuleLazy(".PREMIUM_TENURE_72_MONTH]:{standard:", {
    get: filters.byCode(/^function [\w$]+\(([\w$]+)\)\{return [\w$]+\[\1\]\}$/),
});

export { applyCatalog, previewBadges, splitBadges };
export const managementId = (id: string) => registry.managementId(id);
export const legacyId = (id: string | number) => registry.legacyId(id);
export const hiddenReason = (badge: CatalogBadge) => (String(badge.badge_id).startsWith("pride:") ? "Pride badges remain visible." : "This Nitro badge remains visible.");

export function rememberCatalog({ badges }: { badges: CatalogBadge[] }) {
    registry.remember(badges);
}

export function prepareCatalog(badges: CatalogBadge[]) {
    registry.remember(badges);
    return badges.map((badge) => {
        if (badge.badge_id !== 1) return badge;
        const tiers = badge.tiers.map((tier) => ({
            ...tier,
            complex_icon_static_url: tier.key === "0" ? tier.simple_icon_url : (Artwork.get(`premium_tenure_${tier.key}_month_v2`)?.standard ?? tier.simple_icon_url),
        }));
        return { ...badge, name: "NITRO", tiers, complex_icon_static_url: tiers.find((tier) => tier.key === badge.current_tier)?.complex_icon_static_url };
    });
}

export function currentPreferences() {
    const catalog = DirectoryStore.getBadges(UserStore.getCurrentUser()?.id);
    if (!catalog.length) return null;
    return {
        displayOrder: catalog.filter((badge) => badge.owned && !badge.hidden && badge.reorderable).map((badge) => badge.badge_id),
        hiddenBadges: new Set(catalog.filter((badge) => badge.owned && badge.hidden && badge.hideable).map((badge) => badge.badge_id)),
    };
}

export function renderEntry() {
    return (
        <SettingsSection title="Your badges" description="Browse your badges and customize their order and visibility.">
            <Button variant="secondary" onClick={() => Directory.open({ viewingCurrentUserBadges: true })}>
                View Badges
            </Button>
        </SettingsSection>
    );
}

export async function start() {
    try {
        const { body } = await RestAPI.get({ url: "/auth/pride-badges" });
        for (const badge of body.badges) registry.remember([{ legacy_id: badge.id, badge_id: `pride:${badge.slug}` } as CatalogBadge]);
    } catch {}
}

export function clear() {
    registry.clear();
}
