# OS-DEVELOPER — CAPABILITY MATRIX

**Date:** 2026-08-14 · **Verification port:** 5088 · **Regression:** 144/144 before and after

Every status is backed by an executed request or executed code path recorded in
`OS-DEVELOPER-WORKFLOW-EVIDENCE.md` / `OS-DEVELOPER-SECURITY-EVIDENCE.md`.
A 200 was never treated as "working" on its own — response bodies were inspected, and several
capabilities returning 200 are classified below as defective.

**Legend:** PROD = Production Ready · FIXED = defect corrected this pass · WIRED = frontend↔backend
verified · CRED = Credential Blocked · ENV = Environment Blocked · GAP = Genuine Gap ·
ARCHIVE = dead code · NOT MEASURED = not exercised

---

## A. Project / Workspace / Repository

| # | Capability | Status | Evidence |
|---|---|---|---|
| 1 | Workspace list / CRUD | **PROD** | `GET /workspace` 200 — real workspace returned |
| 2 | Workspace membership gating | **PROD** | Non-member → 403 across `/revenue/*`-style guards |
| 3 | Workspace switch / invite | **NOT MEASURED** | Routes exist; not exercised (no second member) |
| 4 | Git status / branch | **PROD (Electron)** | Handler logic executed: real branch + 33 files |
| 5 | Git diff (injection-safe) | **PROD (Electron)** | argv-separated filename in `main.cjs` |
| 6 | Git log / branches / checkout / commit | **ENV** | Implemented as Electron IPC; unavailable in browser build |
| 7 | Repository health metrics | **PROD** | `/engineering/intelligence` → score 53, grade C |
| 8 | GitHub integration (`/p23/github/*`) | **CRED** | Requires GitHub token; not exercised |

## B. Code Workspace / Editor

| # | Capability | Status | Evidence |
|---|---|---|---|
| 9 | CodeEditorPane | **WIRED** | 4 references; inside ElectronWorkspace |
| 10 | File read (path-traversal guarded) | **PROD** | `../../.env` → `path_traversal_detected`, no leak |
| 11 | ElectronWorkspace shell | **WIRED** | 5 references — hosts editor/git/terminal |
| 12 | Terminal execution (allowlisted) | **PROD** | Non-allowlisted command → `command_not_allowlisted` |

## C. Code Analysis

| # | Capability | Status | Evidence |
|---|---|---|---|
| 13 | Code smell engine (9 detectors) | **PROD** | 3,587 findings across 1,052 files in 2.2 s |
| 14 | `todo_fixme` detector accuracy | **FIXED** | Counted prose/data as debt: 15 reported vs 1 real → now 1 |
| 15 | `/coding/smells` performance | **PROD (intact)** | 2.2 s; prior optimization **not regressed** |
| 16 | Dead-export detection | **PROD** | 667 findings |
| 17 | Duplicate literal / long function / sync-fs | **PROD** | 988 / 540 / 479 findings |
| 18 | Coding decisions (ACP-4) | **PROD** | `/coding/decisions` 200 with real opportunities |
| 19 | Engineering intelligence (9 dimensions) | **PROD** | repoHealth, missionRisk, commitRisk, hotspots… |

## D. AI Engineering

| # | Capability | Status | Evidence |
|---|---|---|---|
| 20 | Code Q&A / explain / review / refactor | **CRED** | `/coding/ask` → honest "AI backend unavailable" |
| 21 | Provider fallback chain | **PROD** | 4 providers attempted, then honest failure — no fabrication |
| 22 | AI failure honesty | **PROD** | Never returns invented content when providers fail |
| 23 | Engineering memory (non-AI) | **PROD** | 2,000 lessons, 2,440 failures, 5 RCAs, 5 rules |

## E. Mission / Runtime

| # | Capability | Status | Evidence |
|---|---|---|---|
| 24 | Mission runtime status | **PROD** | 2,104 missions; byStatus/byPriority/failureRate real |
| 25 | Orchestrator create → stages | **PROD** | Real 5-stage plan generated |
| 26 | Mission state transitions | **PROD** | `planned → active → failed` observed live |
| 27 | **Mission completion honesty** | **FIXED** | Reported `completed` with **all stages failed** → now `failed` |
| 28 | Stage retry (maxRetries) | **PROD** | Stage 3 retried twice before failing |
| 29 | Mission persistence across restart | **FIXED** | Terminal missions were **erased** on restart → 3/3 now survive |
| 30 | Mission timeline / graph / replay | **NOT MEASURED** | Routes exist; not exercised |
| 31 | Mission-git linkage | **NOT MEASURED** | `/mission/git/*` present; requires Electron git |
| 32 | Runtime dispatch | **PROD** | `/runtime/dispatch` executes and returns per-task results |
| 33 | Runtime status / queue | **PROD** | Agents + circuit-breaker state returned |
| 34 | Runtime dispatch envelope honesty | **GAP** | Outer `success:true` while inner result is `blocked` (D-6) |

## F. Agents

| # | Capability | Status | Evidence |
|---|---|---|---|
| 35 | Agent registry / supervisor | **PROD** | Boot log: agents registered incl. `aeo_capability` |
| 36 | Engineering capability registry | **PROD** | Boot: **26** capabilities registered |
| 37 | Capability matrix schema | **PROD** | 26 entries with name/description/category |
| 38 | Agent execution via mission stages | **PROD** | Stages dispatched to loop tasks; real retries |
| 39 | Agent collaboration | **NOT MEASURED** | UI wired; multi-agent handoff not exercised |
| 40 | Agent failure handling | **FIXED** | Was masked by D-1; failures now propagate |

## G. Build / Deploy / DevOps

| # | Capability | Status | Evidence |
|---|---|---|---|
| 41 | Frontend build | **PROD** | `npm run build` succeeds |
| 42 | **Artifact integrity (B.23)** | **FIXED** | Poisoned `REACT_APP_API_URL` reached **44 bundle files**; guard added |
| 43 | Deployment targets | **PROD** | 3 targets with health/rollback/approval profiles |
| 44 | Deployment records | **PROD** | `/deployment/active` returns real deploy history |
| 45 | Deployment execution | **NOT MEASURED** | Not run — would deploy for real |
| 46 | PM7 production tracking | **NOT MEASURED** | Routes exist; operator-gated |

## H. Testing

| # | Capability | Status | Evidence |
|---|---|---|---|
| 47 | Runtime regression suite | **PROD** | **144/144** before and after all fixes |
| 48 | Production hardening suite | **PROD** | 87/87 |
| 49 | Recovery workflow suite | **PROD** | 15/15 |
| 50 | `09-v1-engine-validation` | **GAP (stale test)** | Hardcodes 12 capabilities; registry legitimately has 26 |
| 51 | `auto-v10` suite | **GAP (pre-existing)** | Fails on clean tree — **not** caused by this pass |

## I. Security

| # | Capability | Status | Evidence |
|---|---|---|---|
| 52 | Unauthenticated rejection | **PROD** | 5/5 developer endpoints → 401 |
| 53 | Mission direct-ID access (IDOR) | **PROD** | Non-member → 404 on `/mission/state/:id` |
| 54 | Workspace list isolation | **PROD** | Org A sees `workspaces: []` |
| 55 | **Mission enumeration isolation** | **GAP (HIGH)** | Any authenticated user lists **all** missions — no tenant field (D-5) |
| 56 | Command execution boundary | **PROD** | Allowlist blocks arbitrary commands |
| 57 | Path traversal boundary | **PROD** | `../../.env` → `path_traversal_detected` |
| 58 | Secret exposure | **PROD** | 0 secret matches in any response |

---

## Totals

| Classification | Count |
|---|---:|
| **Production Ready** | **38** |
| **Fixed** (this pass) | **4** |
| Wired (frontend↔backend verified) | 3 |
| Credential Blocked | 2 |
| Environment Blocked | 1 |
| Not Measured | 6 |
| Genuine Gaps | 4 |
| Archive Candidates | 1 |
| **Build Required** | **0** |
| **Total assessed** | **58** |

**No capability was rebuilt.** Four reproducible defects were fixed, each with a negative test
and live re-verification.
