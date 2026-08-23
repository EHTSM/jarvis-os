#!/usr/bin/env node
"use strict";
/**
 * Cross-Product UX Consistency Sweep (Phase A.11.8) — the final A.11 sub-phase.
 *
 * A.11.1–A.11.7 each certified one product area. This phase looks for the
 * inconsistencies that only become visible when comparing ACROSS those areas,
 * plus the reachable surfaces no sub-phase covered. Every finding below was
 * reproduced live in Playwright against the real running app with a real
 * authenticated account, real clicks, real computed styles and real backend
 * cross-checks — not inferred from source.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * FINDING 1 (highest value) — Marketplace rendered a real HTTP 402 as "0".
 *
 *   MarketplaceCenter.jsx's `get()` returned `r.json()` with no status check,
 *   so a non-2xx response was indistinguishable from a successful empty one.
 *   The backend genuinely gates this entire surface behind a plan:
 *
 *     GET /marketplace/catalog     → HTTP 402
 *     GET /marketplace/categories  → HTTP 402
 *     {"error":"feature_gated","featureId":"plugins.marketplace",
 *      "upgradeRequired":"starter",
 *      "message":"This feature requires the Starter plan or higher."}
 *
 *   That body parses fine, `catalog?.plugins` is undefined → `[]`, so the
 *   catch never fired and the screen asserted, as fact:
 *       "0" TOTAL PLUGINS  +  "No plugins in this category yet."
 *   Both measured live. Neither was true — the catalog was never read, and the
 *   backend had already explained exactly why in a message the UI discarded.
 *
 *   This is the same false-confidence class that dominated the whole A.11
 *   audit (Runtime Console's "0% success rate" over 20/20 healthy runs,
 *   Reports claiming services down that /health showed running, Team's
 *   "0 MEMBERS" with 1 real member, Customer Success's "no records" on a
 *   failed fetch) — and the most severe remaining instance, because the
 *   backend was already sending a perfectly good human explanation.
 *
 *   Fix: `get()` throws on !r.ok, carrying status/gated/upgradeRequired; the
 *   loader records that in `loadError` and sets items to null (unknown) rather
 *   than [] (genuinely zero); TOTAL PLUGINS renders "—", this app's own
 *   established unknown placeholder; and the pane shows the backend's real
 *   message. The reference for this shape is the sibling PluginMarketplace.jsx,
 *   which already tracked a `catalogErr` and refused to render a false zero.
 *
 * FINDING 2 — the AI Costs tab crashed outright on every render.
 *
 *   AICostCenter.jsx line ~207 mapped over `hostedProviders`, which was
 *   referenced exactly once and DEFINED NOWHERE in the file. Measured live:
 *   the whole tab was replaced by the ErrorBoundary's
 *       "Something went wrong — The aicost panel encountered an error.
 *        hostedProviders is not defined"
 *   Its counterpart one line above (`localProviders = providers.filter(
 *   p=>p.type==="local")`) exists and works, so this is a genuinely missing
 *   sibling, recovered with the exact complementary filter. PROVIDERS carries
 *   only "local" and "hosted", so the complement is precise, not a catch-all.
 *
 * FINDING 3 — destructive actions with no confirmation, the highest-severity
 *   remaining class after A.11.2/A.11.5/A.11.7 wired ConfirmDialog elsewhere.
 *
 *   A full sweep of every component issuing a DELETE found exactly four:
 *   ConnectorSetupWizard (gated by A.11.7), OrgAdminCenter (gated by A.11.5),
 *   and two that were still completely unguarded:
 *     • TeamWorkspace.handleRemove         → DELETE /workspace/:id/members/:acc
 *     • WorkspaceSettingsK2.revoke/remove  → DELETE /security/session/:id
 *                                          → DELETE /security/device/:id
 *   A.11.5 explicitly left TeamWorkspace's handleRemove unfixed, bundling it
 *   into that phase's UNKNOWN-A (TeamWorkspace's local toast subsystem, which
 *   genuinely would require re-wiring onToast through App.jsx). Re-evaluated
 *   here as the mission instructed: the two concerns are separable. useConfirm
 *   is entirely self-contained — a hook plus a rendered element, no prop
 *   threading, no App.jsx signature change, nothing deleted — so gating these
 *   DELETEs is an in-place recovery of the established pattern. The toast
 *   subsystems were deliberately left exactly as they were.
 *
 * FINDING 4 — page-header baseline drift on the surfaces no sub-phase covered.
 *
 *   The app-wide baseline, measured across .oac-/.tw-/.ws-/.bd-/.launch-/
 *   .sc-/.mc-/.csw-title, is 22px / 800 / var(--text) / -0.3px with a
 *   13.5px / var(--text-dim) subtitle. Measured live before the fix:
 *     • Overview       20px / 700 / -0.3px, 13px subtitle   (.cap-title)
 *     • Beta Checklist NO heading element at all — the title was a <span>
 *                      styled 15px/600 with two hardcoded hex colours that
 *                      ignored the light/dark toggle entirely
 *     • Legal OS       18px / 700 / normal, no subtitle (inline-styled)
 *   All three recovered to the existing baseline. Legal OS is the identical
 *   shape A.11.7 recovered on CustomerSuccessCenter in the same inline-styled
 *   family, so the values were copied from that precedent.
 *
 * FINDING 5 — ⌘K / More-menu search vocabulary drift (additive, low-risk).
 *
 *   Two registries describe the same destinations: App.jsx's MORE_TABS (with
 *   an `alias` field) and CommandPalette.jsx's NAV_ACTIONS (with `keywords`).
 *   A programmatic diff of both found every one of the 82 destinations present
 *   in both — A.11.1's 12-destination fix genuinely closed that gap — but
 *   14 aliases had NO keywords counterpart, so words that found a destination
 *   in the More menu returned "No commands found" in ⌘K. Six further entries
 *   had labels that disagree between the two registries, so searching the name
 *   the app itself displays failed. All recovered by copying each destination's
 *   own existing alias across; `keywords` feeds the same scorer via
 *   Math.max(labelScore, keywordScore), so this is purely additive.
 *
 *   Also added: the nine connector provider ids the LIVE backend actually
 *   returns from GET /my-connectors, and Customer Success's own rendered tab
 *   and KPI labels. Both verified against real responses/render — not invented.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * TEST INTEGRITY
 *   • LIVE assertions drive a real browser: real navigation, real clicks, real
 *     getComputedStyle(), real transport-layer interception.
 *   • A genuine environmental block after real retries is an explicit SKIP in a
 *     separate tally and is NEVER counted as a pass. No assertion is ever
 *     satisfied from inside a catch branch.
 *   • Skips are gated on FIX-INDEPENDENT render signals (did the app shell and
 *     the destination pane mount at all?) — never on the assertion under test.
 *     This is A.11.7's lesson, which mis-classified two real regressions as
 *     environmental skips before tightening its classifiers.
 *   • Comment-stripping is verified by verifyStrip(): A.11.6 and A.11.7 both
 *     had strippers that silently deleted real JSX, which would have made
 *     regressions pass vacuously. A green result from an unverified stripper is
 *     not trusted here.
 *   • Includes anti-over-correction and negative assertions: honest zeros must
 *     still render as zeros, non-destructive actions must NOT gain a dialog,
 *     and routes that genuinely send {ok:true} must not be blind-swapped.
 */

const assert = require("assert");
const fs     = require("fs");
const path   = require("path");
const http   = require("http");

let pass = 0, fail = 0, skip = 0;
const failures = [], skips = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function todo(msg, why)  { skip++; skips.push({ msg, why }); console.log(`  ⊘  SKIP ${msg} — ${why}`); }
function section(title)  { console.log(`\n[${title}]`); }
// Run a group of assertions so that a failure is RECORDED and the run CONTINUES,
// instead of a bare assert aborting the process at the first failure. Without
// this, a prove-it-can-fail run stops at the first static failure and can never
// demonstrate that the LIVE assertions also genuinely fail.
function group(name, fn) {
  try { fn(); }
  catch (e) {
    if (e instanceof assert.AssertionError) ko(name, e.message);
    else throw e;
  }
}

const R = p => fs.readFileSync(path.join(process.cwd(), p), "utf8");

// Strip line comments so "must NOT contain X" assertions test real CODE, not
// prose. Deliberately conservative, and every use is guarded by verifyStrip().
function stripLineComments(src) {
  return src.split("\n").map(line => {
    const i = line.indexOf("//");
    if (i < 0) return line;
    if (i > 0 && (line[i - 1] === ":" || line[i - 1] === "\\")) return line; // http://
    const before = line.slice(0, i);
    const q = (before.match(/"/g) || []).length + (before.match(/'/g) || []).length + (before.match(/`/g) || []).length;
    if (q % 2 !== 0) return line;
    return before;
  }).join("\n");
}
function verifyStrip(stripped, mustSurvive, what) {
  for (const s of mustSurvive) {
    assert.ok(stripped.includes(s),
      `TOOLING BUG: comment-stripping destroyed real code in ${what} — "${s}" did not survive`);
  }
  return stripped;
}

const FRONT = "http://localhost:3000";
const BACK  = "http://localhost:5050";
const AUTH  = "scratchpad/a11-ux-consistency/a117/auth.json";

function req(url, { cookie, timeout = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.get(url, { headers: cookie ? { Cookie: cookie } : {}, timeout }, res => {
      let b = ""; res.on("data", d => b += d);
      res.on("end", () => resolve({ status: res.statusCode, body: b }));
    });
    r.on("timeout", () => { r.destroy(); reject(new Error("timeout")); });
    r.on("error", reject);
  });
}
async function retry(fn, { tries = 5, base = 1200, label = "" } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(i); } catch (e) { last = e; }
    if (i < tries - 1) await new Promise(r => setTimeout(r, base * Math.pow(2, i)));
  }
  throw new Error(`retry exhausted${label ? " [" + label + "]" : ""}: ${last && last.message}`);
}

// Verify a saved session's JWT is genuinely unexpired BEFORE using it, so an
// expired credential is reported as a skip rather than a false product failure.
function sessionState() {
  try {
    const s = JSON.parse(R(AUTH));
    const c = (s.cookies || []).find(x => x.name === "jarvis_auth");
    if (!c) return { ok: false, why: "no jarvis_auth cookie in saved state" };
    const pl = JSON.parse(Buffer.from(c.value.split(".")[1], "base64").toString());
    if (pl.exp * 1000 <= Date.now())
      return { ok: false, why: `saved JWT expired at ${new Date(pl.exp * 1000).toISOString()}` };
    return { ok: true, cookie: `jarvis_auth=${c.value}`, email: pl.email };
  } catch (e) { return { ok: false, why: `cannot read saved session: ${e.message}` }; }
}

async function main() {

  // ══════════════════════════════════════════════════════════════════════
  // PART A — STATIC: the fixes are genuinely in the source, in the right shape
  // ══════════════════════════════════════════════════════════════════════

  const mkt  = R("frontend/src/components/MarketplaceCenter.jsx");
  const acc  = R("frontend/src/components/AICostCenter.jsx");
  const tw   = R("frontend/src/components/TeamWorkspace.jsx");
  const k2   = R("frontend/src/components/WorkspaceSettingsK2.jsx");
  const capCss = R("frontend/src/components/CapabilitiesOverview.css");
  const bcCss  = R("frontend/src/components/BetaChecklist.css");
  const bcJsx  = R("frontend/src/components/BetaChecklist.jsx");
  const legal  = R("frontend/src/components/LegalOSCenter.jsx");
  const cp     = R("frontend/src/components/CommandPalette.jsx");
  const app    = R("frontend/src/App.jsx");

  section("F1 static — Marketplace distinguishes a failed/gated read from a real empty catalog");
  group("F1 static", () => {
    // Sentinels must be real CODE that exists BOTH before and after the fix —
    // otherwise verifyStrip aborts the whole run when the fix is reverted, and a
    // prove-it-can-fail check can never see the real assertion failures.
    // ("TOTAL PLUGINS" is the CSS-uppercased rendering of the source's
    // "Total plugins"; using the rendered form tripped verifyStrip on the first
    // run, which is the guard working correctly.)
    const mktCode = verifyStrip(stripLineComments(mkt),
      ["async function get(path)", "Total plugins", "No plugins in this category yet."],
      "MarketplaceCenter.jsx");

    assert.ok(/if \(!r\.ok\)/.test(mktCode),
      "get() must check r.ok — a 402 body must not be treated as a successful payload");
    ok("get() checks r.ok instead of returning r.json() unconditionally");

    assert.ok(/e\.gated\s*=\s*r\.status === 402/.test(mktCode),
      "a 402 must be marked as a gated feature, not a generic transport error");
    ok("a real HTTP 402 is classified as feature-gated, carrying upgradeRequired");

    assert.ok(/setItems\(null\)/.test(mktCode),
      "on a failed read items must become null (unknown), never [] (a claim of zero)");
    ok("a failed read sets items to null (unknown), not [] (genuinely zero)");

    // The unknown placeholder must be this app's own established "—"
    assert.ok(/catalogRead \? \(categories\.find[\s\S]{0,80}\) : "—"/.test(mktCode),
      "TOTAL PLUGINS must render the app's established — placeholder when unknown");
    ok("TOTAL PLUGINS renders '—' when the catalog was never read");

    // ANTI-OVER-CORRECTION: the genuine-empty branch must SURVIVE
    assert.ok(/items\.length === 0 \?[\s\S]{0,200}No plugins in this category yet\./.test(mktCode),
      "a genuinely empty catalog must STILL say 'No plugins in this category yet.'");
    ok("anti-over-correction: a genuinely empty catalog still reports itself as empty");

    // the backend's own message must reach the user
    assert.ok(/loadError\.message/.test(mktCode) && /loadError\.upgradeRequired/.test(mktCode),
      "the backend's real message and required plan must be surfaced, not discarded");
    ok("the backend's own feature_gated message and required plan reach the user");
  });

  section("F2 static — AI Costs' provider list is real and honestly empty-stated");
  group("F2 static", () => {
    // Mission 38 (2026-08-23): AICostCenter.jsx was rewritten after this test
    // was written — the original local/hosted provider split
    // (localProviders/hostedProviders) no longer exists anywhere in the
    // component; it was replaced with a single, real `providers` array
    // derived from aiStatus?.providers (real API data, not a stub) with its
    // own honest "No provider health data available." empty state. The
    // underlying finding this section targeted (a missing/fake provider
    // list) is verifiably still fixed under the new, simpler structure.
    const accCode = verifyStrip(stripLineComments(acc),
      ["const providers", "providers.map", "No provider health data available."],
      "AICostCenter.jsx");

    assert.ok(/const providers\s*=\s*Array\.isArray\(aiStatus\?\.providers\)\s*\?\s*aiStatus\.providers\s*:\s*\[\]/.test(accCode),
      "providers is derived from the real aiStatus API response, not a hardcoded/stubbed list");
    ok("providers is a real derivation from aiStatus?.providers, not a stub");

    // NEGATIVE: an empty real result must render an honest empty state, not
    // fabricated placeholder provider rows.
    assert.ok(/providers\.length === 0[\s\S]{0,80}No provider health data available\./.test(accCode),
      "an empty real providers list must render an honest empty state, not fabricated rows");
    ok("negative: a genuinely empty providers list renders an honest empty banner, not fake data");
  });

  section("F3 static — destructive actions are gated by the established ConfirmDialog");
  group("F3 static", () => {
    const twCode = verifyStrip(stripLineComments(tw),
      ["handleRemove", 'method: "DELETE"'], "TeamWorkspace.jsx");
    assert.ok(/useConfirm/.test(twCode) && /\{ConfirmUI\}/.test(twCode),
      "TeamWorkspace must use the shared useConfirm hook and render its dialog");
    assert.ok(/await confirm\(\{[\s\S]{0,320}danger: true[\s\S]{0,120}\}\)\) return;[\s\S]{0,200}method: "DELETE"/.test(twCode),
      "the member DELETE must be preceded by a danger confirm that can abort it");
    ok("TeamWorkspace member removal is gated by a danger ConfirmDialog");

    const k2Code = verifyStrip(stripLineComments(k2),
      ["/security/session/", "/security/device/"], "WorkspaceSettingsK2.jsx");
    assert.ok(/async function revoke\(id\)[\s\S]{0,420}await confirm\(\{[\s\S]{0,300}danger: true[\s\S]{0,120}\}\)\) return;/.test(k2Code),
      "session revoke must be confirmed before the DELETE");
    ok("session revoke is gated by a danger ConfirmDialog");
    assert.ok(/async function remove\(id\)[\s\S]{0,460}await confirm\(\{[\s\S]{0,320}danger: true[\s\S]{0,120}\}\)\) return;/.test(k2Code),
      "device removal must be confirmed before the DELETE");
    ok("device removal is gated by a danger ConfirmDialog");

    // NEGATIVE / anti-over-correction: a NON-destructive action must NOT gain a dialog
    assert.ok(!/async function trust\(id\)[\s\S]{0,200}await confirm\(/.test(k2Code),
      "trusting a device is not destructive and must NOT have been given a confirm dialog");
    ok("anti-over-correction: the non-destructive 'trust device' action gained no dialog");

    // NEGATIVE: nothing was converted to a native window.confirm
    assert.ok(!/window\.confirm/.test(twCode) && !/window\.confirm/.test(k2Code),
      "the recovery must use the in-app ConfirmDialog, never a native window.confirm");
    ok("negative: no native window.confirm was introduced");
  });

  section("F4 static — page headers recovered to the measured app-wide baseline");
  group("F4 static", () => {
    // The baseline itself, as it exists in the reference files. If these change,
    // the assertions below are measuring against the wrong thing.
    const oac = R("frontend/src/components/OrgAdminCenter.css");
    assert.ok(/\.oac-title\s*\{[^}]*font-size:\s*22px[^}]*font-weight:\s*800[^}]*letter-spacing:\s*-0\.3px/.test(oac),
      "the reference baseline (.oac-title) must still be 22px/800/-0.3px");
    ok("reference baseline confirmed: .oac-title is 22px / 800 / -0.3px");

    assert.ok(/\.cap-title\s*\{[^}]*font-size:\s*22px[^}]*font-weight:\s*800[^}]*letter-spacing:\s*-0\.3px/.test(capCss),
      "Overview's .cap-title must match the baseline");
    assert.ok(/\.cap-sub\s*\{[^}]*font-size:\s*13\.5px/.test(capCss),
      "Overview's subtitle must be the baseline 13.5px");
    ok("Overview (.cap-title) recovered to 22px / 800 / -0.3px + 13.5px subtitle");

    assert.ok(/\.bc-title\s*\{[^}]*font-size:\s*22px[^}]*font-weight:\s*800[^}]*letter-spacing:\s*-0\.3px[^}]*color:\s*var\(--text\)/.test(bcCss),
      "Beta Checklist's .bc-title must match the baseline AND use the theme token");
    assert.ok(/\.bc-subtitle\s*\{[^}]*font-size:\s*13\.5px[^}]*color:\s*var\(--text-dim\)/.test(bcCss),
      "Beta Checklist's subtitle must be 13.5px var(--text-dim)");
    ok("Beta Checklist recovered to the baseline and to theme tokens");

    assert.ok(/<h1 className="bc-title">/.test(bcJsx) && /<p className="bc-subtitle">/.test(bcJsx),
      "Beta Checklist's title must be a real heading element, not a <span>");
    ok("Beta Checklist's title is a real <h1> (the page had no heading at all before)");

    assert.ok(/fontSize: 22, fontWeight: 800, letterSpacing: "-0\.3px", color: "var\(--text\)"/.test(legal),
      "Legal OS's inline-styled header must match the baseline");
    assert.ok(/fontSize: 13\.5, color: "var\(--text-dim\)"/.test(legal),
      "Legal OS must have the baseline subtitle it previously lacked entirely");
    ok("Legal OS recovered to 22px / 800 / -0.3px with a real subtitle");
  });

  section("F5 static — ⌘K keyword coverage matches the More-menu alias registry");
  group("F5 static", () => {
    // Parse BOTH registries out of the real source and diff them programmatically,
    // rather than asserting a hand-written list that can itself drift.
    const block = (src, marker) => {
      const i = src.indexOf(marker);
      assert.ok(i >= 0, `registry ${marker} not found`);
      let j = src.indexOf("[", i), depth = 0, k = j;
      for (; k < src.length; k++) { if (src[k] === "[") depth++; else if (src[k] === "]") { depth--; if (!depth) break; } }
      return src.slice(j, k + 1);
    };
    const objs = b => {
      const out = []; const re = /\{[^{}]*\}/g; let m;
      while ((m = re.exec(b))) {
        const s = m[0];
        const g = f => { const r = new RegExp(f + '\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"').exec(s); return r ? r[1] : null; };
        if (!g("id")) continue;
        out.push({ id: g("id"), label: g("label"), alias: g("alias"), keywords: g("keywords"), tab: g("tab") });
      }
      return out;
    };
    const more = objs(block(app, "const MORE_TABS ="));
    const nav  = objs(block(cp,  "const NAV_ACTIONS ="));
    assert.ok(more.length > 60 && nav.length > 60,
      `TOOLING BUG: registry parse returned too few entries (more=${more.length}, nav=${nav.length})`);
    ok(`both registries parsed: ${more.length} MORE_TABS, ${nav.length} NAV_ACTIONS`);

    const navByTab = new Map(nav.filter(n => n.tab).map(n => [n.tab, n]));

    // every destination reachable in the More menu must exist in ⌘K
    const missing = more.filter(m => !navByTab.has(m.id)).map(m => m.id);
    assert.deepStrictEqual(missing, [],
      `every More-menu destination must have a ⌘K entry; missing: ${missing.join(", ")}`);
    ok("all More-menu destinations have a ⌘K entry (0 missing)");

    // every alias word must be findable in ⌘K too
    const drift = [];
    for (const m of more) {
      if (!m.alias) continue;
      const n = navByTab.get(m.id);
      const hay = ((n.keywords || "") + " " + (n.label || "")).toLowerCase();
      const miss = m.alias.toLowerCase().split(/\s+/).filter(w => w && !hay.includes(w));
      if (miss.length) drift.push(`${m.id}:${miss.join("/")}`);
    }
    assert.deepStrictEqual(drift, [],
      `every More-menu alias word must also be a ⌘K keyword; drifted: ${drift.join(", ")}`);
    ok("all 14 previously-drifted alias→keyword gaps are closed (0 remaining)");

    // where the two registries disagree on a label, ⌘K must still find the
    // name the app actually displays
    const labelDrift = [];
    for (const m of more) {
      const n = navByTab.get(m.id);
      if (!n || n.label === m.label) continue;
      const hay = ((n.keywords || "") + " " + (n.label || "")).toLowerCase();
      if (!hay.includes(m.label.toLowerCase())) labelDrift.push(`${m.id}("${m.label}")`);
    }
    assert.deepStrictEqual(labelDrift, [],
      `⌘K must find each destination by the label the app displays; unfindable: ${labelDrift.join(", ")}`);
    ok("every destination is findable by the display name the app itself shows");

    // NEGATIVE: keywords are additive only — no label was renamed to force a match
    assert.ok(/label: "Execution Engine"/.test(cp) && /label: "Support OS"/.test(cp),
      "existing ⌘K labels must be untouched — the recovery is additive keywords only");
    ok("negative: no ⌘K label was renamed; the fix is additive keywords only");
  });

  // ══════════════════════════════════════════════════════════════════════
  // PART B — LIVE: drive the real app and measure real rendered behaviour
  // ══════════════════════════════════════════════════════════════════════

  const sess = sessionState();
  if (!sess.ok) {
    todo("ALL LIVE assertions", `no usable session — ${sess.why}`);
  } else {
    // Backend must be genuinely reachable before any live claim is made.
    let backendUp = false;
    try {
      const h = await retry(() => req(`${BACK}/health`, { cookie: sess.cookie }), { label: "health" });
      backendUp = h.status === 200;
    } catch { backendUp = false; }

    if (!backendUp) {
      todo("ALL LIVE assertions", "backend /health did not answer after real retries");
    } else {
      // Ground truth for Finding 1, measured from the real backend in this run.
      let gated402 = false, gateMsg = "";
      try {
        const c = await retry(() => req(`${BACK}/marketplace/catalog`, { cookie: sess.cookie }), { label: "catalog" });
        gated402 = c.status === 402;
        try { gateMsg = JSON.parse(c.body).message || ""; } catch {}
        console.log(`  ·  backend ground truth: GET /marketplace/catalog → HTTP ${c.status}${gateMsg ? ` "${gateMsg}"` : ""}`);
      } catch {}

      let browser;
      try {
        const { chromium } = require(path.join(process.cwd(), "node_modules/playwright"));
        browser = await chromium.launch();
        const ctx  = await browser.newContext({ storageState: AUTH, viewport: { width: 1440, height: 950 } });
        const page = await ctx.newPage();
        const pageErrors = [];
        page.on("pageerror", e => pageErrors.push(String(e)));

        // ── real app shell, with real reload retries ──
        let shell = false;
        for (let a = 0; a < 6 && !shell; a++) {
          if (a) await page.waitForTimeout(3000 * a);
          try { await page.goto(FRONT, { waitUntil: "domcontentloaded", timeout: 90000 }); } catch { continue; }
          for (let i = 0; i < 60; i++) {
            if (await page.locator("button.tab--more").count()) { shell = true; break; }
            await page.waitForTimeout(1000);
          }
        }
        if (!shell) throw new Error("app shell never rendered after real reload attempts");

        const dismiss = async () => {
          for (let r = 0; r < 8; r++) {
            let acted = false;
            const s = page.locator(".cfr-card button, .op-frs-card button", { hasText: /^(Skip for now|Skip|Done|Finish|Got it)$/i });
            if (await s.count()) { try { await s.first().click({ timeout: 4000 }); acted = true; } catch {} }
            if (!acted) break;
            await page.waitForTimeout(600);
          }
        };
        await dismiss();

        const goTab = async (label, wait = 4000) => {
          await dismiss();
          const top = page.locator("button.tab").filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) });
          if (await top.count()) await top.first().click({ timeout: 15000 });
          else {
            await page.locator("button.tab--more").first().click({ timeout: 20000 });
            await page.waitForTimeout(400);
            await page.locator("input.tab-more-search").first().fill(label);
            await page.waitForTimeout(700);
            const idx = await page.evaluate(l => [...document.querySelectorAll("button.tab-more-item")]
              .findIndex(r => (r.querySelector(".tab-more-item-label")?.textContent || "").trim() === l), label);
            if (idx < 0) { await page.keyboard.press("Escape"); throw new Error(`no more-menu match for ${label}`); }
            await page.locator("button.tab-more-item").nth(idx).click({ timeout: 15000 });
          }
          await page.waitForTimeout(wait);
          await dismiss();
        };
        // Wait for the pane to genuinely finish mounting. A fixed delay measured
        // several lazy tabs at 0 chars and would have manufactured findings.
        const settle = async (maxMs = 30000) => {
          const t0 = Date.now(); let last = -1, stable = 0;
          while (Date.now() - t0 < maxMs) {
            const s = await page.evaluate(() => {
              const p = document.querySelector(".app-main, main") || document.body;
              const t = (p.innerText || "").trim();
              return { n: t.length, loading: /^Loading[^\n]{0,40}…?$/i.test(t) };
            });
            if (s.n === last && s.n > 0 && !s.loading) { if (++stable >= 2) return true; } else stable = 0;
            last = s.n;
            await page.waitForTimeout(1000);
          }
          return false;
        };
        const paneText = () => page.evaluate(() => {
          const p = document.querySelector(".app-main, main") || document.body;
          return (p.innerText || "").trim();
        });
        // FIX-INDEPENDENT render signal: did this destination mount at all?
        // Skips are gated on THIS, never on the assertion under test.
        const mounted = async () => (await paneText()).length > 0;

        // ── LIVE F1 — Marketplace discloses the real 402 ──
        section("F1 LIVE — Marketplace discloses the real gate instead of rendering 0");
        try {
          await goTab("Marketplace", 4000);
          await settle();
          if (!await mounted()) {
            todo("LIVE Marketplace gated disclosure", "Marketplace pane never mounted this run");
          } else if (!gated402) {
            todo("LIVE Marketplace gated disclosure",
                 "this account is NOT plan-gated in this run — the 402 path cannot be exercised");
          } else {
            // The gated pane resolves after two real round-trips, so poll for the
            // rendered outcome with real backoff rather than trusting one snapshot.
            let t = await paneText();
            for (let i = 0; i < 6 && !/plan/i.test(t); i++) {
              await page.waitForTimeout(1500 * (i + 1));
              t = await paneText();
            }
            assert.ok(!/No plugins in this category yet\./.test(t),
              "a gated catalog must NOT claim 'No plugins in this category yet.' — that is false");
            ok("LIVE the false 'No plugins in this category yet.' claim is gone");

            assert.ok(/Starter plan or higher|requires the .* plan/i.test(t),
              `the backend's real feature_gated message must be shown to the user; pane read: ${JSON.stringify(t.slice(0, 300))}`);
            ok("LIVE the backend's real gating message is displayed verbatim");

            const total = await page.evaluate(() => {
              const el = [...document.querySelectorAll(".mc-summary-tile")]
                .find(e => /TOTAL PLUGINS/i.test(e.innerText || ""));
              return el ? (el.querySelector(".mc-sv")?.textContent || "").trim() : null;
            });
            assert.strictEqual(total, "—",
              `TOTAL PLUGINS must render the unknown placeholder '—', measured "${total}"`);
            ok("LIVE TOTAL PLUGINS renders '—' (unknown), not a fabricated 0");
          }
        } catch (e) {
          if (/Timeout|retry exhausted|never mounted|no more-menu match/.test(e.message))
            todo("LIVE Marketplace gated disclosure", `env: ${e.message}`);
          else ko("LIVE Marketplace gated disclosure", e.message);
        }

        // ── LIVE F2 — AI Costs no longer crashes ──
        section("F2 LIVE — the AI Costs tab renders instead of crashing");
        try {
          pageErrors.length = 0;
          await goTab("AI Costs", 4000);
          await settle();
          if (!await mounted()) {
            todo("LIVE AI Costs renders", "AI Costs pane never mounted this run");
          } else {
            const t = await paneText();
            assert.ok(!/hostedProviders is not defined/.test(t),
              "the ReferenceError must no longer reach the user");
            assert.ok(!/Something went wrong[\s\S]{0,80}aicost panel encountered an error/.test(t),
              "the ErrorBoundary fallback must no longer replace the AI Costs tab");
            ok("LIVE AI Costs no longer shows the ErrorBoundary crash fallback");

            // it must render the REAL comparison card the crash was hiding
            const hosted = await page.evaluate(() => {
              const col = document.querySelector(".acc-compare-col--hosted");
              return col ? [...col.querySelectorAll(".acc-compare-list li")].map(l => l.textContent.trim()) : null;
            });
            assert.ok(hosted && hosted.length > 0,
              `the Hosted column must list real hosted providers, got ${JSON.stringify(hosted)}`);
            ok(`LIVE the Hosted provider column renders real entries: ${hosted.join(", ")}`);

            assert.ok(!pageErrors.some(e => /hostedProviders/.test(e)),
              `no hostedProviders ReferenceError may be thrown; saw: ${pageErrors.join(" | ")}`);
            ok("LIVE no hostedProviders ReferenceError is thrown during render");
          }
        } catch (e) {
          if (/Timeout|retry exhausted|never mounted|no more-menu match/.test(e.message))
            todo("LIVE AI Costs renders", `env: ${e.message}`);
          else ko("LIVE AI Costs renders", e.message);
        }

        // ── LIVE F4 — measured header conformance ──
        section("F4 LIVE — page headers measure at the baseline via getComputedStyle");
        for (const [label, expectSub] of [["Overview", true], ["Beta Checklist", true], ["Legal OS", true]]) {
          try {
            await goTab(label, 4000);
            await settle();
            if (!await mounted()) { todo(`LIVE ${label} header`, `${label} pane never mounted this run`); continue; }
            const m = await page.evaluate(() => {
              const pane = document.querySelector(".app-main, main") || document.body;
              const h = [...pane.querySelectorAll("h1,h2,h3")].find(x => {
                const r = x.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top < 700;
              });
              if (!h) return null;
              const cs = getComputedStyle(h);
              let sub = h.parentElement && h.parentElement.querySelector("p");
              const ss = sub ? getComputedStyle(sub) : null;
              return { fs: cs.fontSize, fw: cs.fontWeight, ls: cs.letterSpacing, text: h.innerText.trim(),
                       subFs: ss && ss.fontSize };
            });
            assert.ok(m, `${label} must render a real heading element`);
            assert.strictEqual(m.fs, "22px", `${label} title font-size measured ${m.fs}, baseline is 22px`);
            assert.strictEqual(m.fw, "800",  `${label} title font-weight measured ${m.fw}, baseline is 800`);
            assert.strictEqual(m.ls, "-0.3px", `${label} title letter-spacing measured ${m.ls}, baseline is -0.3px`);
            ok(`LIVE ${label} title measures 22px / 800 / -0.3px ("${m.text}")`);
            if (expectSub) {
              assert.strictEqual(m.subFs, "13.5px", `${label} subtitle measured ${m.subFs}, baseline is 13.5px`);
              ok(`LIVE ${label} subtitle measures 13.5px`);
            }
          } catch (e) {
            if (/Timeout|retry exhausted|never mounted|no more-menu match/.test(e.message))
              todo(`LIVE ${label} header`, `env: ${e.message}`);
            else ko(`LIVE ${label} header`, e.message);
          }
        }

        // ── LIVE F5 — ⌘K genuinely resolves the recovered vocabulary ──
        section("F5 LIVE — ⌘K resolves the recovered search vocabulary");
        try {
          await goTab("Dashboard", 2500);
          const search = async (q) => {
            await page.keyboard.press("Escape");
            await page.waitForTimeout(300);
            await page.keyboard.press("Meta+K");
            await page.waitForTimeout(600);
            // Real CommandPalette.jsx selectors: .cp-input / .cp-item-label.
            const input = page.locator("input.cp-input").first();
            await input.fill(q, { timeout: 8000 });
            await page.waitForTimeout(700);
            const labels = await page.evaluate(() =>
              [...document.querySelectorAll(".cp-item .cp-item-label")]
                .map(e => (e.innerText || "").trim().split("\n")[0]).filter(Boolean).slice(0, 6));
            await page.keyboard.press("Escape");
            await page.waitForTimeout(250);
            return labels;
          };
          // fix-independent signal: the palette must open and answer a control
          const control = await search("Dashboard");
          if (!control.length) {
            todo("LIVE ⌘K recovered vocabulary", "the command palette returned nothing even for a known control query");
          } else {
            ok(`LIVE ⌘K opens and answers a control query ("Dashboard" → ${control[0]})`);
            for (const [q, expect] of [["whatsapp", /Integrations/i], ["razorpay", /Integrations/i],
                                       ["churn", /Customer Success/i], ["invite", /Team/i],
                                       ["docker", /DevOps/i], ["logs", /History|Runtime Observer/i]]) {
              const res = await search(q);
              assert.ok(res.some(r => expect.test(r)),
                `⌘K "${q}" must resolve to ${expect} — got ${JSON.stringify(res)}`);
              ok(`LIVE ⌘K "${q}" → ${res.find(r => expect.test(r))}`);
            }
            // NEGATIVE control: a nonsense query must still return nothing, so the
            // added keywords did not make the palette match everything.
            const junk = await search("zzzqqxnotathing");
            assert.strictEqual(junk.length, 0,
              `a nonsense query must return no results, got ${JSON.stringify(junk)}`);
            ok("LIVE negative control: a nonsense query still returns no results");
          }
        } catch (e) {
          if (/Timeout|retry exhausted|no more-menu match/.test(e.message))
            todo("LIVE ⌘K recovered vocabulary", `env: ${e.message}`);
          else ko("LIVE ⌘K recovered vocabulary", e.message);
        }

        // ── LIVE F3 — the destructive confirm genuinely appears and can abort ──
        section("F3 LIVE — a destructive action opens the shared, accessible ConfirmDialog");
        // The two sites this phase newly gated (session revoke, device removal)
        // need real rows to click, and this account's /security/sessions and
        // /security/devices are genuinely empty. So the LIVE contract is proved
        // on Organization's "Archive organization" — the SAME shared useConfirm/
        // ConfirmDialog component the new gates use — and the empty-data sites are
        // skipped honestly against fix-independent backend ground truth.
        try {
          await goTab("Organization", 5000);
          await settle();
          if (!await mounted()) {
            todo("LIVE destructive confirm", "Organization pane never mounted this run");
          } else {
            // The Overview panel resolves its org after a real round-trip, so poll
            // for the control with real backoff rather than one snapshot.
            const archive = page.locator("button", { hasText: /^Archive organization$/ }).first();
            let archiveCount = await archive.count();
            for (let i = 0; i < 5 && archiveCount === 0; i++) {
              await page.waitForTimeout(2000 * (i + 1));
              archiveCount = await archive.count();
            }
            if (archiveCount === 0) {
              todo("LIVE destructive confirm", "no 'Archive organization' control rendered after real retries");
            } else {
              await archive.click({ timeout: 10000 });
              await page.waitForTimeout(1000);
              const dlg = await page.evaluate(() => {
                const d = document.querySelector("[role='dialog']");
                if (!d) return null;
                return { role: d.getAttribute("role"), modal: d.getAttribute("aria-modal"),
                         text: (d.innerText || "").trim().slice(0, 200),
                         focusInside: d.contains(document.activeElement),
                         focusText: (document.activeElement?.textContent || "").trim() };
              });
              assert.ok(dlg, "a destructive action must open the shared ConfirmDialog, not act silently");
              ok(`LIVE the destructive action opens the shared ConfirmDialog ("${dlg.text.split("\n")[0]}")`);
              assert.strictEqual(dlg.role, "dialog", "the confirm must expose role=dialog");
              assert.strictEqual(dlg.modal, "true", "the confirm must expose aria-modal=true");
              ok("LIVE the shared confirm has role=dialog and aria-modal=true");
              assert.ok(dlg.focusInside,
                `focus must move into the dialog on open; active element was "${dlg.focusText}"`);
              ok(`LIVE focus moves into the dialog on open (on "${dlg.focusText}")`);

              // ESC must cancel, and the destructive action must NOT have happened
              await page.keyboard.press("Escape");
              await page.waitForTimeout(800);
              assert.strictEqual(await page.locator("[role='dialog']").count(), 0,
                "Escape must close the confirm dialog");
              ok("LIVE Escape closes the shared confirm dialog");
              const survived = await page.locator("button", { hasText: /^Archive organization$/ }).count();
              assert.strictEqual(survived, 1,
                "cancelling must NOT have archived the organization — the control must survive");
              ok("LIVE cancelling genuinely did not perform the destructive action");
            }
          }
        } catch (e) {
          if (/Timeout|retry exhausted|never mounted|no more-menu match/.test(e.message))
            todo("LIVE destructive confirm", `env: ${e.message}`);
          else ko("LIVE destructive confirm", e.message);
        }

        section("F3 LIVE — the newly-gated session/device sites (real data preconditions)");
        try {
          // FIX-INDEPENDENT ground truth: can these sites be exercised at all?
          let nSess = null, nDev = null;
          try {
            const s = await retry(() => req(`${BACK}/security/sessions`, { cookie: sess.cookie }), { tries: 3, label: "sessions" });
            nSess = (JSON.parse(s.body).sessions || []).length;
            const d = await retry(() => req(`${BACK}/security/devices`, { cookie: sess.cookie }), { tries: 3, label: "devices" });
            nDev = (JSON.parse(d.body).devices || []).length;
          } catch {}
          if (nSess === 0 && nDev === 0) {
            todo("LIVE session/device confirm gates",
                 `backend genuinely holds 0 sessions and 0 devices for this account, so no revoke/remove row can render — a real data precondition, NOT a fix failure (the same shared dialog is proved live above)`);
          } else if (nSess === null) {
            todo("LIVE session/device confirm gates", "could not read /security/sessions ground truth after real retries");
          } else {
            await goTab("Settings", 6000);
            await settle();
            // rail items render as "▷\nSessions" (icon + label), so match the label line
            const opened = await page.evaluate(() => {
              const el = [...document.querySelectorAll("button, li, a, div")]
                .find(e => (e.innerText || "").trim().split("\n").pop() === "Sessions");
              if (el) { el.click(); return true; }
              return false;
            });
            await page.waitForTimeout(2500);
            const n = await page.locator("button.k2-revoke-btn").count();
            if (!opened || n === 0) {
              todo("LIVE session/device confirm gates",
                   `rail item reachable=${opened}, revoke rows rendered=${n} against backend count ${nSess}`);
            } else {
              await page.locator("button.k2-revoke-btn").first().click({ timeout: 10000 });
              await page.waitForTimeout(900);
              assert.ok(await page.locator("[role='dialog']").count(),
                "revoking a session must open the ConfirmDialog, not delete silently");
              ok("LIVE session revoke opens the ConfirmDialog");
              await page.keyboard.press("Escape");
              await page.waitForTimeout(700);
              assert.strictEqual(await page.locator("button.k2-revoke-btn").count(), n,
                "cancelling must NOT have revoked the session");
              ok("LIVE cancelling a session revoke genuinely leaves the session intact");
            }
          }
        } catch (e) {
          if (/Timeout|retry exhausted|never mounted|no more-menu match/.test(e.message))
            todo("LIVE session/device confirm gates", `env: ${e.message}`);
          else ko("LIVE session/device confirm gates", e.message);
        }

        await browser.close();
      } catch (e) {
        try { if (browser) await browser.close(); } catch {}
        todo("LIVE browser assertions", `could not drive a real browser: ${e.message}`);
      }
    }
  }

  // ── summary ───────────────────────────────────────────────────────────
  console.log(`\n${"=".repeat(72)}`);
  console.log(`PASS ${pass}   FAIL ${fail}   SKIP ${skip}`);
  if (skip) {
    console.log(`\nSKIPPED (genuine environmental blocks — NOT counted as passes):`);
    skips.forEach(s => console.log(`  ⊘ ${s.msg} — ${s.why}`));
  }
  if (fail) {
    console.log(`\nFAILURES:`);
    failures.forEach(f => console.log(`  ✗ ${f.msg} — ${f.reason}`));
    process.exit(1);
  }
  console.log(`\nPhase A.11.8 cross-product UX consistency checks passed.`);
}

main().catch(e => { console.error("\nFATAL", e); process.exit(1); });
