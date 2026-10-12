# Badge management

The required FosscordBadgeManagement plugin connects the native badge directory and customization popover to the server catalog. Open User Settings, Profiles, Your badges, View Badges, then Customize Your Badges. The profile badge pencil opens the same popover. Drag ordinary badges or use Move to Front and Move to Back. Hide or unhide eligible badges from More options, then choose Save. Reset discards pending edits.

| Route | Response |
| --- | --- |
| `GET /users/@me/badges` | Owned badges, including hidden badges, and the account's saved settings. |
| `GET /users/:user_id/badges` | Visible owned badges when viewing another account. |
| `GET /users/:user_id/badges/:badge_id` | One owned badge. A hidden badge returns 404 to other viewers. |
| `PATCH /users/@me/badges/settings` | Saved `display_order` and `hidden_badges`. |

All routes require authentication. Settings apply to the authenticated account only. Badges retain their existing profile IDs; the management catalog uses numeric ID 22 for Staff, numeric ID 1 for the evolving Nitro family, `custom:<database-id>` for other assigned badges and `pride:<flag-slug>` for selected Pride flags. Catalog entries include `legacy_id` and `profile_badge` for the client adapter. Nitro keeps the same management ID when its tier changes. Catalog artwork uses the configured instance CDN. The catalog contains owned badges and no purchase offers.

Staff can be hidden. When visible, Staff stays first and Nitro follows it. Accounts with hidden or absent Staff show visible Nitro first. Other owned badges can be reordered. Pride remains visible, including when a stored preference has been forged to hide it. Selection continues through the existing permanent Pride picker.

Nitro can be hidden only when the server assigns treatment 1 of `2026-08-badge-management` to the account. Treatment 2, control and unknown treatments keep Nitro visible. The policy uses the existing Apex assignment resolver, including user overrides, global grants and rollout precedence. A browser-only override does not change server permission. Changing treatment to 2 makes Nitro visible on the next profile request even if its hidden preference was stored under treatment 1.

The reviewed Discord build 633029 defines this User/Apex experiment with hash 3093904580. Treatment 1 sets `enabled: true` and `tenureBadgeHideable: true`; treatment 2 sets `enabled: true` and `tenureBadgeHideable: false`. The server assigns treatment 2 and treatment 1 of `2026-05-badge-discovery-milestone-2` by default. The adapter uses server metadata for hiding and pinning, keeps every selected Pride badge in profile rows beyond the native 6 badge limit, and removes purchase, gifting, Boost, Quests and Orbs actions from directory details. The permanent Pride picker remains available independently of management treatments.

Settings accept at most 512 unique owned badge IDs per array. An omitted field preserves its current eligible preferences. An empty array resets that field. Fixed Staff/Nitro IDs in `display_order` are ignored; their visible position stays fixed. Unknown, foreign, duplicate and protected hidden IDs return 400 before anything is saved. Numeric 1 and 22 or their string equivalents identify Nitro and Staff. Other IDs use the catalog's namespaced strings.

Updates run in a database transaction, with a PostgreSQL row lock or SQLite transaction serialization, and write only `users.badge_settings`. Concurrent partial updates preserve the other field. No-op updates avoid observer broadcasts. User updates are broadcast after a successful change. Profile responses apply preferences in both global and guild views. Public user objects do not expose private badge settings. Removed badge assignments and deselected flags cannot appear through stale preferences.

Migration `1792059984627` adds nullable JSONB settings on PostgreSQL and JSON text on SQLite. It preserves existing accounts and preferences across repeated runs. The SQLite baseline is unchanged.

Run `bun test scripts/tests/badge-management-client.test.cjs scripts/tests/badge-management.test.cjs scripts/tests/profile-sync.test.cjs scripts/tests/free-features.test.cjs scripts/tests/pride-permanent.test.cjs scripts/tests/sqlite-database.test.cjs` after building. Use a database created for the test run for API fixtures and treatment grants. Never change a user's live database to create test badges.

Verification on a fresh PostgreSQL instance passes catalog access, authentication, owned ID validation, hidden badge privacy, both Nitro treatments, Staff visibility, Pride protection, reset and global/guild profiles. Eight pairs of simultaneous partial updates retain both fields. API parity has 151 passes, 1 provider skip and 0 failures. PostgreSQL and SQLite migration repetition, preservation and rollback pass; SQLite preferences persist after reopening and remain excluded from default user selections.

Nitro details contain nine levels, bundled large artwork, earned dates and progress toward the next level. Progress uses completed UTC registration months and the same clamped anniversaries as the profile badge. Staff and custom badges keep their existing artwork. The native editor previews pending changes using the original profile IDs and clears private ID mappings when the account logs out.

Native browser verification uses the feature bundle served on port 3002, with API and gateway traffic sent to a fresh QA database. It passes Staff hiding and restoration, both Nitro treatments, protected Pride menus, drag and menu reordering, Save, Reset, persisted preferences after reload, keyboard menu actions and the Profiles settings entry. Nitro details show all nine levels and no purchase actions. An 11 badge popover fits a 390 pixel viewport without horizontal overflow.
