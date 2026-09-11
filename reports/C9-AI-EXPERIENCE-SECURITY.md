# C.9 — AI EXPERIENCE SECURITY

Date: 2026-08-14/15 · Branch: `security/reality-completion`

---

## Scope

AI-boundary security only, per the mission's explicit limit: unauthenticated AI access, cross-tenant AI history/memory, direct-ID history access, forged organization headers, tool execution authorization. No credential-bypass techniques attempted. No OS re-audited.

## Method

Two real tenants (Org A, Org B) created via the app's actual `accountService`/`organizationService` functions, logged in through the real `/auth/login` HTTP route — no invented credentials, no auth bypass, no `.env` changes.

---

## 1 · Unauthenticated AI access

```
curl -X POST /coding/ask (no cookie)          -> 401 {"error":"Unauthorized"}
curl /coding/patch-history (no cookie)         -> 401 {"error":"Unauthorized"}
curl -X POST /ai/chat (no cookie)              -> 401 {"error":"Unauthorized"}
```
**PASS.** All tested AI routes correctly reject unauthenticated requests.

## 2 · Cross-tenant AI history

```
Real successful AI call as Org A (/jarvis "hello") -> recorded with orgId:org_...592_1
GET /ai-ecosystem/history/me as Org A  -> real entry returned
GET /ai-ecosystem/history/me as Org B  -> [] (empty — correctly isolated)
```
**PASS**, live-verified with real (not synthetic) data.

## 3 · Cross-tenant AI memory/context — GENUINE GAP (documented, not fixed)

```
Mission created with a distinctive Org-A-only marker via missionMemory.createMission()
(no orgId field exists to even attach one to)
missionMemory.listMissions({limit:5}) -> Org A's marker appears with ZERO org filtering
```
`_missionContext()` (the function that injects this into any authenticated user's AI prompt via `/coding/ask`) has no way to scope this query, because the underlying data model has no `orgId` field at all. **This is a real cross-tenant AI-context exposure risk** — not fixed in this session, because the fix would require redesigning Memory OS's mission schema, which is explicitly out of this audit's scope ("Do NOT redesign Memory OS"). Fully documented, negative-tested to ensure it stays honestly surfaced rather than silently masked.

**Severity note:** the leaked context is mission *objective text* (task descriptions), not secrets/credentials/PII by default — but a founder could plausibly put sensitive business detail in a mission objective, so this is a real confidentiality concern for multi-tenant deployments, not merely a hygiene issue.

## 4 · Direct-ID AI resource access — GENUINE GAP (documented, not fixed)

```
GET /coding/patch-history as Org A  -> full patch record incl. file diffs
GET /coding/patch-history as Org B  -> IDENTICAL response
GET /coding/patch-history/:histId/export -> would export ANY patch's file archive to ANY authenticated user (no ownership check in source)
```
No per-account/org scoping exists anywhere in `/coding/*`'s patch/bundle storage (`data/ai-patch-history.json`, `repositoryEditingEngine.cjs`'s in-memory bundle store). This is a genuine IDOR-shaped gap — not fixed, because building real per-tenant storage for these two subsystems is new architecture (data-model migration), out of this audit's "verify, don't build" mandate. Documented and negative-tested.

## 5 · Forged organization headers

```
Org B sends X-Org-Id / X-Organization-Id headers set to Org A's real orgId, targeting /coding/ask
  -> no effect (route never reads org headers at all) — same failure mode as without the header
Org B sends ?workspaceId=<forged> on /coding/patch-history
  -> no effect (route never reads it either) — same global data returned regardless
Org B sends a real X-Org-Id: <orgA> header to the REAL org-gated route (/ai-ecosystem/history/workspace/:orgId)
  -> 403 "Forbidden — requires permission: manage_billing" (correctly rejected — B genuinely holds no permission in Org A)
```
**No case found where a forged/client-supplied org identity widened access.** The `/coding/*` family's gap is an *absence* of tenant checking (client input is simply never consulted, in either direction), not a *trust* of forged client input — an important distinction: fixing it means adding real scoping, not "stop trusting a header," since no header was ever trusted. The one route that does enforce real org-based authorization (`/ai-ecosystem/history/workspace/:workspaceId`, prior "Phase A.1" fix) correctly rejects a legitimate cross-org attempt.

## 6 · Tool execution authorization

```
connectorToolBridge.executeConnectorTool('list_connected_services', {}, accountA) -> {"connections":[]}
connectorToolBridge.executeConnectorTool('list_connected_services', {}, accountB) -> {"connections":[]}
  (both independently empty and correctly isolated — oauthIntegrationLayer.cjs keys its
   token store by `${provider}:${userId}`, confirmed by source read)
/ai/chat-with-tools live call as Org B -> honest 500 under credential-blocked conditions
  (chatWithTools() throws, never fakes a tool-call result)
```
**PASS.** Real per-user scoping at the OAuth token-store layer, real per-call error handling, no fake tool-execution claims possible by construction (a failed AI call throws before any tool call is even attempted).

## 7 · Cross-router middleware leak — a real, now-fixed security defect

Discovered while setting up tenant-isolation testing: `security.js`, `admin.js`, `governance.js`, `automation.js`, `analytics.js`, `extensions.js`, `marketplace.js`, `plugins.js`, `workspace.js` each registered workspace-gating middleware unscoped, causing it to leak onto every route mounted afterward in the shared barrel router (`routes/index.js`) — including all of `/coding/*` and 100+ unrelated routes across the application. While the practical effect observed was an over-broad **403** (denying legitimate access, not granting unauthorized access), this is still a genuine defect in the security-middleware layer: it made authorization behavior for dozens of unrelated routes depend on an accident of file-mount order rather than each route's own intended policy, which is exactly the class of fragility a deliberate security fix should not introduce. Root-caused to commit `58cf1032`. Fixed by scoping all 9 files' registrations to their own path prefix. Live-verified cleared. Negative-tested (temporarily reverted and confirmed the new regression suite catches it).

## Constraint compliance

| Constraint | Status |
|---|---|
| `.env` not modified | **HELD** — verified repeatedly throughout, 0 changes |
| No credential bypass attempted | **HELD** |
| No secrets printed | **HELD** |
| Auth architecture not modified | **HELD** — no changes to `authMiddleware.js`, `orgMiddleware.cjs`, or `workspaceMiddleware.cjs` logic itself, only path-scoping of existing middleware calls in route files |
| Memory OS not redesigned | **HELD** — gap documented, not fixed |
| Only genuine AI-experience defects fixed | **HELD** — the cross-router leak was fixed because it directly blocked AI-route testing and is a real regression from a prior security fix; documented explicitly as cross-cutting, not claimed as AI-native |

## Conclusion

**2 real security-relevant AI-boundary gaps found and fixed** (cross-router middleware leak; `/jarvis` missing org attribution). **2 real security-relevant gaps found and honestly documented as unfixed** (mission-context cross-tenant exposure; `/coding/*` patch/bundle IDOR) — both require new architecture (Memory OS schema redesign; per-tenant patch storage) that this audit's mandate explicitly excludes. **0 cases found of forged client input widening access.** All fixes negative-tested and live-verified with real two-tenant data, not synthetic assertions alone.
