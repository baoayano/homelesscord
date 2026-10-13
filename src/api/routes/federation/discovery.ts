/* SPDX-License-Identifier: AGPL-3.0-only */
import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { cachedDirectory } from "@spacebar/api/util/utility/federation";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({ description: "Other instances from the registry and the servers they list for global discovery, with icons through this instance's media proxy" }),
    async (req: Request, res: Response) => {
        res.set("Cache-Control", "private, max-age=30");
        res.json(await cachedDirectory());
    },
);

export default router;
