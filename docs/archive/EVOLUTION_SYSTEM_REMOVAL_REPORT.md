> [!WARNING]
> ARCHIVED / LEGACY / NOT ACTIVE PRODUCTION RUNTIME
> This document describes historical or experimental architecture that is not part of the active Jarvis production core.

# EVOLUTION SYSTEM REMOVAL REPORT
Phase M — Security Cleanup + Frontend Maturity  
Date: 2026-05-16

---

## 1. WHAT WAS REMOVED

### 1.1 Backend routes (legacy.js)

| Route | Method | Status |
|-------|--------|--------|
| `/evolution/score` | GET | Removed → 410 Gone |
| `/evolution/approvals` | GET | Removed → 410 Gone |
| `/evolution/approve/:id` | POST | Removed → 410 Gone |
| `/evolution/reject/:id` | POST | Removed → 410 Gone |
| `/evolution/suggestions` | GET | Removed → 410 Gone |
| `/self-improve/analyze` | GET | Removed → 410 Gone |
| `/self-improve/evaluation` | GET | Removed → 410 Gone |

All 7 endpoints now return:
```json
HTTP 410 Gone
{ "error": "Removed — evolution system has been decommissioned." }
```

### 1.2 Backend code (legacy.js)

Removed:
- `evolutionEngine` from orchestratorMod destructure
- `evolutionFallback()` helper function (was used to return 200 with empty data instead of 503)

### 1.3 Frontend API (api.js)

Removed:
- `getEvolutionScore()` — called `GET /evolution/score`, returned optimization score (0–100)
- `getSuggestions()` — called `GET /evolution/suggestions`, returned empty array
- `approveSuggestion(id)` — called `POST /evolution/approve/:id`

None of these functions were called from any JSX component — they were dead exports.

---

## 2. WHY THESE WERE REMOVED

### The "self-evolving AI" narrative is not accurate

The evolution system consisted of:
- `evolutionEngine` from `orchestrator.cjs` — a scoring heuristic that tracked execution counts
  and returned an "optimization score" (0–100) based on task frequency
- `learningSystem` — pattern frequency analysis of past commands

These were not AI systems that improved themselves. They were frequency counters with
a misleading product name. Keeping them:
1. Creates false expectations ("the AI is optimizing itself")
2. Exposes internal state via unauthenticated endpoints (all `/evolution/*` routes were
   behind legacy auth but the conceptual framing is misleading)
3. Clutters the codebase with unused frontend functions

### No functionality lost

No active frontend feature relied on these APIs. The `getEvolutionScore()` function returned
a hardcoded `50` as its default (when Electron or the endpoint wasn't available), and no
component called it. The removal is purely subtractive.

---

## 3. WHAT REPLACED THEM

The operator insights the evolution system was trying to provide are now covered by:

| Old | Replacement |
|-----|------------|
| `/evolution/score` (optimization %) | `GET /runtime/status` → queue depth, error rate, agent health |
| `/evolution/suggestions` | `GET /ops` → `warnings[]` with actionable operational alerts |
| `/self-improve/analyze` | `GET /runtime/health/deep` → heap, circuit breakers, DLQ state |
| Approval workflow | Not needed — operator dispatches tasks directly via Runtime panel |

---

## 4. REMAINING EVOLUTION-ADJACENT CODE

The following remain in `legacy.js` and are NOT removed:

- `GET /learning/stats`, `/learning/patterns`, `/learning/suggestions` etc. — these expose
  `learningSystem.getPatterns()` frequency data. They're behind auth and serve as
  command frequency analysis, not self-improvement claims. Rename to `/insights/*` if
  the terminology is still misleading.

- `GET /predict/next-commands` — returns `commandHistory.getSuggestions()` (frequency-based).
  Not AI prediction — just sorted command history. Rename to `/history/frequent-commands`
  for accuracy.

These are listed here for future cleanup but are out of Phase M scope.

---

## 5. VERIFICATION

```bash
# All 7 routes return 410:
curl -s -o /dev/null -w "%{http_code}" -b cookies.txt http://localhost:5050/evolution/score
# → 410
curl -s -o /dev/null -w "%{http_code}" -b cookies.txt http://localhost:5050/self-improve/analyze
# → 410
```
