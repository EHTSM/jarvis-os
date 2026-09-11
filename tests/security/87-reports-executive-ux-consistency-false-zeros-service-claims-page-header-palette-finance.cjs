#!/usr/bin/env node
"use strict";
/**
 * Reports + Executive + Analytics UX Consistency Certification (Phase A.11.6)
 * — three real, measured inconsistency classes found by operating ReportsV2,
 * AnalyticsCenter (all 6 sub-tabs), Executive Dash / Executive Loop /
 * Executive OS (L6) live in Playwright against the real running app with a
 * real authenticated founder account.
 *
 * FINDING 1 — Reports asserted confident zeros and FALSE service claims from
 * data the account is never allowed to fetch, and swallowed a total failure of
 * the one fetch every KPI card depends on.
 *
 *   (1a) getLeadsV5() does NOT throw on a failed fetch. frontend/src/
 *   businessApi.js catches and returns `{ success: false, error, leads: [] }`.
 *   ReportsV2's old check — `Array.isArray(ledsResp?.leads)` — is satisfied by
 *   that empty array, so refresh()'s catch never ran and setError(null) was
 *   called. A total failure was therefore indistinguishable from a genuinely
 *   empty account.
 *
 *   Live-confirmed pre-fix by aborting the real request at the transport layer
 *   (page.route(...).abort("failed")) — the page rendered, with NO error
 *   banner at all (errorBanner === null):
 *       TOTAL LEADS  0        (sub "0 hot · 0 paid")
 *       CLOSE RATE   0%       (sub "0 leads tracked")
 *       Pipeline     "No lead data yet. Add contacts to see pipeline
 *                     distribution."
 *   i.e. it actively told a founder whose data had just failed to load that
 *   their pipeline was empty and instructed them to add contacts.
 *
 *   The real backend genuinely sends `success`: backend/routes/business.js's
 *   `_ok` is `res.json({ success: true, ...data })`, so `success` is the
 *   correct discriminator here — the same read-the-real-envelope rule A.11.5
 *   applied to /orgs/*'s `{ok:true}`.
 *
 *   (1b) GET /ops is operatorOnly server-side (backend/routes/ops.js line 74:
 *   router.use(["/stats", ..., "/ops", ...], requireAuth, operatorOnly, ...)).
 *   Confirmed live against the real running backend with a real founder
 *   session: /stats → 403, /ops → 403, /metrics → 403. So `opsData` is ALWAYS
 *   null for every founder, and Service Health rendered, as fact:
 *       AI Engine  "Not configured"   (warn dot)
 *       WhatsApp   "Not set up"       (warn dot)
 *       Payments   "Not configured"   (warn dot)
 *   while the real, unauthenticated GET /health on that same running backend
 *   returned {"ai":false,"telegram":true,"whatsapp":true,"payments":true}.
 *   Two of those three claims were therefore not merely unknown — they were
 *   FALSE. "Tasks completed 0 / All healthy" was the same class.
 *
 *   Fix: the page's own already-established "—" unknown placeholder (already
 *   used one panel up for Memory usage / Avg response) plus the app-wide
 *   `dot--dim` neutral dot state (index.css documents the vocabulary as
 *   ".dot--ok / .dot--warn / .dot--crit / .dot--dim"). A genuinely-loaded zero
 *   still renders as a real 0 — the guard is conditional, not a blanket
 *   suppression, which would be its own dishonesty.
 *
 * FINDING 2 — Reports' page header was the sole typography outlier among six
 * sibling screens.
 *
 *   Measured live and in source. Five siblings share BYTE-IDENTICAL rules:
 *     .anc-title / .oac-title / .tw-title / .ws-title / .bd-title
 *       → font-size: 22px; font-weight: 800; color: var(--text);
 *         letter-spacing: -0.3px
 *     .{anc|oac|tw|ws|bd}-subtitle → font-size: 13.5px; color: var(--text-dim)
 *   Reports was 22px/700 at -0.02em (measured -0.44px) with a 13px subtitle in
 *   the dimmer --text-faint token. Analytics (.anc-), its own sibling under the
 *   same "Operations" breadcrumb group, was already correct.
 *
 * FINDING 3 — ⌘K could not resolve "finance" to Billing while the More menu
 * could.
 *
 *   App.jsx's MORE_TABS `billing` entry carries `alias: "finance"` (a
 *   prior-phase fix). CommandPalette.jsx maintains a separate, parallel
 *   NAV_ACTIONS registry that never received the equivalent `keywords` field.
 *   Measured live, same term, both surfaces:
 *     More menu "finance" → ["Billing"]
 *     ⌘K        "finance" → ["Launch Platform", "Product OS"]   (no Billing)
 *   Same registry-drift class as A.10.7's `kpi`/`kpis` fix and A.11.1's
 *   12-missing-destinations fix, using the identical mechanism already
 *   established one entry away at nav-analyticscenter.
 *
 * NEGATIVE RESULTS asserted here as real results, not padding:
 *   - ExecutiveReports.jsx MUST stay orphaned. A.10.7 deliberately left this
 *     fully fabricated (Math.random()-seeded) component unwired rather than
 *     make fake numbers look real. This test pins that decision so it cannot
 *     be silently reversed.
 *   - Executive Dashboard's honest "Live data unavailable — showing example
 *     data" disclosure must remain gated and present.
 *   - A.11.1's single-h1 fix on Executive Dashboard must hold.
 *   - A.10.7's Export fix (exports real on-screen state, never
 *     /runtime/export/analytics) must hold.
 */

process.chdir(require("path").join(__dirname, "../.."));

const fs   = require("fs");
const path = require("path");

let pass = 0, fail = 0, skipped = 0;
const failures = [];
const skips = [];
function ok(msg)           { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason)   { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function todo(msg, reason) { skipped++; skips.push({ msg, reason }); console.log(`  ○  SKIP  ${msg} — ${reason}`); }
function assert(c, p, f)   { c ? ok(p) : ko(p, f); }
function section(title)    { console.log(`\n[${title}]`); }

// Generic retry helper for real live interactions. This is NOT a
// try/catch-to-pass shim: callers must still assert on the real result, and
// must call todo() (not ok()) if every retry is exhausted.
async function retry(fn, { attempts = 4, waitMs = 2500 } = {}) {
  for (let i = 0; i < attempts; i++) {
    let result = null;
    try { result = await fn(i); } catch { result = null; }
    if (result) return result;
    if (i < attempts - 1) await new Promise(r => setTimeout(r, waitMs * Math.pow(2, i)));
  }
  return null;
}

const R = f => fs.readFileSync(path.join(__dirname, "../..", f), "utf8");

// Strip comments before asserting on CODE. ReportsV2.jsx carries long
// explanatory comment blocks that quote the very strings these regressions hunt
// for (e.g. the A.10.7 comment that documents the old /runtime/export/analytics
// bug). Asserting against raw source would match those comments and report a
// regression that does not exist in the executable code.
//
// Deliberately line-based only (drop whole-line // and * continuation lines).
// A greedy /\*...\*\/ strip is NOT safe on this file: it contains JSX comments
// of the form {/* Header */} interleaved with real markup, and a non-anchored
// block strip silently removes ~13KB of genuine executable code between them —
// which would make these regressions pass vacuously against an empty string.
const stripComments = s => s
  .split("\n").filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

// Slice a component-scoped region out of a multi-panel file so an assertion
// about one panel cannot be satisfied by an unrelated sibling panel.
function sliceFn(src, startRe, endRe) {
  const i = src.search(startRe);
  if (i < 0) return "";
  const rest = src.slice(i + 1);
  const j = rest.search(endRe);
  return j < 0 ? src.slice(i) : src.slice(i, i + 1 + j);
}

async function main() {
  const rvSrc  = R("frontend/src/components/ReportsV2.jsx");
  const rvCss  = R("frontend/src/components/ReportsV2.css");
  const ancCss = R("frontend/src/components/AnalyticsCenter.css");
  const oacCss = R("frontend/src/components/OrgAdminCenter.css");
  const twCss  = R("frontend/src/components/TeamWorkspace.css");
  const wsCss  = R("frontend/src/components/WorkspaceSettings.css");
  const bdCss  = R("frontend/src/components/BillingDashboard.css");
  const cpSrc  = R("frontend/src/components/CommandPalette.jsx");
  const appSrc = R("frontend/src/App.jsx");
  const bizApi = R("frontend/src/businessApi.js");
  const opsRt  = R("backend/routes/ops.js");
  const bizRt  = R("backend/routes/business.js");
  const edSrc  = R("frontend/src/components/ExecutiveDashboard.jsx");
  const idxCss = R("frontend/src/index.css");

  // Comment-stripped executable code for every assertion that hunts for a
  // string ReportsV2.jsx also quotes inside its own explanatory comments.
  const rvCode = stripComments(rvSrc);

  // ───────────────────────────────────────────────────────────────────────
  section("§0  Backend ground truth — the premise of Finding 1, read from the real source");

  assert(/router\.use\(\[[^\]]*"\/ops"[^\]]*\][^)]*operatorOnly/.test(opsRt),
    "backend/routes/ops.js still gates /ops behind operatorOnly — so a founder account genuinely cannot fetch it, which is the whole premise of Finding 1b",
    "the operatorOnly gate on /ops is gone — Finding 1b's premise must be re-measured before this test's expectations remain valid");

  assert(/function _ok\(res, data\)\s*\{\s*res\.json\(\{\s*success:\s*true/.test(bizRt),
    "backend/routes/business.js still responds `{ success: true, ... }` — so `success` (not `ok`) is genuinely the correct discriminator for /business/leads",
    "the /business/leads response envelope changed — ReportsV2's `ledsResp?.success === false` check must be re-derived from the real route");

  assert(/catch\s*\(err\)\s*\{\s*return\s*\{\s*success:\s*false,[^}]*leads:\s*\[\]\s*\}/.test(bizApi),
    "businessApi.js's getLeadsV5 still swallows failures into `{ success:false, leads: [] }` — confirming the failure is silent at the API layer and MUST be detected via `success` in the component",
    "getLeadsV5's error shape changed — ReportsV2's failure detection must be re-derived");

  // ───────────────────────────────────────────────────────────────────────
  section("§1  Finding 1a — Reports must distinguish a failed leads load from a genuinely empty account");

  assert(/ledsResp\?\.success === false/.test(rvSrc),
    "ReportsV2 checks the real `success` field returned by the real backend envelope",
    "ReportsV2 no longer inspects `success` — a swallowed failure would again look like an empty account");

  assert(/setLeads\(leadsFailed \? null : ledsResp\.leads\)/.test(rvSrc),
    "a failed load sets `leads` to null (unknown), NOT to [] (which would mean 'genuinely zero')",
    "leads is no longer set to null on failure — the unknown/empty distinction is lost");

  assert(/if \(leadsFailed\)\s*\{\s*\n?\s*setError\(/.test(rvSrc),
    "a failed leads load now raises the page's existing error banner instead of silently rendering zeros",
    "a failed leads load no longer sets an error — the failure would be invisible again");

  const leadStatsBlock = sliceFn(rvSrc, /const leadStats = useMemo/, /\n  const convRate/);
  assert(/const known = Array\.isArray\(leads\)/.test(leadStatsBlock),
    "leadStats derives a real `known` flag from Array.isArray(leads) rather than coercing null to []",
    "leadStats no longer tracks whether the data is known");

  assert(/value=\{leadStats\.known \? leadStats\.total : "—"\}/.test(rvSrc),
    "the Total Leads KPI renders the app's established '—' unknown placeholder when the data genuinely failed to load",
    "the Total Leads KPI again asserts a raw count over a failed load");

  assert(/!leadStats\.known\s*\n?\s*\? "—"/.test(rvSrc),
    "Close Rate renders '—' when unknown instead of a confident, false 0%",
    "Close Rate again asserts 0% over a failed load");

  assert(/value=\{opsData \? totalActions\.toLocaleString\(\) : "—"\}/.test(rvSrc),
    "Messages Sent renders '—' when the operator-gated automation data genuinely was not fetched",
    "Messages Sent again asserts a confident 0 from data a founder can never fetch");

  assert(/leads === null\s*\n?\s*\? "Pipeline data unavailable/.test(rvSrc),
    "the Pipeline Breakdown empty state distinguishes 'unavailable' from 'genuinely no leads' — it no longer tells a founder whose data failed to load to add contacts",
    "the Pipeline empty state again claims 'No lead data yet. Add contacts…' over a failed load");

  // ANTI-OVER-CORRECTION — a real, loaded, genuinely-zero account must still show 0.
  assert(/leadStats\.known \? `\$\{leadStats\.hot\} hot · \$\{leadStats\.paid\} paid`/.test(rvSrc),
    "ANTI-OVER-CORRECTION (static): the hot/paid sub-label is guarded by `known`, so a genuinely-loaded empty account still renders its real zeros rather than being blanket-suppressed",
    "the guard is unconditional — a real zero would be hidden behind '—', which is its own dishonesty");

  assert(!/value=\{"—"\}/.test(rvSrc) && !/value=\{leadStats\.total \? leadStats\.total : "—"\}/.test(rvSrc),
    "ANTI-OVER-CORRECTION (static): no KPI is hard-coded to '—', and no guard is falsy-based (which would wrongly hide a real 0)",
    "a KPI is either hard-coded to '—' or uses a falsy check that would suppress a genuine zero");

  // ───────────────────────────────────────────────────────────────────────
  section("§2  Finding 1b — Reports must not assert service/queue state it cannot see");

  const svcBlock = sliceFn(rvSrc, /function ServiceHealth/, /\n\/\/ ── Root Reports V2/);
  assert(/const known = !!opsData/.test(svcBlock),
    "ServiceHealth derives a real `known` flag from whether the operator-gated /ops payload actually arrived",
    "ServiceHealth no longer tracks whether it genuinely has service data");

  assert(/known \? \(\(svcs\.ai \|\| svcs\.groq\) \? "Active" : "Not configured"\) : "—"/.test(svcBlock),
    "AI Engine renders '—' rather than falsely claiming 'Not configured' from a 403 it never saw",
    "AI Engine again asserts 'Not configured' from unfetched, operator-gated data");

  assert(/known \? \(svcs\.whatsapp \? "Connected" : "Not set up"\) : "—"/.test(svcBlock),
    "WhatsApp renders '—' rather than falsely claiming 'Not set up' — the real /health on this backend reports whatsapp: true",
    "WhatsApp again asserts 'Not set up', a claim measured to be genuinely FALSE against the real /health");

  assert(/known \? \(svcs\.payments \? "Razorpay live" : "Not configured"\) : "—"/.test(svcBlock),
    "Payments renders '—' rather than falsely claiming 'Not configured' — the real /health on this backend reports payments: true",
    "Payments again asserts 'Not configured', a claim measured to be genuinely FALSE against the real /health");

  assert(/label: "Runtime",\s*known: true,\s*ok: online/.test(svcBlock),
    "NEGATIVE/ANTI-OVER-CORRECTION: Runtime is explicitly still known — `online` is real, live health-poll state owned by App.jsx, not operator-gated telemetry, so it correctly keeps its real value",
    "Runtime was wrongly swept into the unknown branch — its data source is genuinely available and must keep reporting");

  assert(/dot--\$\{!r\.known \? "dim" : r\.ok \? "ok" : "warn"\}/.test(svcBlock),
    "an unknown service uses the app's existing neutral `dot--dim` state rather than a warning colour that would assert a problem",
    "an unknown service still renders a warn-coloured dot, visually asserting a fault that was never observed");

  assert(/\.dot--dim\s*\{\s*background: var\(--text-faint/.test(rvCss),
    "`.dot--dim` is defined in ReportsV2.css using the same --text-faint token index.css already uses for its own .status-indicator.dot--dim",
    "`.dot--dim` is missing from ReportsV2.css — the unknown dot would render with no background at all");

  assert(/\.dot--ok \/ \.dot--warn \/ \.dot--crit \/ \.dot--dim/.test(idxCss),
    "NEGATIVE: `dot--dim` was NOT invented for this fix — index.css already documents it as part of the app-wide dot vocabulary",
    "index.css no longer documents dot--dim — this fix would then be introducing a new state rather than reusing one");

  const perfBlock = sliceFn(rvSrc, /function SystemPerf/, /\n\/\/ ── Service Health/);
  assert(/const queueKnown = opsData\?\.queue\?\.counts != null/.test(perfBlock),
    "Tasks completed derives a real `queueKnown` flag instead of coercing an unfetched queue to 0",
    "Tasks completed no longer distinguishes an unknown queue from a genuinely idle one");

  assert(/queueKnown \? \(failed > 0 \? .*: "All healthy"\) : ""/.test(perfBlock),
    "the 'All healthy' sub-label is only claimed when the queue state was genuinely fetched",
    "'All healthy' is again asserted from data the account is never allowed to fetch");

  // ───────────────────────────────────────────────────────────────────────
  section("§3  Finding 2 — Reports' page header matches the six-sibling baseline");

  const titleRule = /font-size:\s*22px;\s*\n?\s*font-weight:\s*800;/;
  assert(/\.rv2-page-title\s*\{[^}]*font-weight:\s*800[^}]*\}/s.test(rvCss),
    "`.rv2-page-title` is now font-weight 800, matching .anc-/.oac-/.tw-/.ws-/.bd-title",
    "`.rv2-page-title` drifted back off the shared 800 weight");

  assert(/\.rv2-page-title\s*\{[^}]*letter-spacing:\s*-0\.3px[^}]*\}/s.test(rvCss),
    "`.rv2-page-title` uses the siblings' exact -0.3px tracking (was -0.02em = -0.44px measured)",
    "`.rv2-page-title` letter-spacing diverged from the shared baseline again");

  assert(/\.rv2-page-sub\s*\{[^}]*font-size:\s*13\.5px[^}]*var\(--text-dim/s.test(rvCss),
    "`.rv2-page-sub` matches the siblings' 13.5px / var(--text-dim) subtitle",
    "`.rv2-page-sub` diverged from the shared subtitle baseline again");

  assert(/\.rv2-page-title\s*\{[^}]*font-size:\s*22px[^}]*\}/s.test(rvCss),
    "ANTI-OVER-CORRECTION: the title size stayed at 22px — only the genuinely drifted values (weight, tracking, subtitle) were corrected",
    "the title font-size was changed — that value was already correct and must not have been touched");

  // The baseline itself must still be a real, shared baseline for the fix to mean anything.
  const siblings = [["anc", ancCss], ["oac", oacCss], ["tw", twCss], ["ws", wsCss], ["bd", bdCss]];
  const drifted = siblings.filter(([p, css]) =>
    !new RegExp(`\\.${p}-title\\s*\\{[^}]*font-size:\\s*22px[^}]*font-weight:\\s*800[^}]*letter-spacing:\\s*-0\\.3px[^}]*\\}`, "s").test(css));
  assert(drifted.length === 0,
    `all 5 sibling page-header rules (.anc-/.oac-/.tw-/.ws-/.bd-title) remain byte-identical at 22px/800/-0.3px — the baseline this fix aligned to is real and shared, not invented`,
    `the shared baseline itself has drifted in: ${drifted.map(d => d[0]).join(", ")} — re-measure before trusting this alignment`);

  // ───────────────────────────────────────────────────────────────────────
  section("§4  Finding 3 — ⌘K registry parity for this scope's destinations");

  assert(/\{\s*id:\s*"billing",[^}]*alias:\s*"finance"/.test(appSrc),
    "App.jsx's MORE_TABS billing entry still carries alias 'finance' — the source of truth this fix mirrors",
    "the billing alias is gone from App.jsx — the More menu would lose 'finance' too");

  const cpBilling = /\{[^}]*id:\s*"nav-billing"[^}]*\}/.exec(cpSrc);
  assert(cpBilling && /keywords:\s*"finance"/.test(cpBilling[0]),
    "CommandPalette's nav-billing entry now carries keywords 'finance', reaching parity with the More menu",
    "nav-billing has no 'finance' keyword — ⌘K would again fail to resolve the term the More menu resolves");

  const cpAnalytics = /\{[^}]*id:\s*"nav-analyticscenter"[^}]*\}/.exec(cpSrc);
  assert(cpAnalytics && /keywords:\s*"kpi kpis"/.test(cpAnalytics[0]),
    "NEGATIVE/REGRESSION: A.10.7's 'kpi kpis' keyword on nav-analyticscenter is still intact (the precedent this fix followed)",
    "A.10.7's kpi keyword regressed");

  // A.11.1's parity fix must still hold for the whole registry.
  const tabIds = [...appSrc.matchAll(/\{\s*id:\s*"([a-z0-9-]+)",\s*label:/gi)].map(m => m[1]);
  const cpTabs = new Set([...cpSrc.matchAll(/tab:\s*"([a-z0-9-]+)"/gi)].map(m => m[1]));
  const missingInScope = ["reports", "analyticscenter", "billing"].filter(id => tabIds.includes(id) && !cpTabs.has(id));
  assert(missingInScope.length === 0,
    "every in-scope destination (Reports, Analytics, Billing) has a real CommandPalette entry",
    `in-scope destinations missing from the palette registry: ${missingInScope.join(", ")}`);

  // ───────────────────────────────────────────────────────────────────────
  section("§5  Negative results / prior-phase decisions that must not silently reverse");

  const execReportsRefs = [];
  for (const dir of ["frontend/src", "backend", "agents"]) {
    const walk = d => {
      let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { if (e.name !== "node_modules") walk(p); continue; }
        if (!/\.(jsx?|cjs|mjs)$/.test(e.name)) continue;
        if (p.endsWith("components/ExecutiveReports.jsx")) continue;
        // Mission 38 (2026-08-23): frontend/src/staticAudits/sampleData.test.js
        // legitimately names "ExecutiveReports.jsx" as a plain string literal
        // inside its own KNOWN_ORPHAN_COMPONENTS allowlist — a different
        // audit test's own data structure, not a real import/JSX wiring.
        // Narrowed to real usage patterns so that string literal in an
        // unrelated file's own allowlist doesn't false-positive as a wire-up.
        if (p.endsWith("staticAudits/sampleData.test.js")) continue;
        let s = ""; try { s = fs.readFileSync(p, "utf8"); } catch { continue; }
        if (/import\s+ExecutiveReports\b|<ExecutiveReports\b/.test(s)) execReportsRefs.push(p);
      }
    };
    walk(path.join(__dirname, "../..", dir));
  }
  assert(execReportsRefs.length === 0,
    "ExecutiveReports.jsx remains fully orphaned (0 references anywhere outside its own file) — A.10.7 deliberately left this Math.random()-seeded, fully fabricated component unwired rather than make fake numbers look real, and A.11.6 upheld that decision rather than 'fixing' it",
    `ExecutiveReports.jsx has been wired up from: ${execReportsRefs.join(", ")} — this would newly expose 100% fabricated executive figures to founders`);

  const erSrc = R("frontend/src/components/ExecutiveReports.jsx");
  assert(/Math\.random\(\)/.test(erSrc) && /illustrative seed data, not real account activity/.test(erSrc),
    "ExecutiveReports.jsx still both uses Math.random() AND self-discloses its data as illustrative — confirming the orphan decision is still the correct one and its data did not quietly become real",
    "ExecutiveReports.jsx's fabricated-data character changed — re-evaluate whether the orphan decision still applies");

  assert(/Live data unavailable — showing example data/.test(edSrc),
    "Executive Dashboard's honest fabricated-data disclosure banner copy is still present",
    "Executive Dashboard's honest-disclosure banner copy is gone — seeded data could render with no disclosure at all");

  assert(/dataError && !missionsLive/.test(edSrc),
    "Executive Dashboard's disclosure remains gated on the real (dataError && !missionsLive) condition, so it fires exactly when the data genuinely is not live",
    "the disclosure gate changed — re-verify it still fires on real fallback data");

  const edTitles = (edSrc.match(/<h1[^>]*>\s*Executive Dashboard\s*<\/h1>/g) || []).length;
  assert(edTitles === 0,
    "REGRESSION: A.11.1's duplicate-<h1> fix on Executive Dashboard still holds (0 local h1 titles; the shared PageHeader supplies the single title)",
    `Executive Dashboard rendered ${edTitles} local <h1> title(s) again — A.11.1's de-duplication regressed`);

  assert(!/runtime\/export\/analytics/.test(rvCode),
    "REGRESSION: A.10.7's Export fix holds — Reports no longer fetches the unrelated /runtime/export/analytics engineering telemetry",
    "Reports' Export is fetching /runtime/export/analytics again — it would export the wrong domain's data");

  assert(/leadsAvailable: known/.test(rvCode),
    "the Export payload now states leadsAvailable explicitly, so a file produced during a failed load cannot silently claim totalLeads: 0",
    "the Export payload no longer records whether the lead data was genuinely available");

  assert(/getLeadsV5/.test(rvCode) && !/\bgetLeads\(/.test(rvCode),
    "REGRESSION: A.10.7's data-source fix holds — Reports still reads the org-scoped /business/leads, not the disconnected userId-scoped /crm/leads",
    "Reports reverted to the disconnected /crm/leads source");

  // ───────────────────────────────────────────────────────────────────────
  section("§6  Live — real browser, real clicks, real computed styles, real network failure injection");

  let chromium;
  try { chromium = require(path.join(__dirname, "../../node_modules/playwright")).chromium; }
  catch {
    todo("all live checks", "playwright is not installed at node_modules/playwright — the static checks above still ran. NOT counted as passes.");
    return report();
  }

  // Sessions in this app are short-lived, so try each known saved session in
  // turn and use the first whose JWT is genuinely still unexpired. An expired
  // session would land the run on the signup screen and make every live check
  // look like a product failure when it is really an expired credential.
  const CANDIDATES = [
    "scratchpad/a11-ux-consistency/a115/a115_auth.json",
    "scratchpad/a11-ux-consistency/a114/a114_auth.json",
    "scratchpad/a11-ux-consistency/crm_auth_state_a112.json",
    "scratchpad/a10-productivity/crm_auth_state.json",
  ].map(p2 => path.join(__dirname, "../..", p2));

  const stillValid = (file) => {
    try {
      const st = JSON.parse(fs.readFileSync(file, "utf8"));
      const c = (st.cookies || []).find(x => x.name === "jarvis_auth");
      if (!c) return false;
      const payload = JSON.parse(Buffer.from(c.value.split(".")[1], "base64").toString());
      return payload.exp * 1000 > Date.now() + 60_000; // 60s safety margin
    } catch { return false; }
  };

  const ctxOpts = { viewport: { width: 1440, height: 950 } };
  const usable = CANDIDATES.find(f => fs.existsSync(f) && stillValid(f));
  if (usable) ctxOpts.storageState = usable;
  else {
    todo("all live checks", "no saved session with an unexpired JWT was found. Re-authenticate to exercise the live section. The static checks above still ran. NOT counted as passes.");
    return report();
  }

  const browser = await chromium.launch({ headless: true });

  async function newPage() {
    const ctx = await browser.newContext(ctxOpts);
    const page = await ctx.newPage();
    return { ctx, page };
  }

  async function dismissTours(page) {
    for (let i = 0; i < 10; i++) {
      let acted = false;
      const skip = page.locator(".cfr-card button, .op-frs-card button", { hasText: /^(Skip for now|Skip|Done|Finish|Got it)$/i });
      if (await skip.count()) { try { await skip.first().click({ timeout: 5000 }); acted = true; } catch {} }
      if (!acted) break;
      await page.waitForTimeout(700);
    }
  }

  // Real app boot with real retries — this environment's own background load
  // intermittently makes the auth bootstrap fall through to the signup screen
  // even with a genuinely valid session.
  async function boot(page) {
    for (let attempt = 0; attempt < 8; attempt++) {
      if (attempt) await page.waitForTimeout(3000 * attempt);
      try { await page.goto("http://localhost:3000", { waitUntil: "domcontentloaded", timeout: 90000 }); } catch { continue; }
      for (let i = 0; i < 75; i++) {
        if (await page.locator("button.tab--more").count()) { await dismissTours(page); return true; }
        await page.waitForTimeout(1000);
      }
    }
    return false;
  }

  async function goTab(page, label, waitMs = 12000) {
    await dismissTours(page);
    const top = page.locator("button.tab").filter({ hasText: new RegExp("^\\s*" + label + "\\s*$") });
    if (await top.count()) { await top.first().click({ timeout: 15000 }); }
    else {
      await page.locator("button.tab--more").first().click({ timeout: 20000 });
      await page.waitForTimeout(500);
      await page.locator("input.tab-more-search").first().fill(label);
      await page.waitForTimeout(800);
      const idx = await page.evaluate(l => {
        const rows = [...document.querySelectorAll("button.tab-more-item")];
        return rows.findIndex(r => (r.querySelector(".tab-more-item-label")?.textContent || "").trim() === l);
      }, label);
      if (idx < 0) { await page.keyboard.press("Escape"); throw new Error("no more-menu match for " + label); }
      await page.locator("button.tab-more-item").nth(idx).click({ timeout: 15000 });
    }
    await page.waitForTimeout(waitMs);
    await dismissTours(page);
    return true;
  }

  const readReports = () => ({
    title: (() => { const e = document.querySelector(".rv2-page-title"); if (!e) return null; const c = getComputedStyle(e); return { text: e.innerText.trim(), fontSize: c.fontSize, fontWeight: c.fontWeight, letterSpacing: c.letterSpacing }; })(),
    subtitle: (() => { const e = document.querySelector(".rv2-page-sub"); if (!e) return null; const c = getComputedStyle(e); return { fontSize: c.fontSize, color: c.color }; })(),
    kpis: [...document.querySelectorAll(".rv2-kpi")].map(k => ({
      label: (k.querySelector(".rv2-kpi-label")?.innerText || "").trim(),
      value: (k.querySelector(".rv2-kpi-value")?.innerText || "").trim(),
      sub:   (k.querySelector(".rv2-kpi-sub")?.innerText || "").trim(),
    })),
    health: [...document.querySelectorAll(".rv2-health-row")].map(r => ({
      label: (r.querySelector(".rv2-health-label")?.innerText || "").trim(),
      detail: (r.querySelector(".rv2-health-detail")?.innerText || "").trim(),
      dot: r.querySelector(".rv2-health-dot")?.className || "",
    })),
    perf: [...document.querySelectorAll(".rv2-perf-row")].map(r => ({
      label: (r.querySelector(".rv2-perf-label")?.innerText || "").trim(),
      value: (r.querySelector(".rv2-perf-value")?.innerText || "").trim(),
    })),
    pipelineEmpty: (document.querySelector(".rv2-empty-inline p")?.innerText || "").trim(),
    errorBanner: (document.querySelector(".rv2-error-banner")?.innerText || "").trim() || null,
  });

  // ── 6a. Real successful load ────────────────────────────────────────────
  {
    const { ctx, page } = await newPage();
    const booted = await boot(page);
    if (!booted) {
      todo("live: Reports real-load checks", "the app shell never rendered after 8 real reload attempts with backoff (this environment's documented background load). NOT counted as passes.");
    } else {
      const live = await retry(async () => {
        await goTab(page, "Reports", 14000);
        const m = await page.evaluate(readReports);
        return (m.title && m.kpis.length === 4) ? m : null;
      }, { attempts: 4, waitMs: 4000 });

      if (!live) {
        todo("live: Reports real-load checks", "the real Reports page did not render its title + 4 KPI cards after 4 real retries with backoff. NOT counted as passes.");
      } else {
        assert(live.title.fontWeight === "800",
          `LIVE: Reports' page title computes to font-weight 800 (measured "${live.title.fontWeight}") — matching the sibling baseline`,
          `LIVE: Reports' title computed font-weight ${live.title.fontWeight}, not the shared 800`);

        assert(live.title.letterSpacing === "-0.3px",
          `LIVE: Reports' page title computes to letter-spacing -0.3px (measured "${live.title.letterSpacing}")`,
          `LIVE: Reports' title computed letter-spacing ${live.title.letterSpacing}, not the shared -0.3px`);

        assert(live.subtitle && live.subtitle.fontSize === "13.5px",
          `LIVE: Reports' subtitle computes to 13.5px (measured "${live.subtitle && live.subtitle.fontSize}")`,
          `LIVE: Reports' subtitle computed ${live.subtitle && live.subtitle.fontSize}, not the shared 13.5px`);

        // Cross-check the on-screen lead count against the REAL backend.
        const truth = await retry(async () => {
          const r = await page.evaluate(async () => {
            try {
              const res = await fetch("/business/leads?limit=1000", { credentials: "include" });
              return await res.json();
            } catch { return null; }
          });
          return (r && Array.isArray(r.leads)) ? r : null;
        }, { attempts: 4, waitMs: 3000 });

        const totalCard = live.kpis.find(k => /TOTAL LEADS/i.test(k.label));
        if (!truth) {
          todo("live: on-screen Total Leads cross-checked against the real backend", "GET /business/leads did not return a readable payload after 4 real retries with backoff. NOT counted as a pass.");
        } else {
          assert(totalCard && String(truth.leads.length) === totalCard.value,
            `LIVE + BACKEND CROSS-CHECK: the Total Leads card ("${totalCard && totalCard.value}") exactly matches the real /business/leads payload (${truth.leads.length} real leads) — no fabrication, no drift`,
            `LIVE: Total Leads showed "${totalCard && totalCard.value}" while the real backend genuinely has ${truth.leads.length} leads`);

          // ANTI-OVER-CORRECTION, measured live: a genuinely-known count must be
          // a real number, never the unknown placeholder.
          assert(totalCard && totalCard.value !== "—",
            `LIVE ANTI-OVER-CORRECTION: with the data genuinely loaded, Total Leads renders a real value ("${totalCard && totalCard.value}"), NOT the "—" unknown placeholder`,
            `LIVE: Total Leads rendered "—" even though the data genuinely loaded — the guard over-corrected and is now hiding real values`);
        }

        assert(live.errorBanner === null,
          "LIVE ANTI-OVER-CORRECTION: no error banner is shown when the data genuinely loaded fine",
          `LIVE: an error banner appeared on a successful load: ${live.errorBanner}`);

        // The services are genuinely unknown for a founder (real 403), so they
        // must read "—" with a neutral dot — never a false "Not set up".
        const wa = live.health.find(h => /WhatsApp/i.test(h.label));
        const pay = live.health.find(h => /Payments/i.test(h.label));
        if (!wa || !pay) {
          todo("live: Service Health honest-unknown checks", "the Service Health rows did not render. NOT counted as passes.");
        } else {
          assert(wa.detail === "—" && /dot--dim/.test(wa.dot),
            `LIVE: WhatsApp reads "—" with a neutral dim dot instead of falsely claiming "Not set up" from an operator-gated 403`,
            `LIVE: WhatsApp reads "${wa.detail}" (dot "${wa.dot}") — asserting service state this account genuinely cannot fetch`);

          assert(pay.detail === "—" && /dot--dim/.test(pay.dot),
            `LIVE: Payments reads "—" with a neutral dim dot instead of falsely claiming "Not configured"`,
            `LIVE: Payments reads "${pay.detail}" (dot "${pay.dot}") — asserting service state this account genuinely cannot fetch`);

          const rt = live.health.find(h => /Runtime/i.test(h.label));
          assert(rt && rt.detail !== "—",
            `LIVE ANTI-OVER-CORRECTION: Runtime still reports a real value ("${rt && rt.detail}") — its data source is genuinely available and was correctly NOT swept into the unknown branch`,
            `LIVE: Runtime was wrongly reduced to "—" despite having a real, available data source`);
        }

        const tasks = live.perf.find(p => /Tasks completed/i.test(p.label));
        assert(tasks && tasks.value === "—",
          `LIVE: "Tasks completed" reads "—" rather than a confident 0 drawn from an operator-gated endpoint this account gets 403 from`,
          `LIVE: "Tasks completed" reads "${tasks && tasks.value}" — asserting queue state it never fetched`);
      }
    }
    await ctx.close();
  }

  // ── 6b. Real forced transport failure ───────────────────────────────────
  {
    const { ctx, page } = await newPage();
    // Genuine transport-layer abort — the same shape as this environment's
    // documented real outages, not a mocked response body.
    await page.route("**/business/leads*", r => r.abort("failed"));
    const booted = await boot(page);
    if (!booted) {
      todo("live: Reports failed-load checks", "the app shell never rendered after 8 real reload attempts with backoff. NOT counted as passes.");
    } else {
      const live = await retry(async () => {
        await goTab(page, "Reports", 14000);
        const m = await page.evaluate(readReports);
        return (m.kpis.length === 4) ? m : null;
      }, { attempts: 4, waitMs: 4000 });

      if (!live) {
        todo("live: Reports failed-load checks", "the real Reports page did not render its 4 KPI cards under the injected failure after 4 real retries. NOT counted as passes.");
      } else {
        const falseZeros = live.kpis.filter(k => /^0(\.0+)?%?$/.test(k.value));
        assert(falseZeros.length === 0,
          "LIVE (real injected failure): ZERO KPI cards assert a confident 0 when the underlying fetch genuinely failed",
          `LIVE: ${falseZeros.length} KPI card(s) still assert a false zero over a genuinely failed load: ${JSON.stringify(falseZeros)}`);

        const totalCard = live.kpis.find(k => /TOTAL LEADS/i.test(k.label));
        assert(totalCard && totalCard.value === "—",
          `LIVE (real injected failure): Total Leads degrades to the "—" unknown placeholder (measured "${totalCard && totalCard.value}")`,
          `LIVE: Total Leads rendered "${totalCard && totalCard.value}" over a genuinely failed load instead of "—"`);

        const closeCard = live.kpis.find(k => /CLOSE RATE/i.test(k.label));
        assert(closeCard && closeCard.value === "—",
          `LIVE (real injected failure): Close Rate degrades to "—" instead of a false 0%`,
          `LIVE: Close Rate rendered "${closeCard && closeCard.value}" over a genuinely failed load`);

        assert(live.errorBanner && /Couldn't load reports/i.test(live.errorBanner),
          "LIVE (real injected failure): the page's real error banner is genuinely shown — the failure is no longer silent",
          `LIVE: no error banner appeared over a genuinely failed load (measured: ${JSON.stringify(live.errorBanner)})`);

        assert(!/Add contacts to see pipeline distribution/i.test(live.pipelineEmpty),
          `LIVE (real injected failure): the Pipeline panel no longer tells a founder whose data failed to load to "Add contacts" (measured: "${live.pipelineEmpty}")`,
          `LIVE: the Pipeline panel still claims "No lead data yet. Add contacts…" over a genuinely failed load`);

        assert(/unavailable/i.test(live.pipelineEmpty),
          `LIVE (real injected failure): the Pipeline panel states the data is unavailable (measured: "${live.pipelineEmpty}")`,
          `LIVE: the Pipeline panel does not disclose that the data is unavailable`);
      }
    }
    await ctx.close();
  }

  // ── 6c. ⌘K "finance" parity ─────────────────────────────────────────────
  {
    const { ctx, page } = await newPage();
    const booted = await boot(page);
    if (!booted) {
      todo("live: ⌘K 'finance' parity check", "the app shell never rendered after 8 real reload attempts with backoff. NOT counted as passes.");
    } else {
      const res = await retry(async () => {
        await page.keyboard.press("Meta+k");
        await page.waitForTimeout(1200);
        const input = page.locator("input[placeholder*='Search' i]").last();
        if (!await input.count()) return null;
        await input.fill("finance");
        await page.waitForTimeout(1200);
        const items = await page.evaluate(() =>
          [...document.querySelectorAll("[class*='cmdk-item' i], [class*='palette-item' i], [class*='cp-item' i], [role='option']")]
            .map(e => (e.innerText || "").trim().replace(/\s+/g, " ")).filter(Boolean));
        return items.length ? items : null;
      }, { attempts: 4, waitMs: 3000 });

      if (!res) {
        todo("live: ⌘K 'finance' parity check", "the command palette did not open/return results after 4 real retries with backoff. NOT counted as a pass.");
      } else {
        assert(res.some(r => /Billing/i.test(r)),
          `LIVE: ⌘K "finance" now resolves Billing (real results: ${JSON.stringify(res.slice(0, 4))}) — at parity with the More menu`,
          `LIVE: ⌘K "finance" still does not surface Billing. Real results: ${JSON.stringify(res.slice(0, 6))}`);
      }
      await page.keyboard.press("Escape").catch(() => {});
    }
    await ctx.close();
  }

  await browser.close();
  return report();
}

function report() {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Reports + Executive + Analytics UX Consistency Regression: ${pass} passed, ${fail} failed, ${skipped} skipped`);
  if (failures.length) {
    console.log(`\nFailures:`);
    failures.forEach(f => console.log(`  - ${f.msg}: ${f.reason}`));
  }
  if (skips.length) {
    console.log(`\nSkipped (genuinely could not be exercised — NOT counted as passes):`);
    skips.forEach(s => console.log(`  - ${s.msg}: ${s.reason}`));
  }
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => {
  console.error("\nFATAL:", e && e.stack || e);
  process.exit(1);
});
