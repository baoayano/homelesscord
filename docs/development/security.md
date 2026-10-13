# Security review

This page records the adversarial review of October 2026, what it found, what changed, and how to run the checks again. Federation and automod were reviewed separately and are not covered here.

## What was reviewed

- Authorization on every REST route. `scripts/dev/route-audit.mjs` walks `src/api/routes` and `src/api/routes_toplevel` and prints each handler with its authentication mode, permission, right and OAuth2 scope. It found 758 handlers in 498 files. `--flagged` lists the handlers with no `route()` middleware, unauthenticated writes, admin routes without a right and OAuth2-reachable routes without a scope check, which were read by hand. Suspicious routes were then tried live with two accounts.
- Sign-in and sessions: tokens, two factor, password reset, email verification, lockout, passkeys and OAuth2.
- The gateway: opcodes before Identify, compression, member and presence requests, voice channel statuses.
- The CDN: content types, path handling and response headers.
- Web pages: framing, content sniffing, redirect URIs and HTML built from user input.
- Rate limits: bucket keys, forwarded addresses and IPv6.
- Secrets in responses and logs.

## Findings

Severity is what an attacker gets on a default instance. Each fix has a unit test in `scripts/tests/security-*.test.cjs`, and the ones marked "probe" are also attacked end to end by `scripts/dev/security-probe.mjs`.

| Severity | Finding | Fix |
| --- | --- | --- |
| High | An SVG, HTML or XML attachment was served with its own content type from the same origin as the client, so opening its link ran script with access to the user's token. Probe. | Every CDN response gets `nosniff` and a `sandbox` content security policy, and only image, audio, video, JSON, PDF, font and plain text types are served inline. Everything else is a download. |
| High | An OAuth2 application could register a `javascript:` or `data:` redirect URI, which ran script on the instance origin after authorization. Probe. | Redirect URIs must parse as URLs and can't use `javascript`, `data`, `vbscript`, `file`, `blob`, `about` or `filesystem`, both when saved and when authorizing. |
| High | An email verification link issued a fresh session token every time it was opened, including for accounts with two factor. Anyone who later read the email could sign in. | The link signs in only on the first use and never for an account with two factor. |
| High | A user with `MANAGE_USERS` could edit, disable or remove other staff accounts, operators included. | Only operators can manage accounts that hold staff rights. |
| High | The legacy pin routes looked messages up by id alone, so pinning any message id in your own channel copied it into your pins, content included. Probe. | Pins look the message up inside the route's channel. |
| Medium | An account disabled by staff could re-enable itself through the undelete flow at login, two factor login or password reset. | Staff disables set the `DISABLED` user flag, and those three paths refuse to undelete an account that has it. |
| Medium | A gateway socket could send any opcode before Identify, including member, presence and channel status requests. Probe. | Only Heartbeat, Identify, Resume and QoS are accepted before Identify, anything else closes with 4003. |
| Medium | Op 14 sent presences for any user id listed in `members`, in any guild. Probe. | Presence lookups and subscriptions only include members of a guild the requester is in. |
| Medium | Voice channel statuses and channel info were sent for any guild id. | They need membership and only include channels the user can view. |
| Medium | Non-members could list a guild's channels, welcome screen channels and top read channels. Probe. | Those routes check membership. |
| Medium | Inbound gateway frames were inflated with zlib or zstd, so a small frame could expand without limit. | Inbound frames are never decompressed, and every socket gets a frame budget of 240 a minute. |
| Medium | Changing the case, adding slashes or percent-encoding a path gave it a fresh rate limit bucket. Probe. | Buckets are built from the decoded, lowercased path with empty segments removed. |
| Medium | The gateway read `X-Forwarded-For` from any peer. | It's read only from trusted proxies, by default loopback and private ranges, and `security.trustedProxies` narrows or widens that. |
| Medium | The TOTP code on the old disable path and on the application secret and bot routes could be guessed without a limit. | Direct codes outside the ticket flow are capped at 10 per user every 15 minutes. |
| Medium | The backup codes challenge put an unkeyed SHA-256 of a 4-byte key in the nonce, which can be brute forced offline. | The hash is an HMAC keyed from the instance's JWT key and the user id. |
| Low | Passwordless passkey sign in accepted assertions without user verification, and the ticket could be replayed. | User verification is required and the ticket is single use with 5 attempts. |
| Low | IPv6 clients got a bucket per address, so one /64 had billions of buckets. | IPv6 addresses share a bucket per /64, and IPv4-mapped addresses count as IPv4. |
| Low | Bots could fetch full member lists without the `GUILD_MEMBERS` intent and presences without `GUILD_PRESENCES`, and users could request unlimited full lists. | Intents are enforced and non-moderators get at most 100 members per full-list request. |
| Low | Gateway session ids and voice tokens came from `Math.random`. | They come from `crypto.randomBytes`. |
| Low | Pages had no framing policy, `nosniff` or referrer policy. Probe. | `frame-ancestors 'self'`, `nosniff`, `strict-origin-when-cross-origin` and HSTS over HTTPS. The widget stays embeddable. |
| Low | Request bodies logged with a 500 included passwords, tickets and message text. | Logged bodies redact those fields. |
| Low | Webhook routes checked `MANAGE_WEBHOOKS` on the guild and ignored channel overwrites, including when moving a webhook. | The check uses the webhook's channel and the channel it moves to. |
| Low | A prune count needed no permission, and the prune window accepted negative and non-numeric days. | Counting needs `KICK_MEMBERS` and the window stays between 1 and 30 days. |
| Low | Usernames went into HTML emails unescaped. | They are escaped. |
| Low | Every heartbeat wrote `last_seen` to the database. | It's written at most once a minute. |
| Bug | `GET /users/:id/messages` passed an undefined channel id when there was no shared DM, which TypeORM drops from the query, and the DM lookup itself failed on PostgreSQL. | The route returns an empty list without a shared DM and the lookup works on PostgreSQL. |

## Not fixed

- TypeORM runs with `invalidWhereValuesBehavior: { undefined: "ignore" }`, so any `where` value that is `undefined` widens the query instead of failing. The DM history bug above came from this. Changing it globally needs every query audited first.
- `spamGuard.ts` and `admin/automod/names.ts` disable accounts without the staff disabled flag. They are in the automod area.
- CDN URL signatures are compared with `===` instead of a constant time compare, and `security.cdnSignUrls` is off by default.
- CORS reflects any `Origin` with credentials allowed. Requests authenticate with the `Authorization` header, which a foreign page doesn't have, and the only cookie, `__sb_sessid`, is a fingerprint for instance bans that doesn't authenticate anything.
- READY includes the names and topics of channels the user can't view, as Discord's own client expects.
- Staff with `MANAGE_USERS` see email addresses, phone numbers and IP addresses. That is a policy choice.
- `POST /auth/forgot` answers differently for known and unknown emails.
- Rate limits with a window under 60 seconds are counted in process memory, so several API processes each allow the full count.
- The lurker join route sends `GUILD_CREATE` to any gateway `session_id` in the query string. It only carries public data of a discoverable guild.
- `POST /error-reporting-proxy/web` and other top-level routes have no rate limit. The proxy discards the body.

## Running the checks

```sh
bun run build:src
bun test scripts/tests/security-*.test.cjs
bun scripts/dev/route-audit.mjs --flagged
psql <your test database> -c "delete from rate_limits"
CHROME_PATH="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" PORT=3001 bun scripts/dev/security-probe.mjs
```

The probe registers two new accounts, so clear `rate_limits` on your own test database first. It prints `pass` for each blocked attack and exits with 1 when any attack works. Email verification reuse and the staff account checks need an email inbox or staff accounts, so they are covered by unit tests only.
