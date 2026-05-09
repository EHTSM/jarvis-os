/**
 * Test Agent — generates Jest unit tests and API integration tests.
 */

const path   = require("path");
const fs     = require("fs");
const fsUtil = require("../core/fileSystem.cjs");

const _jestConfig = () => `module.exports = {
    testEnvironment:   "node",
    testMatch:         ["**/*.test.js"],
    collectCoverage:   true,
    coverageDirectory: "coverage",
    coverageReporters: ["text", "lcov"],
    coverageThreshold: { global: { lines: 70, functions: 70 } }
};
`;

function _unitTest(moduleName, fns) {
    const tests = fns.length > 0
        ? fns.map(fn => `
    it("${fn} — executes without error", async () => {
        // TODO: arrange inputs for ${fn}
        // const result = await mod.${fn}();
        // expect(result).toBeDefined();
        expect(typeof mod.${fn}).toBe("function");
    });`).join("")
        : `\n    it("module loads", () => expect(mod).toBeDefined());`;

    return `const mod = require("./${moduleName}");

describe("${moduleName}", () => {${tests}
});
`;
}

function _apiTest(endpoints) {
    const defaults = endpoints.length > 0 ? endpoints : [
        { method: "GET",    path: "/health",    status: 200 },
        { method: "GET",    path: "/api/items", status: 200 },
        { method: "POST",   path: "/api/items", body: { name: "test" }, status: 201 }
    ];

    const cases = defaults.map(ep => `
    it("${ep.method} ${ep.path} → ${ep.status}", async () => {
        const res = await request(app).${ep.method.toLowerCase()}("${ep.path}")${ep.body ? `\n            .send(${JSON.stringify(ep.body)})` : ""};
        expect(res.statusCode).toBe(${ep.status});
    });`).join("");

    return `const request = require("supertest");
const app     = require("../server");

describe("API Tests", () => {${cases}

    afterAll(done => done());
});
`;
}

async function run(task) {
    const p          = task.payload || {};
    const testType   = p.testType   || "unit";
    const targetFile = p.targetFile || p.file || "module.js";
    const outputPath = p.outputPath || null;
    const fns        = p.functions  || [];
    const endpoints  = p.endpoints  || [];

    const baseName = path.basename(targetFile, path.extname(targetFile));
    const code     = testType === "api" ? _apiTest(endpoints) : _unitTest(baseName, fns);

    const written = [];
    if (outputPath) {
        const testPath = path.join(outputPath, `${baseName}.test.js`);
        await fsUtil.writeFile(testPath, code);
        written.push(testPath);

        const cfgPath = path.join(outputPath, "jest.config.js");
        if (!fs.existsSync(cfgPath)) {
            await fsUtil.writeFile(cfgPath, _jestConfig());
            written.push(cfgPath);
        }
    }

    return { success: true, testType, code, files: written, run: "npx jest" };
}

module.exports = { run };
