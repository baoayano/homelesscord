/* SPDX-License-Identifier: AGPL-3.0-only */
import { Request, Response, Router } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { Guild } from "@spacebar/database";
import { AdminFederationGuildSchema } from "@spacebar/schemas";

const router = Router({ mergeParams: true });

router.patch(
    "/",
    route({
        right: "OPERATOR",
        spacebarOnly: true,
        requestBody: "AdminFederationGuildSchema",
        description: "Hide a server from other instances, or show it again. The owner's switch stays as it is.",
    }),
    async (req: Request, res: Response) => {
        const { hidden } = req.body as AdminFederationGuildSchema;
        const result = await Guild.update({ id: req.params.guild_id as string }, { global_discovery_hidden: hidden });
        if (!result.affected) throw new HTTPError("Unknown Guild", 404);
        res.json({ id: req.params.guild_id, hidden });
    },
);

export default router;
