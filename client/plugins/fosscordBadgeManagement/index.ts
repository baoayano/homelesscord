/* SPDX-License-Identifier: AGPL-3.0-only */
import definePlugin from "@utils/types";
import { FosscordAuthor } from "../fosscordCore/shared";
import * as bridge from "./bridge";
import managedStyle from "./style.css?managed";

export default definePlugin({
    name: "FosscordBadgeManagement",
    description: "Connects the native badge directory and customization controls to this instance's badge catalog.",
    authors: [FosscordAuthor],
    required: true,
    hidden: true,
    managedStyle,
    ...bridge,
    flux: { BADGE_DIRECTORY_FETCH_SUCCESS: bridge.rememberCatalog, LOGOUT: bridge.clear },
    patches: [
        {
            find: "staff_personal:",
            replacement: [
                {
                    match: /function \i\((\i)\)\{(?=let \i=\i\[\1\];if\(null!=\i\)return \i;)/,
                    replace: "$&if($self.managementId($1)!==undefined)return $self.managementId($1);",
                },
                {
                    match: /function \i\((\i)\)\{(?=return \i\.get\(\1\)\?\?\(0,\i\.\i\)\(\1\))/,
                    replace: "$&if($self.legacyId($1)!==undefined)return $self.legacyId($1);",
                },
            ],
        },
        {
            find: '"BadgeDirectoryStore"',
            replacement: [
                { match: /BADGE_DIRECTORY_FETCH_SUCCESS:function\((\i)\)\{/, replace: "$&$1.badges=$self.prepareCatalog($1.badges);" },
                { match: /\.filter\((\i)=>\1\.owned\)\.length/, replace: ".filter($1=>$1.owned&&!$1.hidden).length" },
            ],
        },
        {
            find: "fixedBadges:",
            replacement: {
                match: /function \i\((\i)\)\{(?=let \i=\[\],\i=\[\],\i=\[\];for\(let \i of \1\))/,
                replace: "$&return $self.splitBadges($1);",
            },
        },
        {
            find: "USER_PROFILE_SETTINGS_SET_PENDING_CHANGES",
            replacement: [
                {
                    match: /function \i\(\)\{(?=let \i=\i\.default\.getCurrentUser\(\)\?\.id;if\(null==\i\|\|!\i\.\i\.hasCatalogFor\(\i\)\)return null;)/,
                    replace: "$&return $self.currentPreferences();",
                },
                {
                    match: /function \i\((\i),(\i)\)\{(?=let\{pendingBadgeDisplayOrder:\i,pendingBadgeHiddenBadges:\i\}=\2,\i=null!=\i\?new Set\(\i\):null)/,
                    replace: "$&return $self.applyCatalog($1,$2);",
                },
            ],
        },
        {
            find: '"badge-customization-context"',
            replacement: [
                { match: /\i\.has\((\i)\.badge_id\)/, replace: "$1.hideable===false" },
                { match: /(subtext:\i\?)\i\.intl\.string\(\(0,\i\.\i\)\((\i)\.badge_id\)\)/, replace: "$1$self.hiddenReason($2)" },
            ],
        },
        {
            find: "UserProfileBadgeListRows",
            replacement: [
                {
                    match: /\(0,\i\.\i\)\((\i),(\i),\{pendingBadgeDisplayOrder:(\i),pendingBadgeHiddenBadges:(\i)\}\)/,
                    replace: "$self.previewBadges($1,$2,{pendingBadgeDisplayOrder:$3,pendingBadgeHiddenBadges:$4})",
                },
                { match: /Math\.max\(\i\.length-\i\.\i,0\)/, replace: "0" },
                { match: /\[(\i)\.slice\(0,\i\.\i\)\]/, replace: "[$1]" },
                { match: /(role:"dialog",tabIndex:-1,)/, replace: '$1"data-fosscord-badge-customization":"",' },
                {
                    match: /function \i\(\i\)\{(?=let\{onClose:\i\}=\i;return\(0,\i\.jsxs\)\(\i\.\i,\{color:"nitro-pink")/,
                    replace: "$&return null;",
                },
            ],
        },
        {
            find: '"badge-details"',
            replacement: [
                { match: /(\i=)\i\[(\i)\.badge_id\]/g, replace: "$1undefined" },
                { match: /\i\.intl\.string\(\i\.t#{intl::Ipxkog}\)/g, replace: '"NITRO"' },
            ],
        },
        {
            find: "currentGlobalName:",
            replacement: { match: /(currentPronouns:\i\?\.pronouns\?\?""\},"pronouns"\),)/, replace: "$1$self.renderEntry()," },
        },
    ],
});
