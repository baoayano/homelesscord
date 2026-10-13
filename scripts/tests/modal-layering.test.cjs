const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { homedir } = require("node:os");
let playwright;
try {
    playwright = require("playwright-core");
} catch {
    try {
        playwright = createRequire(path.join(homedir(), ".cache/fosscord-tools/package.json"))("playwright-core");
    } catch {}
}
const executablePath = process.env.CHROME_PATH || "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
const cachedCss = (fs.existsSync("assets/cache") ? fs.readdirSync("assets/cache") : [])
    .sort()
    .filter((file) => file.endsWith(".css"))
    .map((file) => path.join("assets/cache", file))
    .filter((file) => {
        const css = fs.readFileSync(file, "utf8");
        return [".layerContainer__59d0d{", ".layer_bc663c{", ".scrim__40128{"].some((selector) => css.includes(selector));
    });
const fixture = `<!doctype html><html><body><div class="layerContainer__59d0d">
<div class="scrim__40128" data-testid="backdrop"></div>
<div class="layer__59d0d layer_bc663c inactive_bc663c" data-testid="inactive"><section role="dialog" aria-label="Profile editor"><label>Display name<input value="Draft stays here"></label></section></div>
<div class="layer__59d0d layer_bc663c" data-testid="active"><section role="dialog" aria-label="Change banner"><h1>Select an image</h1><button type="button" data-testid="inside">Choose image</button></section></div>
<div class="layer__59d0d layer__529b0" data-testid="popout"><button type="button">Choose color</button></div>
</div><script>
window.state={backdrop:0,inactive:0,inside:0,popout:0};
document.querySelector('[data-testid="backdrop"]').onclick=()=>{state.backdrop++;document.querySelector('[data-testid="active"]').remove();document.querySelector('[data-testid="popout"]').remove();};
document.querySelector('[data-testid="inactive"]').onclick=()=>{state.inactive++;};
document.querySelector('[data-testid="inside"]').onclick=()=>{state.inside++;};
document.querySelector('[data-testid="popout"]').onclick=()=>{state.popout++;};
</script></body></html>`;
const fixtureCss = `body{margin:0;background:#191b20;color:white;font-family:Arial,sans-serif}.layerContainer__59d0d{--background-scrim:#0008;--space-24:24px}.layer_bc663c:not(.inactive_bc663c){pointer-events:none}.layer_bc663c section{width:75%;max-width:500px;height:200px;box-sizing:border-box;background:#30333b;padding:24px;pointer-events:auto}.layer_bc663c.inactive_bc663c section{width:100%;max-width:none;height:100%}.layer__529b0{left:30px;top:40px}.layer__529b0 button{height:40px}button,input{font:inherit}button{min-height:40px}`;

test("native modal layer hit-testing preserves current backdrop fix at desktop and mobile widths", {
    skip: !playwright || !fs.existsSync(executablePath) || cachedCss.length === 0,
}, async (t) => {
    const browser = await playwright.chromium.launch({ executablePath, headless: true });
    const nativeCss = cachedCss.map((file) => fs.readFileSync(file, "utf8")).join("\n");
    const patchCss = fs.readFileSync("client/plugins/fosscordModals/style.css", "utf8");
    try {
        for (const width of [1440, 390])
            await t.test(`${width}px original interception reproduced; current backdrop and popout work`, async () => {
                const page = await browser.newPage({ viewport: { width, height: 844 } });
                try {
                    await page.setContent(fixture);
                    await page.addStyleTag({
                        content: nativeCss + fixtureCss + '[class*="layerContainer__"] > [class*="scrim__"]{z-index:-1}',
                    });
                    assert.equal(await page.evaluate(() => document.elementFromPoint(12, 120)?.getAttribute("data-testid")), "inactive");
                    await page.mouse.click(12, 120);
                    assert.equal(await page.evaluate(() => state.backdrop), 0, "original scrim cannot receive outside click");
                    assert.equal(await page.evaluate(() => state.inactive), 1, "original inactive layer receives the click");
                    await page.evaluate(() => {
                        state.inactive = 0;
                    });
                    await page.addStyleTag({ content: patchCss });
                    assert.equal(
                        await page.evaluate(() => document.elementFromPoint(12, 120)?.getAttribute("data-testid")),
                        "backdrop",
                        "inactive editor must stay below backdrop",
                    );
                    await page.getByTestId("inside").click();
                    assert.equal(await page.evaluate(() => state.inside), 1);
                    await page.getByTestId("popout").getByRole("button").click();
                    assert.equal(await page.evaluate(() => state.popout), 1);
                    assert.equal(await page.evaluate(() => state.backdrop), 0, "inside/popout clicks do not dismiss");
                    await page.mouse.click(12, 120);
                    assert.equal(await page.evaluate(() => state.backdrop), 1);
                    assert.equal(await page.getByRole("dialog").count(), 1, "only nested picker closes");
                    assert.equal(await page.getByRole("textbox").inputValue(), "Draft stays here");
                    assert.equal(await page.evaluate(() => state.inactive), 0, "underlying editor cannot receive backdrop click");
                } finally {
                    await page.close();
                }
            });
    } finally {
        await browser.close();
    }
});

test("badge directory keeps profile portals and frames below the backdrop while preserving controls and drafts", {
    skip: !playwright || !fs.existsSync(executablePath) || cachedCss.length === 0,
}, async () => {
    const browser = await playwright.chromium.launch({ executablePath, headless: true });
    const nativeCss = cachedCss.map((file) => fs.readFileSync(file, "utf8")).join("\n");
    const modalCss = fs.readFileSync("client/plugins/fosscordModals/style.css", "utf8");
    const badgeCss = fs.readFileSync("client/plugins/fosscordBadgeManagement/style.css", "utf8");
    try {
        for (const width of [1440, 390]) {
            for (const container of ["layerContainer__59d0d", "clickTrapContainer__59d0d"]) {
                const page = await browser.newPage({ viewport: { width, height: 844 } });
                try {
                    const profileHtml = `<div class="layer__59d0d" data-testid="profile-portal" style="left:8px;top:80px">
<div class="user-profile-popout" style="width:140px;height:200px;background:royalblue"><input value="Unsaved profile draft">
<div data-testid="frame" style="position:absolute;inset:-15px;z-index:999;pointer-events:none">Profile decoration</div></div></div>`;
                    await page.setContent(`<main data-testid="background">Chat stays visible</main><div class="layerContainer__59d0d">
<div class="scrim__40128" data-testid="backdrop"></div>
<div class="layer__59d0d layer_bc663c"><section data-testid="directory"><div class="user-profile-popout" data-testid="preview">Badge preview</div>
<button data-testid="badge">Select badge</button></section></div>
<div class="layer__59d0d layer__529b0" data-testid="customization"><button>Badge customization menu</button></div>
${container.startsWith("clickTrap") ? `<div class="${container}">${profileHtml}</div>` : profileHtml}</div>`);
                    await page.addStyleTag({ content: nativeCss + fixtureCss + modalCss + badgeCss });
                    const profile = page.getByTestId("profile-portal");
                    const directory = page.getByTestId("directory");
                    assert.equal(await profile.isVisible(), true);
                    assert.equal(await page.evaluate(() => document.elementFromPoint(20, 100)?.closest('[data-testid="profile-portal"]') !== null), true);
                    await directory.evaluate((element) => element.setAttribute("data-fosscord-badge-directory", ""));
                    assert.equal(await profile.isVisible(), true, "the profile stays rendered underneath the backdrop");
                    assert.equal(await profile.evaluate((element) => getComputedStyle(element).zIndex), "-2");
                    assert.equal(await page.evaluate(() => document.elementFromPoint(20, 100)?.getAttribute("data-testid")), "backdrop");
                    assert.equal(await page.getByTestId("frame").isVisible(), true);
                    for (const id of ["background", "directory", "preview", "customization", "badge"]) {
                        assert.equal(await page.getByTestId(id).isVisible(), true, `${id} stays visible at ${width}px in ${container}`);
                    }
                    assert.equal(await profile.locator("input").inputValue(), "Unsaved profile draft");
                    await directory.evaluate((element) => element.remove());
                    assert.equal(await profile.evaluate((element) => getComputedStyle(element).zIndex), "auto", "closing the directory restores the original layer");
                    assert.equal(await page.evaluate(() => document.elementFromPoint(20, 100)?.closest('[data-testid="profile-portal"]') !== null), true);
                    assert.equal(await page.getByTestId("frame").isVisible(), true);
                    assert.equal(await profile.locator("input").inputValue(), "Unsaved profile draft");
                } finally {
                    await page.close();
                }
            }
        }
    } finally {
        await browser.close();
    }
});
