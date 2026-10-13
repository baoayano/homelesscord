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
