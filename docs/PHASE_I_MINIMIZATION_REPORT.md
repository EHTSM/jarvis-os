# Phase I: Runtime Minimization & Attack Surface Reduction
**Generated:** 2026-05-15

---

## Summary

Phase I removed unsafe legacy execution paths, gated previously open internal routes, disabled autonomous agent creation, added a CI enforcement check, and improved SSE session reliability. No new features were added. The goal was deletion, simplification, and hardening only.

---

## Deleted / Disabled Systems

| System | Before Phase I | After Phase I |
|---|---|---|
| `agents/terminalAgent.cjs` execution | `child_process.exec()` with shell | `safe-exec.js` — `spawn(shell:false)`, allowlist, env sanitization |
| `POST /agents/dynamic/create` | Creates agent files at runtime via HTTP | Returns **410 Gone** — disabled permanently |
| `POST /agents/500/start-learning` | Activates continuous autonomous learning | Returns **410 Gone** — disabled permanently |
| `execSync` in `agentFactory.cjs` | Dead import — never called | Removed |
| `/ops`, `/stats`, `/metrics` | Unauthenticated | Gated behind `requireAuth` + `operatorAudit` |
| Legacy routes (`/agents/*`, `/evolution/*`, `/voice/*`, `/desktop/*`, etc.) | Unauthenticated | Gated behind `requireAuth` + `operatorAudit` |
| `voiceAgent.getAvailableVoices()` | Calls `execAsync` without platform guard | Platform guard added — skips exec on non-macOS |
| SSE session — JWT expiry | Silent — stream dies without warning | `jwt_expiry_warning` event fired 5 min before expiry |
| Frontend — JWT expiry | No banner | Warning banner shown; dismiss or sign-out options |
| CI check for raw exec | None | `npm run security:no-raw-exec` — fails on any new `exec()` or `execSync()` in `backend/` or `agents/` |

---

## Remaining Runtime Graph

```
Operator (HTTP/browser)
        │
        ▼
  nginx:443
  (HSTS, CSP, rate-limit 30r/s)
        │
        ▼
  Node.js:5050
  ├── requestId middleware   → x-request-id on every request
  ├── requestLogger          → method path status ms ip [rid]
  ├── requireAuth            → JWT cookie validation
  ├── rateLimiter            → per-IP sliding window
  ├── operatorAudit          → NDJSON to data/logs/operator-audit.ndjson
  │
  ├── /auth/*                → scrypt verify + JWT sign
  │
  ├── /ops, /stats, /metrics → requireAuth + operatorAudit (NEW in Phase I)
  │
  ├── /runtime/*             → requireAuth (unchanged)
  │        │
  │        └── /runtime/dispatch → toolAgent.cjs
  │                    │
  │                    └── terminalExecutionAdapter.cjs
  │                              spawn(shell:false) + sandboxPolicyEngine
  │
  ├── /jarvis                → AI pipeline (rate-limited)
  │
  └── /legacy/*              → requireAuth + operatorAudit (NEW in Phase I)
           (agents, evolution, voice, desktop — informational only)
```

---

## Execution Flow Diagram (Single Pipeline)

```
Before Phase I — two terminal paths:

  /runtime/dispatch ──→ toolAgent.cjs ──→ terminalExecutionAdapter.cjs
                                                  │
                                          spawn(shell:false) ← SAFE

  /legacy/parse-command ──→ terminalAgent.cjs ──→ exec(shell:true) ← UNSAFE


After Phase I — one safe path:

  /runtime/dispatch ──→ toolAgent.cjs ──→ terminalExecutionAdapter.cjs
                                                  │
                                          spawn(shell:false)

  /legacy/parse-command ──→ terminalAgent.cjs ──→ safe-exec.run()
                                                  │
                                          spawn(shell:false)
```

Both paths now converge on `spawn(shell:false)`. Shell injection via either entry point is no longer possible.

---

## Security Delta from Phase H

| Finding | Phase H Status | Phase I Status |
|---|---|---|
| `terminalAgent.cjs` uses `exec()` (shell) | P1 — Legacy, not on operator routes | **FIXED** — migrated to `safe-exec.js` |
| `/ops`, `/stats`, `/metrics` unauthenticated | P1 — Exposes system internals | **FIXED** — `requireAuth` + audit log |
| Legacy routes unauthenticated | P1 — `/agents/*`, `/evolution/*`, etc. | **FIXED** — `requireAuth` + audit log on all legacy |
| SSE expiry at 8h silent | P1 — No reconnect banner | **FIXED** — `jwt_expiry_warning` event + frontend banner |
| No audit log for operator actions | P3 — No record of who dispatched what | **FIXED** — `data/logs/operator-audit.ndjson` |
| Dynamic agent creation via HTTP | P2 — `POST /agents/dynamic/create` | **FIXED** — returns 410 Gone |
| Autonomous continuous learning | P2 — `POST /agents/500/start-learning` | **FIXED** — returns 410 Gone |
| No CI check for raw exec | P2 — No enforcement gate | **FIXED** — `npm run security:no-raw-exec` |

### Remaining Risks After Phase I

| Risk | Severity | Status |
|---|---|---|
| `agents/dev/versionControlAgent.cjs` uses `execSync` | P2 | Exempt — not on any HTTP route. Migrate in Phase J if needed. |
| `agents/voiceAgent.cjs` uses `execAsync` | P3 | Platform-gated (macOS-only, false on VPS). Exempt. |
| `agents/primitives.cjs` uses `exec` | P3 | Desktop-only with headless guard. Exempt. |
| CSP `unsafe-inline` in nginx | P3 | CRA build requires it. Tighten after build audit. |
| `data/logs/execution.ndjson` grows indefinitely | P2 | No rotation. Add log rotation to `execLog.cjs`. |

---

## New Files Created

| File | Purpose |
|---|---|
| `backend/middleware/operatorAudit.js` | NDJSON audit log — one line per authenticated operator request |
| `scripts/check-no-raw-exec.cjs` | CI scanner — fails if `exec()` or `execSync()` found in `backend/` or `agents/` outside exempt list |

## Modified Files

| File | Change |
|---|---|
| `agents/terminalAgent.cjs` | Complete rewrite — replaced `exec()` with `safe-exec.run()` |
| `agents/agentFactory.cjs` | Removed dead `execSync` import |
| `agents/voiceAgent.cjs` | Added platform guard to `getAvailableVoices()` |
| `backend/routes/ops.js` | Added `requireAuth` + `operatorAudit` gate on `/ops`, `/stats`, `/metrics`, `/dashboard/revenue` |
| `backend/routes/legacy.js` | Added `requireAuth` + `operatorAudit` gate on all legacy routes; disabled `POST /agents/dynamic/create` and `POST /agents/500/start-learning` (410) |
| `agents/runtime/runtimeStream.cjs` | Schedules `jwt_expiry_warning` SSE event 5 min before token expiry |
| `frontend/src/components/operator/OperatorConsole.jsx` | Listens for `jwt_expiry_warning`, shows dismissable warning banner |
| `package.json` | Added `security:no-raw-exec` script |

---

## CI Enforcement

```bash
# Run manually
npm run security:no-raw-exec

# Add to CI pipeline (.github/workflows/ci.yml example):
# - run: npm run security:no-raw-exec
```

**Scope:** Scans `backend/` and `agents/` (525 production files).
**Exempt (8 files):** `safe-exec.js` (canonical), 3 runtime spawn adapters (already safe), `voiceAgent.cjs`, `primitives.cjs`, `textToSpeech.cjs`, `versionControlAgent.cjs` (all non-operator, documented reasons).
**Verdict:** PASS — 0 raw exec violations in production code.

---

## Deployment Readiness Score: 9.0 / 10

| Category | Phase H | Phase I | Change |
|---|---|---|---|
| Auth architecture | 8/10 | 8/10 | — |
| VPS runtime | 9/10 | 9/10 | — |
| Nginx + HTTPS | 9/10 | 9/10 | — |
| Session stability | 9/10 | 9/10 | — (SSE expiry warning added) |
| Failure handling | 9/10 | 9/10 | — |
| Deployment tooling | 9/10 | 9/10 | — |
| Security posture | 8/10 | 9/10 | +1 (exec migration, auth on /ops, audit log, CI check) |
| Operator UX | 7/10 | 8/10 | +1 (expiry banner, audit trail) |
| Documentation | 9/10 | 9/10 | — |
| **Overall** | **8.0/10** | **9.0/10** | **+1.0** |

---

## Operational Complexity Reduction

| Metric | Before Phase I | After Phase I |
|---|---|---|
| Terminal execution paths | 2 (exec shell + spawn) | 1 (spawn only via safe-exec) |
| Unauthenticated internal routes | 5 (`/ops`, `/stats`, `/metrics`, all legacy) | 3 (`/health`, `/test`, `/api/status` — intentionally open) |
| Dynamic agent creation via HTTP | Enabled | Disabled |
| Autonomous continuous learning | Enabled | Disabled |
| Audit trail | None | NDJSON per authenticated request |
| CI exec enforcement | None | `npm run security:no-raw-exec` |

**Estimated complexity reduction: ~30%** (one execution pipeline instead of two, unauthenticated surface reduced from 5+ routes to 3 intentional probes, two autonomous paths removed).

---

## Remaining Gap to 10/10

1. **Log rotation** — `data/logs/execution.ndjson` and `data/logs/operator-audit.ndjson` grow indefinitely. Add rotation to `execLog.cjs` and the audit middleware.
2. **CSP `unsafe-inline`** — tighten after auditing CRA build chunk loaders.
3. **`versionControlAgent.cjs`** — migrate from `execSync` to `safe-exec` to close the last exempt exec in the agents directory (low risk today, but worth doing for completeness).
