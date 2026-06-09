# NAVIGATION ARCHITECTURE V2
**Phase:** 39 — Frontend Rebuild Strategy
**Date:** 2026-06-07
**Status:** Specification — No code written
**Scope:** Web + Electron navigation redesign. No backend changes.

---

## 1. PROBLEM WITH CURRENT NAVIGATION

The existing navigation has:
- **5 featured tabs + "More ▾" dropdown with 50+ items** — overwhelming, unnavigable
- Tabs are arbitrary groupings with no clear information hierarchy
- "More" menu requires memorizing tab names — no discoverability
- No sidebar — all nav crammed into a horizontal tab bar
- Mobile experience collapses everything into a barely usable bar
- Zero visual hierarchy between "Chat" and "Autonomous Company Center"

The V2 goal: **flat → layered hierarchy** with clear primary / secondary / tertiary levels.

---

## 2. NAVIGATION MODEL

### Information Architecture

```
Level 0: Platform Shell (always visible)
  └── Header (brand, status, account)
  └── Sidebar (primary nav groups)

Level 1: Primary Sections (6 groups in sidebar)
  ├── Home (Control Center + Overview)
  ├── Work (CRM, Pipeline, Payments)
  ├── Automate (Agents, Workflows, Memory)
  ├── Build (Developer, DevOps, Engineering)
  ├── Grow (SEO, Content, Marketing)
  └── Settings (Billing, Integrations, Account)

Level 2: Section Screens (appear in main area)
  e.g. Work → Contacts | Pipeline | Payments | Activity

Level 3: Panel/Tab within a screen (in-page sub-nav)
  e.g. Agents → Registry | Running | Logs | Config
```

### Key Principles
- Primary navigation is a **vertical sidebar**, not a horizontal tab bar
- Max 6 top-level groups — each user learns 6 words, not 50 labels
- Each group expands to a flat list of screens (max 8 per group)
- Active screen highlighted in sidebar, content renders in main area
- **Command Palette (⌘K)** remains the power user escape hatch — jumps to any screen by name

---

## 3. SIDEBAR STRUCTURE

### 3.1 Layout

```
┌──────────────────────┐
│  ⬡ Ooplix            │  ← Brand + connection status dot
│─────────────────────│
│                      │
│  ● Home              │  ← Active item (violet fill)
│  ○ Work          ▸   │  ← Expandable group
│  ○ Automate      ▸   │
│  ○ Build         ▸   │
│  ○ Grow          ▸   │
│  ○ Settings          │
│                      │
│─────────────────────│
│  [status strip]      │  ← Backend: online/offline
│  [account chip]      │  ← User email + plan badge
└──────────────────────┘
```

Width: 220px (expanded) / 56px (icon-only, Electron default).

### 3.2 Group Definitions

#### Group 1: Home
No sub-items. Clicking navigates directly to Control Center.

**Screen:** Control Center

#### Group 2: Work
Sub-items:
- Contacts (CRM / leads)
- Pipeline (dashboard / stats)
- Payments (payment links, follow-ups)
- Activity (execution logs)
- Reports (executive summary — coming soon)

#### Group 3: Automate
Sub-items:
- Agents (AgentCenter + registry)
- Workflows (AutonomousWorkflowCenter)
- Memory (MemoryCenter + SharedMemoryCenter)
- Intelligence (JarvisBrainCenter)
- Orchestrator (ExecutionOrchestratorCenter)

#### Group 4: Build
Sub-items:
- Developer Copilot (DeveloperCopilotCenter)
- Engineering (EngineeringCenter)
- DevOps (DevOpsCenter)
- Integrations (IntegrationCenter)
- Tool Fabric (ToolFabricCenter)

#### Group 5: Grow
Sub-items:
- SEO (SeoCommandCenter)
- Content (ContentEngine)
- Email (EmailMarketingOS)
- Referral (ReferralEngine)
- Social (SocialHub)

#### Group 6: Settings
No expand — single click to Settings hub which renders sub-tabs internally:
- Workspace
- Billing & Plan
- Integrations & APIs
- Account
- Security & Trust

### 3.3 Electron Compact Sidebar

In `data-platform="electron"`:
- Width: 56px, icons only
- Hover on group icon → flyout with group name + sub-items (300ms delay)
- Active screen icon gets violet left border
- Bottom: compact account chip (avatar only) + status dot

### 3.4 Mobile Bottom Navigation

Below 768px — sidebar collapses to bottom tab bar:
```
[ Home ] [ Work ] [ Automate ] [ Build ] [ ··· More ]
```
"More" opens a full-screen drawer with Groups 5 + 6.

---

## 4. HEADER

### 4.1 Web Header

```
┌─────────────────────────────────────────────────────────┐
│  [≡ toggle]   Ooplix             [⌘K] [●] [Trial 6d] [↑]│
└─────────────────────────────────────────────────────────┘
   52px height. Draggable on Electron.
```

Elements (left → right):
1. Sidebar toggle (hamburger) — web only, hidden on Electron
2. Brand name "Ooplix" — 14px, bold, muted
3. `flex: 1` spacer
4. Command Palette trigger `⌘K`
5. Connection status dot (animated pulse when online)
6. Trial countdown chip (color-coded by urgency) — hidden when subscribed
7. Upgrade button (ghost → accent when trial < 3 days)

### 4.2 Electron Header

Same structure + Electron-specific:
- Custom titlebar drag region (inset: `app-region: drag`)
- IPC status badge ("IPC Connected" / "Server Offline")
- No sidebar toggle (sidebar always present, icon-only)
- Window controls: traffic lights (Mac) or custom close/min/max (Windows)

### 4.3 Connection Status States

| State | Dot Color | Label |
|---|---|---|
| Connected | green pulse | — (no label, just dot) |
| Reconnecting | amber pulse | "Reconnecting…" |
| Offline | dim static | "Offline" |
| Emergency | red pulse | "Emergency Stop Active" |

---

## 5. COMMAND PALETTE (⌘K)

### 5.1 Activation

- Keyboard: `Ctrl+K` / `Cmd+K`
- Header button click
- Sidebar search icon (when compact)

### 5.2 Layout

```
┌─────────────────────────────────────────────────────┐
│  🔍  Search screens, commands, contacts…            │
│─────────────────────────────────────────────────────│
│  NAVIGATION                                         │
│    ◉  Control Center             ↵                  │
│    ○  Contacts                   ↵                  │
│    ○  Agents                     ↵                  │
│─────────────────────────────────────────────────────│
│  QUICK ACTIONS                                      │
│    ⚡  Ask Jarvis                 ↵                  │
│    +   New Contact               ↵                  │
│    ⚡  Generate Payment Link      ↵                  │
│─────────────────────────────────────────────────────│
│  RECENT                                             │
│    ↩  Pipeline                                      │
│    ↩  DevOps Center                                 │
└─────────────────────────────────────────────────────┘
   Width: 600px  Max-height: 440px  Scrollable
```

### 5.3 Behavior

- Fuzzy search across all screen names + quick actions
- Arrow keys navigate, Enter selects, Escape closes
- Tab groups results: Navigation → Quick Actions → Recent
- Typing "ag" shows "Agents", "AgentFactory", "AgentRegistry"
- Each result shows group breadcrumb: `Automate › Agents`
- No result state: "Ask Jarvis: [query]" — sends to Chat

### 5.4 Quick Actions

Pre-defined shortcuts always shown at top when no query:
1. Ask Jarvis (→ chat with query pre-filled)
2. New Contact (→ open add contact modal)
3. Generate Payment Link (→ open payment link modal)
4. Emergency Stop (→ confirm + POST /runtime/emergency/stop)
5. View Logs (→ Activity screen)

---

## 6. BREADCRUMB & PAGE HEADER

Every screen renders a consistent page header below the app header:

```
┌──────────────────────────────────────────────────────┐
│  Work  ›  Contacts                                   │
│                                                      │
│  Contacts                          [ + New Contact ] │
│  1,247 leads · Last synced 2m ago                    │
└──────────────────────────────────────────────────────┘
```

Components:
- Breadcrumb: `Group › Screen` (14px, --text-tertiary)
- Page title: H1, --text-h1 weight
- Subtitle: count/status line (--text-secondary)
- Primary action button (right-aligned)

---

## 7. IN-PAGE SUB-NAVIGATION

For screens with multiple panels/views, use a horizontal tab strip below the page header:

```
[ Overview ] [ Pipeline ] [ Activity ] [ Settings ]
              ──────────
              (active underline, violet)
```

Height: 36px. Font: 13px medium. Active: violet underline 2px.
Max items: 6. Overflow: scroll (no "More" within a screen).

---

## 8. SCREEN ROUTING MAP

### Web Routes (React state-based, no react-router required)

| `screen` state | Renders |
|---|---|
| `landing` | Landing page (public) |
| `pricing` | Pricing page (public) |
| `onboarding` | Onboarding wizard |
| `signup` | SignupPage |
| `login` | LoginPage |
| `app` | AppShell → renders `section` + `screenId` |

### App Section + Screen IDs

| `section` | `screenId` | Component |
|---|---|---|
| home | — | ControlCenter |
| work | contacts | PaymentPanel (CRM + contacts) |
| work | pipeline | Dashboard |
| work | payments | PaymentPanel (payment tab) |
| work | activity | Logs |
| work | reports | ExecutiveReports |
| automate | agents | AgentCenter |
| automate | workflows | AutonomousWorkflowCenter |
| automate | memory | MemoryCenter |
| automate | intelligence | JarvisBrainCenter |
| automate | orchestrator | ExecutionOrchestratorCenter |
| build | copilot | DeveloperCopilotCenter |
| build | engineering | EngineeringCenter |
| build | devops | DevOpsCenter |
| build | integrations | IntegrationCenter |
| build | toolfabric | ToolFabricCenter |
| grow | seo | SeoCommandCenter |
| grow | content | ContentEngine |
| grow | email | EmailMarketingOS |
| grow | referral | ReferralEngine |
| grow | social | SocialHub |
| settings | — | Settings hub (internal tabs) |

### Electron Route Override

When `?desktop=1` or `hostname === "localhost"` + Electron: skip `landing` → `onboarding` → go directly to `app` at `section=home`.

---

## 9. DEEP LINK / PERMALINK SUPPORT

URL hash encoding for shareable links (web only):

```
/#/work/contacts     → section=work, screenId=contacts
/#/automate/agents   → section=automate, screenId=agents
/#/settings          → section=settings
```

Parse `window.location.hash` on mount to restore screen state.
On Electron: no hash routing — state persistence via `localStorage.jarvis_nav_state`.

---

## 10. OPERATOR CONSOLE (EXECUTION) — POSITION IN NEW NAV

The Operator Console currently occupies one full tab ("Execution/runtime"). In V2:

- **Control Center** (Home) becomes the primary runtime monitor
- **Operator Console panels** are accessible from Home via "Open Operator Mode" — renders a split-pane view over the existing screen
- Individual panels (ExecLog, AI Console, Workflow, etc.) accessible from their new homes:
  - ExecLog → Work › Activity
  - Workflow → Automate › Workflows
  - AI Console → embedded in Control Center
  - BrowserAutomation → Build › DevOps
  - PluginManager → Build › Tool Fabric

---

## 11. TRANSITION ANIMATIONS

| Transition | Animation | Duration |
|---|---|---|
| Section change (sidebar click) | `slide-up-enter` | 200ms |
| Screen change within section | `fade-in` | 140ms |
| Modal open | `scale-enter` | 200ms |
| Command Palette open | `scale-enter` + blur | 160ms |
| Dropdown open | `slide-up-enter` (8px) | 120ms |
| Toast enter | `slide-up-enter` (right) | 200ms |
| Page exit | `fade-out` (80ms) then enter | 80ms |

---

## 12. KEYBOARD NAVIGATION SPEC

| Key | Action |
|---|---|
| `Cmd+K` / `Ctrl+K` | Open Command Palette |
| `Escape` | Close palette / modal / dropdown |
| `↑ ↓` | Navigate list items |
| `Enter` | Select focused item |
| `Tab` | Move focus forward |
| `Shift+Tab` | Move focus backward |
| `Cmd+1…6` | Jump to sidebar group 1-6 (Electron) |
| `Cmd+[` / `Cmd+]` | Back / Forward (screen history, Electron) |
