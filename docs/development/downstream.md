# Homelesscord downstream development

Homelesscord keeps Meowcord's Git history and merges upstream updates through a separate review worktree. The public downstream repository is `baoayano/homelesscord`. `origin` points to that repository and `upstream` points to `meowcorded/meowcord`.

## Connect the repository

Create the public GitHub fork from `meowcorded/meowcord`, choose owner `baoayano` and name it `homelesscord`. Then run:

```sh
bun run fork:connect baoayano/homelesscord
git fetch origin
```

The command checks that the destination repository is reachable before changing remotes. It refuses unrelated origin or upstream destinations and never pushes commits. SSH authentication can be selected afterwards with `git remote set-url origin git@github.com:baoayano/homelesscord.git` and `git remote set-url --push origin git@github.com:baoayano/homelesscord.git`.

`main` holds the verified downstream release. Implement each feature on its own `codex/` branch and integrate tested changes into `main`. Preserve unrelated local changes when preparing a release. Push reviewed commits to downstream origin only.

The pre-commit hook runs Biome and the encryption compiler with `bunx --bun`, so those JavaScript entry points use Bun even when a different Node version is present on the host.

## Instance branding

[homelesscord.config.json](../examples/homelesscord.config.json) is a configuration fragment containing the instance name. Merge its `general` and `client` keys into the instance configuration without replacing database, endpoint, encryption or operator settings. For a fresh instance, copy it to an ignored `config.json` before startup and set `CONFIG_PATH` to that file. `client.icon` and `client.logo` provide custom artwork when available. Application strings use configuration rather than a hard-coded downstream name.

## Review upstream changes

Run the check whenever preparing an update:

```sh
bun run upstream:check
bun run upstream:sync ../homelesscord-sync
```

The check fetches upstream `main` without importing tags and prints incoming commits. Sync starts from local `main`, so commit and integrate your own changes into that branch first. It creates a uniquely named branch and a new sibling worktree only when upstream has incoming commits. Existing and nested worktree destinations are refused. Dirty files in the original checkout are left in place.

The merge uses `--no-ff --no-commit`. Successful merges remain staged until verified. Conflicts return exit status 2 and remain in the review worktree for inspection. Resolve them there or run `git merge --abort` there. The command never resets a branch, deploys an instance or pushes commits.

Inside the review worktree, install dependencies and run:

```sh
bun install --frozen-lockfile
bun run build:src
bun run lint
bun run test
```

Use `scripts/dev/worktree-setup.sh` with a unique port and a database that does not exist for integration probes. It links client assets from the original checkout. Remove the `assets/vencord` link before rebuilding Equicord so a review build cannot replace the original instance's assets. Never copy a production `.env`, private recovery keys or test credentials into a release.

Run the parity probe on the isolated instance. Message, channel, session, gateway and encryption changes also need the full E2EE test. Voice changes need the voice probe and SFU tests. Client changes need the Equicord patch check. Keep the Discord and Equicord pins together with their reviewed changes, and regenerate OpenAPI after integration into `main`.

Commit the reviewed merge in the worktree with a lowercase conventional subject. On a clean downstream `main`, merge that review branch with `git merge --ff-only <review-branch>`. If `main` advanced during review, merge its new commits into the review branch and rerun the affected checks first. Tag the verified release and push to origin. Deployment is a separate step, with backups and rollback procedures from the hosting guides.

Stop any test server and remove only its database and worktree when the update is finished. Keep upstream merge history intact rather than rebasing published `main`.

The owner manages the instance on port 3001. Review updates on port 3002 with a fresh database, and keep the compiled server and Equicord assets in the review worktree. Publishing or integrating commits does not start, stop or restart port 3001.

## Update on 2026-10-13

The downstream integrates 57 upstream commits through `8c47a77`, including instance discovery, federation administration, media proxying, encrypted conversations and relayed voice between instances. The merge keeps the free Nitro registration date initializer alongside the new federated user field and login restrictions. Profile badge management and its overflow count remain part of the downstream.

The cached-client reply patch test reads the native module's actual constant names rather than assuming one minified identifier. This fixes a harness failure that also occurs before the upstream merge with client build 633029.

The native modal hit-testing fixture loads both the container stylesheet and the lazy modal stylesheet. Both desktop and mobile checks reproduce the original interception and verify backdrop dismissal, popout clicks and preserved editor drafts.

Verification uses a fresh PostgreSQL database on port 3002. The API parity probe passes 151 checks with 1 skip, the federation API probe passes 106 checks, the federation voice and video probe passes 33 checks, and both local and cross-instance encryption browser suites pass. The SFU Go tests, the registry's 18 unit tests and the required client patches also pass against build 633029. The test environment uses standalone Chromium and WebKit with local shared libraries.

## Update through adae985

The 2026-10-13 update integrates 122 upstream commits through `adae985`. It adds spam and raid handling, account origin filters, read-only remote administration, staff roles and the staff audit log, durable federation delivery, encrypted mentions, DAVE and streams across instances, bounded public requests and CDN cache eviction. The merge preserves free Nitro dates, all nine pinned Nitro images, tooltip clicks, native badge progress and permanent Pride. Generated staff role badges use the Staff management ID 22 so ordering and hiding remain consistent when a role changes. Nitro registration date editing requires MANAGE_USERS and remains unavailable for remote accounts.

Verification on a fresh 3002 database passes 1453 unit tests with 31 optional skips, 151 API parity checks with 1 provider skip, 166 federation API checks, 75 staff role checks, 41 federation attack checks, 12 AutoMod checks and 8 raid checks. The server build, lint, encryption build, SFU Go tests, 18 registry unit tests and required client patches pass. Both local and cross-instance encryption browser suites pass. A browser check saves a Nitro date with its local timezone and milliseconds while preserving account creation. A generated Moderator badge agrees between profile and directory and precedes Nitro by default.

Local voice sends and receives audio in both directions. The extended federation voice probe passes 125 of 126 checks; Bob receives no decoded samples in the final group call after the preceding guild, stream, restart and DM cases, including a repeat with a 20 second media wait. The registry worker integration harness reaches Workerd's Ready log but local HTTP requests stall when Wrangler runs under Bun in this environment. Its D1 migrations and unit tests pass. These limitations do not restart or deploy the owner's 3001 instance.

## Update through 48719bd

The 2026-10-14 update merges 9 upstream commits through `48719bd`. It makes forgot-password responses consistent across accounts, shares short rate limits between workers, limits anonymous and top-level routes, restricts credentialed CORS to instance origins, guards undefined query values and confines lurker guild events to the caller. Cluster events also reach the sending worker. Remote accounts lose official, system and staff flags through equivalent PostgreSQL and SQLite migrations. Downstream Nitro and badge management remain intact.

The rapid update passes the server build, lint, 33 focused security and gateway tests, and 151 API parity checks with 1 provider skip on a fresh SQLite database at port 3002. The request query audit finds 530 values and 0 unsafe queries. The full unit run encounters WebKit host dependency validation failures in this environment; a representative WebKit test passes when validation is bypassed using the already installed local libraries. Full local and federation encryption browser suites are not repeated within this update's requested 4 minute window. OpenAPI is regenerated on main without changing its output. The owner's server on port 3001 remains under the owner's control.

## Update through 268f0f7

The 2026-10-14 update merges 83 upstream commits through `268f0f7`. It adds ranked and paged Discovery search, cross-instance group DM ownership and icons, signed message authorship, remote profile badges, admin charts and search, safer address bans, AutoMod dry runs and exemptions, and account appeals. Encryption preserves old group messages after members leave, signs mention lists and explains when a member has no keys. Ten new migrations cover both PostgreSQL and SQLite.

The merge keeps Nitro registration date initialization next to the new private remote badge column. Native badge management, all nine Nitro assets and permanent Pride remain available. Federation exports the visible home catalog in saved order, including the free Nitro tier. Hidden Staff and eligible hidden Nitro are omitted without exporting private settings. The existing remote profile refresh interval is 60 seconds; a fresh handle lookup also updates the cached badges.

Verification passes the server build, lint, 1614 unit tests with 31 optional skips, 34 focused downstream badge checks, 156 API parity checks with 1 provider skip, 207 federation API checks, 73 federation attack checks, 14 AutoMod checks, 45 registry unit tests and all 4 local D1 migrations. The fresh PostgreSQL instance applies all migrations, and the SQLite migration regression passes. Required and enabled client patches match build 633029. Firefox verifies the Nitro hover card, all nine asset digests and native directory opening with mouse, Enter and Space. OpenAPI is regenerated on main with 654 paths and 641 schemas. Port 3001 remains under the owner's control.

Both complete encryption browser suites pass. The local suite covers former group members, signed mentions, members without keys, password backups, recovery, device approval and failure isolation. The cross-instance suite covers messages and edits, attachments in both directions, mentions, group DMs, safety numbers, fresh-browser history and verified reports. The previous federation voice transition limitation remains recorded; this update changes no voice gateway or SFU code. The registry Worker integration limitation remains separate from the passing registry unit and local migration checks.

## Downstream features

Place client behavior in a dedicated Equicord plugin and follow [client-patches.md](client-patches.md). Server features use cohesive modules with small changes at their integration points. There is no general server plugin loader. Preserve required encryption and Pride behavior and keep paid capabilities free.

Append equivalent PostgreSQL and SQLite migrations. Check timestamps and schema changes against each upstream update. Never edit the SQLite baseline. Changes that are useful to Meowcord can be contributed upstream to reduce the downstream maintenance work.

Automatic upstream PRs can be added after the first verified release. Configure credentials that allow their PRs to trigger CI, prevent overlapping runs and leave merging and deployment behind the release checks.
