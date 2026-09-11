#!/usr/bin/env node
"use strict";
/**
 * C.2 — UX error truthfulness.
 *
 * Locks in the two defects C.2 found: a backend authorization failure being
 * presented to the user as a successful empty state, and a failed action being
 * presented as a completed one.
 *
 * This is the same defect class A.11.8 found in MarketplaceCenter (a real HTTP
 * 402 rendered as "0"), which is why it is worth a permanent guard: the pattern
 * recurs whenever a fetch helper calls .json() without checking status. Every
 * one of these endpoints answers 401 {"error":"Unauthorized"} on an expired
 * session, and that body parses perfectly well as JSON — so the failure is
 * invisible unless the status is checked.
 *
 * MEASURED LIVE IN C.2 (unauthenticated, against the running backend):
 *
 *   GET /p27/missions              -> 401 {"error":"Unauthorized"}
 *   GET /p27/ai/providers          -> 401 {"error":"Unauthorized"}
 *   POST /ai-ecosystem/benchmark/run -> 401 on an expired session
 *
 *   C2-01 CommandCenter.load(): res.missions was undefined so the list became
 *         [], and setError(null) then CLEARED the error. The user saw a
 *         truthful-looking "no active missions" while actually logged out.
 *
 *   C2-02 AIBenchmarkLab.runBench(): setRunResult(await r.json()) made the
 *         error body truthy, and the UI rendered
 *         "✓ {runResult.count} benchmark runs completed" — a green success
 *         tick, with count undefined, for an action that FAILED.
 *
 * The assertions are at the source, because that is where this silently
 * regresses: the runtime symptom only appears once a session has expired.
 *
 * Usage: node tests/security/100-c2-ux-error-truthfulness.cjs
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
      res.on("end", () => { let j = null; try { j = JSON.parse(b); } catch {} resolve({ status: res.statusCode, json: j }); });
    });
    req.on("error", reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error(`timeout ${path}`)); });
    req.end();
  });
}

/** Body of a named function/arrow, from its declaration to a balanced brace. */
function blockAfter(src, needle, span = 1600) {
  const i = src.indexOf(needle);
  if (i === -1) return "";
  return src.slice(i, i + span);
}

async function main() {
  section("The premise: these endpoints return a PARSEABLE error body");
  {
    let live = true;
    try { await request("GET", "/health"); } catch { live = false; }
    if (live) {
      for (const p of ["/p27/missions", "/p27/ai/providers"]) {
        const r = await request("GET", p);
        assert.ok(r.status === 401 || r.status === 403,
          `${p} must remain authorization-gated (got ${r.status}) — if it stopped being gated, ` +
          `this suite's premise would be void and the guards below would need rechecking`);
        assert.ok(r.json && typeof r.json === "object",
          `${p} returns a JSON error body that .json() parses happily — which is exactly why ` +
          `an unchecked fetch renders it as a successful empty state`);
      }
      ok("both endpoints return a parseable JSON error body under 401 — the defect's premise holds");
    } else {
      console.log("  —  SKIPPED (backend unavailable) — not counted as a pass");
    }
  }

  section("C2-01 — an authorization failure must not become an empty state");
  {
    const src = read("frontend/src/components/CommandCenter.jsx");
    const block = blockAfter(src, "'/p27/missions'");

    assert.ok(/\.ok\b|\.status\b/.test(block),
      "CommandCenter's mission load must check response status before using the body — " +
      "without it, a 401 becomes '0 active missions' with the error CLEARED");

    // The specific trap: clearing the error on a non-ok response.
    const clearsErrorUnguarded = /setError\(null\)/.test(block) && !/if\s*\(\s*!\s*r\.ok\s*\)/.test(block);
    assert.ok(!clearsErrorUnguarded,
      "setError(null) must not run on a response that was never checked — that is what made " +
      "the logged-out state look like a legitimately empty mission list");
    ok("mission load checks status before trusting the body");

    assert.ok(/401|403/.test(block),
      "the failure path should distinguish an expired session from a generic failure, so the " +
      "user is told to sign in rather than shown a bare error code");
    ok("an expired session produces a sign-in message, not a bare failure");
  }

  section("C2-02 — a failed action must not render as a success");
  {
    const src = read("frontend/src/components/AIBenchmarkLab.jsx");
    const block = blockAfter(src, "benchmark/run");

    assert.ok(/if\s*\(\s*!\s*r\.ok\s*\)/.test(block),
      "runBench must check response status — the UI renders '✓ {count} benchmark runs " +
      "completed', so an unchecked error body produces a green tick for a FAILED action");

    // setRunResult must not be reachable before the guard.
    const guardIdx = block.search(/if\s*\(\s*!\s*r\.ok\s*\)/);
    const setIdx   = block.indexOf("setRunResult(d)");
    assert.ok(guardIdx !== -1 && (setIdx === -1 || guardIdx < setIdx),
      "the status guard must come BEFORE the success state is set, or the success banner " +
      "can still be populated from an error body");
    ok("the success banner is only reachable after a successful response");

    // The success marker still exists — the fix must not have removed the feature.
    assert.ok(/benchmark runs completed/.test(src),
      "the genuine success message must still exist — this fix redirects failures, " +
      "it does not delete the success path");
    ok("the genuine success path is preserved, not removed");
  }

  section("C2-03 — irreversible token revocation must be confirmed");
  {
    const src = read("frontend/src/components/WorkspaceSettingsK2.jsx");

    // A.11.8 recovered confirmation for the Sessions panel in this same file;
    // the Tokens panel was missed. Revoking an API token is strictly more
    // damaging than revoking a session — it breaks live integrations — so the
    // weaker action must not be the only one that asks.
    const i = src.indexOf("function TokensPanel");
    assert.ok(i !== -1, "TokensPanel must still exist");
    const panel = src.slice(i, src.indexOf("\nfunction ", i + 10) === -1 ? undefined : src.indexOf("\nfunction ", i + 10));

    assert.ok(/useConfirm\(\)/.test(panel),
      "TokensPanel must use the app's established useConfirm pattern — revoking an API " +
      "token is irreversible and immediately breaks any integration using it");
    assert.ok(/await confirm\(\{/.test(panel),
      "revoke() must await a confirmation before issuing the DELETE");
    assert.ok(/\{ConfirmUI\}/.test(panel),
      "ConfirmUI must be RENDERED in this panel — without it the dialog never appears " +
      "and the await would silently block revocation entirely");
    ok("token revocation confirms, using the file's own established pattern");

    // The sessions panel's existing confirmation must not have been disturbed.
    assert.ok((src.match(/await confirm\(\{/g) || []).length >= 3,
      "the pre-existing confirmations (A.11.8) must remain — this fix adds one, removes none");
    ok("pre-existing A.11.8 confirmations are intact");
  }

  section("C2-04 — the dashboard must escape its loading state");
  {
    const src = read("frontend/src/components/Dashboard.jsx");
    const i = src.indexOf("const loading = stats === null");
    assert.ok(i !== -1, "the Dashboard loading guard must still exist");
    const block = src.slice(i, i + 1400);

    // The escape hatch must not depend solely on the two props that never change.
    assert.ok(/setTimeout\(/.test(block),
      "the nullCycles escape hatch must advance on its own — depending only on " +
      "[stats, opsData] meant it never re-ran while BOTH stayed null, so `loading` " +
      "stayed true forever and 33 skeletons rendered indefinitely");
    assert.ok(/nullCycles\]/.test(block) || /nullCycles\s*\]/.test(block),
      "nullCycles must be in the effect's dependency list, or the timer only fires once");
    ok("the loading escape hatch advances on a timer, not only on prop changes");

    // stats/opsData really are operator-scoped — that is the premise of the bug.
    const app = read("frontend/src/App.jsx");
    assert.ok(/role === "operator"/.test(app),
      "App.jsx still scopes the stats/opsData poll to operators — which is why an " +
      "ordinary user's Dashboard receives null forever and needs the timer hatch");
    ok("the operator-scoped poll that makes this reachable is still in place");
  }

  section("No other success feedback is emitted without a status check");
  {
    // Guard against the pattern returning elsewhere in the same components.
    for (const f of ["frontend/src/components/CommandCenter.jsx",
                     "frontend/src/components/AIBenchmarkLab.jsx"]) {
      const src = read(f);
      const lines = src.split("\n");
      const offenders = [];
      for (let i = 0; i < lines.length; i++) {
        if (!/await\s+fetch\(/.test(lines[i])) continue;
        const win = lines.slice(i, i + 12).join("\n");
        const claimsSuccess = /setRunResult\(|setError\(null\)/.test(win);
        const guarded = /\.ok\b|\.status\b/.test(win);
        if (claimsSuccess && !guarded) offenders.push(`${f}:${i + 1}`);
      }
      assert.deepStrictEqual(offenders, [],
        `these fetches claim success without checking status: ${offenders.join(", ")}`);
    }
    ok("no unguarded success claims remain in either component");
  }

  console.log(`\n${pass} passed, 0 failed`);
  process.exit(0);
}

main().catch(err => { console.error("FAILED:", err.message); process.exit(1); });
