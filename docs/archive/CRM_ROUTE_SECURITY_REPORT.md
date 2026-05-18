> [!WARNING]
> ARCHIVED / LEGACY / NOT ACTIVE PRODUCTION RUNTIME
> This document describes historical or experimental architecture that is not part of the active Jarvis production core.

# CRM ROUTE SECURITY REPORT
Phase M — Security Cleanup + Frontend Maturity  
Date: 2026-05-16

---

## 1. ROUTE INVENTORY

| Route | Method | Pre-Phase L | Post-Phase L | Post-Phase M |
|-------|--------|------------|-------------|-------------|
| `/crm` | GET | `optionalAuth` (open) | `requireAuth` | `requireAuth + operatorOnly` |
| `/crm-leads` | GET | `optionalAuth` (open) | `requireAuth` | `requireAuth + operatorOnly` |
| `/crm/lead` | POST | `optionalAuth` (open) | `requireAuth` | `requireAuth + operatorOnly + operatorAudit` |
| `/crm/lead/:phone` | PATCH | `optionalAuth` (open) | `requireAuth` | `requireAuth + operatorOnly + operatorAudit` |

---

## 2. MIDDLEWARE CHAIN

### New: `operatorOnly`

Added to `backend/middleware/authMiddleware.js`:

```js
function operatorOnly(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  if (req.user.role !== "operator") return res.status(403).json({ error: "Forbidden — operator access required" });
  next();
}
```

Purpose: Enforces role-based access after `requireAuth` populates `req.user`. The current
system has one role (`"operator"`), but this gate makes the intent explicit and blocks any
future JWT with a different role (e.g., a "viewer" role added later) from writing to the CRM.

### Audit Logging on Write Routes

`operatorAudit` added to `POST /crm/lead` and `PATCH /crm/lead/:phone`. Each write is
appended to `data/logs/operator-audit.ndjson` with: timestamp, method, path, status, IP,
request ID, duration.

Read routes (`GET /crm`, `GET /crm-leads`) are not audit-logged — read-only enumeration
by the authenticated operator is expected behavior and does not need a per-request audit trail.

---

## 3. FINAL MIDDLEWARE CHAIN

```
POST /crm/lead:
  1. requireAuth     — validates JWT (cookie or header), populates req.user
  2. operatorOnly    — asserts req.user.role === "operator"
  3. operatorAudit   — appends audit entry to ndjson log (fire-and-forget)
  4. handler         — validates phone, deduplicates, saves lead

PATCH /crm/lead/:phone:
  1. requireAuth
  2. operatorOnly
  3. operatorAudit
  4. handler         — updates lead by phone

GET /crm, GET /crm-leads:
  1. requireAuth
  2. operatorOnly
  3. handler         — returns lead list
```

---

## 4. THREAT MODEL

| Threat | Mitigation |
|--------|-----------|
| Unauthenticated lead enumeration | Blocked by `requireAuth` → 401 |
| Non-operator JWT reading leads | Blocked by `operatorOnly` → 403 |
| Unauthenticated CRM write | Blocked by `requireAuth` → 401 |
| Non-operator CRM write | Blocked by `operatorOnly` → 403 |
| Untracked write operations | `operatorAudit` logs all writes to operator-audit.ndjson |
| IDOR (update any lead by phone) | Accepted — solo operator tool. No per-user lead ownership. |
| Phone enumeration via PATCH 404/200 | No 404 on missing phone — `updateLead()` is an upsert. No signal. |

---

## 5. REMAINING GAPS

### 5.1 No pagination on GET /crm

`GET /crm` returns all leads in one JSON array. At scale (10,000+ leads), this becomes
slow. For solo operator daily use this is not a problem. Add `?limit=&offset=` if needed.

### 5.2 No input sanitization on PATCH body

`PATCH /crm/lead/:phone` passes `req.body` directly to `crm.updateLead()`. There is no
field allowlist — arbitrary JSON keys can be written to the lead record. Since this endpoint
is authenticated operator-only, this is accepted risk. If leads data is ever exposed to
external parties (e.g., exported, shared), field sanitization should be added.

### 5.3 CRM write under /jarvis gateway

`POST /jarvis` routes through the Jarvis AI gateway which can invoke CRM operations as a
side effect (e.g., "save this lead: ..."). These writes do not go through the CRM route's
`operatorAudit` — they appear in the runtime execution log instead. Acceptable: the execution
log captures the intent; the CRM service call is an internal function call.

---

## 6. VERIFICATION

```bash
# All return 401 without auth:
curl -s -o /dev/null -w "%{http_code}" http://localhost:5050/crm          # 401
curl -s -o /dev/null -w "%{http_code}" http://localhost:5050/crm-leads    # 401
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:5050/crm/lead \
  -H "Content-Type: application/json" -d '{"phone":"919999999999"}'       # 401
curl -s -o /dev/null -w "%{http_code}" -X PATCH http://localhost:5050/crm/lead/919999999999 \
  -H "Content-Type: application/json" -d '{}'                             # 401

# All return 200 with valid operator session (cookie auth):
curl -b cookies.txt http://localhost:5050/crm                             # 200
```
