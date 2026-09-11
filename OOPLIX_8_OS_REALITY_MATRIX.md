# OOPLIX 8-OS REALITY MATRIX
**Phase C.1 Part 4 — recalculated from functional evidence, not route counts**

Date: 2026-08-13

---

## Denominator — stated explicitly

Every percentage below uses **one denominator: endpoints probed live for that OS**. Not endpoints on disk, not endpoints mounted, not lines of code.

`probed` = product-class (A) parameterless GET endpoints matching that OS's prefixes, executed against a live authenticated server.

An OS with 24 probed endpoints (Communication) and one with 210 (Cloud) are **not** measured on comparable bases. Read the absolute counts, not just the percentages.

---

## Matrix

| OS | Probed | Working | Empty | Perm-blocked | Billing-blocked | Broken | 404 |
|---|---:|---:|---:|---:|---:|---:|---:|
| **AI** | 183 | **87** (47.5%) | 85 | 0 | 0 | 0 | 10 |
| **CLOUD** | 210 | **85** (40.5%) | 121 | 0 | 0 | 0 | 1 |
| **MARKETING** | 114 | **76** (66.7%) | 27 | 0 | 6 | 1 | 0 |
| **BUSINESS** | 168 | **69** (41.1%) | 77 | 16 | 0 | 0 | 6 |
| **DEVELOPER** | 107 | **56** (52.3%) | 46 | 0 | 0 | 1 | 3 |
| **HOSTING** | 80 | **37** (46.3%) | 32 | 9 | 0 | 2 | 0 |
| **ENTERPRISE** | 100 | **34** (34.0%) | 64 | 0 | 0 | 0 | 1 |
| **COMMUNICATION** | 24 | **2** (8.3%) | 1 | 21 | 0 | 0 | 0 |

---

## Reading the matrix

### MARKETING — highest working ratio (66.7%)
76 of 114 endpoints return real data. `/growth/*`, `/content/*`, `/distrib/*`, `/creative/*` are populated and responsive. The 6 billing-blocked are `/marketplace/*` behind a working feature gate. **This is the most functionally proven OS in the platform.**

### AI — largest absolute working surface (87 endpoints)
Backed by genuinely live infrastructure: `/graph/stats` returns **1,526 edges across 2,321 nodes**; `/agents/runtime/supervisor` reports 29-day uptime; the autonomous loop was observed executing tasks during probing. The 85 "empty" are largely per-tenant surfaces with no data for a fresh account. 10 × 404 warrant a look.

### CLOUD — largest empty share (121 of 210)
`/civ/*`, `/eco/*`, `/auto/*`, `/platform/*` are abstract organisational simulation layers. They respond correctly but mostly with zero-state, and several carry test-run residue. **High endpoint count, low demonstrated operator value.** Endpoint count flatters this OS more than any other.

### BUSINESS — 41.1%, with 16 permission-blocked
The 16 × 403 are operator-tier surfaces correctly refusing a user-tier account, not gaps. The 77 empty responses are expected for a fresh tenant — but unproven. `/business/pipeline` returns a correct, fully-empty pipeline structure.

### DEVELOPER — 52.3%, one real defect
`/engineering/*` and `/coding/*` are live and returning data. The broken one is `/coding/smells` (35 s, 1.4 MB, unusable from UI).

### HOSTING — 46.3%, two broken
`/computer/dashboard` returns 500. `/computer/editor/diagnostics` takes 3.8 s. 9 × 403 are operator-tier.

### ENTERPRISE — lowest working ratio of the substantial OSes (34%)
64 of 100 endpoints return empty state. `/enterprise/sso`, `/scim`, `/audit`, `/policy`, `/monitoring`, `/dashboard` are all mounted and respond — but a fresh org has no SSO config, no SCIM provisioning, no audit history. **The capability exists; nothing has ever exercised it.** Separately, `EnterpriseOS.jsx` targets `/enterprise/orgs|depts|teams|roles|permissions|policies` — **none of which exist** (see gap matrix).

### COMMUNICATION — 8.3% working, but the number is misleading
Only 24 endpoints probed, and **21 of them are 403 operator-tier** (`/integrations/*`, `/vault/*`). Just 2 returned data.

**This is not evidence that Communication OS is missing.** Phase C.0 established that messaging capability lives under `/growth/*` — `email`, `sms`, `whatsapp`, `push`, `automations`, `audiences`, `templates` — which this matrix counts under MARKETING (66.7% working). Communication OS is a **taxonomy artifact**, not a capability gap. Its real blocker is credentials: `SMTP_HOST`, `WHATSAPP_TOKEN`, `TELEGRAM_BOT_TOKEN`, `FIREBASE_PROJECT_ID` are all unset, so delivery cannot be verified regardless of code quality.

---

## What this matrix does NOT establish

1. **No mutation was tested.** Every number is read-only. Whether creating a campaign, sending an email, or provisioning a user works is **unverified**.
2. **Empty ≠ working.** 453 endpoints across all eight OSes returned valid-but-empty. Without seeded fixtures, none of them are proven to aggregate correctly when populated.
3. **No frontend rendering was verified.** These are API results. Whether a component renders them is a separate question (see gap matrix).
4. **Prefix→OS assignment is judgment.** `/twin`, `/research`, `/science` → AI; `/computer`, `/browser` → Hosting. Reasonable people would bucket differently. Counts are exact; grouping is interpretive.

---

## Revised standing vs Phase C.0

C.0 estimated capability structurally (routes mounted, UI reachable). C.1 measured it functionally. The ordering changed:

| OS | C.0 structural rank | C.1 functional rank | Movement |
|---|---:|---:|---|
| Marketing | 3rd | **1st** (66.7%) | ▲ 2 |
| Developer | 5th | 2nd (52.3%) | ▲ 3 |
| AI | 1st | 3rd (47.5%) | ▼ 2 |
| Hosting | 7th | 4th (46.3%) | ▲ 3 |
| Business | 2nd | 5th (41.1%) | ▼ 3 |
| Cloud | 4th | 6th (40.5%) | ▼ 2 |
| Enterprise | 6th | 7th (34.0%) | ▼ 1 |
| Communication | 8th | 8th (8.3%) | — |

**Marketing and Developer were undervalued by structural analysis; AI, Business and Cloud were overvalued** — they have large endpoint surfaces that return mostly empty state.
