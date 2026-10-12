/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const playwright = createRequire(path.join(homedir(), ".cache/fosscord-tools/package.json"))("playwright-core");
const accounts = parseEnv(readFileSync(process.env.TEST_ACCOUNT_FILE || path.join(root, "scripts/dev/.test-account"), "utf8"));
const origin = (process.env.ORIGIN || `http://localhost:${process.env.PORT || 3002}`).replace(/\/$/, "");
const manifest = JSON.parse(readFileSync(path.join(root, "assets/badge-icons/nitro-manifest.json")));
const login = async (login, password) => {
    const response = await fetch(`${origin}/api/v9/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ login, password }),
    });
    assert.equal(response.status, 200, "fixture login");
    return response.json();
};
const [self, friend] = await Promise.all([login(accounts.TEST_EMAIL, accounts.TEST_PASSWORD), login("friend@fosscord.test", accounts.FRIEND_PASSWORD)]);
const response = await fetch(`${origin}/api/v9/users/@me/profile`, { headers: { authorization: self.token } });
assert.equal(response.status, 200);
const profile = await response.json();
const nitro = profile.badges.filter((badge) => badge.id.startsWith("nitro_account_tenure_"));
const titles = {
    0: "NITRO",
    1: "NITRO BRONZE",
    3: "NITRO SILVER",
    6: "NITRO GOLD",
    12: "NITRO PLATINUM",
    24: "NITRO DIAMOND",
    36: "NITRO EMERALD",
    60: "NITRO RUBY",
    72: "NITRO OPAL",
};
assert.equal(nitro.length, 1, "exactly one free Nitro badge");
assert.equal(nitro[0].link, undefined, "no subscription destination");
assert.ok(profile.premium_since, "stable tenure date");
if (process.env.NITRO_BADGE_EXPECTED) assert.equal(nitro[0].id, process.env.NITRO_BADGE_EXPECTED);
for (const badge of manifest.badges) {
    const asset = await fetch(`${origin}/badge-icons/${badge.filename}`);
    assert.equal(asset.status, 200, badge.filename);
    assert.equal(
        createHash("sha256")
            .update(Buffer.from(await asset.arrayBuffer()))
            .digest("hex"),
        badge.sha256,
        badge.filename,
    );
}

const browser = await playwright.chromium.launch({ executablePath: process.env.CHROME_PATH || playwright.chromium.executablePath(), headless: true });
try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript((token) => localStorage.setItem("token", JSON.stringify(token)), friend.token);
    const page = await context.newPage();
    await page.goto(`${origin}/channels/@me`);
    await page.getByRole("button", { name: "User Settings", exact: true }).waitFor({ timeout: 45000 });
    await page.getByText("All", { exact: true }).first().click();
    await page
        .locator("[class*=peopleListItem]")
        .filter({ hasText: profile.user.global_name || profile.user.username })
        .first()
        .dblclick();
    const selector = `img[src*="badge-icons/${nitro[0].icon}.png"]`;
    const image = page.locator(selector).first();
    await image.waitFor({ timeout: 20000 });
    await page.waitForFunction((selector) => [...document.querySelectorAll(selector)].every((image) => image.complete && image.naturalWidth > 0), selector);
    assert.ok(await image.isVisible(), "DM side profile badge is visible");
    const source = await image.getAttribute("src");
    assert.equal(new URL(source, origin).origin, origin, "badge uses this instance's CDN");
    const trigger = image.locator("..");
    await trigger.hover();
    const card = page.locator('[data-mana-component="mini-premium-tooltip"]');
    await card.waitFor();
    const tooltip = await card.innerText();
    const months = /^nitro_account_tenure_(\d+)_month$/.exec(nitro[0].id)[1];
    const body = await page.evaluate(
        (date) => `Nitro since ${new Intl.DateTimeFormat(navigator.language, { dateStyle: "short", timeZone: "UTC" }).format(new Date(date))}`,
        profile.premium_since,
    );
    assert.ok(tooltip.includes(titles[months]), `native Nitro tier title: ${tooltip}`);
    assert.ok(tooltip.includes(body), `registration date caption: ${tooltip}`);
    await page.waitForFunction(() => [...document.querySelectorAll('[data-mana-component="mini-premium-tooltip"] img')].every((image) => image.complete && image.naturalWidth > 0));
    assert.ok((await card.locator("img").count()) > 0, "large badge artwork is present");
    for (const image of await card.locator("img").all()) assert.equal(new URL(await image.getAttribute("src"), origin).origin, origin, "tooltip artwork is local");
    const link = await image.evaluate((element) => element.closest("a")?.getAttribute("href") ?? null);
    assert.equal(link, null, "badge does not link to a subscription page");
    await trigger.click();
    assert.equal(await page.getByRole("dialog").count(), 0, "badge click does not open a subscription modal");
    await page.mouse.move(0, 0);
    await page.getByText("View Full Profile", { exact: true }).click();
    const expanded = page.getByRole("dialog").filter({ has: page.locator(selector) });
    await expanded.waitFor();
    const expandedImage = expanded.locator(selector).first();
    assert.ok(await expandedImage.isVisible(), "expanded profile badge is visible");
    await expandedImage.locator("..").hover();
    await card.waitFor();
    assert.ok((await card.innerText()).includes(titles[months]), "expanded profile uses the earned tier title");
    assert.ok((await card.innerText()).includes(body), "expanded profile uses the Nitro registration date");
    await page.mouse.move(0, 0);
    await card.waitFor({ state: "hidden" });
    await page.keyboard.press("Tab");
    await expandedImage.locator("..").focus();
    await card.waitFor();
    assert.ok((await card.innerText()).includes(titles[months]), "keyboard focus opens the native card");
    if (process.env.NITRO_CARD_SCREENSHOT) await card.screenshot({ path: process.env.NITRO_CARD_SCREENSHOT, animations: "disabled" });
    if (process.env.NITRO_SMOKE_SCREENSHOT) await page.screenshot({ path: process.env.NITRO_SMOKE_SCREENSHOT });
    console.log(
        JSON.stringify({
            badge: nitro[0].id,
            premium_since: profile.premium_since,
            local_assets: manifest.badges.length,
            tooltip,
            side_profile: "passed",
            expanded_profile: "passed",
        }),
    );
} finally {
    await browser.close();
}
