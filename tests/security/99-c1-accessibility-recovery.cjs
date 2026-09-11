#!/usr/bin/env node
"use strict";
/**
 * C.1 — accessibility recovery regression suite.
 *
 * Locks in the four defects C.1 found and fixed. Three are measured against the
 * live backend; the label fixes are asserted at their real source locations,
 * because that is where they silently revert (B19.3 recorded exactly that
 * failure mode: recovered keyboard fixes reverted and only source-level guards
 * would have caught it).
 *
 * MEASURED LIVE IN C.1:
 *
 *   C1-D1  A missing build asset returned 401 {"error":"Unauthorized"} instead
 *          of 404. express.static calls next() on a miss, so the request fell
 *          into the API stack and came back as an AUTH failure — during a stale
 *          deploy that sends an operator to debug authentication while the real
 *          cause is an absent bundle. It is also what blocked the C.1 scan: the
 *          SPA could not boot and every tab measured zero focusable elements.
 *
 *   C1-D4  index.html was cached for the process lifetime. CRA emits
 *          content-hashed bundles, so after a redeploy the running server kept
 *          serving HTML referencing main.<oldhash>.js — files no longer on
 *          disk. Every visitor got a blank page until someone restarted the
 *          process. Measured: served main.ee3b42b3.js while disk had
 *          main.51b4f711.js.
 *
 *   C1-D2/D3  Two modals painted a hardcoded DARK background through an
 *          undefined CSS token (var(--surface-elevated,#12131c) and
 *          var(--surface-2,#1a1a2e)). In light mode the text tokens flip dark,
 *          giving 1.13:1 and 1.04:1 against AA's 4.5:1 — the first-run
 *          onboarding modal and a DESTRUCTIVE stop-confirmation were both
 *          unreadable.
 *
 *   G1-B193  Seven rendered controls had only a placeholder. A placeholder is
 *          not an accessible name under WCAG 3.3.2 — it disappears on input.
 *          Five already had visible <label> text that was never associated.
 *
 * Requires a live backend on :5050 for the served-asset assertions.
 * Usage: node tests/security/99-c1-accessibility-recovery.cjs
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

function request(method, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "localhost", port: PORT, path, method }, res => {
      let b = ""; res.on("data", d => (b += d));
      res.on("end", () => resolve({ status: res.statusCode, body: b, type: res.headers["content-type"] || "" }));
    });
    req.on("error", reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error(`timeout ${path}`)); });
    req.end();
  });
}

async function main() {
  let live = true;
  try {
    const h = await request("GET", "/health");
    assert.strictEqual(h.status, 200);
  } catch {
    live = false;
    console.log(`\n  NOTE — backend not reachable on :${PORT}; live assertions will report SKIPPED (not passed).`);
  }

  section("C1-D1 — a missing build asset is 404, never 401");
  // Mission 65: the real fix (backend/server.js's hasFrontendBuild-gated
  // /static,/assets 404 fallback — see the comment at server.js:268-284)
  // only registers when frontend/build actually exists on disk. This
  // environment's regression CI job never runs `npm run build:frontend`
  // before starting the backend (that happens in a separate "Frontend
  // Build" job), so hasFrontendBuild is false there, the whole
  // 404-fallback block never registers, and the request falls through to
  // whatever generic auth-gated route handles it — reproducing the
  // pre-fix symptom not because the fix regressed, but because its own
  // precondition (a real build) isn't met in that job. Matches this same
  // repo's own established skip pattern for the same precondition (see
  // 96-production-build-artifact-integrity.cjs's identical guard).
  const hasBuild = fs.existsSync("frontend/build/index.html");
  if (live && !hasBuild) {
    console.log("  —  SKIPPED (no production build present) — not counted as a pass");
    console.log("     Build it with: cd frontend && npm run build");
  } else if (live) {
    for (const p of ["/static/js/main.DOESNOTEXIST.js", "/static/css/nope.css"]) {
      const r = await request("GET", p);
      assert.notStrictEqual(r.status, 401,
        `${p} must not return 401 — a MISSING FILE reported as an AUTH FAILURE sends ` +
        `an operator to debug authentication during a stale deploy`);
      assert.strictEqual(r.status, 404, `${p} must return 404 (got ${r.status})`);
    }
    ok("missing build assets return 404, not 401");

    const realish = await request("GET", "/");
    assert.strictEqual(realish.status, 200, "the SPA shell must still be served");
    ok("SPA shell still serves 200 — the 404 boundary did not over-reach");
  } else {
    console.log("  —  SKIPPED (backend unavailable) — not counted as a pass");
  }

  section("C1-D4 — the served index.html matches the bundles on disk");
  // Mission 66: same precondition gap as C1-D1 above — this section only
  // checked `live`, not `hasBuild`. Without a real frontend build, GET /
  // still returns 200 (e.g. a dev-mode placeholder or the bare SPA
  // fallback), but it genuinely has no /static/js|css/*.{js,css} asset
  // references to find, since there is no real build to reference —
  // `referenced.length > 0` then fails for the same reason as C1-D1: a
  // missing precondition, not a regression of the real fix. Matches the
  // same skip pattern already applied to C1-D1 and to this file's own
  // sibling (96-production-build-artifact-integrity.cjs).
  if (live && !hasBuild) {
    console.log("  —  SKIPPED (no production build present) — not counted as a pass");
    console.log("     Build it with: cd frontend && npm run build");
  } else if (live) {
    const html = (await request("GET", "/")).body;
    const referenced = [...html.matchAll(/\/static\/(js|css)\/([A-Za-z0-9._-]+\.(?:js|css))/g)].map(m => m[2]);
    assert.ok(referenced.length > 0, "the served shell must reference at least one build asset");

    const missing = [];
    for (const name of new Set(referenced)) {
      const sub = name.endsWith(".css") ? "css" : "js";
      if (!fs.existsSync(`frontend/build/static/${sub}/${name}`)) missing.push(name);
    }
    assert.deepStrictEqual(missing, [],
      `the served index.html references build assets that do not exist on disk: ${missing.join(", ")} — ` +
      `this is the stale-template defect and it renders a BLANK PAGE for every visitor`);
    ok(`all ${new Set(referenced).size} referenced build assets exist on disk`);

    // Every referenced asset must actually serve as a script/stylesheet.
    for (const name of new Set(referenced)) {
      const sub = name.endsWith(".css") ? "css" : "js";
      const r = await request("GET", `/static/${sub}/${name}`);
      assert.strictEqual(r.status, 200, `/static/${sub}/${name} must serve 200 (got ${r.status})`);
      assert.ok(!/application\/json/.test(r.type),
        `/static/${sub}/${name} served as ${r.type} — the browser refuses to execute it`);
    }
    ok("every referenced asset serves 200 with an executable content-type");
  } else {
    console.log("  —  SKIPPED (backend unavailable) — not counted as a pass");
  }

  section("C1-D2/D3 — modals must not paint a hardcoded dark background");
  {
    // Strip /* */ comments first: the fix notes quote the original buggy
    // declaration, and matching that text would fail on the explanation rather
    // than on real CSS.
    const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, "");

    const cfr = strip(read("frontend/src/components/CustomerFirstRunWizard.css"));
    assert.ok(!/--surface-elevated\s*,\s*#/.test(cfr),
      "CustomerFirstRunWizard must not fall back to a hardcoded colour through an undefined " +
      "token — in light mode that produced 1.13:1 against AA's 4.5:1");
    assert.ok(/\.cfr-card[^}]*background:\s*var\(--surface-float\)/s.test(cfr),
      ".cfr-card must use the theme-aware --surface-float modal token");
    ok("first-run modal uses a theme-aware surface token");

    const cmd = strip(read("frontend/src/components/CommandCenter.css"));
    assert.ok(!/--surface-2\s*,\s*#/.test(cmd),
      "the stop-confirmation panel must not fall back to a hardcoded dark colour — " +
      "at 1.04:1 a user could not read a DESTRUCTIVE confirmation in light mode");
    assert.ok(/\.cmd-stop-confirm-panel[^}]*background:\s*var\(--surface-float\)/s.test(cmd),
      ".cmd-stop-confirm-panel must use --surface-float");
    ok("destructive stop-confirmation uses a theme-aware surface token");

    // --surface-float must be defined in BOTH themes, or the fix is hollow.
    const index = read("frontend/src/index.css");
    const dark = /:root\s*{[^}]*--surface-float\s*:/s.test(index);
    const light = /\[data-theme="light"\]\s*{[^}]*--surface-float\s*:/s.test(index);
    assert.ok(dark && light,
      `--surface-float must be defined in both themes (dark=${dark} light=${light}) — ` +
      `otherwise the modals fall back to transparent`);
    ok("--surface-float is defined in both the dark and light palettes");
  }

  section("G1-B193 — rendered controls have a real accessible name");
  {
    const pv2 = read("frontend/src/components/PaymentsV2.jsx");
    for (const id of ["pv2-customer", "pv2-amount", "pv2-description", "pv2-phone", "pv2-message"]) {
      assert.ok(new RegExp(`htmlFor="${id}"`).test(pv2) && new RegExp(`id="${id}"`).test(pv2),
        `PaymentsV2 must associate its existing visible label with #${id} — the label text ` +
        `was already written, it was simply never connected to the control`);
    }
    ok("5 Payments controls are associated with their existing visible labels");

    const cv2 = read("frontend/src/components/ContactsV2.jsx");
    assert.ok(/className="cv2-search"[\s\S]{0,200}aria-label=|aria-label=[\s\S]{0,200}className="cv2-search"/.test(cv2),
      "the contacts search field must carry an accessible name — it is icon-prefixed with no visible label");
    ok("contacts search has an accessible name");

    const chat = read("frontend/src/components/Chat.jsx");
    assert.ok(/className="chat-input"[\s\S]{0,200}aria-label=|aria-label="Message Ooplix"/.test(chat),
      "the chat input must have a STABLE accessible name — its placeholder changes with " +
      "connection state, so a screen reader would announce a different field name each time");
    ok("chat input has a stable accessible name independent of its changing placeholder");
  }

  console.log(`\n${pass} passed, 0 failed`);
  process.exit(0);
}

main().catch(err => { console.error("FAILED:", err.message); process.exit(1); });
