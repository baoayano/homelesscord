/* SPDX-License-Identifier: AGPL-3.0-only */
export interface BadgeSettings {
    display_order: string[];
    hidden_badges: string[];
}

export class BadgeSettingsSchema {
    display_order?: (string | number)[];
    hidden_badges?: (string | number)[];
}
