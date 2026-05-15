# CLEANUP_PHASE_C_REPORT.md

**Date:** 2026-05-15  
**Branch:** cleanup/runtime-minimization  
**Tag before:** backup-before-phase-C → 2a7d8a1

---

## Scope

Phase C evaluated the three so-called "legacy" routes (`/jarvis`, `/whatsapp`, `/ops`) and whether `agents/runtime/adapters/` could be removed.

**Conclusion: All three routes are live. Adapters must stay.**

---

## Route Analysis

### POST /jarvis

**Status: LIVE — do not remove**

Import chain:
```
routes/index.js → routes/jarvis.js → controllers/jarvisController.js → agents/toolAgent.cjs
```

Called by:
- `frontend/src/components/operator/AIConsolePanel.jsx` → `sendMessage()` — powers the AI chat interface in OperatorConsole
- `frontend/src/components/ChatBox.js` → `sendMessage()` — legacy chat component
- `mobile/src/api.js` → `sendMessage()` — Android app

What it does: AI query/response + OS action execution (terminal, filesystem, browser via toolAgent).

This is **not legacy**. It is the production AI console endpoint.

### POST /whatsapp/webhook, GET /whatsapp/webhook

**Status: LIVE — do not remove**

Used by WhatsApp Cloud API for message reception. Active if `WHATSAPP_TOKEN` + `WA_PHONE_ID` are set. Even without these env vars, the route is safely mounted (returns 403 on webhook verification, no-ops on messages).

### GET /health, GET /ops, GET /stats, GET /metrics

**Status: LIVE — do not remove**

These are operator monitoring endpoints. `/health` is checked by PM2 health probes and nginx uptime checks. `/ops` provides service status to the OperatorConsole's polling fallback.

---

## adapters/ Decision

**Status: KEEP ALL 10 FILES**

The `adapters/` directory is used as follows:
```
POST /jarvis → jarvisController.handleJarvis() → toolAgent.execute()
    → toolAgent._supervisor() [lazy-loaded]
    → executionAdapterSupervisor.cjs
        → terminalExecutionAdapter.cjs     [for command execution]
        → filesystemExecutionAdapter.cjs   [for file read/write]
        → gitExecutionAdapter.cjs          [for git operations]
        → browserExecutionAdapter.cjs      [for URL open/search]
        → vscodeExecutionAdapter.cjs       [for VS Code actions]
        → adapterHealthMonitor.cjs
        → adapterCapabilityRegistry.cjs
        → adapterSandboxPolicyEngine.cjs
        → processLifecycleAdapter.cjs      [imported by terminalAdapter]
```

The supervisor is lazy-loaded but IS called for terminal/filesystem/browser task types. These are real operational paths.

---

## Two Dispatch Paths — Both Live

| Path | Endpoint | Called From | Handler |
|------|----------|-------------|---------|
| AI console | `POST /jarvis` | AIConsolePanel, ChatBox, mobile | jarvisController → toolAgent → adapters |
| Workflow dispatch | `POST /runtime/dispatch` | WorkflowPanel | runtimeOrchestrator → executionEngine → 5 agents |

These serve different use cases. Neither replaces the other.

---

## No Deletions in Phase C

Phase C is an analysis phase. No files were deleted.

The `adapters/` directory and all three "legacy" routes are confirmed live production code.

---

## Final Test Results

```
143/143 workflow tests passing
0 failures
```

---

## Cumulative Cleanup Summary (All Phases)

| Phase | Files Removed | Tests After |
|-------|--------------|-------------|
| A — Dead root runtime files | 32 | 143/143 ✓ |
| B — Dead subdirectories (41 dirs + 9 control) | 315 | 143/143 ✓ |
| C — Analysis only | 0 | 143/143 ✓ |
| **Total** | **347** | |

**agents/runtime/ before:** 366 files  
**agents/runtime/ after:** 22 files  
**Reduction: 94% of dead files removed**
