# OS-INTEGRATION — SECURITY

**Track:** OOPLIX 25-OS Master Reconciliation — Integration OS
**Date:** 2026-08-15 · **Branch:** `security/reality-completion` · **Verification port:** 5303

---

## Scope

This is a verification pass, not a remediation pass. Per the mission brief, only genuinely
recoverable, credential-independent defects using existing architecture would be fixed. **No fix
was applied this pass** — every finding below either (a) confirms prior hardening already holds,
or (b) is a re-confirmation of the already-documented C10-017b founder-decision item, for which
building a unilateral fix would risk inventing a second tenant-identity model, exactly as C10-017b
itself already warns against.

---

## Finding 1 — `/my-connectors/*` tenant isolation: CONFIRMED SECURE

**Test:** Two real orgs (A, B), both `org_owner` with `manage_connectors` permission. Org A stored
a real-shaped fake Stripe `api_key`. Org B attempted:
1. Direct `GET /my-connectors` under its own session — correctly saw `stripe.present:false`.
2. Forged `X-Org-Id: <Org A's real orgId>` header on `GET /my-connectors` — **403 Forbidden**,
   `"requires permission: manage_connectors"`.
3. Forged `X-Org-Id: <Org A's real orgId>` header on `DELETE /my-connectors/stripe` — **403
   Forbidden**, same message.
4. Org A's secret re-checked after the forged-delete attempt — **present:true, unchanged**. No
   destructive cross-tenant side effect occurred.

**Root cause of why this holds:** `requireOrgPermission("manage_connectors")` (mounted in
`myConnectors.js`'s `router.use()`) resolves the caller's real org membership via
`organizationService.cjs`, independent of any client-supplied header. This is the same enforcement
pattern documented in the file's own header comment as a deliberate fix from an earlier "Vault
Security Hardening" pass (predating this verification pass) that closed exactly this class of IDOR
across `store/list/delete/validate`.

**Disposition: NO ACTION NEEDED — prior hardening confirmed still effective under live adversarial
test.**

---

## Finding 2 — `secretVault.cjs` org-scoping: CONFIRMED SECURE

**Test:** `_assertOrgAccess(orgId, requestingAccountId, action)` — verified via source read and
functional confirmation through `/my-connectors/*`'s live test above (every vault call in
`myConnectors.js` passes both `orgId` and an implicit `requestingAccountId` context via the
permission gate ahead of it). The vault's own storage key (`orgId::connectorId::type`) provides
physical separation independent of the access-check layer — even a caller that bypassed
`_assertOrgAccess` (e.g., an internal service call with no `requestingAccountId`, which is
explicitly opt-in/backward-compatible) would still only ever read/write its own `orgId`'s key
unless it explicitly passed a different `orgId` string, which requires already knowing that string
and having no destructive default fallback.

**Disposition: NO ACTION NEEDED.**

---

## Finding 3 — `/business/events` platform-wide read surface: CONFIRMED OPEN (extends C10-017b)

**Severity: P2, consistent with C10-017b's existing severity — not escalated, since no fix is
possible without the same founder decision C10-017b already named.**

**Live reproduction:**
```
POST /business/webhook/form   (no auth — external systems can't authenticate, by necessity)
  body: {"name":"SECRET-WEBHOOK-LEAD-XYZZY","email":"secretlead@xyzzy-test.local", ...}
→ 200 OK, real event ingested, real lead persisted (data/biz-leads.json, no orgId field), real
  mission created

GET /business/events   (as Org A, requireAuth only)
→ {"total":1, "events":[{"eventId":"bevt_...", "source":"form", "entityId":"form_bevt_..."}]}

GET /business/events   (as Org B, requireAuth only)
→ IDENTICAL response — same eventId, same data
```

**Root cause:** `getEventLog()` has no `orgId` parameter (confirmed, C10-017b), and the route
(`GET /business/events` in `backend/routes/business.js`) is gated `requireAuth` only — no
`attachOrg`/`requireOrgMember`/org filtering of any kind applied at the route layer either. The
in-memory `_eventLog` ring buffer (and its `data/biz-events.json` flush) is a single, global,
platform-wide list with no tenant partition — matching `businessEventAdapter.cjs`'s architecture
exactly as C10-017b already described: *"external events... arrive with no tenant context to begin
with, so there is no orgId to thread."*

**Why this is not fixed this pass:** Threading an `orgId` through `getEventLog()`'s filter would
require first deciding how an inbound webhook establishes tenant identity in the first place —
exactly the open product/architecture question C10-017b already named (API key → org mapping?
per-org webhook URL? something else?). Filtering `GET /business/events` by `req.org.id` alone,
without also fixing `ingest()` to record an `orgId` on each event, would just produce an equally
dishonest result in the other direction — every org would see **zero** events, including any that
were genuinely theirs, which is a different kind of dishonesty (false-empty) rather than a fix.
Building either half unilaterally, ahead of the founder's decision on tenant-identity-from-webhook,
risks inventing a second, inconsistent tenant model exactly as C10-017b's own disposition warns.

**Blast-radius assessment (what data is actually exposed):** The exposed fields are whatever an
external caller (form submitter, email sender, WhatsApp/Telegram message sender, payment webhook)
put in their own submission — name, email, phone, message/body, and (for payment events) amount/
currency. This is third-party PII the *submitter* provided to *some* org's public-facing form/
inbox/payment page, now readable by *every other* org's authenticated users via this one route.
It is not internal business data (deal values, pipeline, KPIs) — those remain correctly org-scoped
via `businessDataService.cjs`'s existing `orgId`-filtered stores, confirmed unaffected in this
test (`GET /business/leads` correctly showed neither org the webhook lead).

**Recommended founder decision (not actioned, informational only):** the two-part fix C10-017b
already implies — (1) establish inbound tenant identity (most likely per-org webhook URLs or an
API-key-to-org mapping table), (2) thread `orgId` through `ingest()` → `_logEvent()` →
`getEventLog()`, and (3) add `attachOrg + requireOrgMember` to `GET /business/events` and
`/business/events/stats` — is a single, coherent piece of work once the identity-establishment
decision is made, not three separate patches.

**Disposition: VERIFY / FOUNDER DECISION — same as C10-017b. Not fixed. Filed as additional live
evidence under the existing ID, not a new one.**

---

## Finding 4 — `/integrations/*` operator gate: CONFIRMED SECURE

**Test:** Regular (non-operator) authenticated user (Org A) attempted `GET /integrations` and
`GET /integrations/summary`.

**Result:** Both returned `403 Forbidden — operator access required`.

**Disposition: NO ACTION NEEDED — correctly gated by design** (this is the founder's own
platform-wide shared-infrastructure credential status, intentionally not per-org — regular
customers use `/my-connectors/*` instead, per the route file's own header comment).

---

## Finding 5 — connector failure honesty: CONFIRMED, no fabricated success found

5 credential-free connectors sampled directly (Jira, Slack, Sentry, Linear, GitHub) — all reported
`READY`/`MISSING` with the correct missing-env-var name, never a fabricated `CONNECTED`.
`reconnect()` on a credential-free connector likewise returned honest `READY`, and `reconnect()` on
an unknown connector ID threw rather than silently returning a fake status object.
`detectFailures()` returned 55 of 65 tracked connectors as real failures, matching the
unprovisioned state of this environment exactly.

**Disposition: NO ACTION NEEDED.**

---

## No P0/P1 found. No fix applied.

| Severity | Count | Detail |
|---|---:|---|
| P0 | 0 | — |
| P1 | 0 | — |
| P2 | 1 (re-confirmation of existing C10-017b, extended with `/business/events` route-level evidence) | See Finding 3 |
| Confirmed-secure (no action) | 4 | `/my-connectors/*` isolation, `secretVault.cjs` org-scoping, `/integrations/*` operator gate, connector failure honesty |

**Credential-blocked items (re-confirmed, not built):**
- C10-016 — Salesforce, HubSpot, Zendesk, QuickBooks, Shippo connectors (absent, confirmed via
  grep — 0 matches for any of the 5 provider names)
- C10-030-adjacent — any additional real-provider integration requiring credentials this pass has
  no authority to add

---

## Regression / process hygiene

- No code changed this pass — nothing to regress.
- Test webhook lead (`SECRET-WEBHOOK-LEAD-XYZZY`) removed from `data/biz-leads.json` after
  verification; the corresponding mission/task-queue trace entries were left in place as honest
  evidence, consistent with prior OS passes' practice of not scrubbing genuine execution traces.
- Verification server (port 5303, PID 71413) stopped by exact PID after testing completed.
- Port 5050 (PID 45392, the persistent dev/audit-track server) checked via `lsof` before, during,
  and after this pass — confirmed untouched and healthy throughout (`/health` returned `200 ok`
  both times it was checked).
- No `.env` file modified. No credentials added, rotated, or provisioned. No merge or push
  performed.
