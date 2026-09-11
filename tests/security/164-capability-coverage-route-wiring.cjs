#!/usr/bin/env node
"use strict";
/**
 * Phase 1 Capability Coverage (Mission 101-120) — route wiring check for
 * backend/routes/capabilityCoverage.js.
 *
 * Per CLAUDE.md §6, any new route must be compared against its nearest
 * sibling for consistent auth/tenant-scoping middleware — this repo's own
 * audit history repeatedly found a new/sibling route missing the same
 * middleware its neighbors already have. The nearest sibling here is
 * /p26/capabilities (backend/routes/phase26.js), which gates itself with
 * `router.use("/p26", requireAuth, attachOrg)`.
 *
 * This is a static source-text wiring check (no live server required),
 * following the same pattern as tests/security/137-telegram-social-
 * publish-wiring.cjs — sufficient to prove the route composes the right
 * middleware without needing a running backend on :5050.
 *
 * Usage: node tests/security/160-capability-coverage-route-wiring.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

const fs = require("fs");

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(title)  { console.log(`\n[${title}]`); }

function main() {
    section("backend/routes/capabilityCoverage.js is gated the same way as its sibling /p26/capabilities");
    {
        const src = fs.readFileSync("backend/routes/capabilityCoverage.js", "utf8");
        assert(src.includes('require("../middleware/authMiddleware")') && src.includes("requireAuth"),
            "imports and uses requireAuth", "missing requireAuth import/usage");
        assert(src.includes('require("../middleware/orgMiddleware.cjs")') && src.includes("attachOrg"),
            "imports and uses attachOrg (matches phase26.js's /p26 gate)", "missing attachOrg import/usage");
        assert(/router\.use\(\s*"\/p1\/capabilities",\s*requireAuth,\s*attachOrg\s*\)/.test(src),
            "/p1/capabilities is gated with requireAuth + attachOrg before any handler", "no explicit gate found for /p1/capabilities");
        assert(/router\.use\(\s*"\/p1\/domains",\s*requireAuth,\s*attachOrg\s*\)/.test(src),
            "/p1/domains is gated with requireAuth + attachOrg before any handler", "no explicit gate found for /p1/domains");
    }

    section("route registration order — discover/route are registered before the :id catch-all");
    {
        const src = fs.readFileSync("backend/routes/capabilityCoverage.js", "utf8");
        const idxDiscover = src.indexOf('router.get("/p1/capabilities/discover"');
        const idxRoute    = src.indexOf('router.get("/p1/capabilities/route/:id"');
        const idxParam    = src.indexOf('router.get("/p1/capabilities/:id"');
        assert(idxDiscover !== -1 && idxParam !== -1 && idxDiscover < idxParam,
            "/p1/capabilities/discover is registered before the /:id catch-all", "discover route registered after :id — would be shadowed");
        assert(idxRoute !== -1 && idxParam !== -1 && idxRoute < idxParam,
            "/p1/capabilities/route/:id is registered before the /:id catch-all", "route/:id registered after :id — would be shadowed");
    }

    section("mounted in the route barrel");
    {
        const src = fs.readFileSync("backend/routes/index.js", "utf8");
        assert(src.includes('require("./capabilityCoverage")'), "capabilityCoverage is required by the route barrel", "not mounted in backend/routes/index.js");
    }

    section("no fabricated capability/agent data — routes only read real registries");
    {
        const src = fs.readFileSync("backend/routes/capabilityCoverage.js", "utf8");
        assert(src.includes('require("../services/skillRegistry.cjs")'), "reads the real skillRegistry.cjs, no new capability store invented", "does not reference skillRegistry.cjs");
        assert(!/data:\s*\[\s*\{/.test(src), "no inline hard-coded capability array in the route file", "found what looks like inline fabricated data");
    }

    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail > 0) {
        console.log("\nFailures:");
        for (const f of failures) console.log(`  - ${f.msg}: ${f.reason}`);
        process.exit(1);
    }
    process.exit(0);
}

main();
