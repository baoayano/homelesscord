/* SPDX-License-Identifier: AGPL-3.0-only */
import type { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { Button } from "@components/Button";
import { FormSwitch } from "@components/FormSwitch";
import definePlugin from "@utils/types";
import { findByPropsLazy, findLazy, findStoreLazy } from "@webpack";
import { GuildStore, Menu, NavigationRouter, RestAPI, showToast, Text, UserStore, useEffect, useState } from "@webpack/common";
import type { UIEvent } from "react";

import { FosscordAuthor } from "../fosscordCore/shared";
import { ensureGuild, joinRemote, UNLOADED_MESSAGE } from "./join";
import {
    addRemoteFriend,
    chatInviteKey,
    guildInstance,
    instanceName,
    inviteEndpoint,
    isHandle,
    joinInviteKey,
    keepInviteKey,
    loadGuildInstances,
    loadInstances,
    nameOf,
    noteInviteError,
    queueGuild,
    rememberGuild,
    remoteError,
    remoteKey,
    userInstance,
} from "./remote";
import managedStyle from "./style.css?managed";

const TAB = "fosscord-other-instances";
const SECTION = "FOSSCORD_OTHER_INSTANCES";
const GuildSettingsStore = findStoreLazy("GuildSettingsStore") as { getGuildId(): string | null };
const GatewayConnectionStore = findStoreLazy("GatewayConnectionStore") as {
    getSocket(): { dispatcher?: { receiveDispatch(data: unknown, type: string, compression?: unknown): void } } | null;
};
const SERVERS = "servers";

type FieldStore<T> = { getState(): T; setState(state: Partial<T>): void; resetState(): void; useField<K extends keyof T>(key: K): T[K] };
type ServersState = { selectedTab: string | null };
const stateHas = (store: { getState?: unknown } | null | undefined, keys: string[]) => {
    if (typeof store?.getState !== "function") return false;
    try {
        const state = (store.getState as () => unknown)();
        return !!state && typeof state === "object" && keys.every((key) => key in state);
    } catch {
        return false;
    }
};
const ServersTabStore = findLazy(
    (m) => typeof m?.useField === "function" && stateHas(m, ["selectedTab", "isSearchVisible", "searchBarState", "entrypoint"]),
) as FieldStore<ServersState>;
const ServersQueryStore = findLazy((m) => typeof m?.useField === "function" && stateHas(m, ["fetchedQuery", "resultsQuery", "categoryId"])) as FieldStore<object>;
const GlobalDiscovery = findByPropsLazy("transitionToGlobalDiscovery") as { transitionToGlobalDiscovery(options: { tab: string; selectedServersTab?: string }): void };

type Registration = "open" | "invite" | "approval" | "closed";
type RemoteInstance = { id: string; name: string; description: string; icon_url: string | null; url: string; registration: Registration; state: string };
type RemoteGuild = { id: string; instance: string; instance_name: string; name: string; description: string; icon_url: string | null; member_count: number; invite_url: string };
type Directory = { available: false; reason: string } | { available: true; verification: "registry" | "instance"; instances: RemoteInstance[]; guilds: RemoteGuild[] };
type FederatedVoiceIds = { daveId(userId: string): string; localId(daveId: string): string; daveGroup(channelId: bigint): bigint };
type DaveSession = {
    Init(version: number, groupId: bigint, userId: string, key: unknown): unknown;
    ProcessProposals(proposals: unknown, userIds: string[]): unknown;
    ProcessWelcome(welcome: unknown, userIds: string[]): unknown;
    ProcessCommit(commit: unknown): unknown;
    GetKeyRatchet(userId: string): unknown;
    GetPairwiseFingerprint(version: number, userId: string, ...rest: unknown[]): unknown;
};
type OwnerState = {
    enabled: boolean;
    hidden: boolean;
    status: "off" | "hidden" | "no_invite" | "unverified" | "pending" | "verified" | "blocked" | "unknown";
    canonical_id: string | null;
    invite_url: string | null;
    federation_enabled: boolean;
    registry_live: boolean;
};

const number = new Intl.NumberFormat();
const REGISTRATION: Record<Registration, string> = {
    open: "Open signups",
    invite: "Invite only",
    approval: "Signups need approval",
    closed: "Signups closed",
};
const STATUS: Record<OwnerState["status"], string> = {
    off: "Only people on this instance can find this server in Discovery.",
    hidden: "This instance's admins hid this server from other instances. Ask them if you think that's a mistake.",
    no_invite: "This server needs a text channel before it can show on other instances.",
    unverified: "Waiting for this instance's admins to verify it. Once they do, people on other instances can find it in Discovery.",
    pending: "Verified by this instance's admins. Other instances show it once the registry picks it up, within an hour.",
    verified: "Listed. People on other instances can find this server in Discovery.",
    blocked: "The registry blocked this server, so other instances don't show it.",
    unknown: "This instance hasn't reached the federation registry yet, so other instances can't see this server for now.",
};

function Initials({ name, className }: { name: string; className: string }) {
    const letters = name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((word) => [...word][0])
        .join("");
    return (
        <span className={`${className} fosscord-federation-initials`} aria-hidden="true">
            {letters || "?"}
        </span>
    );
}

function Icon({ src, name, className }: { src: string | null; name: string; className: string }) {
    const [state, setState] = useState<"loading" | "loaded" | "failed">("loading");
    return (
        <span className={`${className} fosscord-federation-icon`}>
            <Initials name={name} className="fosscord-federation-icon-fill" />
            {src && state !== "failed" && (
                <img
                    className="fosscord-federation-icon-fill"
                    data-loaded={state === "loaded"}
                    src={src}
                    alt=""
                    loading="lazy"
                    onLoad={() => setState("loaded")}
                    onError={() => setState("failed")}
                />
            )}
        </span>
    );
}

function inviteCode(inviteUrl: string) {
    try {
        return new URL(inviteUrl).pathname.split("/").filter(Boolean).pop() ?? null;
    } catch {
        return null;
    }
}

function receiveGuild(guild: Record<string, unknown>) {
    const dispatcher = GatewayConnectionStore.getSocket()?.dispatcher;
    if (!dispatcher) throw new Error("The gateway isn't connected");
    dispatcher.receiveDispatch(structuredClone(guild), "GUILD_CREATE");
}

const hasGuild = (guildId: string) => !!GuildStore.getGuild(guildId);

function GuildCard({ guild }: { guild: RemoteGuild }) {
    const [joining, setJoining] = useState(false);
    const [notice, setNotice] = useState<{ text: string; failed: boolean } | null>(null);
    const noticeId = `fosscord-federation-join-error-${guild.id}`;

    const join = async () => {
        const code = inviteCode(guild.invite_url);
        if (!code) return setNotice({ text: "This server's invite link is broken. Open it on its instance instead.", failed: true });
        setJoining(true);
        setNotice(null);
        const result = await joinRemote({
            post: (timeout) => RestAPI.post({ url: inviteEndpoint(remoteKey(guild.instance, code)), body: {}, timeout }),
            hasGuild,
            receiveGuild,
            navigate: (guildId, channelId) => {
                rememberGuild(guildId, guild.instance.toLowerCase());
                NavigationRouter.transitionTo(`/channels/${guildId}${channelId ? `/${channelId}` : ""}`);
            },
        });
        setJoining(false);
        if (result.kind !== "opened") setNotice({ text: result.message, failed: result.kind !== "pending" });
    };

    return (
        <div className="fosscord-federation-card fosscord-federation-guild">
            <div className="fosscord-federation-guild-head">
                <Icon src={guild.icon_url} name={guild.name} className="fosscord-federation-guild-icon" />
                <span className="fosscord-federation-instance-tag" title={guild.instance}>
                    {guild.instance_name}
                </span>
            </div>
            <Text variant="heading-md/semibold" color="text-strong" className="fosscord-federation-title">
                {guild.name}
            </Text>
            {guild.description && (
                <Text variant="text-sm/normal" color="text-default" className="fosscord-federation-description">
                    {guild.description}
                </Text>
            )}
            <div className="fosscord-federation-meta">
                <span className="fosscord-federation-dot" aria-hidden="true" />
                <Text variant="text-xs/normal" color="text-muted" className="fosscord-federation-number">
                    {number.format(guild.member_count)} {guild.member_count === 1 ? "member" : "members"}
                </Text>
            </div>
            <div className="fosscord-federation-actions">
                <Button size="small" variant="primary" onClick={join} disabled={joining} aria-describedby={notice ? noticeId : undefined}>
                    {joining ? "Joining…" : "Join"}
                </Button>
                <a
                    className="fosscord-federation-open"
                    href={guild.invite_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Open the invite to ${guild.name} on ${guild.instance_name} in a new tab`}
                >
                    Open on its instance
                </a>
            </div>
            {notice && (
                <Text variant="text-sm/normal" color={notice.failed ? "text-feedback-critical" : "text-default"} role={notice.failed ? "alert" : "status"} id={noticeId}>
                    {notice.text}
                </Text>
            )}
        </div>
    );
}

function GlobeIcon() {
    return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z" />
        </svg>
    );
}

function openOtherInstances() {
    ServersQueryStore.resetState();
    ServersTabStore.resetState();
    GlobalDiscovery.transitionToGlobalDiscovery({ tab: SERVERS, selectedServersTab: TAB });
}

function useSidebarTab(tab: string, selectedTab: string | null) {
    const serversTab = ServersTabStore.useField("selectedTab");
    const onOtherInstances = selectedTab === SERVERS && serversTab === TAB;
    if (tab === TAB) return { selected: onOtherInstances, onClick: () => openOtherInstances };
    const leaving = tab === SERVERS && onOtherInstances;
    return {
        selected: selectedTab === tab && !leaving,
        onClick: (original: () => void) =>
            leaving
                ? () => {
                      ServersTabStore.setState({ selectedTab: null });
                      original();
                  }
                : original,
    };
}

function InstanceTag({ instance }: { instance: string }) {
    return (
        <span className="fosscord-federation-user-tag" title={`From ${nameOf(instance)}, another instance`}>
            {instance}
        </span>
    );
}

const GLOBE_BADGE = `data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#9aa3b5" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z"/></svg>',
)}`;

const hostedOn: NavContextMenuPatchCallback = (children, props?: { guild?: { id?: string } }) => {
    const instance = guildInstance(props?.guild);
    if (!instance) return;
    children.unshift(
        <Menu.MenuGroup key="fosscord-federation-host">
            <Menu.MenuItem
                id="fosscord-federation-host"
                label={`Hosted on ${nameOf(instance)}`}
                subtext={nameOf(instance) === instance ? undefined : instance}
                action={() => {}}
                disabled
            />
        </Menu.MenuGroup>,
    );
};

function InstanceCard({ instance }: { instance: RemoteInstance }) {
    return (
        <a
            className="fosscord-federation-card fosscord-federation-instance"
            href={instance.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${instance.name} in a new tab`}
        >
            <Icon src={instance.icon_url} name={instance.name} className="fosscord-federation-instance-icon" />
            <div className="fosscord-federation-instance-text">
                <Text variant="text-md/semibold" color="text-strong" className="fosscord-federation-ellipsis">
                    {instance.name}
                </Text>
                <Text variant="text-xs/normal" color="text-muted" className="fosscord-federation-ellipsis">
                    {instance.id} · {REGISTRATION[instance.registration]}
                </Text>
                {instance.description && (
                    <Text variant="text-sm/normal" color="text-default" className="fosscord-federation-description">
                        {instance.description}
                    </Text>
                )}
            </div>
        </a>
    );
}

function OtherInstances({ onScroll }: { onScroll?: (event: UIEvent<HTMLDivElement>) => void }) {
    const [directory, setDirectory] = useState<Directory | null>(null);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        let active = true;
        RestAPI.get({ url: "/federation/discovery" })
            .then((res: { body: Directory }) => active && setDirectory(res.body))
            .catch(() => active && setFailed(true));
        return () => {
            active = false;
        };
    }, []);

    const empty = (title: string, body: string) => (
        <div className="fosscord-federation-empty" role="status">
            <Text variant="heading-md/semibold" color="text-strong">
                {title}
            </Text>
            <Text variant="text-sm/normal" color="text-muted">
                {body}
            </Text>
        </div>
    );

    return (
        <div className="fosscord-federation-page" onScroll={onScroll}>
            <header className="fosscord-federation-hero">
                <Text variant="heading-xl/semibold" color="text-strong" tag="h2">
                    Other instances
                </Text>
                <Text variant="text-md/normal" color="text-default" className="fosscord-federation-lede">
                    {`Servers and communities on other approved instances. Join one to add it to your server list here on ${instanceName()}, with this account.`}
                </Text>
            </header>
            {failed ? (
                empty("Couldn't load other instances", "Check your connection and open this tab again.")
            ) : !directory ? (
                <div className="fosscord-federation-loading" role="status" aria-label="Loading other instances" />
            ) : !directory.available ? (
                empty(
                    directory.reason === "disabled" ? "This instance doesn't connect to other instances" : "Other instances aren't available right now",
                    directory.reason === "disabled"
                        ? "Its admins turned federation off."
                        : "This instance hasn't got a current list from the registry. It checks again every 5 minutes.",
                )
            ) : (
                <>
                    <section className="fosscord-federation-section" aria-labelledby="fosscord-federation-servers">
                        <Text variant="heading-lg/semibold" color="text-strong" tag="h3" id="fosscord-federation-servers">
                            Servers
                        </Text>
                        {directory.guilds.length ? (
                            <div className="fosscord-federation-grid">
                                {directory.guilds.map((guild) => (
                                    <GuildCard key={guild.id} guild={guild} />
                                ))}
                            </div>
                        ) : (
                            empty(
                                "No servers yet",
                                directory.verification === "instance"
                                    ? "This instance's admins haven't verified any servers from other instances yet."
                                    : "No server on another instance has been verified for global discovery yet.",
                            )
                        )}
                    </section>
                    <section className="fosscord-federation-section" aria-labelledby="fosscord-federation-instances">
                        <Text variant="heading-lg/semibold" color="text-strong" tag="h3" id="fosscord-federation-instances">
                            Instances
                        </Text>
                        {directory.instances.length ? (
                            <div className="fosscord-federation-list">
                                {directory.instances.map((instance) => (
                                    <InstanceCard key={instance.id} instance={instance} />
                                ))}
                            </div>
                        ) : (
                            empty("No other instances yet", "Approved instances show up here as the registry lists them.")
                        )}
                    </section>
                </>
            )}
        </div>
    );
}

function OwnerSettings() {
    const guildId = GuildSettingsStore.getGuildId();
    const [state, setState] = useState<OwnerState | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
        if (!guildId) return;
        RestAPI.get({ url: `/guilds/${guildId}/global-discovery` })
            .then((res: { body: OwnerState }) => setState(res.body))
            .catch((err: { body?: { message?: string } }) => setError(err?.body?.message ?? "Couldn't load this setting."));
    }, [guildId]);

    const change = async (enabled: boolean) => {
        if (!guildId) return;
        setSaving(true);
        setError(null);
        try {
            const res = await RestAPI.patch({ url: `/guilds/${guildId}/global-discovery`, body: { enabled } });
            setState(res.body);
            showToast(enabled ? "This server can now show on other instances" : "This server no longer shows on other instances", "success");
        } catch (err) {
            setError((err as { body?: { message?: string } })?.body?.message ?? "Couldn't save. Try again.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fosscord-federation-settings">
            <Text variant="heading-lg/semibold" color="text-strong" tag="h2">
                Other instances
            </Text>
            <Text variant="text-sm/normal" color="text-muted" className="fosscord-federation-lede">
                Let people on other approved instances find this server in their Discovery. They join through a permanent invite link, which is created for you if the server
                doesn't have one.
            </Text>
            {state && (
                <>
                    <FormSwitch
                        title="Show on other instances"
                        description="Lists this server's name, icon, description and member count on other instances after verification."
                        value={state.enabled}
                        disabled={saving || !state.federation_enabled}
                        onChange={change}
                    />
                    <div className="fosscord-federation-status" role="status">
                        <Text variant="text-sm/medium" color="text-default">
                            {!state.federation_enabled ? "This instance's admins turned federation off." : STATUS[state.status]}
                        </Text>
                        {state.enabled && state.invite_url && (
                            <div className="fosscord-federation-invite">
                                <Text variant="text-xs/normal" color="text-muted">
                                    Invite link people from other instances use
                                </Text>
                                <div className="fosscord-federation-invite-row">
                                    <span className="fosscord-federation-link">{state.invite_url}</span>
                                    <Button
                                        size="small"
                                        variant="secondary"
                                        onClick={() => navigator.clipboard.writeText(state.invite_url as string).then(() => showToast("Invite link copied", "success"))}
                                    >
                                        Copy link
                                    </Button>
                                </div>
                            </div>
                        )}
                    </div>
                </>
            )}
            {error && (
                <Text variant="text-sm/normal" color="text-feedback-critical" role="alert">
                    {error}
                </Text>
            )}
        </div>
    );
}

export default definePlugin({
    name: "FosscordFederation",
    description:
        "Adds Other instances to Discover with servers you can join from here, the Show on other instances switch for owners, invites and friend requests across instances, and tags for remote users and servers.",
    authors: [FosscordAuthor],
    required: true,
    managedStyle,

    inviteEndpoint,
    joinInviteKey,
    chatInviteKey,
    keepInviteKey,
    noteInviteError,
    remoteError,
    isHandle,
    addRemoteFriend,

    start() {
        if (UserStore.getCurrentUser()) {
            loadInstances();
            loadGuildInstances(Object.keys(GuildStore.getGuilds()));
        }
    },

    flux: {
        CONNECTION_OPEN() {
            loadInstances();
            loadGuildInstances(Object.keys(GuildStore.getGuilds()));
        },
        INVITE_ACCEPT_SUCCESS({ invite }: { invite?: { guild_id?: string; meowcord_guild?: { id?: unknown } & Record<string, unknown> } }) {
            const guildId = invite?.guild_id;
            if (!guildId || !invite?.meowcord_guild) return;
            ensureGuild(guildId, invite.meowcord_guild, { hasGuild, receiveGuild }).then((loaded) => {
                if (!loaded) showToast(UNLOADED_MESSAGE, "failure");
            });
        },
        GUILD_CREATE({ guild }: { guild?: { id?: string; federated_instance?: string | null } }) {
            if (!guild?.id) return;
            if (guild.federated_instance) rememberGuild(guild.id, guild.federated_instance.toLowerCase());
            else queueGuild(guild.id);
        },
    },

    contextMenus: {
        "guild-context": hostedOn,
        "guild-header-popout": hostedOn,
    },

    userProfileBadge: {
        id: "fosscord-federation-instance",
        key: "fosscord-federation-instance",
        getBadges: ({ userId }: { userId: string }) => {
            const instance = userInstance(UserStore.getUser(userId));
            if (!instance) return [];
            return [{ id: "fosscord-federation-instance", key: "fosscord-federation-instance", description: `From ${nameOf(instance)}, another instance`, iconSrc: GLOBE_BADGE }];
        },
    },

    renderMessageDecoration: ({ message, author }: { message: { author?: { username?: string } }; author?: { nick?: string } }) => {
        const instance = userInstance(message.author);
        return instance && !author?.nick?.includes("@") ? <InstanceTag instance={instance} /> : null;
    },

    renderMemberListDecorator: ({ user }: { user?: { username?: string; globalName?: string | null } }) => {
        const instance = userInstance(user);
        return instance && user?.globalName ? <InstanceTag instance={instance} /> : null;
    },

    daveSession<T extends object>(session: T): T {
        const voice = (window as Window & { FosscordFederatedVoice?: FederatedVoiceIds }).FosscordFederatedVoice;
        if (!voice) return session;
        const target = session as unknown as DaveSession;
        const ids = (userIds: string[]) => userIds.map((id) => voice.daveId(id));
        const roster = (value: unknown) =>
            value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([daveId, key]) => [voice.localId(daveId), key])) : value;
        const mapped: Partial<DaveSession> = {
            Init: (version, groupId, userId, key) => target.Init(version, voice.daveGroup(groupId), userId, key),
            ProcessProposals: (proposals, userIds) => target.ProcessProposals(proposals, ids(userIds)),
            ProcessWelcome: (welcome, userIds) => roster(target.ProcessWelcome(welcome, ids(userIds))),
            ProcessCommit: (commit) => {
                const result = target.ProcessCommit(commit) as { rosterUpdate?: unknown } | null | undefined;
                return result?.rosterUpdate ? { ...result, rosterUpdate: roster(result.rosterUpdate) } : result;
            },
            GetKeyRatchet: (userId) => target.GetKeyRatchet(voice.daveId(userId)),
            GetPairwiseFingerprint: (version, userId, ...rest) => target.GetPairwiseFingerprint(version, voice.daveId(userId), ...rest),
        };
        return new Proxy(session, {
            get(object, key) {
                if (key in mapped) return mapped[key as keyof DaveSession];
                const value = Reflect.get(object, key);
                return typeof value === "function" ? value.bind(object) : value;
            },
        });
    },

    tabs: () => [{ id: TAB, label: "Other instances" }],
    sidebarTab: TAB,
    useSidebarTab,
    sidebarLabel: (tab: string) => (tab === TAB ? "Other instances" : null),
    renderSidebarIcon: () => <GlobeIcon />,
    renderOtherInstances: (props: { onScroll?: (event: UIEvent<HTMLDivElement>) => void }) => <OtherInstances {...props} />,
    settingsSection: (props: { isOwner?: boolean }) => ({
        section: SECTION,
        label: "Other instances",
        ariaLabel: "Other instances",
        element: OwnerSettings,
        predicate: () => !!props.isOwner,
    }),

    patches: [
        {
            find: "[getGlobalDiscoveryServerTabTitle] Unsupported tab",
            replacement: {
                match: /case (\i)\.\i\.HUBS:return \1\.(\i);(?=default:)/,
                replace: `$&case"${TAB}":return $1.$2;`,
            },
        },
        {
            find: "[getSectionHeight] Failed for section",
            replacement: [
                {
                    match: /(\]\.map\((\i)=>\(\{id:\2,label:\(0,\i\.\i\)\(\2\)\}\)\))/,
                    replace: "$1.concat($self.tabs())",
                },
                {
                    match: /(case \i\.\i\.HUBS:return\(0,\i\.jsx\)\(\i,\{onScroll:(\i)\}\);?)(default:)/,
                    replace: `$1case"${TAB}":return $self.renderOtherInstances({onScroll:$2});$3`,
                },
            ],
        },
        {
            find: ".DISCOVERY_QUEST_TAB_CLICKED,{",
            replacement: [
                {
                    match: /(case \i\.GlobalDiscoveryTab\.QUESTS:return\(0,\i\.jsx\)\(\i\.\i,\{color:"currentColor"\}\))(\}\}\)\(\i\),\[\i\]\))/,
                    replace: "$1;case $self.sidebarTab:return $self.renderSidebarIcon()$2",
                },
                {
                    match: /(\i\.useMemo\(\(\)=>)(\(0,\i\.\i\)\((\i)\),\[\3\]\),)(\i)=(\i)===\3(?=,\i=\i\.useCallback\(\(\)=>\{switch\(\3\)\{case \i\.GlobalDiscoveryTab\.)/,
                    replace: "$1$self.sidebarLabel($3)??$2fosscordTab=$self.useSidebarTab($3,$5),$4=fosscordTab.selected",
                },
                {
                    match: /(role:"tab","aria-selected":\i,tabIndex:\i\?0:-1,onClick:)(\i)/,
                    replace: "$1fosscordTab.onClick($2)",
                },
                {
                    match: /(?<=role:"tablist","aria-orientation":"vertical",children:)(\i\.GLOBAL_DISCOVERY_TABS.{0,60}?\.map\((\i)=>\(0,(\i)\.jsx\)\((\i),\{tab:\2\},\2\)\))/,
                    replace: "[$1,(0,$3.jsx)($4,{tab:$self.sidebarTab},$self.sidebarTab)]",
                },
            ],
        },
        {
            find: "itemGapPx:20,maxLines:1",
            replacement: {
                match: /if\(null==(\i)\|\|(\i)\.current===\1\)return;/,
                replace: "if(null==$1||$2.current===$1&&0!==$1)return;",
            },
        },
        {
            find: ".GUILD_SETTINGS_DISCOVERY_LANDING_PAGE,label",
            replacement: {
                match: /(\i)\.push\((\i)\(\i\.\i\.DISCOVERY_LANDING_PAGE,(\i)\)\)/,
                replace: "$&,$1.push($self.settingsSection($3))",
            },
        },
        {
            find: "INVITE_FRIEND_MEMBERS:",
            replacement: {
                match: /INVITE:(\i)=>`\/invites\/\$\{\1\}`/,
                replace: "INVITE:$1=>$self.inviteEndpoint($1)",
            },
        },
        {
            find: ".NetworkActionNames.INVITE_RESOLVE,properties",
            replacement: [
                {
                    match: /(let\{baseCode:(\i),[\s\S]{0,1500}?\.then\((\i)=>\{let (\i)=\3\.body;)/,
                    replace: "$1$4=$self.keepInviteKey($4,$2);",
                },
                {
                    match: /(let\{baseCode:(\i),[\s\S]{0,3000}?,(\i)=>\{)(let \i=null!=\3\.body&&\3\.body\.code===)/,
                    replace: "$1$self.noteInviteError($2,$3.body);$4",
                },
            ],
        },
        {
            find: "inviteHostRemainingPath:null",
            replacement: {
                match: /function (\i)\((\i),(\i)\)\{\i\.has\(\3\)\|\|\(\i\.add\(\3\),\i\.push\(\{type:\2,code:\3,url:(\i)\}\)\)\}/,
                replace: '$&{const fosscordInviteKey=$self.chatInviteKey($4);if(fosscordInviteKey){$1("INVITE",fosscordInviteKey);continue}}',
            },
        },
        {
            find: '"Join Guild",{inputValue:',
            all: true,
            replacement: {
                match: /let (\i)=(\i)\.split\("\/"\),(\i)=\1\[\1\.length-1\];/,
                replace: 'let $1=$2.split("/"),$3=$self.joinInviteKey($2);',
            },
        },
        {
            find: "hasJoinButton:!0",
            replacement: {
                match: /(resolveInvite\((\i),"Join Guild"[\s\S]{0,600}?)catch\((\i)\)\{(?="string"==typeof \3\?(\i)\(\3\))/,
                replace: "$1catch($3){if($self.remoteError($2,$3))return void $4($self.remoteError($2,$3));",
            },
        },
        {
            find: /\.startsWith\("@"\)&&\(\i=\i\.substring\(1\)\)/,
            replacement: {
                match: /(\i)=\1\.trim\(\)\)\.includes\("#"\)&&\1\.startsWith\("@"\)&&\(\1=\1\.substring\(1\)\);/,
                replace: "$&if($self.isHandle($1))return $self.addRemoteFriend($1);",
            },
        },
        {
            find: "Refusing to create a decryptor for the local user ID",
            replacement: {
                match: /(this\.mlsSession=)(new \i\.Session\("","",\(\i,\i\)=>\{this\.emit\([^)]*\)\}\))/,
                replace: "$1$self.daveSession($2)",
            },
        },
    ],
});
