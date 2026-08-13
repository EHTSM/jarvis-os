# OS-3 RECOVERY ROADMAP

Date: 2026-08-13
Ordering inputs: business impact · existing capability · recovery effort · dependency count · credential dependency · founder value · risk.

**BUILD was not automatically chosen. It was not chosen at all — nothing qualified.**

---

## Recovery order

### TIER 0 — Zero engineering, immediate value

| # | Action | Category | OS | Effort | Why first |
|---|---|---|---|---|---|
| 1 | Replace the **invalid `OPENAI_API_KEY`** (401) | **PROVISION** | AI, Developer | minutes | An invalid key sits in the fallback chain. Groq masks it until Groq is rate-limited — exactly when the fallback is needed. |
| 2 | Raise **Groq quota** or add a paid provider | **PROVISION** | AI, Developer | minutes | Groq 429 is the *only* thing blocking `/coding/ask` and `/ai/chat`. Verified: `callAI` returns "OK" after cooldown. |
| 3 | Provision **`SENTRY_DSN`** | **PROVISION** | Cross-cutting | minutes | `sentryService.cjs` is built, wired, correctly no-opping. **Production has no crash reporting today.** |
| 4 | Obtain an **operator session** | **VERIFY** | Hosting, Cloud | minutes | Unblocks 12 surfaces at once — the single largest UNKNOWN block in the audit. |

**Tier 0 requires no code. It converts two OSes from unverifiable to measurable and restores the AI layer.**

### TIER 1 — Highest founder value

| # | Action | Category | OS | Effort | Why |
|---|---|---|---|---|---|
| 5 | Decide on **10 legacy fabricated distribution records** (18,780 phantom reach) | **FIX** | Marketing | small | New fabrication is stopped, but `/distrib/analytics` still aggregates pre-fix records. I did **not** silently rewrite persisted data — that is the founder's call: purge, flag, or retain-and-label. |
| 6 | Provision **SMTP** | **PROVISION** | Communication | small | All 5 transport vars unset. Campaign management already works end-to-end. |
| 7 | Seed a **populated tenant** | **VERIFY** | Business, Enterprise, Developer | small | Converts ~450 "empty state" endpoints from UNKNOWN into verified. |
| 8 | Run a **real payment transaction** | **VERIFY** | Business | small | Razorpay keys are provisioned; the transaction path is untested. |

### TIER 2 — Complete the picture

| # | Action | Category | OS | Effort |
|---|---|---|---|---|
| 9 | Provision **Firebase** (push) | PROVISION | Communication | small |
| 10 | Provision **SMS provider** | PROVISION | Communication | small |
| 11 | Provision **IdP** for SSO/SCIM | PROVISION | Enterprise | medium |
| 12 | Exercise **patch → test → apply** pipeline | VERIFY | Developer | medium |
| 13 | Exercise **Agent Factory**, **memory index** | VERIFY | AI | medium |
| 14 | Exercise **Creative Studio** (61 endpoints, never executed) | VERIFY | Marketing | medium |

### TIER 3 — Cleanup and clarification

| # | Action | Category | OS | Effort |
|---|---|---|---|---|
| 15 | **ARCHIVE** 3 dead prototypes (~3,052 LOC) | **ARCHIVE** | Enterprise, Developer | small |
| 16 | Archive/delete the other 26 unreferenced components (~8,500 LOC) | ARCHIVE | Cross-cutting | small |
| 17 | Clarify whether **L8/L9/L10 simulation layers** are product capability | VERIFY | Cloud | decision |
| 18 | Confirm `/infra/dashboard` **global scope is by design** | VERIFY | Cloud | decision |
| 19 | **Platform connectors** for real distribution publishing | PROVISION + integrate | Marketing | large |

---

## Category totals

| Category | Items | Engineering required |
|---|---:|---|
| **RECOVER** | 30 (already working) | none |
| **FIX** | 5 (4 done, 1 pending decision) | minimal |
| **PROVISION** | 8 | none |
| **VERIFY** | 27 | none (access/fixtures) |
| **ARCHIVE** | 3 + 26 | none |
| **BUILD** | **0** | — |

---

## Effort-vs-value

**The four highest-value actions are all Tier 0 and involve no code at all.** Two API keys, one DSN, and one operator login would:
- restore AI generation across two OSes
- turn on production crash reporting
- convert 12 UNKNOWN surfaces into measurable ones

That is the honest headline: **this platform's nearest constraint is configuration, not engineering.**

---

## Explicitly NOT recommended

- ❌ Building `/enterprise/orgs` CRUD — `/orgs/*` already does it (verified by creating a dept + team)
- ❌ Building `/dev/*` — `/engineering/*` + `/coding/*` already do it
- ❌ Building `/personal/*` — `/planning/*` + `/twin/*` + `/assistant/*` already do it
- ❌ Wiring any dead prototype into navigation — produces 22 immediate 404s
- ❌ Rebuilding distribution — the orchestration is real; only connectors are missing
- ❌ Weakening tenant isolation — 12/12 denial is the strongest result in the audit
- ❌ Rewriting the 10 legacy distribution records without authorization
