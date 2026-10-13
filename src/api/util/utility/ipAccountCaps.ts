/* SPDX-License-Identifier: AGPL-3.0-only */
import { In, Like, MoreThan } from "typeorm";
import { Session, User } from "@spacebar/database";
import { Config, FieldErrors, Rights } from "@spacebar/util";
import { IpGroup, ipGroup, ipRangeMatcher } from "@spacebar/util/util/IpGroups";
import { ipVariants } from "./accountIps";
import { recordAutomodAction } from "./instanceAutomod";
import { logRestrictionOnce } from "./spamGuard";

const DAY = 24 * 60 * 60 * 1000;
const CANDIDATE_LIMIT = 5000;

let allowCache: { source: string; matches: (ip: unknown) => boolean } | null = null;

export function isIpCapExempt(ip: unknown) {
    const list = Config.get().automod.ipAllowList ?? [];
    const source = list.join("\n");
    if (allowCache?.source !== source) allowCache = { source, matches: ipRangeMatcher(list) };
    return allowCache.matches(ip);
}

const ipWhere = (group: IpGroup) => (group.family === 4 ? In(ipVariants(group.ip)) : Like(group.pattern));
const inGroup = (group: IpGroup, value: string | null | undefined) => ipGroup(value)?.key === group.key;
const isOperator = (rights: string | null | undefined) => new Rights(rights ?? "0").has("OPERATOR", false);

export async function accountsRegisteredFrom(group: IpGroup) {
    const users = await User.find({
        where: { registration_ip: ipWhere(group), deleted: false, disabled: false },
        select: { id: true, rights: true, registration_ip: true },
        take: CANDIDATE_LIMIT,
    });
    return users.filter((user) => inGroup(group, user.registration_ip) && !isOperator(user.rights)).map((user) => user.id);
}

export async function accountsSignedInFrom(group: IpGroup, activeDays: number) {
    const since = new Date(Date.now() - Math.max(1, activeDays) * DAY);
    const sessions = await Session.find({
        where: [
            { last_seen_ip: ipWhere(group), last_seen: MoreThan(since) },
            { last_seen_ip: ipWhere(group), created_at: MoreThan(since) },
        ],
        select: { session_id: true, user_id: true, last_seen_ip: true },
        take: CANDIDATE_LIMIT,
    });
    const ids = [...new Set(sessions.filter((session) => inGroup(group, session.last_seen_ip)).map((session) => session.user_id))];
    if (!ids.length) return [];
    const users = await User.find({ where: { id: In(ids), deleted: false, disabled: false }, select: { id: true, rights: true } });
    return users.filter((user) => !isOperator(user.rights)).map((user) => user.id);
}

async function logRefusal(kind: "registration" | "login", group: IpGroup, count: number, max: number, user?: { id?: string; username?: string | null }) {
    if (!logRestrictionOnce(`ip-cap:${kind}:${group.key}:${user?.id ?? user?.username ?? ""}`, 10 * 60 * 1000)) return;
    await recordAutomodAction({
        user_id: user?.id ?? null,
        username: user?.username?.slice(0, 64) ?? null,
        rule: "ip_account_limit",
        term: `${count} account${count === 1 ? "" : "s"} on ${group.key}, limit ${max}`,
        source: kind,
        action: "block",
    }).catch(() => undefined);
}

export async function assertRegistrationIpCap(ip: string | undefined, username?: string) {
    const max = Config.get().automod.registration.maxAccountsPerIp;
    if (!max || max < 1) return;
    const group = ipGroup(ip);
    if (!group || isIpCapExempt(group.ip)) return;
    const accounts = await accountsRegisteredFrom(group);
    if (accounts.length < max) return;
    await logRefusal("registration", group, accounts.length, max, { username });
    const message = `This network already has ${max === 1 ? "an account" : `${max} accounts`} on this instance, which is the limit. Ask a moderator if you need another one.`;
    throw FieldErrors({ username: { code: "TOO_MANY_ACCOUNTS_ON_IP", message }, email: { code: "TOO_MANY_ACCOUNTS_ON_IP", message } });
}

export async function assertLoginIpCap(ip: string | undefined, user: { id: string; rights?: string | null; username?: string | null }) {
    const { maxAccountsPerIp: max, sessionActiveDays } = Config.get().automod.login;
    if (!max || max < 1 || isOperator(user.rights)) return;
    const group = ipGroup(ip);
    if (!group || isIpCapExempt(group.ip)) return;
    const others = (await accountsSignedInFrom(group, sessionActiveDays)).filter((id) => id !== user.id);
    if (others.length < max) return;
    await logRefusal("login", group, others.length, max, user);
    const message = `${max === 1 ? "Another account is" : `${max} other accounts are`} already signed in from this network, which is the limit on this instance. Sign out of one of them first.`;
    throw FieldErrors({ login: { code: "TOO_MANY_ACCOUNTS_ON_IP", message }, password: { code: "TOO_MANY_ACCOUNTS_ON_IP", message } });
}
