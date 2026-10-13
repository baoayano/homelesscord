const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");

test("instances.md matches instances.json", async () => {
    const { renderInstancesMarkdown } = await import(path.join(root, "scripts/instances-md.mjs"));
    const instances = JSON.parse(fs.readFileSync(path.join(root, "instances.json"), "utf8"));
    assert.equal(fs.readFileSync(path.join(root, "instances.md"), "utf8"), renderInstancesMarkdown(instances), "run bun scripts/instances-md.mjs after editing instances.json");
});

test("instances.json entries have a matching id, a name and https URLs", () => {
    const instances = JSON.parse(fs.readFileSync(path.join(root, "instances.json"), "utf8"));
    const ids = new Set();
    for (const instance of instances) {
        const url = new URL(instance.url);
        assert.equal(url.protocol, "https:", `${instance.name} needs an https url`);
        assert.equal(instance.id, url.port ? `${url.hostname}:${url.port}` : url.hostname, `${instance.name} id must be the url's host`);
        assert.ok(instance.name?.trim(), `${instance.id} needs a name`);
        assert.ok(instance.source_url === null || new URL(instance.source_url).protocol === "https:", `${instance.id} source_url must be https or null`);
        assert.ok(!ids.has(instance.id), `${instance.id} is listed twice`);
        ids.add(instance.id);
    }
});
