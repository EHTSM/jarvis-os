> [!WARNING]
> ARCHIVED / LEGACY / NOT ACTIVE PRODUCTION RUNTIME
> This document describes historical or experimental architecture that is not part of the active Jarvis production core.

# LEGACY SYSTEM REMOVAL REPORT
Phase M — Security Cleanup + Frontend Maturity  
Date: 2026-05-16

---

## WHAT WAS REMOVED

### Backend — `backend/routes/legacy.js`

Seven evolution/self-improve route handlers replaced with HTTP 410 Gone:

| Route | Old behavior | New behavior |
|-------|-------------|--------------|
| `GET /evolution/score` | Frequency counter disguised as AI scoring | 410 Gone |
| `GET /evolution/approvals` | Listed pending "approvals" | 410 Gone |
| `POST /evolution/approve/:id` | Applied hardcoded suggestions | 410 Gone |
| `POST /evolution/reject/:id` | Rejected suggestions | 410 Gone |
| `GET /evolution/suggestions` | Returned static suggestion list | 410 Gone |
| `GET /self-improve/analyze` | Ran text frequency analysis | 410 Gone |
| `GET /self-improve/evaluation` | Returned formatted analysis result | 410 Gone |

Also removed from `legacy.js`:
- `evolutionFallback()` function (~60 lines of frequency-counter logic)
- `evolutionEngine` destructure from orchestratorMod
- All imports used exclusively by the evolution system

The `_gone` handler used for all seven routes:
```js
const _gone = (req, res) => res.status(410).json({
  error: "Removed — evolution system has been decommissioned."
});
```

### Frontend — `frontend/src/api.js`

Three frontend functions removed:

| Function | Called backend endpoint | Status |
|----------|------------------------|--------|
| `getEvolutionScore()` | `GET /evolution/score` | Removed |
| `getSuggestions()` | `GET /evolution/suggestions` | Removed |
| `approveSuggestion(id)` | `POST /evolution/approve/:id` | Removed |

None of the three functions were imported by any component. They were dead code —
present in `api.js` but never called from anywhere in the React frontend.

---

## WHY THESE WERE REMOVED

The evolution system was a prototype "self-improvement" concept that:
- Used input frequency counts to simulate "AI suggestions"
- Was not connected to any real AI or code modification system
- Misleadingly implied autonomous self-modification capability
- Added surface area in the frontend and backend with zero operator value

The backend code was structurally sound but conceptually misleading. Removing it
eliminates the false implication of an autonomous evolution loop.

---

## WHAT REMAINS IN `legacy.js`

`legacy.js` (now ~420 lines) still handles:
- WhatsApp messaging routes (`/whatsapp/*`)
- Telegram messaging routes (`/telegram/*`)  
- Bulk messaging operations
- Follow-up scheduling

These are legitimate active routes used by the CRM workflow. The file is named `legacy.js`
for historical reasons — it is not legacy in the functional sense.

---

## FRONTEND API REFACTOR (Task D)

As part of Phase M, `api.js` was simultaneously refactored from a 283-line monolith into
a domain-split + barrel pattern. The evolution function removal happened as part of this
refactor. See `API_LAYER_REFACTOR_REPORT.md` for the full split details.

---

## VERIFICATION

### Backend — 410 responses confirmed with operator token

```
GET  /evolution/score        → 410 ✓
GET  /evolution/suggestions  → 410 ✓
POST /evolution/approve/1    → 410 ✓
GET  /self-improve/analyze   → 410 ✓
```

### Frontend — no dead imports

Grep confirms no component imports `getEvolutionScore`, `getSuggestions`, or `approveSuggestion`:

```
grep -r "getEvolutionScore\|getSuggestions\|approveSuggestion" frontend/src/
(no results)
```

### Regression

40/40 tests passed. No routes that existed before Phase M (other than the evolution routes)
were affected.

---

## SUMMARY

| Item | Before | After |
|------|--------|-------|
| Evolution backend routes | 7 routes, behind requireAuth | 7 × 410 Gone |
| Evolution frontend functions | 3 dead exports in api.js | Removed |
| `evolutionFallback()` | ~60 lines in legacy.js | Removed |
| Backend surface area | +7 endpoints in attack surface | Cleaned |
| Frontend bundle | +3 exported functions | Removed |
