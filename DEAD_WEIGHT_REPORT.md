# DEAD_WEIGHT_REPORT.md

Generated: 2026-05-20 | Confirmed by source inspection and import tracing.

---

## Summary

| Category | Item Count | File Count |
|----------|-----------|-----------|
| Phantom tests | 74 | 74 |
| Dead agent directories | 24 | ~383 |
| Dead root-level agent files | 12 | 12 |
| Dead modules (metaverse, futureTech, infra) | 3 dirs | ~41 |
| Duplicate/stale UI codebases | 2 dirs | ~50 |
| Stale root docs | 25 | 25 |
| Duplicate docs/current | 8 | 8 |
| Dead root-level scripts/orphans | 7 | 7 |
| Dead experimental dirs | 3 dirs | ~30 |
| Electron ghost backend | 5 | 5 |
| Root automation dir | 8 | 8 |
| **Total estimated dead files** | | **~643** |

---

## 1. Phantom Tests

**Category:** Phantom test — requires modules that do not exist on disk.
**Safe to archive:** YES → `tests/legacy/`

### Tests 09–10 (require non-existent module trees)

| File | Missing Modules |
|------|----------------|
| `tests/runtime/09-recovery.test.cjs` | `agents/runtime/recoveryEngine.cjs`, `failureMemory.cjs`, `autonomousWorkflow.cjs` |
| `tests/runtime/10-benchmark.test.cjs` | Same as 09 |

### Tests 13–83 (all require non-existent module trees)

74 files: `tests/runtime/13-planner.test.cjs` through `tests/runtime/83-real-execution-adapter-integration.test.cjs`

Confirmed-missing modules required by these tests:
- `agents/runtime/execution/executionStateMachine.cjs`
- `agents/runtime/execution/executionTelemetry.cjs`
- `agents/runtime/execution/retryEngine.cjs`
- `agents/runtime/recovery/intelligence/*` (6 files)
- `agents/runtime/execution/cancellationManager.cjs`

**Risk level:** LOW — archiving removes false green from test output.

---

## 2. Dead Agent Directories (never wired to agentRegistry or bootstrapRuntime)

| Path | File Count | Why Dead | Risk |
|------|-----------|---------|------|
| `agents/businessPro/` | 23 | Not in bootstrap or agentRegistry | LOW |
| `agents/enterprise/` | 41 | Not in bootstrap or agentRegistry | LOW |
| `agents/education/` | 22 | Not in bootstrap or agentRegistry | LOW |
| `agents/health/` | 43 | Not in bootstrap or agentRegistry | LOW |
| `agents/life/` | 22 | Not in bootstrap or agentRegistry | LOW |
| `agents/humanAI/` | 22 | Not in bootstrap or agentRegistry | LOW |
| `agents/social/` | 21 | Not in bootstrap or agentRegistry | LOW |
| `agents/intelligence/` | 21 | Not in bootstrap or agentRegistry | LOW |
| `agents/legal/` | 17 | Not in bootstrap or agentRegistry | LOW |
| `agents/security/` | 15 | Not in bootstrap or agentRegistry | LOW |
| `agents/governance/` | 14 | Not in bootstrap or agentRegistry | LOW |
| `agents/internet/` | 12 | Not in bootstrap or agentRegistry | LOW |
| `agents/media/` | 39 | Not in bootstrap or agentRegistry | LOW |
| `agents/multi/` | 10 | Not in bootstrap or agentRegistry | LOW |
| `agents/interaction/` | 8 | Not in bootstrap or agentRegistry | LOW |
| `agents/knowledge/` | 3 | Not in bootstrap or agentRegistry | LOW |
| `agents/rag/` | 1 | Not in bootstrap or agentRegistry | LOW |
| `agents/metrics/` | 1 | Not in bootstrap or agentRegistry | LOW |
| `agents/money/` | 2 | Not in bootstrap or agentRegistry | LOW |
| `agents/content/` | 11 | Not in bootstrap or agentRegistry | LOW |
| `agents/business/` | 11 | Superseded by backend/services/ | LOW |
| `agents/core/` | 3 | Not imported by any live file | LOW |
| `agents/dev/` | 11 | Not imported — devAgent.cjs is the live file | LOW |
| `agents/system/` | 2 | Not in runtime chain | LOW |
| `agents/tools/` | 2 | Not in runtime chain | LOW |

**Safe to archive:** YES → `_archive/<timestamp>/agents/`

---

## 3. Dead Root-Level Agent Files (in agents/ root, no runtime import)

| File | Why Dead | Risk |
|------|---------|------|
| `agents/crm.cjs` | Superseded by `backend/services/crmService.js` | LOW |
| `agents/crmAgent.cjs` | Superseded by `backend/services/crmService.js` | LOW |
| `agents/agentRouter.cjs` | Not imported by server.js or runtime chain | LOW |
| `agents/fiverrLeads.cjs` | Not imported by any live file | LOW |
| `agents/googleMapsLeads.cjs` | Not imported by any live file | LOW |
| `agents/instagram.cjs` | Not imported by any live file | LOW |
| `agents/leads.cjs` | Not imported by any live file | LOW |
| `agents/linkedinLeads.cjs` | Not imported by any live file | LOW |
| `agents/marketingAgent.cjs` | Not imported by any live file | LOW |
| `agents/paymentAgent.cjs` | Superseded by backend/services/paymentService.js | LOW |
| `agents/realLeadsEngine.cjs` | Not imported by any live file | LOW |
| `agents/saas.cjs` | Not imported by any live file | LOW |
| `agents/tool.cjs` | Separate from toolAgent.cjs — not imported | LOW |
| `agents/trigger.cjs` | Not imported by any live file | LOW |
| `agents/primitives.cjs` | Not imported by any live file | LOW |
| `agents/researchAgent.cjs` | Not in bootstrap or runtime chain | LOW |

**Safe to archive:** YES → `_archive/<timestamp>/agents/`

---

## 4. Dead Module Directories

| Path | File Count | Why Dead | Risk |
|------|-----------|---------|------|
| `modules/metaverse/` | ~21 | No `require()` path from server.js to any file here | LOW |
| `modules/futureTech/` | ~15 | No `require()` path from server.js to any file here | LOW |
| `modules/infrastructure/` | ~5 | No `require()` path from server.js to any file here | LOW |

**Safe to archive:** YES → `_archive/<timestamp>/modules/`

---

## 5. Duplicate / Stale UI Codebases

| Path | Why Dead | Risk |
|------|---------|------|
| `jarvis-ui/runtime-console/` | Standalone Vite app using mock data; never built or served by backend | LOW |
| `electron/jarvis-core/` | Ghost backend server (server.cjs, crm-server.cjs, etc.); never started by electron/main.cjs in production flow | LOW |

**Safe to archive:** YES → `_archive/<timestamp>/ui/`

---

## 6. Stale Root-Level Markdown Docs

All are phase audit reports or superseded by RUNTIME_MAP.md.

| File | Reason |
|------|--------|
| `AI_ASSISTANT_GUIDE.md` | Phase report |
| `BACKUP_RESTORE_VALIDATION.md` | Phase report |
| `CLEANUP_PLAN.md` | Superseded by this report + archive-plan.sh |
| `CONTROLLED_PUBLIC_MVP_READINESS.md` | Phase report |
| `CURRENT_RUNTIME_ARCHITECTURE.md` | Superseded by RUNTIME_MAP.md |
| `DAILY_DRIVER_ASSESSMENT.md` | Phase report |
| `DAILY_OPERATIONS_CHECKLIST.md` | May have operational value — KEEP |
| `DASHBOARD_INFORMATION_ARCHITECTURE.md` | Phase report |
| `DEPRECATED_FILES.md` | Superseded by this report |
| `FINAL_ARCHITECTURE.md` | Superseded by RUNTIME_MAP.md |
| `FRONTEND_DEPLOYMENT_AUDIT.md` | Phase report |
| `GOVERNANCE_ALIGNMENT_AUDIT.md` | Phase report |
| `INCIDENT_RESPONSE_PLAYBOOK.md` | Operational — KEEP |
| `LOGGING_DISCIPLINE.md` | Phase report |
| `LONG_SESSION_VALIDATION.md` | Phase report |
| `MARKDOWN_SERIALIZATION_AUDIT.md` | Phase report |
| `MOBILE_OPERATOR_EXPERIENCE.md` | Phase report |
| `NGINX_STATIC_SERVING_AUDIT.md` | Phase report |
| `OPERATIONAL_OBSERVATIONS.md` | Phase report |
| `OPERATOR_FRICTION_LOG.md` | Phase report |
| `PRODUCT_EXPERIENCE_CONSOLIDATION.md` | Phase report |
| `PRODUCTION_DISCIPLINE_REPORT.md` | Phase report |
| `PRODUCTION_READINESS_ASSESSMENT.md` | Superseded by RUNTIME_MAP.md + this report |
| `PROJECT_STATUS.md` | Phase report |
| `RUNTIME_BOUNDARIES.md` | Phase report |
| `RUNTIME_DEPENDENCY_MAP.md` | Superseded by RUNTIME_MAP.md |
| `STATE_TRANSITION_RELIABILITY.md` | Phase report |
| `TELEMETRY_OBSERVABILITY_REVIEW.md` | Phase report |
| `TEST_PLAIN_MARKDOWN.md` | Test artifact |
| `UX_CONSISTENCY_REVIEW.md` | Phase report |
| `VALIDATION_BOUNDARY_AUDIT.md` | Phase report |
| `VISUAL_SYSTEM_REVIEW.md` | Phase report |
| `VPS_FRONTEND_STATUS.md` | Phase report |

**Safe to archive (except KEEP items):** YES → `_archive/<timestamp>/docs/`

---

## 7. Duplicate docs/current Files

| Files | Issue |
|-------|-------|
| `docs/current/DEPLOYMENT_ARCHITECTURE.md`, `DEPLOYMENT_GUIDE.md`, `CLEAN_DEPLOYMENT_GUIDE.md`, `DEPLOYMENT.md` | 4 files on same topic — archive 3, keep CLEAN_DEPLOYMENT_GUIDE.md |
| `docs/current/PRODUCTION_ARCHITECTURE.md`, `MINIMAL_RUNTIME_ARCHITECTURE.md`, `CORE_RUNTIME.md` | 3 files on same topic — archive 2, keep PRODUCTION_ARCHITECTURE.md |

**Safe to archive:** YES → `_archive/<timestamp>/docs/current/`

---

## 8. Dead Root-Level Orphan Files

| File | Why Dead | Risk |
|------|---------|------|
| `orchestrator.cjs` | Superseded by `agents/runtime/runtimeOrchestrator.cjs` | LOW |
| `scheduler.cjs` | Superseded by `agents/automation/scheduler.cjs` | LOW |
| `commandParser.cjs` | Superseded by `backend/utils/parser.js` | LOW |
| `persistent_session.js` | Superseded by `agents/runtime/memoryContext.cjs` | LOW |
| `monitor_phase_p.sh` | Phase script, phase complete | LOW |
| `start-jarvis copy.sh` | Literal copy of start-jarvis.sh | LOW |
| `TEST_PLAIN_MARKDOWN.md` | Test artifact | LOW |
| `validate_calmness.js` | One-off script, never imported | LOW |
| `queue.json` | Stale queue snapshot in root (live file is data/task-queue.json) | LOW |
| `runtime_validation_overrides.json` | One-off audit artifact | LOW |

**Safe to archive:** YES → `_archive/<timestamp>/root/`

---

## 9. Dead Experimental Directories

| Path | Why Dead | Risk |
|------|---------|------|
| `experimental/autonomous-research/` | Not in runtime chain | LOW |
| `experimental/evolution-runtime/` | Not in runtime chain | LOW |
| `experimental/legacy-agents/` | Already in experimental — not live | LOW |
| `automation/` (root-level) | Not the same as agents/automation/ — not imported by server.js | LOW |
| `workflows/` | devWorkflow.cjs — not in runtime chain | LOW |

**Safe to archive:** YES → `_archive/<timestamp>/experimental/`

---

## What Is NOT Dead (Do Not Archive)

| Path | Why Live |
|------|---------|
| `backend/` (all) | Active runtime |
| `agents/runtime/` (all) | Active runtime |
| `agents/planner.cjs` | Active, lazy-loaded |
| `agents/terminalAgent.cjs` | Active, bootstrapped |
| `agents/browserAgent.cjs` | Active, bootstrapped |
| `agents/automationAgent.cjs` | Active, bootstrapped |
| `agents/devAgent.cjs` | Active, bootstrapped |
| `agents/taskQueue.cjs` | Active |
| `agents/autonomousLoop.cjs` | Active |
| `agents/toolAgent.cjs` | Active, used in jarvisController |
| `agents/salesAgent.cjs` | Active (guarded import) |
| `agents/interestDetector.cjs` | Active (guarded import) |
| `agents/followUpSystem.cjs` | Active (guarded import) |
| `agents/autoReplyAgent.cjs` | Active (guarded import) |
| `agents/executor.cjs` | Active (legacy fallback in executionEngine) |
| `agents/automation/` | Active (used by automationService) |
| `frontend/src/` | Active operator console |
| `plugins/local-desktop/` | Active (env-gated) |
| `scripts/` | Ops scripts |
| `tests/runtime/01-08` | Real tests |
| `tests/smoke/`, `tests/burnin/`, `tests/stress/` | Operational tests |
| `data/`, `logs/`, `backups/` | Runtime data |
| `ecosystem.config.cjs` | PM2 config |
| `RUNTIME_MAP.md` | This doc |
| `README.md` | Keep |
| `INCIDENT_RESPONSE_PLAYBOOK.md` | Keep |
| `DAILY_OPERATIONS_CHECKLIST.md` | Keep |
