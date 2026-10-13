import { Request } from "express";
import { AuditLog, User } from "@spacebar/database";
import { Rights } from "@spacebar/util";
import { HTTPError } from "lambert-server/HTTPError";
import { AuditLogEvents } from "@spacebar/schemas";
import { EntityManager } from "typeorm";
import { assertShadowUserEditable } from "../utility/federatedAdmin";

export const ADMIN_USER_CUSTOMIZATION_ACTION = AuditLogEvents.ADMIN_USER_CUSTOMIZATION;
export async function adminCustomizationTarget(req: Request, editing?: string) {
    const user = await User.findOneOrFail({
        where: { id: req.params.user_id as string },
        select: { id: true, rights: true, bot: true, federated_instance: true },
    });
    if (new Rights(user.rights).has("OPERATOR") && !req.rights.has("OPERATOR") && user.id !== req.user_id) throw new HTTPError("Only operators can edit other operators", 403);
    if (editing) assertShadowUserEditable(user, [editing]);
    return user;
}
export async function recordAdminCustomization(req: Request, target_id: string, section: string, fields: string[], manager?: EntityManager) {
    const reason = req.headers["x-audit-log-reason"];
    const entry = AuditLog.create({
        user_id: req.user_id,
        target_id,
        action_type: ADMIN_USER_CUSTOMIZATION_ACTION,
        options: { type: section },
        changes: AuditLog.diff({}, { fields }, ["fields"]),
        reason: typeof reason === "string" ? reason.slice(0, 512) : undefined,
    });
    return manager ? manager.save(entry) : entry.save();
}
