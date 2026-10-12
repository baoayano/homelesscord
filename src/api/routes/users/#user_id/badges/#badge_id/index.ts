/* SPDX-License-Identifier: AGPL-3.0-only */
import { Router, type Request, type Response } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { loadBadgeCatalog } from "@spacebar/api/util/utility/badgeManagement";

const router = Router({ mergeParams: true });

router.get("/", route({ responses: { 200: { body: "BadgeDirectoryEntry" } } }), async (req: Request, res: Response) => {
    const id = req.params.user_id === "@me" ? req.user_id : String(req.params.user_id);
    const { catalog } = await loadBadgeCatalog(id);
    const badge = catalog.find((badge) => String(badge.badge_id) === req.params.badge_id && (id === req.user_id || !badge.hidden));
    if (!badge) throw new HTTPError("Unknown badge", 404);
    res.json(badge);
});

export default router;
