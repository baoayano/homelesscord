/* SPDX-License-Identifier: AGPL-3.0-only */
import definePlugin from "@utils/types";

import { FosscordAuthor } from "../fosscordCore/shared";
import { isNitroBadge, renderNitroBadge } from "./tooltip";

export default definePlugin({
    name: "FosscordNitroBadges",
    description: "Shows native Nitro badge cards for free instance badges using their configured registration date.",
    authors: [FosscordAuthor],
    required: true,
    hidden: true,
    isNitroBadge,
    renderNitroBadge,
    patches: [
        {
            find: "UserProfileBadgeListRows",
            replacement: {
                match: /(?=if\(\i\)return\(0,\i\.jsx\)\(\i,\{shouldShow:!\i,legacyBadgeId:(\i)\.id,[\s\S]{0,650}?\(0,\i\.jsx\)\(\i\.Anchor,\{[^{}]*?children:(\i)\}\)\})/,
                replace: "if($self.isNitroBadge($1))return $self.renderNitroBadge($1,$2);",
            },
        },
    ],
});
