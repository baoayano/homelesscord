/* SPDX-License-Identifier: AGPL-3.0-only */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("typescript");
const { managementUtilities } = require("./helpers/badge-management.cjs");

function load(user, variant = 1) {
    const assigned = [
        { id: "1", description: "Test Instance Staff", icon: "staff_icon" },
        { id: "99", description: "Community helper", icon: "helper_icon" },
    ];
    const module = { exports: {} };
    let selection;
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync("src/api/util/utility/remoteBadges.ts", "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        }).outputText,
        {
            module,
            exports: module.exports,
            require(name) {
                if (name === "typeorm") return { In: (ids) => ids };
                if (name === "@spacebar/database")
                    return {
                        User: {
                            findOne: async (query) => {
                                selection = query.select;
                                return user;
                            },
                        },
                        Badge: { find: async () => assigned.filter((badge) => user.badge_ids.includes(badge.id)) },
                    };
                if (name === "@spacebar/util") return { loadStaffRoles: async () => ({}), staffBadgeRole: () => null, MAX_REMOTE_BADGE_DESCRIPTION: 100, MAX_REMOTE_BADGES: 12 };
                if (name === "./federationMedia") return { homeCdnBase: () => "http://localhost:3002" };
                if (name === "./prideBadges") return { PRIDE_BADGES: [], prideBadges: () => [] };
                if (name === "./profile") return { isSubscriptionBadge: () => false };
                if (name === "./staffBadge") return { STAFF_BADGE_ID: "1" };
                if (name === "./badgeManagement") return managementUtilities({ variant });
                throw Error(name);
            },
        },
    );
    return { homeBadges: module.exports.homeBadges, selection: () => selection };
}

const account = (settings) => ({
    id: "123",
    bot: false,
    system: false,
    flags: "0",
    created_at: new Date("2020-01-01T00:00:00.000Z"),
    registration_date: new Date("2020-01-01T00:00:00.000Z"),
    badge_ids: ["1", "99"],
    pride_badges: [],
    badge_settings: settings,
    federated_instance: null,
});

test("federation excludes hidden Staff and Nitro and preserves the visible badge order", async () => {
    const { homeBadges, selection } = load(account({ display_order: ["custom:99", "1", "22"], hidden_badges: ["22", "1"] }));
    const badges = await homeBadges("123");
    assert.deepEqual(
        Array.from(badges, (badge) => badge.id),
        ["badge-99"],
    );
    assert.equal(selection().badge_settings, true);
    assert.equal(selection().registration_date, true);
    assert.ok(!("badge_settings" in badges[0]));
});

test("federation includes the evolved Nitro tier under its visible treatment and applies saved order", async () => {
    const { homeBadges } = load(account({ display_order: ["custom:99", "1", "22"], hidden_badges: ["1"] }), 2);
    const badges = await homeBadges("123");
    assert.deepEqual(
        Array.from(badges, (badge) => badge.id),
        ["badge-99", "badge-nitro_account_tenure_72_month", "badge-1"],
    );
    assert.equal(badges[1].icon, "http://localhost:3002/badge-icons/premium_tenure_72_month_v2.png");
    assert.equal(badges[2].staff, true);
});

test("federation never exports a shadow account as an account of this instance", async () => {
    const user = account({ display_order: [], hidden_badges: [] });
    user.federated_instance = "remote.example";
    assert.equal((await load(user).homeBadges("123")).length, 0);
});
