# OVER_ENGINEERING_REPORT.md

**Audit Date:** 2026-05-15

---

## Executive Summary

JARVIS OS has a working 30-module core doing real work. Surrounding it is approximately 800 modules of speculative infrastructure that was built without being wired in. The most acute over-engineering problems are: a 2099-line executor monolith, three parallel execution paths, five overlapping tracking systems, and 36 directories of subsystems that duplicate functionality already present in the core.

---

## Problem 1: The Three-Path Execution Problem

**Severity: CRITICAL**

Three completely independent task execution paths exist, none aware of the others.

```
PATH A: /jarvis → parser → toolAgent → primitives
PATH B: autonomousLoop → planner → executor.cjs (2099 lines)
PATH C: /runtime/dispatch → runtimeOrchestrator → executionEngine → agentRegistry
```

**What this means in practice:**
- A task dispatched via PATH B bypasses circuit breakers entirely
- A task dispatched via PATH C bypasses the OS tool layer
- There is no single place where "all active tasks" is visible
- Retry logic exists in three places: `autonomousLoop` (linear backoff), `executionEngine` (exponential backoff), PATH A has no retry at all
- Failure memory exists in `autonomousLoop._failureTracker` but not in PATH C

**What it should be:** One canonical dispatch path. PATH B should send tasks through PATH C's `executionEngine` so circuit breakers, history, and retry logic are consistent.

---

## Problem 2: executor.cjs — 2099-Line Monolith

**Severity: HIGH**

`agents/executor.cjs` is 152KB and 2099 lines. It is the actual execution engine for PATH B (the autonomous background loop). It handles every task type in one giant switch/if-else structure:

- Browser automation
- Desktop control (keyboard, mouse)
- Terminal commands
- AI/LLM calls
- CRM operations
- Social media
- Voice
- File operations
- Dev/code generation
- Scheduling
- Payment handling
- WhatsApp messages
- Internal queue operations

This file is the biggest stability risk in the codebase. A bug in any handler affects all task types. It is impossible to test individual task handlers in isolation.

**The runtime layer (`executionEngine.cjs` + `agentRegistry.cjs`) already solved this** — it routes by capability to isolated agents. But PATH B still uses the monolith directly.

---

## Problem 3: Five Overlapping History/Tracking Systems

**Severity: HIGH**

Five separate systems record what tasks have done:

| System | Location | Type | Cleared on restart? |
|--------|----------|------|---------------------|
| `executionHistory.cjs` | agents/runtime/ | In-memory ring (500) | YES |
| `contextEngine.conversationHistory` | agents/contextEngine.cjs | In-memory + disk | NO |
| `autonomousLoop._failureTracker` | agents/autonomousLoop.cjs | In-memory Map | YES |
| `autonomousLoop._execTimings` | agents/autonomousLoop.cjs | In-memory ring (100) | YES |
| `backend/utils/errorTracker.js` | backend/utils/ | In-memory rate tracker | YES |

And three separate disk files accumulate execution data:
- `data/memory-store.json` (131KB, growing)
- `data/task-queue.json` (18KB, pruned to 50)
- `data/audit.log` (48KB, never rotated)

**What it should be:** One source of truth for execution history (`executionHistory.cjs`), one for errors (`errorTracker.js`), and `contextEngine` limited to LLM context injection only.

---

## Problem 4: Two Orchestrators

**Severity: MEDIUM**

Two completely separate orchestrators exist:

| Orchestrator | Path | Size | Used by |
|-------------|------|------|---------|
| `orchestrator.cjs` | project root | 388 lines | jarvisController (lazy) |
| `runtimeOrchestrator.cjs` | agents/runtime/ | 145 lines | routes/runtime.js |

They have different APIs, different memory patterns, and different concepts of what "dispatch" means. The root `orchestrator.cjs` was the original implementation; `runtimeOrchestrator.cjs` was built as the "new" layer but neither replaced the other.

---

## Problem 5: Duplicate Subsystem Families

**Severity: MEDIUM**

Multiple sets of modules exist that each implement the same concept as something already in the core.

| Core Module | Duplicate Subsystem | Files | Status |
|-------------|---------------------|-------|--------|
| `agentRegistry.cjs` | `capability/` + `execution-adapters/` | 23 | Unreachable |
| `executionEngine.cjs` | `execution/executionStateMachine.cjs` + 20 more | 21 | Unreachable |
| `runtimeOrchestrator.cjs` | `orchestration/` (18 modules) | 18 | Unreachable |
| `planner.cjs` | `planning/` (15 modules) | 15 | Unreachable |
| `taskQueue.cjs` | `persistence/` (6 modules) + `runtimeEventStore` | 6 | Unreachable |
| `autonomousLoop` retry logic | `recovery/` (6 modules) | 6 | Unreachable |
| `contextEngine.cjs` | `memory/` (8 modules) | 8 | Unreachable |
| `runtimeEventBus.cjs` | `telemetry/` (6 modules) + `observability/` (25) | 31 | Unreachable |

Each "subsystem family" is a more complex, more modular version of something the core already does. None were ever wired in to replace the simpler version.

---

## Problem 6: The Evolution Engine

**Severity: MEDIUM**

`agents/evolutionEngine.cjs` (19KB) implements a genetic-algorithm-style self-improvement loop that was never required by any production module.

The same pattern exists for:
- `agents/learningSystem.cjs` (12KB) — feedback loops
- `agents/runtime/evolution/` (11 files) — adaptive concurrency intelligence
- `agents/runtime/learning/` (6 files) — anomaly predictor, incident memory

Approximately **58KB of dead evolution/learning code** across 30 files with no production wiring.

---

## Problem 7: 910-Directory Checkpoint System With No Pruning

**Severity: MEDIUM**

`data/workflow-checkpoints/` contains 908 subdirectories totalling 3.5MB. The checkpoint system (`agents/runtime/checkpointManager.cjs`) is not required by any production code. These directories are artifacts of previous test or development sessions with no TTL, no garbage collection, and no pruning.

---

## Problem 8: Chaos Engineering Before Production Stability

**Severity: LOW**

`agents/runtime/chaos/` contains 6 modules including `runtimeChaosEngine.cjs`. The system has not yet reached production stability. Building chaos testing infrastructure before the core is stable is backwards.

---

## Problem 9: Governance Layer for 5 Agents

**Severity: LOW**

`agents/runtime/governance/` contains 12 modules: authority manager, fairness coordinator, QoS scheduler, action approval coordinator, rate governor, resource allocator. The system has 5 registered agents. A Map with circuit breakers (`agentRegistry.cjs`) is the appropriate complexity for this scale.

---

## Problem 10: Three Agent Management Systems

**Severity: LOW**

`MasterAgentManager.cjs` (11KB) + `agentFactory.cjs` (18KB) + `AgentGenerator.cjs` (19KB) = 48KB of agent management code, none wired. `bootstrapRuntime.cjs` handles agent registration in 113 lines with clear `registerAgent()` calls.

---

## Over-Engineering Score by Module

| Module / System | Lines | Wired? | Verdict |
|-----------------|-------|--------|---------|
| `executor.cjs` | 2099 | YES | Too large — split into per-type handlers |
| `evolution/` (11 files) | ~600 | NO | Premature — delete |
| `governance/` (12 files) | ~700 | NO | Overkill for 5 agents — delete |
| `observability/` (25 files) | ~1400 | NO | Full APM for dev system — delete |
| `orchestration/` (18 files) | ~1000 | NO | Duplicates core — delete |
| `planning/` (15 files) | ~800 | NO | Duplicates planner.cjs — delete |
| `trust/` (11 files) | ~600 | NO | Pre-MVP priority — delete |
| `concurrency/` (6 files) | ~350 | NO | Deadlock detection for 10 agents — delete |
| `chaos/` (6 files) | ~350 | NO | Chaos before stability — delete |
| `intelligence/` (13 files) | ~750 | NO | Routing intelligence for 5 agents — delete |

---

## What Should Actually Exist

The entire runtime should be these files:

```
agents/
  autonomousLoop.cjs      ← poll + run tasks
  taskQueue.cjs           ← persist task state
  planner.cjs             ← decompose input
  primitives.cjs          ← OS actions
  {desktop,browser,terminal,dev,automation}Agent.cjs  ← thin wrappers

agents/runtime/
  agentRegistry.cjs       ← agent map + circuit breakers
  executionEngine.cjs     ← route + retry + history
  taskRouter.cjs          ← type → capability
  executionHistory.cjs    ← ring buffer
  memoryContext.cjs       ← context injection
  priorityQueue.cjs       ← background queue
  bootstrapRuntime.cjs    ← register 5 agents
  runtimeOrchestrator.cjs ← dispatch + status API
  runtimeEventBus.cjs     ← SSE bus
  runtimeStream.cjs       ← SSE route

Total: 20 files (vs. 831 current)
Reduction: 811 files (98%)
```
