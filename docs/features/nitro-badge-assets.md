# Free evolving Nitro badges

Every ordinary account receives the default Nitro badge immediately. Its level follows the account's `created_at`, with milestones at 1, 3, 6, 12, 24, 36, 60 and 72 completed calendar months. The highest badge replaces the previous one. Existing accounts receive the level their age has earned on the next profile request.

Anniversaries use UTC and preserve the creation time down to milliseconds. When the original day does not exist in the anniversary month, the anniversary falls on its last day. January 31 advances on February 28, or February 29 in a leap year. Progress stops at 72 months. Invalid or future creation dates receive the default badge with no invented tenure date.

Bots and system accounts do not receive human membership badges. Premium type, payment status and the legacy `hide_premium_badge` field do not gate these free badges. The profile endpoint returns `premium_since` as the account creation date and one generated badge. Old assigned subscription badges and booster badges stay filtered, while admin and Pride badges remain visible. Badge descriptions use `client.instanceName` and have no purchase link. IDs use `nitro_account_tenure_<months>_month` so the native client displays the supplied description through its custom badge renderer. Discord's reserved `premium` IDs replace descriptions with subscriber tooltips and subscription interactions. No database migration, scheduled job or client modification is required.

The bundled Nitro badge artwork comes from Discord's badge CDN, retrieved on October 12, 2026. [Evolving Nitro Badges](https://support.discord.com/hc/en-us/articles/29136565881623-Evolving-Nitro-Badges) describes the progression. The local collection contains the default badge and milestones at 1, 3, 6, 12, 24, 36, 60 and 72 months.

`assets/badge-icons/nitro-manifest.json` records each upstream icon hash, download URL, SHA-256 digest, image dimensions and existing local filename. PNGs contain the original downloaded bytes. The default PNG is 72 by 72 pixels and milestone PNGs are 80 by 80 pixels. SVG companions embed the same PNG bytes at a 24 by 24 display size, preserving existing filenames without recreating the artwork or requesting a remote image.

The default local filename remains `2ba85e8026a8614b640c2837bcdfe21b.png`. Milestones keep `premium_tenure_<months>_month_v2.png`. Profile badge icons use those basenames, so the local CDN serves the bundled artwork without fetching Discord's badge CDN.

The badge CDN route caches successful responses for 6 hours with `immutable`. After deploying replacement images at these existing URLs, an already cached image can remain visible until expiry. Refresh the affected browser or CDN cache when verifying the new artwork.

Check the pinned files offline:

```sh
bun scripts/tenure-badges.js --check
bun test scripts/tests/nitro-badges.test.cjs scripts/tests/free-features.test.cjs scripts/tests/profile-sync.test.cjs scripts/tests/pride-permanent.test.cjs
```

Run `bun scripts/tenure-badges.js` to regenerate SVG companions from the bundled PNGs without network access. Run `bun scripts/tenure-badges.js --download` to download the pinned PNGs again and regenerate companions. All PNGs must pass signature, dimensions and SHA-256 checks before the download command replaces any files. The old procedural gemstone renderer is no longer used.

For a later artwork update, verify the mapping against Discord's current badges, download originals into staging, inspect them and update the manifest with their digests and dimensions. Keep client code and cached Discord bundles outside Git.

Run `PORT=3002 bun scripts/dev/nitro-badges-smoke.mjs` against a seeded development instance. `TEST_ACCOUNT_FILE` selects another seed credential file, `CHROME_PATH` selects Chromium, `NITRO_BADGE_EXPECTED` optionally asserts a specific tier ID, such as `nitro_account_tenure_72_month`, and `NITRO_SMOKE_SCREENSHOT` saves a screenshot. The probe checks the profile response, all nine local image digests and the native DM and expanded profile badges and tooltips. Clicking the badge must not open a subscription dialog. It does not change account dates. Use a disposable database you created for any age fixtures.
