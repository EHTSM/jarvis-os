> [!WARNING]
> ARCHIVED / LEGACY / NOT ACTIVE PRODUCTION RUNTIME
> This document describes historical or experimental architecture that is not part of the active Jarvis production core.

# SIMULATION SECURITY REPORT
Phase M — Security Cleanup + Frontend Maturity  
Date: 2026-05-16

---

## 1. ROUTES UNDER AUDIT

### POST /send-followup

**Action:** Calls `automation.sendManualFollowUp(phone, message)` — sends a WhatsApp message to an arbitrary phone number.

**Side effects:**
- WhatsApp API call (cost per message, rate-limited)
- Message appears in recipient's WhatsApp as business communication

### POST /simulate/full-flow

**Action:** Chains 6 side-effecting operations in sequence:
1. CRM lead write (`crm.saveLead`)
2. AI API call (Groq)
3. Payment link creation (Razorpay API)
4. WhatsApp message send (`wa.sendMessage`)
5. CRM status update to `"paid"` (`crm.updateLead`)
6. CRM read verification (`crm.getLead`)

Default phone number: `919999999999` (hardcoded test value). If called unauthenticated
and overridden with a real customer phone, it would mark that customer as "paid" and
send them a real WhatsApp payment link.

---

## 2. PRE-PHASE L STATE (CONFIRMED CRITICAL)

Both routes had zero authentication:
```js
// BEFORE (simulation.js)
router.post("/send-followup",      async (req, res) => { ... })  // no auth
router.post("/simulate/full-flow", async (req, res) => { ... })  // no auth
```

Any HTTP client that could reach port 5050 (or the public VPS URL) could:
- Send arbitrary WhatsApp messages from the business number
- Create fake leads in CRM
- Mark existing leads as "paid"
- Trigger Razorpay payment link creation

---

## 3. PHASE M STATE (FINAL)

```js
// AFTER (simulation.js)
const { requireAuth, operatorOnly } = require("../middleware/authMiddleware");
const operatorAudit = require("../middleware/operatorAudit");

router.post("/send-followup",      requireAuth, operatorOnly, operatorAudit, async (req, res) => { ... })
router.post("/simulate/full-flow", requireAuth, operatorOnly, operatorAudit, async (req, res) => { ... })
```

Middleware chain:
1. `requireAuth` — valid JWT required (cookie or x-auth-token header)
2. `operatorOnly` — role must be `"operator"`
3. `operatorAudit` — appends entry to `data/logs/operator-audit.ndjson` before handler fires

---

## 4. AUDIT LOG ENTRY FORMAT

Each call to `/send-followup` or `/simulate/full-flow` now produces an entry like:

```json
{
  "ts": "2026-05-16T12:00:00.000Z",
  "method": "POST",
  "path": "/send-followup",
  "status": 200,
  "ip": "127.0.0.1",
  "requestId": "req-xxx",
  "durationMs": 234
}
```

The phone number and message body are NOT logged — they may contain PII. The log
captures THAT the operation happened, not WHAT was sent.

---

## 5. THREAT MODEL

| Threat | Pre-Phase L | Post-Phase M |
|--------|------------|-------------|
| Unauthenticated WhatsApp send | OPEN | Blocked (401) |
| Unauthenticated CRM write via simulate | OPEN | Blocked (401) |
| Non-operator JWT triggering simulation | Not possible (no other roles) | Blocked (403) |
| Untraceable send-followup calls | No audit trail | operatorAudit logs every call |
| Mass WhatsApp spam via iterate | OPEN | Blocked (operatorAudit + rate limiter on /ops) |

---

## 6. RECOMMENDATION: DISABLE IN PRODUCTION

`POST /simulate/full-flow` is a test workflow. It should be:
1. Disabled via environment flag when `NODE_ENV=production`
2. OR removed from the route table after development is complete

Current mitigation: protected by `requireAuth + operatorOnly`. Acceptable for internal
solo-operator use. Not acceptable if the server is ever shared.

Suggested future gate:
```js
if (process.env.NODE_ENV === "production") {
  router.post("/simulate/full-flow", (req, res) =>
    res.status(410).json({ error: "Simulation disabled in production" }));
} else {
  router.post("/simulate/full-flow", requireAuth, operatorOnly, operatorAudit, async (req, res) => { ... });
}
```

---

## 7. VERIFICATION

```bash
# Returns 401 without auth:
curl -s -o /dev/null -w "%{http_code}" -X POST \
  -H "Content-Type: application/json" -d '{"phone":"919999999999"}' \
  http://localhost:5050/send-followup       # 401

curl -s -o /dev/null -w "%{http_code}" -X POST \
  -H "Content-Type: application/json" -d '{}' \
  http://localhost:5050/simulate/full-flow  # 401
```
