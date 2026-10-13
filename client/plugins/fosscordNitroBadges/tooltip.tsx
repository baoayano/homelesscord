/* SPDX-License-Identifier: AGPL-3.0-only */
import type { ButtonHTMLAttributes, ReactElement } from "react";
import { filters, mapMangledModuleLazy } from "@webpack";
import { React } from "@webpack/common";

type Badge = { id: string; icon: string; description: string };

const NativeTooltip = mapMangledModuleLazy('"mini-premium-tooltip"', {
    MiniTooltip: filters.byCode('"mini-premium-tooltip"'),
});
const NativeArtwork = mapMangledModuleLazy(".PREMIUM_TENURE_72_MONTH]:{standard:", {
    getArtwork: filters.byCode(/^function [\w$]+\(([\w$]+)\)\{return [\w$]+\[\1\]\}$/),
});

const TIERS: Record<string, string> = {
    "0": "NITRO",
    "1": "NITRO BRONZE",
    "3": "NITRO SILVER",
    "6": "NITRO GOLD",
    "12": "NITRO PLATINUM",
    "24": "NITRO DIAMOND",
    "36": "NITRO EMERALD",
    "60": "NITRO RUBY",
    "72": "NITRO OPAL",
};

export const nitroTier = (badge: Badge) => {
    const months = /^nitro_account_tenure_(\d+)_month$/.exec(badge.id)?.[1];
    return months && TIERS[months] ? { months, title: TIERS[months] } : null;
};

export const isNitroBadge = (badge: Badge) => nitroTier(badge) !== null;

export const nitroTooltipBody = (badge: Badge) => {
    const day = / • Nitro since (\d{4}-\d{2}-\d{2})$/.exec(badge.description)?.[1];
    if (!day) return "New member";
    const date = new Date(`${day}T00:00:00Z`);
    if (!Number.isFinite(date.getTime())) return "New member";
    return `Nitro since ${new Intl.DateTimeFormat(navigator.language, { dateStyle: "short", timeZone: "UTC" }).format(date)}`;
};

export function renderNitroBadge(badge: Badge, image: ReactElement<{ src: string }>, triggerProps: ButtonHTMLAttributes<HTMLButtonElement> = {}) {
    const tier = nitroTier(badge);
    if (!tier) return null;
    const artwork = tier.months === "0" ? image.props.src : (NativeArtwork.getArtwork(`premium_tenure_${tier.months}_month_v2`)?.standard ?? image.props.src);
    return React.createElement(
        NativeTooltip.MiniTooltip,
        { key: badge.id, title: tier.title, body: nitroTooltipBody(badge), variant: "nitro", badgeImage: artwork, badgeName: tier.title },
        <button
            {...triggerProps}
            type="button"
            tabIndex={0}
            aria-label={badge.description}
            style={{ ...triggerProps.style, display: "inline-flex", background: "none", border: 0, padding: 0, cursor: "pointer" }}
            onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                triggerProps.onClick?.(event);
            }}
        >
            {image}
        </button>,
    );
}
