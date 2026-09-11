"use strict";
/**
 * C.9 AI Experience audit regression — locks in every genuine defect found
 * and fixed during the audit, negative-tested so each can't silently regress.
 *
 * 1. Cross-router middleware leak (security.js/admin.js/governance.js/
 *    automation.js/analytics.js/extensions.js/marketplace.js/plugins.js/
 *    workspace.js): each previously called router.use(attachWorkspace) /
 *    router.use(requireWorkspaceMember) with NO path prefix. Because these
 *    sub-routers are mounted in routes/index.js with no path prefix
 *    (router.use(require("./security")) etc.), an unscoped router.use(fn)
 *    leaked that middleware onto every route mounted afterward in the same
 *    barrel router — reproduced live: it 403'd /coding/ask ("Not a member of
 *    this workspace") for an authenticated user of an unrelated org who had
 *    never touched /security, /admin, /governance, or /automation at all.
 *    Fixed by scoping every attachWorkspace/requireWorkspaceMember call to
 *    its own file's path, matching the requireAuth line already above it.
 *
 * 2. AICostCenter.jsx rendered a fully hardcoded PROVIDERS/BUDGET_ALERTS/
 *    MONTHLY_SPEND/OPTIMIZATIONS seed as if it were live measured AI spend —
 *    fabricated per-model request/token/cost/rpm counts, a fabricated
 *    6-month spend history chart, fabricated budget-vs-threshold
 *    percentages, and fabricated "optimization" recommendations with
 *    invented savings figures — next to two genuinely live fetches
 *    (/ai/status, /analytics/ai) that were used for nothing but a status
 *    dot. Fixed by adding GET /analytics/ai-cost (wiring the already-real
 *    usageMetering.summary()) and rewriting the component to render only
 *    that real data, with an honest empty state when the ledger has no
 *    events yet, and relabeling the two sections with no real backing
 *    engine (routing rules, budget alerts) as explicit examples.
 *
 * 3. /jarvis (the main "AI Chat" tab every account uses) never mounted
 *    attachOrg — the same gap Phase B.14 already found and fixed on
 *    /ai/chat and /ai/chat-with-tools. req.org was always undefined on this
 *    route, so promptHistory entries from the primary chat surface were
 *    always written with orgId:null and org-scoped AI budgets never saw its
 *    usage. Fixed by mounting the same existing attachOrg middleware.
 *
 * All three verified live against the running server during the audit
 * (real two-tenant accounts, real cross-router 403 reproduced and then
 * cleared, real non-zero usage-ledger data rendered correctly, real
 * orgId-tagged prompt-history entries after the fix). This file locks the
 * source-level guarantees in as a fast, standalone regression check.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs     = require("node:fs");
const path   = require("node:path");

const ROOT = path.join(__dirname, "../..");
const read = p => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("109-c9-ai-experience — cross-router middleware scoping", () => {
  const files = [
    ["backend/routes/security.js",    "/security"],
    ["backend/routes/admin.js",       "/admin"],
    ["backend/routes/governance.js",  "/governance"],
    ["backend/routes/automation.js",  "/automation"],
    ["backend/routes/analytics.js",   "/analytics"],
    ["backend/routes/extensions.js",  "/extensions"],
    ["backend/routes/marketplace.js", "/marketplace"],
    ["backend/routes/plugins.js",     "/plugins"],
    ["backend/routes/workspace.js",   "/workspace"],
  ];

  for (const [file, prefix] of files) {
    it(`${file}: attachWorkspace is never registered without a path prefix`, () => {
      const src = read(file);
      // The exact leak pattern: router.use(attachWorkspace) with nothing
      // between the parens but the identifier — no path string argument.
      assert.doesNotMatch(
        src, /router\.use\(\s*attachWorkspace\s*\)/,
        `${file} still registers attachWorkspace unscoped — this leaks onto every route mounted after it in routes/index.js (reproduced live against /coding/ask)`
      );
    });

    it(`${file}: attachWorkspace, when present, is scoped to ${prefix}`, () => {
      const src = read(file);
      if (!/attachWorkspace/.test(src)) return; // some files don't use it at all
      assert.match(
        src, new RegExp(`router\\.use\\(\\s*"${prefix.replace("/", "\\/")}"\\s*,\\s*attachWorkspace\\s*\\)`),
        `${file} should scope attachWorkspace to "${prefix}", matching its own requireAuth line`
      );
    });
  }

  // requireWorkspaceMember only exists in the 4 files that actually gate on it.
  const gated = [
    ["backend/routes/security.js",   "/security"],
    ["backend/routes/admin.js",      "/admin"],
    ["backend/routes/governance.js", "/governance"],
    ["backend/routes/automation.js", "/automation"],
  ];
  for (const [file, prefix] of gated) {
    it(`${file}: requireWorkspaceMember is never registered without a path prefix`, () => {
      const src = read(file);
      assert.doesNotMatch(
        src, /router\.use\(\s*requireWorkspaceMember\s*\)/,
        `${file} still registers requireWorkspaceMember unscoped — this would leak a 403 onto every route mounted after it`
      );
      assert.match(
        src, new RegExp(`router\\.use\\(\\s*"${prefix.replace("/", "\\/")}"\\s*,\\s*requireWorkspaceMember\\s*\\)`),
        `${file} should scope requireWorkspaceMember to "${prefix}"`
      );
    });
  }

  it("codingAssistant.js (the route the leak was reproduced against) still has no workspace gate of its own", () => {
    // Confirms /coding/ask's earlier 403 could only have come from the leak,
    // not from a real (and now possibly duplicated) gate on this file.
    const src = read("backend/routes/codingAssistant.js");
    assert.doesNotMatch(src, /attachWorkspace|requireWorkspaceMember/, "codingAssistant.js should not need workspace middleware — it never scoped by workspace before or after the fix");
  });
});

describe("109-c9-ai-experience — AI cost data honesty", () => {
  it("AICostCenter.jsx contains no hardcoded provider request/token/cost seed data", () => {
    // Strip the file's own header comment block first — it documents (in
    // prose) the fabricated constant names that used to exist, which would
    // otherwise false-positive against the same markers checked below.
    const full = read("frontend/src/components/AICostCenter.jsx");
    const src  = full.replace(/\/\*[\s\S]*?\*\//, "");
    // The exact fabricated literals/declarations that were previously
    // rendered as if live — checked as real declarations, not prose mentions.
    for (const marker of [/claude-3-haiku/, /2_180_000/, /requests:\s*1840/, /const\s+MONTHLY_SPEND\s*=/, /const\s+BUDGET_ALERTS\s*=/, /const\s+OPTIMIZATIONS\s*=\s*\[/]) {
      assert.doesNotMatch(src, marker,
        `AICostCenter.jsx still contains fabricated seed data matching ${marker}`);
    }
  });

  it("AICostCenter.jsx fetches the real /analytics/ai-cost endpoint", () => {
    const src = read("frontend/src/components/AICostCenter.jsx");
    assert.match(src, /_fetch\(\s*["']\/analytics\/ai-cost["']\s*\)/,
      "AICostCenter.jsx should source its cost summary from the real usage-ledger endpoint");
  });

  it("AICostCenter.jsx renders an honest empty state, not fabricated zeros dressed as real", () => {
    const src = read("frontend/src/components/AICostCenter.jsx");
    assert.match(src, /No AI usage recorded yet/);
  });

  it("AICostCenter.jsx labels its two unbacked sections as examples, not live data", () => {
    const src = read("frontend/src/components/AICostCenter.jsx");
    assert.match(src, /Model Routing \(example\)/);
    assert.match(src, /Budget & Alerts \(example\)/);
    assert.match(src, /Example configuration — not measured from your usage/);
  });

  it("backend exposes GET /analytics/ai-cost backed by the real usageMetering.summary()", () => {
    const src = read("backend/routes/analytics.js");
    assert.match(src, /router\.get\(\s*"\/analytics\/ai-cost"/);
    assert.match(src, /usageMetering\.summary\(/);
  });

  it("cost formatting uses 6 decimal places so cheap real requests don't round to a fabricated-looking $0.00", () => {
    const src = read("frontend/src/components/AICostCenter.jsx");
    assert.match(src, /toFixed\(6\)/);
  });
});

describe("109-c9-ai-experience — main AI chat surface org attribution", () => {
  it("/jarvis mounts attachOrg so its usage is org-attributed, matching the B.14 fix already applied to /ai/chat", () => {
    const src = read("backend/routes/jarvis.js");
    assert.match(src, /attachOrg/, "/jarvis should mount attachOrg — without it, req.org is always undefined and promptHistory/budget checks silently lose tenant attribution for the primary chat surface");
    assert.match(src, /router\.post\(\s*"\/jarvis"\s*,\s*requireAuth\s*,\s*attachOrg/, "attachOrg must run before the handler, after requireAuth");
  });
});

describe("109-c9-ai-experience — mission-context cross-tenant leak (CLOSED by Master Recovery C10-004, 2026-08-15)", () => {
  it("missionMemory.cjs supports an OPTIONAL orgId filter on listMissions, without requiring it (74 internal consumers stay unaffected)", () => {
    const src = read("backend/services/missionMemory.cjs");
    assert.match(src, /orgId/, "missionMemory.cjs should now support orgId — this test replaces the old C.9 'documented gap' assertion now that C10-004 fixed it");
    // Must be optional, not required — a required param would break the 74
    // existing internal (non-tenant-scoped) callers of listMissions/createMission.
    assert.match(src, /function listMissions\(opts = \{\}\)/, "listMissions must keep opts optional/defaulted, not suddenly require orgId");
    assert.match(src, /if \(orgId\) \{/, "the orgId filter must be conditional — omitted orgId must preserve the exact pre-recovery behavior for internal consumers");
  });

  it("codingAssistant.js's _missionContext() now threads the real caller orgId through to listMissions", () => {
    const src = read("backend/routes/codingAssistant.js");
    assert.match(src, /function _missionContext\(orgId\)/, "_missionContext must accept orgId as a parameter, not call listMissions unscoped");
    assert.match(src, /mm\.listMissions\(\{ limit: 5, orgId: orgId \|\| undefined \}\)/, "must pass the real orgId through, not a hardcoded/fake value");
    assert.match(src, /attachOrg/, "/coding/* must mount attachOrg so req.org.id is available to pass into _missionContext()");
  });
});

describe("109-c9-ai-experience — coding patch-history/bundle storage leak (CLOSED by Master Recovery, 2026-08-15)", () => {
  it("/coding/patch-history filters by the caller's own orgId, not returning the global store", () => {
    const src = read("backend/routes/codingAssistant.js");
    const listHandler = src.slice(src.indexOf('router.get("/coding/patch-history",'), src.indexOf('router.get("/coding/patch-history/:histId/export"'));
    assert.match(listHandler, /if \(!req\.org\?\.id\) return res\.json\(\{ ok: true, patches: \[\] \}\);/, "must return empty (not the global list) when org context is unresolvable");
    assert.match(listHandler, /p\.orgId === req\.org\.id/, "must filter to only the caller's own org's patches");
  });

  it("/coding/patch-history/:histId/export checks patch ownership before serving the file archive", () => {
    const src = read("backend/routes/codingAssistant.js");
    const exportHandler = src.slice(src.indexOf('router.get("/coding/patch-history/:histId/export"'));
    assert.match(exportHandler.slice(0, 1000), /rec\.orgId !== req\.org\.id/, "export must 404 for a patch belonging to a different org — reproduced live: a real cross-tenant export attempt was blocked after this fix");
  });

  it("/coding/undo-patch (the write-side, most severe half of this leak) checks ownership on BOTH the direct-histId and the fallback most-recent branch", () => {
    const src = read("backend/routes/codingAssistant.js");
    const undoHandler = src.slice(src.indexOf('router.post("/coding/undo-patch"'));
    assert.match(undoHandler.slice(0, 700), /findIndex\(p => p\.id === histId && p\.orgId === req\.org\.id\)/, "direct-histId undo must check ownership — reproduced live: an unrelated tenant could otherwise revert real files via another org's patch");
    assert.match(undoHandler.slice(0, 700), /findIndex\(p => p\.status !== "undone" && p\.orgId === req\.org\.id\)/, "the no-histId 'most recent' fallback must also be scoped — otherwise it reverts the platform's globally most-recent patch regardless of owner");
  });
});
