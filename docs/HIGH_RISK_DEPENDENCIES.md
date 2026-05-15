# HIGH_RISK_DEPENDENCIES.md

**Date:** 2026-05-15  
**Purpose:** Files that appear dead but require extra caution before deletion. Either they have unclear import paths, are referenced by string (not `require()`), or serve as fallback/legacy paths still mounted in production.

---

## Category 1: Legacy Route Chain (DO NOT DELETE without removing routes)

These files are live because the old dispatch routes (`POST /jarvis`, `POST /whatsapp`, `GET /ops`) are still mounted in `backend/routes/index.js`.

| File | Import Chain | Risk if Deleted |
|------|-------------|-----------------|
| `agents/toolAgent.cjs` | index.js → jarvis.js → jarvisController.js → toolAgent.cjs | Breaks POST /jarvis dispatch |
| `agents/runtime/adapters/` (all 10) | toolAgent.cjs → executionAdapterSupervisor.cjs → 9 adapters | Breaks terminal/filesystem/browser via legacy path |
| `backend/controllers/jarvisController.js` | jarvis.js, whatsapp.js, ops.js | Breaks all three legacy routes |

**Decision required:** If `/jarvis` and `/whatsapp` routes are no longer needed (all dispatch now goes through `/runtime/dispatch`), these can be removed by:
1. Removing `require("./jarvis")`, `require("./whatsapp")` from `backend/routes/index.js`
2. Then `toolAgent.cjs` and all `adapters/` become unreachable and safe to delete

---

## Category 2: `agents/runtime/recovery/` Subdirectory

The `recovery/` directory itself (not `recovery/intelligence/`) was listed as having 6 files under `recovery/intelligence/`. There is no `recovery/` root-level with its own files other than the `intelligence/` subdirectory.

```
agents/runtime/recovery/intelligence/   ← 6 files, all dead
```

Confirm before deletion:
```bash
ls agents/runtime/recovery/
```

---

## Category 3: String-Referenced Files

These files may be loaded via dynamic `require(variable)` patterns that static analysis cannot trace:

| File | Why It's Uncertain |
|------|--------------------|
| Any file matching `*Agent.cjs` pattern in `agents/` | `jarvisController.js` has: `const fn = require(\`./${type}Agent.cjs\`)` — dynamic require by type string |
| `agents/aiCloser.cjs` | Referenced via string in `autoReplyAgent.cjs` — check if autoReplyAgent is loaded |

**Verification command:**
```bash
grep -rn "require(.*Agent" backend/ agents/*.cjs agents/runtime/*.cjs
grep -rn "require(.*\`" backend/ agents/*.cjs
```

---

## Category 4: Test Infrastructure

These files are not production code but are imported by test suites. Deleting them would break the test runner but not production.

| File | Used By |
|------|---------|
| `agents/runtime/agentRegistry.cjs` | All 10 workflow test files |
| `agents/runtime/executionEngine.cjs` | tests/workflows/07 |
| `agents/runtime/deadLetterQueue.cjs` | tests/workflows/07, 09 |
| `backend/utils/execLog.cjs` | tests/workflows/10 |

These are all production-live files anyway — no conflict.

---

## Category 5: `data/` JSON Files — Not Code, But Referenced

| File | Status | Notes |
|------|--------|-------|
| `data/failure-memory.json` | Untracked (git status) | Created by `failureMemory.cjs` which is dead — safe to delete |
| `data/pattern-clusters.json` | Untracked | Created by `patternCluster.cjs` which is dead — safe to delete |
| `data/workflow-checkpoints/` | Untracked dir | Created by `checkpointManager.cjs` which is dead — safe to delete |
| `data/workflow-trust.json` | Untracked | Created by `trustScorer.cjs` which is dead — safe to delete |

---

## Summary Decision Table

| Action | Confidence | Prerequisite |
|--------|-----------|--------------|
| Delete `agents/runtime/` subdirs (303 files) | HIGH | None |
| Delete 32 dead root runtime files | HIGH | None |
| Delete 9 dead control files | HIGH | None |
| Delete adapters/ (10 files) | MEDIUM | Remove jarvis/whatsapp routes first |
| Delete toolAgent.cjs | MEDIUM | Remove jarvis/whatsapp routes first |
| Delete data/failure-memory.json etc. | HIGH | None |
