/* SPDX-License-Identifier: AGPL-3.0-only */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const load = (file, imports = {}) => {
    const module = { exports: {} };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } })
            .outputText,
        {
            module,
            exports: module.exports,
            require: (name) => {
                if (!(name in imports)) throw Error(name);
                return imports[name];
            },
        },
    );
    return module.exports;
};
const model = load("client/plugins/fosscordBadgeManagement/model.ts");
const catalog = () => [
    { badge_id: 22, legacy_id: "1", owned: true, hidden: false, hideable: true, reorderable: false, profile_badge: { id: "1" } },
    {
        badge_id: 1,
        legacy_id: "nitro_account_tenure_3_month",
        owned: true,
        hidden: false,
        hideable: false,
        reorderable: false,
        profile_badge: { id: "nitro_account_tenure_3_month" },
    },
    { badge_id: "custom:99", legacy_id: "99", owned: true, hidden: false, hideable: true, reorderable: true, profile_badge: { id: "99" } },
    { badge_id: "pride:rainbow", legacy_id: "8000000000000000001", owned: true, hidden: false, hideable: false, reorderable: true, profile_badge: { id: "8000000000000000001" } },
];
const plain = (value) => JSON.parse(JSON.stringify(value));

test("native preview permits hiding Staff, protects treatment-2 Nitro and Pride, and pins visible badges", () => {
    const badges = catalog();
    const pending = { pendingBadgeDisplayOrder: ["pride:rainbow", "custom:99", 1, 22], pendingBadgeHiddenBadges: [22, 1, "pride:rainbow"] };
    const edited = model.applyCatalog(badges, pending);
    assert.deepEqual(plain(edited.map((b) => b.badge_id)), [22, 1, "pride:rainbow", "custom:99"]);
    assert.equal(edited[0].hidden, true);
    assert.equal(edited[1].hidden, false);
    assert.equal(edited[2].hidden, false);
    const groups = model.splitBadges(edited);
    assert.deepEqual(plain(groups.fixedBadges.map((b) => b.badge_id)), [1]);
    assert.deepEqual(plain(groups.hiddenBadges.map((b) => b.badge_id)), [22]);
    assert.equal(badges[0].hidden, false);
    assert.deepEqual(
        plain(
            model
                .previewBadges(
                    badges.map((b) => b.profile_badge),
                    badges,
                    pending,
                )
                .map((b) => b.id),
        ),
        ["nitro_account_tenure_3_month", "8000000000000000001", "99"],
    );
});

test("treatment-1 hidden Nitro can be restored with its real tenure icon and ID", () => {
    const badges = catalog();
    badges[1].hideable = true;
    badges[1].hidden = true;
    const visible = badges.filter((b) => !b.hidden).map((b) => b.profile_badge);
    const restored = model.previewBadges(visible, badges, { pendingBadgeHiddenBadges: [] });
    assert.deepEqual(plain(restored.map((b) => b.id)), ["1", "nitro_account_tenure_3_month", "99", "8000000000000000001"]);
});

test("management mappings distinguish database Staff from native Nitro and clear private session mappings", () => {
    const registry = new model.BadgeRegistry();
    registry.remember(catalog());
    assert.equal(registry.managementId("1"), 22);
    assert.equal(registry.managementId("nitro_account_tenure_72_month"), 1);
    assert.equal(registry.managementId("8000000000000000001"), "pride:rainbow");
    assert.equal(registry.managementId("9007199254740993"), "custom:9007199254740993");
    assert.equal(registry.legacyId("pride:rainbow"), "8000000000000000001");
    registry.clear();
    assert.equal(registry.legacyId("pride:rainbow"), undefined);
});

test("every management patch matches the reviewed native module and preserves its syntax", () => {
    const plugin = load("client/plugins/fosscordBadgeManagement/index.ts", {
        "@utils/types": { default: (v) => v, __esModule: true },
        "../fosscordCore/shared": { FosscordAuthor: {} },
        "./bridge": {},
        "./style.css?managed": { default: "", __esModule: true },
    }).default;
    assert.equal(plugin.required, true);
    const cache = "assets/cache";
    if (!fs.existsSync(cache)) return;
    const modules = [];
    const files = fs.readdirSync(cache).filter((file) => /^web\.[\da-f]+\.js$/.test(file) || ["03371bf8615f484d.js", "3a1736d80bc7301a.js", "6933e98e0c87916d.js"].includes(file));
    for (const file of files) {
        const source = fs.readFileSync(cache + "/" + file, "utf8");
        const headers = [...source.matchAll(/(?:\d+|\d+e\d+)\(e,(?:t|i),(?:n|a)\)\{/g)];
        for (let i = 0; i < headers.length; i++)
            modules.push(source.slice(headers[i].index + headers[i][0].length, i + 1 < headers.length ? headers[i + 1].index - 2 : source.length).replace(/\}\}\]\);[\s\S]*$/, ""));
    }
    const normalize = (pattern) => pattern.replaceAll("\\i", "[A-Za-z_$][\\w$]*").replaceAll("#{intl::Ipxkog::raw}", '(?:\\.Ipxkog|\\["Ipxkog"\\])');
    for (const patch of plugin.patches) {
        const targets = modules.filter((source) => (typeof patch.find === "string" ? source.includes(patch.find) : new RegExp(normalize(patch.find.source)).test(source)));
        assert.equal(targets.length, 1, `unique module anchor ${patch.find}`);
        let source = targets[0];
        assert.ok(source, "module anchor " + patch.find);
        for (const replacement of Array.isArray(patch.replacement) ? patch.replacement : [patch.replacement]) {
            const pattern = normalize(replacement.match.source);
            const match = new RegExp(pattern, replacement.match.flags);
            assert.ok(match.test(source), patch.find + " " + replacement.match);
            source = source.replace(match, replacement.replace.replaceAll("$self", "BadgeManagement"));
        }
        assert.doesNotThrow(() => new Function("e", "t", "n", source), patch.find);
    }
});
