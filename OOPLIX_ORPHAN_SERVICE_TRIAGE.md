# OOPLIX ORPHAN SERVICE TRIAGE
**Phase C.1 Part 8**

Date: 2026-08-13

---

## HEADLINE: Phase C.0's finding was wrong. There are ZERO orphaned services.

Phase C.0 reported 5 services referenced by nothing:
```
aiResponseCache.cjs, capabilityContract.cjs, departmentTemplateRegistry.cjs,
sentryService.cjs, templateInferenceEngine.cjs
```

**All five are referenced.** Re-measured with corrected detection: **0 orphans out of 405 services.**

### Why C.0 was wrong

The C.0 detector matched only path-style requires:
```js
require("../services/aiResponseCache.cjs")   // ← matched
```
It missed relative sibling requires **between services in the same directory**:
```js
require("./aiResponseCache.cjs")             // ← MISSED
```

Since services import each other far more often than routes import them, the regex systematically under-counted. Corrected detection (substring reference count across `backend`, `agents`, `electron`, `frontend/src`, `scripts`, `tests`, excluding each file's own source) finds every service referenced.

---

## Per-service findings

### 1. `aiResponseCache.cjs` — 92 LOC — **WIRED, NOT ORPHANED**
**Consumer:** [aiOrchestrator.cjs:36](backend/services/aiOrchestrator.cjs#L36) — `const responseCache = require("./aiResponseCache.cjs");`
Exact-match caching for chat completions (provider + model + messages + temperature). Header comment records the motivation: every identical repeated request previously re-hit the provider API and re-incurred real cost.
Exports: `get`, `set`, `clear`, `stats`, `DEFAULT_TTL_MS`. Last touched 2026-07-18.
**Verdict: KEEP — actively wired, in-memory by design.**

### 2. `capabilityContract.cjs` — 358 LOC — **6 consumers**
Universal Composition Engine Phase 1. Pure schema/validation for every entity kind in the composition chain (Company Factory → Department Factory → Agent Factory → Skill Registry → Tool Fabric → Connector Registry).
Exports: `KINDS`, `listKinds`, `validate`, `validateBlueprint`, `FORBIDDEN_SECRET_FIELDS`. Last touched 2026-07-24.
**Verdict: KEEP — infrastructure with real consumers.** `FORBIDDEN_SECRET_FIELDS` suggests a security role worth confirming is enforced.

### 3. `departmentTemplateRegistry.cjs` — 504 LOC — **6 consumers**
100-COMPANY P1 Phase 3. Data-driven registry of 32 department families; each template declares required agent archetypes by real capability tag from `agents/runtime/agentRegistry.cjs`.
Exports: `listTemplates`, `getTemplate`, `isComposableNow`, `composeDepartment`, `deriveDepartmentsForTemplate`. Last touched 2026-07-25.
**Verdict: KEEP — wired composition infrastructure.**

### 4. `sentryService.cjs` — 198 LOC — **INTENTIONALLY DORMANT**
Crash reporting via Sentry's HTTP Envelope API (no SDK dependency). Exports `isConfigured`, `captureException`, `captureMessage`, `createRelease`, `verifyDelivery`. Last touched 2026-06-22.
**`SENTRY_DSN` is MISSING from the environment**, so `isConfigured()` returns false and the service correctly no-ops.
**Verdict: DORMANT BY DESIGN — credential-gated, not dead.** Recovery is a provisioning decision (set `SENTRY_DSN`), not an engineering one. Worth a deliberate call: the platform currently has **no crash reporting in production**.

### 5. `templateInferenceEngine.cjs` — 408 LOC — **1 consumer**
Universal Composition Engine Completion Gaps Phase 2. Its header explicitly states it fixes a confirmed problem documented in `docs/audits/UNIVERSAL-COMPOSITION-ENGINE-REALITY.md` §6/§9 — that `businessTemplateEngine.cjs`'s `inferTemplate()` was inadequate.
Exports: `analyzeCompanyDefinition`, `DIMENSION_RULES`, `DIMENSION_CAPABILITY_TO_DEPARTMENTS`. Last touched 2026-07-24.
**Verdict: KEEP — only 1 consumer; verify that consumer is itself reachable.** Lowest-connectivity service of the five and the only one warranting follow-up.

---

## Summary

| Service | LOC | Consumers | Verdict |
|---|---:|---:|---|
| `aiResponseCache.cjs` | 92 | 1 (aiOrchestrator) | KEEP — wired |
| `capabilityContract.cjs` | 358 | 6 | KEEP — wired |
| `departmentTemplateRegistry.cjs` | 504 | 6 | KEEP — wired |
| `sentryService.cjs` | 198 | credential-gated | DORMANT BY DESIGN |
| `templateInferenceEngine.cjs` | 408 | 1 | KEEP — verify consumer reachability |

**No service should be wired or deleted. Nothing was.**

The only actionable item is a decision, not a code change: **should `SENTRY_DSN` be provisioned so production crash reporting is live?** That belongs in credential provisioning, not development.

---

## Methodological note

This correction matters beyond these five files. Phase C.0 asserted "400/405 services wired (98.8%)" — the true figure is **405/405 (100%)**. A static-analysis false positive produced five phantom findings that, unchallenged, could have led to wiring work on already-wired modules or deletion of live infrastructure.

**Static analysis produced a wrong answer; checking the actual require statements produced the right one.**
