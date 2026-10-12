/* SPDX-License-Identifier: AGPL-3.0-only */
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

const directory = path.join(__dirname, "..", "assets", "badge-icons");
const { badges } = require("../assets/badge-icons/nitro-manifest.json");
const [mode, ...extra] = process.argv.slice(2);
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function verify(badge, data) {
    if (data.length < 24 || !data.subarray(0, 8).equals(signature)) throw new Error(`${badge.filename} is not a PNG`);
    if (data.readUInt32BE(16) !== badge.width || data.readUInt32BE(20) !== badge.height) throw new Error(`${badge.filename} has unexpected dimensions`);
    if (createHash("sha256").update(data).digest("hex") !== badge.sha256) throw new Error(`${badge.filename} does not match the pinned Discord asset`);
}

function svg(data) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><image width="24" height="24" href="data:image/png;base64,${data.toString("base64")}"/></svg>\n`;
}

async function main() {
    if (extra.length || (mode !== undefined && mode !== "--check" && mode !== "--download")) throw new Error("Usage: bun scripts/tenure-badges.js [--check | --download]");
    const images = [];
    for (const badge of badges) {
        let data;
        if (mode === "--download") {
            const response = await fetch(badge.url, { signal: AbortSignal.timeout(15000) });
            if (!response.ok) throw new Error(`${badge.filename}: HTTP ${response.status}`);
            data = Buffer.from(await response.arrayBuffer());
        } else data = fs.readFileSync(path.join(directory, badge.filename));
        verify(badge, data);
        images.push({ badge, data });
    }
    for (const { badge, data } of images) {
        const filename = path.join(directory, badge.filename);
        const companion = filename.replace(/\.png$/, ".svg");
        const expected = svg(data);
        if (mode === "--check") {
            if (fs.readFileSync(companion, "utf8") !== expected) throw new Error(`${path.basename(companion)} does not embed the pinned PNG`);
        } else {
            if (mode === "--download") fs.writeFileSync(filename, data);
            fs.writeFileSync(companion, expected);
        }
        console.log(`[tenure-badges] ${mode === "--check" ? "verified" : "restored"} ${badge.filename}`);
    }
}

main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});
