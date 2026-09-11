# C.9 — AI EXPERIENCE WORKFLOW EVIDENCE

Date: 2026-08-14/15 · Branch: `security/reality-completion`

Raw measured evidence from the live, authenticated server and real browser sessions. No claim from source inspection alone where a live check was possible.

---

## 1 · Real two-tenant setup (Org A / Org B)

Created via the app's own real service functions (`accountService.createAccount`, `organizationService.createOrg`) — no invented credentials, no auth bypass — then logged in through the real `POST /auth/login` HTTP route:

```
accountA: 452db4fc98d8cd8320de1642 (c9orga_1786728308@test.local)
accountB: 1caebfa1f91109e62658f271 (c9orgb_1786728308@test.local)
orgA:     org_1786728345592_1 (C9-OrgA-1786728308)
orgB:     org_1786728345611_2 (C9-OrgB-1786728308)
login A -> HTTP 200, real JWT cookie
login B -> HTTP 200, real JWT cookie
```

## 2 · Cross-router middleware leak — discovery, reproduction, fix

```
curl -b cookiesB.txt -X POST /coding/ask -d '{"question":"..."}'
  -> HTTP 403 {"error":"Not a member of this workspace"}
```

Org B, a fresh unrelated tenant, was blocked from an AI route (`/coding/ask`) that has no workspace-gating code of its own (confirmed by full source read of `codingAssistant.js` — zero `attachWorkspace`/`requireWorkspaceMember` references).

Root cause isolated with a minimal reproduction:
```js
const subA = express.Router();
subA.use((req,res,next)=>{ res.status(403).json({error:'blocked by subA'}); }); // no path prefix
const subB = express.Router();
subB.get('/bar', (req,res)=>res.json({ok:'bar'}));
app.use(subA); app.use(subB);
// GET /bar -> 403 "blocked by subA"  (confirmed: leaks onto sibling router's own routes)
```

Found the same pattern in 9 real files: `security.js`, `admin.js`, `governance.js`, `automation.js`, `analytics.js`, `extensions.js`, `marketplace.js`, `plugins.js`, `workspace.js` — each called `router.use(attachWorkspace)` (4 also `router.use(requireWorkspaceMember)`) with no path argument, while being mounted in `routes/index.js` with no path prefix (`router.use(require("./security"))`). `governance.js` already had a prior comment (from an earlier audit pass) explicitly documenting this exact leak and stating it depended on it — accurate at the time, now closed.

Fix: added the missing path-prefix argument to every call, mirroring the `requireAuth` line already present in each file (e.g. `router.use("/security", attachWorkspace)`).

```
After fix — same request:
curl -b cookiesB.txt -X POST /coding/ask -d '{"question":"..."}'
  -> HTTP 500 {"ok":false,"error":"AI backend unavailable. Check provider API keys in your .env file."}
```
Correctly reaches the AI call now and fails **honestly** (real provider-unavailable message), not a 403 from an unrelated file.

## 3 · AI-Memory tenant isolation gap — proven live

```
node -e "missionMemory.createMission({objective:'C9-TENANT-A-SECRET-MARKER-XYZZY: confidential OrgA rollout plan', priority:'high'})"
-> Created mission msn_486cbb9c476147e8b3c35595095cdd7f

node -e "console.log(missionMemory.listMissions({limit:5}).missions.map(m=>m.objective))"
-> [
     "C9-TENANT-A-SECRET-MARKER-XYZZY: confidential OrgA rollout plan",   <- appears with NO org filter applied
     "[Auto] Follow up immediately — leads idle >7 days convert 80% less frequently",
     ...
   ]
```

`_missionContext()` in `codingAssistant.js` calls exactly this function with no org parameter — proving any authenticated user's AI prompt (via `/coding/ask`) would receive Org A's mission text in its system prompt context, regardless of the caller's own org. `missionMemory.cjs` has zero `orgId`/`organizationId` field anywhere in its schema (grep confirmed). Documented as a genuine Memory OS gap, not fixed (out of scope), and locked in as a negative test so it stays honestly surfaced.

## 4 · `/coding/patch-history` direct-ID/global-data leak — proven live

```
curl -b cookiesA.txt /coding/patch-history -> {"ok":true,"patches":[{"id":"fa41ceaa-...", "goal":"rename old flag...", full file diffs...}]}
curl -b cookiesB.txt /coding/patch-history -> IDENTICAL response, byte-for-byte
```
Confirms zero tenant isolation — any authenticated user of any org sees every AI-applied patch's full file contents/diffs. `_loadPatchHistory()` reads a single global JSON file with no per-account/org field. Forged `?workspaceId=nonexistent-forged-id` query param has no effect (route never reads it) — confirms the earlier finding pattern: forged params can't widen access on a route that never consults them, but the underlying absence of scoping is the real defect.

## 5 · Real AI success — live, twice

```
curl -b cookiesA.txt -X POST /jarvis -d '{"input":"hello"}'
-> HTTP 200 {"success":true,"reply":"Hello. How can I assist you today?","intent":"greeting",
             "action":"ai_reply","mode":"intelligence",
             "data":{"provider":"groq","model":"llama-3.3-70b-versatile","cached":false}}

data/prompt-history.ndjson (last line):
{"id":"ph-1786738740730-0b6v","accountId":"452db4fc98d8cd8320de1642","orgId":"org_1786728345592_1",
 "workspaceId":"default","provider":"groq","model":"llama-3.3-70b-versatile","prompt":"hello",
 "response":"Hello. How can I assist you today?","latencyMs":913,"estimatedCostUsd":0.000001}
```
This is a genuine, live, successful AI completion — real provider, real model, real cost, real latency — not fabricated. Correctly attributed to Org A's real `orgId` (only after the `/jarvis` `attachOrg` fix below — prior to the fix this field would have been `null`).

## 6 · `/jarvis` missing `attachOrg` — before/after

```
BEFORE fix (verified by source read — jarvis.js had only requireAuth, rateLimiter, requireUsageQuota):
  req.org was always undefined on this route -> every promptHistory entry from the main chat
  surface would be written with orgId:null, regardless of caller's real org.

AFTER fix (attachOrg mounted, matching the already-existing B.14 fix on /ai/chat):
  Real /jarvis "hello" call -> prompt-history.ndjson entry shows orgId:"org_1786728345592_1" (Org A's real org)
```

## 7 · AI History tenant isolation — real data, both directions

```
curl -b cookiesA.txt /ai-ecosystem/history/me
  -> {"ok":true,"entries":[{"...", "prompt":"hello", "response":"Hello. How can I assist you today?", ...}]}
curl -b cookiesB.txt /ai-ecosystem/history/me
  -> {"ok":true,"entries":[]}
```
A sees exactly their own real conversation; B sees nothing of A's. Self-scoped by `accountId` from the JWT — a forged `?orgId=<orgA>` query param on B's request was confirmed to have no effect (route ignores it).

```
Direct service-level test (bypassing HTTP):
promptHistory.record({orgId:A, prompt:'C9-HISTORY-TEST-A-MARKER', ...})
promptHistory.record({orgId:B, prompt:'C9-HISTORY-TEST-B-MARKER', ...})
promptHistory.query({orgId:A}) -> only A's marker
promptHistory.query({orgId:B}) -> only B's marker
```

## 8 · Real cost data — before/after the AICostCenter fix

```
BEFORE (source): PROVIDERS = [{ id:"openrouter", models:[{name:"claude-3-haiku", requests:1840,
                  tokens:2_180_000, cost:1.09, rpm:60}, ...] }, ...]   <- fully hardcoded, rendered as live

AFTER — real endpoint added and wired:
curl -b cookiesA.txt /analytics/ai-cost
  -> {"ok":true,"totalRequests":2,"totalTokens":11,"totalCostUsd":0.000001,"errors":1,
      "successRate":0.5,"avgLatencyMs":459,"p50LatencyMs":913,"p95LatencyMs":913,
      "byProvider":[{"key":"groq","requests":1,"tokens":11,"costUsd":0.000001,"errors":0},
                     {"key":"ollama","requests":1,"tokens":0,"costUsd":0,"errors":1}]}
```
Real, live, honest data — 1 real success (groq), 1 real failure (ollama), correct per-provider breakdown, correct error count.

**Live browser verification (Playwright, real authenticated session, both zero-usage and real-usage states):**
```
Fresh org, before any AI calls:
  "AI Cost Management" / "Active: groq" / "$0.000000" / "0" requests / "0" tokens / "100%" success
  / "No AI usage recorded yet. Cost, token, and request totals will appear here once your account makes AI calls."
  fabricated-marker scan (claude-3-haiku, 2,180,000, $2.69, 17% of Qwen) -> NONE FOUND

Org A, after the real groq success + real ollama failure above:
  "1 req" / "11" tokens / "$0.000001" (groq row) ; "1 req" / "0" tokens / "$0.000000" (ollama row)
  "Errors recorded: 1 · Credits consumed: 0"
```
Both the honest-zero state and the honest-real-data state render correctly, live, in the actual built frontend — not just at the API layer.

## 9 · Live AI Chat UI — accessibility, loading, error honesty

```
Playwright, real authenticated session, real browser:
  input aria-label: "Message Ooplix"  (stable name despite dynamic placeholder — prior C.1 fix, still true)
  send button aria-label: "Send message"
  keyboard Enter submits: confirmed
  focus works: document.activeElement === input, confirmed

Submit "hello, respond briefly please" under live credential-blocked conditions:
  t+2000ms: input disabled=true   (loading state, placeholder -> "Ooplix is responding…")
  t+4014ms: input disabled=false  (settled)
  final UI state: "✕ Error" / "AI backend unavailable. Check provider API keys in your .env file."
```
No infinite loading. No fake success. The real, specific backend error message reaches the user, not a generic "Something went wrong" — matching the honesty already confirmed at the API layer.

## 10 · Production build

```
CI=true npm run build -> success, 0 errors, 0 warnings from any C.9-touched file
poisoned API URL scan: 1 hit, inspected -> a placeholder example string in a DevOps tool's
  input field ("healthUrl (e.g. http://localhost:5050/health)") — not a hardcoded production
  API base URL. PASS.
stale chunk check: index.html's referenced main.[hash].js exists on disk. PASS.
AICostCenter chunk present in build output. PASS.
artifact integrity: 7.3M, 323 files, 0 .bak/.tmp files. PASS.
Live Playwright pass over AI Chat + AI Costs surfaces (post-build): 0 pageerrors,
  2 console 404s (pre-existing /coding/context, unrelated to C.9, degrades honestly via .catch(()=>{})).
```

## 11 · Regression

```
npm run test:runtime (before C.9 changes): 144 tests, 50 suites, pass 144, fail 0, skipped 0
npm run test:runtime (after C.9 changes + new negative-test file):
  176 tests, 54 suites, pass 176, fail 0, skipped 0

New file: tests/runtime/09-c9-ai-experience-honesty.test.cjs (32 new tests)
  - cross-router middleware scoping (all 9 files, both attachWorkspace and requireWorkspaceMember)
  - AICostCenter fabricated-data absence + real-endpoint usage + honest empty state + example labeling
  - /jarvis attachOrg presence
  - genuine-gap tests that assert the UNFIXED gaps (missionMemory orgId absence, patch-history
    unscoped read) remain honestly documented, not silently patched over

Negative-test self-check: temporarily reverted security.js's fix, re-ran the new test file ->
  2 tests correctly FAILED with the exact expected messages, confirming the regression suite
  actually catches the bug if reintroduced. Reverted back, re-ran full suite -> 176/176 pass again.
```
