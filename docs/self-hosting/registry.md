# Federation registry

The registry is the service we run that tells Meowcord instances which other instances are approved, what is blocked everywhere, and which servers are listed in global discovery. It publishes one JSON document signed with an Ed25519 key, and instances refuse any document that doesn't verify against the key in their config. The contract it implements is [federation-protocol.md](../development/federation-protocol.md), and the plan behind it is [federation.md](../development/federation.md).

It runs at `https://meowcord-registry.tiag.workers.dev` for now. The source is in `extra/registry`: a Cloudflare Worker written in JavaScript with a D1 database.

## Endpoints

| Endpoint | What it does |
| --- | --- |
| `GET /` | The registry's key id, public key and endpoint URLs. |
| `GET /v1/registry` | The signed registry document. Cached for 60 seconds. |
| `POST /v1/announce` | An instance asks to be reviewed or refreshes its data. |
| `/admin` | The review pages, behind hrtID. |

The public key is `f0jm9Szfa52pkT0nWkeZK4D1wa3NUZ9hceWaFQLZYrk` with key id `registry-1`. It is the default `federation.registry.publicKey` in the server config.

### The registry document

The Worker builds the document from D1, signs it and stores the signed copy. It signs a new copy when something in it changes and at least once a day, so `expires_at` is always about 7 days away. `sequence` is the publish time in milliseconds and never goes down. The document lists:

- approved and suspended instances. An approved instance is `active` once it serves a key at `/.well-known/meowcord` with federation turned on, and `listed` until then.
- blocked instances, servers and users, each with a reason and a date.
- discovery servers we verified, on approved instances, that their instance still lists.

### Announcing

An instance announces itself on start, once a day and when an admin presses "Send to registry". The registry then:

1. checks that `sent_at` is within 5 minutes and that the nonce wasn't used in the last 10 minutes,
2. fetches `https://<id>/.well-known/meowcord` and checks the announce signature against the key in it,
3. stores the instance as pending review, or updates it if it's already known,
4. fetches the instance's signed discovery list and stores new servers as pending.

It answers `202` with the instance's status. Announces are limited to 10 per instance id and 30 per IP address per hour.

The registry only fetches public hosts over HTTPS. It refuses `localhost`, IP addresses and private names, resolves the host through DNS over HTTPS and refuses private addresses, doesn't follow redirects, stops after 8 seconds and reads at most 64 KiB of a well-known document and 1 MiB of a discovery list.

### Hourly job

Every hour at minute 17 the Worker:

- imports `instances.json` from the `main` branch on GitHub. Every instance in it counts as approved, unless we blocked or suspended it in the admin pages.
- re-fetches the well-known document and discovery list of the 8 instances checked longest ago, so each instance is checked every few hours.
- deletes old nonces, rate limit counters and sign-in state, and activity older than 30 days.
- signs a new document if anything changed or the current one is a day old.

## How we review

The admin pages need an hrtID account in the `admins` group. They have five pages:

- **Overview**: what waits for review, errors in the last day, the published document and a button that signs and publishes a new one right away.
- **Instances**: approve, suspend or block an instance with a reason, move it back to pending, check it now, or accept a new key.
- **Discovery**: verify, reject or block a server.
- **Blocks**: block or unblock an instance id, or a server or user by canonical id such as `@123@meow.example.com`.
- **Activity**: announces, checks, imports, errors and admin actions.

We approve an instance when it has a moderation contact, captcha on registration, and a recent Meowcord version. We verify a discovery server when its name, description and icon are fine to show on every instance. A verified server goes back to pending when its name, description or icon changes.

When an approved instance starts serving a different key, the registry keeps publishing the old key and marks the instance "new key waiting". An operator checks with the instance admin that they changed it, then presses "Accept the new key". Until then the registry ignores that instance's discovery list. This stops someone who takes over a domain from speaking for the instance.

## Getting your instance listed

There are two ways, and you can do both:

- **Open a pull request** that adds your instance to `instances.json` and regenerates `instances.md` with `bun scripts/instances-md.mjs`. Once it's merged, the next hourly import lists your instance. See [CONTRIBUTING.MD](../../CONTRIBUTING.MD).
- **Let your instance announce itself.** Federation and announcing are on by default, so a public instance on a real domain announces itself on start. It shows up for review as pending. Nothing is published about it until we approve it.

Your instance only becomes `active`, and so able to federate, when it serves `/.well-known/meowcord` with its key. Until then it is `listed` in the directory.

## Running it

Everything runs from `extra/registry` with Bun and wrangler.

```sh
cd extra/registry
bun install
bun run test
bunx wrangler d1 migrations apply DB --remote
bunx wrangler deploy
```

`bun run test` starts `wrangler dev` with a throwaway signing key and database, serves a fake instance on a local port and announces it, so it needs no Cloudflare account. `bun scripts/verify-registry.mjs` fetches the deployed document and checks its signature against the public key.

| Setting | Kind | What it is |
| --- | --- | --- |
| `REGISTRY_SIGNING_KEY` | secret | The Ed25519 private key as a 32-byte base64url seed. It is in Proton Pass at `projects/meowcord/registry_signing_key`. |
| `OIDC_CLIENT_SECRET` | secret | The hrtID client secret. It only exists in the Worker, rotate it in hrtID to get a new one. |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `ADMIN_GROUP` | var | hrtID sign-in. Only the `admins` group can use the pages, and hrtID refuses everyone else too. |
| `INSTANCES_JSON_URL` | var | Where the hourly job reads `instances.json`. |
| `REFRESH_BATCH` | var | How many instances the hourly job checks, 8 by default. |
| `ALLOW_PRIVATE_HOSTS` | var | `1` lets the registry fetch `localhost` and private addresses over HTTP. Only for tests and local development. |

Rotating the signing key means shipping a server release with the new public key before the Worker gets the new secret, because instances only trust the key in their config.
