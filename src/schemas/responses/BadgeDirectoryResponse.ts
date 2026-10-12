/* SPDX-License-Identifier: AGPL-3.0-only */
import type { BadgeSettings, ProfileBadge } from "@spacebar/schemas";

export interface BadgeDirectoryEntry {
    badge_id: string | number;
    legacy_id: string;
    name: string;
    description: string;
    owned: boolean;
    hidden: boolean;
    hideable: boolean;
    reorderable: boolean;
    is_earnable: boolean;
    simple_icon_url: string;
    simple_icon_raster_url: string;
    obtained_at: string | null;
    current_tier: string;
    next_tier: string | null;
    tiers: {
        key: string;
        name: string;
        milestone_text: string;
        simple_icon_url: string;
        requirements: { type: string; threshold: number }[];
    }[];
    tier_obtained_at: Record<string, string>;
    progress: { type: string; current: number; threshold: number }[];
    profile_badge: ProfileBadge;
}

export interface BadgeDirectoryResponse {
    badges: BadgeDirectoryEntry[];
    settings?: BadgeSettings;
}
