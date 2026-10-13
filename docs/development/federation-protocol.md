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
- `discovery` only holds servers the registry operators verified.
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

The registry rate limits announces to 10 per instance id and 30 per IP address per hour.

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
- Incoming: a canonical id with the own instance id becomes the plain snowflake. Any other canonical id becomes its mapped local id, and an unknown one gets a new mapping. The new local id is a snowflake generated at the timestamp of the original snowflake, so sorting and creation times stay right.
- Only values that are 15 to 20 digit strings are translated, and only under these keys: `id`, keys ending in `_id`, keys ending in `_ids`, `roles`, `mention_roles`, `recipients` when it holds strings, `permission_overwrites[].id`, `parent_id`, `owner_id`, `guild_id`, `channel_id`, `message_id`, `user_id`, `application_id`, `webhook_id`, `sticker_ids`, and the keys of the maps `channel_overrides` and `e2ee_context_keys`. Mentions in message content (`<@id>`, `<@!id>`, `<@&id>`, `<#id>`, `<:name:id>`, `<a:name:id>`) are translated too. Encrypted content is never rewritten.
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

An instance may federate when federation is on on both sides, it is `active` in the registry document or an allowed peer, it isn't blocked by the registry or locally, and its protocol is 2 or higher.

## Endpoints

All are under `https://<instance>/federation/v2` and need a signed request.

| Method and path | Use |
| --- | --- |
| `POST /relay` | Body `{ "actor": "@u@sender", "method", "path", "query", "body", "files"? }`. The host runs the call against its own `/api/v9` as the actor's shadow and answers `{ "status", "body", "headers" }` with ids translated. `path` uses canonical ids. `files` carries multipart uploads as base64, 25 MiB in total. |
| `POST /inbox` | Body `{ "events": [{ "event", "data", "guild_id"?, "channel_id"?, "recipients": ["@u@receiver"] }] }`, at most 100 events. The receiver applies mirror changes, then emits each event to its recipients. |
| `POST /join` | Body `{ "actor", "code", "profile" }`. Joins the actor to a server through an invite and answers the server snapshot. |
| `GET /guilds/<canonical>/snapshot?actor=` | The server as the actor sees it: guild, channels, roles, emojis, stickers, members, the actor's member. |
| `GET /users/<canonical>` and `GET /users/lookup?username=` | Public profile of one of the instance's own users. |
| `POST /voice/state` | Body `{ "actor", "guild_id", "channel_id", "self_mute", "self_deaf", "self_video", "session", "profile" }` with canonical ids. The host applies gateway op 4 for the actor's shadow and answers `{ "voice_state" }`. `channel_id` null leaves the call. See [Voice](#voice). |
| `GET /voice?v=<version>` | Websocket upgrade, signed like any request with an empty body. The host's voice gateway for the sender's shadows. |
| `GET /users/<canonical>/e2ee?channel=<canonical>` | The user's encryption keys in the shape of `POST /api/v9/e2ee/keys/query`: identity key, backup key and devices with their signed prekeys. Answered only when the user shares a private channel or a non-blocked relationship with a user of the sender, or when the user's request to `GET /channels/<id>` for the hinted `channel` succeeds on the sender as the host. Otherwise `403` with `not_shared`. Device ids are never translated. |
| `GET /media/<path>` | Never used. Media goes through the public CDN paths of the host, fetched by the home instance. |

The `profile` sent with a join or a relay is the actor's `username`, `global_name`, `avatar`, `avatar_decoration_data`, `banner`, `accent_color`, `pronouns`, `bio` and `public_flags`. The receiver updates the shadow from it.

## Rules the host applies

- A server takes members from other instances only when its owner turned on "Show on other instances". Joining needs a valid invite. Discovery verification doesn't matter for joining.
- A relay into a server that turned the switch off, or that the actor isn't a member of (except for joins and invite lookups), is refused with `403` and `code` `not_federated`.
- Local and registry blocks apply to shadows: a blocked user's shadow is suspended and a blocked instance's relays and events are refused.
- Events go out per receiving instance with only the recipients who can see them. Message, reaction and typing events are filtered by `VIEW_CHANNEL` for each remote member.
- Delivery retries with backoff for 24 hours, then drops the event and marks the instance unreachable on the admin page.

## Events

- `GUILD_CREATE` sent to a new member carries the same snapshot as `/join`, with `members` and `member` inside the guild object. Hidden channels are left out of snapshots and of channel events.
- `RELATIONSHIP_ADD` with type 3 or 1 and `RELATIONSHIP_REMOVE` are sent by the instance of the user who acted, to the instance of the other user. The receiver only accepts them when `data.id` is a user of the sender, refuses a friend event without a pending outgoing request, and stores both directions.
- `PRESENCE_UPDATE` is sent by the subject's home instance to every instance that has a user sharing a server, a private channel or a relationship with the subject, with empty `recipients`. The receiver stores it for 30 minutes and broadcasts it like a local presence.
- A DM or group DM lives on the instance of the user who created it. Its `CHANNEL_CREATE` and messages go to each recipient's home instance, and the home keeps a mirror channel with the same recipients.
- `VOICE_STATE_UPDATE` goes to every instance with a member who can see the channel. Remote servers send the voice states of visible channels in `voice_states` in the snapshot and in `GUILD_CREATE`. `VOICE_SERVER_UPDATE` goes only to the home instance of the user it is for.
- Private channels with a user of another instance are encrypted from the start, and their messages carry version 2 envelopes. The host requires `encrypted.v` 2 there and 1 everywhere else, checks that `mid` on an edit is the canonical id of the message, and translates `keys[].user_id` and `backup[].user_id` from canonical to local ids for its recipient and device checks. `walkIds` never enters `encrypted`, so the envelope reaches every instance byte for byte.
- `E2EE_DEVICES_UPDATE` and `E2EE_IDENTITY_UPDATE` about a local user are sent to every instance with a user sharing a private channel or a relationship, as `{ "user_id" }` with empty `recipients`. The receiver accepts them only when the user belongs to the sender, drops its cached keys and emits the event to its users. `CHANNEL_E2EE_UPDATE` follows the channel's other events and sets `e2ee_enabled_at` on the mirror.
- The receiver caches remote keys in `federated_e2ee_keys` for 10 minutes. It checks that each device id is the SHA-256 hash of the signing key cut to 16 bytes, verifies each signed prekey and drops a device that fails, and lists a device whose identity signature over the home snowflake fails as `pending`.

## Rules the home applies

- Its own automod runs on what its users send to other instances before the relay, with the same actions as for local messages.
- Rate limits apply per local user as usual, and the relay adds a per-host limit.
- Remote media (avatars, banners, icons, emojis, stickers, attachments, embeds) is fetched by the home instance. Absolute URLs on a known instance are rewritten to `/federation-media/<instance id>/<path>` on the home CDN, and CDN paths for shadow ids fall back to the remote file. The client never contacts another instance.
- Voice in remote servers runs through a TURN relay on the home instance with `iceTransportPolicy: "relay"`, so the host's SFU only sees the home's address. See [Voice](#voice).

## Voice

A user joins a voice channel of a remote server through the home instance only. Neither the client nor its address ever reaches the host.

1. The client sends gateway op 4 for a mirror guild. The home doesn't apply it locally. It sends `POST /voice/state` to the host with `session` set to the first 32 hex characters of `sha256("meowcord-voice:" + home session id)`, so the host never learns the real session id. The host applies the update for the shadow with the same checks as for a local user. When the shadow doesn't open a voice connection within 60 seconds, the host drops the voice state.
2. The host forwards the shadow's `VOICE_STATE_UPDATE` and `VOICE_SERVER_UPDATE` through `/inbox`. The home matches the hashed session to its own row, stores the host's voice token there and gives the client a `VOICE_SERVER_UPDATE` whose endpoint is `<home host>/federated-voice`.
3. The client opens its voice websocket at `/federated-voice` on the home. The home checks the identify or resume against its own voice state row by guild, session, token and user, then opens `GET /federation/v2/voice` on the host as a signed websocket upgrade and passes the messages through in order. Ids are translated in both directions like in any other payload, and `ssrc` values are passed unchanged. The identify carries the hashed session and `max_dave_protocol_version: 0`.
4. The host accepts a federated voice connection only for a shadow of the signing instance whose voice state is in that guild. Resume only continues a session opened by the same instance. Go Live streams and DM calls aren't accepted.
5. When the host's op 2 READY arrives, the home adds `meowcord_relay` to it: `{ "urls", "username", "credential", "expires_at" }` for the TURN relay in the home's SFU. The username is `<expiry>:<host SFU IPv4>:<random tag>` and the credential is `base64(HMAC-SHA1(secret, username))`, the TURN REST scheme. The relay only lets that credential reach the IP in the username. The home closes the connection with 4000 when it can't offer a relay, so a call never falls back to a direct connection.
6. The client patch `80-federated-voice.js` sees the `/federated-voice` socket and creates every `RTCPeerConnection` during that call with the relay as the only ICE server and `iceTransportPolicy: "relay"`. Calls on the user's own instance keep their configuration.

DAVE is off for these calls. MLS credentials and the per-sender keys are bound to user ids, and every instance has its own ids for the same user, so members on different instances can't agree on a group. The host also negotiates protocol version 0 for local members of a server that has members from other instances, so that everyone in the call shares the same transport encryption. Its op 4 SESSION_DESCRIPTION then carries `meowcord_shared_call: true`. Discord's client refuses a downgrade to version 0 and disconnects with 4804, so the `FosscordFederation` plugin lets it through only while a `/federated-voice` socket is open or the current voice socket's session description carried that flag. Calls in servers without members from other instances keep DAVE.

## Client endpoints on the home instance

| Method and path | Use |
| --- | --- |
| `GET /api/v9/federation/invites/<instance id>/<code>` | Invite preview from another instance. |
| `POST /api/v9/federation/invites/<instance id>/<code>` | Join through it. Answers like `POST /invites/<code>`. |
| `GET /api/v9/federation/users/lookup?handle=name@instance` | Resolve a remote user for friend requests and DMs. Answers a user object with a local id. |
| `GET /api/v9/federation/objects?ids=<local ids>` | Canonical ids for local ids, for E2EE and the client plugin. |

The invite route also accepts `https://<instance>/invite/<code>` pasted into the client's join dialog, through the `FosscordFederation` plugin.
