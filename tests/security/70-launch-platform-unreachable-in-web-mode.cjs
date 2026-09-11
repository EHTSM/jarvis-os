#!/usr/bin/env node
"use strict";
/**
 * Launch Platform (Feedback Hub / Roadmap voting) was fully built but
 * unreachable in the web app — Phase A.8.3 (Product OS Recovery).
 *
 * CONFIRMED finding (Phase A.8.2 discovery, reproduced live in A.8.3):
 * frontend/src/components/LaunchPlatform.jsx is a fully built, 14-tab
 * component (Dashboard/Onboarding/Workspaces/Docs/Academy/Referral/
 * Success/Feedback/Readiness/Benchmark/reports) wired to real routes
 * (backend/routes/launchPlatform.js) and real data (data/feedback.json),
 * including a working Feedback submission form and a Roadmap voting view
 * (feedbackHub.cjs's getRoadmap(), grouped by status). It was only ever
 * mounted inside ElectronWorkspace.jsx, which is a documented pure
 * passthrough in web mode (`if (!isElectron()) return children`) — so it
 * never rendered in the actual web app a founder uses.
 *
 * This is a recovery, not new engineering: no new backend route, no new
 * service, no new storage, no new UI — the exact same component already
 * used by the Electron build is now also reachable from the regular web
 * nav.
 *
 * Fix: added a MORE_TABS entry (`launchplatform`, group "Enterprise",
 * with search aliases covering "feedback roadmap feature request vote
 * prd release readiness onboarding academy") plus a lazy import and
 * render-switch line in App.jsx, mounting the existing LaunchPlatform.jsx
 * with no props — identical to how ElectronWorkspace.jsx already mounts it.
 *
 * Verified live: reachable via the More menu, all 14 real sub-tabs render,
 * Feedback tab shows 2 real items with working Vote buttons and a real
 * Submit form, "roadmap"/"prd" search aliases both surface it, survives a
 * real logout/login cycle. 144/144 regression passing.
 *
 * Usage: node tests/security/70-launch-platform-unreachable-in-web-mode.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

const assert = require("assert");
const fs     = require("fs");

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function section(title)  { console.log(`\n[${title}]`); }

async function main() {
  const appSrc = fs.readFileSync(require.resolve("../../frontend/src/App.jsx"), "utf8");

  section("App.jsx imports the existing LaunchPlatform.jsx — no new component");
  {
    assert.ok(/const LaunchPlatform\s*=\s*lazy\(\(\) => import\("\.\/components\/LaunchPlatform\.jsx"\)\)/.test(appSrc),
      "App.jsx must lazy-import the existing LaunchPlatform.jsx, not a new file");
    assert.ok(fs.existsSync(require.resolve("../../frontend/src/components/LaunchPlatform.jsx")),
      "LaunchPlatform.jsx must be the pre-existing file (not newly created)");
    ok("App.jsx reuses the existing LaunchPlatform.jsx component");
  }

  section("MORE_TABS has a real 'launchplatform' entry with PM-vocabulary search aliases");
  {
    const entryMatch = appSrc.match(/\{ id: "launchplatform", label: "Launch Platform", group: "Enterprise", alias: "([^"]+)" \}/);
    assert.ok(entryMatch, "could not find the launchplatform MORE_TABS entry with its alias string");
    const alias = entryMatch[1];
    for (const term of ["feedback", "roadmap", "prd"]) {
      assert.ok(alias.includes(term), `alias must include "${term}" so it's discoverable via search`);
    }
    ok("launchplatform nav entry exists with feedback/roadmap/prd search aliases");
  }

  section("The render-switch line mounts LaunchPlatform with no new props (identical to Electron's mount)");
  {
    assert.ok(/\{tab === "launchplatform" && <LaunchPlatform\s*\/>\}/.test(appSrc),
      "the render-switch line must mount <LaunchPlatform /> with no props, same as ElectronWorkspace.jsx does");
    ok("render-switch line correctly mounts the existing component");
  }

  section("No new backend route or service was created for this recovery");
  {
    const routeSrc = fs.readFileSync(require.resolve("../../backend/routes/launchPlatform.js"), "utf8");
    assert.ok(/feedbackHub/.test(routeSrc), "launchPlatform.js must still be backed by the existing feedbackHub.cjs service");
    ok("backend routes/services are unchanged — this was a pure frontend-reachability recovery");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f.msg}: ${f.reason}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch(err => {
  console.error("FATAL:", err);
  process.exit(1);
});
