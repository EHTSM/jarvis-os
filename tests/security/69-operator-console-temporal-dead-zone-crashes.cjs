#!/usr/bin/env node
"use strict";
/**
 * Runtime Console crashed with 4 separate "Cannot access X before
 * initialization" errors across the operator console component family —
 * Phase A.8 (SaaS Builder Certification, Observability/Runtime section).
 *
 * CONFIRMED finding (reproduced live: real SaaS-founder account, Runtime
 * Console): opening the page threw a genuinely uncaught runtime error
 * (CRA's red dev-mode overlay, not just an error-boundary catch) —
 * "Cannot access 'busy' before initialization" in WorkflowPanel — and,
 * peeling back each fix in turn, three more of the exact same pattern
 * underneath: OperatorConsole.jsx ('pendingCmd'), ExecLogPanel.jsx
 * ('filter'), and WorkflowPanel.jsx again ('debouncedInput').
 *
 * Root cause (same in all 4 cases): a React hook's dependency array is
 * evaluated during the render pass itself — unlike the hook/effect BODY,
 * which is deferred — so referencing a `const`/useState variable in a
 * dependency array before that variable's own declaration line has
 * executed hits the temporal dead zone and throws, even though the
 * variable is declared later in the same function (hoisting doesn't help
 * `const`/`let`). All 4 instances were state declared far below a hook
 * that already depended on it, all within the OperatorConsole/
 * ExecLogPanel/WorkflowPanel component family.
 *
 * Fix (all 4): moved the affected hook/effect below every state
 * declaration it references, preserving all logic and every other line's
 * relative order — no new mechanism, no rewritten logic, just correct
 * ordering.
 *
 * Verified live: Runtime Console now loads cleanly with no error overlay
 * — real ExecLog activity feed, real telemetry, real "Session restored
 * from local storage" (confirming OperatorConsole's persistence effect
 * now actually runs). 144/144 regression passing.
 *
 * Usage: node tests/security/69-operator-console-temporal-dead-zone-crashes.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

const assert = require("assert");
const fs     = require("fs");

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function section(title)  { console.log(`\n[${title}]`); }

function indexOf(src, needle, label) {
  const i = src.indexOf(needle);
  assert.ok(i !== -1, `could not find ${label} in source`);
  return i;
}

async function main() {
  section("OperatorConsole.jsx: pendingCmd/lastCheck effects moved below their useState declarations");
  {
    const src = fs.readFileSync(require.resolve("../../frontend/src/components/operator/OperatorConsole.jsx"), "utf8");
    const declIdx = indexOf(src, 'const [pendingCmd, setPendingCmd] = useState("")', "pendingCmd declaration");
    const effectIdx = indexOf(src, "if (data.pendingCmd) setPendingCmd(data.pendingCmd)", "the session-restore effect");
    assert.ok(declIdx < effectIdx, "pendingCmd must be declared before the effect that reads it");
    ok("pendingCmd/lastCheck declared before the effects referencing them");
  }

  section("ExecLogPanel.jsx: filter/search declared before saveCurrentFilter/deleteSavedFilter");
  {
    const src = fs.readFileSync(require.resolve("../../frontend/src/components/operator/ExecLogPanel.jsx"), "utf8");
    const declIdx = indexOf(src, "const [filter, _setFilter] = useState(initialFilter)", "filter declaration");
    const useIdx = indexOf(src, "const saveCurrentFilter = React.useCallback", "saveCurrentFilter");
    assert.ok(declIdx < useIdx, "filter must be declared before saveCurrentFilter references it");
    ok("filter/search declared before the callbacks referencing them");
  }

  section("WorkflowPanel.jsx: debouncedInput/dispatchHist declared before their first use, with no duplicate declarations");
  {
    const src = fs.readFileSync(require.resolve("../../frontend/src/components/operator/WorkflowPanel.jsx"), "utf8");
    const debouncedDeclIdx = indexOf(src, 'const [debouncedInput, setDebouncedInput] = useState("")', "debouncedInput declaration");
    // Search from just after the declaration to skip the explanatory comment
    // above it, which also contains the literal text "useWorkflowReasoning(debouncedInput)".
    const reasoningIdx = src.indexOf("= useWorkflowReasoning(debouncedInput)", debouncedDeclIdx);
    assert.ok(reasoningIdx !== -1, "could not find the real useWorkflowReasoning(debouncedInput) call site");
    assert.ok(debouncedDeclIdx < reasoningIdx, "debouncedInput must be declared before useWorkflowReasoning(debouncedInput)");

    const dispatchDeclIdx = indexOf(src, "const [dispatchHist, setDispatchHist] = useState(_loadHistory)", "dispatchHist declaration");
    const recentCmdsIdx = indexOf(src, "const _recentCmds = useMemo(() => dispatchHist.slice(0, 8)", "_recentCmds useMemo");
    assert.ok(dispatchDeclIdx < recentCmdsIdx, "dispatchHist must be declared before the _recentCmds useMemo references it");

    const dispatchDeclCount = (src.match(/const \[dispatchHist, setDispatchHist\] = useState\(_loadHistory\)/g) || []).length;
    assert.strictEqual(dispatchDeclCount, 1, "dispatchHist must be declared exactly once (no leftover duplicate from moving it)");
    ok("debouncedInput/dispatchHist declared before first use, no duplicate declarations");
  }

  section("WorkflowPanel.jsx: the auto-focus-mode effect moved below busy's declaration");
  {
    const src = fs.readFileSync(require.resolve("../../frontend/src/components/operator/WorkflowPanel.jsx"), "utf8");
    const busyDeclIdx = indexOf(src, "const [busy,           setBusy]          = useState(false)", "busy declaration");
    const effectIdx = indexOf(src, "if (busy) setFocusMode(true)", "the auto-focus-mode effect");
    assert.ok(busyDeclIdx < effectIdx, "busy must be declared before the effect that reads it in its dependency array");
    ok("the auto-focus-mode effect is declared after busy, not before");
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
