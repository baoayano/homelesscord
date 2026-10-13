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
            find: /function \i\((\i)\)\{let \i=\[\],\i=\[\],\i=\[\];for\(let \i of \1\)/,
            replacement: {
                match: /function \i\((\i)\)\{(?=let \i=\[\],\i=\[\],\i=\[\];for\(let \i of \1\))/,
                replace: "$&return $self.splitBadges($1);",
            },
        },
        {
            find: /function \i\(\i,\i\)\{let\{pendingBadgeDisplayOrder:\i,pendingBadgeHiddenBadges:\i\}=/,
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
                    match: /(return\(0,\i.jsxs\)\()\i\.\i(?=,\{index:\i,itemId:String\(\i.badge_id\),itemPreviewProps:\{badge:\i\},listType:\i,itemType:\i,)/,
                    replace: "$1$self.DraggableBadge",
                },
                {
                    match: /(let\{fixedBadges:\i,reorderableBadges:(\i),hiddenBadges:\i\}=\(0,\i\.\i\)\(\)[\s\S]{0,4000}?variant:"text-xs\/normal",color:"text-subtle",children:)\i\.intl\.string\(\i\)(?=\}\)\]\}\),)/,
                    replace: "$1$self.reorderHint($2.length)",
                },
                {
                    match: /\(0,\i\.\i\)\((\i),(\i),\{pendingBadgeDisplayOrder:(\i),pendingBadgeHiddenBadges:(\i)\}\)/,
                    replace: "$self.previewBadges($1,$2,{pendingBadgeDisplayOrder:$3,pendingBadgeHiddenBadges:$4})",
                },
                { match: /(role:"dialog",tabIndex:-1,)/, replace: '$1"data-fosscord-badge-customization":"",' },
                { match: /targetElementRef:\i&&!\i\?(\i):\i,position:"bottom",align:"left",spacing:4/, replace: 'targetElementRef:$1,position:"bottom",align:"left",spacing:4' },
                {
                    match: /function \i\(\i\)\{(?=let\{onClose:\i\}=\i;return\(0,\i\.jsxs\)\(\i\.\i,\{color:"nitro-pink")/,
                    replace: "$&return null;",
                },
            ],
        },
        {
            find: '"badge-details"',
            replacement: [
                {
                    match: /\i\.intl\.string\(\i\.t\["75s2Rq"\]\):\i\.intl\.string\(\i\.t\["62xU4E"\]\)/,
                    replace: '"Badges on this profile.":"Badges you own. Select one to view its details."',
                },
                {
                    match: /(!\i&&)(\i)\?\.owned===!0&&\(\2\.tiers\?\.length\?\?0\)>0&&null==\2\.next_tier/,
                    replace: "$1$2!=null&&$self.useMaxedDescription($2)&&$2?.owned===!0&&($2.tiers?.length??0)>0&&null==$2.next_tier",
                },
                { match: /\(0,\i\.\i\)\((\i).badge_id\)&&!\1.is_earnable&&\1.badge_id!==\i\.\i.STAFF/g, replace: "$self.isLegacy($1)" },
                { match: /(?=!\i\|\|(\i).is_earnable\|\|\i\|\|\1.badge_id===\i\.\i.STAFF\?null:)/, replace: "$1==null||!$self.isLegacy($1)||" },
                { match: /(return \i&&)!(\i).is_earnable&&/, replace: "$1$self.isLegacy($2)&&" },
                { match: /(\i=)\i\[(\i)\.badge_id\]/g, replace: "$1undefined" },
                { match: /\i\.intl\.string\(\i\.t#{intl::Ipxkog::raw}\)/g, replace: '"NITRO"' },
            ],
        },
        {
            find: "currentGlobalName:",
            replacement: { match: /(currentPronouns:\i\?\.pronouns\?\?""\},"pronouns"\),)/, replace: "$1$self.renderEntry()," },
        },
    ],
});
