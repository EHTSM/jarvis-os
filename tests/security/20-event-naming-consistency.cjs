#!/usr/bin/env node
"use strict";
/**
 * Event naming consistency — regression test.
 *
 * Production Code Quality Certification finding: 114/126 (90%) of
 * runtimeEventBus.emit() calls across the codebase use a colon-namespaced
 * "namespace:subsystem:action" shape (e.g. "agent:supervisor:failed",
 * "civilization:trade:completed") — the clearly dominant pattern. 12 used
 * snake_case instead. Verified none of the 12 had a real listener anywhere
 * (checked both `.on("<name>"` subscription patterns and frontend
 * string-filtering — zero hits beyond one display-only example string in
 * a settings UI), so renaming to match the dominant convention carried no
 * breakage risk.
 *
 * Fixed 6 of the 12 (the ones this repo's own recent commits introduced,
 * so precise context was available): automation_approval_required,
 * automation_notify, automation_rule_created, automation_rule_fired
 * (backend/services/automationService.cjs), credit_local_mode_denied
 * (backend/services/capabilityRouter.cjs + creativeRouter.cjs), and
 * workspace_access_denied (backend/middleware/workspaceMiddleware.cjs) —
 * all renamed to the colon-namespaced form. The audit-log action-name
 * convention (`addAuditEntry(..., "automation.approval_required", ...)`)
 * uses dot-namespacing and is a SEPARATE, already-internally-consistent
 * system — not touched, not conflated with the event-bus naming fix.
 *
 * Usage: node tests/security/20-event-naming-consistency.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(title)  { console.log(`\n[${title}]`); }

async function main() {
  section("Old snake_case event names are gone");
  const fs = require("fs");
  const path = require("path");
  const oldNames = [
    "automation_approval_required", "automation_notify",
    "automation_rule_created", "automation_rule_fired",
    "credit_local_mode_denied", "workspace_access_denied",
  ];
  const filesToCheck = [
    "backend/services/automationService.cjs",
    "backend/services/capabilityRouter.cjs",
    "backend/services/creativeRouter.cjs",
    "backend/middleware/workspaceMiddleware.cjs",
  ];
  for (const rel of filesToCheck) {
    const content = fs.readFileSync(path.join(process.cwd(), rel), "utf8");
    const stillHasOldName = oldNames.some(n => content.includes(`"${n}"`));
    assert(!stillHasOldName, `${rel} contains no old snake_case event names`, "found a stale snake_case emit() call");
  }

  section("New colon-namespaced event names emit correctly");
  const eventBus = require("../../agents/runtime/runtimeEventBus.cjs");
  const captured = [];
  eventBus.subscribe("test-listener-20", (evt) => captured.push(evt));

  // Directly emit through the real bus to confirm the new names are wired
  // (exercising the full rule-fire path would need a real workspace/rule
  // setup; this test is about the event NAME, not the business logic
  // that triggers it — that's already covered by the existing automation
  // and workspace-isolation test suites).
  eventBus.emit("automation:approval:required", { test: true });
  eventBus.emit("automation:notify", { test: true });
  eventBus.emit("automation:rule:created", { test: true });
  eventBus.emit("automation:rule:fired", { test: true });
  eventBus.emit("credit:local_mode:denied", { test: true });
  eventBus.emit("workspace:access:denied", { test: true });

  eventBus.unsubscribe("test-listener-20");

  const seenTypes = captured.map(e => e.type);
  const expected = [
    "automation:approval:required", "automation:notify",
    "automation:rule:created", "automation:rule:fired",
    "credit:local_mode:denied", "workspace:access:denied",
  ];
  for (const name of expected) {
    assert(seenTypes.includes(name), `event bus correctly delivers "${name}" to subscribers`, `not found in: ${seenTypes.join(", ")}`);
  }

  section("Naming convention — colon-namespaced is still the dominant pattern");
  {
    const scanDirs = ["backend", "agents"];
    const allEmits = new Set();
    function listFiles(dir) {
      const out = [];
      function walk(d) {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
          if (entry.name === "node_modules") continue;
          const full = path.join(d, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (/\.(js|cjs)$/.test(entry.name)) out.push(full);
        }
      }
      walk(dir);
      return out;
    }
    for (const dir of scanDirs) {
      for (const file of listFiles(path.join(process.cwd(), dir))) {
        const content = fs.readFileSync(file, "utf8");
        const re = /\.emit\("([a-zA-Z0-9_:.\-]+)"/g;
        let m;
        while ((m = re.exec(content))) allEmits.add(m[1]);
      }
    }
    const colonNamespaced = [...allEmits].filter(n => n.includes(":")).length;
    const total = allEmits.size;
    const pct = total > 0 ? (colonNamespaced / total) * 100 : 0;
    assert(pct >= 90, `colon-namespaced events remain the dominant pattern (>=90%)`, `only ${pct.toFixed(1)}% (${colonNamespaced}/${total})`);
  }

  console.log(`\n${"═".repeat(52)}`);
  console.log(`  Pass: ${pass}   Fail: ${fail}`);
  console.log(`${"═".repeat(52)}`);
  if (failures.length > 0) {
    console.log("\n  Failures:");
    failures.forEach(f => console.log(`    ✗ ${f.msg}: ${f.reason}`));
  }

  try {
    fs.writeFileSync(
      path.join(process.cwd(), "data/event-naming-consistency-test-report.json"),
      JSON.stringify({ generated: new Date().toISOString(), pass, fail, failures }, null, 2)
    );
    console.log("\n  Report: data/event-naming-consistency-test-report.json\n");
  } catch { /* non-critical */ }

  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
