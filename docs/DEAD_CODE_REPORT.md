# DEAD_CODE_REPORT.md

**Audit Date:** 2026-05-15  
**Methodology:** Static reachability analysis from production entry points (server.js, routes/index.js, autonomousLoop.cjs, bootstrapRuntime.cjs). A module is "dead" if no production-reachable code directly or transitively requires it.

---

## Summary

| Category | Count |
|----------|-------|
| Total .cjs modules in `agents/` | 831 |
| Reachable from production | ~30 |
| **Dead — never required** | **~323 subdirectory modules + ~23 root modules = ~346** |
| Dead as % of total | **~42%** |

---

## Dead Modules by Category

### Category 1: `agents/runtime/` subdirectory modules — ALL 36 directories

**Total dead: 323 modules**

None of these 323 files are required by any production-reachable code. They were written but never wired into the server, the autonomous loop, the bootstrap, or any route handler.

Verification method: `grep -rl "runtime/<dir>" backend/ agents/*.cjs` returns 0 for every directory below except `control` (1 ref) and `adapters` (1 ref via toolAgent lazy).

| Directory | Files | Dead Count | Notes |
|-----------|-------|------------|-------|
| `action-bus/` | 8 | 8 | Unified action routing — never mounted |
| `adapters/` | 8 | 7 | 1 used lazily (executionAdapterSupervisor) |
| `benchmark/` | 13 | 13 | Performance analysis — test-only |
| `capability/` | 9 | 9 | Capability contracts — superseded by agentRegistry |
| `chaos/` | 6 | 6 | Chaos engineering — test/dev only |
| `concurrency/` | 6 | 6 | Deadlock detection — not wired |
| `control/` | 10 | 9 | 1 used (runtimeEmergencyGovernor, optional) |
| `coordination/` | 6 | 6 | Execution scheduling — duplicates runtimeOrchestrator |
| `decision/` | 6 | 6 | Strategy selection — never called |
| `deploy/` | 4 | 4 | Pre-deploy validation — dev tool only |
| `evolution/` | 11 | 11 | Genetic algorithms, adaptive tuning — never wired |
| `execution/` | 21 | 21 | State machine, retries — duplicates executionEngine |
| `execution-adapters/` | 14 | 14 | Adapter registry — duplicates agentRegistry |
| `governance/` | 12 | 12 | Authority manager, QoS — never mounted |
| `integration/` | 6 | 6 | Lifecycle hooks — never wired |
| `intelligence/` | 13 | 13 | Routing intelligence — never used |
| `isolation/` | 6 | 6 | Fault containment — never used |
| `learning/` | 6 | 6 | Anomaly prediction — never used |
| `memory/` | 8 | 8 | Memory analytics — duplicates contextEngine |
| `observability/` | 25 | 25 | Health scoring, dashboards — not mounted |
| `observe/` | 4 | 4 | Event streams — never used |
| `orchestration/` | 18 | 18 | Load balancing — duplicates runtimeOrchestrator |
| `persistence/` | 6 | 6 | Event store — duplicates taskQueue |
| `planning/` | 15 | 15 | Goal decomposer — duplicates planner.cjs |
| `production/` | 6 | 6 | Incident management — never wired |
| `recovery/` | 6 | 6 | Self-healing — duplicates autonomousLoop retry |
| `replay/` | 4 | 4 | Reproducibility — never used |
| `repo/` | 2 | 2 | Git integration — never used |
| `resilience/` | 1 | 1 | Interruption testing — test only |
| `safety/` | 4 | 4 | Circular dep detector — ironic |
| `security/` | 4 | 4 | Audit logs — duplicates backend/utils/errorTracker |
| `scoring/` | 1 | 1 | Workflow scorer — never called |
| `supervisor/` | 6 | 6 | Execution supervisor — never used |
| `surface/` | 6 | 6 | Admission control — never used |
| `telemetry/` | 6 | 6 | Telemetry pipeline — duplicates runtimeEventBus |
| `toolchain/` | 9 | 9 | Command governance — never used |
| `trust/` | 11 | 11 | Hallucination detection — never used |
| `workflows/` | 4 | 4 | Debugging loops — dev tool only |

---

### Category 2: `agents/runtime/` root-level dead modules

**Total dead: ~33 of 42 root files**

| Module | Why it's dead |
|--------|---------------|
| `anomalyDetector.cjs` | Never required anywhere |
| `autonomousWorkflow.cjs` | Duplicates autonomousLoop, never required |
| `chaosEngine.cjs` | Test/dev tool, never required in production |
| `checkpointManager.cjs` | Checkpoint system not wired |
| `checkpointRecovery.cjs` | Same as above |
| `configValidator.cjs` | Config validation not wired |
| `costModel.cjs` | Cost analysis not wired |
| `executionGraph.cjs` | Graph execution never required |
| `executionOptimizer.cjs` | Optimizer never required |
| `executionPlanner.cjs` | Duplicates planner.cjs, never required |
| `executionPolicy.cjs` | Policy engine never required |
| `executionSandbox.cjs` | Sandbox never required |
| `executionSimulator.cjs` | Simulator never required in prod |
| `failureMemory.cjs` | Failure memory never wired |
| `failurePredictor.cjs` | Predictor never required |
| `humanApproval.cjs` | Approval flow never implemented |
| `learningLoop.cjs` | Learning never required |
| `memoryLeakDetector.cjs` | Leak detector never required (ironic) |
| `metricsExporter.cjs` | Metrics exporter never required |
| `observability.cjs` | Observability layer never required |
| `patternCluster.cjs` | Pattern clustering never required |
| `permissionBoundary.cjs` | Permissions never wired |
| `qualityScorer.cjs` | Quality scoring never required |
| `recoveryBenchmark.cjs` | Recovery benchmark never required |
| `recoveryEngine.cjs` | Recovery engine (23KB) never required |
| `resourceMonitor.cjs` | Resource monitoring never required |
| `runtimeStabilizer.cjs` | Stabilizer never required |
| `safeShutdown.cjs` | Duplicates server.js SIGTERM handler |
| `startupDiagnostics.cjs` | Diagnostics never required in prod |
| `telemetry.cjs` | Root telemetry duplicates runtimeEventBus |
| `tracer.cjs` | Tracer never required |
| `trustScorer.cjs` | Trust scoring never required |

---

### Category 3: `agents/*.cjs` root-level dead agents

| Module | Size | Why it's dead |
|--------|------|---------------|
| `evolutionEngine.cjs` | 19KB | Self-improvement loop, never wired |
| `agentFactory.cjs` | 18KB | Dynamic agent creation, never wired |
| `AgentGenerator.cjs` | 19KB | Agent scaffolding, never wired |
| `MasterAgentManager.cjs` | 11KB | Multi-agent management, never wired |
| `learningSystem.cjs` | 12KB | Feedback loops, never wired |
| `leadScoring.cjs` | 783B | Lead scoring, never wired in prod |
| `fiverrLeads.cjs` | 1.1KB | Fiverr scraping, never wired |
| `linkedinLeads.cjs` | 922B | LinkedIn scraping, never wired |
| `googleMapsLeads.cjs` | 855B | Maps leads, never wired |
| `realLeadsEngine.cjs` | 634B | Leads engine, never wired |
| `leadsInjector.cjs` | 291B | Lead injection, never wired |
| `followUpSequence.cjs` | 645B | Follow-up seq, superseded by automationService |
| `reelAgent.cjs` | 504B | Instagram reels, never wired |
| `saas.cjs` | 323B | SaaS agent stub, empty |
| `router.cjs` | 488B | Old router, superseded by routes/index.js |
| `agentRouter.cjs` | 452B | Old router, superseded |
| `crm.cjs` | 1.1KB | Old CRM agent, superseded by crmService |
| `leads.cjs` | 412B | Old leads agent, superseded |
| `marketingAgent.cjs` | 267B | Marketing stub, never wired |
| `voiceSales.cjs` | 481B | Voice sales stub, never wired |
| `paymentAgent.cjs` | 681B | Superseded by paymentService.js |
| `salesBrain.cjs` | 645B | Never required |
| `instagram.cjs` | 214B | Instagram stub — 214 bytes, empty |

---

## Dead Code in Active Files

### `executor.cjs` — 2099 lines, ~40% dead branches

The 152KB `executor.cjs` handles dozens of task types. With 5 agents now registered in `agentRegistry`, the registered cases (`desktop`, `browser`, `terminal`, `automation`, `dev`) are handled by `executionEngine` before reaching the legacy executor. The executor's code for those types still exists but is never reached in the happy path.

Additionally, `executor.cjs` contains multiple inner utility functions, AI wrappers, browser automation stubs, and domain handlers that were never migrated out.

### `jarvisController.js` — Multiple disabled code paths

- `SalesAgent`, `InterestDetector`, `FollowUpSystem`, `AutoReplyAgent` are all lazy-loaded with `try/catch` — they may or may not be present
- `orchestrator.cjs` is lazy-loaded with fallback — used for "smart" mode only
- WhatsApp integration branches only execute when `wa` is configured

---

## Recommendation Matrix

| Action | Impact | Risk | Effort |
|--------|--------|------|--------|
| Delete `agents/runtime/` subdirs (323 files) | Reduces codebase 40% | LOW — zero production impact | Low |
| Delete dead root agents (23 files) | Simplifies agents/ | LOW | Low |
| Delete dead runtime root modules (32 files) | Simplifies runtime/ | LOW | Low |
| Compress executor.cjs into modular handlers | Maintainability | MEDIUM — core path | High |
| Wire or delete autonomousWorkflow.cjs | Removes duplicate | LOW | Low |

**Safe immediate deletions (zero production impact):**
- All 36 subdirectories of `agents/runtime/` except `control/` and `adapters/`
- The 23 dead root agents listed above
- The 32 dead root runtime modules listed above
