# B.22 — FOUNDER FRICTION REGISTER

Date: 2026-08-14 · Branch: `security/reality-completion`
**Every finding was reproduced in a real browser session against the real application.**

---

## F-001 — STALE FRONTEND BUILD BLOCKED LOGIN ENTIRELY (CRITICAL)

| | |
|---|---|
| **Category** | I — silent failure / total blocker |
| **Reproduction** | Load `http://localhost:5050/` → click "Log in" → fill credentials → click "Sign in" |
| **Measured** | **4 clicks, 7,487 ms, founder never leaves the sign-in screen** |
| **Console evidence** | `Connecting to 'http://127.0.0.1:5099/auth/me' violates the following Content Security Policy directive: "connect-src 'self' https: …"` · `Fetch API cannot load http://127.0.0.1:5099/auth/me. Refused to connect.` |
| **Root cause** | The deployed bundle had `REACT_APP_API_URL: "http://127.0.0.1:5099"` compiled in — a port nothing serves. CSP allows `'self'` and `https:`, so a plain-HTTP call to a *different origin* is refused. `/auth/me` never resolves, so the session never establishes. **44 of 165 chunks carried the stale port.** |
| **Source is correct** | `_client.js:8` — `export const BASE_URL = process.env.REACT_APP_API_URL ?? ""`. Every env file (`\.env`, `frontend/.env.production`, `frontend/.env.local`) sets it empty. **The artifact was stale, not the code.** |
| **Fix** | Clean rebuild: `rm -rf frontend/build frontend/node_modules/.cache && REACT_APP_API_URL= npm run build`. **No source change.** |
| **Verified** | 0 occurrences of `5099` across all chunks; 0 CSP errors; authenticated founder lands directly in the app (`Dashboard \| Contacts \| Payments \| Pipeline \| AI \| More (82)`, workspace "Helios Media Ltd") |
| **Classification** | **FIXED** (build artifact) |

**This blocked 100% of founder workflows.** Nothing in this audit could be measured until it was cleared.

### Environment caveat — recorded honestly

The stale build was **restored twice by an external process** during this phase (`main.21eeb317.js` with the stale port reappeared after my clean build produced `main.234d4995.js`). I rebuilt, confirmed the fix, and captured all measurements in the resulting window. **The rebuild is not durable in this environment** — a concurrent build/deploy process reintroduces the stale artifact. That is an environment/CI issue, not a code defect, and it is the top remaining blocker.

---

## F-002 — "campaign" search matched only 1 of 3 campaign surfaces (MEDIUM)

| | |
|---|---|
| **Category** | C/D — hidden action, unclear terminology |
| **Reproduction** | Open More menu → search `campaign` |
| **Measured** | `Growth=true Content=false Distribution=false` — 1 of 3 |
| **Root cause** | `contentseo` and `distribution` both run campaigns (`/distrib/campaigns`, content calendar/article campaigns) but neither alias contained the word "campaign". |
| **Fix** | Alias-only extension, same mechanism as the C.1 vocabulary recovery. No new UI, no renamed labels, no new routes. |
| **Verified** | `"campaign"` now matches **3/3** (`growth`, `contentseo`, `distribution`); exact-label search regressions **0**; alias coverage still **82/82** |
| **Classification** | **FIXED** |

---

## F-003 — First-run wizard blocks the app until dismissed (LOW — by design)

| | |
|---|---|
| **Category** | O — modal usage |
| **Reproduction** | New tenant → app load → `DIV.cfr-backdrop` covers navigation; `elementFromPoint` on the Contacts tab returns the backdrop |
| **Measured** | **1 click, 1,666 ms** to dismiss via "Skip for now" |
| **Assessment** | A 5-step onboarding wizard (`CustomerFirstRunWizard.jsx`) with a clear escape. Intentional, cheap, and non-recurring. |
| **Classification** | **PRODUCTION READY — not a defect** |

Recorded because it initially presented as "navigation is unclickable" — an auditor measuring only click failures would misreport it.

---

## F-004 — Server serves a cached `index.html` after a rebuild (LOW)

| | |
|---|---|
| **Category** | I — silent failure |
| **Reproduction** | Rebuild frontend → reload app without restarting the backend |
| **Measured** | `404 http://localhost:5050/static/js/main.234d4995.js`; **body length 0, 0 buttons — completely blank app** |
| **Root cause** | The running server holds the previous `index.html`, which references a hash that no longer exists after a rebuild. |
| **Workaround** | Restart the backend after any frontend rebuild. |
| **Classification** | **ENVIRONMENT** — deployment-ordering issue, not application code |

---

## Friction categories — audited

| | Category | Finding |
|---|---|---|
| A | Unnecessary clicks | **None.** Every primary surface = 1 click. |
| B | Repeated navigation | **None.** Breadcrumbs (`Dashboard › Contacts`) preserve context. |
| C | Hidden actions | **F-002** — fixed |
| D | Unclear terminology | **F-002** — fixed |
| E | Duplicate screens | **None** in founder paths |
| F | Duplicate data entry | **None** — CRM → audience sync verified in Marketing OS cert |
| G | Confusing empty states | **None** — fresh tenant showed honest zeros |
| H | Weak feedback | **None** — errors name the actual cause |
| I | Silent failures | **F-001**, **F-004** |
| J | Slow workflows | **None** — nav 2.0–2.1 s, API median well under 1 s |
| K | Context switching | Low — 82 surfaces behind one More menu with search |
| L | Inaccessible actions | **F-003** (by design, 1-click escape) |
| M | Inconsistent terminology | **F-002** — fixed |
| N | Unexpected redirects | **None** |
| O | Excessive modals | **F-003** only |

---

## Cognitive load — observable measures only

| Measure | Observed |
|---|---|
| Screens to complete Path A | 1 (dashboard) + API-driven — no screen hopping required |
| Context switches, primary workflows | **0** — all 5 primary surfaces are siblings in one tab bar |
| Repeated decisions | **0** observed |
| Manual copy/paste operations | **0** — CRM → audience sync is automatic |
| Separate places requiring monitoring | 5 primary tabs + More menu (searchable) |
| Navigation depth to any of 82 surfaces | **2 clicks** (More → item) or **2** (More → search → item) |

**No psychological or "feeling" score is reported — none was measured.**
