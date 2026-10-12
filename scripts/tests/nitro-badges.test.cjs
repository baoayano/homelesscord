/* SPDX-License-Identifier: AGPL-3.0-only */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const moduleUnderTest = { exports: {} };
vm.runInNewContext(
    ts.transpileModule(fs.readFileSync("src/api/util/utility/nitroBadges.ts", "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
        module: moduleUnderTest,
        exports: moduleUnderTest.exports,
        require: () => ({ UserFlags: { FLAGS: { SYSTEM: 4096n } } }),
    },
);
const { nitroBadge } = moduleUnderTest.exports;
const badgeAt = (created, now, overrides = {}) => nitroBadge({ created_at: new Date(created), bot: false, system: false, flags: 0, ...overrides }, "Example", new Date(now));
const manifest = JSON.parse(fs.readFileSync("assets/badge-icons/nitro-manifest.json"));

test("every new ordinary account immediately receives the free default badge", () => {
    const date = "2026-10-12T10:23:45.678Z";
    const result = badgeAt(date, date, { premium: false, premium_type: 0, hide_premium_badge: true, premium_since: null });
    assert.equal(result.badge.id, "nitro_account_tenure_0_month");
    assert.equal(result.since.toISOString(), date);
    assert.match(result.badge.description, /Example Nitro badge: New member/);
    assert.equal(result.badge.link, undefined);
});

test("each registration milestone switches exactly at its UTC anniversary and uses a bundled PNG", () => {
    const created = "2020-01-15T12:34:56.789Z";
    for (let i = 1; i < manifest.badges.length; i++) {
        const milestone = manifest.badges[i];
        const at = new Date(created);
        at.setUTCMonth(at.getUTCMonth() + milestone.months);
        const overrides = { registration_date: new Date(created), created_at: new Date("2026-10-12") };
        const before = badgeAt(created, new Date(at.getTime() - 1), overrides);
        const after = badgeAt(created, at, overrides);
        assert.equal(before.badge.id, `nitro_account_tenure_${manifest.badges[i - 1].months}_month`);
        assert.equal(after.badge.id, `nitro_account_tenure_${milestone.months}_month`);
        assert.equal(`${after.badge.icon}.png`, milestone.filename);
        assert.ok(fs.existsSync(`assets/badge-icons/${after.badge.icon}.png`));
        assert.equal(after.since.toISOString(), created);
    }
    assert.equal(`${badgeAt(created, created).badge.icon}.png`, manifest.badges[0].filename);
});

test("short months clamp the anniversary to the last day without losing UTC time", () => {
    for (const [created, anniversary] of [
        ["2023-01-31T23:45:00.123Z", "2023-02-28T23:45:00.123Z"],
        ["2024-01-31T23:45:00.123Z", "2024-02-29T23:45:00.123Z"],
        ["2024-02-29T23:45:00.123Z", "2025-02-28T23:45:00.123Z"],
        ["2024-08-31T23:45:00.123Z", "2024-09-30T23:45:00.123Z"],
    ]) {
        const expected = created.startsWith("2024-02-29") ? 12 : 1;
        const at = new Date(anniversary);
        assert.notEqual(badgeAt(created, new Date(at.getTime() - 1)).badge.id, `nitro_account_tenure_${expected}_month`);
        assert.equal(badgeAt(created, at).badge.id, `nitro_account_tenure_${expected}_month`);
    }
});

test("progression defaults to account creation and caps at 72 months", () => {
    const created = "2000-01-01T00:00:00Z";
    for (const premium_type of [0, 1, 2]) {
        const result = badgeAt(created, "2026-10-12", { premium_type, premium_since: new Date("2026-10-11") });
        assert.equal(result.badge.id, "nitro_account_tenure_72_month");
        assert.equal(result.since.toISOString(), new Date(created).toISOString());
    }
});

test("an explicit registration date overrides account creation and premium dates", () => {
    const registration_date = new Date("2020-01-31T10:23:45.678Z");
    const result = badgeAt("2026-10-12", "2026-10-12", { registration_date, premium_since: new Date("2026-10-12") });
    assert.equal(result.badge.id, "nitro_account_tenure_72_month");
    assert.equal(result.since.toISOString(), registration_date.toISOString());
    assert.match(result.badge.description, /Nitro since 2020-01-31/);
    const reset = badgeAt("2026-10-12", "2026-10-12", { registration_date: null });
    assert.equal(reset.badge.id, "nitro_account_tenure_0_month");
});

test("a future registration override retains the default badge on an old account", () => {
    const result = badgeAt("2000-01-01", "2026-10-12", { registration_date: new Date("2027-01-01") });
    assert.equal(result.badge.id, "nitro_account_tenure_0_month");
    assert.equal(result.since, null);
});

test("bots and system accounts do not acquire human tenure badges", () => {
    for (const overrides of [{ bot: true }, { system: true }, { flags: 4096 }, { flags: 4097 }]) assert.equal(badgeAt("2020-01-01", "2026-10-12", overrides), null);
    assert.ok(badgeAt("2020-01-01", "2026-10-12", { flags: 1 }));
});

test("future and invalid creation dates retain the default badge without inventing a tenure date", () => {
    for (const created of ["invalid", "2027-01-01"]) {
        const result = badgeAt(created, "2026-10-12");
        assert.equal(result.badge.id, "nitro_account_tenure_0_month");
        assert.equal(result.since, null);
        assert.doesNotMatch(result.badge.description, /Nitro since/);
    }
});
