const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");

const cachedBundles = (fs.existsSync("assets/cache") ? fs.readdirSync("assets/cache") : []).filter((file) => /^web\.[0-9a-f]+\.js$/.test(file));

test("native official reply patch preserves other system and guild restrictions", { skip: cachedBundles.length === 0 }, () => {
    const module = { exports: {} };
    const source = ts.transpileModule(fs.readFileSync("client/plugins/fosscordOfficialMessages/index.ts", "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText;
    vm.runInNewContext(source, {
        module,
        exports: module.exports,
        require: (name) => (name === "@utils/types" ? { default: (value) => value, __esModule: true } : { FosscordAuthor: {} }),
    });
    const patch = module.exports.default.patches[0].replacement;
    const match = new RegExp(patch.match.source.replaceAll("\\i", "[A-Za-z_$][\\w$]*"), patch.match.flags);
    const original = cachedBundles.map((file) => fs.readFileSync(path.join("assets/cache", file), "utf8").match(match)?.[0]).find(Boolean);
    assert.ok(original, "patch must match the cached actual native channel class");
    const changed = original.replace(match, patch.replace);
    const constants = original.match(/this\.type===([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\.DM/);
    assert.ok(constants, "the native DM type constants must be available to the test harness");
    const Channel = new Function(constants[1], `return class { ${changed} }`)({ [constants[2]]: { DM: 1 } });
    const channel = new Channel();
    channel.type = 1;
    for (const [recipient, expected] of [
        [{ system: true, username: "official", discriminator: "0" }, false],
        [{ system: true, username: "announcements", discriminator: "0" }, true],
        [{ system: true, username: "official", discriminator: "1234" }, true],
        [{ system: false, username: "official", discriminator: "0" }, false],
        [null, false],
    ]) {
        channel.rawRecipients = [recipient];
        assert.equal(channel.isSystemDM(), expected);
    }
    channel.type = 0;
    channel.rawRecipients = [{ system: true, username: "announcements", discriminator: "0" }];
    assert.equal(channel.isSystemDM(), false);
});
