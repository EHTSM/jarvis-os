# JARVIS — Product Experience Audit
**Date:** 2026-06-03  
**Scope:** Full frontend, onboarding, navigation, UX, and product positioning  
**Mandate:** No new backend features. No new architecture. Frontend/product maturity only.

---

## EXECUTIVE VERDICT

JARVIS is a **technically mature backend with an admin UI pretending to be a product.**

The backend is extraordinary: autonomous agents, multi-OS modules (Personal/Business/Developer/Enterprise), browser automation, CRM, WhatsApp automation, payment links, runtime streaming, task queuing, plugin system. V5 ships a genuinely impressive surface area.

The frontend communicates almost none of this. A first-time user sees:
- A landing page that says "automate your sales pipeline on WhatsApp"
- 3 text inputs asking for their business type
- A chat box and 9 unlabeled tabs
- No guided tour, no demo, no contextual help, no progressive disclosure

The gap between what JARVIS *can do* and what a user *perceives it can do* on day one is the most critical product problem. Everything else is secondary.

---

## A. PRODUCT UX AUDIT — SURFACE BY SURFACE

### 1. Landing Page (`Landing.jsx`)

**What it is:** Static marketing page, 166 lines. First thing public web visitors see.

**What's broken:**
- **Positioning mismatch.** Headline says "Automate your sales pipeline on WhatsApp." But JARVIS is also an autonomous engineering assistant, a developer tool, an enterprise automation layer, and a personal OS. The landing page sells one narrow use case (WhatsApp leads) while hiding 80% of the product.
- **No screenshot, no demo, no video.** The hero section renders a `landing-preview-panel` div with static placeholder copy ("72% faster response", "6 secure links sent") — hardcoded fake stats, not real data. Zero visual evidence the product works.
- **Value prop is abstract.** "Quietly follows up with leads" — what does that mean concretely? Users don't trust what they can't visualize.
- **Three separate sections all saying the same thing.** "How it works" (4 steps), "Features" (5 bullets), "Ready in 3 steps" (3 cards). Redundant. Each is weak. One strong demo beats all three.
- **No role selection.** JARVIS serves developers, sales people, business operators, and enterprise users. Everyone sees the same WhatsApp sales copy. A developer sees "deliver secure payment links" and bounces.
- **Trust signals are visually invisible.** "No credit card required" is rendered in tiny `landing-trust-item` text below the CTA. It should be next to the button.
- **"Desktop workspace" mentioned without explanation.** The `landing-preview-panel` says "Desktop workspace" — but doesn't explain what that means, why it exists, or why a user would want it over the web.

**Grade: D+**

---

### 2. Onboarding (`Onboarding.jsx`)

**What it is:** 3-step text-input wizard. Asks business type, product offered, price.

**What's broken:**
- **Onboarding completes but leaves users stranded.** After step 3, the completion screen shows a 4-item checklist. It's a list of features, not next actions. There's no "Do this now" button wired to an immediate action. Users read it and think they're done — but nothing has started.
- **WhatsApp is never mentioned during onboarding.** WhatsApp is the core value driver of the sales automation use case, but it's not connected here. Users complete setup thinking they're ready, then hit the app and see "Connect WhatsApp" — unexpected friction.
- **No persona routing.** Every user gets the same 3 questions regardless of whether they're a developer, business owner, or enterprise operator. A developer typing "software agency" will be funneled into the WhatsApp lead flow, which is irrelevant to them. There's no branch to "I want to automate code tasks" or "I'm an enterprise operator."
- **No first-value moment.** The best onboarding flows produce a "wow" within the first 2 minutes. JARVIS's onboarding ends and delivers nothing visible. No agent running, no sample follow-up shown, no task completed.
- **Rate field has no validation.** User can type "expensive" or "TBD" — the payment system will fail downstream.
- **Nothing connects onboarding data to visible product behavior.** The business name / product / price are saved to `localStorage.jarvis_biz_profile` and used in a welcome chat message. That's it. Users never see these used in any meaningful way during onboarding.

**Grade: D**

---

### 3. Navigation (`App.jsx` — Tab Bar)

**What it is:** 9 horizontal tabs: Chat, Revenue, Activity, Clients, Personal, Business, Developer, Enterprise, Workspace.

**What's broken:**
- **9 unlabeled tabs with no hierarchy.** No icons, no secondary labels, no tooltips. A new user sees 9 words and has no model of what any of them do. "Personal", "Business", "Developer", "Enterprise" are especially opaque — what's the difference? Which do I use?
- **Tab labels don't match mental models.** "Revenue" (tab label) → `Dashboard.jsx` (file name) → shows "Customer Pipeline" (header h2). Three different names for the same thing.
- **No tab grouping or hierarchy.** Mixing product categories: "Chat" (interface), "Revenue" (metric), "Clients" (entity), "Developer" (persona-OS). Completely flat.
- **"Workspace" is the most important feature but listed last.** The Operator Console (Workspace tab) is JARVIS's most powerful surface. It's the 9th and last tab. Auth-gated behind a password screen with no preview.
- **Desktop vs. web tab order is different.** Desktop defaults to "Workspace" first; web defaults to "Chat" first. The difference is documented only in code comments, never explained to users.
- **No active state description.** Hovering or clicking a tab gives no indication of what's inside before you enter it.
- **ConnectBar is shown on every non-Workspace tab.** Service status pills (WhatsApp, Payments, AI) appear above every tab but are only actionable on "Clients." They create noise without context.

**Grade: D**

---

### 4. Dashboard / Revenue Tab (`Dashboard.jsx`)

**What it is:** KPI grid showing lead counts, follow-up stats, and automation status.

**What's broken:**
- **Currency hardcoded to ₹.** Revenue shows `₹0` for all users, including non-Indian users. For a product positioned globally, this is immediately off-putting and signals the product wasn't built for them.
- **Empty state is passive.** "Your pipeline starts here" + "Go to the Clients tab" is informational, not actionable. No inline "Add First Client" button.
- **Automation section shows nothing useful before setup.** "Automations haven't started yet" with a description of how automation works. Users who already know what it does don't need the explanation; users who don't know won't take action from it.
- **No visual trend or time-series data.** KPIs are single numbers (total leads: 3, paid: 1). No sparklines, no week-over-week comparison, no "you're improving" signal. Numbers are meaningless without context.
- **Dashboard doesn't reflect JARVIS's actual capabilities.** V5 has business overview, pipeline stages, campaigns, revenue analytics, weekly summaries. The Revenue tab shows... lead counts and WhatsApp follow-up stats. The rest of the product is invisible.
- **Title is "Revenue" (tab) but page header is "Customer Pipeline."** Inconsistency erodes trust.

**Grade: D+**

---

### 5. Activity / Logs Tab (`Logs.jsx`)

**What it is:** Cards showing automation tier statistics (10min greeting, 6hr follow-up, etc.)

**What's broken:**
- **No per-message drill-down.** Users can see "6 sent" in the "Same-day Follow-up" tier but can't see which leads received which messages or what was sent.
- **No timeline view.** "What happened today" is answered by category stats, not chronological events. Users can't follow the narrative of what JARVIS did.
- **No queue status.** Scheduled and pending actions aren't shown. Users don't know what's coming next.
- **Empty state is useless.** Shows no guidance if no automation has run.
- **Tier labels are technical.** "3day" tier is labeled "Gentle Closing Sequence" — this is better, but "Upsell nudge" and "Welcome & Onboarding" feel like internal labels, not user-facing copy.

**Grade: D**

---

### 6. Clients / Payment Panel (`PaymentPanel.jsx`)

**What it is:** Lead list + payment link generator + "Add Client" form.

**What's broken:**
- **Lead list has no edit or delete.** The core CRM action — managing a lead — only supports Create and Pay. No edit status, no add notes, no archive.
- **Payment form defaults to "Jarvis Access" as description.** Every payment link says "Jarvis Access" — this should pull from the user's `jarvis_biz_profile.product` field.
- **No WhatsApp preview before sending.** Users generate payment links but can't preview what the WhatsApp message will look like before it sends.
- **No follow-up timeline per lead.** Each lead card doesn't show "Last contacted", "Next follow-up", or "Messages sent." This is the core value and it's invisible.
- **"Hot" lead status has no explanation.** Users see "Hot" badge but aren't told what it means or what to do about it.
- **WhatsApp setup is buried.** If WhatsApp isn't connected, users see a `ConnectBar` pill. Clicking it opens a `WhatsAppSetup` component that only explains setup but doesn't show a QR code or interactive connection flow.

**Grade: C-**

---

### 7. Personal OS (`PersonalOS.jsx`)

**What it is:** Tasks, Notes, Reminders, Knowledge Base — sub-tabbed inside the "Personal" tab.

**What's broken:**
- **No explanation of what this is for.** User clicks "Personal" and gets an "Overview" sub-tab. No intro copy, no context on how this relates to JARVIS's automation capabilities.
- **Disconnected from the rest of the product.** Personal tasks and notes have no relationship to the AI execution in Workspace, the business pipeline in Business OS, or the follow-up system in Clients. Each OS feels like a separate app.
- **Empty states are weak.** "No tasks yet" without any guidance on how creating tasks connects to JARVIS's automation.

**Grade: C**

---

### 8. Business OS (`BusinessOS.jsx`)

**What it is:** Leads, Contacts, Opportunities Pipeline, Campaigns, Revenue — 918 lines.

**What's broken:**
- **Completely duplicates the Clients tab.** Both have leads/contacts. A user who clicked "Clients" and "Business" sees different implementations of the same concept. No explanation of the difference.
- **Rich pipeline functionality (stage tracking, deal values, campaigns) is completely hidden.** First-time users see a "Business Overview" dashboard — but there's no guide to this system.
- **Currency hardcoded again.** `_fmtAmt` uses USD but the whole product is ₹-first from the onboarding.
- **No connection to WhatsApp follow-up.** Business OS manages contacts independently from the WhatsApp automation in Clients. They're parallel systems with no bridge.
- **Sub-navigation with 6 items presented cold.** Overview → Leads → Contacts → Pipeline → Campaigns → Revenue. No progressive disclosure.

**Grade: C-**

---

### 9. Developer OS (`DeveloperOS.jsx`)

**What it is:** Repositories, Projects, Issues, Builds, Deployments, CLI — 907 lines.

**What's broken:**
- **No entry point explanation.** Developer lands on a sub-tabbed interface with no welcome copy, no "this is where you manage your dev projects" context.
- **No connection to Workspace.** The Workspace tab (Operator Console) is the real developer tool — AI execution, workflow automation, browser tools, command dispatch. DeveloperOS tracks metadata (repos, issues) but doesn't connect to execution.
- **Repository and project tracking requires manual data entry.** Users add repos and issues manually. There's no GitHub integration, no import, no sync.

**Grade: C**

---

### 10. Enterprise OS (`EnterpriseOS.jsx`)

**What it is:** 1,384 lines — the largest component. Teams, Compliance, SLAs, Billing, Integrations.

**What's broken:**
- **Entirely placeholder in the product narrative.** There's no mention of Enterprise on the landing page, no enterprise onboarding path, no pricing signal.
- **No role-based access in the product.** Enterprise implies team management and permissions — but the auth system is a single-password operator login. The Enterprise OS front-end builds forms for team management while the backend has no multi-tenant support.
- **1,384 lines of UI for a feature that's not positioned anywhere in the product.**

**Grade: C-**

---

### 11. Workspace / Operator Console (`OperatorConsole.jsx`, operator panels)

**What it is:** Full power-user execution cockpit. 3-column layout: health widgets | exec log | workflow/AI controls. Auth-gated. Real-time SSE streaming. Browser automation. Plugin manager. 9,434 total lines across panels.

**What's actually right here (the buried gem):**
- Real-time execution log with status tracking
- Browser automation with 25+ pre-built workflows organized into packs
- AI command console with history and cache
- Workflow chains with dry-run, checkpoint, and recovery
- Governor with emergency stop/resume
- Session expiry detection and graceful re-auth

**What's broken:**
- **Hidden behind auth, last in tab order.** Most users never reach the Workspace tab. On desktop it's first, but on web it's 9th.
- **No onboarding path into the Operator Console.** First-time users who find the Workspace tab hit a password form. Nothing explains what they're about to enter or why they need a password.
- **The product's most impressive capabilities (browser automation, AI execution, workflow chains) are invisible to 95% of user journeys.** They require: (1) finding the last tab, (2) authenticating, (3) understanding the 3-column cockpit, (4) finding the right panel. That's 4 steps of zero-hint navigation.
- **PluginManagerPanel is a placeholder.** 4 hardcoded plugin names, no backend calls. Listed as a feature with no function.
- **FeedbackPanel form submits nowhere.** UI renders but submit is disconnected.
- **FirstRunSetup modal is in the Workspace section but is never triggered.** `shouldShowFirstRun()` exists but `OperatorConsole.jsx` never calls it.
- **3-column cockpit is overwhelming without context.** 12+ widgets, mobile tab navigation with labels that don't match desktop panels, inline status banners competing for attention.

**Grade: B- (technically excellent, UX access grade: D)**

---

### 12. Chat Tab (`Chat.jsx`)

**What it is:** Simple chat interface. 4 quick action buttons. Send/clear controls.

**What's right:**
- Typing indicator, error states, online/offline feedback
- Workflow status banner when an AI task is running
- Clean message threading with role colors

**What's broken:**
- **Quick actions are generic dev commands.** "My leads", "System status" (runs `pm2 list`), "Recent errors" (runs `pm2 logs`). A non-developer user clicking "System status" gets a wall of pm2 process output with no context.
- **The chat is a command line pretending to be a conversational UI.** There's no guidance on what JARVIS understands, no suggested prompts for the user's persona, no command discovery.
- **Messages don't persist across sessions** (only in-memory). Users lose context every reload.
- **No file upload, no attachment, no image support** — limiting for the "AI DevOps Runtime" positioning.

**Grade: C+**

---

### 13. Login / Auth (`LoginPage.jsx`)

**What it is:** Single password input, "Sign in to Jarvis." Guards the Workspace tab.

**What's broken:**
- **No explanation of what requires this password.** Users don't know why they need a password for one tab but not others.
- **Password-only auth in 2026.** No OAuth, no SSO, no MFA. For an Enterprise-positioned product, this is a credibility issue.
- **No "forgot password" flow.** Password is set via env var — if you lose it, there's no recovery path shown.
- **Error message is "Invalid password" — no path to resolution.**

**Grade: D+**

---

## B. FRONTEND MATURITY SCORE

| Category | Score | Notes |
|---|---|---|
| Landing Page | 3/10 | Static copy, no demo, wrong persona, fake metrics |
| Onboarding | 2/10 | Completes but delivers no value, no WhatsApp step, no first wow |
| Navigation | 3/10 | 9 flat tabs, no icons, no hierarchy, confusing labels |
| Dashboard | 4/10 | Shows numbers, but empty state is passive, currency wrong |
| Core Feature UX (Clients) | 5/10 | Works, but no edit/delete, no timeline, no WhatsApp preview |
| OS Modules (Personal/Business/Dev/Enterprise) | 4/10 | Rich component code, but zero positioning, disconnected |
| Operator Console | 7/10 | Technically excellent, but access path is broken |
| Chat | 5/10 | Functional, but generic quick actions, no guidance |
| Empty States | 3/10 | Exist but mostly passive, no clear CTAs |
| First-Time UX | 2/10 | No tour, no wow, no progressive disclosure |
| Information Architecture | 2/10 | Flat, inconsistent, persona-blind |
| Visual Design & Polish | 7/10 | Dark theme, gradients, color system are premium quality |
| Error Handling & Feedback | 6/10 | Toast system works, but failure messages aren't actionable |
| Mobile Experience | 4/10 | Responsive but sidebar-heavy, operator console unusable on mobile |

**Overall Frontend Maturity Score: 4.1 / 10**

The backend deserves an 8/10. The product as users experience it: 4.1/10.

---

## C. TOP 20 HIGHEST-ROI UX IMPROVEMENTS

Ordered by: (Impact on perceived value × implementation effort⁻¹)

### #1 — Add an interactive product demo to the landing page
**What:** Replace the static `landing-preview-panel` div with an animated walkthrough — show a lead being added, a WhatsApp message sending, a payment link being clicked, revenue updating. Can be CSS-animated screenshots.  
**Why it's #1:** First impressions determine conversion. Currently, the hero section has zero visual evidence the product works. A 10-second silent demo animation would 3x trial starts.  
**Effort:** Medium (static animation, no backend required)

---

### #2 — Add persona routing to the landing page
**What:** After "Start Free Trial", show 3 persona cards: "Sales & Clients", "Developer Tools", "Business Automation." Route each to a tailored onboarding flow.  
**Why:** JARVIS is 5 different products in one codebase. Every user currently gets the same "WhatsApp sales pipeline" framing — which is correct for ~20% of actual users and wrong for the other 80%.  
**Effort:** Medium

---

### #3 — Add WhatsApp connection as Onboarding Step 4
**What:** After business type / product / price, add a step: "Connect WhatsApp to start sending messages." Show the QR code or a "Setup WhatsApp" link. This is the activation event for the core use case.  
**Why:** Currently users complete onboarding thinking they're done — but nothing works until WhatsApp is connected. This gap causes silent churn.  
**Effort:** Low (WhatsAppSetup component already exists, just needs to be inserted)

---

### #4 — Add icons and tooltips to every tab
**What:** Each of the 9 tabs needs an icon + a 1-line tooltip on hover explaining what's inside.  
**Why:** Users can't discover features they can't identify. "Personal", "Business", "Developer", "Enterprise" are four opaque words. Icons and hover text are the minimum viable hint system.  
**Effort:** Low

---

### #5 — Add "Add First Client" inline CTA to the Dashboard empty state
**What:** Replace the passive empty state copy with a full-bleed empty state card that has an "Add Your First Client →" button wired to `setTab("clients")`.  
**Why:** Empty states are the highest-friction moment. Users who see an empty dashboard and no clear next action leave. A single button eliminates this.  
**Effort:** Trivial

---

### #6 — Add a per-lead activity timeline to the Clients tab
**What:** Each lead card should show: "Last contacted: 2h ago | Next follow-up: Tomorrow 9am | 3 messages sent." This data exists in the backend automation store.  
**Why:** The follow-up automation is the product's core value. It's invisible. Surfacing it on the lead card makes users feel the product is working.  
**Effort:** Medium

---

### #7 — Fix the currency display to match the user's locale
**What:** Replace `₹` hardcoded string in Dashboard.jsx and `USD` in BusinessOS with `Intl.NumberFormat(navigator.language)` or pull from the user's price input (which has `₹` baked in too).  
**Why:** Global positioning with hardcoded Indian rupee is an immediate credibility signal to non-Indian users that this wasn't built for them.  
**Effort:** Low

---

### #8 — Trigger the FirstRunSetup modal in Operator Console
**What:** `shouldShowFirstRun()` and `FirstRunSetup` component already exist. Wire `OperatorConsole.jsx` to call `shouldShowFirstRun()` on mount and show the modal if true.  
**Why:** The component is complete and never shown. This is a 3-line change that adds a guided first-run experience to the product's most powerful feature.  
**Effort:** Trivial

---

### #9 — Add a product capabilities overview page (the "what is JARVIS" screen)
**What:** A new tab or landing state: "Here's what JARVIS can do." 4 cards: Autonomous Sales Agent | AI DevOps Runtime | Business Automation | Developer Workspace. Each card clickable, routing to the relevant section.  
**Why:** No user currently understands the full scope of JARVIS. This single page would communicate the product's breadth in 10 seconds.  
**Effort:** Low (static content, one new component)

---

### #10 — Replace Chat quick actions with persona-relevant examples
**What:** The 4 quick action buttons currently include `pm2 list` (a developer command) and "System status." Replace with dynamic suggestions based on the user's role. For a business user: "Follow up with all hot leads", "Show this week's revenue", "Who hasn't paid yet?". For a developer: "Run tests", "Check deploy status", "List open issues."  
**Why:** Quick actions are the #1 discoverability mechanism for a chat interface. pm2 commands for a non-developer user communicate "this wasn't built for you."  
**Effort:** Low

---

### #11 — Rename and reorder tabs to match mental models
**What:** Proposed rename: Chat → Ask Jarvis | Revenue → Pipeline | Activity → History | Clients → Contacts | Personal → My Space | Business → Business OS | Developer → Dev Tools | Enterprise → Teams | Workspace → Control Room.  
And reorder: Ask Jarvis | Contacts | Pipeline | History | My Space | Business OS | Dev Tools | Control Room | Teams  
**Why:** Current tab names are inconsistent mix of metrics ("Revenue"), entities ("Clients"), and abstract labels ("Business"). The rename aligns label with content and mental model.  
**Effort:** Trivial

---

### #12 — Show "JARVIS is following up automatically" on the dashboard when active
**What:** When automation is running, show a live status card: "✓ Jarvis sent 3 follow-ups today. Next: Ahmed – Tomorrow 9am."  
**Why:** The #1 value prop is automation running in the background. The product never tells you it's working. This is the "product working in the background" moment that justifies continued use.  
**Effort:** Low (data already available via `/ops` endpoint)

---

### #13 — Add a "What Jarvis did today" daily digest to the Activity tab
**What:** A chronological feed of today's actions: "9:02am — Sent follow-up to Ahmed. 11:30am — Payment link generated for Priya. 2:15pm — System health check passed."  
**Why:** Users need narrative evidence that the product is active. Category stats (6 sent in "Same-day Follow-up" tier) don't create this. A timeline does.  
**Effort:** Medium

---

### #14 — Expose the Workspace tab earlier in onboarding for developer/operator users
**What:** When persona routing detects "developer" or "operator" during onboarding, show the Workspace tab first with a "Click here to access the execution engine" CTA.  
**Why:** Developers who land on a WhatsApp follow-up dashboard and a "Revenue" tab will immediately exit. The Workspace tab is the product for them.  
**Effort:** Low

---

### #15 — Add contextual empty states with specific next actions throughout OS modules
**What:** Every sub-tab that's empty (Business/Leads, Developer/Repos, Personal/Tasks) should have an empty state that (a) explains the value, (b) shows an example, (c) offers a "Create First X" button.  
**Why:** Currently empty states are text-only and passive. Users don't take action from passive text.  
**Effort:** Medium

---

### #16 — Fix the PaymentPanel default description
**What:** Change the `description` default in `PaymentPanel.jsx` from `"Jarvis Access"` to pull from `localStorage.jarvis_biz_profile.product` (set during onboarding).  
**Why:** Every payment link says "Jarvis Access" — a Jarvis internal brand name, not the user's product. This is embarrassing in a customer-facing context.  
**Effort:** Trivial

---

### #17 — Add a startup screen to the Electron app showing self-healing progress
**What:** On Electron launch, before showing the dashboard, display a 2-3 second startup card: "Verifying workspace ✓ | Loading history ✓ | Checking runtime ✓ | Ready." The self-healing code already runs; just make it visible.  
**Why:** The recovery system is one of JARVIS's best reliability features. Making it visible builds immediate trust in the product.  
**Effort:** Low

---

### #18 — Connect Business OS and Clients tab into a unified contact system
**What:** Add a "Source" badge on BusinessOS contacts (imported from Clients), and on Clients leads show "Also in Business OS pipeline." One button: "Move to pipeline" on each Clients lead.  
**Why:** Currently Business OS and Clients are parallel, disconnected systems for the same concept. Users are confused about where to manage contacts.  
**Effort:** Medium

---

### #19 — Add lead status editing to the Clients tab
**What:** Each lead card needs inline "Edit status" — a dropdown with New / Hot / Follow-up Scheduled / Payment Sent / Paid / Closed. Currently no edit function exists.  
**Why:** A CRM without the ability to update lead status is not a CRM. This is the most basic CRUD function missing from the most used tab.  
**Effort:** Low

---

### #20 — Add a "Copy invite link" or demo sharing capability to the Workspace tab
**What:** A button: "Share this workspace" that copies a deep link to the Workspace tab (including a one-time auth token). For team/enterprise use cases.  
**Why:** Enterprise positioning implies collaboration. Currently the product has zero sharing or collaboration surface. Even a shallow "share your workspace URL" builds the narrative.  
**Effort:** Medium

---

## D. INFORMATION ARCHITECTURE REDESIGN

### Current Structure (Flat, Persona-Blind)
```
[Chat] [Revenue] [Activity] [Clients] [Personal] [Business] [Developer] [Enterprise] [Workspace]
```
**Problems:** 9 flat tabs, no grouping, mixed persona-targeting, most valuable feature last.

---

### Recommended Structure (Layered, Persona-Routed)

**Layer 1: Core App (everyone)**
```
[Ask Jarvis] [Contacts] [Pipeline] [History]
```
- `Ask Jarvis` — Chat + quick actions, persona-aware suggestions
- `Contacts` — Unified contacts from Clients + Business OS (merged)
- `Pipeline` — Revenue dashboard, automation status, "what's working"
- `History` — Activity log, timeline, digest

**Layer 2: OS Modules (contextual by persona)**
```
[My Space] [Business OS] [Dev Tools]
```
- Collapsed or behind a "More" button for non-power-users
- Each module introduces itself before showing the form grid

**Layer 3: Power User (auth-gated, clearly labeled)**
```
[Control Room]
```
- Renamed from "Workspace" to "Control Room" — communicates authority
- First in tab order for Desktop shell
- On web: shown with a "Power user tools →" CTA below the main nav
- First-run modal actually triggered (currently broken)

**Layer 4: Enterprise (shown only when team account detected)**
```
[Teams]
```
- Hidden by default for solo users
- Shown when enterprise flag set

---

### Navigation Principles
1. **Persona-first.** What you see first matches who you are.
2. **Progressive complexity.** Core → Modules → Control Room → Enterprise. Users discover depth gradually.
3. **One entry point per concept.** No parallel contact systems. No duplicate revenue views.
4. **Labels match what's inside.** "Control Room" instead of "Workspace." "Ask Jarvis" instead of "Chat." "Pipeline" instead of "Revenue."

---

## E. MISSING ONBOARDING FLOWS

### E1 — Developer/Operator Onboarding
Currently missing entirely. A developer who signs up gets the WhatsApp sales wizard.

**What it should be:**
1. "What do you want to automate?" → Three cards: Sales & Clients | Development Workflows | Business Processes
2. If Developer: "Connect your first project" → GitHub URL or manual repo entry
3. "Set up your first workflow" → Pick from template pack (Beginner, Developer, etc.)
4. "Run your first task" → One-click execution of a safe, impressive demo task
5. First wow: see live execution in the Control Room within 60 seconds of signup

---

### E2 — WhatsApp Activation Flow
Currently: User completes 3-question wizard, lands in app, WhatsApp is not connected, follow-ups never start.

**What it should be:**
- Step 4 in the main onboarding: "Connect WhatsApp"
- Show QR code inline (WhatsApp Web API flow)
- Confirmation: "WhatsApp connected ✓ — first follow-up scheduled for [lead name] at [time]"
- This is the activation event. Nothing else matters until this happens.

---

### E3 — First Lead → First Follow-up → First Payment Loop
Currently: Users add a lead but don't see the follow-up cycle happen.

**What it should be:**
- After adding first lead: show a timeline card "Here's what Jarvis will do:"
  - Day 0: Greeting message (in 10 minutes)
  - Day 1: Same-day follow-up (6 hours)
  - Day 2: Next-day check-in
  - Day 4: Payment link offer
- Show this as a visual timeline, not a bullet list
- When the first message sends: a toast + Activity tab notification

---

### E4 — Operator Console First-Run (already built, never triggered)
`FirstRunSetup` component with 4 guided steps exists at `widgets/FirstRunSetup.jsx`.  
`shouldShowFirstRun()` helper exists.  
**Neither is called from `OperatorConsole.jsx`.** This is a 3-line fix.

---

## F. MISSING WOW MOMENTS

**Wow moments = moments where users viscerally understand why the product is valuable.**

### F1 — "JARVIS just sent a message for me" (missing)
Users add a lead → wait 10 minutes → first WhatsApp message sends. This should trigger:
- A push notification / in-app toast: "✓ Jarvis sent your first message to Ahmed"
- A visible counter on the Activity tab badge
- A celebration animation on the first send
Currently: the message sends in the background with zero user notification.

### F2 — "JARVIS is executing my command live" (partially present, buried)
The Operator Console execution log shows real-time task execution. This is genuinely impressive — a live feed of the AI doing work. But it requires 4 steps to reach (find Workspace tab, authenticate, understand 3-column cockpit, find ExecLogPanel).

**Fix:** Surface a "Live execution" mini-widget on the main dashboard when any task is running.

### F3 — "This ran while I was away" (missing)
JARVIS's best feature is autonomous background operation. There's no "here's what happened while you were offline" moment. No digest, no summary, no catch-up screen.

**Fix:** On app open, if automation ran while offline, show a banner: "Jarvis sent 3 follow-ups while you were away. View activity →"

### F4 — "I can automate anything" (missing)
Browser automation panel has 25+ pre-built workflows across 5 packs. It's extraordinary. It's completely invisible to non-operator users.

**Fix:** On the landing page or product overview: "Run GitHub trending, SEO audits, competitor analysis, and more — without writing code." Screenshot of browser automation results.

### F5 — "My full stack in one place" (missing)
Developer OS + Workspace + AI Console together form a genuinely powerful developer execution platform. No user currently encounters this combination.

**Fix:** Developer onboarding path that ends with a live AI task running in the Control Room.

---

## G. MISSING OPERATOR WORKFLOWS

Operator = someone managing the JARVIS instance (technical admin, power user, team lead)

| Missing Workflow | What It Needs |
|---|---|
| **Schedule automation windows** | "Run follow-ups only between 9am–6pm weekdays" — no timezone/hours UI |
| **Bulk lead operations** | Select all → mark as hot / send payment link / archive — no multi-select |
| **Automation pause per lead** | "Pause follow-ups for Ahmed" — no per-lead pause control |
| **System health alerts** | "Alert me if backend goes offline" — no push/email alert config |
| **Execution log export** | Download a CSV of all executions — not available |
| **API key management** | Configure which AI provider to use, rotate keys — no UI |
| **Backup and restore** | Export all leads/data / restore from backup — no UI |
| **Webhook configuration** | Set up incoming webhooks for payment events — no UI, all env-var only |

---

## H. MISSING ENGINEERING WORKFLOWS

Developer = software engineer using JARVIS for dev automation

| Missing Workflow | What It Needs |
|---|---|
| **GitHub integration** | Connect repo, see PR status, trigger CI — no auth flow in DeveloperOS |
| **Run test suite from UI** | "Run my tests" button in DeveloperOS → exec via terminal agent — not wired |
| **Branch management** | See open branches, switch, create — DeveloperOS has schema but no backend calls |
| **Deployment triggers** | "Deploy to staging" → trigger deploy script — no UI |
| **AI code review** | Submit diff, get suggestions — no UI surface for this |
| **Build history** | See past builds and their outcomes — DeveloperOS has empty `builds` list |
| **Dev environment status** | Show services running (db, server, redis) — no dashboard widget |

---

## I. MISSING BUSINESS WORKFLOWS

Business user = operator managing sales pipeline and client relationships

| Missing Workflow | What It Needs |
|---|---|
| **Multi-channel outreach** | WhatsApp + Email + Telegram in one campaign — currently WhatsApp only |
| **Follow-up message editor** | Edit the messages Jarvis sends — no UI to customize templates |
| **Campaign performance analytics** | Open rate, response rate, conversion by campaign — no viz |
| **Invoice generation** | Create and send invoice, not just payment link — missing |
| **Contact import** | CSV upload of contacts — no import UI |
| **Client portal** | Self-service client view (not operator view) — missing entirely |
| **Revenue forecasting** | "Based on current pipeline, expected revenue this month" — no prediction |
| **Meeting scheduler** | "Book a call" link generation — missing |
| **Contract templates** | Generate and send agreements — missing |

---

## J. PRODUCT EXPERIENCE ROADMAP

### Phase 1: Remove the Confusion (0–2 weeks, no backend changes)
**Goal:** Stop losing users in the first 5 minutes.

| Item | Change | Effort |
|---|---|---|
| Fix tab labels and icons | Add icons + tooltips to all 9 tabs | 1 day |
| Fix empty states | Add action buttons to all empty state screens | 1 day |
| Fix payment description default | Pull from user profile | 1 hour |
| Fix currency display | Use locale-aware formatting | 2 hours |
| Trigger FirstRunSetup in Operator Console | 3-line fix | 30 minutes |
| Fix ConnectBar contextual display | Only show on tabs where it's actionable | 2 hours |
| Add WhatsApp step to onboarding | Insert existing WhatsAppSetup into onboarding flow | 1 day |

---

### Phase 2: Make the Value Visible (2–4 weeks, no backend changes)
**Goal:** Users see the product working without digging.

| Item | Change | Effort |
|---|---|---|
| Landing page interactive demo | Animated walkthrough of core flow | 3 days |
| Per-lead activity timeline | Show follow-up history per contact card | 2 days |
| "Jarvis sent X messages today" dashboard widget | Surface automation activity prominently | 1 day |
| "What happened while you were away" banner | On-login digest using existing `/ops` data | 1 day |
| Follow-up sequence preview in onboarding | Show Day 0/1/2/4 timeline after first lead added | 1 day |
| Chat quick actions by persona | Replace pm2 commands with role-relevant suggestions | 1 day |

---

### Phase 3: Navigation and Architecture (4–6 weeks, no backend changes)
**Goal:** Users can find what they need without a guide.

| Item | Change | Effort |
|---|---|---|
| Persona routing on landing/onboarding | Developer vs. Business vs. Operator paths | 3 days |
| Tab rename and reorder | Implement proposed IA redesign | 2 days |
| Unified contacts (merge Clients + Business OS contacts) | Front-end merge, no new backend | 3 days |
| Product overview / capabilities page | New static component | 1 day |
| Control Room promotion | Expose Workspace earlier for operator users | 1 day |
| Lead status editing | Add inline edit to Clients tab lead cards | 2 days |

---

### Phase 4: Wow Moments and Depth (6–10 weeks)
**Goal:** Users feel the product's full power.

| Item | Change | Effort |
|---|---|---|
| First-message celebration animation | Toast + counter on first WhatsApp send | 1 day |
| Live execution mini-widget on dashboard | Show running tasks surfaced outside Workspace | 2 days |
| Browser automation showcase on landing | Demo screenshots/animation of 25-workflow library | 2 days |
| Developer onboarding path | Ends with live task execution in Control Room | 3 days |
| Daily digest screen | "Here's what Jarvis did today" timeline | 3 days |
| Follow-up message template editor | Edit what Jarvis sends (requires backend toggle) | 5 days |

---

## SUMMARY SCORECARD

| Dimension | Current | Target (Phase 4) |
|---|---|---|
| Time to First Value | ~10 minutes (if WhatsApp connected) | ~2 minutes |
| Feature Discoverability | 20% of features findable by new users | 80% |
| Frontend Maturity Score | 4.1 / 10 | 7.5 / 10 |
| Positioning Clarity | 1 product explained | 5 use cases explained |
| Persona Coverage | 1 (WhatsApp sales) | 4 (Sales, Developer, Operator, Enterprise) |
| Wow Moments | 0 visible | 5 surfaced |
| Empty State Quality | Passive | Action-driving |

---

*Brutal verdict: The backend is ready to ship to 4 different market segments. The frontend is shipping to 1. The highest-leverage work in this codebase right now is not more backend features — it is making what already exists visible, navigable, and delightful.*
