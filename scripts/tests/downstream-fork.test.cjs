/* SPDX-License-Identifier: AGPL-3.0-only */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const source = fs.readFileSync(path.join(__dirname, "../dev/fork.mjs"), "utf8");

function fixture(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "downstream-fork-"));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const seed = path.join(directory, "seed");
    const upstream = path.join(directory, "upstream.git");
    const checkout = path.join(directory, "checkout");
    const git = (cwd, ...args) => {
        const result = spawnSync("git", ["-c", "core.hooksPath=/dev/null", ...args], { cwd, encoding: "utf8" });
        assert.equal(result.status, 0, result.stderr);
        return result.stdout.trim();
    };
    fs.mkdirSync(seed);
    git(seed, "init", "-b", "main");
    git(seed, "config", "user.name", "Downstream Fixture");
    git(seed, "config", "user.email", "fixture@example.test");
    fs.mkdirSync(path.join(seed, "scripts/dev"), { recursive: true });
    fs.writeFileSync(path.join(seed, "scripts/dev/fork.mjs"), source);
    fs.writeFileSync(path.join(seed, "shared.txt"), "baseline\n");
    git(seed, "add", ".");
    git(seed, "commit", "-m", "test: seed fixture");
    git(directory, "clone", "--bare", seed, upstream);
    git(directory, "clone", upstream, checkout);
    git(checkout, "config", "user.name", "Downstream Fixture");
    git(checkout, "config", "user.email", "fixture@example.test");
    git(checkout, "remote", "add", "upstream", upstream);
    git(seed, "remote", "add", "origin", upstream);
    const commit = (cwd, file, content) => {
        fs.writeFileSync(path.join(cwd, file), content);
        git(cwd, "add", file);
        git(cwd, "commit", "-m", "test: change fixture");
    };
    const incoming = (file = "incoming.txt", content = "upstream\n") => {
        commit(seed, file, content);
        git(seed, "push", "origin", "main");
    };
    const run = (args, env = {}) =>
        spawnSync(process.execPath, [path.join(checkout, "scripts/dev/fork.mjs"), ...args], {
            cwd: checkout,
            env: { ...process.env, ...env },
            encoding: "utf8",
            timeout: 20000,
        });
    return { directory, seed, upstream, checkout, git, commit, incoming, run };
}

test("upstream check reports incoming commits without touching local files or HEAD", (t) => {
    const f = fixture(t);
    const head = f.git(f.checkout, "rev-parse", "HEAD");
    f.incoming();
    fs.writeFileSync(path.join(f.checkout, "shared.txt"), "uncommitted\n");
    fs.writeFileSync(path.join(f.checkout, "private.txt"), "local-only\n");
    const result = f.run(["check"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /0 downstream commits and 1 incoming/);
    assert.equal(f.git(f.checkout, "rev-parse", "HEAD"), head);
    assert.equal(fs.readFileSync(path.join(f.checkout, "shared.txt"), "utf8"), "uncommitted\n");
    assert.equal(fs.readFileSync(path.join(f.checkout, "private.txt"), "utf8"), "local-only\n");
});

test("sync creates a pending merge in a separate worktree and preserves downstream history", (t) => {
    const f = fixture(t);
    f.commit(f.checkout, "downstream.txt", "custom feature\n");
    const head = f.git(f.checkout, "rev-parse", "HEAD");
    f.incoming();
    fs.writeFileSync(path.join(f.checkout, "shared.txt"), "dirty\n");
    const target = path.join(f.directory, "review with spaces");
    const result = f.run(["sync", target]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(f.git(target, "branch", "--show-current"), /^codex\/sync-upstream-/);
    assert.equal(f.git(target, "rev-parse", "HEAD"), head);
    assert.equal(f.git(target, "rev-parse", "MERGE_HEAD"), f.git(f.seed, "rev-parse", "HEAD"));
    assert.equal(fs.readFileSync(path.join(target, "downstream.txt"), "utf8"), "custom feature\n");
    assert.equal(fs.readFileSync(path.join(target, "incoming.txt"), "utf8"), "upstream\n");
    assert.equal(f.git(f.checkout, "branch", "--show-current"), "main");
    assert.equal(fs.readFileSync(path.join(f.checkout, "shared.txt"), "utf8"), "dirty\n");
});

test("sync leaves conflicts only in the review worktree", (t) => {
    const f = fixture(t);
    f.commit(f.checkout, "shared.txt", "downstream\n");
    f.incoming("shared.txt", "upstream\n");
    const target = path.join(f.directory, "conflict-review");
    const result = f.run(["sync", target]);
    assert.equal(result.status, 2, result.stderr);
    assert.match(f.git(target, "status", "--porcelain"), /UU shared.txt/);
    assert.equal(fs.readFileSync(path.join(f.checkout, "shared.txt"), "utf8"), "downstream\n");
    assert.equal(f.git(f.checkout, "status", "--porcelain"), "");
});

test("sync makes no worktree when upstream is already included", (t) => {
    const f = fixture(t);
    f.commit(f.checkout, "downstream.txt", "custom\n");
    const target = path.join(f.directory, "unused-review");
    const result = f.run(["sync", target]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /No worktree was created/);
    assert.equal(fs.existsSync(target), false);
    assert.equal(f.git(f.checkout, "worktree", "list", "--porcelain").match(/^worktree /gm).length, 1);
});

test("sync refuses existing, nested and symlink-nested destinations", (t) => {
    const f = fixture(t);
    f.incoming();
    fs.symlinkSync(f.checkout, path.join(f.directory, "checkout-link"));
    for (const destination of [f.checkout, path.join(f.checkout, "nested"), path.join(f.directory, "checkout-link/nested")]) {
        const result = f.run(["sync", destination]);
        assert.equal(result.status, 1, result.stderr);
        assert.match(result.stderr, /already exists|outside existing worktrees/);
    }
    assert.equal(f.git(f.checkout, "worktree", "list", "--porcelain").match(/^worktree /gm).length, 1);
});

test("connect verifies reachability before changing either remote and sets both origin URLs", (t) => {
    const f = fixture(t);
    f.git(f.checkout, "remote", "set-url", "origin", "https://github.com/meowcorded/meowcord.git");
    f.git(f.checkout, "remote", "set-url", "upstream", "https://github.com/meowcorded/meowcord.git");
    const destination = "https://github.com/fixture/homelesscord.git";
    const env = {
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: `url.${path.join(f.directory, "missing.git")}.insteadOf`,
        GIT_CONFIG_VALUE_0: destination,
    };
    assert.equal(f.run(["connect", "fixture/homelesscord"], env).status, 1);
    assert.equal(f.git(f.checkout, "remote", "get-url", "origin"), "https://github.com/meowcorded/meowcord.git");
    env.GIT_CONFIG_KEY_0 = `url.${f.upstream}.insteadOf`;
    const result = f.run(["connect", "fixture/homelesscord"], env);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(f.git(f.checkout, "remote", "get-url", "origin"), destination);
    assert.equal(f.git(f.checkout, "remote", "get-url", "--push", "origin"), destination);
    assert.equal(f.git(f.checkout, "remote", "get-url", "upstream"), "https://github.com/meowcorded/meowcord.git");
});

test("connect refuses source, unrelated remotes and unexpected arguments", (t) => {
    const f = fixture(t);
    const original = f.git(f.checkout, "remote", "-v");
    for (const args of [
        ["connect", "meowcorded/meowcord"],
        ["connect", "--malformed"],
        ["connect", "fixture/homelesscord"],
        ["check", "extra"],
    ]) {
        assert.equal(f.run(args).status, 1);
        assert.equal(f.git(f.checkout, "remote", "-v"), original);
    }
});
