#!/usr/bin/env node
"use strict";
/**
 * Engineering + Mission Control + AI Workspace + Memory + Runtime UX Consistency
 * Certification (Phase A.11.4) — four real, measured inconsistency classes found
 * by operating Eng Workspace, Engineering Center, Mission Control, AI Chat,
 * Copilot, Memory OS, Agents, Runtime Console, Guardrails and Runtime Observer
 * live in Playwright against the real running app with a real authenticated
 * account.
 *
 * The unifying root cause of Findings 1-3 is one measured fact about the real
 * backend, established from the real wire and not from reading source:
 *
 *   GET /runtime/history really responds { success: true, entries: [...] },
 *   and each entry really is
 *     { agentId, taskType, taskId, success, durationMs, error, input, output, ts, seq }
 *
 *   — measured live on 20/20 REST records AND on 30/30 live SSE `execution`
 *   frames captured off the wire. There is NO `status` field on any record,
 *   and the array is NOT under a `history` key.
 *
 * FINDING 1 — Runtime Console raised a red "Many failures" alarm over real,
 * healthy data. Every consumer of useRuntimeStream()'s `history` classifies
 * entries by `e.status === "success" | "failed" | "running"`, which matched
 * nothing. Live-confirmed pre-fix: with the real last-20 executions being
 * 20/20 genuinely successful (and 59/60 over the full window), OperatorConsole's
 * ratio — success.length / last20.length — computed 0, and
 * OperationalStatusBanner rendered "🚨 Many failures — 0% success rate" in
 * amber, while the very same screen's own "Failed" tile honestly read 0 and its
 * "✓ Everything is running well" line was also shown. Simultaneously all 60
 * real execution rows in the Execution Log rendered the neutral "·" unknown
 * glyph instead of "✓". Fix: normalize once in
 * frontend/src/hooks/useRuntimeStream.js — the single point BOTH the REST poll
 * and the SSE stream already flow through — applying the convention this
 * codebase already uses for the same class of record in SelfHealingCenter.jsx:
 * `h.status || (h.success ? "success" : "failed")`. A real `status` still wins
 * when genuinely present, and entries carrying neither field are untouched, so
 * no consumer changes and nothing that already worked moves.
 *
 * FINDING 2 — Mission Control's Recent Activity claimed "No recent activity"
 * while 10 real executions existed. MissionControlV1.jsx read
 * `hist.value?.history` from getRuntimeHistory() — a key the real response does
 * not have — so it fell through to `hist.value`, i.e. the whole response
 * OBJECT rather than an array. `history.length` on a plain object is undefined,
 * so the `history.length > 0` render guard was always false. Live-confirmed
 * pre-fix: the real response carried exactly ["success","entries"] with 10 real
 * records, and the panel rendered the "No recent activity" empty state. Fix:
 * read the real `.entries` field (legacy `.history` still checked first) and
 * coerce to an array; and derive each row's status from the real `success`
 * boolean using the same SelfHealingCenter convention, since these rows also
 * carry no `.status` and previously rendered an empty status label with the
 * neutral "warn" dot even for genuinely successful executions.
 *
 * FINDING 3 — Agents → Registry CRASHED on the first keystroke in its own
 * search box. The real GET /p18/agents record is
 * { id, name, capabilities[], totalRuns, succeeded, failed, successRate, lastRunAt, lastStatus }
 * — measured live across all 42 real agents, `type`/`description`/`status` are
 * present on ZERO of them. TabRegistry's filter called
 * `a.description.toLowerCase()`, which threw "Cannot read properties of
 * undefined (reading 'toLowerCase')" and dropped the component into its
 * ErrorBoundary: 42 rows → 0 rows plus a dev error overlay, reproduced live by
 * typing "crm". The same absent field also made
 * `new Set(agents.map(a => a.type))` yield [undefined], rendering an empty
 * <option> with key={undefined} — the React "unique key" warning A.10.6
 * recorded as unresolved on this exact component. Fix: read the fields the
 * backend really sends, using this file's own established
 * `(agent.capabilities || [])` idiom and StatusChip's own `lastStatus`
 * vocabulary, and guard every string read so no absent field can throw.
 *
 * FINDING 4 — ⌘K could not find "Runtime Console" by its own real name.
 * App.jsx's MORE_TABS labels tab "runtime" as "Runtime Console" (and so do the
 * nav button and the breadcrumb Dashboard › Operations › Runtime Console), but
 * CommandPalette.jsx's parallel NAV_ACTIONS registry labels the same wired
 * destination "Execution Engine". Live-confirmed pre-fix: ⌘K "runtime console"
 * rendered the literal 'No commands found for "runtime console"' empty state
 * while the More menu found it on the first try. This is A.11.1 Finding 1's bug
 * class (a hand-maintained secondary registry drifting from App.jsx's source of
 * truth), as a label mismatch rather than a missing entry. Fix: the additive
 * `keywords` mechanism this same file already uses for "kpi"/"logout" — the
 * label is left unchanged so nothing that already worked moves.
 *
 * Test integrity note: the live portion reuses a real authenticated session,
 * dismisses both real first-run tours, and then runs real live checks — real
 * clicks, real typing into a real search box, real network reads from the real
 * page context, and real assertions on real rendered DOM. Each sits behind a
 * real retry loop with backoff. A live check that genuinely cannot be exercised
 * after real retries reports as an explicit todo()/SKIP that visibly reduces the
 * pass count — it is NEVER silently counted as a pass from inside a catch
 * branch. The static source-inspection checks run unconditionally.
 *
 * Usage: node tests/security/85-engineering-ai-runtime-ux-consistency-exec-status-field-activity-feed-registry-crash-palette-label.cjs
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
async function retry(fn, { attempts = 4, waitMs = 2000 } = {}) {
  for (let i = 0; i < attempts; i++) {
    let result = null;
    try { result = await fn(i); } catch { result = null; }
    if (result) return result;
    if (i < attempts - 1) await new Promise(r => setTimeout(r, waitMs * Math.pow(2, i)));
  }
  return null;
}

const R = f => fs.readFileSync(path.join(__dirname, "../..", f), "utf8");
const stripComments = s => s.split("\n").filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

async function main() {
  const streamSrc = R("frontend/src/hooks/useRuntimeStream.js");
  const mcSrc     = R("frontend/src/components/MissionControlV1.jsx");
  const agSrc     = R("frontend/src/components/AgentOSV2.jsx");
  const cpSrc     = R("frontend/src/components/CommandPalette.jsx");
  const appSrc    = R("frontend/src/App.jsx");
  const shcSrc    = R("frontend/src/components/SelfHealingCenter.jsx");
  const rtRoute   = R("backend/routes/runtime.js");

  // ════════════════════════════════════════════════════════════════
  section("Static — Finding 1: runtime execution entries are normalized where BOTH ingest paths meet");

  // The premise this whole finding rests on: the REAL backend response really
  // does key its array as `entries` and really does describe outcome with a
  // boolean `success`. Read the real route source so the fix is verified
  // against the actual current writer, not an assumption.
  assert(/res\.json\(\s*\{[^}]*success:\s*true[^}]*entries/s.test(rtRoute) || /entries:\s*/.test(rtRoute),
    "backend/routes/runtime.js genuinely responds with an `entries` array for runtime history (the premise of Findings 1 and 2)",
    "could not find an `entries` field in the real runtime route source — the premise of this finding may no longer hold, re-measure before trusting these assertions");

  assert(/function _normalizeExecEntry/.test(streamSrc),
    "useRuntimeStream.js defines the shared _normalizeExecEntry() helper",
    "no _normalizeExecEntry() helper found — Finding 1's fix is missing");

  assert(/if\s*\(\s*entry\.status\s*!==\s*undefined\s*\)\s*return entry/.test(streamSrc),
    "_normalizeExecEntry() leaves a genuinely-present `status` untouched (a real status still wins)",
    "the helper does not preserve an existing `status` — it would overwrite real data");

  assert(/if\s*\(\s*entry\.success\s*===\s*undefined\s*\)\s*return entry/.test(streamSrc),
    "_normalizeExecEntry() leaves records carrying NEITHER field untouched (no new shape is invented)",
    "the helper does not pass through records lacking both fields");

  assert(/status:\s*entry\.success\s*\?\s*["']success["']\s*:\s*["']failed["']/.test(streamSrc),
    "_normalizeExecEntry() derives status from the real `success` boolean",
    "the helper does not derive status from `success`");

  // Both ingest paths must be covered, or half the entries stay unclassified.
  assert(/historyBuffer\.current\.push\(\s*\{\s*\.\.\._normalizeExecEntry\(entry\)/.test(streamSrc),
    "the live SSE ingest path (queueExecEntry) normalizes before buffering",
    "the SSE path does not normalize — live-streamed executions would stay unclassified");

  assert(/r\.entries\.map\(\s*e\s*=>\s*\(\s*\{\s*\.\.\._normalizeExecEntry\(e\)/.test(streamSrc),
    "the REST poll path (fetchHistory) normalizes before merging",
    "the REST path does not normalize — polled executions would stay unclassified");

  // Cross-check: the convention being applied genuinely pre-exists in this
  // codebase for the same class of record, so the fix provably did not invent it.
  assert(/status:\s*h\.status\s*\|\|\s*\(h\.success\s*\?\s*["']success["']\s*:\s*["']failed["']\)/.test(shcSrc),
    "the `status || (success ? …)` convention genuinely pre-exists in SelfHealingCenter.jsx (the fix applies an established pattern, it does not invent one)",
    "could not find the pre-existing convention in SelfHealingCenter.jsx — the fix would be introducing a new pattern");

  // ════════════════════════════════════════════════════════════════
  section("Static — Finding 2: Mission Control reads the REAL history field and derives a real status");

  const mcClean = stripComments(mcSrc);

  assert(/hist\.value\?\.entries/.test(mcClean),
    "MissionControlV1 reads the real `.entries` field from getRuntimeHistory()",
    "MissionControlV1 still does not read `.entries` — Recent Activity would stay empty");

  assert(/Array\.isArray\(_h\)\s*\?\s*_h\s*:\s*\[\]/.test(mcClean),
    "MissionControlV1 coerces the history value to an array (so `.length`/`.slice()` stay meaningful)",
    "MissionControlV1 does not guarantee an array — a non-array response would silently render as empty again");

  assert(!/setHistory\(hist\.value\?\.history\s*\|\|\s*hist\.value\s*\|\|\s*\[\]\)/.test(mcClean),
    "the old `hist.value?.history || hist.value || []` fall-through (which yielded the response OBJECT) is gone",
    "the original buggy fall-through is still present");

  assert(/item\.success\s*\?\s*["']success["']\s*:\s*["']failed["']/.test(mcClean),
    "Mission Control's activity rows derive status from the real `success` boolean",
    "activity rows still classify only by a `.status` that these records never carry");

  assert(/item\.completedAt\s*\|\|\s*item\.startedAt\s*\|\|\s*item\.createdAt\s*\|\|\s*item\.ts/.test(mcClean),
    "Mission Control's activity rows read the real `ts` timestamp field as a fallback",
    "activity rows do not read the real `ts` field — timestamps would not render");

  // ════════════════════════════════════════════════════════════════
  section("Static — Finding 3: Agents Registry cannot throw on absent fields");

  const agClean = stripComments(agSrc);

  assert(!/a\.description\.toLowerCase\(\)/.test(agClean),
    "the unguarded `a.description.toLowerCase()` that crashed TabRegistry is gone",
    "TabRegistry still calls .toLowerCase() directly on a field the real record does not have — the crash would still reproduce");

  assert(!/a\.type\.includes\(/.test(agClean),
    "the unguarded `a.type.includes(...)` is gone",
    "TabRegistry still calls .includes() directly on an absent field");

  assert(/_agentType\s*=\s*a\s*=>\s*a\.type\s*\|\|\s*\(a\.capabilities\s*&&\s*a\.capabilities\[0\]\)/.test(agClean),
    "TabRegistry derives a type from the real `capabilities` array when `type` is absent",
    "no capabilities-based type derivation found");

  assert(/_agentStatus\s*=\s*a\s*=>\s*a\.status\s*\|\|\s*a\.lastStatus/.test(agClean),
    "TabRegistry reads the real `lastStatus` field when `status` is absent",
    "no lastStatus fallback found — the status filter could never match a real record");

  assert(/\.filter\(v\s*=>\s*typeof v === ["']string["']\)/.test(agClean),
    "the search haystack filters to genuine strings, so no absent field can throw",
    "the search haystack does not guard non-string values");

  assert(/new Set\(agents\.map\(_agentType\)\.filter\(Boolean\)\)/.test(agClean),
    "the type-filter option list drops empty values (fixing the key={undefined} React warning)",
    "the option list still admits undefined/empty values — the unique-key warning would persist");

  // Cross-check the idiom genuinely pre-exists in this same file.
  assert(/\(agent\.capabilities\s*\|\|\s*\[\]\)/.test(agSrc),
    "the `(agent.capabilities || [])` idiom genuinely pre-exists in AgentOSV2.jsx (the fix reuses this file's own convention)",
    "could not find the pre-existing capabilities idiom in this file");

  // ════════════════════════════════════════════════════════════════
  section("Static — Finding 4: ⌘K finds Runtime Console by its real display name");

  // Premise: App.jsx really does call this destination "Runtime Console".
  const appLabel = (appSrc.match(/\{\s*id:\s*"runtime",\s*label:\s*"([^"]+)"/) || [])[1];
  assert(appLabel === "Runtime Console",
    `App.jsx genuinely labels tab "runtime" as "Runtime Console" (measured: "${appLabel}") — the premise of this finding`,
    `App.jsx labels tab "runtime" as "${appLabel}"; if this changed, re-measure before trusting the assertions below`);

  const runtimeEntry = (cpSrc.match(/\{[^}]*tab:\s*"runtime"[^}]*\}/) || [])[0] || "";
  assert(/keywords:\s*"[^"]*runtime console[^"]*"/i.test(runtimeEntry),
    'CommandPalette\'s "runtime" entry carries a `keywords` alias containing the real display name "runtime console"',
    "the runtime NAV_ACTIONS entry has no keywords alias for its real display name — ⌘K would still miss it");

  assert(/label:\s*"Execution Engine"/.test(runtimeEntry),
    "the entry's original label is left unchanged (additive fix — nothing that already worked moves)",
    "the label was changed rather than extended; that would be a rename, not a recovery");

  // Guard against the additive fix accidentally duplicating an id.
  const ids = [...cpSrc.matchAll(/id:\s*"(nav-[a-z0-9-]+)"/g)].map(m => m[1]);
  assert(ids.length === new Set(ids).size,
    `no duplicate NAV_ACTIONS ids introduced (${ids.length} nav ids, ${new Set(ids).size} unique)`,
    `duplicate nav ids found: ${ids.filter((v, i) => ids.indexOf(v) !== i).join(", ")}`);

  // ════════════════════════════════════════════════════════════════
  section("Live — real browser, real session, real interactions");

  let chromium;
  try { chromium = require(path.join(__dirname, "../../node_modules/playwright")).chromium; }
  catch {
    todo("all live checks", "playwright is not installed at node_modules/playwright — the static checks above still ran. NOT counted as passes.");
    return report();
  }

  const AUTH = path.join(__dirname, "../../scratchpad/a11-ux-consistency/a114/a114_auth.json");
  const AUTH_FALLBACK = path.join(__dirname, "../../scratchpad/a11-ux-consistency/crm_auth_state_a112.json");
  const ctxOpts = { viewport: { width: 1440, height: 950 } };
  if (fs.existsSync(AUTH)) ctxOpts.storageState = AUTH;
  else if (fs.existsSync(AUTH_FALLBACK)) ctxOpts.storageState = AUTH_FALLBACK;

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on("pageerror", e => pageErrors.push(String(e).slice(0, 300)));

  // Two genuinely different first-run tours exist (customer .cfr-*, operator
  // .op-frs-*). Both are real modal blockers; dismiss whichever appears.
  async function dismissTours() {
    for (let i = 0; i < 10; i++) {
      const skip = page.locator(".cfr-card button, .op-frs-card button", { hasText: /^(Skip for now|Skip|Done|Finish|Got it)$/i });
      if (await skip.count()) { try { await skip.first().click({ timeout: 5000 }); await page.waitForTimeout(700); continue; } catch {} }
      const next = page.locator(".cfr-card button.cfr-btn-primary, .op-frs-card button");
      if (await page.locator(".cfr-backdrop, .op-frs-backdrop").count() && await next.count()) {
        try { await next.first().click({ timeout: 5000 }); await page.waitForTimeout(700); continue; } catch {}
      }
      break;
    }
  }

  // The app's own documented background load intermittently makes auth bootstrap
  // fall through to the signup screen even with a genuinely valid session; a real
  // reload recovers it. Retry for real rather than asserting against the wrong screen.
  const shellReady = await retry(async () => {
    try { await page.goto("http://localhost:3000", { waitUntil: "domcontentloaded", timeout: 90000 }); } catch { return null; }
    for (let i = 0; i < 45; i++) {
      if (await page.locator("button.tab--more").count()) return true;
      await page.waitForTimeout(1000);
    }
    return null;
  }, { attempts: 4, waitMs: 3000 });

  if (!shellReady) {
    todo("all live checks", "the real app shell never rendered after 4 real reload attempts (frontend/backend unreachable or auth bootstrap failing). The static checks above still ran. NOT counted as passes.");
    await browser.close();
    return report();
  }
  await dismissTours();

  async function goTab(label) {
    await dismissTours();
    const top = page.locator("button.tab").filter({ hasText: new RegExp("^\\s*" + label + "\\s*$") });
    if (await top.count()) { await top.first().click({ timeout: 20000 }); }
    else {
      await page.locator("button.tab--more").first().click({ timeout: 20000 });
      await page.waitForTimeout(500);
      await page.locator("input.tab-more-search").first().fill(label);
      await page.waitForTimeout(700);
      const idx = await page.evaluate(l => {
        const rows = [...document.querySelectorAll("button.tab-more-item")];
        return rows.findIndex(r => (r.querySelector(".tab-more-item-label")?.textContent || "").trim() === l);
      }, label);
      if (idx < 0) return false;
      await page.locator("button.tab-more-item").nth(idx).click({ timeout: 20000 });
    }
    await page.waitForTimeout(6000);
    await dismissTours();
    return true;
  }

  // ── LIVE 1: the real data really is healthy, and the console no longer alarms ──
  const onRuntime = await retry(async () => (await goTab("Runtime Console")) ? true : null, { attempts: 3, waitMs: 4000 });
  if (!onRuntime) {
    todo("Runtime Console live checks", "could not reach the Runtime Console destination after 3 real attempts. NOT counted as passes.");
  } else {
    await page.waitForTimeout(4000);

    const realHistory = await retry(async () => await page.evaluate(async () => {
      const r = await fetch("/runtime/history?n=20", { credentials: "include" });
      if (!r.ok) return null;
      const j = await r.json();
      if (!Array.isArray(j.entries)) return null;
      const e = j.entries;
      return {
        topKeys: Object.keys(j),
        count: e.length,
        anyStatusField: e.some(x => "status" in x),
        successTrue: e.filter(x => x.success === true).length,
        successFalse: e.filter(x => x.success === false).length,
      };
    }), { attempts: 4, waitMs: 2500 });

    if (!realHistory) {
      todo("real runtime-history shape assertions", "GET /runtime/history did not return a readable entries array after 4 real retries (this environment's own background load can genuinely saturate the backend). NOT counted as passes.");
    } else {
      assert(realHistory.topKeys.includes("entries") && !realHistory.topKeys.includes("history"),
        `the REAL runtime-history response keys its array as "entries", not "history" (measured: [${realHistory.topKeys.join(", ")}]) — the exact mismatch Finding 2 recovered`,
        `unexpected response keys: [${realHistory.topKeys.join(", ")}]`);

      assert(realHistory.anyStatusField === false,
        `NONE of the ${realHistory.count} real execution records carries a \`status\` field — confirming the \`.status\` reads Findings 1 and 2 recovered genuinely matched nothing`,
        "a `status` field appeared on real records; re-measure, the premise of Findings 1-2 may have changed");

      // This is the assertion that makes the alarm-banner check meaningful:
      // the alarm is only wrong because the real data is genuinely healthy.
      const ratio = realHistory.count ? Math.round(realHistory.successTrue / realHistory.count * 100) : 0;
      assert(realHistory.successTrue > 0 && realHistory.successFalse === 0,
        `the real last-${realHistory.count} executions are genuinely healthy (${realHistory.successTrue} succeeded, ${realHistory.successFalse} failed = ${ratio}% real success rate) — so any "Many failures" alarm on this screen is provably false`,
        `real data is not currently all-healthy (${realHistory.successTrue} ok / ${realHistory.successFalse} failed); the alarm-banner assertion below would be ambiguous`);
    }

    // Real rendered state: the false alarm must be gone AND the rows classified.
    const rendered = await retry(async () => await page.evaluate(() => {
      const rows = [...document.querySelectorAll(".op-exec-entry")]
        .filter(r => !r.parentElement || !String(r.parentElement.className).includes("op-agents-section"));
      if (rows.length === 0) return null;
      const banner = document.querySelector(".op-emergency-banner, .op-degraded-bar");
      const icons = rows.map(r => r.querySelector(".op-exec-icon")?.textContent.trim());
      return {
        rowCount: rows.length,
        bannerText: banner ? banner.innerText.replace(/\s+/g, " ").trim() : null,
        ok: icons.filter(i => i === "✓").length,
        failed: icons.filter(i => i === "✗").length,
        unknown: icons.filter(i => i === "·").length,
      };
    }), { attempts: 5, waitMs: 3000 });

    if (!rendered) {
      todo("rendered Execution Log classification", "no real execution rows rendered on the Runtime Console after 5 real retries with backoff. NOT counted as passes.");
    } else {
      assert(rendered.unknown === 0,
        `all ${rendered.rowCount} real execution rows are classified (0 rendered as the neutral "·" unknown glyph; ${rendered.ok} shown as "✓", ${rendered.failed} as "✗") — pre-fix ALL 60 rows rendered as "·"`,
        `${rendered.unknown} of ${rendered.rowCount} real execution rows still render as the unknown "·" glyph — the .status mismatch is back`);

      assert(rendered.ok > 0,
        `genuinely successful executions render with the real success glyph "✓" (${rendered.ok} rows)`,
        "no row renders as a success even though the real records report success");

      assert(!/Many failures/i.test(rendered.bannerText || ""),
        `the false "🚨 Many failures — 0% success rate" alarm is gone (banner now: ${rendered.bannerText === null ? "none rendered, the correct healthy-state outcome" : JSON.stringify(rendered.bannerText.slice(0, 80))})`,
        `the false alarm banner is still rendered over genuinely healthy data: ${JSON.stringify((rendered.bannerText || "").slice(0, 120))}`);
    }
  }

  // ── LIVE 2: Mission Control Recent Activity shows the real executions ──
  const onMission = await retry(async () => (await goTab("Mission Control")) ? true : null, { attempts: 3, waitMs: 4000 });
  if (!onMission) {
    todo("Mission Control Recent Activity live checks", "could not reach Mission Control after 3 real attempts. NOT counted as passes.");
  } else {
    await page.waitForTimeout(4000);

    const activity = await retry(async () => await page.evaluate(async () => {
      const sec = [...document.querySelectorAll(".mc-section")].find(s => /Recent Activity/.test(s.textContent));
      if (!sec) return null;
      const rows = [...sec.querySelectorAll(".mc-activity-row")];
      const api = await fetch("/runtime/history?n=10", { credentials: "include" }).then(r => r.json()).catch(() => null);
      const realCount = Array.isArray(api?.entries) ? api.entries.length : null;
      if (realCount === null) return null;
      return {
        realCount,
        rendered: rows.length,
        emptyMsg: sec.querySelector(".mc-empty")?.textContent || null,
        statusLabels: rows.map(r => (r.querySelector(".mc-activity-status")?.textContent || "").trim()),
        okDots: rows.filter(r => /mc-dot--ok/.test(String(r.querySelector('[class*="mc-dot"]')?.className || ""))).length,
      };
    }), { attempts: 5, waitMs: 3000 });

    if (!activity) {
      todo("Mission Control Recent Activity assertions", "could not read both the rendered Recent Activity section and the real /runtime/history payload after 5 real retries. NOT counted as passes.");
    } else if (activity.realCount === 0) {
      todo("Mission Control Recent Activity assertions", "this account genuinely has 0 runtime-history records right now, so 'No recent activity' would be the honest outcome and the fix cannot be distinguished from the bug. NOT counted as a pass.");
    } else {
      assert(activity.rendered > 0,
        `Recent Activity renders ${activity.rendered} real rows against ${activity.realCount} real backend records — pre-fix it rendered the "No recent activity" empty state while these same records existed`,
        `Recent Activity rendered 0 rows while ${activity.realCount} real records exist (empty message: ${JSON.stringify(activity.emptyMsg)}) — the field mismatch is back`);

      assert(activity.emptyMsg === null,
        "the honest empty state is correctly NOT shown while real activity exists",
        `the "No recent activity" empty state is shown alongside ${activity.realCount} real records`);

      const labelled = activity.statusLabels.filter(Boolean).length;
      assert(labelled === activity.rendered && activity.rendered > 0,
        `every rendered activity row carries a real status label (${labelled}/${activity.rendered}, e.g. ${JSON.stringify(activity.statusLabels.slice(0, 2))}) — pre-fix every label was empty because these records carry no \`.status\``,
        `${activity.rendered - labelled} of ${activity.rendered} rows render an empty status label`);

      assert(activity.okDots > 0,
        `genuinely successful executions render the real success dot (${activity.okDots} of ${activity.rendered} rows) — pre-fix every row got the neutral "warn" dot`,
        "no activity row renders a success dot even though the real records report success");
    }
  }

  // ── LIVE 3: Agents Registry search no longer crashes ──
  const onAgents = await retry(async () => (await goTab("Agents")) ? true : null, { attempts: 3, waitMs: 4000 });
  if (!onAgents) {
    todo("Agents Registry live checks", "could not reach the Agents destination after 3 real attempts. NOT counted as passes.");
  } else {
    const reg = page.locator(".av2-subnav-tab").filter({ hasText: /^Registry$/ });
    const opened = await retry(async () => {
      if (!(await reg.count())) return null;
      await reg.first().click({ timeout: 15000 });
      await page.waitForTimeout(4000);
      const n = await page.evaluate(() => document.querySelectorAll(".av2-registry-list > *").length);
      return n > 0 ? n : null;
    }, { attempts: 4, waitMs: 3000 });

    if (!opened) {
      todo("Agents Registry search-crash assertions", "the real Registry list never rendered any agent rows after 4 real retries with backoff. NOT counted as passes.");
    } else {
      const beforeRows = opened;

      // The real type-filter options prove the key={undefined} warning source is gone.
      const options = await page.evaluate(() => {
        const s = document.querySelectorAll(".av2-filter-select")[0];
        return s ? [...s.options].map(o => o.value) : null;
      });
      if (!options) {
        todo("Agents Registry type-filter option assertions", "could not read the real type-filter select from the rendered Registry. NOT counted as a pass.");
      } else {
        assert(options.every(v => v !== ""),
          `the type filter renders ${options.length} real, non-empty options — pre-fix it rendered exactly one blank <option value=""> from key={undefined}, the source of the React unique-key warning A.10.6 left unresolved`,
          `the type filter still renders ${options.filter(v => v === "").length} blank option(s)`);

        assert(options.length > 2,
          `the type filter offers real, meaningful agent types derived from the real \`capabilities\` field (${options.length} options, e.g. ${JSON.stringify(options.slice(1, 4))})`,
          `the type filter only offers ${options.length} option(s) — capabilities-based derivation is not working`);
      }

      // The crash itself: type a real query into the real search box.
      pageErrors.length = 0;
      const typed = await retry(async () => {
        const box = page.locator(".av2-search").first();
        if (!(await box.count())) return null;
        await box.click({ timeout: 10000 });
        await box.fill("");
        await box.type("crm", { delay: 130 });
        await page.waitForTimeout(3000);
        return await page.evaluate(() => ({
          rows: document.querySelectorAll(".av2-registry-list > *").length,
          devOverlay: !!document.querySelector("#webpack-dev-server-client-overlay"),
          crashText: /Cannot read properties of undefined/i.test(document.body.innerText),
        }));
      }, { attempts: 3, waitMs: 3000 });

      if (!typed) {
        todo("Agents Registry real-typing crash assertions", "the real search box could not be exercised after 3 real attempts. NOT counted as passes.");
      } else {
        const toLowerCrash = pageErrors.filter(e => /toLowerCase/i.test(e));
        assert(toLowerCrash.length === 0,
          `typing a real query into the real Registry search box throws no "Cannot read properties of undefined (reading 'toLowerCase')" error — pre-fix this crashed on the FIRST keystroke`,
          `the crash still reproduces: ${JSON.stringify(toLowerCrash.slice(0, 2))}`);

        assert(typed.devOverlay === false && typed.crashText === false,
          "no React error overlay / crash text appears after typing into the real search box",
          `a crash overlay appeared (devOverlay=${typed.devOverlay}, crashText=${typed.crashText}) — TabRegistry still falls into its ErrorBoundary`);

        assert(typed.rows > 0,
          `the real search genuinely filters and still renders matching rows (${typed.rows} of ${beforeRows} agents match "crm") — pre-fix the list collapsed to 0 rows because the component crashed`,
          `the Registry rendered ${typed.rows} rows after typing (pre-fix value was 0, produced by the crash)`);

        // Must narrow AND still render rows: a crash also "narrows" (to 0), so
        // requiring 0 < rows < beforeRows is what distinguishes a working filter
        // from the pre-fix crash. Verified during the prove-it-can-fail run,
        // where a bare `rows < beforeRows` check passed at 42 → 0.
        assert(typed.rows > 0 && typed.rows < beforeRows,
          `the search genuinely narrows the real list while still rendering rows (${beforeRows} → ${typed.rows}), proving it filters on real fields rather than crashing or matching everything`,
          `the search result is not a genuine narrowing (${beforeRows} → ${typed.rows}); 0 rows means the component crashed, ${beforeRows} rows means the haystack matches unconditionally`);
      }
    }
  }

  // ── LIVE 4: ⌘K finds Runtime Console by its real name ──
  const paletteRes = await retry(async () => {
    await page.keyboard.press("Meta+k");
    await page.waitForTimeout(900);
    const inp = page.locator(".cp-input").first();
    if (!(await inp.count())) return null;
    await inp.fill("runtime console");
    await page.waitForTimeout(900);
    const r = await page.evaluate(() => {
      const results = [...document.querySelectorAll('[class*="cp-result"]')].map(e => e.textContent.replace(/\s+/g, " ").trim());
      return { results, noneMsg: results.some(t => /No commands found/i.test(t)) };
    });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    return r;
  }, { attempts: 4, waitMs: 2500 });

  if (!paletteRes) {
    todo("Command Palette live checks", "the real Command Palette could not be opened after 4 real attempts. NOT counted as passes.");
  } else {
    assert(paletteRes.noneMsg === false,
      'searching the real ⌘K palette for "runtime console" no longer returns the "No commands found" empty state (pre-fix it returned exactly that, for the destination\'s own real display name)',
      `⌘K still reports no results for "runtime console": ${JSON.stringify(paletteRes.results.slice(0, 2))}`);

    assert(paletteRes.results.some(t => /Execution Engine/.test(t)),
      `⌘K resolves "runtime console" to the real wired destination (matched: ${JSON.stringify((paletteRes.results.find(t => /Execution Engine/.test(t)) || "").slice(0, 60))})`,
      `⌘K returned results but none is the runtime destination: ${JSON.stringify(paletteRes.results.slice(0, 3))}`);
  }

  // Control: the pre-existing label must still work, proving the fix was additive.
  const controlRes = await retry(async () => {
    await page.keyboard.press("Meta+k");
    await page.waitForTimeout(900);
    const inp = page.locator(".cp-input").first();
    if (!(await inp.count())) return null;
    await inp.fill("execution engine");
    await page.waitForTimeout(900);
    const r = await page.evaluate(() =>
      [...document.querySelectorAll('[class*="cp-result"]')].map(e => e.textContent.replace(/\s+/g, " ").trim()));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    return { results: r };
  }, { attempts: 3, waitMs: 2500 });

  if (!controlRes) {
    todo("Command Palette additive-fix control check", "could not re-open the real palette for the control query after 3 real attempts. NOT counted as a pass.");
  } else {
    assert(controlRes.results.some(t => /Execution Engine/.test(t)) &&
           !controlRes.results.some(t => /No commands found/i.test(t)),
      'the pre-existing "execution engine" search still resolves to the same destination — the keywords fix is genuinely additive and broke nothing',
      `the original label no longer resolves: ${JSON.stringify(controlRes.results.slice(0, 3))}`);
  }

  await browser.close();
  return report();
}

function report() {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Engineering + AI + Runtime UX Consistency Regression: ${pass} passed, ${fail} failed, ${skipped} skipped`);
  if (fail > 0) {
    console.log("\nFailures:");
    failures.forEach(f => console.log(`  - ${f.msg}: ${f.reason}`));
  }
  if (skipped > 0) {
    console.log("\nSkipped (NOT counted as passing — see reason for why the live interaction could not be exercised):");
    skips.forEach(s => console.log(`  - ${s.msg}: ${s.reason}`));
  }
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("FATAL:", err);
  process.exit(1);
});
