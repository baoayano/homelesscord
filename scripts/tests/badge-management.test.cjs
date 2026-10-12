/* SPDX-License-Identifier: AGPL-3.0-only */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { managementUtilities } = require("./helpers/badge-management.cjs");
const { Database } = require("bun:sqlite");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const fixture = () => ({
    user: { id: "user", created_at: new Date("2020-01-01"), bot: false, system: false, flags: 0, badge_ids: ["123", "1", "456"], pride_badges: ["rainbow"] },
    assigned: [
        { id: "456", description: "Second custom", icon: "custom_b" },
        { id: "1", description: "Edited Staff", icon: "custom_staff" },
        { id: "123", description: "First custom", icon: "custom_a" },
    ],
});
const ids = (catalog) => Array.from(catalog, (badge) => String(badge.badge_id));
const plain = (value) => JSON.parse(JSON.stringify(value));

test("catalog uses stable native Staff/Nitro IDs and collision-free custom and Pride IDs", () => {
    const api = managementUtilities();
    const { user, assigned } = fixture();
    const catalog = api.buildBadgeCatalog(user, assigned);
    assert.deepEqual(ids(catalog), ["22", "1", "custom:123", "custom:456", "pride:rainbow"]);
    assert.equal(catalog[0].hideable, true);
    assert.equal(catalog[1].hideable, false);
    assert.equal(catalog[1].legacy_id, "nitro_account_tenure_72_month");
    assert.equal(catalog[1].tiers.length, 9);
    assert.ok(catalog.every((badge) => badge.owned && badge.simple_icon_url.startsWith("http://localhost:3003/badge-icons/")));
    assert.ok(catalog.every((badge) => badge.is_earnable === (badge.badge_id === 1)));
    assert.deepEqual(
        assigned.map((badge) => badge.id),
        ["456", "1", "123"],
    );
    assert.deepEqual(user.badge_ids, ["123", "1", "456"]);
});

test("directory metadata gives ordinary badges their real title and description without invented dates or tiers", () => {
    const api = managementUtilities();
    const { user, assigned } = fixture();
    const catalog = api.buildBadgeCatalog(user, assigned);
    const staff = catalog[0];
    const custom = catalog[2];
    const pride = catalog.find((badge) => badge.badge_id === "pride:rainbow");
    assert.equal(staff.info_label, "Instance staff");
    assert.equal(staff.rarity, 5);
    assert.match(staff.description, /Test Instance/);
    assert.equal(custom.name, "First custom");
    assert.notEqual(custom.description, custom.name);
    assert.equal(custom.current_tier, null);
    assert.deepEqual(plain(custom.tiers), []);
    assert.equal(custom.obtained_at, null);
    assert.equal(custom.is_legacy, false);
    assert.equal(pride.info_label, "Pride flag");
    assert.equal(pride.hideable, false);
});

test("Staff may be hidden in all treatments while Nitro may only be hidden in treatment 1", () => {
    for (const variant of [0, 1, 2, 3]) {
        const api = managementUtilities({ variant });
        const { user, assigned } = fixture();
        user.badge_settings = { display_order: [], hidden_badges: ["22", "1"] };
        const catalog = api.buildBadgeCatalog(user, assigned);
        assert.equal(catalog[0].hidden, true);
        assert.equal(catalog[1].hidden, variant === 1);
        assert.equal(
            api.visibleProfileBadges(catalog).some((badge) => badge.id === "1"),
            false,
        );
        assert.equal(
            api.visibleProfileBadges(catalog).some((badge) => badge.id.startsWith("nitro_account_tenure_")),
            variant !== 1,
        );
        const staff = api.updateBadgeSettings(user, catalog, { hidden_badges: [22] });
        assert.deepEqual(plain(staff.hidden_badges), ["22"]);
        if (variant === 1) assert.deepEqual(plain(api.updateBadgeSettings(user, catalog, { hidden_badges: [1] }).hidden_badges), ["1"]);
        else assert.throws(() => api.updateBadgeSettings(user, catalog, { hidden_badges: [1] }), /hidden_badges/);
    }
});

test("visible Staff and Nitro remain pinned while other owned badges may be reordered", () => {
    const api = managementUtilities({ variant: 1 });
    const { user, assigned } = fixture();
    const initial = api.buildBadgeCatalog(user, assigned);
    user.badge_settings = api.updateBadgeSettings(user, initial, { display_order: ["pride:rainbow", "custom:456", 1, 22, "custom:123"], hidden_badges: ["custom:123"] });
    assert.deepEqual(plain(user.badge_settings.display_order), ["pride:rainbow", "custom:456", "custom:123"]);
    const catalog = api.buildBadgeCatalog(user, assigned);
    assert.deepEqual(ids(catalog), ["22", "1", "pride:rainbow", "custom:456", "custom:123"]);
    assert.deepEqual(
        Array.from(api.visibleProfileBadges(catalog), (badge) => badge.icon),
        ["custom_staff", "premium_tenure_72_month_v2", "pride_rainbow", "custom_b"],
    );
});

test("Pride cannot be hidden by settings or a forged stored preference in any treatment", () => {
    for (const variant of [0, 1, 2]) {
        const api = managementUtilities({ variant });
        const { user, assigned } = fixture();
        user.badge_settings = { display_order: [], hidden_badges: ["pride:rainbow"] };
        const catalog = api.buildBadgeCatalog(user, assigned);
        assert.equal(catalog.at(-1).hidden, false);
        assert.equal(catalog.at(-1).hideable, false);
        assert.throws(() => api.updateBadgeSettings(user, catalog, { hidden_badges: ["pride:rainbow"] }), /hidden_badges/);
        assert.deepEqual(plain(api.updateBadgeSettings(user, catalog, {}).hidden_badges), []);
    }
});

test("settings reject foreign, unknown, duplicate, unsafe numeric and oversized badge IDs atomically", () => {
    const api = managementUtilities({ variant: 1 });
    const { user, assigned } = fixture();
    const catalog = api.buildBadgeCatalog(user, assigned);
    for (const value of [["custom:foreign"], ["custom:123", "custom:123"], [NaN], [Number("9007199254740993")], [null], Array(513).fill(22), null, "22", [{ id: 22 }]]) {
        assert.throws(() => api.updateBadgeSettings(user, catalog, { display_order: ["custom:456"], hidden_badges: value }));
        assert.equal(user.badge_settings, undefined);
    }
});

test("partial updates preserve the other preference and empty arrays reset it", () => {
    const api = managementUtilities({ variant: 1 });
    const { user, assigned } = fixture();
    user.badge_settings = { display_order: ["custom:456"], hidden_badges: ["22", "custom:123"] };
    const catalog = api.buildBadgeCatalog(user, assigned);
    assert.deepEqual(plain(api.updateBadgeSettings(user, catalog, { display_order: [] })), { display_order: [], hidden_badges: ["22", "custom:123"] });
    assert.deepEqual(plain(api.updateBadgeSettings(user, catalog, { hidden_badges: [] })), { display_order: ["custom:456"], hidden_badges: [] });
});

test("Nitro hidden preference survives tier evolution and protected bots do not gain tenure badges", () => {
    const api = managementUtilities({ variant: 1 });
    const { user, assigned } = fixture();
    user.created_at = new Date("2026-01-01");
    user.badge_settings = { display_order: [], hidden_badges: ["1"] };
    for (const now of ["2026-01-01", "2026-02-01", "2026-07-01"]) assert.equal(api.buildBadgeCatalog(user, assigned, new Date(now))[1].hidden, true);
    for (const fields of [{ bot: true }, { system: true }, { flags: 4096 }])
        assert.equal(
            api.buildBadgeCatalog({ ...user, ...fields }, assigned).some((badge) => badge.badge_id === 1),
            false,
        );
});

test("malformed and oversized target IDs fail before database access", async () => {
    const api = managementUtilities();
    for (const id of ["not-a-snowflake", "", "18446744073709551615", "9".repeat(21), "1 OR 1=1"]) await assert.rejects(api.loadBadgeCatalog(id), /user_id/);
});

test("SQLite badge settings migration preserves accounts and customized settings across repeat runs and rollback", async () => {
    const db = new Database(":memory:");
    const module = { exports: {} };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync("src/database/migration/sqlite/1792059984627-UserBadgeSettings.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } })
            .outputText,
        { module, exports: module.exports },
    );
    const migration = new module.exports.UserBadgeSettings1792059984627();
    const runner = { query: async (sql) => (sql.startsWith("PRAGMA") ? db.query(sql).all() : db.run(sql)) };
    try {
        db.run("CREATE TABLE users (id text primary key, username text)");
        db.run("INSERT INTO users VALUES ('1', 'preserved')");
        await migration.up(runner);
        db.run("UPDATE users SET badge_settings = ?", JSON.stringify({ display_order: [], hidden_badges: ["22"] }));
        await migration.up(runner);
        assert.equal(db.query("SELECT username FROM users").get().username, "preserved");
        assert.equal(JSON.parse(db.query("SELECT badge_settings FROM users").get().badge_settings).hidden_badges[0], "22");
        await migration.down(runner);
        await migration.down(runner);
        assert.equal(
            db
                .query("PRAGMA table_info(users)")
                .all()
                .some((column) => column.name === "badge_settings"),
            false,
        );
    } finally {
        db.close();
    }
});

test("Nitro directory progress and earned tiers follow the configured UTC registration anniversaries", () => {
    const api = managementUtilities();
    const { user, assigned } = fixture();
    user.registration_date = new Date("2025-01-31T12:34:56Z");
    const at = (date) => api.buildBadgeCatalog(user, assigned, new Date(date)).find((badge) => badge.badge_id === 1);
    const bronze = at("2025-02-28T12:34:56Z");
    assert.equal(bronze.current_tier, "1");
    assert.equal(bronze.info_label, "Nitro since 2025-01-31");
    assert.equal(bronze.tiers[0].name, "Starter");
    assert.equal(bronze.tiers[2].rarity, 2);
    assert.equal(bronze.tiers[4].milestone_text, "1 year");
    assert.equal(bronze.tier_obtained_at["1"], "2025-02-28T12:34:56.000Z");
    assert.deepEqual(plain(bronze.progress), [{ type: "months", current: 1, floor: 1, threshold: 3, progress_helper_text: "2 months until the next level" }]);
    assert.deepEqual(plain(bronze.tiers.filter((tier) => tier.owned).map((tier) => tier.key)), ["0", "1"]);
    assert.equal(at("2025-03-31T12:34:55Z").progress[0].current, 1);
    assert.equal(at("2025-03-31T12:34:56Z").progress[0].current, 2);
    assert.equal(at("2031-01-31T12:34:56Z").progress.length, 0);
    user.registration_date = new Date("2035-01-01T00:00:00Z");
    const future = at("2025-02-28T12:34:56Z");
    assert.equal(future.obtained_at, null);
    assert.equal(future.current_tier, "0");
    assert.deepEqual(plain(future.tier_obtained_at), {});
    assert.deepEqual(plain(future.progress), []);
});
