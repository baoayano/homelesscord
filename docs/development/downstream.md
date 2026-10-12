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

## Downstream features

Place client behavior in a dedicated Equicord plugin and follow [client-patches.md](client-patches.md). Server features use cohesive modules with small changes at their integration points. There is no general server plugin loader. Preserve required encryption and Pride behavior and keep paid capabilities free.

Append equivalent PostgreSQL and SQLite migrations. Check timestamps and schema changes against each upstream update. Never edit the SQLite baseline. Changes that are useful to Meowcord can be contributed upstream to reduce the downstream maintenance work.

Automatic upstream PRs can be added after the first verified release. Configure credentials that allow their PRs to trigger CI, prevent overlapping runs and leave merging and deployment behind the release checks.
