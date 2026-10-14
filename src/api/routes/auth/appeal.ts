/* SPDX-License-Identifier: AGPL-3.0-only */
import bcrypt from "bcrypt";
import { Request, Response, Router } from "express";
import { APPEAL_MESSAGE_LIMIT, appealState, assertLoginNotLocked, clearFailedLogins, publicAppealState, recordFailedLogin, submitAppeal } from "@spacebar/api/util";
import { route } from "@spacebar/api/middlewares";
import { User } from "@spacebar/database";
import { FieldErrors } from "@spacebar/util";
import { AutomodAppealSchema } from "@spacebar/schemas";

const router: Router = Router({ mergeParams: true });

router.post(
    "/",
    route({
        requestBody: "AutomodAppealSchema",
        authentication: "never",
        spacebarOnly: true,
        description:
            "For an account that can't sign in because it is suspended, held for review or disabled. With the account's login and password it returns why, and with `message` it sends one appeal for the current restriction to the moderators' queue.",
    }),
    async (req: Request, res: Response) => {
        const { login, password, message } = req.body as AutomodAppealSchema;
        const invalid = () =>
            FieldErrors({
                login: { message: req.t("auth:login.INVALID_LOGIN"), code: "INVALID_LOGIN" },
                password: { message: req.t("auth:login.INVALID_LOGIN"), code: "INVALID_LOGIN" },
            });
        const user = await User.findOne({
            where: User.loginWhere(login),
            select: {
                id: true,
                data: true,
                username: true,
                join_status: true,
                suspended_until: true,
                disabled: true,
                flags: true,
                account_standing: true,
                federated_instance: true,
            },
        });
        if (!user || user.federated_instance) throw invalid();
        await assertLoginNotLocked(user.id);
        if (!(await bcrypt.compare(password, user.data.hash || ""))) {
            await recordFailedLogin(user.id);
            throw invalid();
        }
        await clearFailedLogins(user.id);

        const text = message?.trim();
        if (message !== undefined && !text) throw FieldErrors({ message: { code: "BASE_TYPE_REQUIRED", message: "Write a message for the moderators." } });
        if (!text) return res.json(publicAppealState(await appealState(user)));
        const { state, created } = await submitAppeal(user, text);
        if (state.restricted && !created && state.appeal && state.appeal.message !== text.slice(0, APPEAL_MESSAGE_LIMIT))
            throw FieldErrors({ message: { code: "APPEAL_ALREADY_SENT", message: "You already sent an appeal for this. A moderator will look at it." } });
        res.status(created ? 201 : 200).json(publicAppealState(state));
    },
);

export default router;
