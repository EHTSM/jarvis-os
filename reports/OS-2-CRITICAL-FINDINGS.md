# OS-2 CRITICAL FINDINGS

Date: 2026-08-13 · Branch: `security/reality-completion`
**No merge. No push. `.env` untouched.**

Findings ordered by severity. Every one was reproduced live against a running backend with a real authenticated session before any fix.

---

## F-001 — FAKE SUCCESS: WhatsApp broadcast reports `sent` with zero recipients
**HIGH — this is the defect class OS-2 exists to catch**

| Field | Value |
|---|---|
| **OS** | Communication |
| **Workflow** | WhatsApp broadcast → send |
| **Reproduction** | `POST /growth/whatsapp/broadcasts` then `POST /growth/whatsapp/broadcasts/:id/send` |
| **Evidence** | `{"status":"sent","sentAt":"2026-08-13T07:29:19.135Z","stats":{"sent":0,"delivered":0,"failed":0}}` |
| **Root cause** | [growthOS.cjs:308-310](backend/services/growthOS.cjs#L308) set `status="sent"` unconditionally. With no audience and a phone-first CRM returning no leads, `memberIds` was empty, the delivery loop never executed, and the record still claimed success. |
| **Impact** | An operator sees "sent" with a timestamp. Nothing reached anyone. Only the zero counters contradict it, and no UI surfaces them prominently. |
| **Fix** | Refuse with a `nonRetriable` error naming the real reason — mirroring the convention `sendEmailCampaign()` and `sendSMSCampaign()` already use. Broadcasts **with** recipients are unchanged. |
| **Verification** | `400 {"error":"WhatsApp broadcast has no recipients: no audience is attached and the CRM returned no leads with a phone number…"}` |
| **Classification** | REAL + BROKEN → **fixed** |

---

## F-002 — FABRICATED METRICS: push analytics invented from a multiplier
**HIGH**

| Field | Value |
|---|---|
| **OS** | Communication |
| **Workflow** | Push notification → send → analytics |
| **Reproduction** | `POST /growth/push/send` |
| **Evidence** | [growthOS.cjs:459](backend/services/growthOS.cjs#L459): `clicked: Math.round(sent * 0.06), dismissed: Math.round(sent * 0.12)` |
| **Root cause** | This module consumes **no** click or dismissal webhook. Engagement was synthesised from a fixed 6%/12% rate and returned as measured analytics. Also set `status:"sent"` with zero devices targeted. |
| **Impact** | Any real send would show invented click-through and dismissal figures indistinguishable from measured data. Latent — with zero sends the multiplier yields 0, which is why it survived earlier read-only audits. |
| **Fix** | `clicked`/`dismissed` → `null` ("not measured"), not `0` (which falsely asserts zero clicks). `status` → `not_sent` when nothing was delivered, plus a `notSentReason`. |
| **Verification** | `status=not_sent, stats={"targeted":0,"sent":0,"clicked":null,"dismissed":null}, notSentReason="no audience or accountIds supplied — zero devices targeted"` |
| **Classification** | REAL + BROKEN → **fixed** |

---

## F-003 — My C.1.1 API-404 fix was structurally incomplete
**HIGH — a correction to my own prior work**

| Field | Value |
|---|---|
| **OS** | Cross-cutting (measurement integrity) |
| **Reproduction** | `GET /dev/projects`, `GET /personal/tasks` (authenticated) |
| **Evidence** | Both returned **200 + SPA HTML** *after* C.1.1 was reported complete. |
| **Root cause** | The C.1.1 boundary keyed off prefixes **derived from mounted routes**. `/dev` and `/personal` have no mounted routes at all, so they were absent from the prefix set and fell through to the SPA. The masking survived **exactly** where it mattered most — the endpoints `DeveloperOS.jsx` and `PersonalOS.jsx` call. |
| **Impact** | C.1.1's "0 HTML masks across 1,010 endpoints" was true only because the probe list contained no path under a nonexistent prefix. The claim was narrower than it read. |
| **Fix** | Added a second rule: any **multi-segment** path that is not a known client-side route (`/`, `/reset-password`, `/verify-email`, `/accept-invite`) returns JSON 404. Single-segment paths still fall through, so future client routes keep working. |
| **Verification** | `/dev/projects` 404 · `/personal/tasks` 404 · `/totally/made/up` 404 · `/` 200 HTML · `/graph/stats` 200 JSON |
| **Classification** | REAL + BROKEN → **fixed** |

---

## F-004 — Client errors reported as server faults (HTTP 500 for "not found")
**MEDIUM — systemic across two route families**

| Field | Value |
|---|---|
| **OS** | Communication, Marketing |
| **Reproduction** | `PATCH /growth/email/campaigns/nope-xyz`, `POST /content/articles/nope/publish` |
| **Evidence** | **7 of 10** probed mutating endpoints returned `500 {"error":"… not found"}`. The equivalent GET routes correctly returned 404. |
| **Root cause** | GET handlers null-check and return 404. Mutating handlers let the service **throw**, and the shared `_err(res, e, code = 500)` helper mapped every exception to 500. |
| **Impact** | A 500 tells a client "server broke, retry"; a 404 tells it "this id does not exist, stop". Monitoring, alerting and retry logic all act on that difference. Error *messages* were honest; only the status lied. |
| **Fix** | Classify by the error the service already raises: `/not found/i` → 404, everything else unchanged. One helper each in `growthOS.js` and `contentSEO.js` rather than editing 50+ call sites. The deliberate `nonRetriable → 400` convention on send routes is preserved. |
| **Verification** | All 7 now return 404; creates and genuine faults unaffected |
| **Classification** | REAL + BROKEN → **fixed** |

---

## F-005 — AI is rate-limited, not broken
**INFORMATIONAL — a finding that did NOT warrant a fix**

| Field | Value |
|---|---|
| **OS** | AI, Developer |
| **Reproduction** | `POST /coding/ask` → `500 "AI backend unavailable. Check provider API keys in your .env file."` |
| **Investigation** | `/wiring/ai` reported **Groq: live API call succeeds**. A direct Groq call returned `"OK"`. Instrumenting `callAI` showed: `groq → 429`, `openai → 401`, `ollama → 404`, `lmstudio → unreachable`. |
| **Root cause** | Groq free-tier **rate limit (429)**, hit by my own probing. `OPENAI_API_KEY` is present but **invalid** (401). The fallback chain worked correctly and reported honestly. |
| **Verification** | After a 90 s cooldown, `callAI` returned `"OK"`. **AI works.** |
| **Impact** | The error message says "check provider API keys" when the real cause was a quota exhaustion — slightly misleading, but not false. |
| **Fix** | **None.** No code defect exists. Fixing this would mean inventing a problem. |
| **Classification** | **CREDENTIAL BLOCKED** (free-tier quota + one invalid key) |

---

## F-006 — Benchmark score fell 60 → 50 because fiction was removed
**INFORMATIONAL — expected consequence of F-001/F-002**

`GET /growth/benchmark` before fixes: **score 60, passing 6/10**, with `push_pipeline` **PASS**.
After fixes: **score 50, passing 5/10**, with `push_pipeline` **FAIL**.

The push pipeline previously passed on fabricated success. **The product did not get worse — the measurement got honest.** The internal benchmark asserted `status === "sent"`, which my fix now correctly refuses to satisfy when nothing was sent.

Measured by stashing the service fix, restarting, re-running, and restoring. This is recorded because a future reader will otherwise see a 10-point regression and assume something broke.

---

## Summary

| ID | OS | Severity | Classification | Status |
|---|---|---|---|---|
| F-001 | Communication | HIGH | REAL + BROKEN | Fixed |
| F-002 | Communication | HIGH | REAL + BROKEN | Fixed |
| F-003 | Cross-cutting | HIGH | REAL + BROKEN | Fixed |
| F-004 | Communication, Marketing | MEDIUM | REAL + BROKEN | Fixed |
| F-005 | AI, Developer | INFO | CREDENTIAL BLOCKED | No fix — none needed |
| F-006 | Communication | INFO | Expected consequence | Documented |

**Two fake-success defects found and fixed.** Both were invisible to read-only auditing — they only surface when you execute the workflow and inspect what the response actually claims versus what it did.
