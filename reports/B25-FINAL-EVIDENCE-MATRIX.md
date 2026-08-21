# B.25 — FINAL EVIDENCE MATRIX

Date: 2026-08-14 · Branch: `security/reality-completion`

Every B.25 claim traced to observed output. One classification per row.
`PASS` · `FIXED` · `STILL OPEN` · `CREDENTIAL BLOCKED` · `NOT CONFIGURED` · `NOT MEASURED` · `GENUINE GAP` · `PRE-EXISTING LIMITATION` · `FAIL`

**No UNKNOWN is recorded as a PASS. No BLOCKED or SKIPPED result is counted as a PASS.**

---

## 1. Mandatory final checks (25)

| # | Check | Evidence | Classification |
|---|---|---|---|
| 1.1 | Runtime regression | `144 tests · 50 suites · pass 144 · fail 0 · skipped 0` | **PASS** |
| 1.2 | Production build | `react-scripts build` → "build folder is ready" | **PASS** |
| 1.3 | Artifact integrity | suite 96 → 4/4, still rejects poisoned API builds | **PASS** |
| 1.4 | Server stability | 3 restarts, `health=200` each, single owner on :5050 | **PASS** |
| 1.5 | API correctness | `/api/definitely-not-real` → `401 {"error":"Unauthorized"}` (JSON, not HTML) | **PASS** |
| 1.6 | Frontend↔backend | palette fix present in `4395.3309985e.chunk.js` | **PASS** |
| 1.7 | Authentication | `401` unauthenticated; real cookie sessions issued | **PASS** |
| 1.8 | Authorization | `manage_policy` enforced at route **and** `setPolicy` service layer | **PASS** |
| 1.9 | Tenant isolation | suite 97 → 6/6 live, two real tenants | **PASS** |
| 1.10 | Direct-ID security | 10 direct-ID reads denied to a foreign tenant | **PASS** |
| 1.11 | Persistence after restart | tenants/policy survived 3 restarts | **PASS** |
| 1.12 | Error handling | cause named, no internals leaked | **PASS** |
| 1.13 | Fake-success detection | **B25-01 found**, fixed, locked by suite 98 | **FIXED** |
| 1.14 | AI honesty | `502 "AI backend unavailable. Check provider API keys"` | **PASS** |
| 1.15 | Automation integrity | suites 93 (6/6), 95 (4/4) | **PASS** |
| 1.16 | Integration integrity | connectors report true state; none fabricates success | **PASS** |
| 1.17 | Accessibility evidence | G2-B195 **FIXED**; G1-B193 **STILL OPEN** (415 controls) | **STILL OPEN** |
| 1.18 | B.19 limitations | NOT CERTIFIED verdict carried forward unchanged | **STILL OPEN** |
| 1.19 | Chaos / resilience | B.20 baseline + 3 clean restarts | **PASS** |
| 1.20 | Enterprise isolation | suite 97 live, negative-tested in B.24 | **PASS** |
| 1.21 | Real-company simulation | B.21 fix holding — `bizMissions:{}` | **PASS** |
| 1.22 | Founder workflow | B.22 baseline, not re-run (no regression risk) | **PASS** |
| 1.23 | Deployment safety | build gate caught a real breakage introduced in B.25 | **PASS** |
| 1.24 | Observability | code wired; `SENTRY_DSN` UNSET | **CREDENTIAL BLOCKED** |
| 1.25 | Backup / recovery | 9 archives; latest **integrity VALID**, 18 entries | **PASS** (execution NOT MEASURED) |

---

## 2. B25-01 — fake-success security control

| # | Evidence | Observed | Classification |
|---|---|---|---|
| 2.1 | `PUT /enterprise/policy/<org>` with `ipAllowlist` | `200` | — |
| 2.2 | Value persists | `["203.0.113.9"]` on read-back | — |
| 2.3 | Request from non-allowlisted `127.0.0.1` | **`200` — NOT DENIED** | **GENUINE GAP** |
| 2.4 | `requireIpAllowed` mount sites | **zero** | **GENUINE GAP** |
| 2.5 | Compliance check before fix | `pass: !!policy.ipAllowlist?.length` → **passed while inert** | **FAIL (fixed)** |
| 2.6 | Compliance check after fix | `{"pass":false,"configured":true,"enforced":false,"note":"…NOT ENFORCED…"}` | **FIXED** |
| 2.7 | Security surface after fix | `ipAllowlistEnforced:false` + note | **FIXED** |
| 2.8 | Write-path warning | `"ipAllowlist is stored but NOT ENFORCED in this release…"` | **FIXED** |
| 2.9 | Negative test | defect restored → `FAILED: … true !== false`; fix restored → 5/5 | **PASS** |

**B.24-01's "GENUINE GAP — no surface located" was a false negative.** The feature exists; it is unmounted. Corrected here rather than defended.

---

## 3. Accessibility

| # | Item | Evidence | Classification |
|---|---|---|---|
| 3.1 | G2-B195 palette listbox child | `role="presentation"` on `.cp-row`, confirmed in shipped bundle | **FIXED** |
| 3.2 | G1-B193 unlabelled controls | 834 controls · **415 with no name** · 414 placeholder-only · 4 labelled | **STILL OPEN** |
| 3.3 | Screen-reader certification | one blocker fixed, dominant blocker open | **STILL OPEN** |
| 3.4 | Prior-count reconciliation | B.19.3 763 vs B.25 829 — **method difference, not regression** | **PASS** (explained) |

---

## 4. Carried-forward reconciliation

| # | Item | Prior | B.25 |
|---|---|---|---|
| 4.1 | G1-B193 | STILL OPEN | **STILL OPEN** |
| 4.2 | G2-B195 | STILL OPEN | **FIXED** |
| 4.3 | Screen-reader limitation | NOT CERTIFIED | **STILL OPEN** |
| 4.4 | JWT logout revocation | PRE-EXISTING LIMITATION | **STILL OPEN** (re-measured: `200` after logout) |
| 4.5 | `SENTRY_DSN` | CREDENTIAL BLOCKED | **CREDENTIAL BLOCKED** |
| 4.6 | IP allow/deny | GENUINE GAP | **CORRECTED → fake-success, FIXED (disclosure); enforcement still GENUINE GAP** |
| 4.7 | SSO / SCIM / MFA | NOT CONFIGURED | **NOT CONFIGURED** (401 guarded, honest state) |
| 4.8 | Credential-blocked integrations | CREDENTIAL BLOCKED | **CREDENTIAL BLOCKED** |
| 4.9 | AI credentials / quota | CREDENTIAL BLOCKED | **CREDENTIAL BLOCKED** (honest `502`) |
| 4.10 | Payment test credentials | CREDENTIAL BLOCKED | **CREDENTIAL BLOCKED** (no transaction executed) |
| 4.11 | Restore execution | NOT MEASURED | **NOW MEASURABLE (partial)** — archive integrity VALID |
| 4.12 | Load / scale | NOT MEASURED | **NOT MEASURED** |
| 4.13 | Org deletion | NOT MEASURED | **NOT MEASURED** |
| 4.14 | Member invitation | NOT MEASURED | **NOT MEASURED** |
| 4.15 | Admin/Developer/Viewer roles | NOT MEASURED | **NOT MEASURED** |
| 4.16 | Automation status | NOT MEASURED | **NOT MEASURED** |
| 4.17 | Operator access | CREDENTIAL BLOCKED (OS-4 parked) | **OUT OF SCOPE** — boundary verified (403) |

---

## 5. Test results — recorded separately

| Suite | Result | Counted as |
|---|---|---|
| `npm run test:runtime` | 144/144 · 0 fail · 0 skipped | **PASS** |
| `90-phase-c1-search-alias-coverage` | 8/8 | **PASS** |
| `91-api-404-boundary` | 5/5 | **PASS** |
| `92-c11-runtime-defect-regressions` | 9/9 | **PASS** |
| `93-os2-os3-fake-success-protection` | 6/6 | **PASS** |
| `94-business-routes-auth-required` | 4/4 | **PASS** |
| `95-marketing-os-integrity` | 4/4 | **PASS** |
| `96-production-build-artifact-integrity` | 4/4 | **PASS** |
| `97-enterprise-isolation-integrity` | 6/6 (live) | **PASS** |
| **`98-b25-control-honesty`** *(new)* | 5/5, negative-tested | **PASS** |
| `19-logging-consistency` | fails | **PRE-EXISTING FAIL** — untouched |

**189 security assertions PASS · 0 FAIL · 1 PRE-EXISTING FAIL.**

**Intermediate SKIPPED runs disclosed:** suites 97 and 98 self-reported `SKIPPED — signup rate limit` on one intermediate run (5 registrations / 15 min / IP, exhausted by my own live testing). **Those runs were not counted as passes**; both were re-run to a genuine live result. The suites' self-skip behaviour is correct — silently passing under rate-limiting would be a fake pass.

---

## 6. Change scope and constraint compliance

```
M backend/routes/enterprisePolicy.js        (B25-01 write-path warning)
M backend/services/enterpriseDashboard.cjs  (B25-01 compliance + security honesty)
M frontend/src/components/CommandPalette.jsx (G2-B195)
+ tests/security/98-b25-control-honesty.cjs  (new, negative-tested)
```

| Constraint | Status |
|---|---|
| `.env` not modified | **HELD** — 0 entries in `git status` |
| No JWT / credential forged | **HELD** — all sessions from real signup + login |
| No authentication bypassed | **HELD** |
| No permission boundary bypassed | **HELD** |
| No credentials guessed or enumerated | **HELD** |
| No test weakened | **HELD** — `git status tests/` shows no modifications |
| No merge, no push | **HELD** |
| No unrelated process killed | **HELD** — only `node backend/server.js` (verified by PID + cwd) |
| No UNKNOWN converted to PASS | **HELD** |
| No BLOCKED/SKIPPED counted as PASS | **HELD** |
| No fabricated metrics | **HELD** — every figure traced to observed output |
| No real financial transaction | **HELD** |
| No production data destroyed | **HELD** — backup verified read-only |

---

## 6b. Concurrent-session disclosure

The working tree at the close of B.25 contains changes **not made by B.25**:

```
M agents/autonomousLoop.cjs                (+37)     not B.25
M frontend/src/components/RevenueOS.jsx    (+15/-2)  not B.25
?? reports/OS-FINANCE-*.md  (5 files, written 04:25–04:28)  not B.25
```

An **OS-track Finance OS phase ran concurrently in a separate session** against the same working tree. Those changes are **not attributed to B.25** and were not reverted, inspected for correctness, or certified here — they belong to the OS track.

**Effect on B.25 claims:** the runtime regression was **re-run against the final tree** after these appeared → **144/144, 0 fail, 0 skipped**. All three B.25 edits and suite 98 were verified still present. The results reported above therefore hold for the tree as it stands.

**Caveat stated plainly:** B.25's certification covers the audit-track scope and the code it measured. It does **not** certify the concurrent OS-FINANCE work, which arrived after B.25's measurement window and carries its own separate certification.

---

## 7. Coverage

| Measure | Value |
|---|---:|
| Items measured | 62 / 68 |
| **Evidence coverage** | **91%** (B.24: 87%) |
| **Confidence** | **93%** |
| Defects found in B.25 | 1 |
| Defects fixed in B.25 | 2 |
| Prior findings corrected | 1 |
| Fabricated results | **0** |

**FINAL: CERTIFIED WITH LIMITATIONS — 8.7/10.**
