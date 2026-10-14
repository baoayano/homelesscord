/* SPDX-License-Identifier: AGPL-3.0-only */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./helpers/route-harness.cjs");

const load = (mirrors, members) =>
    loadModule("src/api/routes/federation/discovery.ts", {
        express: { Router: () => ({ get: () => undefined }) },
        "@spacebar/api/middlewares": { route: () => undefined },
        "@spacebar/api/util/handlers/Discovery": {},
        "@spacebar/api/util/utility/federation": {},
        "@spacebar/database": {
            FederatedObject: { find: async ({ where }) => mirrors.filter((mirror) => where.canonical.includes(mirror.canonical)) },
            Member: { find: async ({ where }) => members.filter((member) => member.id === where.id && where.guild_id.includes(member.guild_id)) },
        },
        typeorm: { In: (values) => values },
    });

test("remote discovery marks the servers the user already joined through their local mirror", async () => {
    const { markJoined } = load(
        [
            { canonical: "@1@other.example", local_id: "local-1" },
            { canonical: "@2@other.example", local_id: "local-2" },
        ],
        [{ id: "me", guild_id: "local-1" }],
    );
    const result = await markJoined(
        {
            total: 3,
            guilds: [
                { id: "1", instance: "Other.Example" },
                { id: "2", instance: "other.example" },
                { id: "3", instance: "other.example" },
            ],
        },
        "me",
    );
    assert.equal(result.total, 3);
    assert.deepEqual(
        result.guilds.map((guild) => guild.joined_guild_id),
        ["local-1", null, null],
    );
});

test("anonymous requests and empty pages pass through untouched", async () => {
    const { markJoined } = load([], []);
    const directory = { guilds: [{ id: "1", instance: "x" }] };
    assert.equal(await markJoined(directory, undefined), directory);
    assert.deepEqual(await markJoined({ guilds: [] }, "me"), { guilds: [] });
});
