# JARVIS — Frontend Transformation Plan V1
**Date:** 2026-06-03  
**Source of truth:** PRODUCT_EXPERIENCE_AUDIT.md  
**Constraint:** No backend changes. No new architecture. No new agents. Frontend only.  
**Mission:** Transform JARVIS from "powerful backend with admin UI" into a product that immediately communicates its value.

---

## STRATEGIC FRAME

Every change in this plan answers one of five questions a first-time user asks:

1. **"What is this?"** — Positioning clarity (landing, product overview, tab labels)
2. **"What do I do first?"** — Onboarding activation (WhatsApp step, first lead, first action)
3. **"Is it working?"** — Live feedback (automation status, activity digest, follow-up visibility)
4. **"Where do I go?"** — Navigation confidence (icons, tooltips, IA redesign)
5. **"What else can it do?"** — Capability surface (Control Room promotion, browser automation, OS modules)

---

## A. EXACT IMPLEMENTATION ORDER

### Tier 0 — Zero-Friction Fixes (no design decisions needed)
These are bugs masquerading as features. Fix them before anything else.

| # | Change | File | Time |
|---|---|---|---|
| 0.1 | Trigger `FirstRunSetup` modal in Operator Console | `OperatorConsole.jsx` | 30 min |
| 0.2 | Fix payment description default from "Jarvis Access" → user's product name | `PaymentPanel.jsx` | 20 min |
| 0.3 | Fix currency display from hardcoded `₹` → locale-aware | `Dashboard.jsx` | 45 min |
| 0.4 | Replace pm2 quick actions in Chat with role-relevant examples | `Chat.jsx` | 30 min |
| 0.5 | Make Dashboard empty state `empty-action-hint` a real clickable button | `Dashboard.jsx` + `App.jsx` | 45 min |

**Total Tier 0:** ~3 hours. Zero design risk. Zero regression risk.

---

### Tier 1 — Core Activation (onboarding loop)
Get users to their first value moment within 5 minutes.

| # | Change | File(s) | Time |
|---|---|---|---|
| 1.1 | Add WhatsApp as Onboarding Step 4 (insert existing `WhatsAppSetup`) | `Onboarding.jsx` | 1 day |
| 1.2 | Add follow-up sequence preview after first lead added | `Onboarding.jsx` (done screen) | 3 hrs |
| 1.3 | Add "Jarvis sent X follow-ups today" live status card to Dashboard | `Dashboard.jsx` | 4 hrs |
| 1.4 | Add "what happened while you were away" banner on app load | `App.jsx` | 3 hrs |

---

### Tier 2 — Navigation & Positioning
Make the product feel intentional and navigable.

| # | Change | File(s) | Time |
|---|---|---|---|
| 2.1 | Add icons + tooltip to every tab | `App.jsx`, `App.css` | 4 hrs |
| 2.2 | Rename tabs to match mental models (see Audit §D) | `App.jsx` | 1 hr |
| 2.3 | Promote Control Room: move to position 2 on web with "Power tools →" badge | `App.jsx`, `App.css` | 2 hrs |
| 2.4 | Add product capabilities overview component (the "what is JARVIS" screen) | New: `CapabilitiesOverview.jsx` | 1 day |
| 2.5 | Group tabs visually: core / modules / power | `App.css` | 2 hrs |

---

### Tier 3 — Landing Page Transformation
Fix the first impression for new users.

| # | Change | File(s) | Time |
|---|---|---|---|
| 3.1 | Replace fake hardcoded stats with honest copy | `Landing.jsx` | 1 hr |
| 3.2 | Add persona selector cards after CTA ("What do you want to do?") | `Landing.jsx` | 1 day |
| 3.3 | Rewrite hero headline to be concrete + action-oriented | `Landing.jsx` | 2 hrs |
| 3.4 | Add animated product capability preview (CSS only, no video) | `Landing.jsx`, `Landing.css` | 2 days |
| 3.5 | Surface trust signals (no CC, trial) visually in hero | `Landing.jsx` | 1 hr |

---

### Tier 4 — Clients Tab Depth
The most-used feature needs more than Create + Pay.

| # | Change | File(s) | Time |
|---|---|---|---|
| 4.1 | Add inline lead status edit (dropdown: New/Hot/Scheduled/Paid/Closed) | `PaymentPanel.jsx` | 1 day |
| 4.2 | Add per-lead activity timeline (last contacted, next follow-up, messages sent) | `PaymentPanel.jsx` | 1.5 days |
| 4.3 | Fix WhatsApp message preview before send | `PaymentPanel.jsx` | 4 hrs |

---

### Tier 5 — Control Room Promotion
Surface the crown jewel to users who'd love it.

| # | Change | File(s) | Time |
|---|---|---|---|
| 5.1 | Actually trigger `FirstRunSetup` (Tier 0 item — done first) | `OperatorConsole.jsx` | 30 min |
| 5.2 | Add "Live tasks" mini-widget on Dashboard when Workspace has active executions | `Dashboard.jsx` | 4 hrs |
| 5.3 | Add Control Room teaser on landing for developer persona | `Landing.jsx` | 2 hrs |
| 5.4 | Developer onboarding path ends with live task in Control Room | `Onboarding.jsx` | 1 day |

---

## B. TOP 10 FILES TO MODIFY FIRST

Ranked by: (ROI of change) × (number of users affected) × (effort⁻¹)

### 1. `frontend/src/App.jsx` (368 lines)
**Why first:** Controls tab labels, tab order, welcome message, and routing. Every user sees this. Renaming tabs, adding icons, adding welcome banner, and promoting Control Room all live here.  
**Changes:** Tab rename + icons, "what happened while you were away" banner, promote runtime tab, fix `_welcomeMessage` copy.  
**Impact:** 100% of users on every session. Highest reach of any file.

---

### 2. `frontend/src/components/Dashboard.jsx` (176 lines)
**Why second:** The Revenue/Pipeline tab is the default landing screen for 80% of returning users. Currently a passive numbers display with a broken empty state.  
**Changes:** Fix empty state CTA (make it a real button, not `<span>`), fix ₹ currency, add "Jarvis active" status card, add live follow-up count when automation is running.  
**Impact:** Every returning user's first screen. Converts passive empty state to active funnel.

---

### 3. `frontend/src/components/Onboarding.jsx` (165 lines)
**Why third:** Onboarding is the make-or-break moment. Currently ends without connecting WhatsApp — the activation event for the core use case.  
**Changes:** Add WhatsApp as Step 4, add persona routing (Business vs. Developer), add follow-up sequence preview in done screen, fix completion screen to route immediately to first action.  
**Impact:** Every new user. Directly increases time-to-first-value from "unclear" to "~5 minutes."

---

### 4. `frontend/src/components/PaymentPanel.jsx` (243 lines)
**Why fourth:** The Clients tab is the most-used operational screen. It's missing the two most basic CRM functions: edit and timeline.  
**Changes:** Fix payment description default, add inline status edit, add per-lead activity timeline showing last contact + next follow-up.  
**Impact:** Every user who has leads. Transforms "create + pay" into an actual relationship management tool.

---

### 5. `frontend/src/components/operator/OperatorConsole.jsx` (260 lines)
**Why fifth:** The product's most powerful feature has no first-run guidance. `FirstRunSetup` is built and never called — a 3-line fix that unlocks a fully designed onboarding flow.  
**Changes:** Import `FirstRunSetup` + `shouldShowFirstRun`, add state flag, render modal on first visit.  
**Impact:** Every first-time Workspace user. Unlocks an already-built feature.

---

### 6. `frontend/src/components/Landing.jsx` (166 lines)
**Why sixth:** Public web visitors see this first. Currently selling one persona with fake metrics. The fix is copy + persona cards, not a full rebuild.  
**Changes:** Replace fake metrics, rewrite hero headline, add persona selector, surface trust signals in hero, add developer/operator callout section.  
**Impact:** New user conversion. Correctly positions JARVIS as multi-persona AI OS instead of WhatsApp bot.

---

### 7. `frontend/src/components/Chat.jsx` (216 lines)
**Why seventh:** Chat is the default first tab on web. Quick actions currently expose pm2 commands to non-developer users. Profile-aware quick actions fix the first 10 seconds of the chat experience.  
**Changes:** Make QUICK_ACTIONS persona-aware based on `localStorage.jarvis_biz_profile`, replace pm2 commands for business users with "Follow up with hot leads", "Show revenue", "Who hasn't paid?"  
**Impact:** Every web user's first interaction. Eliminates "this wasn't built for me" moment.

---

### 8. `frontend/src/App.css` (relevant tab section, ~100 lines)
**Why eighth:** Tab styling needs to support icons, grouping separators, and the Control Room "featured" badge. CSS-only changes, no logic risk.  
**Changes:** Add tab icon slot, add `tab--featured` modifier for Control Room, add visual group separator between core/modules/power tiers.  
**Impact:** Global navigation feel. Makes the product look intentional and structured.

---

### 9. `frontend/src/components/operator/widgets/FirstRunSetup.jsx` (existing)
**Why ninth:** While OperatorConsole.jsx is the trigger point, `FirstRunSetup.jsx` needs one content update: the "done" step should include a "Run your first task" CTA that pre-fills the WorkflowPanel with a beginner-safe example.  
**Changes:** Add `onRunFirstTask` prop to done step, emit a suggested command to parent. The component already has a `releaseNotes` section — update it to reflect current feature set.  
**Impact:** Converts a static tutorial into an interactive wow moment inside the Control Room.

---

### 10. New: `frontend/src/components/CapabilitiesOverview.jsx`
**Why tenth:** No single surface in JARVIS communicates its full scope. A one-page "what JARVIS can do" overview, accessible from a new Help/Overview entry point, is the fastest way to increase perceived product value.  
**What it is:** 4–5 capability cards (Autonomous Sales Agent, AI DevOps Runtime, Business OS, Developer Tools, Enterprise Automation) each with a 2-line description, 1 showcase stat, and a "Go to →" link wired to `setTab()`.  
**Impact:** Discovery. Users who know the product's scope use more of it.

---

## C. EXPECTED IMPACT PER CHANGE

| Change | Metric Affected | Expected Outcome |
|---|---|---|
| FirstRunSetup trigger (0.1) | Operator Console adoption | +40–60% of auth'd users get guided intro instead of cold cockpit |
| Fix payment description (0.2) | Trust/professionalism | Eliminates "Jarvis Access" from customer-facing payment links |
| Fix currency (0.3) | Non-Indian user retention | Removes immediate "not built for me" signal for global users |
| Fix Chat quick actions (0.4) | First interaction quality | Business users get relevant suggestions; developer commands not exposed to wrong persona |
| Dashboard empty state CTA (0.5) | Lead creation conversion | Empty state goes from passive read to active click — expect 2–3x first-lead creation rate |
| WhatsApp as Onboarding Step 4 (1.1) | Activation rate | WhatsApp connection at onboarding = follow-ups start immediately = core value realized same session |
| Follow-up sequence preview (1.2) | User confidence | Shows users what automation will do before it happens — reduces "is it working?" anxiety |
| "Jarvis sent X follow-ups" card (1.3) | Retention | Makes automation feel alive and working — the #1 reason to return to the app daily |
| "While you were away" banner (1.4) | Re-engagement | On-login digest creates habit loop — users check in to see what ran |
| Tab icons + tooltips (2.1) | Feature discoverability | Increases tab exploration by first-time users — currently 9 text-only tabs |
| Tab rename (2.2) | Mental model clarity | "Control Room" > "Workspace"; "Ask Jarvis" > "Chat"; eliminates label/content mismatch |
| Control Room promotion (2.3) | Power feature adoption | Operator Console visible before Enterprise tab — right users find it faster |
| Capabilities overview (2.4) | Breadth perception | Users who see the full feature set use more of the product |
| Replace fake landing metrics (3.1) | Trust | Credibility — "72% faster response" is a made-up number |
| Persona selector on landing (3.2) | Signup quality | Routes developers to Dev path, business users to Sales path — reduces wrong-persona churn |
| Hero headline rewrite (3.3) | Conversion | Concrete > abstract. "Send WhatsApp follow-ups + payment links automatically" > "Automate your sales pipeline" |
| Lead status edit (4.1) | Core CRM utility | Clients tab becomes a working CRM instead of a creation-only form |
| Per-lead activity timeline (4.2) | Follow-up visibility | Users can see automation working per-lead — the most direct proof of value |
| Live tasks mini-widget (5.2) | Control Room discovery | Tasks running in Workspace become visible on Dashboard — pulls users into the power feature |

---

## D. 14-DAY EXECUTION ROADMAP

```
DAY 1 — Tier 0 (all quick wins)
├── 0.1  Trigger FirstRunSetup in OperatorConsole.jsx            [30 min]
├── 0.2  Fix PaymentPanel description default                     [20 min]
├── 0.3  Fix Dashboard currency to locale-aware                   [45 min]
├── 0.4  Replace Chat quick actions with persona-aware set        [30 min]
└── 0.5  Make Dashboard empty state CTA a real button            [45 min]
     → Ship. Total ~3.5 hours. Immediate improvement for all users.

DAY 2 — Navigation foundation
├── 2.2  Rename tabs: Chat→Ask Jarvis, Revenue→Pipeline,         [1 hr]
│        Activity→History, Workspace→Control Room
├── 2.1  Add icons to all tabs (CSS + JSX)                       [3 hrs]
└── 2.5  Group tabs visually (core | modules | power)            [2 hrs]
     → Ship. Navigation feels intentional for the first time.

DAY 3 — Onboarding Step 4
└── 1.1  Add WhatsApp connection as Onboarding Step 4            [1 day]
         (insert WhatsAppSetup, update step count, progress bar)
     → Ship. Activation event now happens during onboarding.

DAY 4 — Dashboard alive
├── 1.3  Add "Jarvis active" status card to Dashboard            [4 hrs]
│        (reads from /ops endpoint, shows follow-up count today)
└── 1.4  Add "while you were away" banner on app load            [3 hrs]
         (reads opsData on mount, shows activity since last visit)
     → Ship. Dashboard now reflects a working product, not an empty shell.

DAY 5 — Onboarding completion upgrade
├── 1.2  Add follow-up sequence preview in Onboarding done screen [3 hrs]
│        (Day 0/1/2/4 visual timeline after first lead)
└── Fix Onboarding done screen: route directly to Clients tab    [1 hr]
    (currently routes to chat — wrong first action)
     → Ship. First-time experience has a clear outcome.

DAY 6 — Clients tab depth (part 1)
└── 4.1  Add inline lead status edit (dropdown on each lead card) [1 day]
     → Ship. Clients tab becomes a working CRM.

DAY 7 — Clients tab depth (part 2)
└── 4.2  Add per-lead activity timeline to each lead card         [1.5 days]
         (last contacted, next scheduled, messages sent count)
     → Ship. Follow-up automation becomes visible per-lead.

DAY 8 — Chat improvements + Control Room
├── 2.3  Promote Control Room tab (position 2 on web, add badge)  [2 hrs]
├── 5.2  Add live tasks mini-widget on Dashboard                  [4 hrs]
└── FirstRunSetup content update (run first task CTA)            [2 hrs]
     → Ship. Control Room visible. Power users find it without hunting.

DAY 9 — Landing page (part 1)
├── 3.1  Replace fake metrics with honest copy                   [1 hr]
├── 3.3  Rewrite hero headline                                   [2 hrs]
└── 3.5  Surface trust signals in hero                           [1 hr]
     → Ship. Landing no longer misleads visitors.

DAY 10 — Landing page (part 2)
└── 3.2  Add persona selector cards below hero CTA               [1 day]
         (Sales & Clients | Developer Tools | Business Automation)
     → Ship. Landing routes users to correct experience.

DAY 11 — Capabilities overview
└── 2.4  Build CapabilitiesOverview.jsx                          [1 day]
         Add as "?" or "Overview" entry in nav or Help button
     → Ship. Users discover full product breadth.

DAY 12 — PaymentPanel polish
├── 4.3  WhatsApp message preview before send                    [4 hrs]
└── Connect lead timeline to Dashboard activity card             [2 hrs]
     → Ship. Core sales workflow is professional end-to-end.

DAY 13 — Landing animated preview (optional but high-impact)
└── 3.4  CSS-animated product capability demo in landing hero    [2 days]
         (Frame 1: Chat input. Frame 2: Jarvis sends follow-up.  
          Frame 3: Payment link. Frame 4: Paid. CSS keyframe loop.)
     → Ship. Landing page proves the product works.

DAY 14 — Buffer + QA
├── Cross-browser test all changes
├── Mobile responsive check (tabs with icons on narrow screens)
├── Empty state audit: verify all empty states now have buttons
└── Onboarding end-to-end test: complete flow, WhatsApp step, first lead
     → Release-ready frontend transformation V1 complete.
```

---

## E. QUICK WINS (< 1 Day Each)

These are the highest-ROI changes per hour of work. Do all of them in Day 1–2.

### QW1 — Trigger FirstRunSetup (30 minutes)
**File:** `frontend/src/components/operator/OperatorConsole.jsx`  
**What:** Add 3 lines — import the component, check `shouldShowFirstRun()`, render the modal.  
**Why it's a quick win:** The entire feature is already built. This is literally a missing import + conditional render.

```jsx
// Add to imports:
import { FirstRunSetup, shouldShowFirstRun } from "./widgets/FirstRunSetup";

// Add to state:
const [showFirstRun, setShowFirstRun] = useState(shouldShowFirstRun);

// Add to return (above NotificationOverlay):
{showFirstRun && <FirstRunSetup onComplete={() => setShowFirstRun(false)} rtStatus={rtStatus} />}
```

---

### QW2 — Fix Payment Description (20 minutes)
**File:** `frontend/src/components/PaymentPanel.jsx` — line 64  
**What:** Change `description: "Jarvis Access"` → `description: p?.product || ""`  
**Why it's a quick win:** 1-character-change. Eliminates Jarvis branding from user's customer-facing payment links.

---

### QW3 — Fix Dashboard Currency (45 minutes)
**File:** `frontend/src/components/Dashboard.jsx` — line 132  
**What:** Replace `₹${stats.revenue.toLocaleString("en-IN")}` with locale-aware `Intl.NumberFormat`. Add a helper `_fmtCurrency(amount)` that reads the user's price string prefix or falls back to `navigator.language`.

---

### QW4 — Fix Dashboard Empty State CTA (45 minutes)
**File:** `frontend/src/components/Dashboard.jsx` + `App.jsx`  
**What:** Pass `onNavigate` prop to `Dashboard`. Change `<span className="empty-action-hint">Add your first client</span>` to `<button className="empty-action-btn" onClick={() => onNavigate("clients")}>Add your first client →</button>`.  
**Why it's a quick win:** `<span>` with pointer cursor is not a button. Users click it and nothing happens. This is a 2-file change.

---

### QW5 — Replace Chat Quick Actions (30 minutes)
**File:** `frontend/src/components/Chat.jsx`  
**What:** Make QUICK_ACTIONS read from profile:

```js
function _getQuickActions(profile) {
  if (!profile) return [
    { label: "What can you do?", cmd: "What can Jarvis do?" },
    { label: "Check status",     cmd: "Show system status" },
    { label: "Add a lead",       cmd: "How do I add a lead?" },
    { label: "View pipeline",    cmd: "Show my pipeline" },
  ];
  const isDev = /dev|engineer|code|software|tech/i.test(profile.business || "");
  if (isDev) return [
    { label: "Run tests",        cmd: "Run my tests" },
    { label: "Git status",       cmd: "run git status" },
    { label: "Deploy status",    cmd: "Show deploy status" },
    { label: "Open issues",      cmd: "Show open issues" },
  ];
  return [
    { label: "Hot leads",        cmd: "Show me my hot leads" },
    { label: "This week",        cmd: "What happened this week?" },
    { label: "Payment link",     cmd: "Generate a payment link" },
    { label: "Follow-up status", cmd: "Show follow-up activity" },
  ];
}
```

---

### QW6 — Rename Tabs (1 hour)
**File:** `frontend/src/App.jsx`  
**What:** Update `TABS` and `DESKTOP_TABS` arrays:

| Old | New |
|---|---|
| Chat | Ask Jarvis |
| Revenue | Pipeline |
| Activity | History |
| Clients | Contacts |
| Workspace | Control Room |

These are pure label changes. Zero logic changes. Immediate clarity improvement.

---

### QW7 — Welcome Message Rewrite (30 minutes)
**File:** `frontend/src/App.jsx` — `_welcomeMessage()` function  
**What:** The default welcome message says "I'm your automated sales assistant" — wrong for 80% of users.  
**Fix:** "Hi! I'm Jarvis — your AI operating system. I can automate follow-ups, run code, manage your pipeline, and execute tasks. What do you want to do today?"  
This surfaces the multi-capability positioning on first chat load.

---

### QW8 — Fix Onboarding Done Screen Routing (30 minutes)
**File:** `frontend/src/components/Onboarding.jsx`  
**What:** Currently `onComplete(profile)` routes to Chat tab (`setTab("chat")`). Change to route to "contacts" tab which is the correct first action.  
**In `App.jsx`:** `handleOnboardingComplete` already calls `setTab("clients")` — but the done screen button says "Open Jarvis →" with no indication of what opens. Add: "→ Add your first contact" as the button label.

---

## F. HIGH-IMPACT WINS (1–3 Days Each)

### HW1 — WhatsApp as Onboarding Step 4 (1 day)
**Files:** `Onboarding.jsx`, `WhatsAppSetup.jsx`, `Onboarding.css`  
**What:** Add a 4th step between the rate input and the completion screen.

The step is not a full `WhatsAppSetup` walkthrough (that's 5 sub-steps and too heavy for onboarding). Instead:

```
Step 4: "Connect WhatsApp to start sending messages"
Body: "Jarvis sends follow-ups via WhatsApp. Connect now to activate automation."
Option A: "Set up WhatsApp →" button → opens WhatsAppSetup in a modal
Option B: "Skip for now →" → proceeds to completion screen with note: "You can connect WhatsApp from the Contacts tab."
```

This is the activation event. Every user who skips is a user who won't see value for days.

**Expected impact:** 60–80% of users who see Step 4 attempt WhatsApp connection. Currently 0% connect during onboarding.

---

### HW2 — Per-Lead Activity Timeline (1.5 days)
**File:** `PaymentPanel.jsx`  
**What:** Each lead card (currently shows name, phone, status, amount) gets an expandable timeline row:
```
Ahmed Hassan  [Hot] [Generate Payment Link]
└── 3 messages sent  •  Last: 2h ago  •  Next: Tomorrow 9am
```

Data source: The `/ops` endpoint already returns `automation` stats per tier. The `/crm` endpoint returns leads. Connect them: for each lead, compute which automation tiers have fired based on `createdAt` timestamp vs. tier windows (10min, 6hr, 24hr, 3day).

This is all computable on the frontend with existing data — no backend change.

**Expected impact:** Users see proof that automation is working per-contact. This is the core product value made tangible.

---

### HW3 — "Jarvis Active" Dashboard Status Card (4 hours)
**File:** `Dashboard.jsx`  
**What:** Add a status card above the stats grid that reads from `opsData`:

```
╔══════════════════════════════════════════════════╗
║  ✓  Jarvis is running                            ║
║  Sent 4 follow-ups today  •  Next: Ahmed, 3pm    ║
╚══════════════════════════════════════════════════╝
```

When no automation has run: show a gentle prompt instead of this card.  
Data: `opsData.automation` already has `sent`, `lastRun` per tier. Sum across tiers for total today. Find next scheduled by checking lead `createdAt` + tier offsets.

**Expected impact:** Dashboard goes from "passive numbers" to "proof the product is alive." This is the daily retention hook.

---

### HW4 — Capabilities Overview Component (1 day)
**New file:** `frontend/src/components/CapabilitiesOverview.jsx`  
**What:** A single-screen overview that communicates what JARVIS actually is. Triggered from:
- A new "?" or "About" button in the app header
- A new tab (optional — can be hidden behind a "?" icon)

Layout: 5 feature cards in a 2+3 grid:

```
┌─────────────────────────┐  ┌─────────────────────────┐
│  💬  Ask Jarvis          │  │  ⚡  Control Room         │
│  Chat with an AI that    │  │  Execute tasks, run      │
│  executes actions.       │  │  workflows, automate     │
│                          │  │  anything. Real-time.    │
│  [Open Chat →]           │  │  [Open Control Room →]   │
└─────────────────────────┘  └─────────────────────────┘

┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  📇 Contacts  │  │  📊 Pipeline  │  │  🌐 Browser   │
│  CRM + WhatsApp  │  Business OS   │  Automation   │
│  follow-ups  │  │  + campaigns  │  │  25+ workflows│
│  [Open →]    │  │  [Open →]    │  │  [Open →]    │
└──────────────┘  └──────────────┘  └──────────────┘
```

Each card wired to `onNavigate(tabId)`. Static content, no backend needed.

**Expected impact:** Every user who sees this page understands the full product scope. Drives exploration of underused modules.

---

### HW5 — Landing Page Persona Selector (1 day)
**File:** `Landing.jsx`  
**What:** Below the hero CTA buttons, add a row of 3 persona cards. When clicked, sets a `selectedPersona` state and customizes the onboarding (Step 1 question changes, completion routing changes).

```
"What describes you best?"
┌────────────────┐  ┌────────────────┐  ┌────────────────┐
│  💼 Sales &    │  │  ⚙️ Developer   │  │  🏢 Business   │
│  Freelancer    │  │  & Engineer    │  │  Operator      │
│                │  │                │  │                │
│  Follow up     │  │  Automate dev  │  │  Run business  │
│  with leads    │  │  workflows     │  │  on autopilot  │
│  on WhatsApp   │  │  with AI       │  │                │
│                │  │                │  │                │
│  [Start →]     │  │  [Start →]     │  │  [Start →]     │
└────────────────┘  └────────────────┘  └────────────────┘
```

Pass `persona` prop into `Onboarding.jsx`. Persona = `"sales" | "developer" | "operator"`.

Persona effects:
- **Sales:** Current flow (WhatsApp, leads, payment links)
- **Developer:** Skip WhatsApp step, add "connect your project" step, default tab = Control Room
- **Operator:** Skip business questions, add "configure system" step, default tab = Control Room

**Expected impact:** Reduces wrong-persona churn. Developers no longer hit a WhatsApp sales wizard.

---

### HW6 — Control Room Promotion (2 hours)
**Files:** `App.jsx`, `App.css`  
**What:** Three changes:

1. On web (non-desktop), move "Control Room" tab from position 9 to position 2, right after "Ask Jarvis"
2. Add a `tab--featured` CSS modifier that gives it a subtle accent border: `border-color: rgba(124, 111, 255, 0.3)`
3. Add a tooltip on hover: "AI execution engine — run workflows, automate tasks, control everything"

This is a 2-line array reorder + CSS modifier. The Control Room is the flagship feature and it's currently buried last.

**Expected impact:** Power users find it without hunting. Developer/operator personas immediately see the most relevant feature.

---

## G. NO BACKEND CHANGES CONFIRMATION

Every item in this plan operates on:
- **Existing data** from already-connected endpoints (`/ops`, `/stats`, `/crm`, `/health`)
- **`localStorage`** state (profile, session, onboarding flags)
- **Static content** additions (copy, component structure, CSS)
- **Existing components** already built but not wired (FirstRunSetup, WhatsAppSetup)
- **Frontend routing** (`setTab()`, conditional renders)

No new API routes. No new data models. No schema changes. No agent modifications.

---

## EXECUTION PRINCIPLES

1. **Ship each Tier as a unit.** Don't mix Tier 0 fixes with Tier 3 landing changes in the same PR.
2. **Test the full onboarding flow after every merge.** Landing → Persona select → Onboarding steps → App → First action.
3. **No new abstractions.** The pattern is: modify existing components. Don't create new routing layers, new context providers, or new hooks for these changes.
4. **Measure with `localStorage` flags.** Track `jarvis_first_lead_ts`, `jarvis_whatsapp_connected_ts`, `jarvis_control_room_visited` to understand which changes are moving behavior without backend analytics.
5. **The goal is perceived value, not feature count.** Every change should make JARVIS feel more alive, more capable, and more built for the user in front of it.

---

## WHAT DONE LOOKS LIKE

After 14 days, a first-time user will:

1. Land on a page that shows what JARVIS is for *their* persona (not just "WhatsApp sales pipeline")
2. Complete onboarding in under 3 minutes with WhatsApp connected
3. See their first automated follow-up on the Dashboard — live, timestamped, per-contact
4. Navigate a tab bar with icons they understand
5. Discover the Control Room naturally (second tab, featured badge, live tasks widget on Dashboard)
6. See a product that clearly communicates: *this is an AI Operating System, and it's working right now*

That is the transformation.
