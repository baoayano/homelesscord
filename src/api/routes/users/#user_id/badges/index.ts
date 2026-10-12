/* SPDX-License-Identifier: AGPL-3.0-only */
import { Router, type Request, type Response } from "express";
import { route } from "@spacebar/api/middlewares";
import { badgeSettings, loadBadgeCatalog } from "@spacebar/api/util/utility/badgeManagement";

const router = Router({ mergeParams: true });

router.get("/", route({ responses: { 200: { body: "BadgeDirectoryResponse" } } }), async (req: Request, res: Response) => {
    const id = req.params.user_id === "@me" ? req.user_id : String(req.params.user_id);
    const { user, catalog } = await loadBadgeCatalog(id);
    res.json(id === req.user_id ? { badges: catalog, settings: badgeSettings(user) } : { badges: catalog.filter((badge) => !badge.hidden) });
});

export default router;
