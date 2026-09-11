# OS-4 CAPABILITY MATRIX

Date: 2026-08-13
Every capability carries **exactly one** classification.

Classifications: `PRODUCTION READY` · `FIXED` · `RECOVERABLE` · `VERIFY` · `CREDENTIAL BLOCKED` · `UNKNOWN` · `ARCHIVE CANDIDATE` · `GENUINE CAPABILITY GAP`

---

## HOSTING OS

| Capability | Backend | Frontend | Nav | Search | Data | Auth | Live status | Classification |
|---|---|---|---|---|---|---|---|---|
| Runtime status | ✅ | ✅ runtime | ✅ | ✅ | ✅ real queue + agents | user | 200, real | **PRODUCTION READY** |
| Runtime history | ✅ | ✅ | ✅ | ✅ | ✅ real entries | user | 200, real | **PRODUCTION READY** |
| Docker health | ✅ | ✅ devops | ✅ | ✅ | ✅ **matches host daemon** | user | 200, real | **PRODUCTION READY** |
| Docker images | ✅ | ✅ | ✅ | ✅ | ✅ **cross-checked vs `docker images`** | user | 200, real | **PRODUCTION READY** |
| Docker containers | ✅ | ✅ | ✅ | ✅ | ✅ real (empty) | user | 200 | **PRODUCTION READY** |
| Docker dashboard | ✅ | ✅ | ✅ | ✅ | ✅ real daemon block | user | 200, real | **PRODUCTION READY** |
| VPS provisioning | ✅ | ✅ | ✅ | ✅ | ? | **operator** | 403 | **UNKNOWN** |
| Deployment targets | ✅ | ✅ | ✅ | ✅ | ? | **operator** | 403 | **UNKNOWN** |
| Deployment active | ✅ | ✅ | ✅ | ✅ | ? | **operator** | 403 | **UNKNOWN** |
| Ops health / stats | ✅ | ✅ | ✅ | ✅ | ? | **operator** | 403 | **UNKNOWN** |
| Infra deploy / monitor / security / db | ✅ | ✅ | ✅ | ✅ | ? | **operator** | 403 | **UNKNOWN** |

## CLOUD OS

| Capability | Backend | Frontend | Nav | Search | Data | Auth | Live status | Classification |
|---|---|---|---|---|---|---|---|---|
| Platform status / summary | ✅ | ✅ | ✅ | ✅ | ✅ real agents + analytics | user | 200, real | **PRODUCTION READY** |
| Ecosystem L8 dashboard | ✅ | ✅ orglevel-eco | ✅ | ✅ | ✅ **578 real records, ~52% test residue** | user | 200 | **VERIFY** |
| Workspace mesh dashboard | ✅ | ✅ | ✅ | ✅ | ✅ 17 workspaces, 40 executions; global by design | user | 200 | **PRODUCTION READY** |
| Infra dashboard | ✅ | ✅ | ✅ | ✅ | ✅ real; **global by design** (no orgId field, identical across tenants) | user | 200 | **PRODUCTION READY** |
| Physical / org-network dashboards | ✅ | ✅ | ✅ | ✅ | ✅ real; global platform dashboards, **no tenant leak** (neither probe org appears) | user | 200 | **PRODUCTION READY** |
| Extensions runtime | ✅ | ✅ | ✅ | ✅ | ✅ honest empty (runtime/metrics/hooks/quotas all 200 in 70–86ms) | user | 200 | **PRODUCTION READY** |
| Marketplace / plugins | ✅ | ✅ marketplace | ✅ | ✅ | n/a | plan-gated | **402 honest** | **CREDENTIAL BLOCKED** |
| Integrations | ✅ | ✅ | ✅ | ✅ | ? | **operator** | 403 | **UNKNOWN** |
| Vault dashboard / env status | ✅ | ✅ | ✅ | ✅ | ? | **operator** | 403 | **UNKNOWN** |

## CROSS-CUTTING — fixed this phase

| Capability | Defect | Classification |
|---|---|---|
| Distribution analytics | reported fabricated reach/engagement as measured | **FIXED** |
| Product validation avgScore | 234 on a 0–100 scale | **FIXED** |

---

## Totals — updated by the OS-4 continuation run

| Classification | Count | Change |
|---|---:|---|
| **PRODUCTION READY** | **13** | +4 (infra dashboard, extensions, physical/org-network, workspace mesh) |
| FIXED | 2 | — |
| **VERIFY** | **2** | −4 (ecosystem test residue, distribution legacy residue) |
| CREDENTIAL BLOCKED | 1 | — |
| **UNKNOWN** | **12** | unchanged — operator access still unavailable |
| ARCHIVE CANDIDATE | 0 new (3 carried forward) | — |
| **GENUINE CAPABILITY GAP** | **0** | — |
| RECOVERABLE | 0 | — |

**Total: 30 capabilities.** No capability appears in two categories.

### Reclassified this run (VERIFY → PRODUCTION READY)

| Capability | Evidence |
|---|---|
| Infra dashboard | No `orgId`/`tenantId` field; byte-identical across two tenants after normalising timestamps → global infrastructure telemetry, correct by design |
| Extensions runtime | All four endpoints (`runtime`, `metrics`, `hooks`, `quotas`) return 200 in 70–86 ms. Earlier timeouts were server-wide event-loop stalls, **not** an extensions defect |
| Physical / org-network dashboards | Identical across tenants after timestamp normalisation; the 20 org IDs in `/org-network` are network-registry entries and **neither probe org appears** → no tenant leak |
| Workspace mesh dashboard | 17 workspaces / 40 executions, global platform view, consistent across tenants |

### Still VERIFY (2) — product decisions, not code defects

| Capability | Open question |
|---|---|
| Ecosystem tenant population | 644 persisted records (was 578 at OS-4 start — benchmarks keep adding). ~52% carry test-harness names. Purge, label as demo data, or accept? |
| Distribution legacy residue | 3 org-scoped jobs holding 7,860 phantom reach, now quarantined under `legacy` and excluded from headline metrics. Purge or retain-and-label? |
