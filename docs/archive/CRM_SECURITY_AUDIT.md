> [!WARNING]
> ARCHIVED / LEGACY / NOT ACTIVE PRODUCTION RUNTIME
> This document describes historical or experimental architecture that is not part of the active Jarvis production core.

# CRM SECURITY AUDIT
Phase L — Daily Operator Readiness  
Date: 2026-05-16

---

## 1. AUDIT SCOPE

Files audited:
- `backend/routes/crm.js`
- `backend/routes/simulation.js`
- `backend/routes/index.js` (route mounting order)
- `backend/middleware/authMiddleware.js` (requireAuth implementation)

---

## 2. PRE-PATCH STATE (CRITICAL FINDING)

### 2.1 CRM Routes — All Unauthenticated

```js
// BEFORE (crm.js)
const { optionalAuth } = require("../middleware/firebaseAuth");

router.get("/crm",                optionalAuth, ...)  // 200 unauthenticated
router.get("/crm-leads",          optionalAuth, ...)  // 200 unauthenticated
router.post("/crm/lead",          optionalAuth, ...)  // creates lead unauthenticated
router.patch("/crm/lead/:phone",  optionalAuth, ...)  // updates lead unauthenticated
```

`optionalAuth` is Firebase-based middleware that is effectively a no-op when Firebase is disabled
(which it is — `FIREBASE_PROJECT_ID` is not set). All CRM routes accepted unauthenticated requests.

**Impact:**
- Any caller on the network could read the full lead list (`GET /crm`, `GET /crm-leads`)
- Any caller could create CRM leads (`POST /crm/lead`)
- Any caller could modify any lead's status/data (`PATCH /crm/lead/:phone`)
- No audit trail for who modified data
- Customer phone numbers, names, payment status exposed to unauthenticated access

**Severity: CRITICAL** — customer data read/write with zero authentication.

### 2.2 Simulation Routes — Zero Auth

```js
// BEFORE (simulation.js)
// No auth import, no middleware

router.post("/send-followup", async (req, res) => { ... })     // sends WA message unauthenticated
router.post("/simulate/full-flow", async (req, res) => { ... }) // creates lead, sends WA, creates payment link, updates CRM — unauthenticated
```

`POST /simulate/full-flow` chains 5 side-effecting operations:
1. CRM lead write
2. AI API call (Groq)
3. Payment link creation (Razorpay)
4. WhatsApp message send
5. CRM status update to "paid"

Any unauthenticated caller could trigger all 5 in sequence with arbitrary phone numbers.

**Severity: CRITICAL** — unauthorized WhatsApp sends, arbitrary CRM writes, payment link creation.

---

## 3. PATCH APPLIED

### 3.1 crm.js

```js
// AFTER
const { requireAuth } = require("../middleware/authMiddleware");

router.get("/crm",                requireAuth, ...)
router.get("/crm-leads",          requireAuth, ...)
router.post("/crm/lead",          requireAuth, ...)
router.patch("/crm/lead/:phone",  requireAuth, ...)
```

### 3.2 simulation.js

```js
// AFTER
const { requireAuth } = require("../middleware/authMiddleware");

router.post("/send-followup",      requireAuth, async (req, res) => { ... })
router.post("/simulate/full-flow", requireAuth, async (req, res) => { ... })
```

`requireAuth` from `authMiddleware.js` validates:
- `jarvis_auth` httpOnly cookie (JWT HS256), OR
- `x-auth-token` header (JWT HS256 fallback)
- Returns 401 `{ error: "Unauthorized" }` if missing or invalid
- Returns 401 `{ error: "Token expired" }` if JWT expired

---

## 4. VERIFICATION

### 4.1 Unauthenticated Access (All Must Return 401)

| Route | Method | No-Auth Status | Result |
|-------|--------|----------------|--------|
| `/crm` | GET | 401 | PASS |
| `/crm-leads` | GET | 401 | PASS |
| `/crm/lead` | POST | 401 | PASS |
| `/crm/lead/:phone` | PATCH | 401 | PASS |
| `/send-followup` | POST | 401 | PASS |
| `/simulate/full-flow` | POST | 401 | PASS |

### 4.2 Authenticated Access (Cookie Auth)

| Route | Method | Cookie-Auth Status | Result |
|-------|--------|-------------------|--------|
| `/crm` | GET | 200 | PASS |
| `/crm/lead` | POST | 200 | PASS |

### 4.3 Regression Suite

40/40 passing after patch. No regressions introduced.

---

## 5. REMAINING RISKS (Not Patched — Not In Scope)

### 5.1 No IDOR Protection on PATCH /crm/lead/:phone

`PATCH /crm/lead/:phone` accepts any phone number as the path parameter. An authenticated operator
can update any lead, including leads they did not create. For a solo operator tool this is the
expected behavior — there is only one operator. No change required.

### 5.2 No Pagination on GET /crm

`GET /crm` returns all leads in a single JSON array. `crmService.getLeads()` reads the full
`data/leads.json` file. At very high lead counts (10,000+), this could cause a slow response or
large payload. For solo-operator scale this is acceptable.

### 5.3 `POST /simulate/full-flow` Still Reachable in Production

The simulation endpoint remains mounted in production. It should only be used for testing.
It creates a real CRM lead (phone `919999999999` by default), calls Groq AI, and attempts a
real Razorpay payment link. Mitigation: it is now gated behind `requireAuth`. Consider
disabling via env flag before any multi-operator deployment.

### 5.4 Lead Phone Deduplication Is Client-Side Only

`POST /crm/lead` checks `crm.getLead(cleanPhone)` before saving and returns
`{ duplicate: true }` if the lead exists. It does NOT return a 409 — it returns 200 with
`duplicate: true`. Frontend code handles this correctly. No security issue, but the API
contract is non-standard.

---

## 6. SUMMARY

| Issue | Pre-Patch | Post-Patch |
|-------|-----------|------------|
| CRM read exposure | OPEN | CLOSED |
| CRM write exposure | OPEN | CLOSED |
| Simulation chain (WA + payment + CRM) | OPEN | CLOSED |
| Regression suite | 40/40 | 40/40 |
| Auth mechanism | optionalAuth (no-op) | requireAuth (JWT HS256) |

All 6 CRM and simulation routes are now behind `requireAuth`. The pre-patch state was a critical
security gap for any deployment accessible over a network. The patch is minimal and correct.
