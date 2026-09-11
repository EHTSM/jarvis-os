# OS-AI-WORKSPACE — WORKFLOW EVIDENCE

**Date:** 2026-08-15 · **Server:** `localhost:5188` · **Auth:** real `POST /auth/login` sessions
only — no JWT forged, no auth bypassed. **Audit Track's server (port 5050) confirmed running
throughout, including through two of its own legitimate self-initiated restarts, verified via
`lsof`/`ps`/`curl health` before and after every process action this pass.**

**Accounts used (real, registered via `POST /accounts/register`):**

| Account | Org |
|---|---|
| `aiworkspacea@test.local` ("A") | `org_1786739931649_1` |
| `aiworkspaceb@test.local` ("B") | `org_1786739931711_2` |

---

## Chain verified

```
Frontend (App.jsx handleSend → api.js sendMessage → Chat.jsx model selector)
  → POST /jarvis (requireAuth + attachOrg + rateLimiter + billing.requireUsageQuota)
  → jarvisController.handleJarvis → _intelligencePipeline
  → aiOrchestrator.execute (fallback chain, budget check, response cache, usage ledger, prompt history)
  → aiService.js (real per-provider HTTP calls)
  → usageMetering.record / promptHistory.record (data/usage-ledger.ndjson, data/prompt-history.ndjson)
```

Parallel surface:
```
OrgAdminCenter.jsx → POST /org-ai/:orgId/ask → orgAiBrain.ask()
  → organizationService.hasPermission("use_ai") → aiOrchestrator.execute (same engine, same ledger)
```

---

## W1 — Honest credential-blocked failure (real, not fabricated)

```json
POST /jarvis  {"input":"What is 7 plus 5?"}
→ 500 {"success":false,"reply":"Something went wrong. Please try again.",
        "error":"AI backend unavailable. Check provider API keys in your .env file.","traceId":"..."}
```

### Ground truth — GET /ai/status

```
groq:     configured=true, lastFailure="Request failed with status code 429" (rate-limited)
openai:   configured=true, lastFailure="Request failed with status code 401" (invalid credential)
ollama:   configured=true, lastFailure="Request failed with status code 404" (not running)
lmstudio: configured=true, lastFailure="LM Studio not reachable at localhost:1234"
```
Classified honestly: groq = rate-limited (real, transient), openai = CREDENTIAL BLOCKED,
ollama/lmstudio = ENVIRONMENT BLOCKED. No credentials invented, `.env` never touched.

### Ground truth — raw usage ledger

```
{"provider":"ollama","success":false,"errorCode":"All AI providers failed — check your API keys."}
{"provider":"groq","success":false,...}
{"provider":"openai","success":false,...}
{"provider":"jarvis_fallback","success":false,...}
{"provider":"jarvis","success":false,"errorCode":"AI backend unavailable...","orgId":null}  ← pre-fix
```
Every entry honestly `success:false` — no fabricated billing, no fabricated success.

---

## THE FIX — org attribution lost on 2 of 3 `/jarvis` usage-ledger recording sites

### Before (reproduction)

```
grep 'provider":"jarvis"' data/usage-ledger.ndjson | tail -5
→ orgId: None, orgId: None, orgId: None, orgId: None, orgId: None
```
Every entry, for an account with a real, verified org membership.

### Fix

```js
usageMetering.record({ accountId, orgId: req.org?.id || null, workspaceId: req.workspace?.id || undefined,
                        provider: "jarvis", model: mode, requestType: "chat", latencyMs: elapsed, success: true });
// and the identical pattern in the outer catch-all failure path
```

### Live re-verification (post-fix, real HTTP, real org)

```
POST /jarvis {"input":"I want to buy your product, what is the price?"}  (sales mode, real org A)
→ ledger: {"provider":"jarvis","orgId":"org_1786739931649_1","success":true,"model":"sales"}

POST /jarvis {"input":"Explain quantum computing..."}  (forces the outer catch — AI down)
→ ledger: {"provider":"jarvis","orgId":"org_1786739931649_1","success":false}
```
Both previously-broken recording sites confirmed fixed with real org attribution.

---

## THE FIX — response cache had no tenant dimension

### Unit-level reproduction (pre-fix, direct service call)

```js
cache.set('groq','llama-3.3-70b', messages, 0.7, {text:'A-secret-response'});
cache.get('groq','llama-3.3-70b', messages, 0.7)  // called as "account B"
→ {"text":"A-secret-response","cached":true,"cacheHits":1}   // B genuinely received A's content
```

### Fix

```js
function _key(provider, model, messages, temperature, tenantKey = "") {
  const payload = JSON.stringify({ provider, model, temperature, messages, tenantKey });
  return crypto.createHash("sha256").update(payload).digest("hex");
}
```
`aiOrchestrator.execute()` now derives `tenantKey = opts.accountId || opts.orgId || ""` and passes
it through both `responseCache.get()` and `.set()`.

### Post-fix verification

```js
cache.set('groq','llama-3.3-70b', messages, 0.7, {text:'tenant-A-secret'}, undefined, 'accountA');
cache.get('groq','llama-3.3-70b', messages, 0.7, 'accountB')  →  null   (genuine miss)
cache.get('groq','llama-3.3-70b', messages, 0.7, 'accountA')  →  {text:'tenant-A-secret'}  (own hit intact)
```

---

## THE FIX — model/provider selection was completely non-functional

### Reproduction

```
frontend/src/api.js sendMessage(): POST /jarvis {input, mode, provider, model}
backend/controllers/jarvisController.js handleJarvis(): reads req.body.{input,command,message,phone,history,mode}
                                                          — provider/model NEVER read, NEVER forwarded
```
Confirmed by direct source read — no `req.body.provider`/`req.body.model` reference existed
anywhere in the file before this fix.

### Fix

```js
const provider = _clean(req.body.provider || "", 100) || undefined;
const model    = _clean(req.body.model    || "", 100) || undefined;
...
result = await _intelligencePipeline(input, history, {
  accountId, orgId: req.org?.id, workspaceId: req.workspace?.id, provider, model,
});
// _intelligencePipeline:
const result = await aiOrchestrator.execute(messages, {
  capability: "chat", accountId: ctx.accountId, orgId: ctx.orgId, workspaceId: ctx.workspaceId,
  userPref: ctx.provider || undefined, model: ctx.model || undefined,
});
```

### Live re-verification — real routing order genuinely changes

```
POST /jarvis {"input":"test A"}                                    (no explicit provider)
→ ledger order: ollama, groq, openai   (default cost-sorted chain)

POST /jarvis {"input":"test C","provider":"openai","model":"gpt-4o-mini"}
→ ledger order: openai (FIRST, ts 20:54:54.405), ollama, groq
```
`openai` moved to the front of the real attempted chain only once the field was genuinely
forwarded — proves the fix changes real behavior, not just accepts-and-ignores the field.

---

## Cross-tenant isolation — populated-data test (not empty-vs-empty)

Per the mission's explicit instruction, both tenants were seeded with real, distinguishable data
before concluding anything:

```
promptHistory.record({accountId: A, orgId: orgA, prompt: "ORG-A-SECRET-PROMPT-XYZ123", ...})
promptHistory.record({accountId: B, orgId: orgB, prompt: "ORG-B-SECRET-PROMPT-ABC456", ...})

GET /ai-ecosystem/history/me?fromLedger=true  (as A)  → only ORG-A-SECRET-PROMPT-XYZ123
GET /ai-ecosystem/history/me?fromLedger=true  (as B)  → only ORG-B-SECRET-PROMPT-ABC456
```
Zero cross-contamination in either direction.

### `/org-ai/:orgId/*` — real membership + confused-deputy header test

```
POST /org-ai/orgA/ask   (A, own org)                → passes auth layer (real 500 for AI-down, honest)
POST /org-ai/orgA/ask   (B, non-member)              → 403 "Forbidden — requires permission: use_ai"
GET  /org-ai/orgA/history (B, non-member)            → 403 "Forbidden — not a member of this organization"
GET  /org-ai/orgA/usage   (B, non-member)             → 403

# Confused-deputy test: forged X-Org-Id header disagreeing with the path param
GET /org-ai/orgB/history  (B, own org, header=orgA)  → 200, B's own org data (header ignored)
GET /org-ai/orgA/history  (B, non-member, header=orgA) → 403 (header still ignored, path param wins)
```
Path parameter is exclusively authoritative in both directions — the route's own design goal,
verified real.

---

## Persistence — verified across a real restart

```
Before restart: usage-ledger entries for account A = 30, prompt-history seeded secrets = 2
[server confirmed stopped via TaskStop, Audit Track's port 5050 confirmed untouched, restarted clean]
After restart:  usage-ledger entries for account A = 30 (intact)
                GET history/me?fromLedger=true  → still returns ORG-A-SECRET-PROMPT-XYZ123
                GET history/me (no fromLedger)   → [] (in-memory ring genuinely resets — honest,
                                                        not fabricated persistence it doesn't have)
```

### The related fix — `AIUsageDashboard.jsx` was calling the wrong (non-durable) variant

```
Before: _fetch("/ai-ecosystem/history/me?limit=20")                    → [] after any restart
After:  _fetch("/ai-ecosystem/history/me?limit=20&fromLedger=true")    → real history, always
```
Verified via direct curl with both param combinations against the same real, restart-surviving data.

---

## Build

```
CI=false npm run build:frontend → succeeds
0 poisoned test-port URLs found in the built bundle
```

## Regression

| Suite | Result |
|---|---|
| `npm run test:runtime` | **181/181** (baseline 176/176 before this pass's fixes; +5 tests are the Audit Track's own concurrent C.10 work, unaffected by and unaffecting this pass) |
| `tests/security/110-ai-workspace-org-attribution-and-cache-isolation.cjs` (new) | **16/16** |
| C.9's own 32 AI-experience tests | Still passing throughout, confirming this pass's fixes did not disturb that work |

Negative-test discipline: reverted the 3 fix files via `git stash`, confirmed 6/16 new-test
assertions fail against the pre-fix code (the other 10 are either static checks on the fixed files
themselves — correctly absent pre-fix — or unaffected control assertions), restored the fixes,
confirmed 16/16 pass.

No test was modified, skipped, or weakened.
