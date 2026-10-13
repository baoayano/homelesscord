# Federation protocol, version 1

This is the contract between Meowcord instances and the registry for phase 1 of [federation.md](federation.md): the instance directory and global discovery. Chat between instances comes in a later version of this document.

All JSON is UTF-8. Binary values are base64url without padding. Times are ISO 8601 in UTC. An instance id is its lowercase host, with the port when it isn't 443, for example `meow.example` or `localhost:3001`. A canonical object id is `@<snowflake>@<instance id>`.

## Keys

- The registry has one Ed25519 key pair. Its public key, `f0jm9Szfa52pkT0nWkeZK4D1wa3NUZ9hceWaFQLZYrk`, is the default `federation.registry.publicKey` in the server config. The private key lives in Proton Pass (`projects/meowcord/registry_signing_key`) and in the registry Worker as the `REGISTRY_SIGNING_KEY` secret.
- Each instance makes its own Ed25519 key pair on first start and stores it in a file next to `jwt.key`, `federation.key`. The public key is the raw 32 bytes, base64url.

## Signed envelope

Everything signed uses one shape:

```json
{ "payload": "<base64url of the JSON bytes>", "signature": "<base64url Ed25519 signature over the payload bytes>", "key_id": "<string>" }
```

The receiver verifies the signature over the exact decoded payload bytes before parsing them. For the registry, `key_id` is `registry-1`. For an instance, it is the instance id.

## Registry document

`GET https://<registry>/v1/registry` returns a signed envelope. Its payload:

```json
{
  "version": 1,
  "sequence": 1792500000000,
  "issued_at": "2026-10-12T20:00:00.000Z",
  "expires_at": "2026-10-19T20:00:00.000Z",
  "min_protocol": 1,
  "instances": [
    {
      "id": "meow.example",
      "name": "Meow",
      "description": "",
      "icon_url": "https://meow.example/...",
      "url": "https://meow.example",
      "source_url": "https://github.com/...",
      "public_key": "<base64url or null>",
      "protocol": 1,
      "registration": "open",
      "state": "active",
      "listed_at": "2026-10-12T20:00:00.000Z"
    }
  ],
  "blocked": {
    "instances": [{ "id": "bad.example", "reason": "", "at": "..." }],
    "guilds": [{ "id": "@123@meow.example", "reason": "", "at": "..." }],
    "users": [{ "id": "@456@meow.example", "reason": "", "at": "..." }]
  },
  "discovery": [
    {
      "id": "@123@meow.example",
      "instance": "meow.example",
      "name": "Cat pictures",
      "description": "",
      "icon_url": "https://meow.example/icons/...",
      "member_count": 120,
      "invite_url": "https://meow.example/invite/abc",
      "verified_at": "..."
    }
  ]
}
```

- `sequence` only grows. The registry uses the publish time in milliseconds.
- `state` is `active` (federates), `listed` (shown in the directory, no key yet or not running a federating version), `suspended` (shown, not federating) or `blocked`.
- `registration` is `open`, `invite`, `approval` or `closed`.
- `public_key` is null until the registry has read it from the instance's well-known document.
- `discovery` holds every server that an approved instance lists in its signed discovery list, minus the ones the registry operators removed or blocked. An instance only lists servers its own admins verified.
- Fields the registry hasn't read from a well-known document yet are null: `public_key`, `protocol`, `registration` and `icon_url`. `description` is then an empty string. This is the case for instances listed from `instances.json` that don't run a federating version.
- A blocked instance is only in `blocked.instances`, never in `instances`.

An instance accepts a document only when the signature verifies against its configured registry key, `version` is 1, `sequence` is higher than or equal to the last one it accepted, and `expires_at` is in the future. It keeps the last accepted document. When that document expires, federation features turn off until a newer one arrives.

## Instance well-known document

`GET https://<instance>/.well-known/meowcord`, unauthenticated, cacheable for 5 minutes:

```json
{
  "protocol": 1,
  "software": "meowcord",
  "version": "<revision>",
  "id": "meow.example",
  "url": "https://meow.example",
  "name": "Meow",
  "description": "",
  "icon_url": "https://meow.example/...",
  "public_key": "<base64url>",
  "registration": "open",
  "federation": { "enabled": true, "accepts_unlisted": false },
  "discovery_url": "https://meow.example/.well-known/meowcord/discovery"
}
```

`GET https://<instance>/.well-known/meowcord/discovery` returns a signed envelope from the instance (`key_id` is the instance id) whose payload is:

```json
{ "instance": "meow.example", "issued_at": "...", "guilds": [{ "id": "@123@meow.example", "name": "", "description": "", "icon_url": "", "member_count": 0, "invite_url": "" }] }
```

It lists only servers whose owner turned on "Show on other instances", which the instance's admins haven't hidden, and which have a permanent invite. A server owner turning the switch on makes the instance create a permanent invite for it if none exists.

## Announcing to the registry

`POST https://<registry>/v1/announce` with a signed envelope from the instance. The payload is:

```json
{ "type": "announce", "id": "meow.example", "sent_at": "...", "nonce": "<16 random bytes, base64url>" }
```

The registry:

1. Refuses a `sent_at` more than 5 minutes off and a nonce it saw in the last 10 minutes.
2. Fetches `https://<id>/.well-known/meowcord` and refuses the announce if its `id` doesn't match or the signature doesn't verify against its `public_key`. This proves the sender controls the domain.
3. Stores or updates the instance as pending review, with the well-known data, then fetches and stores its discovery list as pending.
4. Answers `202` with `{ "status": "pending" | "listed" | "active" | "suspended" | "blocked" }`.

A refused announce gets `{ "error": "<text>" }` with `400` for a malformed envelope or payload, `403` when the signature doesn't verify, `409` for a reused nonce, `413` for a body over 8 KiB, `422` when the well-known document can't be fetched or doesn't match, and `429` with `Retry-After` when rate limited. The registry doesn't follow redirects when it fetches an instance. When an approved instance's well-known document shows a new public key, the registry keeps publishing the old one until an operator accepts the new one.

Instances announce on start, once a day and when an admin presses "Send to registry". It is on by default and an admin can turn it off. An instance never announces when its id is `localhost`, an IP address or a private name.

The registry rate limits announces to 10 per instance id and 30 per IP address or IPv6 /64 per hour, and to 60 per hour across all instance ids it has never seen.

## Instance config

```
federation.enabled                   true
federation.registry.url              https://meowcord-registry.tiag.workers.dev
federation.registry.publicKey        f0jm9Szfa52pkT0nWkeZK4D1wa3NUZ9hceWaFQLZYrk
federation.announce                  true
federation.allowUnlistedPeers        false
federation.peers                     []
federation.discovery.verification    "registry" | "instance"
```

- With `verification` set to `registry`, global discovery shows what the registry document lists. With `instance`, the instance's own admins verify servers for their users, from the discovery lists of approved instances and peers.
- `peers` are extra instance ids the admins chose to federate with. They are used only when `allowUnlistedPeers` is true, and never when the registry blocks them.
- Local admins can add their own blocks on top of the registry's, and can't lift a registry block.

# Federation protocol, version 2

Version 2 adds chat between instances: servers, DMs, group DMs, friends, profiles, media, E2EE and voice. Instances announce `"protocol": 2` in their well-known document and accept version 1 registry documents unchanged. Phases 2 to 5 of [federation.md](federation.md) build on it.

## Model

- The host instance is the only authority for a server, DM or group DM. Nothing is merged.
- Each instance stores a shadow user for every remote user it has seen: a normal `users` row with `federated_instance` set, no password and no way to sign in. Its `username` is `name@instance`, so the stock client shows the handle everywhere without a patch.
- The home instance keeps mirror rows for remote servers and DMs its users are in: the guild, its channels, roles, emojis, stickers and members, with `federated_instance` set on the guild and channel rows. Mirrors only change when the host says so. Messages aren't mirrored.
- A user's client only talks to its home instance. A REST call that touches a mirror is relayed to the host, and the host runs it through its own routes as the user's shadow, so permissions, automod, rate limits and validation are the same code as for local users.
- The host forwards gateway events to every home instance that has a user who should see them. The home updates its mirrors and hands the event to those users' sessions.

## Ids

A canonical id is `@<snowflake>@<instance id>`. Both sides use the same translation, keyed by a `federated_objects` table (`canonical` primary key, `local_id` unique, `instance`, `created_at`).

- Outgoing: a local snowflake that maps to a canonical id becomes that id. Any other local snowflake becomes `@<snowflake>@<own id>`.
- Incoming: a canonical id with the own instance id becomes the plain snowflake. Any other canonical id becomes its mapped local id, and an unknown one gets a new mapping when it names the sender or an instance the receiver federates with. Ids of other instances become null. The new local id is a snowflake generated at the timestamp of the original snowflake, never later than now, so sorting and creation times stay right. One request may add at most `federation.limits.newObjectsPerRequest` ids, and each instance at most `federation.limits.objectsPerInstance`; past either the receiver answers `507` with `quota_exceeded`. A body may nest at most 64 levels.
- Only values that are 15 to 20 digit strings are translated, and only under these keys: `id`, keys ending in `_id`, keys ending in `_ids`, `roles`, `mention_roles`, `recipients` when it holds strings, `permission_overwrites[].id`, `parent_id`, `owner_id`, `guild_id`, `channel_id`, `message_id`, `user_id`, `application_id`, `webhook_id`, `sticker_ids`, and the keys of the maps `channel_overrides` and `e2ee_context_keys`. Mentions in message content (`<@id>`, `<@!id>`, `<@&id>`, `<#id>`, `<:name:id>`, `<a:name:id>`) are translated too. An incoming mention with a bare snowflake becomes `<@0>` and the like, so a remote can't point at a local user, role or channel. Encrypted content is never rewritten.
- A user object for a remote user gets `username` set to `name@instance`. A user object for one of the receiver's own users gets the receiver's own row values.
- A request may only assert a user of the sending instance as the actor. Canonical ids of other instances in a body are references and are allowed.

## Signed requests

Every request between instances is HTTPS (plain HTTP only for private ids with `security.allowPrivateNetworkRequests`), through `fetchPublicUrl`, with these headers:

```
Meowcord-Instance: <sender instance id>
Meowcord-Timestamp: <unix milliseconds>
Meowcord-Nonce: <16 random bytes, base64url>
Meowcord-Signature: <base64url Ed25519 signature>
```

The signature covers the UTF-8 bytes of `METHOD\nPATH_WITH_QUERY\nTARGET_INSTANCE_ID\nTIMESTAMP\nNONCE\nBASE64URL_SHA256_OF_BODY`. The receiver refuses a timestamp more than 5 minutes off, a nonce it saw in the last 10 minutes, a sender that isn't allowed to federate (see below) and a signature that doesn't verify against the sender's key from the registry document, or from its well-known document for an allowed unlisted peer. Errors are `{ "code": "<snake_case>", "error": "<text>" }`.

The receiver checks the headers and the declared body length before it reads the body: 4 MiB for the inbox and other endpoints, 40 MiB for the relay, no `Content-Encoding`, and a shared 128 MiB budget for bodies whose signature isn't checked yet.

An instance may federate when federation is on on both sides, it is `active` in the registry document or an allowed peer, it isn't blocked by the registry or locally, and its protocol is 2 or higher.

A refused sender gets `403` with a message that names the reason: federation is off, the receiver has no current registry document, the sender is blocked, the registry lists it as `listed` or `suspended`, it has no key, or its protocol is too old. When the sender isn't in the receiver's copy of the registry at all, or the receiver has no current copy, the code is `unknown_sender` instead of `not_federated`, and the receiver fetches the registry document again, at most once a minute. Instances fetch it every 5 minutes, so a newly approved instance can be unknown to others for that long.

## Endpoints

All are under `https://<instance>/federation/v2` and need a signed request.

| Method and path | Use |
| --- | --- |
| `POST /relay` | Body `{ "actor": "@u@sender", "method", "path", "query", "body", "files"? }`. The host runs the call against its own `/api/v9` as the actor's shadow and answers `{ "status", "body", "headers" }` with ids translated. `path` uses canonical ids. `files` carries multipart uploads as base64, 25 MiB in total. |
| `POST /inbox` | Body `{ "events": [{ "id", "event", "data", "guild_id"?, "channel_id"?, "recipients": ["@u@receiver"] }] }`, at most 100 events. The receiver applies mirror changes, then emits each event to its recipients. `id` is a string of at most 64 characters, unique per sender. The receiver keeps the ids it saw for 48 hours and skips an event whose id it already applied, so a retried batch doesn't apply twice. |
| `POST /join` | Body `{ "actor", "code", "profile" }`. Joins the actor to a server through an invite and answers the server snapshot. |
| `GET /guilds/<canonical>/snapshot?actor=` | The server as the actor sees it: guild, channels, roles, emojis, stickers, members, the actor's member. |
| `GET /users/<canonical>` and `GET /users/lookup?username=` | Public profile of one of the instance's own users. |
| `POST /voice/state` | Body `{ "actor", "guild_id", "channel_id", "leave", "self_mute", "self_deaf", "self_video", "session", "profile" }` with canonical ids. The host applies gateway op 4 for the actor's shadow and answers `{ "voice_state" }`. `guild_id` is null for a DM call. `leave` true, or `channel_id` null in a server, leaves the call. See [Voice](#voice). |
| `POST /voice/stream` | Body `{ "actor", "operation", "session", "stream", "paused", "profile" }`. The host runs gateway op 18, 19, 20 or 22 for the actor's shadow. See [Go Live](#go-live). |
| `GET /voice?v=<version>` | Websocket upgrade, signed like any request with an empty body. The host's voice gateway for the sender's shadows. |
| `GET /users/<canonical>/e2ee?channel=<canonical>` | The user's encryption keys in the shape of `POST /api/v9/e2ee/keys/query`: identity key, backup key and devices with their signed prekeys. Answered only when the user shares a private channel or a non-blocked relationship with a user of the sender, or when the user's request to `GET /channels/<id>` for the hinted `channel` succeeds on the sender as the host. Otherwise `403` with `not_shared`. Device ids are never translated. |
| `GET /media/<path>` | Never used. Media goes through the public CDN paths of the host, fetched by the home instance. |

The `profile` sent with a join or a relay is the actor's `username`, `global_name`, `avatar`, `avatar_decoration_data`, `banner`, `accent_color`, `pronouns`, `bio` and `public_flags`. The receiver updates the shadow from it.

## Rules the host applies

- A server takes members from other instances only when its owner turned on "Show on other instances". Joining needs a valid invite. Discovery verification doesn't matter for joining.
- A relay path must be one a URL parser leaves unchanged, with no `.` or `..` segment in any encoding and no backslash. It may only reach routes under `/guilds/<id>` and `/channels/<id>` minus a deny list (webhooks, integrations, templates, vanity URL, server deletion, application commands, followers and a few more), `GET /invites/<code>`, `DELETE /users/@me/guilds/<id>`, `GET /users/<id>` and `/profile`, and `POST /reporting/...`. Anything else is `403` with `not_federated`, and the authentication middleware refuses shadow tokens on any other route.
- A relay into a server that turned the switch off, or that the actor isn't a member of (except for joins and invite lookups), is refused with `403` and `code` `not_federated`.
- Local and registry blocks apply to shadows: a blocked user's shadow is suspended and a blocked instance's relays and events are refused.
- Events go out per receiving instance with only the recipients who can see them. Message, reaction and typing events are filtered by `VIEW_CHANNEL` for each remote member.
- Events wait in a database table per receiving instance and go out in the order they were queued, at most 100 per request. A batch is removed only after a 2xx answer. Delivery retries with backoff from 1 second up to 5 minutes for 24 hours, then drops the event, logs it and marks the instance unreachable on the admin page. A 4xx answer other than 408 and 429 drops the batch. At most 10,000 events wait per instance, and the oldest go first.

## Events

- `GUILD_CREATE` sent to a new member carries the same snapshot as `/join`, with `members` and `member` inside the guild object. Hidden channels are left out of snapshots and of channel events.
- `RELATIONSHIP_ADD` with type 3 or 1 and `RELATIONSHIP_REMOVE` are sent by the instance of the user who acted, to the instance of the other user. The receiver only accepts them when `data.id` is a user of the sender, refuses a friend event without a pending outgoing request, and stores both directions.
- `PRESENCE_UPDATE` is sent by the subject's home instance to every instance that has a user sharing a server, a private channel or a relationship with the subject, with empty `recipients`. The receiver stores it for 30 minutes and broadcasts it like a local presence.
- A DM or group DM lives on the instance of the user who created it. Its `CHANNEL_CREATE` and messages go to each recipient's home instance, and the home keeps a mirror channel with the same recipients.
- `VOICE_STATE_UPDATE` goes to every instance with a member who can see the channel. Remote servers send the voice states of visible channels in `voice_states` in the snapshot and in `GUILD_CREATE`. `VOICE_SERVER_UPDATE` goes only to the home instance of the user it is for. In a DM, voice states and `CALL_CREATE`, `CALL_UPDATE` and `CALL_DELETE` go to the home of each recipient. `STREAM_*` events carry `meowcord_stream` instead of `stream_key`, see [Go Live](#go-live).
- On the home, a `MESSAGE_CREATE` from the host raises `mention_count` in the read states of the local recipients it mentions, through the same rules as a local message: user mentions, roles the member has unless `suppress_roles` is on, and `@everyone` or `@here` when the host set `mention_everyone` and the member hasn't turned on `suppress_everyone`. Every message counts in a DM. The home sends web push to the event's recipients with the same mute and notification level checks.
- Private channels with a user of another instance are encrypted from the start, and their messages carry version 2 envelopes. The host requires `encrypted.v` 2 there and 1 everywhere else, checks that `mid` on an edit is the canonical id of the message, and translates `keys[].user_id` and `backup[].user_id` from canonical to local ids for its recipient and device checks. `walkIds` never enters `encrypted`, so the envelope reaches every instance byte for byte. Inside a version 2 payload the sender writes `<@id>`, `<@!id>`, `<@&id>`, `<#id>`, `<:name:id>`, `<a:name:id>` and `stickers[].id` with canonical ids, and readers map them back with `GET /api/v9/federation/objects?canonical=`. A canonical id the reader's instance can't map is shown as plain text, never as another local object.
- `E2EE_DEVICES_UPDATE` and `E2EE_IDENTITY_UPDATE` about a local user are sent to every instance with a user sharing a private channel or a relationship, as `{ "user_id" }` with empty `recipients`. The receiver accepts them only when the user belongs to the sender, drops its cached keys and emits the event to its users. `CHANNEL_E2EE_UPDATE` follows the channel's other events and sets `e2ee_enabled_at` on the mirror.
- The receiver caches remote keys in `federated_e2ee_keys` for 10 minutes. It checks that each device id is the SHA-256 hash of the signing key cut to 16 bytes, verifies each signed prekey and drops a device that fails, and lists a device whose identity signature over the home snowflake fails as `pending`.

## Rules the home applies

- Its own automod runs on what its users send to other instances before the relay, with the same actions as for local messages.
- Mirrors take only ids that name the sender. A server membership for a local user is created only after that user asked to join. A private channel takes only local users who are friends with, have a pending request with, or share a server with a user of the sender. Events go only to recipients in the server or channel. User objects of a third instance never update its shadows, which get a placeholder until a profile fetch from their own home.
- A mirrored DM keeps `e2ee_enabled_at` and its type once set, and the home answers `E2EE_REQUIRED` itself to a plaintext message or edit for a private channel on another instance.
- Rate limits apply per local user as usual, and the relay adds a per-host limit.
- Remote media (avatars, banners, icons, emojis, stickers, attachments, embeds) is fetched by the home instance. Absolute URLs on a known instance are rewritten to `/federation-media/<instance id>/<path>` on the home CDN, and CDN paths for shadow ids fall back to the remote file. The client never contacts another instance.
- Calls hosted on other instances run through a TURN relay on the home instance with `iceTransportPolicy: "relay"`, so the host's SFU only sees the home's address. See [Voice](#voice).

## Voice

A user joins a call hosted on another instance through the home instance only. Neither the client nor its address ever reaches the host. This covers voice channels of remote servers, DMs and group DMs that live on another instance, and Go Live streams in both.

1. The client sends gateway op 4 for a mirror guild or a mirror DM. The home doesn't apply it locally. It sends `POST /voice/state` to the host with `session` set to the first 32 hex characters of `sha256("meowcord-voice:" + home session id)`, so the host never learns the real session id. The host applies the update for the shadow with the same checks as for a local user. For a DM, `guild_id` is null and `channel_id` is the canonical DM id, and the host checks that the shadow is a recipient. When the shadow doesn't open a voice connection within 60 seconds, the host drops the voice state.
2. The host forwards the shadow's `VOICE_STATE_UPDATE` and `VOICE_SERVER_UPDATE` through `/inbox`. The home matches the hashed session to its own row, stores the host's voice token there and gives the client a `VOICE_SERVER_UPDATE` whose endpoint is `<home host>/federated-voice`.
3. The client opens its voice websocket at `/federated-voice` on the home. The home checks the identify or resume against its own voice state row by server id, session, token and user, then opens `GET /federation/v2/voice` on the host as a signed websocket upgrade and passes the messages through in order. Ids are translated in both directions like in any other payload, and `ssrc` values are passed unchanged. The identify carries the hashed session. When `PUBLIC_FETCH_PROXY` is set, the upgrade goes through that proxy like every other outbound request.
4. The host accepts a federated voice connection only for a shadow of the signing instance: a voice state in that guild or DM, or an unused Go Live stream session. Resume only continues a session opened by the same instance.
5. When the host's op 2 READY arrives, the home adds `meowcord_relay` to it: `{ "urls", "username", "credential", "expires_at" }` for the TURN relay in the home's SFU. The username is `<expiry>:<host SFU IPv4>:<random tag>` and the credential is `base64(HMAC-SHA1(secret, username))`, the TURN REST scheme. The relay only lets that credential reach the IP in the username. A source address is bound to a username only after an allocation on it succeeded with a valid message integrity, so a forged request can't claim an address for a credential it doesn't hold. The home closes the connection with 4000 when it can't offer a relay, so a call never falls back to a direct connection.
6. The client patch `80-federated-voice.js` sees the `/federated-voice` socket and creates every `RTCPeerConnection` during that call with the relay as the only ICE server and `iceTransportPolicy: "relay"`. Calls on the user's own instance keep their configuration.

### DAVE

Calls across instances keep DAVE, protocol version 1, like any other call. MLS credentials and the per-sender key ratchets are bound to a 64-bit user id, and every instance has its own local id for the same user, so the instances agree on one id per user and on one group id per call:

- A user's DAVE id is the snowflake of their canonical id, which is their id on their home instance. For a local user that is their own id. For a shadow it is the snowflake part of the canonical id stored in `federated_objects`.
- The group id is the channel id on the host: the voice channel or DM id, or the stream id minus one for Go Live.
- The host computes the DAVE id of every voice connection on identify and refuses one whose id it can't resolve. It checks the identity in each MLS key package against that id, and refuses a key package whose id is already used by another member of the call.
- The host adds `meowcord_dave: [{ "user_id", "dave" }]` to op 11 CLIENTS_CONNECT, and `meowcord_dave: { "channel_id", "group" }` to op 4 SESSION_DESCRIPTION on a federated connection. The home translates `user_id` and `channel_id` like any id and passes `dave` and `group` unchanged.
- The client patch `80-federated-voice.js` keeps a map from local id to DAVE id and from local channel id to group id. The `FosscordFederation` plugin wraps the libdave session so that it gets the DAVE ids and the group id, and the client's code above it keeps its local ids. Calls with only local users have identical ids on both sides, so nothing changes for them.

### Go Live

Gateway ops 18, 19, 20 and 22 for a stream in a mirror guild or a mirror DM go to the host as `POST /voice/stream`:

```json
{ "actor": "@u@home", "operation": "create" | "watch" | "delete" | "paused", "session": "<hashed session>", "stream": { "guild_id", "channel_id", "user_id" }, "paused": false, "profile": {} }
```

The ids in `stream` are canonical and `user_id` is the stream's owner. The host runs the op for the shadow with the checks it applies to a local user, and only the owner may create a stream. `STREAM_CREATE`, `STREAM_SERVER_UPDATE`, `STREAM_UPDATE` and `STREAM_DELETE` go back through `/inbox` to the home of each user they are for, or to every instance with a member who can see the channel for a stream that ended. A stream key holds ids inside a string, so on the wire `stream_key` is replaced with `meowcord_stream: { "guild_id", "channel_id", "user_id" }` and the receiver rebuilds the key from its own ids. The home remembers the token of each `STREAM_SERVER_UPDATE` for 10 minutes, points the endpoint at `/federated-voice` and lets that token through the voice proxy for the same user. The stream connection then runs like a call, with the relay and DAVE.

### DM and group DM calls

A DM or group DM lives on the instance of the user who created it, and so does its call. `CALL_CREATE`, `CALL_UPDATE` and `CALL_DELETE` follow the channel's other events to each recipient's home, with `ringing`, `participants` and the keys of `ongoing_rings` translated. The home keeps the last call payload per mirror DM in memory and serves it for gateway op 13 and to a client that connects during the call. Voice states in a DM are forwarded to the home of each recipient, like messages.

### Restarts

When a home restarts in the middle of a call hosted elsewhere, it keeps the voice states of its own users and of shadows in mirror guilds and mirror DMs. It only clears the states, streams and calls it hosts. The client's gateway reconnects and sends op 4 for the same channel with a new session. The home sends it to the host as a new session, the host gives the shadow a new token and `VOICE_SERVER_UPDATE`, and the client reconnects its voice websocket through the proxy and allocates a new relay.

### Moderation

A host's server mute, server deafen, move and disconnect act on the shadow's voice state like on a local member. The host's SFU stops forwarding the shadow's audio when muted and stops sending audio to it when deafened. The resulting `VOICE_STATE_UPDATE` reaches the home and the client. A move also sends a new `VOICE_SERVER_UPDATE` with a new token, and the client reconnects through the proxy. A disconnect sends a voice state with `channel_id` null, and the home clears its own row.

## Client endpoints on the home instance

| Method and path | Use |
| --- | --- |
| `GET /api/v9/federation/invites/<instance id>/<code>` | Invite preview from another instance. |
| `POST /api/v9/federation/invites/<instance id>/<code>` | Join through it. Answers like `POST /invites/<code>`, plus `guild_id` and `meowcord_guild`, the `GUILD_CREATE` payload sent to the gateway, see [Joining](#joining). |
| `GET /api/v9/federation/users/lookup?handle=name@instance` | Resolve a remote user for friend requests and DMs. Answers a user object with a local id. |
| `GET /api/v9/federation/objects?ids=<local ids>&canonical=<canonical ids>` | Canonical ids for local ids, and local ids for canonical ids, at most 100 of each, in one object keyed by the id asked for. A canonical id that has no local id yet gets one when its instance federates with this one, the same rule as for incoming payloads. Canonical ids of other instances are left out. |

The invite route also accepts `https://<instance>/invite/<code>` pasted into the client's join dialog, through the `FosscordFederation` plugin.

## Joining

The home answers `POST /api/v9/federation/invites/<instance id>/<code>` within 28 seconds. Its request to the host's `/join` times out after 20 seconds, and every request to another instance goes through `fetchPublicUrl` with a deadline that ends the request even when a proxy connection stalls. When the host answers `unknown_sender`, the home asks once more after 3 seconds, since the host is fetching the registry document by then. A host on an older build answers `not_federated` with "This instance doesn't federate with the sender" in that case, and the home explains it as the registry delay.

A failed join answers `{ "code", "message", "meowcord_code" }`. Errors from the host's invite route, such as an unknown, used up or expired invite (`10006`), a ban (`40007`) or paused invites, keep their status and Discord code, except that a `401` from the host becomes `403` so the client doesn't sign out. The other codes are:

| `meowcord_code` | Status | Meaning |
| --- | --- | --- |
| `not_federated` | 403 | This instance or the host doesn't federate with the other, and the message says why. |
| `unknown_sender` | 403 | The host doesn't have this instance in its copy of the registry yet. |
| `host_timeout` | 504 | The host didn't answer within 20 seconds. |
| `host_unreachable` | 502 | The connection to the host failed: DNS, refused, reset, TLS, or the outbound proxy couldn't reach it. |
| `proxy_error` | 502 | The outbound proxy refused the connection. |
| `host_bad_response` | 502 | The host answered with something that isn't JSON, like a proxy's error page. |
| `host_error` | 502 | The host answered a 5xx or an unexpected status. |
| `mirror_failed` | 502 | The host let the user in, but copying the server failed. The home removes the partial copy, and joining again is safe. |
| `join_timeout` | 504 | The whole join took longer than 28 seconds. The copy continues and the server shows up when it's done. |
| `internal` | 500 | Anything else, logged on the home. |

When the host answers that the join waits for approval, the answer has `meowcord_pending: true` and no `guild_id`. The client shows a notice instead of opening the server.

On the host, the loopback call to its own `/api/v9` that runs the join or a relay times out after 15 seconds.
