/* SPDX-License-Identifier: AGPL-3.0-only */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const load = (file, imports, globals = {}) => {
    const module = { exports: {} };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync(file, "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
        }).outputText,
        {
            module,
            exports: module.exports,
            require: (name) => {
                if (!(name in imports)) throw Error(name);
                return imports[name];
            },
            ...globals,
        },
    );
    return module.exports;
};
const harness = () => {
    let ready = false;
    const calls = [];
    const tools = load(
        "client/plugins/fosscordNitroBadges/tooltip.tsx",
        {
            "@webpack": {
                filters: { byCode: (filter) => filter },
                mapMangledModuleLazy: (anchor) =>
                    new Proxy(
                        {},
                        {
                            get: (_target, key) => {
                                assert.ok(ready, "webpack is accessed only when rendering");
                                calls.push({ anchor, key });
                                if (key === "MiniTooltip") return "NativeMiniTooltip";
                                if (key === "getArtwork") return (id) => ({ standard: `/assets/${id}.svg` });
                            },
                        },
                    ),
            },
            "@webpack/common": { React: { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) } },
        },
        { navigator: { language: "en-US" }, Date, Intl },
    );
    ready = true;
    return { ...tools, calls };
};
const badge = (months, description = "Example Nitro badge: Member • Nitro since 2020-01-31") => ({
    id: `nitro_account_tenure_${months}_month`,
    icon: `premium_tenure_${months}_month_v2`,
    description,
});

test("only the nine free Nitro IDs receive native cards, leaving pride, staff and paid badge IDs untouched", () => {
    const h = harness();
    for (const months of [0, 1, 3, 6, 12, 24, 36, 60, 72]) assert.equal(h.isNitroBadge(badge(months)), true);
    for (const id of [
        "premium",
        "premium_tenure_3_month_v2",
        "guild_booster",
        "pride_rainbow",
        "8000000000000000001",
        "1",
        "nitro_account_tenure_99_month",
        "nitro_account_tenure_03_month",
    ]) {
        assert.equal(h.isNitroBadge({ id }), false);
        assert.equal(h.renderNitroBadge({ id }, { props: { src: "unused" } }), null);
    }
    assert.equal(h.calls.length, 0);
});

test("Silver cards use the native component, official artwork, formatted UTC date and existing small icon", () => {
    const h = harness();
    const image = { type: "img", props: { src: "/badge-icons/premium_tenure_3_month_v2.png" } };
    const card = h.renderNitroBadge(badge(3), image);
    assert.equal(card.type, "NativeMiniTooltip");
    assert.equal(card.props.title, "NITRO SILVER");
    assert.equal(card.props.body, "Nitro since 1/31/20");
    assert.equal(card.props.variant, "nitro");
    assert.equal(card.props.badgeImage, "/assets/premium_tenure_3_month_v2.svg");
    const trigger = card.props.children[0];
    assert.equal(trigger.props.children[0], image);
    assert.equal(trigger.props.tabIndex, 0);
    let prevented = 0;
    trigger.props.onClick({ preventDefault: () => prevented++, stopPropagation: () => prevented++ });
    assert.equal(prevented, 2);
    assert.equal(trigger.props.href, undefined);
});

test("default cards reuse the bundled classic icon and have a caption when the date is unavailable", () => {
    const h = harness();
    const image = { props: { src: "/badge-icons/2ba85e8026a8614b640c2837bcdfe21b.png" } };
    const card = h.renderNitroBadge(badge(0, "Example Nitro badge: New member"), image);
    assert.equal(card.props.title, "NITRO");
    assert.equal(card.props.body, "New member");
    assert.equal(card.props.badgeImage, image.props.src);
    assert.equal(
        h.calls.some((call) => call.key === "getArtwork"),
        false,
    );
});

test("the native profile patch matches the cached module and preserves syntax without enabling experiments", () => {
    const plugin = load("client/plugins/fosscordNitroBadges/index.ts", {
        "@utils/types": { default: (value) => value, __esModule: true },
        "../fosscordCore/shared": { FosscordAuthor: {} },
        "./tooltip": {},
    }).default;
    assert.equal(plugin.required, true);
    const patch = plugin.patches[0];
    const match = new RegExp(patch.replacement.match.source.replaceAll("\\i", "[A-Za-z_$][\\w$]*"), patch.replacement.match.flags);
    const files = fs.existsSync("assets/cache") ? fs.readdirSync("assets/cache").filter((file) => /^web\.[\da-f]+\.js$/.test(file)) : [];
    if (!files.length) return;
    const bundle = fs.readFileSync(`assets/cache/${files[0]}`, "utf8");
    const at = bundle.indexOf(patch.find);
    assert.ok(at > 0);
    const header = [...bundle.slice(0, at).matchAll(/(?:\d+|\d+e\d+)\(e,t,n\)\{/g)].at(-1);
    const start = header.index + header[0].length;
    const tail = bundle.slice(start);
    const end = /\},(?:\d+|\d+e\d+)\(e,t,n\)/.exec(tail).index;
    const original = tail.slice(0, end);
    assert.ok(match.test(original), "patch matches the actual profile badge renderer");
    const withBadgeApi = original.replace(
        /children:(\(0,[\w$]+\.jsx\)\([\w$]+\.Anchor,\{\.\.\.[\w$]+,children:[\w$]+\}\)\},`\$\{[\w$]+\.id\}-\$\{[\w$]+\}`\);)/,
        "children:e.component?BadgeAPI.renderBadgeComponent({...e}):$1",
    );
    assert.notEqual(withBadgeApi, original, "fixture includes the upstream BadgeAPI wrapper");
    assert.ok(match.test(withBadgeApi), "native card interception survives the upstream badge component wrapper");
    assert.doesNotThrow(() => new Function("e", "t", "n", withBadgeApi.replace(match, patch.replacement.replace.replaceAll("$self", "FosscordNitroBadges"))));
    const changed = original.replace(match, patch.replacement.replace.replaceAll("$self", "FosscordNitroBadges"));
    assert.ok(changed.includes("if(FosscordNitroBadges.isNitroBadge(e))return FosscordNitroBadges.renderNitroBadge(e,d);"));
    assert.doesNotThrow(() => new Function("e", "t", "n", changed));
});
