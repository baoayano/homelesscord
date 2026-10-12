/* SPDX-License-Identifier: AGPL-3.0-only */
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

exports.managementUtilities = (options = {}) => {
    const cache = new Map();
    const util = {
        Config: { get: () => ({ client: { instanceName: "Test Instance" }, cdn: { endpointPublic: "http://localhost:3003/" } }) },
        FieldErrors: (fields) => Object.assign(new Error(Object.keys(fields).join(",")), { fields }),
        getApexExperiments: (id) => ({ assignments: { 1: { [id]: { assignments: [[3093904580, options.variant ?? 0]] } } } }),
    };
    const load = (file) => {
        if (cache.has(file)) return cache.get(file);
        const module = { exports: {} };
        cache.set(file, module.exports);
        vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
            module,
            exports: module.exports,
            Date,
            require(name) {
                if (name === "typeorm") return { In: (ids) => ids };
                if (name === "@spacebar/database") return {};
                if (name === "@spacebar/util") return util;
                if (name === "@spacebar/schemas") return { UserFlags: { FLAGS: { SYSTEM: 4096n } } };
                if (name === "./staffBadge") return { STAFF_BADGE_ID: "1" };
                if (name.startsWith("./")) return load(`src/api/util/utility/${name.slice(2)}.ts`);
                throw Error(name);
            },
        });
        return module.exports;
    };
    return load("src/api/util/utility/badgeManagement.ts");
};
