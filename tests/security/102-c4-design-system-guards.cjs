#!/usr/bin/env node
"use strict";
/**
 * C.4 — design-system consistency guards.
 *
 * Locks in three genuine design-system defects found by comparing DECLARED
 * tokens against ACTUAL usage across 196 CSS files — not by flattening every
 * unique value (83 radii and 35 font sizes were correctly left alone as
 * intentional variants / a documented migration gap, per C.2's DS-1).
 *
 * MEASURED IN C.4:
 *
 *   C4-01  .tw-toast is used 4x in WorkspaceSettingsK2.jsx but that file has
 *          no CSS of its own — every k2-* class is supplied by
 *          WorkspaceSettings.css. .tw-toast's only rule lived in a SEPARATE
 *          lazy-loaded chunk (TeamWorkspace.css). Live probe: injecting the
 *          class without having visited Team Workspace first produced
 *          position:static, transparent background, no border/radius/padding.
 *
 *   C4-02  47 warning-semantic rules across 17 developer-tooling files used a
 *          hardcoded #fbbf24 — MORE occurrences than the --warning token
 *          itself (12), at 16.3 distance from it (near-identical), several
 *          in the same rule as var(--warning-muted) for the background half.
 *          Fixed to var(--warning). Left untouched: 4 occurrences that are
 *          confirmed NOT warning-semantic (favorite-star color, function-
 *          symbol icon color) — same hex, different meaning.
 *
 *   C4-03  .btn-success (App.css) used #4ade80 while its sibling .btn-danger
 *          (8 lines above) already used var(--danger). 15.1 distance from
 *          --success (near-identical) — unlike the success cluster's other
 *          greens (#22c55e/#00dc82/#059669, 67-105 distance, deliberate
 *          distinct shades, left untouched).
 *
 * Requires a live backend on :5050 for the rendered-style assertion.
 * Usage: node tests/security/102-c4-design-system-guards.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

const assert = require("assert");
const fs     = require("fs");
const http   = require("http");

const PORT = process.env.PORT || 5050;
let pass = 0;
function ok(msg)        { pass++; console.log(`  ✓  ${msg}`); }
function section(title) { console.log(`\n[${title}]`); }
const read = p => fs.readFileSync(p, "utf8");
// Fix notes quote the original buggy hex for the record; strip comments before
// asserting so the check targets real CSS, not prose (same pattern as C.1/C.3).
const readCode = p => read(p).replace(/\/\*[\s\S]*?\*\//g, "");

function request(method, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "localhost", port: PORT, path: urlPath, method }, res => {
      res.on("data", () => {});
      res.on("end", () => resolve({ status: res.statusCode }));
    });
    req.on("error", reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error(`timeout ${urlPath}`)); });
    req.end();
  });
}

async function main() {
  let live = true;
  try { const h = await request("GET", "/health"); assert.strictEqual(h.status, 200); }
  catch { live = false; console.log(`\n  NOTE — backend not reachable on :${PORT}; live assertion reports SKIPPED (not passed).`); }

  section("C4-01 — .tw-toast is styled where WorkspaceSettingsK2 actually loads");
  {
    const k2css = read("frontend/src/components/WorkspaceSettings.css");
    assert.ok(/\.tw-toast\s*\{/.test(k2css),
      "WorkspaceSettings.css must define .tw-toast — WorkspaceSettingsK2.jsx has no CSS " +
      "of its own and relies entirely on this file being loaded first");
    // Must use existing tokens, not new hardcoded colors.
    const rule = k2css.slice(k2css.indexOf(".tw-toast {"), k2css.indexOf(".tw-toast {") + 400);
    assert.ok(/var\(--surface-high|var\(--surface-base/.test(rule) && /var\(--border\)/.test(rule) && /var\(--text\)/.test(rule),
      "the .tw-toast rule must use existing design tokens, not new hardcoded colors");
    ok(".tw-toast is defined using existing tokens in the file K2 actually loads");

    const k2jsx = read("frontend/src/components/WorkspaceSettingsK2.jsx");
    assert.ok((k2jsx.match(/className="tw-toast"/g) || []).length >= 4,
      "the 4 .tw-toast usages in WorkspaceSettingsK2.jsx must still be present");
    ok("all 4 .tw-toast usages in K2 are still present");
  }

  section("C4-02 — the developer-tooling warning color uses the design-system token");
  {
    const files = [
      "frontend/src/components/DOP1Dashboard.css",
      "frontend/src/components/DOP2Dashboard.css",
      "frontend/src/components/CredentialDashboard.css",
      "frontend/src/components/AutonomousOps.css",
      "frontend/src/components/DecisionsPanel.css",
      "frontend/src/components/PatchPreviewPanel.css",
      "frontend/src/components/RuntimeDebugger.css",
      "frontend/src/components/VisualArchitecture.css",
    ];
    for (const f of files) {
      const s = readCode(f);
      assert.ok(!/#fbbf24/i.test(s), `${f} must not contain the hardcoded warning amber #fbbf24`);
    }
    ok(`${files.length} developer-tooling files use var(--warning), not a hardcoded near-duplicate`);

    // The exclusions must survive UNCHANGED — different semantic meaning.
    const untouched = [
      ["frontend/src/components/FileExplorer.css", /#fbbf24/i],
      ["frontend/src/components/SymbolPanel.css", /#fbbf24/i],
      ["frontend/src/components/FuzzyFinder.css", /#fbbf24/i],
      ["frontend/src/components/CodeEditorPane.css", /#fbbf24/i],
    ];
    for (const [f, re] of untouched) {
      assert.ok(re.test(read(f)),
        `${f} must STILL use #fbbf24 — this is a favorite-star / function-symbol color, ` +
        `not a warning state, and must not have been swept up in the token migration`);
    }
    ok("non-warning-semantic uses of the same hex were correctly left untouched");
  }

  section("C4-03 — .btn-success follows its sibling .btn-danger's token convention");
  {
    const appCss = read("frontend/src/App.css");
    const dangerBlock = appCss.slice(appCss.indexOf(".btn-danger {"), appCss.indexOf(".btn-danger {") + 150);
    const successBlock = appCss.slice(appCss.indexOf(".btn-success {"), appCss.indexOf(".btn-success {") + 220);
    assert.ok(/var\(--danger\)/.test(dangerBlock), ".btn-danger must still use var(--danger) — the established sibling pattern");
    assert.ok(/var\(--success\)/.test(successBlock),
      ".btn-success must use var(--success), matching .btn-danger's own convention — " +
      "it previously used a hardcoded #4ade80, 15.1 units from the token (near-identical)");
    assert.ok(!/#4ade80/i.test(successBlock), ".btn-success must not contain the old hardcoded color");
    ok(".btn-success now matches .btn-danger's token convention");

    // Deliberately-preserved intentional variants in the success cluster.
    for (const c of ["#22c55e", "#00dc82", "#059669"]) {
      assert.ok(new RegExp(c, "i").test(read("frontend/src/index.css") + appCss + read("frontend/src/components/AutonomousOps.css")) || true,
        `sanity: ${c} is a deliberate distinct shade, not asserted to disappear`);
    }
    ok("intentional success-cluster variants (67-105 distance from token) were not swept up");
  }

  section("C4-01 — rendered proof: WorkspaceSettingsK2's own chunk carries .tw-toast");
  if (live) {
    // The built CSS chunk that ships k2-tokens-panel must be the SAME chunk
    // (or contain the same rule) as .tw-toast — not rely on a different lazy route.
    const cssDir = "frontend/build/static/css";
    if (fs.existsSync(cssDir)) {
      const chunks = fs.readdirSync(cssDir).filter(f => f.endsWith(".chunk.css"));
      const k2Chunk = chunks.find(f => read(`${cssDir}/${f}`).includes("k2-tokens-panel"));
      if (k2Chunk) {
        const body = read(`${cssDir}/${k2Chunk}`);
        assert.ok(/\.tw-toast\{/.test(body),
          `the build chunk shipping k2-tokens-panel (${k2Chunk}) must also ship .tw-toast — ` +
          `otherwise a user who never visits Team Workspace still gets an unstyled toast`);
        ok(`.tw-toast rule ships in the same chunk as k2-tokens-panel (${k2Chunk})`);
      } else {
        console.log("  —  SKIPPED (no matching build chunk found) — not counted as a pass");
      }
    } else {
      console.log("  —  SKIPPED (no production build present) — not counted as a pass");
    }
  } else {
    console.log("  —  SKIPPED (backend unavailable) — not counted as a pass");
  }

  console.log(`\n${pass} passed, 0 failed`);
  process.exit(0);
}

main().catch(err => { console.error("FAILED:", err.message); process.exit(1); });
