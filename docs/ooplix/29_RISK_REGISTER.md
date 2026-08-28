# 29 — Risk Register (consolidated)

**Update (2026-08-28):** risks #1-3 (the P0 cross-tenant findings) are now
FIXED and regression-tested — see `28_REMAINING_BACKLOG.md` and commit
`ce6862e0`. Rows preserved below as the historical record; severity/
likelihood columns reflect the pre-fix state, not current risk.

| # | Risk | Severity | Likelihood if untreated | Domain | Cross-reference |
|---|---|---|---|---|---|
| 1 | ~~Cross-tenant mission read/cancel (destructive write)~~ — **FIXED 2026-08-28** | P0 | High — any authenticated user can exploit today | Security/Tenant | `09_TENANT_ISOLATION.md`, `11_MISSION_AUTOMATION.md` |
| 2 | ~~Cross-tenant billing read/write on `/cbeta/billing/*`~~ — **was already fixed pre-dating this register (2026-08-22)** | P0 | High | Security/Billing | `15_BILLING_PAYMENTS.md` |
| 3 | ~~Cross-tenant memory read/write~~ — **FIXED 2026-08-28** (write side already fixed 2026-08-22; read side fixed this pass) | P0 | High | Security/Memory | `12_MEMORY_KNOWLEDGE.md` |
| 4 | Unbounded PM2 log growth | P1 | Medium (disk exhaustion over time) | Infrastructure | `19_INFRASTRUCTURE.md` |
| 5 | Weak backup script (`backup.sh`) remains the documented default | P1 | Medium (a restore from the weak path would lose data) | Infrastructure/DR | `22_DISASTER_RECOVERY.md` |
| 6 | Offsite backup possibly unconfigured (2 env vars unconfirmed) | P1 | Medium-high if VPS is lost | Infrastructure/DR | `22_DISASTER_RECOVERY.md` |
| 7 | RBAC frontend visibility parity gap | P1 | Medium (confusing/insecure-feeling UX, not a backend bypass) | UX/Security | `16_FRONTEND_UX.md` |
| 8 | Unthrottled repo-mutating routes (pipeline/engineering) | P1 | Low-medium (requires an authenticated operator or account holder) | Security | `07_SECURITY_MODEL.md` |
| 9 | Electron `shell-exec` has no command/path allowlist | P1 | Low (requires a compromised renderer, standard Electron trust model) | Electron | `18_ELECTRON.md` |
| 10 | Majority of `tests/legacy/`/`integration/`/`smoke/` untracked in git | P2 | Low-medium (only realized if the one machine holding them is lost) | CI/Test | `21_TESTING_STRATEGY.md` |
| 11 | Missions 51-71 have no audit-trail report/register entries | P2 | Certain (already happened); risk is to future auditability, not runtime | Process | `evidence/missions/mission-51-71-index.md` |
| 12 | Electron Mission 53/54 hardening has no report file | P2 | Same as above | Process | `18_ELECTRON.md` |
| 13 | MRR figures disagree across Executive/Finance OS | P2 | Medium (business decision-making risk, not security) | Data integrity | `15_BILLING_PAYMENTS.md`, `24_OS_INTEGRATION_MATRIX.md` |
| 14 | 2 destructive actions (MemoryCenter, PluginMarketplace) lack confirmation | P2 | Low-medium (accidental data loss) | UX | `16_FRONTEND_UX.md` |
| 15 | Automation OS's 4/6 trigger types don't fire | P2 | N/A (feature gap, not a live risk) — but could mislead a user who configures an `event`/`webhook`/`threshold` trigger expecting it to work | Product honesty | `11_MISSION_AUTOMATION.md` |
| 16 | No real-device mobile testing ever performed | P2 | Unknown (untested surface) | Mobile | `17_MOBILE.md` |
| 17 | No screen-reader accessibility pass ever performed | P2 | Unknown (untested surface, real users with assistive tech may be blocked) | Accessibility | `16_FRONTEND_UX.md` |
| 18 | Windows Electron builds effectively unsigned without a build-time cert | P3 | Low (fails closed on auto-update, not a silent risk) | Electron | `18_ELECTRON.md` |
| 19 | CLAUDE.md §9/§1 both contain stale claims relative to current code | P3 | Certain (already true); risk is to future contributors trusting stale docs | Documentation | `05_ARCHITECTURE.md`, `21_TESTING_STRATEGY.md` |
| 20 | Integration connector count discrepancy (44 vs 57+/62 cited elsewhere) | P3 | Low (a reporting/counting inconsistency, not a functional risk) | Documentation | `14_INTEGRATION_CATALOG.md` |

## Top 3 risks — RESOLVED 2026-08-28

1. Cross-tenant mission cancel (#1) — FIXED. Was the only finding in this
   entire audit that permitted a destructive cross-tenant write, not merely
   a read.
2. Cross-tenant billing read/write (#2) — was already fixed pre-dating this
   register.
3. Cross-tenant memory read/write (#3) — FIXED (write side pre-dated this
   register; read side fixed 2026-08-28, with a known accepted tradeoff on
   legacy pre-existing records — see `28_REMAINING_BACKLOG.md`).

None of the three required a large architectural rebuild, confirming the
original assessment — each had a clearly scoped remediation shape (route-
level ownership checks + creation-time stamping, no schema/backfill needed
for missions since `orgId` was already optional; an additive optional field
for memory).

**Current top risks are now #4-9** (PM2 log rotation, weak default backup
script, offsite backup env vars unconfirmed, RBAC frontend visibility
parity, unthrottled repo-mutating routes, Electron `shell-exec` allowlist)
— none re-verified this pass.
