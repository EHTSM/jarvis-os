# C.10 — FINAL CROSS-SYSTEM / V1 CLOSURE DISCOVERY

Date: 2026-08-14/15 · Branch: `security/reality-completion`
**No merge. No push. `.env` untouched. No Master Recovery started. No new OS started. No C.11.**

Companion documents: [Capability Matrix](C10-CROSS-SYSTEM-CAPABILITY-MATRIX.md) · [Workflow Evidence](C10-CROSS-SYSTEM-WORKFLOW-EVIDENCE.md) · [Security](C10-CROSS-SYSTEM-SECURITY.md) · [Final Closure Inventory](C10-FINAL-CLOSURE-INVENTORY.md)

---

## Method

This is the final C-series audit: does the already-audited Ooplix V1 actually work together as one product? Two parallel discovery passes were run — (1) a full 26-area route→service→persistence→frontend trace, and (2) a cross-reference of 7 prior internal audit documents (`docs/audits/100-COMPANY-*`, `PRODUCTION-BLOCKER-ELIMINATION.md`, `HIDDEN-CAPABILITY-RECOVERY.md`, `ZERO-BLIND-SPOT-CERTIFICATION.md`) against current live code, classifying every finding TRUE/FIXED/REGRESSED/NOT REPRODUCIBLE — then every claim from both passes that mattered for severity was independently live-verified against the running server with two real test tenants, not trusted from static analysis alone.

## Baseline

```
git status (pre-C.10)   : 180/180 not yet run — baseline was 176/176 (C.9's final count)
branch                   : security/reality-completion
.env changes             : 0, verified repeatedly
Two real tenants created : Org A (org_1786740067275_1), Org B (org_1786740067291_2)
                            via real accountService/organizationService functions, real /auth/login
```

---

## 1 · The 26 areas — what actually exists

Full detail in the Capability Matrix. Headline findings:

- **"Sales OS" (E) does not exist as a distinct system.** It is fully absorbed into CRM (`/crm/*`) and Business OS (`/business/opportunities`, `/business/deals`). This is not a gap — the mission brief's own template may over-specify a boundary that was never built as separate, and forcing a distinct classification would misrepresent the real architecture.
- **"Finance OS" (F) does not exist as one system either.** Revenue/finance concepts are split across `revenueOS.js` (platform-wide, operator-only SaaS billing — Ooplix's own subscription revenue), `billing.js` (per-account subscription status), and `business.js`'s `/business/revenue*` (per-org sales-close revenue — genuinely real and tested, see Flow 1 below).
- **"Support OS" (M) is a real sub-module of Customer Success OS** (`/customer-org/support/*`), not a standalone system — and it is genuinely, recently tenant-hardened (see Security report).
- **Memory OS (H) has three parallel, non-reconciled backends**: `/memory/*` (engineering memory, used by `EngineeringMemoryPanel.jsx`), `/memory-index/*` (explicitly commented "previously built but unwired" in its own route mount), and `/p18/memory/*` (legacy phase-18, used by `MemoryOSV2.jsx`). None carry an `orgId` field.
- **Enterprise OS (V) has three non-integrated backends behind one UI tab.** `EnterpriseOS.jsx` talks exclusively to a flat-file engine inlined in `ops.js` (`agents/runtime/enterpriseOS.cjs`), while a separate Level-7 org-hierarchy engine (`/ent/*`) and a full M1-M8 enterprise suite (SSO/SCIM/audit/policy/monitoring, all genuinely org-scoped) sit unused by that UI.
- **Platform OS (Z) has a real, org-scoped backend with zero discoverable frontend caller.** The shared `OrgLevelStatus.jsx` component that surfaces J/V/W/X/Y's status explicitly omits a Platform entry from its levels map.
- **Knowledge OS (U)'s frontend tab is entirely fabricated.** `KnowledgeCenter.jsx` renders hardcoded seed documents/websites/search-results, persists only to `localStorage`, and makes zero network calls — confirmed live by source read (0 `fetch`/`_fetch` occurrences). Meanwhile three real backend Knowledge systems exist and are never called by this tab.
- **Automation OS (N) uses `workspaceId` scoping** while nearly every other letter uses `orgId` scoping — a structurally different tenancy model coexisting in the same product.
- **Business OS (C)'s own persistence layer documents unscoped legacy records in its own code comments**: `businessDataService.cjs:48-58` states pre-multi-tenancy records have no `orgId`, and a call site that omits `orgId` silently operates across all tenants.

## 2 · The 7 cross-OS flows — what actually connects

| Flow | Result | Evidence |
|---|---|---|
| 1: Lead→Qualification→Opportunity→Close-Won→Revenue→Finance→Executive | **PASS through Revenue, FAILS the "Finance"/"Executive" hop as literally worded** | Live-tested end-to-end within Business OS: real lead → real qualify → real opportunity → real close-won ($50,000) → automatically generated a real, correctly-linked revenue record → correctly reflected in `/business/dashboard`. But there is no single "Finance OS" to hand off to, and "Executive OS" (`/eos/v6/*`) is a separate, operator-only, platform-wide simulated layer that a regular org owner cannot even read (403) — it does not reconcile this org's real revenue. See Workflow Evidence for full transcript. |
| 2: CRM identity→Audience→Campaign→Delivery→Analytics→Executive | **PASS on identity/campaign creation, HONEST FAILURE on delivery (by design, not a defect)** | Real campaign created, org-scoped. Send attempt returned a real, structurally accurate 400: this CRM is phone/WhatsApp-first with no email field, so there is genuinely no recipient list — not a fake "sent" success. |
| 3: Customer→Onboarding→Customer Success→Support→Escalation→Executive | **PASS, and a documented-as-broken finding turned out to be already FIXED** | Real ticket created (Org A), correctly blocked from Org B on both READ and RESOLVE (write) — a stale in-file comment claimed the resolve route "never got the same guard" as the read route, but live testing proved both are correctly ownership-checked. See Security report. |
| 4: User command→AI Workspace→Memory/Knowledge→Mission→Agent→Runtime→execution result→history | **PASS at the AI/Mission/History boundary (fully covered in C.9), Memory hop has a real documented tenant gap** | Reuses C.9's extensive live evidence: real successful AI completions, correctly tenant-isolated prompt history. Mission-context injection still has zero org scoping in `missionMemory.cjs` (unchanged from C.9, re-confirmed present). |
| 5: Developer request→AI/Developer OS→engineering mission→execution→history→memory/lesson | **PASS on the AI/coding-assistant side (C.9), FAIL on Developer OS proper** — see the P0 below | `/coding/*` (the AI-facing developer surface) is solid per C.9. `/dev/*` (the broader Developer OS entity store — repos/projects/issues/builds/deployments) was found completely unauthenticated (P0, now fixed) and has zero org scoping at all (documented, not fixed). |
| 6: Automation trigger→Automation→Mission/Runtime→execution→notification/event→persisted outcome | **GENUINE GAP — no live trigger loop exists** | `automationService.cjs` exports create/list/update/history/statistics but no `deleteRule`, and the imported automation-loop dependency is never actually invoked anywhere in the route file (confirmed via grep — zero call sites). Rules can be created and dry-run (simulated), but nothing in the current codebase actually fires them automatically against real events. |
| 7: Organization→Workspace→Department→Team→Role→Permissions→OS access→Audit trail | **PASS, fully live-verified** | Real department created in Org A; Org B correctly 403'd on both read and write via direct orgId in the URL path; a forged `X-Org-Id: <org-A>` header on Org B's own context endpoint correctly returned Org B's own data, not Org A's — the header never widened access. |

## 3 · Prior findings re-verified (headline — full table in Closure Inventory)

7 prior audit documents were read in full and cross-checked against current code. Of the ~30 distinct findings extracted:
- **10 are FIXED** since the documents were written (cross-tenant CRM IDOR, refund approval gate, company-creation dry-run stub, fake OAuth/Zapier health checks, deployment-approval floor bypass, 15 broken agent files, 14 missing department families, `attachOrg` path-param confused-deputy, `orgKnowledgeGraph` missing isolation filter, MRR-overflow root cause).
- **~15 remain TRUE/unchanged** (no RBAC step in company factory, single-process architecture ceiling, opt-in-only Business OS scoping, niche-classification regex ladder, missing external connectors, unverified load-test claims, Enterprise CRM frontend mock, JWT logout non-revocation, Sentry never wired to capture, automation missing delete/trigger, no MRR decrement path, and others).
- **2 new findings surfaced** during this pass, not present in any prior document: the `/dev/*` unauthenticated P0 (now fixed) and a `/cbeta/billing/*` cross-account IDOR pattern (client-supplied `accountId` with no ownership check — documented, not fixed, in the Security report).
