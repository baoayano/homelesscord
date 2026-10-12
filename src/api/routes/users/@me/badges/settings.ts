/* SPDX-License-Identifier: AGPL-3.0-only */
import { Router, type Request, type Response } from "express";
import { route } from "@spacebar/api/middlewares";
import { badgeSettings, loadBadgeCatalog, updateBadgeSettings } from "@spacebar/api/util/utility/badgeManagement";
import { User } from "@spacebar/database";
import { isSqlite } from "@spacebar/database/Sql";
import type { BadgeSettingsSchema } from "@spacebar/schemas";
import { broadcastUserUpdate } from "@spacebar/util";

const router = Router({ mergeParams: true });

router.patch("/", route({ requestBody: "BadgeSettingsSchema", responses: { 200: { body: "BadgeSettings" } } }), async (req: Request, res: Response) => {
    const result = await User.getRepository().manager.transaction(async (manager) => {
        await manager.findOneOrFail(User, { where: { id: req.user_id }, select: { id: true }, ...(isSqlite() ? {} : { lock: { mode: "pessimistic_write" } }) });
        const { user, catalog } = await loadBadgeCatalog(req.user_id, manager);
        const next = updateBadgeSettings(user, catalog, req.body as BadgeSettingsSchema);
        const changed = JSON.stringify(next) !== JSON.stringify(badgeSettings(user));
        if (changed) await manager.update(User, { id: req.user_id }, { badge_settings: next });
        return { settings: next, changed };
    });
    if (result.changed) await broadcastUserUpdate(req.user_id);
    res.json(result.settings);
});

export default router;
