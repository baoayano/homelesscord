/* SPDX-License-Identifier: AGPL-3.0-only */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const { Database } = require("bun:sqlite");

const load = (file, imports = {}) => {
    const module = { exports: {} };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
        module,
        exports: module.exports,
        Date,
        require: (name) => {
            if (!(name in imports)) throw Error(name);
            return imports[name];
        },
    });
    return module.exports;
};

test("SQLite registration date migration backfills once, preserves overrides and has an idempotent rollback", async () => {
    const db = new Database(":memory:");
    try {
        db.run("CREATE TABLE users (id integer PRIMARY KEY, created_at datetime NOT NULL)");
        db.run("INSERT INTO users VALUES (1, '2026-10-12T10:23:45.678Z')");
        const queryRunner = {
            query: async (sql) => {
                const statement = db.prepare(sql);
                return statement.columnNames.length ? statement.all() : statement.run();
            },
        };
        const { UserRegistrationDate1792051846731 } = load("src/database/migration/sqlite/1792051846731-UserRegistrationDate.ts");
        const migration = new UserRegistrationDate1792051846731();
        await migration.up(queryRunner);
        assert.equal(db.query("SELECT registration_date FROM users").get().registration_date, "2026-10-12T10:23:45.678Z");
        db.run("UPDATE users SET registration_date = '2020-01-01T00:00:00.000Z'");
        await migration.up(queryRunner);
        assert.equal(db.query("SELECT registration_date FROM users").get().registration_date, "2020-01-01T00:00:00.000Z");
        await migration.down(queryRunner);
        await migration.down(queryRunner);
        assert.equal(
            db
                .query("PRAGMA table_info(users)")
                .all()
                .some((column) => column.name === "registration_date"),
            false,
        );
        assert.equal(db.query("SELECT created_at FROM users").get().created_at, "2026-10-12T10:23:45.678Z");
    } finally {
        db.close();
    }
});

class HTTPError extends Error {
    constructor(message, code) {
        super(message);
        this.code = code;
    }
}

const harness = () => {
    let patch;
    const writes = [];
    const user = { id: "target", rights: "0", created_at: new Date("2026-10-12T10:23:45.678Z"), registration_date: new Date("2026-10-12T10:23:45.678Z") };
    load("src/api/routes/admin/users/#user_id/index.ts", {
        express: {
            Router: () => ({
                get() {},
                patch: (...args) => {
                    patch = args.at(-1);
                },
            }),
        },
        "lambert-server/HTTPError": { HTTPError },
        typeorm: {},
        "@spacebar/util/util/IdentityModeration": { assertIdentityNameAllowed() {} },
        "@spacebar/api/middlewares": { route: () => ({}) },
        "@spacebar/database": {
            User: {
                findOneOrFail: async () => user,
                update: async (where, data) => {
                    writes.push({ where, data });
                },
            },
        },
        "@spacebar/util": {
            Rights: class {
                constructor(value) {
                    this.value = value;
                }
                has() {
                    return this.value === "1";
                }
            },
            emitEvent: async () => {},
            broadcastUserUpdate: async () => {},
        },
        "@spacebar/schemas": { AccountStandingState: { SUSPENDED: 500 }, PrivateUserProjection: ["id"] },
        "@spacebar/api/util": { hasAdminPanelAccess: () => false },
        "../index": { ADMIN_USER_COLUMNS: ["id", "created_at", "registration_date"], pickAdminUser: (user) => ({ id: user.id, registration_date: user.registration_date }) },
    });
    return {
        user,
        writes,
        run: (body, operator = true) => patch({ body, params: { user_id: user.id }, user_id: "admin", rights: { has: () => operator } }, { json() {} }),
    };
};

test("admin date edits write only the badge registration field and preserve account creation", async () => {
    const h = harness();
    const before = h.user.created_at.toISOString();
    await h.run({ registration_date: "2020-01-31T17:23:45.678+07:00" });
    assert.equal(h.writes.length, 1);
    assert.deepEqual(Object.keys(h.writes[0].data), ["registration_date"]);
    assert.equal(h.writes[0].data.registration_date.toISOString(), "2020-01-31T10:23:45.678Z");
    assert.equal(h.user.created_at.toISOString(), before);
});

test("admin null resets registration date to exact account creation; omitted fields do not change it", async () => {
    const h = harness();
    await h.run({ registration_date: null });
    assert.equal(h.writes[0].data.registration_date.getTime(), h.user.created_at.getTime());
    h.writes.length = 0;
    await h.run({});
    assert.equal(h.writes.length, 0);
});

test("admin rejects malformed, impossible and timezone-free dates before writing", async () => {
    for (const registration_date of [
        "",
        "invalid",
        "2020-02-31T00:00:00Z",
        "2021-02-29T00:00:00Z",
        "2020-01-01",
        "2020-01-01T00:00:00",
        "2020-01-01T24:00:00Z",
        "0000-01-01T00:00:00Z",
        0,
    ]) {
        const h = harness();
        await assert.rejects(h.run({ registration_date }), (error) => error.code === 400);
        assert.equal(h.writes.length, 0);
    }
});

test("registration date changes retain operator target protection", async () => {
    const h = harness();
    h.user.rights = "1";
    await assert.rejects(h.run({ registration_date: "2020-01-01T00:00:00Z" }, false), (error) => error.code === 403);
    assert.equal(h.writes.length, 0);
});
