# FINAL_RUNTIME_STATE.md

Updated: 2026-05-20 | Post-cleanup state. Single source of truth.

---

## Active Runtime Tree

```
jarvis-os/
├── backend/
│   ├── server.js                    ← sole entrypoint
│   ├── controllers/
│   │   └── jarvisController.js
│   ├── db/
│   │   └── sqlite.cjs               ← WAL mode, closeDB on shutdown
│   ├── middleware/
│   │   ├── authMiddleware.js
│   │   ├── operatorAudit.js
│   │   ├── rateLimiter.js
│   │   ├── rawBody.js
│   │   └── requestLogger.js
│   │   └── requestId.js
│   ├── routes/
│   │   ├── index.js
│   │   ├── ai.js
│   │   ├── auth.js
│   │   ├── crm.js
│   │   ├── jarvis.js
│   │   ├── ops.js
│   │   ├── payment.js
│   │   ├── runtime.js
│   │   ├── simulation.js
│   │   ├── tasks.js
│   │   ├── telegram.js
│   │   └── whatsapp.js
│   ├── services/
│   │   ├── aiService.js
│   │   ├── automationService.js
│   │   ├── crmService.js
│   │   ├── paymentService.js
│   │   └── whatsappService.js
│   └── utils/
│       ├── errorTracker.js
│       ├── execLog.cjs
│       ├── logger.js
│       ├── memoryTracker.js
│       └── parser.js
│
├── agents/
│   ├── automation/                  ← scheduler, engine (used by automationService)
│   ├── runtime/
│   │   ├── bootstrapRuntime.cjs
│   │   ├── runtimeOrchestrator.cjs
│   │   ├── executionEngine.cjs
│   │   ├── taskRouter.cjs
│   │   ├── agentRegistry.cjs
│   │   ├── priorityQueue.cjs
│   │   ├── executionHistory.cjs
│   │   ├── runtimeEventBus.cjs
│   │   ├── runtimeStream.cjs
│   │   ├── deadLetterQueue.cjs
│   │   ├── memoryContext.cjs
│   │   ├── adapters/
│   │   │   ├── terminalExecutionAdapter.cjs
│   │   │   ├── filesystemExecutionAdapter.cjs
│   │   │   ├── browserExecutionAdapter.cjs
│   │   │   ├── vscodeExecutionAdapter.cjs
│   │   │   ├── gitExecutionAdapter.cjs
│   │   │   ├── processLifecycleAdapter.cjs
│   │   │   ├── adapterSandboxPolicyEngine.cjs
│   │   │   ├── adapterHealthMonitor.cjs
│   │   │   ├── adapterCapabilityRegistry.cjs
│   │   │   └── executionAdapterSupervisor.cjs
│   │   └── control/
│   │       └── runtimeEmergencyGovernor.cjs
│   ├── automationAgent.cjs
│   ├── autonomousLoop.cjs
│   ├── autoReplyAgent.cjs
│   ├── browserAgent.cjs
│   ├── devAgent.cjs
│   ├── executor.cjs                 ← legacy fallback in executionEngine
│   ├── followUpSystem.cjs
│   ├── interestDetector.cjs
│   ├── planner.cjs
│   ├── salesAgent.cjs
│   ├── taskQueue.cjs
│   ├── terminalAgent.cjs
│   └── toolAgent.cjs
│
├── plugins/
│   └── local-desktop/               ← env-gated: ENABLE_LOCAL_DESKTOP=1
│       ├── desktopAgent.cjs
│       ├── desktop.cjs
│       └── primitives.cjs
│
├── frontend/src/                    ← React operator console
│   ├── api.js                       ← barrel export
│   ├── _client.js                   ← HTTP client, Map caps, GC, flood guard
│   ├── runtimeApi.js                ← dispatch, queue, status, history
│   ├── authApi.js
│   ├── crmApi.js
│   ├── telemetryApi.js
│   ├── hooks/
│   │   └── useRuntimeStream.js      ← SSE + polling, backoff, cleanup
│   └── components/operator/
│       ├── WorkflowPanel.jsx
│       ├── ExecLogPanel.jsx
│       └── TelemetryPanel.jsx
│
├── tests/
│   ├── runtime/                     ← 8 real tests (01-08)
│   ├── smoke/
│   ├── burnin/
│   └── stress/
│
├── scripts/
│   ├── check-startup-env.cjs        ← run before server on npm start
│   └── (other ops scripts)
│
├── data/                            ← runtime data (gitignored)
│   ├── jarvis.db                    ← SQLite WAL
│   └── task-queue.json
│
├── ecosystem.config.cjs             ← PM2 production config
├── package.json
├── .env                             ← secrets (gitignored)
├── RUNTIME_MAP.md                   ← dependency graph, startup order, routes
├── DEPLOY_CHECKLIST.md              ← pre-deploy verification gate
├── DEAD_WEIGHT_REPORT.md            ← archive classification
└── README.md
```

---

## Archived Tree Summary

Location: `_archive/20260520_010917/` (gitignored — local only)

| Category | Items Archived |
|----------|---------------|
| Dead agent directories (25 dirs) | ~383 files |
| Dead root-level agent files | 16 files |
| Dead module dirs (metaverse, futureTech, infra) | ~50 files |
| Duplicate UI codebases (jarvis-ui, electron/jarvis-core) | ~40 files |
| Phantom tests (09-83) | 74 files |
| Stale root docs | 30 files |
| Duplicate docs/current | 6 files |
| Dead root orphan files | 10 files |
| Dead experimental dirs | ~30 files |
| Corrupted dir (axios-named) | 1 item |
| **Total archived** | **~640 files** |

---

## Active Agents

| Agent | File | Capability | Registered At |
|-------|------|-----------|---------------|
| terminal | agents/terminalAgent.cjs | terminal | bootstrapRuntime |
| browser | agents/browserAgent.cjs | browser | bootstrapRuntime |
| automation | agents/automationAgent.cjs | automation | bootstrapRuntime |
| dev | agents/devAgent.cjs | dev | bootstrapRuntime |
| filesystem | adapters/filesystemExecutionAdapter.cjs | filesystem | bootstrapRuntime |
| desktop | plugins/local-desktop/desktopAgent.cjs | desktop | bootstrapRuntime (env-gated) |
| planner | agents/planner.cjs | — | orchestrator (lazy) |
| autonomousLoop | agents/autonomousLoop.cjs | — | server.js startup |
| taskQueue | agents/taskQueue.cjs | — | server.js startup |

---

## Active Adapters

| Adapter | Status |
|---------|--------|
| terminalExecutionAdapter | Production-stable. Allowlist + SIGTERM timeout + 512KB cap |
| filesystemExecutionAdapter | Production-stable |
| browserExecutionAdapter | Registered. Unstable under load |
| vscodeExecutionAdapter | Optional — requires VS Code running |
| gitExecutionAdapter | Optional — git binary required |
| processLifecycleAdapter | Internal — used by terminalAdapter |
| adapterSandboxPolicyEngine | Internal — allowlist enforcement |

---

## Active Runtime Routes

| Method | Path | Auth |
|--------|------|------|
| POST | /runtime/dispatch | required |
| POST | /runtime/queue | required |
| GET | /runtime/status | required |
| GET | /runtime/history | required |
| POST | /runtime/emergency-stop | required |
| GET | /runtime/stream | required |
| GET | /runtime/stream/status | required |
| POST | /auth/login | none |
| POST | /auth/logout | none |
| POST | /jarvis | optional |
| GET | /health | none |
| GET | /stats | none |
| GET | /metrics | none |

---

## Remaining Production Risks

| # | Risk | Severity |
|---|------|----------|
| 1 | `npm install` required on cold deploy (needs network) | HIGH — boot impossible without |
| 2 | No React ErrorBoundary on operator panels | MEDIUM — bad render unmounts console; reload recovers |
| 3 | Browser/desktop agents registered but unstable | LOW — terminal + filesystem are the stable execution path |
| 4 | `tests/legacy/` has 74 phantom test files | LOW — gitignored, no test runner references them |

---

## Exact Commands

### Boot

```bash
# Development
npm run dev              # backend (port 5050) + frontend CRA (port 3000)

# Production (manual)
npm start                # env check + node backend/server.js
```

### Deploy

```bash
# Full cold deploy
git pull
npm install
bash deploy/start-production.sh    # validates env, starts PM2
```

### PM2

```bash
pm2 start ecosystem.config.cjs --env production   # first start
pm2 restart jarvis-os                              # after update
pm2 logs jarvis-os                                 # live logs
pm2 stop jarvis-os                                 # graceful stop
pm2 monit                                          # live monitor
```

### Rollback

```bash
git log --oneline -10               # find the target commit
pm2 stop jarvis-os
git reset --hard <commit-sha>
npm install --omit=dev
pm2 start ecosystem.config.cjs --env production
curl http://localhost:5050/health   # verify
```

### Verify Running

```bash
curl http://localhost:5050/health
pm2 status
lsof -ti:5050
```

### Tests

```bash
npm run test:runtime          # 8 real unit tests (01-08)
npm run test:stress           # queue + memory + HTTP stress
```
