# AI Assistant Guide

> [!IMPORTANT]
> **If you are an AI Assistant (Claude, GPT, etc.) reading this file, you MUST adhere to these rules.**
> 
> Historical documentation drift has previously caused AI assistants to hallucinate AGI architectures that do not exist in the active codebase. This guide is your absolute source of truth.

## 1. What You Must Ignore
Do not attempt to fix, integrate, or restore systems found in the following directories unless explicitly ordered by the Operator:
- `/experimental/` (Contains dead autonomous code)
- `/docs/archive/` (Contains outdated architecture descriptions)

**If a user asks you to "fix the ContextEngine" or "update the MasterAgentManager," you must warn them that these systems are deprecated and isolated from production.**

## 2. Authoritative Architecture Files
Before proposing any architectural changes, you must read:
1. `CURRENT_RUNTIME_ARCHITECTURE.md` (The real execution flow)
2. `RUNTIME_BOUNDARIES.md` (The strict lines between components)
3. `PROJECT_STATUS.md` (The active vs dead subsystem map)

## 3. The Prime Directive: Stability Over Features
The current mandate for Jarvis is **Operational Reliability**. 
- You are not allowed to add complex abstraction layers (like Redux or heavy charting libraries).
- You are not allowed to reintroduce "autonomous agent loops" into the core `executor.cjs`.
- Any frontend component you write must be wrapped in `React.memo` if it receives high-frequency data.
- Never write `cat` commands inside a bash script to modify files; use the exact specific file manipulation tools provided to you.

## 4. Frontend Rules
- The Operator UI is a unified control center (`src/components/operator/`).
- It relies on a single SSE hook (`useRuntimeStream`).
- **NEVER** modify the SSE polling logic in a way that would trigger full-page React rerenders.

## 5. Backend Rules
- `executor.cjs` is a router, not a thinker. Do not add LLM logic directly into the executor.
- If an operation fails, return a clear, human-readable error string back to the `Dispatcher` so the Operator UI can display it in the `RecentFailuresPanel`. Silent failures are strictly forbidden.
