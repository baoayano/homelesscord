# Federation

Approved Meowcord instances list each other's public servers in Discovery, and people on one instance can join servers on another, add friends there and send them DMs. DMs and group DMs across instances are end-to-end encrypted, and people can talk and share video in voice channels of servers on another instance. These are phases 1 to 5 of the [federation plan](../development/federation.md). The wire format is in [federation-protocol.md](../development/federation-protocol.md).

## For people using the instance

Discover has an Other instances tab after the Discord categories in Servers, and an Other instances entry under Apps and Servers in the Discover sidebar that opens the same tab. When the window is too narrow for every category, Discord moves the last ones, Other instances included, into its More menu. When the page next to the Discover sidebar is narrower than about 300 pixels, which happens in a desktop window around 650 pixels wide, Discord's search box takes the whole header and the category bar shows neither the categories nor More. The FosscordFederation plugin collapses the search box to its icon there, so the categories and More come back. The mobile web layout has no Discover sidebar and reaches the tab through More. It lists two things:

- Servers on other approved instances, with their name, icon, description, member count and the instance they're on. Join adds the server to your server list with your account on this instance and opens it. Open on its instance opens its invite page on that instance in a new tab instead. When a join fails, the card shows the error text the server answered with. The card gives up after 40 seconds and says so, and the server always answers within 28. When the server's `GUILD_CREATE` doesn't reach the client within 4 seconds, the client loads the server from the join answer and opens it. When it can't load it either, the card says the join went through and to reload, instead of opening an empty server.
- The approved instances themselves, with their address and whether signups are open, need an invite, need approval or are closed.

Your own instance answers this list. Your browser never contacts the other instances to draw the page, and their icons come through the instance's media proxy.

The rest of the client handles other instances like this:

- Join a Server takes `https://<instance>/invite/<code>` or `<instance>/invite/<code>`. When the host isn't this instance, the invite preview and the join go through `/api/v9/federation/invites/<instance>/<code>`, and the dialog shows the server's error text when either fails. After a successful join, the client loads the server from the join answer when the gateway's `GUILD_CREATE` doesn't arrive within 4 seconds, so Discord's own wait for the server ends, and shows a toast asking for a reload when that fails too.
- A link to `/invite/<code>` on an instance from the Other instances list shows an invite card in chat, and clicking the link opens the usual invite flow, both through the same federation route. Links to hosts that aren't on the list stay ordinary links.
- Add Friend takes `name@instance`. The client looks the user up with `/api/v9/federation/users/lookup?handle=name@instance` and sends the request to `PUT /api/v9/users/@me/relationships/<id>` with the local id it gets back.
- Users from other instances have usernames like `name@instance`. Where a message or the member list shows their display name instead, a small tag with the instance follows it, and their profile has a globe badge naming the instance.
- Servers that live on another instance show "Hosted on <instance>" at the top of the server menu and the server icon's right-click menu. The client takes the instance from the guild's `federated_instance` field, and asks `/api/v9/federation/objects?ids=...` for guilds that arrive without it.

## Chat across instances

Your account stays on your own instance, and your client only talks to it. When you do something in a server or conversation that lives on another instance, your instance relays the call there, and that instance runs it as a copy of your account with the same permission checks, automod and rate limits as for its own users. Events come back the same way.

- Joining a server on another instance adds it to your server list. Its channels, roles, emojis, stickers and members are copied to your instance, and only the channels you can see are copied. You read history, send, edit and delete messages, react, mention people, type, see the member list and leave like in a local server. Your own instance's automod checks what you send before it leaves.
- People from other instances appear as `name@instance`. Their profile comes from their instance and refreshes when it changes, at most once a minute per user.
- Friend requests work both ways. Add Friend takes `name@instance`.
- A DM or group DM lives on the instance of the person who started it. Messages, typing and the members of a group DM work in both directions.
- Status and activities of friends and people you share a DM with show up within a second or two, and a status from another instance expires after 30 minutes without an update.
- Mentions of you, your roles, `@everyone` and `@here` in messages from another instance count in your unread badges and send push notifications like local ones. Your notification settings for the server or the conversation apply, including suppressing `@everyone` and muting.
- Reporting a message or a server from another instance sends the report to that instance's staff.

DMs and group DMs that include someone from another instance are end-to-end encrypted like local ones. Mentions, channel links, custom emojis and stickers inside them point at the right person or object on every instance. Your instance fetches the other person's keys from their instance, which only hands them out to instances that share a conversation or a friendship with them. Safety numbers compare the same way, and strict safety mode guards against either instance swapping a key. A group DM can only add someone from another instance whose instance returns at least one device. [e2ee.md](e2ee.md#conversations-with-users-of-other-instances) has the details and what each instance can see.

## Voice across instances

You join a voice channel in a server on another instance like any other voice channel, and the call carries voice, camera video and Go Live streams in both directions. DM and group DM calls with people on other instances work the same way. A DM or group DM lives on the instance of the person who created it, and its call runs on that instance's voice server. Voice states of people from other instances show in the channel list on every instance.

The other instance never learns your IP address:

- Your client opens its voice connection to your own instance at `/federated-voice`. Your instance checks it and forwards it to the host's voice gateway as a signed connection, so the host only sees your instance.
- Your client sends media only through the TURN relay inside your instance's SFU. The client patch `80-federated-voice.js` creates the call's peer connection with your instance's relay as its only ICE server and `iceTransportPolicy: "relay"`, so the browser never offers its own addresses. The host's SFU sees the relay's address, which is your instance's address.
- The relay credential your instance hands out only lets the relay reach the host's SFU address, and it expires after 12 hours.
- When your instance has no relay, it refuses to start the call instead of letting it fall back to a direct connection.

Calls between people on the same instance are unchanged and don't use the relay.

DAVE end-to-end encryption stays on in calls that span instances. Everyone in the call uses the person's id on their own instance as their DAVE id, and the host's channel id as the group, so clients on different instances join one MLS group and verify each other's keys like in a local call. [federation-protocol.md](../development/federation-protocol.md#dave) has the details.

The host's moderators can server mute, server deafen, move and disconnect people from other instances, and their clients follow along. When your own instance restarts in the middle of a call on another instance, your client reconnects to the same call through your instance with a new session.

### TURN relay

The relay runs inside `pion-sfu` and starts when the SFU has `TURN_SECRET`. The server signs relay credentials with the same secret. When the server starts the SFU itself through `PION_SFU_BIN` and `TURN_SECRET` is empty, it makes up a random secret on every start and passes it to the SFU. Docker runs the SFU as its own service, so set `TURN_SECRET` in `.env` there, or calls in servers on other instances are refused.

| Variable              | Read by        | Default                       | Meaning                                                                                                         |
| --------------------- | -------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `TURN_SECRET`         | SFU and server | random per start, native only | Shared secret for credentials, the TURN REST scheme. Empty in Docker turns the relay off. `openssl rand -hex 32` |
| `TURN_PORT`           | SFU and server | `3478`                        | Port the relay listens on, UDP and TCP. `0` turns the relay off.                                                |
| `TURN_PUBLIC_IP`      | SFU and server | `WRTC_PUBLIC_IP`              | Address clients reach the relay on and the relay announces as its relayed address. IPv4 or a host name.          |
| `TURN_LISTEN_IP`      | SFU            | `0.0.0.0`                     | IPv4 address the relay binds to.                                                                                |
| `TURN_RELAY_PORT_MIN` | SFU            | `49160`                       | First UDP port of the relayed range. Each call uses one port from it.                                           |
| `TURN_RELAY_PORT_MAX` | SFU            | `49200`                       | Last UDP port of the relayed range.                                                                             |
| `TURN_REALM`          | SFU            | `meowcord`                    | TURN realm.                                                                                                     |
| `TURN_CREDENTIAL_TTL` | server         | `43200`                       | Seconds a relay credential stays valid, at least 60.                                                            |
| `TURN_ALLOW_PRIVATE_PEERS` | SFU and server | off                      | `1` lets the relay reach loopback, private and other reserved IPv4 addresses. Only for testing on one machine.  |

Open these ports in the firewall next to the voice port: `TURN_PORT` over UDP and TCP, 3478 by default, and the relayed range over UDP, 49160 to 49200 by default. Behind NAT, forward the same ports and set `TURN_PUBLIC_IP` to the outside address. The relay only accepts credentials it can verify, and each credential only reaches the IPv4 address named in it, so it can't be used as an open relay. The server never issues a credential for a loopback, private, link-local, carrier-grade NAT or multicast address, and the relay refuses those addresses too, so a host instance can't use a call to make the relay send packets into the home's own network.

A credential's username is `<expiry>:<peer IPv4>:<tag>` and its password is `base64(HMAC-SHA1(secret, username))`. The SFU logs `TURN allocation for <client> over <protocol> relays from <address>` and `TURN relay <address> may now reach <peer>` for every call it relays. The host logs `[WebRTC] media of <user> from <instance> in <room> comes from <address>` for every call from another instance.

## For server owners

[verification.md](../self-hosting/verification.md) explains who verifies what and how to get an instance approved.

Server Settings has an Other instances section, visible only to the owner. Turning on Show on other instances does this:

1. The server gets a permanent invite if it has none. The invite points at the system channel, or the first text channel.
2. The server waits for this instance's admins. They verify it on the Federation page of the admin dashboard.
3. Once verified, and after the instance announces itself 30 seconds later, the server's name, icon, description, member count and invite link go into this instance's signed discovery list at `/.well-known/meowcord/discovery`. The registry lists every server an approved instance publishes, within an hour, and other instances show it from then on. The registry can still remove or block a server, and an instance can block it locally.

People from other instances can join through an invite as soon as the switch is on, verified or not.

The section shows the invite link people from other instances use and one of these states: waiting for this instance's admins, waiting for the registry, listed, hidden by an admin of this instance, or blocked. Turning the switch off takes the server out of this instance's discovery list right away. Other instances fetch the list every 5 minutes, so they drop it by then.

## For instance admins

Federation is on by default. Each instance keeps an Ed25519 key in `federation.key`, next to `jwt.key` in the working directory. The server creates it on first start with mode 600. Back it up with `jwt.key`, because a new key means the registry has to read the instance's key again. Docker keeps it in the `state` volume, and the native systemd unit keeps it in the working directory.

The admin dashboard has a Federation page under Instance, for operators. It has:

- The registry address, the sequence and expiry of the last accepted registry list, the last check and its error, and a Check the registry now button.
- Settings for taking part, announcing, showing unlisted peers, the registry address and key, who verifies servers, and the peer list with each peer's last fetch.
- The announce state with a Send to registry button. Instances on localhost, an IP address or a private name never announce.
- The instance's entry for `instances.json`, a Copy entry button and a link to edit the file on GitHub. The registry lists an instance after a maintainer merges that pull request.
- Every local server that turned on Show on other instances, whether it's verified and listed, and a button to verify it or take it back. Only verified servers are published.
- When admins verify servers themselves, the servers other instances list, each with a button to verify it or take the verification back.
- Local blocks of instances, servers and users. Servers and users use canonical ids such as `@123@meow.example`. A block of an instance also hides its servers and users.
- The registry's approved instances and blocks, read only.
- Event delivery to each other instance: its state, the events waiting, delivered and dropped, and the last error. An instance that answered nothing for 24 hours is marked unreachable. Waiting events are stored in the `federation_outbox` table, so they survive a restart and go out in order once the other instance answers again. Events still waiting after 24 hours are dropped, and the server logs how many and why.
- The users and servers from other instances that this instance stores, with a button to block each one.
- The Users and Servers pages list these in their own Other instances tabs, apart from local accounts and servers. Their profiles and settings are read-only there, and the admin API refuses edits to them with an error that names the home instance. [admin.md](admin.md#users-and-servers-from-other-instances) lists what an admin can still do to them here.
- Storage per instance: the id mappings, shadow users, mirror servers, remembered event ids and queued events each other instance has here, against the limits in `federation.limits`, from `GET /api/v9/admin/federation/usage`.

Blocking an instance stops event delivery to it and refuses its relays, joins and inbox requests right away.

Shadow users and mirror servers don't count as this instance's own. The admin overview, `GET /api/v9/policies/stats`, the experiment rollout audience, announcements to everyone, the Official inbox's user list, the automod name scan and the registration rate limit in `limits.absoluteRate.register` all leave them out, so a busy server on another instance can't fill the user list or block signups here.

Accounts from other instances go through this instance's automod, and when one trips a rule the server sends a signed automod report to `/federation/v2/reports` on its home instance, which files it in Reports. [automod.md](automod.md#federation) has the settings and limits.

The registry list is signed. The instance refuses a list with a bad signature, an unknown version, a lower sequence than the last one it accepted, or a past expiry, and keeps the last good one. When that one expires, Other instances shows nothing until a newer list arrives.

### Config keys

| Key                                      | Default                                       | Meaning                                                                                                                                         |
| ---------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `federation.enabled`                     | `true`                                        | Fetch the registry, publish the discovery list and show Other instances.                                                                        |
| `federation.registry.url`                | `https://meowcord-registry.tiag.workers.dev`   | Registry address. Fetched every 5 minutes through `fetchPublicUrl`.                                                                             |
| `federation.registry.publicKey`          | The registry's key                            | Ed25519 public key, raw 32 bytes in base64url. Changing it or the address forgets the stored list and its sequence.                              |
| `federation.announce`                    | `true`                                        | Send a signed announce on start and every 24 hours. `scripts/dev/worktree-setup.sh` turns it off for development instances.                     |
| `federation.allowUnlistedPeers`          | `false`                                       | Show the instances in `federation.peers` even when the registry doesn't list them. The first key a peer serves is kept, and a changed key fails. |
| `federation.peers`                       | `[]`                                          | Instance ids such as `meow.example`.                                                                                                            |
| `federation.discovery.verification`      | `registry`                                    | `registry` shows every server the registry lists, which are the servers approved instances verified. `instance` also requires this instance's admins to pick servers from other instances on the Federation page.                |
| `federation.media.cacheSize`             | `67108864` (64 MiB)                           | Bytes of remote media kept in memory. A file larger than a quarter of it isn't cached. Capped at 4 GiB.                                           |
| `federation.media.maxFileSize`           | `52428800` (50 MiB)                           | Largest remote file the media proxy fetches. Larger files get `413`. Capped at 64 MiB.                                                          |
| `federation.media.cacheSeconds`          | `3600`                                        | How long a fetched file stays in the cache, and the `max-age` sent to clients.                                                                 |
| `federation.limits.objectsPerInstance`   | `200000`                                      | Id mappings one other instance may have in `federated_objects`. Past it, requests that add ids get `507` with `quota_exceeded`.                 |
| `federation.limits.shadowsPerInstance`   | `50000`                                       | Shadow users one other instance may have here.                                                                                                  |
| `federation.limits.guildsPerInstance`    | `500`                                         | Mirror servers one other instance may have here.                                                                                                |
| `federation.limits.inboxEventsPerInstance` | `200000`                                    | Event ids remembered per sender to skip retried batches. At the limit the oldest tenth is deleted.                                             |
| `federation.limits.newObjectsPerRequest` | `10000`                                       | New ids one request may introduce. A larger request is refused whole.                                                                           |
| `federation.media.requestsPerMinute`     | `600`                                         | Fetches to one instance per minute when the file isn't cached, and separately uploads to one instance per minute. More get `429` with `Retry-After`. |

The instance id is the host of `general.serverName`, or of `api.endpointPublic` when the server name is empty, in lowercase, with the port when it isn't 443.

## Threat model

Two kinds of attacker are in scope. One is an approved instance that turns malicious, or whose domain someone takes over, so it holds a valid key and signs whatever it wants. The other has no key and sends crafted requests to `/federation/v2`, the media proxy or the upload forward. `scripts/dev/federation-attack-probe.mjs` runs a rogue instance against a real one and prints `pass` for each attack below that the real instance blocks.

| Attack | Defense |
| --- | --- |
| Replay a signed request, sign with another key, send an old timestamp or swap the body | The signature covers method, path, target, timestamp, nonce and a hash of the body. The receiver keeps nonces for 10 minutes, at most 200,000, and refuses a timestamp more than 5 minutes off. |
| Send requests as an instance that isn't listed or an allowed peer | `trustFor` answers from the registry list and `federation.peers` without touching the database for unknown ids, and its cache holds at most 5,000 ids. |
| Make the server buffer large bodies before the signature check | The gate checks the signature headers, the declared length and the encoding before reading. The inbox takes 4 MiB and the relay 40 MiB, and all unverified bodies share a 128 MiB budget, which a chunked body reserves in full. Over budget is `503`. |
| Reach local-only or admin routes through the relay, with `%2e%2e`, backslashes or other encodings | The host refuses relay paths that a URL parser would change, then allows only server and channel routes minus a deny list, invite lookups, leaving a server, user profiles and reports. The authentication middleware refuses any other route for a shadow token, so the loopback can't reach `/users/@me`, applications, OAuth2 or admin routes. |
| Act as a local user or as a user of a third instance | The relay, join and voice endpoints take only actors of the sending instance. |
| Join local users to a server, or add them to a DM or group DM | A home creates a membership for a local user only after that user asked to join. A private channel from another instance takes only local users who are friends with, have a pending request with, or share a server with a user of the sender, and never someone who blocked them. |
| Move local emojis, stickers, channels or roles into a mirror, or claim ids of a third instance | Mirrors take only ids whose canonical form names the sending instance, and an emoji or sticker id already used by another server is skipped. |
| Send events to people who aren't in the conversation | Each event goes only to recipients who are members of the server or recipients of the channel, and key and stream events only to users who know the subject. |
| Rewrite profiles of local users or of a third instance's users | A user object from another instance only updates shadows of the sender. Shadows of a third instance get a placeholder until their own home answers a profile fetch. |
| Give its users the OFFICIAL or SYSTEM tag, a staff badge, a verified bot check or the system mark, so they look like this instance's own staff | Every user object from another instance keeps only the HypeSquad house flags and the AI account flag. Every other public flag is cleared, `system` is set to false, and a shadow's stored flags go through the same filter. These tags only ever come from the instance a person is on, for its own accounts. |
| Set the presence of a local user, or move a third instance's user out of a call | Presence and voice states apply only to shadows of the sender, and a call's host can only move a shadow between calls it also hosts. |
| Make the TURN relay reach private networks | Credentials are only issued for public IPv4 peers, and the relay refuses private and reserved peers again unless `TURN_ALLOW_PRIVATE_PEERS` is set. |
| Turn encryption off in a DM to read new messages | A home never clears `e2ee_enabled_at` or changes the type of a mirrored DM, starts new mirrors encrypted, and answers `E2EE_REQUIRED` itself to a plaintext message or edit meant for another instance. |
| Serve HTML, SVG or redirects through the media proxy | Attachments that aren't media are sent as text or bytes, every answer has `nosniff` and a sandboxing CSP, and redirects aren't followed. |
| Exhaust memory, disk or rows | Per instance quotas in `federation.limits` cap id mappings, shadows, mirror servers and remembered events, and one request can add at most 10,000 ids. New ids are only created for the sender and instances this one federates with, at the original timestamp but never later than now. Bodies may nest at most 64 levels. Upload forwards share a 256 MiB budget. The outbox keeps at most 10,000 events per instance. |
| Learn users' addresses | Media, uploads and voice go through the home instance, and calls on other instances use the home's TURN relay. |

What isn't covered: a host still decides what happens inside the servers and conversations it hosts, including deleting messages or removing members, because the host is the authority for those. A malicious instance can also fill its own quota on every instance it federates with, which is why the quotas are per instance and visible on the admin page.

## Media from other instances

People never load anything from another instance. The home instance fetches it and serves it from its own CDN:

- `GET /federation-media/<instance id>/<path>` fetches `<path>` from that instance's address and returns it. It only works for instances that may federate: `active` in the registry list with a current protocol, or a peer in `federation.peers` with `federation.allowUnlistedPeers` on and a fetched well-known document, and not blocked by the registry or locally. Any other instance gets `403` without a request.
- Only these CDN paths are fetched: attachments, avatars, banners, guild icons, splashes, discovery splashes, emojis, stickers, guild member avatars and banners, role icons, avatar decorations and the `/external/...` embed proxy. Any other path, a `..` segment, an encoded slash or backslash, or a NUL byte gets `404`. Only the query keys `size`, `format`, `quality`, `passthrough`, `animated`, `keep_aspect_ratio`, `width`, `height`, `ex`, `is` and `hm` are passed on.
- The fetch goes through `fetchPublicUrl` with no redirects, a 20 second timeout and `federation.media.maxFileSize`. A redirect answers `502`. The type comes from the file's bytes, then the remote header. Images, video and audio pass for every path, Lottie JSON for stickers, and attachments of any other type are sent as `text/plain` or `application/octet-stream`. Avatars and other images that aren't images get `415`. Every answer has `X-Content-Type-Options: nosniff` and a sandboxing `Content-Security-Policy`, and byte ranges work.
- Fetched files stay in a memory cache for `federation.media.cacheSeconds`, up to `federation.media.cacheSize` bytes, least recently used first out. A `404` from the remote is remembered for a minute.
- The avatar, banner, guild icon, emoji, sticker and member avatar routes fall back to the remote file when the file isn't stored locally and the id belongs to an object from another instance. Member avatars only fall back when the user and the server come from the same instance.
- Message, user, guild and sticker payloads from another instance get every absolute URL on a federating instance's address that matches one of the paths above rewritten to `/federation-media/...` on this instance. Message `content` is left alone, and so are links that aren't media, such as invite links.
- An upload into a channel on another instance gets an `upload_url` on this instance, `/federation-upload/<instance id>/<expiry>.<signature>/attachments/...`, signed with `security.requestSignature` and valid for 24 hours. This instance reads the file, up to `cdn.maxAttachmentSize` and at most 64 MiB, and sends it to the host with one `PUT`.

## Endpoints

| Endpoint                                   | Who                    | What                                                                                     |
| ------------------------------------------ | ---------------------- | ---------------------------------------------------------------------------------------- |
| `GET /.well-known/meowcord`                | Anyone                 | The instance's id, name, public key, protocol version and signup state.                  |
| `GET /.well-known/meowcord/discovery`      | Anyone                 | The signed list of local servers that turned on Show on other instances.                 |
| `GET /api/v9/federation/discovery`         | Signed-in users        | The Other instances directory, cached for 30 seconds.                                    |
| `GET`, `PATCH /api/v9/guilds/:id/global-discovery` | The server owner | Read or change Show on other instances.                                                |
| `/api/v9/admin/federation/...`             | Operators              | Overview, settings, refresh, announce, registry, guilds, blocks and verified servers.    |
| `GET /federation-media/<instance id>/<path>` | Anyone                | Media from another instance, fetched and cached by this instance.                        |
| `PUT /federation-upload/<instance id>/...` | Holders of a signed URL | An upload into a channel on another instance, forwarded to it.                          |
| `GET`, `POST /api/v9/federation/invites/<instance id>/<code>` | Signed-in users | Preview or join a server on another instance.                                |
| `GET /api/v9/federation/users/lookup?handle=name@instance` | Signed-in users | Resolve a user on another instance to a local id.                                 |
| `GET /api/v9/federation/objects?ids=<local ids>&canonical=<canonical ids>` | Signed-in users | Canonical ids for local ids, and local ids for canonical ids. At most 100 of each. |
| `/federation/v2/...`                        | Other instances, signed | Relay, inbox, join, snapshot, user profiles and encryption keys, see the protocol.       |
