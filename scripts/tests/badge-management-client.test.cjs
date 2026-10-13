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
const drag = load("client/plugins/fosscordBadgeManagement/dragModel.ts");
const catalog = () => [
    { badge_id: 22, legacy_id: "1", owned: true, hidden: false, hideable: true, reorderable: true, profile_badge: { id: "1" } },
    {
        badge_id: 1,
        legacy_id: "nitro_account_tenure_3_month",
        owned: true,
        hidden: false,
        hideable: false,
        reorderable: true,
        profile_badge: { id: "nitro_account_tenure_3_month" },
    },
    { badge_id: "custom:99", legacy_id: "99", owned: true, hidden: false, hideable: true, reorderable: true, profile_badge: { id: "99" } },
    { badge_id: "pride:rainbow", legacy_id: "8000000000000000001", owned: true, hidden: false, hideable: false, reorderable: true, profile_badge: { id: "8000000000000000001" } },
];
const plain = (value) => JSON.parse(JSON.stringify(value));

test("Nitro progress follows the viewed badge rather than the viewer's level", () => {
    const badge = { ...catalog()[1], current_tier: "3", next_tier: "6", progress: [{ current: 4, floor: 3, threshold: 6 }] };
    const viewerBadge = { ...badge, current_tier: "72", next_tier: null, progress: [] };
    const props = { badge, viewerBadge, isViewingOtherUser: true, targetUsername: "friend" };
    const context = model.nitroProgressContext(props);
    assert.equal(context.badge, badge);
    assert.equal(context.viewerBadge, undefined);
    assert.equal(context.isViewingOtherUser, false);
    assert.equal(context.targetUsername, "friend");
    assert.equal(props.viewerBadge, viewerBadge);
    assert.equal(props.isViewingOtherUser, true);
    const self = { ...props, isViewingOtherUser: false };
    assert.equal(model.nitroProgressContext(self), self);
    const staff = { ...props, badge: catalog()[0] };
    assert.equal(model.nitroProgressContext(staff), staff);
});

test("native preview reorders Staff and Nitro while preserving their separate hiding rules", () => {
    const badges = catalog();
    const pending = { pendingBadgeDisplayOrder: ["pride:rainbow", "custom:99", 1, 22], pendingBadgeHiddenBadges: [22, 1, "pride:rainbow"] };
    const edited = model.applyCatalog(badges, pending);
    assert.deepEqual(plain(edited.map((b) => b.badge_id)), ["pride:rainbow", "custom:99", 1, 22]);
    assert.equal(edited[0].hidden, false);
    assert.equal(edited[2].hidden, false);
    assert.equal(edited[3].hidden, true);
    const groups = model.splitBadges(edited);
    assert.deepEqual(plain(groups.fixedBadges.map((b) => b.badge_id)), []);
    assert.deepEqual(plain(groups.reorderableBadges.map((b) => b.badge_id)), ["pride:rainbow", "custom:99", 1]);
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
        ["8000000000000000001", "99", "nitro_account_tenure_3_month"],
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

test("opening the editor preserves the saved server order without pending changes", () => {
    const saved = [catalog()[1], catalog()[2], catalog()[0], catalog()[3]];
    assert.deepEqual(plain(model.applyCatalog(saved, {}).map((badge) => badge.badge_id)), [1, "custom:99", 22, "pride:rainbow"]);
    assert.deepEqual(plain(model.splitBadges(model.applyCatalog(saved, {})).reorderableBadges.map((badge) => badge.badge_id)), [1, "custom:99", 22, "pride:rainbow"]);
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

test("pointer and keyboard reorder targets work across rows, edges and reversed moves", () => {
    const rects = [
        { id: "a", index: 0, left: 0, right: 40, top: 0, bottom: 40 },
        { id: "b", index: 1, left: 50, right: 90, top: 0, bottom: 40 },
        { id: "c", index: 2, left: 0, right: 40, top: 50, bottom: 90 },
        { id: "d", index: 3, left: 50, right: 90, top: 50, bottom: 90 },
    ];
    assert.equal(drag.pointerTarget(rects, 0, 85, 70).index, 3);
    assert.equal(drag.pointerTarget(rects, 3, 5, 20).index, 0);
    assert.equal(drag.pointerTarget(rects, 1, 5, 20).index, 0);
    assert.equal(drag.pointerTarget(rects, 1, 85, 70).index, 3);
    assert.equal(drag.keyboardIndex(rects, 0, "ArrowDown"), 2);
    assert.equal(drag.keyboardIndex(rects, 2, "ArrowUp"), 0);
    assert.equal(drag.keyboardIndex(rects, 1, "End"), 3);
    assert.equal(drag.keyboardIndex(rects, 1, "Home"), 0);
    assert.equal(drag.sameDragOrder(rects, ["a", "b", "c", "d"]), true);
    assert.equal(drag.sameDragOrder(rects, ["a", "c", "b", "d"]), false);
});

test("badge details wait for the viewer badge before reading its fields", () => {
    const plugin = load("client/plugins/fosscordBadgeManagement/index.ts", {
        "@utils/types": { default: (value) => value, __esModule: true },
        "../fosscordCore/shared": { FosscordAuthor: {} },
        "./bridge": {},
        "./style.css?managed": { default: "", __esModule: true },
    }).default;
    const details = plugin.patches.find((patch) => patch.find === '"badge-details"');
    const apply = (source, replacement) => {
        const pattern = replacement.match.source.replaceAll("\\i", "[A-Za-z_$][\\w$]*");
        return source.replace(new RegExp(pattern, replacement.match.flags), replacement.replace.replaceAll("$self", "helpers"));
    };
    const maxed = details.replacement.find((replacement) => replacement.replace.includes("useMaxedDescription"));
    const legacy = details.replacement.find((replacement) => replacement.replace.includes("!$self.isLegacy"));
    const legacyPredicate = details.replacement.find((replacement) => replacement.replace === " $self.isLegacy($1)");
    const helpers = {
        useMaxedDescription: (badge) => badge.badge_id !== 1,
        isLegacy: (badge) => badge.is_legacy === true,
    };
    const maxedExpression = apply("!viewer&&badge?.owned===!0&&(badge.tiers?.length??0)>0&&null==badge.next_tier", maxed);
    const legacyExpression = apply('!badge||badge.is_earnable||flag||badge.badge_id===U.$.STAFF?null:"offer"', legacy);
    assert.notEqual(maxedExpression, "!viewer&&badge?.owned===!0&&(badge.tiers?.length??0)>0&&null==badge.next_tier");
    assert.notEqual(legacyExpression, '!badge||badge.is_earnable||flag||badge.badge_id===U.$.STAFF?null:"offer"');
    const showMaxed = new Function("badge", "helpers", "viewer", `return ${maxedExpression}`);
    const showLegacyAction = new Function("badge", "helpers", "flag", "U", `return ${legacyExpression}`);
    const isLegacy = new Function("badge", "helpers", apply("return(0,N.ie)(badge.badge_id)&&!badge.is_earnable&&badge.badge_id!==U.$.STAFF", legacyPredicate));
    assert.equal(isLegacy({ badge_id: 1, is_legacy: false }, helpers), false);
    assert.equal(isLegacy({ badge_id: 99, is_legacy: true }, helpers), true);
    assert.equal(showMaxed(undefined, helpers, false), false);
    assert.equal(showMaxed({ badge_id: 1, owned: true, tiers: [{}], next_tier: null }, helpers, false), false);
    assert.equal(showMaxed({ badge_id: 22, owned: true, tiers: [{}], next_tier: null }, helpers, false), true);
    assert.equal(showLegacyAction(undefined, helpers, false, { $: { STAFF: 22 } }), null);
    assert.equal(showLegacyAction({ badge_id: 99, is_legacy: false }, helpers, false, { $: { STAFF: 22 } }), null);
});

test("profile badge overflow keeps the native visible limit and remaining count", () => {
    const plugin = load("client/plugins/fosscordBadgeManagement/index.ts", {
        "@utils/types": { default: (value) => value, __esModule: true },
        "../fosscordCore/shared": { FosscordAuthor: {} },
        "./bridge": {},
        "./style.css?managed": { default: "", __esModule: true },
    }).default;
    const rows = plugin.patches.find((patch) => patch.find === "UserProfileBadgeListRows");
    let source = "let P=M?Math.max(b.length-d.k9,0):0;let t=M?[b.slice(0,d.k9)]:[b];";
    for (const replacement of rows.replacement) {
        const pattern = replacement.match.source.replaceAll("\\i", "[A-Za-z_$][\\w$]*");
        source = source.replace(new RegExp(pattern, replacement.match.flags), replacement.replace.replaceAll("$self", "BadgeManagement"));
    }
    const render = new Function("badges", "limit", "enabled", `const b=badges,d={k9:limit},M=enabled;${source}return {count:P,visible:t[0]};`);
    const badges = Array.from({ length: 9 }, (_, index) => index);
    assert.deepEqual(render(badges, 6, true), { count: 3, visible: badges.slice(0, 6) });
    assert.deepEqual(render(badges.slice(0, 5), 6, true), { count: 0, visible: badges.slice(0, 5) });
    assert.deepEqual(render(badges, 6, false), { count: 0, visible: badges });
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
