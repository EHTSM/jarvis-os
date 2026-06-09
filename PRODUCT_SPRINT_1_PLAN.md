# Product Experience Sprint 1
**Date:** 2026-06-03  
**Goal:** Product Readiness 60% → 75%  
**Constraint:** Existing backend only. No new APIs. No new agents. No architecture.  
**Data available:** `/ops` (automation, services, queue, crm), `/stats` (totals, revenue), `/crm` (leads with timestamps), `/runtime/history` (execution entries)

---

## What "75% Readiness" Means in Practice

At 60%, JARVIS works but doesn't communicate that it's working.  
At 75%, a user who logs in for the first time:
- Immediately understands what JARVIS can do (Capabilities Overview)
- Sees the Control Room without hunting for it (promotion)
- Knows whether Jarvis ran anything while they were away (While You Were Away)
- Gets a clear first win moment (First Success experience)
- Sees activity as a timeline, not category stats (Activity tab)
- Hits empty states with a button, not a wall of text

---

## A. EXACT FILES

### Modified
| File | What Changes |
|---|---|
| `frontend/src/App.jsx` | Tab rename (Workspace→Control Room), tab reorder, `onNavigate` prop threading, welcome message rewrite, WYWA card injection |
| `frontend/src/App.css` | `.tab--featured` modifier, `.wywa-*` card styles |
| `frontend/src/components/Dashboard.jsx` | WYWA card slot, empty state CTA button (not span), `onNavigate` prop |
| `frontend/src/components/Dashboard.css` | `.wywa-*` card styles, `.empty-action-btn` style |
| `frontend/src/components/Logs.jsx` | Replace category cards with chronological timeline, add CTA to empty state |
| `frontend/src/components/Logs.css` | `.timeline-*` styles |
| `frontend/src/components/Chat.jsx` | Persona-aware quick actions from profile |
| `frontend/src/components/operator/OperatorConsole.jsx` | Wire FirstRunSetup (3 lines) |

### New
| File | What It Is |
|---|---|
| `frontend/src/components/CapabilitiesOverview.jsx` | "What JARVIS can do" panel — static, wired to `onNavigate` |
| `frontend/src/components/CapabilitiesOverview.css` | Styles for capabilities cards |

---

## B. EXACT COMPONENTS

### 1. `CapabilitiesOverview` — new component
A full-tab panel. Shows 5 capability cards, each wired to navigate to the relevant tab. Appears as a new "Overview" tab (or reachable from the first-launch hint). Static content — zero API calls.

Cards:
- **Ask Jarvis** — "Chat with an AI that takes action" → `chat`
- **Contacts & Pipeline** — "Manage leads, send follow-ups, collect payment" → `clients`
- **Control Room** — "Execute tasks, run workflows, automate anything" → `runtime`
- **Business OS** — "Pipeline, campaigns, revenue" → `business`
- **Dev Tools** — "Repos, builds, deployments" → `developer`

Each card has: icon, title, 1-line description, and a `→` button that calls `onNavigate(tabId)`.

---

### 2. "While You Were Away" card — in `Dashboard.jsx`
A dismissible card shown at the top of the Pipeline/Revenue tab on app load. Uses existing `/ops` + `/stats` data already polling every 8s. Dismissed via `localStorage` key `jarvis_wywa_dismissed_ts` — reappears after 24h if new activity exists.

Logic (pure frontend, no new API):
```
totalSent = sum(ops.automation.*.sent)
lastActivity = max(ops.automation.*.lastRun)
sinceLastVisit = Date.now() - localStorage.getItem('jarvis_last_visit_ts')

If totalSent > 0 AND sinceLastVisit > 5 minutes:
  Show: "Jarvis sent {X} follow-ups since you last checked. {Y} leads are hot."
Else if totalSent === 0 AND stats.total > 0:
  Show: "Jarvis is ready — {N} contacts loaded, follow-ups will start once WhatsApp is connected."
Else:
  Don't show card.
```

`jarvis_last_visit_ts` is written to `localStorage` on every app mount.

---

### 3. Activity timeline — replace `Logs.jsx` category cards
Current: 6 category stat cards (First message: 0 sent, Same-day: 0 sent…).  
Problem: aggregate stats for a fresh account are all zeros — no story, no proof of life.

New: a synthesized chronological timeline built from `ops.automation` + `stats` + `crm` lead `createdAt` timestamps that already exist in the `/crm` response.

Timeline events (derived from existing data, no new endpoints):
- `{lead.name} added` — from `crm` leads sorted by `createdAt`
- `First message scheduled` — `createdAt + 10min` if `ops.automation["10min"].attempts > 0`
- `Follow-up sent` — from `ops.automation["6hr"].sent > 0`
- `Marked Hot` — from `stats.hot > 0`
- `Payment collected` — from leads with `paymentStatus === "paid"` + `paidAt`

For a fresh account (no automation fired): shows lead creation events only with "Next: first message in ~{X} minutes" as a future event.

The category stats section stays but moves below the timeline — it becomes a detail view, not the hero.

Empty state gets a real CTA button: "Add your first contact →" wired to `onNavigate("clients")`.

---

### 4. Control Room promotion — in `App.jsx`
Two changes:
1. Move `runtime` tab from position 9 to position 2 in `TABS` (web) — right after Chat
2. Add `featured: true` flag to the runtime tab entry; CSS `.tab--featured` gives it a subtle violet border accent

Desktop already puts it first — no change needed there.

Tab order after change (web):
```
[Ask Jarvis] [Control Room★] [Pipeline] [History] [Contacts] [Personal] [Business] [Developer] [Enterprise]
```

The `★` is just a CSS indicator — no emoji in the label.

---

### 5. FirstRunSetup wire — `OperatorConsole.jsx`
The 3-line fix documented in the audit. Already fully designed and built in `widgets/FirstRunSetup.jsx`. Just needs to be imported and called.

---

### 6. Empty state CTA upgrade — `Dashboard.jsx`
Change `<span className="empty-action-hint">Add your first client</span>` to a real `<button>` that calls `onNavigate("clients")`. Pass `onNavigate={setTab}` from `App.jsx`.

---

### 7. Chat quick actions — `Chat.jsx`
Make `QUICK_ACTIONS` read the user's `jarvis_biz_profile` from localStorage and return persona-aware suggestions. Developer profiles get git/test commands. Sales/business profiles get lead/revenue commands. New users (no profile) get discovery commands.

---

## C. IMPLEMENTATION ORDER

Order is determined by: (user-facing impact) + (zero regression risk first).

### Day 1 — Zero-Risk Wins
These touch only isolated files, no prop threading, no cross-component dependencies.

**1.1** `OperatorConsole.jsx` — Wire FirstRunSetup (3 lines, already built)  
**1.2** `Chat.jsx` — Persona-aware quick actions (isolated, no props)  
**1.3** `App.jsx` — Rename tabs + move Control Room to position 2 + add `tab--featured` CSS  

---

### Day 2 — Navigation & Empty States
**2.1** `App.jsx` — Pass `onNavigate={setTab}` to Dashboard and Logs  
**2.2** `Dashboard.jsx` — Change empty state `<span>` → `<button onClick={() => onNavigate("clients")}>`  
**2.3** `Logs.jsx` — Add CTA button to empty state wired to `onNavigate("clients")`  
**2.4** `App.jsx` — Rewrite `_welcomeMessage` to communicate full product scope  

---

### Day 3 — While You Were Away Card
**3.1** `App.jsx` — Write `jarvis_last_visit_ts` to localStorage on mount  
**3.2** `Dashboard.jsx` — Add `WywaCard` sub-component at top of dashboard  
**3.3** `Dashboard.css` — Add `.wywa-*` styles  

---

### Day 4 — Activity Timeline
**4.1** `Logs.jsx` — Add `TimelineView` sub-component above existing category cards  
**4.2** `Logs.css` — Add `.timeline-*` styles  
**4.3** Verify timeline renders correctly for empty state, partial state, full state  

---

### Day 5 — Capabilities Overview
**5.1** Create `CapabilitiesOverview.jsx` + `CapabilitiesOverview.css`  
**5.2** `App.jsx` — Add `overview` tab entry at position 1 (after Chat), pass `onNavigate`  
**5.3** Wire first-launch hint to auto-navigate to Overview instead of generic hint copy  

---

## D. EXPECTED UX IMPACT

| Change | Metric | Expected Outcome |
|---|---|---|
| Control Room moved to tab 2 | Power feature discovery | Developer/operator users find Control Room in first 60 seconds instead of never |
| Control Room featured styling | Perceived importance | Users understand this tab is different/important before clicking |
| FirstRunSetup wired | Workspace onboarding | 100% of first-time Control Room users get a guided intro (currently 0%) |
| Chat persona-aware quick actions | First interaction quality | Business users see "Hot leads / Payment link" not "pm2 list". Immediate relevance signal. |
| Tab rename (Workspace→Control Room) | Mental model clarity | "Control Room" communicates authority and purpose; "Workspace" does not |
| WYWA card | Return visit engagement | Returning users immediately see what ran; removes "is this thing even doing anything?" doubt |
| Dashboard empty state button | First lead conversion | CTA goes from dead `<span>` to actionable `<button>`; removes the #1 first-action dead end |
| Activity timeline | Proof of automation | Users see a narrative ("Ahmed added → message scheduled → follow-up sent") instead of "0 sent, 0 sent, 0 sent" |
| Activity empty state CTA | Dead-end elimination | Empty Activity tab now routes to Clients instead of stranding user |
| Capabilities Overview tab | Product breadth perception | Users who click it understand JARVIS is 5 products; drives exploration of underused modules |
| Welcome message rewrite | First chat impression | "Your AI Operating System" vs "automated sales assistant" — sets the right expectation for 80% of users who aren't doing sales |

---

## E. 5-DAY EXECUTION PLAN

```
DAY 1 — Isolated wins, zero regression risk
  [ ] 1.1  OperatorConsole.jsx: wire FirstRunSetup (3 lines)
  [ ] 1.2  Chat.jsx: persona-aware QUICK_ACTIONS
  [ ] 1.3  App.jsx: tab rename + Control Room to position 2 + tab--featured CSS

DAY 2 — Prop threading + empty state buttons
  [ ] 2.1  App.jsx: pass onNavigate={setTab} to Dashboard + Logs
  [ ] 2.2  Dashboard.jsx: empty state span → button
  [ ] 2.3  Logs.jsx: empty state CTA button
  [ ] 2.4  App.jsx: rewrite _welcomeMessage

DAY 3 — While You Were Away
  [ ] 3.1  App.jsx: write jarvis_last_visit_ts on mount
  [ ] 3.2  Dashboard.jsx: WywaCard component + dismiss logic
  [ ] 3.3  Dashboard.css: .wywa-* styles

DAY 4 — Activity timeline
  [ ] 4.1  Logs.jsx: TimelineView sub-component
  [ ] 4.2  Logs.css: .timeline-* styles
  [ ] 4.3  Smoke-test: empty / partial / full data states

DAY 5 — Capabilities Overview
  [ ] 5.1  CapabilitiesOverview.jsx + CapabilitiesOverview.css (new)
  [ ] 5.2  App.jsx: add 'overview' tab, pass onNavigate
  [ ] 5.3  App.jsx: first-launch hint → point to Overview tab

DONE: 10 changes across 8 files. 2 new files (CapabilitiesOverview).
Zero new backend calls. Zero new agents. Zero architecture changes.
```

---

## Data Sources Confirmed (no new endpoints needed)

| Feature | Data Source | Already Polled? |
|---|---|---|
| WYWA card — messages sent | `opsData.automation.*.sent` | Yes — 8s poll |
| WYWA card — hot leads | `stats.hot` | Yes — 8s poll |
| WYWA card — last activity | `opsData.automation.*.lastRun` | Yes — 8s poll |
| Activity timeline — lead events | `stats` via `/stats` + `/crm` | `/stats` yes; `/crm` loaded by PaymentPanel |
| Activity timeline — automation events | `opsData.automation` | Yes — 8s poll |
| Activity timeline — conversions | `stats.paid`, `stats.revenue` | Yes — 8s poll |
| First success — payment collected | `stats.paid > 0` | Yes — 8s poll |
| Capabilities Overview | Static content | N/A |
| Control Room badge | None needed | N/A |

All data for every feature is available from endpoints already being polled.
