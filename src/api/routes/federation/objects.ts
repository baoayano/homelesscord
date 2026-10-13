/* SPDX-License-Identifier: AGPL-3.0-only */
import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { SNOWFLAKE } from "@spacebar/util";
import { canonicalIds } from "@spacebar/api/util/utility/federationIds";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        spacebarOnly: true,
        description: "Canonical @id@instance ids for local ids, at most 100",
        query: { ids: { type: "string", required: true, description: "Comma separated local ids" } },
    }),
    async (req: Request, res: Response) => {
        const ids = String(req.query.ids ?? "")
            .split(",")
            .map((id) => id.trim())
            .filter((id) => SNOWFLAKE.test(id))
            .slice(0, 100);
        res.json(Object.fromEntries(await canonicalIds(ids)));
    },
);

export default router;
