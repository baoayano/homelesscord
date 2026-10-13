const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

function harness(objects, userId = "100000000000000001") {
    const source = ts.createSourceFile("engine.ts", fs.readFileSync("client/e2ee/src/engine.ts", "utf8"), ts.ScriptTarget.Latest, true);
    const engine = source.statements.find((node) => ts.isClassDeclaration(node) && node.name.text === "Engine");
    const helpers = source.statements
        .filter(
            (node) =>
                ts.isVariableStatement(node) && ["canonicalInstance", "canonicalSnowflake", "isCanonical"].includes(node.declarationList.declarations[0].name.getText(source)),
        )
        .map((node) => node.getText(source))
        .join("\n");
    const methods = ["canonicalIds", "signedUserId", "bindingFor", "safetyNumber"].map((name) =>
        engine.members.find((node) => ts.isMethodDeclaration(node) && node.name.getText(source) === name),
    );
    methods.forEach((method) => assert.ok(method));
    const module = { exports: {} };
    class E2eeError extends Error {
        constructor(code, message) {
            super(message);
            this.code = code;
        }
    }
    vm.runInNewContext(
        ts.transpileModule(`${helpers}\nclass Extracted { ${methods.map((m) => m.getText(source)).join("\n")} };module.exports=Extracted;`, {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        }).outputText,
        {
            module,
            E2eeError,
            t: (text) => text,
            crypto: globalThis.crypto,
            fromB64u: (text) => new Uint8Array(Buffer.from(text, "base64url")),
            utf8: (text) => new TextEncoder().encode(text),
        },
    );
    const calls = [];
    const instance = new module.exports();
    Object.assign(instance, {
        userId,
        canonical: new Map(),
        resolvedCanonical: new Map(),
        federation: true,
        api: {
            request: async (method, url) => {
                calls.push(url);
                if (objects === 404) throw { ok: false, status: 404 };
                const ids = new URL(url, "http://x").searchParams.get("ids").split(",");
                return Object.fromEntries(ids.filter((id) => objects[id]).map((id) => [id, objects[id]]));
            },
        },
    });
    return { instance, calls };
}

const me = "100000000000000001";
const friend = "100000000000000002";
const remote = "100000000000000003";
const channel = "100000000000000010";

test("a conversation with only local members keeps the version 1 binding", async () => {
    const { instance } = harness({ [me]: `@${me}@a.example`, [friend]: `@${friend}@a.example`, [channel]: `@${channel}@a.example` });
    const ids = await instance.bindingFor(channel, me, [me, friend], undefined);
    assert.equal(ids.v, 1);
    assert.equal(ids.channel, channel);
    assert.equal(ids.user(friend), friend);
});

test("a conversation with a member on another instance binds canonical ids", async () => {
    const { instance } = harness({
        [me]: `@${me}@a.example`,
        [remote]: "@555555555555555555@b.example",
        [channel]: "@777777777777777777@b.example",
        100000000000000020: "@888888888888888888@b.example",
    });
    const ids = await instance.bindingFor(channel, me, [me, remote], "100000000000000020");
    assert.equal(ids.v, 2);
    assert.equal(ids.channel, "@777777777777777777@b.example");
    assert.equal(ids.sender, `@${me}@a.example`);
    assert.equal(ids.mid, "@888888888888888888@b.example");
    assert.equal(ids.user(remote), "@555555555555555555@b.example");
});

test("statements of a remote user are checked against their home snowflake", async () => {
    const { instance } = harness({ [me]: `@${me}@a.example`, [remote]: "@555555555555555555@b.example", [friend]: `@${friend}@a.example` });
    assert.equal(await instance.signedUserId(remote), "555555555555555555");
    assert.equal(await instance.signedUserId(friend), friend);
    assert.equal(await instance.signedUserId(me), me);
});

test("an instance without federation falls back to version 1 and stops asking", async () => {
    const { instance, calls } = harness(404);
    const ids = await instance.bindingFor(channel, me, [me, friend], undefined);
    assert.equal(ids.v, 1);
    assert.equal(instance.federation, false);
    await instance.bindingFor(channel, me, [me, friend], undefined);
    assert.equal(calls.length, 1);
});

test("a version 2 envelope can't be checked without canonical ids", async () => {
    const { instance } = harness(404);
    await assert.rejects(instance.bindingFor(channel, remote, [me], undefined, 2), (error) => error.code === "BAD_ENVELOPE");
});

test("a version 1 envelope is never upgraded", async () => {
    const { instance, calls } = harness({ [me]: `@${me}@a.example`, [remote]: "@555555555555555555@b.example", [channel]: "@777777777777777777@b.example" });
    const ids = await instance.bindingFor(channel, remote, [me], undefined, 1);
    assert.equal(ids.v, 1);
    assert.equal(calls.length, 0);
});

test("both sides of a conversation across instances compute the same safety number", async () => {
    const aliceKey = Buffer.alloc(32, 1).toString("base64url");
    const bobKey = Buffer.alloc(32, 2).toString("base64url");
    const bobHome = "555555555555555555";
    const aliceOnB = "100000000000000099";
    const onA = harness({ [me]: `@${me}@a.example`, [remote]: `@${bobHome}@b.example` }).instance;
    Object.assign(onA, { trustedKey: aliceKey, contacts: {}, keysFor: async () => [{ identityKey: bobKey }] });
    const onB = harness({ [bobHome]: `@${bobHome}@b.example`, [aliceOnB]: `@${me}@a.example` }, bobHome).instance;
    Object.assign(onB, { trustedKey: bobKey, contacts: {}, keysFor: async () => [{ identityKey: aliceKey }] });
    const number = await onA.safetyNumber(remote);
    assert.match(number, /^\d{60}$/);
    assert.equal(await onB.safetyNumber(aliceOnB), number);
});
