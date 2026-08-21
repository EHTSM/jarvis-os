# OS-AI-WORKSPACE — SECURITY REPORT

**Date:** 2026-08-15 · **Server:** `localhost:5188` (isolated verification server, this session's
own process) · **Audit Track's own server (port 5050) confirmed running throughout — including two
of its own legitimate self-initiated restarts (PID 79223 → 18045 → 26024), each independently
verified healthy before this session continued. No action targeting port 5050 or any of its PIDs
was ever issued by this session.**

No JWT was ever forged. No authentication middleware was ever bypassed or disabled. No credentials
were guessed or invented. `.env` was never modified. All sessions used real `POST /auth/login`
responses against real registered accounts.

---

## 1. Unauthenticated access

| Endpoint | Method | Result |
|---|---|---|
| `/jarvis` | POST | **401** |
| `/ai/chat` | POST | **401** (pre-existing, re-verified) |
| `/ai/status` | GET | **401** |
| `/org-ai/:orgId/ask` | POST | **401** |
| `/org-ai/:orgId/history` | GET | **401** |
| `/ai-ecosystem/history/me` | GET | **401** |

All 6 tested endpoints reject unauthenticated requests.

---

## 2. Cross-tenant isolation — populated-data battery (not empty-vs-empty)

Per the mission's explicit instruction, both tenants were seeded with real, distinguishable secret
strings before any conclusion was drawn.

| Test | Actor | Target | Result |
|---|---|---|---|
| Read own prompt history | A | own | **200**, correct entry |
| Read own prompt history | B | own | **200**, correct (different) entry |
| Cross-read via `history/me` (server-derived accountId, no way to address another account) | — | — | **N/A by design** — the route has no id parameter to attack; verified the response only ever reflects the authenticated session's own account |
| `/org-ai/:orgId/ask` in own org | A | org A | Passes auth layer (real 500 for AI-down — honest, not a security result) |
| `/org-ai/:orgId/ask` in foreign org | B | org A | **403** `Forbidden — requires permission: use_ai` |
| `/org-ai/:orgId/history` foreign org | B | org A | **403** `Forbidden — not a member of this organization` |
| `/org-ai/:orgId/usage` foreign org | B | org A | **403** |
| Forged `X-Org-Id` header disagreeing with path param, header = foreign org caller IS member of, path = own org | B | own org (path) | **200**, header ignored, path org's data returned |
| Forged `X-Org-Id` header = foreign org, path = same foreign org (both agree, but caller isn't a member) | B | org A | **403** — header cannot upgrade access even when it agrees with the (still foreign) path |
| Response-cache cross-tenant read | tenant B | tenant A's cached entry | **Was a real leak — see Finding 2 below. Fixed.** |

**Cross-tenant isolation: 8/9 boundaries clean on first measurement; 9/9 after the cache fix.**

---

## 3. FINDING 1 — model/provider selection silently ignored (P1 — broken core workflow)

### Root cause

`jarvisController.js`'s `handleJarvis()` never read `req.body.provider`/`req.body.model`, and never
forwarded them into `_intelligencePipeline()` → `aiOrchestrator.execute()`. The frontend
(`Chat.jsx`'s `MODELS` selector, `api.js`'s `sendMessage()`) has always sent both fields — they were
silently dropped on the server, so the UI control had no effect on which model actually answered.

### Before

```js
async function handleJarvis(req, res) {
    const input = _clean(req.body.input || req.body.command || req.body.message || "");
    // ...no req.body.provider / req.body.model anywhere in the file
    result = await _intelligencePipeline(input, history, { accountId, orgId: req.org?.id, workspaceId: req.workspace?.id });
```

### Fix

```js
const provider = _clean(req.body.provider || "", 100) || undefined;
const model    = _clean(req.body.model    || "", 100) || undefined;
result = await _intelligencePipeline(input, history, { accountId, orgId: req.org?.id, workspaceId: req.workspace?.id, provider, model });
// _intelligencePipeline:
const result = await aiOrchestrator.execute(messages, {
  capability: "chat", accountId: ctx.accountId, orgId: ctx.orgId, workspaceId: ctx.workspaceId,
  userPref: ctx.provider || undefined, model: ctx.model || undefined,
});
```

### Negative test

`tests/security/110-ai-workspace-org-attribution-and-cache-isolation.cjs` — static assertions on
the fixed source, confirmed absent pre-fix via `git stash` reproduction (4/4 Defect-3 static
assertions failed against the reverted file).

### Live verification

Real HTTP requests with and without an explicit `provider` field, compared via real usage-ledger
timestamps: the explicit-provider request attempted `openai` first (ts `20:54:54.405`); the default
request always started with `ollama`. Confirms genuine behavior change, not a no-op field.

---

## 4. FINDING 2 — response cache had no tenant dimension (P1 — cross-tenant content sharing)

### Root cause

`aiResponseCache.cjs`'s cache key was `sha256(provider + model + temperature + JSON(messages))` —
no account/org component. Two different tenants sending the exact same prompt text within the
5-minute TTL would receive the identical cached response object, including whichever tenant's
request generated it. Because `aiOrchestrator.execute()` returns immediately on a cache hit (before
`usageMetering.record()`/`promptHistory.record()` run), **neither tenant's own usage/history ledger
ever recorded that the sharing happened** — it was invisible from both sides.

### Reproduction

```js
cache.set('groq','llama-3.3-70b', messages, 0.7, {text:'A-secret-response'});
cache.get('groq','llama-3.3-70b', messages, 0.7)   // as "tenant B"
→ {"text":"A-secret-response","cached":true,"cacheHits":1}
```

### Fix

```js
function _key(provider, model, messages, temperature, tenantKey = "") {
  const payload = JSON.stringify({ provider, model, temperature, messages, tenantKey });
  return crypto.createHash("sha256").update(payload).digest("hex");
}
```
`aiOrchestrator.execute()` derives `tenantKey = opts.accountId || opts.orgId || ""` and passes it
through both cache calls. Two members of the same org still each get their own cache entry
(accountId is the tighter boundary), matching `promptHistory`'s own self-scoping convention.

### Negative test

Unit-level: pre-fix reproduction (above) confirmed the leak; post-fix, the identical lookup with a
different `tenantKey` returns a genuine miss (`null`), while the same tenant re-asking still gets
its own real hit — proving the fix closes the leak without breaking caching itself. An unscoped
caller (no tenantKey) was also verified to get its own independent, correctly-isolated slot.

### Live verification

Could not be reproduced end-to-end over real HTTP in this environment (requires a real successful
provider call to populate the cache, and all providers are credential/rate-limit blocked — see
`/ai/status` in the Workflow Evidence report). Verified at the unit level (the actual code path that
runs regardless of provider availability) and via static confirmation that `aiOrchestrator.execute`
genuinely wires the tenant key through both call sites.

---

## 5. FINDING 3 — usage-ledger org attribution lost (P2 — reporting correctness, not a leak)

Two of three `/jarvis` usage-ledger recording sites never forwarded `req.org?.id`/
`req.workspace?.id`. Not a security boundary violation (no cross-tenant data was ever exposed — the
records were simply mis-attributed to no organization at all), but real: org-level AI spend/failure
dashboards would silently undercount for any `sales`/`execution`-mode or total-failure request.
Fixed identically to Findings 1/2's pattern — full detail and live verification in the Workflow
Evidence report.

---

## 6. Documented, not fixed — prompt/context injection boundary

`history` arrays supplied by the client are spread directly into the messages sent to AI providers,
with no validation that entries carry only `role:"user"`/`role:"assistant"`. A client can inject a
`role:"system"` message that becomes the *only* system framing if the server doesn't independently
add its own (which it only does for a narrow upsell-intent case). This is a real prompt-injection
surface, but its blast radius is limited to the caller manipulating their own conversation — it does
not cross any tenant boundary, does not touch auth, and does not expose another account's data.
Closing it properly requires a product decision on system-role-message policy (strip client-supplied
system messages entirely? cap how many? never trust client history as authoritative?) that this
pass's minimal-recovery mandate does not extend to. Documented here so it stays honestly surfaced.

---

## 7. Forged header tests

| Header | Value | Result |
|---|---|---|
| `X-Org-Id` | forged, disagreeing with `/org-ai/:orgId/*`'s path param | No effect in either direction — path param is exclusively authoritative (see §2) |
| Manually crafted session cookie with altered payload | — | **401** — signature verification rejects it (rejection test, no forging occurred) |

---

## 8. Summary

| Category | Result |
|---|---|
| Unauthenticated access | 0 leaks / 6 tested |
| Cross-tenant isolation (populated data) | 1 found (cache), fixed, negative-tested; 8/9 clean pre-fix, 9/9 post-fix |
| Forged headers | 0 effective / 2 tested |
| Broken core workflow (non-security but user-facing) | 1 found (model selection), fixed |
| Reporting-correctness defect | 1 found (org attribution), fixed |
| Documented, not fixed | 1 (system-role prompt injection — real but scoped to the user's own session, requires a product policy decision out of this pass's scope) |
| Data integrity after all attacks | Unchanged, verified |

**Tenant isolation: 9/9** discrete boundary tests pass after this pass's one fix (cache tenant
key); 8/9 were already correct.
