/* SPDX-License-Identifier: AGPL-3.0-only */
import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sourceRepository = "meowcorded/meowcord";
const sourceUrl = `https://github.com/${sourceRepository}.git`;
const [command, argument, ...extra] = process.argv.slice(2);

function runGit(args, cwd = root) {
    return spawnSync("git", args, {
        cwd,
        encoding: "utf8",
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
}

function git(args, cwd = root) {
    const result = runGit(args, cwd);
    if (result.status !== 0) throw new Error(result.error?.message || result.stderr.trim() || `git ${args[0]} failed`);
    return result.stdout.trim();
}

function repositoryName(url) {
    return url
        .replace(/^https:\/\/github\.com\//, "")
        .replace(/^git@github\.com:/, "")
        .replace(/\.git$/, "")
        .replace(/\/$/, "")
        .toLowerCase();
}

function remoteUrl(name) {
    const result = runGit(["remote", "get-url", name]);
    return result.status === 0 ? result.stdout.trim() : undefined;
}

function connect(repository) {
    if (!repository || !/^[a-z\d][a-z\d-]{0,38}\/[a-z\d][a-z\d_.-]{0,99}$/i.test(repository)) throw new Error("Use a GitHub owner/repository name.");
    if (repository.toLowerCase() === sourceRepository) throw new Error("origin must point to your own repository.");
    const upstream = remoteUrl("upstream");
    if (upstream && repositoryName(upstream) !== sourceRepository) throw new Error("Existing upstream points to another repository; review it before connecting.");
    const origin = remoteUrl("origin");
    if (origin) {
        const names = [sourceRepository, repository.toLowerCase()];
        if (!names.includes(repositoryName(origin))) throw new Error("Existing origin points to another repository; review it before connecting.");
        const pushes = git(["remote", "get-url", "--push", "--all", "origin"]).split("\n");
        if (pushes.length !== 1 || !names.includes(repositoryName(pushes[0]))) throw new Error("Existing origin has a different push destination; review it before connecting.");
    }
    const destination = `https://github.com/${repository}.git`;
    git(["ls-remote", destination]);
    if (!upstream) git(["remote", "add", "upstream", sourceUrl]);
    git(origin ? ["remote", "set-url", "origin", destination] : ["remote", "add", "origin", destination]);
    git(["remote", "set-url", "--push", "origin", destination]);
    console.log(`origin: ${destination}\nupstream: ${sourceUrl}\nNo commits were pushed. Fetch origin before publishing your reviewed main branch.`);
}

function upstreamState() {
    if (!remoteUrl("upstream")) throw new Error("Configure upstream first with fork:connect, or add the source remote manually.");
    git(["rev-parse", "--verify", "refs/heads/main"]);
    git(["fetch", "--no-tags", "upstream", "refs/heads/main:refs/remotes/upstream/main"]);
    if (runGit(["merge-base", "main", "upstream/main"]).status !== 0)
        throw new Error("main and upstream/main have no shared history. Review shallow history or the remote before merging.");
    const [own, incoming] = git(["rev-list", "--left-right", "--count", "main...upstream/main"]).split(/\s+/).map(Number);
    console.log(`main has ${own} downstream commits and ${incoming} incoming upstream commits.`);
    if (incoming) console.log(git(["log", "--oneline", "-20", "main..upstream/main"]));
    return incoming;
}

function sync(directory) {
    if (!directory) throw new Error("Choose a new sibling worktree directory: upstream:sync ../homelesscord-sync.");
    const requested = path.resolve(process.cwd(), directory);
    if (existsSync(requested)) throw new Error("The worktree destination already exists; choose a new directory.");
    const target = path.join(realpathSync(path.dirname(requested)), path.basename(requested));
    const worktrees = git(["worktree", "list", "--porcelain"])
        .split("\n")
        .filter((line) => line.startsWith("worktree "));
    for (const line of worktrees) {
        const relative = path.relative(realpathSync(line.slice(9)), target);
        if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)))
            throw new Error("Choose a destination outside existing worktrees.");
    }
    if (!upstreamState()) {
        console.log("No upstream merge is needed. No worktree was created.");
        return;
    }
    const branch = `codex/sync-upstream-${Date.now()}`;
    git(["worktree", "add", "-b", branch, target, "main"]);
    const merge = runGit(["merge", "--no-ff", "--no-commit", "upstream/main"], target);
    console.log(`Review worktree: ${target}\nReview branch: ${branch}`);
    if (merge.status !== 0) {
        console.error(merge.error?.message || merge.stderr.trim() || merge.stdout.trim());
        console.error("The merge remains in the review worktree. Resolve conflicts there, or run git merge --abort there.");
        process.exitCode = 2;
        return;
    }
    console.log("Upstream changes are staged for review. Run the required checks before committing the merge and integrating it into main.");
}

try {
    if (extra.length || (command === "check" && argument)) throw new Error("Unexpected arguments.");
    git(["rev-parse", "--show-toplevel"]);
    if (command === "connect") connect(argument);
    else if (command === "check") upstreamState();
    else if (command === "sync") sync(argument);
    else throw new Error("Usage: bun scripts/dev/fork.mjs connect <owner/repository> | check | sync <new-worktree-directory>");
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
