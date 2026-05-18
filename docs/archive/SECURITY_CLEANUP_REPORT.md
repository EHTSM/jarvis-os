> [!WARNING]
> ARCHIVED / LEGACY / NOT ACTIVE PRODUCTION RUNTIME
> This document describes historical or experimental architecture that is not part of the active Jarvis production core.

# SECURITY CLEANUP REPORT
Phase M — Security Cleanup + Frontend Maturity  
Date: 2026-05-16

---

## EXECUTIVE SUMMARY

Phase M hardened all business-critical write routes from optional/missing auth to mandatory
operator-only access with audit logging. Three distinct attack surfaces were closed:
CRM data exposure, simulation workflow abuse, and residual evolution endpoint discovery.

All changes verified against the 40-test regression suite (40/40 pass) and with live
token-based endpoint probing.

---

## TASK A — CRM ROUTE SECURITY

### Before

| Route | Auth | Notes |
|-------|------|-------|
| `GET /crm` | `optionalAuth` | Returns all leads unauthenticated |
| `GET /crm-leads` | `optionalAuth` | Duplicate endpoint, same exposure |
| `POST /crm/lead` | `optionalAuth` | Unauthenticated lead creation |
| `PATCH /crm/lead/:phone` | `optionalAuth` | Unauthenticated lead mutation |

`optionalAuth` populated `req.user` if a token was present but did NOT reject unauthenticated
requests. Any unauthenticated caller could read all CRM leads and create/modify records.

### After

All four routes now use `requireAuth, operatorOnly, (operatorAudit on writes)`:

```js
router.get("/crm",              requireAuth, operatorOnly, handler);
router.get("/crm-leads",        requireAuth, operatorOnly, handler);
router.post("/crm/lead",        requireAuth, operatorOnly, operatorAudit, handler);
router.patch("/crm/lead/:phone",requireAuth, operatorOnly, operatorAudit, handler);
```

**New middleware: `operatorOnly`** — checks `req.user.role === "operator"` after `requireAuth`
populates `req.user`. Returns 403 if role is not operator. Added to `authMiddleware.js`.

**New middleware: `operatorAudit`** — fire-and-forget `fs.appendFile` to
`data/logs/operator-audit.ndjson`. Logs: timestamp, method, path, operator sub, IP.

### Verification

```
GET  /crm          unauthenticated → 401 ✓
GET  /crm-leads    unauthenticated → 401 ✓
POST /crm/lead     unauthenticated → 401 ✓
GET  /crm          operator token  → 200 ✓
GET  /crm-leads    operator token  → 200 ✓
```

---

## TASK B — SIMULATION ROUTE LOCKDOWN

### Before

| Route | Auth | Notes |
|-------|------|-------|
| `POST /send-followup` | None | Executes WhatsApp sends unauthenticated |
| `POST /simulate/full-flow` | None | Runs full lead → payment pipeline unauthenticated |

Both routes were fully public. Any external caller knowing the URL could trigger WhatsApp
messages and run the business pipeline.

### After

```js
router.post("/send-followup",      requireAuth, operatorOnly, operatorAudit, handler);
router.post("/simulate/full-flow", requireAuth, operatorOnly, operatorAudit, handler);
```

### Verification

```
POST /send-followup      unauthenticated → 401 ✓
POST /simulate/full-flow unauthenticated → 401 ✓
POST /simulate/full-flow operator token  → 200 ✓
```

---

## TASK C — EVOLUTION SYSTEM DECOMMISSION

The evolution/self-improve routes in `legacy.js` were behind `requireAuth` but remained
callable. Seven routes replaced with HTTP 410 Gone.

### Routes → 410

```
GET  /evolution/score
GET  /evolution/approvals
POST /evolution/approve/:id
POST /evolution/reject/:id
GET  /evolution/suggestions
GET  /self-improve/analyze
GET  /self-improve/evaluation
```

### Verification (authenticated operator token)

```
GET /evolution/score        → 410 ✓
GET /evolution/suggestions  → 410 ✓
POST /evolution/approve/1   → 410 ✓
GET /self-improve/analyze   → 410 ✓
```

Note: Unauthenticated requests still return 401 (auth middleware fires before route handler).
This is correct — 401 before 410 is not a bug; it prevents endpoint enumeration by
unauthenticated callers.

---

## MIDDLEWARE INVENTORY

| Middleware | File | Purpose |
|-----------|------|---------|
| `requireAuth` | `authMiddleware.js` | Validates JWT cookie or x-auth-token header |
| `operatorOnly` | `authMiddleware.js` | Asserts `req.user.role === "operator"` |
| `operatorAudit` | `middleware/operatorAudit.js` | Fire-and-forget audit log to NDJSON |

`operatorAudit` is non-blocking — it never delays the response. If the log write fails
(disk full, permission error), the error is swallowed and the route continues normally.

---

## ROUTE COVERAGE SUMMARY

| Domain | Routes | Auth before | Auth after |
|--------|--------|------------|------------|
| CRM reads | 2 | optionalAuth | requireAuth + operatorOnly |
| CRM writes | 2 | optionalAuth | requireAuth + operatorOnly + operatorAudit |
| Simulation | 2 | none | requireAuth + operatorOnly + operatorAudit |
| Evolution | 7 | requireAuth | 410 Gone (decommissioned) |
| Runtime | all | requireAuth | requireAuth (unchanged, already correct) |
| Auth | /auth/* | public | public (correct) |
| Telemetry | /health, /stats | public | public (read-only, non-sensitive) |

---

## REGRESSION

40/40 tests passed after all Phase M changes. No regressions.

---

## RESIDUAL RISKS

1. **`/stats` and `/ops` endpoints** are public (no auth). They return aggregate business
   stats (total leads, revenue estimates). These are used by the main consumer app before
   login and were intentionally left public in Phase M. Consider adding auth if this data
   is sensitive in production.

2. **`operatorAudit` single-file NDJSON** grows unbounded until `rotate-logs.sh` (weekly
   cron from Phase L) runs. On a busy deployment, high-volume CRM operations could fill
   the log before rotation.

3. **`operatorOnly` role check** is currently binary (operator vs. non-operator). No
   read-only role exists. All operators have full write access. Acceptable for single-operator
   VPS deployment; revisit if multiple operator roles are needed.
