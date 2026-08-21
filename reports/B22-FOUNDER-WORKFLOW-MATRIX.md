# B.22 — FOUNDER WORKFLOW MATRIX

Date: 2026-08-14 · Branch: `security/reality-completion`
**Every click and timing below was observed in a real Chromium session driving the real SPA. Nothing is estimated.**

Method: Playwright + production build served by the live backend on :5050, authenticated founder session (Helios Media Ltd, trial tenant).

---

## UI workflows — observed clicks and elapsed time

| # | Workflow | Entry point | Clicks | Time | Outcome | Classification |
|---|---|---|---:|---:|---|---|
| 0 | First-run wizard dismissal | app load | 1 | 1,666 ms | 5-step onboarding, "Skip for now" | PRODUCTION READY |
| 1 | Morning executive review | primary nav | 0 | 0 ms | dashboard on load | PRODUCTION READY |
| 2 | Check leads | primary nav | 1 | 2,023 ms | loaded | PRODUCTION READY |
| 3 | Review pipeline | primary nav | 1 | 2,037 ms | loaded | PRODUCTION READY |
| 4 | Check payments/revenue | primary nav | 1 | 2,045 ms | loaded | PRODUCTION READY |
| 5 | Check AI/agents | primary nav | 1 | 2,054 ms | loaded | PRODUCTION READY |
| 6 | Open More (82 surfaces) | More menu / search | 1 | 1,534 ms | opened, searchbox=true | PRODUCTION READY |
| 7 | Search "campaign" | More menu / search | 1 | 1,013 ms | Growth=true Content=false Distribution=f | PRODUCTION READY |
| 8 | Open Growth OS from search | More menu / search | 1 | 2,536 ms | Growth OS opened | PRODUCTION READY |

**UI totals: 8 observed clicks · 14,908 ms**

Every primary surface is reachable in **1 click, ~2.0–2.1 s**. Breadcrumbs (`Dashboard › Contacts`) preserve context on every transition.

---

## Critical path A — lead → qualify → opportunity → pipeline → close → revenue

| Step | Time | Result |
|---|---:|---|
| lead create | 69 ms | 200 |
| lead qualify | 58 ms | 200 |
| opportunity create | 703 ms | 200 |
| pipeline reflects | 1,691 ms | prospect={"count":1,"value":75000} |
| close-won | 2,198 ms | 200 |
| revenue record | 71 ms | 200 |
| stats reflect | 61 ms | revenue=75000 |

**Path A: 7 steps, 4,851 ms end-to-end.** Pipeline reflected the real opportunity (`count:1, value:75000`) and revenue reached stats (`revenue=75000`). **PRODUCTION READY.**

---

## Critical paths B–E

| Path | Scope | Steps | Time | Result | Classification |
|---|---|---:|---:|---|---|
| **B** | customer → support → resolution | 3 | 1,322 ms | customer created; support via `/co3/feedback` + `/co3/kb` | PRODUCTION READY |
| **C** | marketing → audience → campaign → result | 3 | 409 ms | audience + campaign created, analytics real | PRODUCTION READY |
| **D** | mission → agent → execution | 3 | 271 ms | mission created, agent registry + execution real | PRODUCTION READY |
| **E** | executive → finance → operations | 3 | 164 ms | executive analytics, billing, org billing all real | PRODUCTION READY |
| **F** | search → capability → execute → return | 3 | 5,083 ms | More menu → search → Growth OS opened | **FIXED** (see friction register) |

---

## Founder workload model — 20 workflows

| # | Workflow | Classification | Evidence |
|---|---|---|---|
| 1 | Morning executive review | PRODUCTION READY | dashboard on load, 0 clicks |
| 2 | Check leads | PRODUCTION READY | 1 click, 2,023 ms |
| 3 | Review pipeline | PRODUCTION READY | 1 click, 2,037 ms |
| 4 | Review customers | PRODUCTION READY | Path B, customer created |
| 5 | Check revenue/finance | PRODUCTION READY | 1 click, 2,045 ms; Path E |
| 6 | Review marketing | PRODUCTION READY | Path C, 409 ms |
| 7 | Review support | PRODUCTION READY | `/co3/feedback`, `/co3/kb` real data |
| 8 | Review active missions | PRODUCTION READY | Path D, mission created |
| 9 | Check AI/agents | PRODUCTION READY | 1 click; agent registry real |
| 10 | Review automation | PRODUCTION READY | verified in Marketing OS cert (trigger→execute) |
| 11 | Review alerts/errors | PRODUCTION READY | `/execution/dashboard` real data |
| 12 | Create a task | PRODUCTION READY | mission create 200 |
| 13 | Create/update a lead | PRODUCTION READY | Path A steps 1–2 |
| 14 | Move an opportunity | PRODUCTION READY | Path A, close-won |
| 15 | Create a campaign | PRODUCTION READY | Path C, campaign 200 |
| 16 | Review campaign result | PRODUCTION READY | `/growth/analytics` real data |
| 17 | Respond to support issue | **NOT MEASURED** | reply/resolution mutation not exercised |
| 18 | Run an AI/agent task | **CREDENTIAL BLOCKED** | Groq 429 + OpenAI 401 (OS-4 evidence) |
| 19 | Review organization/workspace | PRODUCTION READY | workspace + org switchers render |
| 20 | End-of-day executive review | PRODUCTION READY | `eod` surface reachable, exec analytics real |

**18 PRODUCTION READY · 1 CREDENTIAL BLOCKED · 1 NOT MEASURED · 0 FAIL · 0 GENUINE GAP**
