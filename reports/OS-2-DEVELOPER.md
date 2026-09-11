# OS-2 — DEVELOPER OS

Date: 2026-08-13 · Audit order: 4 of 8
Method: live execution, real authenticated sessions, CRUD with persistence re-reads, failure-path probes.

## Verdict: REAL + WORKING for analysis; CREDENTIAL BLOCKED for generation

### Proven by execution
| Capability | Evidence |
|---|---|
| Engineering intelligence | real repositoryHealth |
| Coding decisions | real smell ids and types |
| Smell detection | **3,582 smells across 2,293 files in 2.0 s** (was 25 s before C.1.1) |
| Self-improvement | real recurring-RCA patterns |
| Engineering org | 20 engineer agents |

### AI generation — credential blocked, NOT broken
`POST /coding/ask` → `500 "AI backend unavailable"`. Investigation:

```
groq     → 429 (free-tier rate limit)
openai   → 401 (key present but INVALID)
ollama   → 404 (not installed)
lmstudio → unreachable
```

A direct Groq call succeeded, and after a 90 s cooldown `callAI` returned `"OK"`. **The AI works.** The fallback chain behaves correctly and reports honestly. **No fix applied — there is no code defect.**

The error text says "check provider API keys" when the cause was quota exhaustion. Slightly imprecise, not false. Not changed — out of scope.

### DEAD PROTOTYPE
`DeveloperOS.jsx` (953 LOC, 29 API functions) calls `/dev/*` — **0 of 7 endpoints exist**. Now correctly 404 after F-003. **Not wired. Not deleted.**

### Gaps
- Patch bundle / pipeline empty — UNKNOWN.
- Test/deploy/heal loop not executed end-to-end.

---

## Scores

| Dimension | Score |
|---|---:|
| Functional Reality | 7/10 |
| Workflow Completeness | 6/10 |
| Frontend Integration | 8/10 |
| Backend Reliability | 8/10 |
| Data Integrity | 8/10 |
| Failure Honesty | 9/10 |
| Discoverability | 9/10 |
| Credential Readiness | 3/10 |
| **Total** | **58/80** |
