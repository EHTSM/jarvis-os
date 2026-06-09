# Frontend Maturity Phase 1 — Enterprise Frontend Audit

**Date:** 2026-06-02
**Branch:** cleanup/runtime-minimization
**Scope:** Read-only inspection. No backend changes. No new architecture.

---

## Audit Methodology

Every React component, Electron panel, and navigation item was classified against four criteria:

- **Status:** Production Ready / Partial / Placeholder / Missing
- **Backend Connected:** which API endpoint feeds it (if any)
- **V5 Gap:** whether V5 Phase 3–6 backend (personalOS, businessOS, developerOS, enterpriseOS) is exposed by any frontend surface
- **Production Ready:** binary — would a paying user hit a broken or empty state?

---

## Screen Classification Matrix

### PUBLIC SURFACES

| Screen | File | Status | Backend Connected | Production Ready |
|---|---|---|---|---|
| Landing Page | `components/Landing.jsx` (166 lines) | **Production Ready** | None (static marketing copy) | ✓ |
| Onboarding Wizard | `components/Onboarding.jsx` (165 lines) | **Production Ready** | None (writes to localStorage) | ✓ |
| Login (Operator) | `components/auth/LoginPage.jsx` | **Production Ready** | `POST /auth/login` via authApi | ✓ |

---

### USER-FACING TABS (SaaS + Desktop)

| Screen | File | Lines | Status | Backend Connected | Production Ready |
|---|---|---|---|---|---|
| Chat | `components/Chat.jsx` | 216 | **Production Ready** | `POST /jarvis` (dispatch), `GET /health` | ✓ |
| Revenue / Dashboard | `components/Dashboard.jsx` | 176 | **Partial** | `GET /stats`, `GET /ops` (automation field) | Partial — currency hardcoded to ₹, no multi-currency |
| Activity / Logs | `components/Logs.jsx` | 194 | **Partial** | `GET /ops` (automation + queue fields) | Partial — shows queue but no per-message drill-down |
| Clients / Payment | `components/PaymentPanel.jsx` | 243 | **Partial** | `GET /crm`, `POST /crm/lead`, `POST /payment/link` | Partial — no lead edit/delete, no lead detail view |
| Add Client Form | `components/AddClientForm.jsx` | ~150 | **Production Ready** | `POST /crm/lead` via crmApi | ✓ |
| WhatsApp Setup | `components/WhatsAppSetup.jsx` | ~100 | **Partial** | `GET /health` (checks wa status) | Partial — setup guide only, no QR code scan UI |

---

### OPERATOR CONSOLE (Workspace Tab — Auth-Gated)

| Screen / Panel | File | Lines | Status | Backend Connected | Production Ready |
|---|---|---|---|---|---|
| Operator Console (shell) | `operator/OperatorConsole.jsx` | ~300 | **Production Ready** | SSE + polling orchestration | ✓ |
| Execution Log Panel | `operator/ExecLogPanel.jsx` | 1,513 | **Production Ready** | `GET /runtime/history`, `POST /runtime/dispatch` | ✓ |
| Workflow Panel | `operator/WorkflowPanel.jsx` | 2,163 | **Production Ready** | `POST /runtime/dispatch`, `POST /runtime/queue` | ✓ |
| Browser Automation Panel | `operator/BrowserAutomationPanel.jsx` | 4,660 | **Production Ready** | `POST /browser/*` (25 workflows) | ✓ |
| AI Console Panel | `operator/AIConsolePanel.jsx` | 248 | **Production Ready** | `POST /jarvis`, `POST /ai/chat` | ✓ |
| Governor Panel | `operator/GovernorPanel.jsx` | 227 | **Production Ready** | `POST /runtime/emergency/stop`, `/resume` | ✓ |
| Task Queue Panel | `operator/TaskQueuePanel.jsx` | 78 | **Production Ready** | `GET /tasks` (prop-fed from parent) | ✓ |
| Telemetry Panel | `operator/TelemetryPanel.jsx` | 102 | **Production Ready** | `GET /metrics` (prop-fed from parent) | ✓ |
| Adapter Panel | `operator/AdapterPanel.jsx` | 99 | **Partial** | `GET /ops` (services field) | Partial — shows adapter status but no reconnect action |
| Plugin Manager Panel | `operator/PluginManagerPanel.jsx` | 84 | **Placeholder** | **None** — hardcoded list of 4 plugins, no backend calls | ✗ |

---

### OPERATOR CONSOLE WIDGETS

| Widget | File | Status | Backend Connected | Production Ready |
|---|---|---|---|---|
| Connection Status Card | `widgets/ConnectionStatusCard.jsx` | **Production Ready** | SSE state (prop) | ✓ |
| Runtime Health Card | `widgets/RuntimeHealthCard.jsx` | **Production Ready** | `GET /runtime/status` (prop) | ✓ |
| Queue Status Card | `widgets/QueueStatusCard.jsx` | **Production Ready** | `GET /ops` queue field (prop) | ✓ |
| Recent Failures Panel | `widgets/RecentFailuresPanel.jsx` | **Production Ready** | `GET /runtime/history` (prop) | ✓ |
| Session Context Card | `widgets/SessionContextCard.jsx` | **Production Ready** | localStorage + session state | ✓ |
| Emergency Mode Banner | `widgets/EmergencyModeBanner.jsx` | **Production Ready** | `GET /runtime/status` emergency flag | ✓ |
| Operational Status Banner | `widgets/OperationalStatusBanner.jsx` | **Production Ready** | `GET /health` (prop) | ✓ |
| Notification Overlay | `widgets/NotificationOverlay.jsx` | **Production Ready** | In-memory notification queue | ✓ |
| Feedback Panel | `widgets/FeedbackPanel.jsx` | **Placeholder** | **None** — form renders but submit goes nowhere | ✗ |
| Help Panel | `widgets/HelpPanel.jsx` | **Partial** | None (static cheat sheet) | Partial — one note: "Template pack macros are stubs" |
| First Run Setup | `widgets/FirstRunSetup.jsx` | **Partial** | `GET /health` only | Partial — checklist items not connected to actual state |
| Preferences Panel | `widgets/PreferencesPanel.jsx` | **Partial** | localStorage only (no backend persist) | Partial — preferences reset on server restart |

---

### MISSING SCREENS (V5 Phase 3–6 — Backend Exists, No Frontend)

| Screen | Backend Module | HTTP Routes Exist | Frontend File | Status |
|---|---|---|---|---|
| Personal Tasks | `personalOS.cjs` | `GET/POST /personal/tasks` | **None** | **Missing** |
| Personal Notes | `personalOS.cjs` | `GET/POST /personal/notes` | **None** | **Missing** |
| Personal Reminders | `personalOS.cjs` | `GET/POST /personal/reminders` | **None** | **Missing** |
| Personal Knowledge Base | `personalOS.cjs` | `GET/POST /personal/knowledge` | **None** | **Missing** |
| Personal Daily Summary | `personalOS.cjs` | `GET /personal/summary/daily` | **None** | **Missing** |
| Personal Weekly Summary | `personalOS.cjs` | `GET /personal/summary/weekly` | **None** | **Missing** |
| Business CRM Contacts | `businessOS.cjs` | `GET/POST /business/contacts` | **None** | **Missing** |
| Business Leads (V5) | `businessOS.cjs` | `GET/POST /business/leads` | **None** | **Missing** |
| Business Pipeline | `businessOS.cjs` | `GET /business/pipeline`, `/business/opportunities` | **None** | **Missing** |
| Business Campaigns | `businessOS.cjs` | `GET/POST /business/campaigns` | **None** | **Missing** |
| Business Revenue | `businessOS.cjs` | `GET/POST /business/revenue` | **None** | **Missing** |
| Business Dashboard (V5) | `businessOS.cjs` | `GET /business/dashboard` | **None** | **Missing** |
| Dev Repositories | `developerOS.cjs` | `GET/POST /dev/repos` | **None** | **Missing** |
| Dev Projects | `developerOS.cjs` | `GET/POST /dev/projects` | **None** | **Missing** |
| Dev Issues | `developerOS.cjs` | `GET/POST /dev/issues` | **None** | **Missing** |
| Dev Builds | `developerOS.cjs` | `GET/POST /dev/builds` | **None** | **Missing** |
| Dev Deployments | `developerOS.cjs` | `GET/POST /dev/deployments` | **None** | **Missing** |
| Engineering Dashboard | `developerOS.cjs` | `GET /dev/dashboard` | **None** | **Missing** |
| Enterprise Organizations | `enterpriseOS.cjs` | `GET/POST /enterprise/orgs` | **None** | **Missing** |
| Enterprise Departments | `enterpriseOS.cjs` | `GET/POST /enterprise/depts` | **None** | **Missing** |
| Enterprise Teams | `enterpriseOS.cjs` | `GET/POST /enterprise/teams` | **None** | **Missing** |
| Enterprise Roles | `enterpriseOS.cjs` | `GET/POST /enterprise/roles` | **None** | **Missing** |
| Enterprise Permissions | `enterpriseOS.cjs` | `GET/POST /enterprise/permissions` | **None** | **Missing** |
| Enterprise Policies | `enterpriseOS.cjs` | `GET/POST /enterprise/policies` | **None** | **Missing** |
| Enterprise Audit Log | `enterpriseOS.cjs` | `GET/POST /enterprise/audit` | **None** | **Missing** |
| Enterprise Dashboard | `enterpriseOS.cjs` | `GET /enterprise/dashboard` | **None** | **Missing** |
| Goal Tracker | `goalEngine.cjs` | `GET/POST /goals` | **None** | **Missing** |
| Unified Memory Search | `unifiedMemoryEngine.cjs` | `GET /ops/search` (via runtime) | **None** | **Missing** |
| Lifecycle Reports | `productLifecycleEngine.cjs` | `GET /lifecycle/reports` | **None** | **Missing** |

---

## Status Summary

| Status | Count |
|---|---|
| Production Ready | 22 |
| Partial | 9 |
| Placeholder | 2 |
| Missing | 28 |
| **Total surfaces** | **61** |

**Frontend coverage of backend capability: 33 of 61 surfaces (54%)**

---

## Frontend Maturity Gap Report

---

### P0 — Required Before Public Launch

These gaps affect users on the current public product (WhatsApp CRM + Payments flow). A paying user will encounter them.

| ID | Gap | Screen Affected | Detail |
|---|---|---|---|
| P0-01 | **Currency hardcoded to ₹ (INR)** | Dashboard, PaymentPanel | `₹` symbol is literal string in Dashboard.jsx:129 and PaymentPanel.jsx. Non-INR users see wrong symbol with no override. |
| P0-02 | **No lead edit or delete** | Clients / PaymentPanel | `PaymentPanel.jsx` renders a lead list but no edit/update/delete actions. Once a lead is created, it cannot be corrected from the UI. Backend supports `PATCH /crm/lead` and `DELETE`. |
| P0-03 | **No lead detail view** | Clients / PaymentPanel | Leads are listed but not expandable. No phone, notes, deal value, or status is visible after creation. |
| P0-04 | **WhatsApp setup shows no QR scan UI** | WhatsAppSetup | Component provides instructions but no live QR code or polling for connection state. Users have no way to confirm they are connected except indirectly via Chat. |
| P0-05 | **FeedbackPanel submits to nowhere** | Workspace → Feedback widget | Form renders and validates but the submit handler fires a notification ("sent!") with no actual API call. Operator feedback is silently dropped. |
| P0-06 | **PluginManagerPanel has no backend** | Workspace → Plugins | All 4 plugins are hardcoded. "Manage" button fires a notification saying to edit backend manually. No route exists for plugin state. UI implies control that doesn't exist. |
| P0-07 | **No pagination on lead list** | Clients / PaymentPanel | `GET /crm` returns all leads. No limit/offset param is passed. At 100+ leads the list is unbounded. |
| P0-08 | **AdapterPanel shows no reconnect action** | Workspace → Adapter panel | Displays adapter status from `/ops` but provides no button to restart a broken adapter (WhatsApp disconnect, etc). Operator must use chat commands. |

---

### P1 — Required Before SaaS Launch

These gaps must be closed before exposing the platform as a multi-tenant SaaS product.

| ID | Gap | Screen Affected | Detail |
|---|---|---|---|
| P1-01 | **No Personal OS screen** | Missing entirely | `personalOS.cjs` exposes 25 routes (tasks, notes, reminders, KB, summaries). No frontend. Users cannot manage personal tasks, notes, or reminders from the app. |
| P1-02 | **No Goal Tracker screen** | Missing entirely | `goalEngine.cjs` exposes 8 routes. Goals are referenced in every OS dashboard but there is no UI to create, view, or advance goals. |
| P1-03 | **Business OS has no V5 UI** | Missing entirely | `businessOS.cjs` exposes 30 routes (leads V5, contacts, pipeline, campaigns, revenue). Existing UI only uses the legacy `crmApi.js` → `/crm`. The V5 business layer is completely dark. |
| P1-04 | **Developer OS has no UI** | Missing entirely | `developerOS.cjs` exposes 37 routes (repos, projects, issues, builds, deployments). No frontend surface exists. Operator console is the only entry point and it requires chat commands. |
| P1-05 | **No in-app search** | Missing entirely | `GET /personal/search`, `GET /business/search`, `GET /dev/search` all exist. No search bar anywhere in the public-facing UI. |
| P1-06 | **No daily/weekly summary screen** | Missing entirely | `getDailySummary` and `getWeeklySummary` endpoints exist for personal, business, and developer OS. Not surfaced anywhere. |
| P1-07 | **PreferencesPanel not backend-persisted** | Workspace → Preferences | Operator preferences (theme, polling interval, notification settings) are localStorage-only. Clearing the browser resets all settings. |
| P1-08 | **FirstRunSetup checklist disconnected** | Workspace → First Run | Checklist items (WhatsApp connected, first lead added, payment link sent) are not dynamically checked against actual backend state. Items may show incomplete when they are done. |
| P1-09 | **No navigation for new OS modules** | App.jsx tab bar | App has 5 hardcoded tabs. Adding Personal OS, Business OS, Developer OS, Enterprise OS requires tab bar extension or a new nav pattern. Current state machine would need to add tabs. |
| P1-10 | **No API client for V5 routes** | `api.js` | No `personalApi.js`, `devApi.js`, `enterpriseApi.js` exist. The API barrel (`api.js`) only covers legacy CRM + runtime + payment. All 92 V5 routes are unreachable from the frontend without new API modules. |

---

### P2 — Future Improvements

These are polish/completeness items that do not block launch but should be tracked.

| ID | Gap | Screen Affected | Detail |
|---|---|---|---|
| P2-01 | **Enterprise OS has no UI** | Missing entirely | `enterpriseOS.cjs` exposes 43 routes (orgs, depts, teams, roles, permissions, policies, audit). Not a Day 1 SaaS concern but required before enterprise tier launch. |
| P2-02 | **No Lifecycle Reports viewer** | Missing entirely | `productLifecycleEngine.cjs` + `GET /lifecycle/reports` exist. System maturity scores are visible in backend summaries but never shown in the UI. |
| P2-03 | **No Unified Memory search UI** | Missing entirely | UME cross-namespace search (`/ops` search routes) exists. No search surface in the product. |
| P2-04 | **Chat message history not persisted** | Chat | Messages live in component state. Hard refresh loses the full conversation. No `GET /context-history` fetch on mount. |
| P2-05 | **Activity tab has no drill-down** | Logs / Activity | AutoCard shows aggregate counts only. No way to see which specific leads were messaged at each tier. |
| P2-06 | **Dashboard revenue in INR only** | Dashboard | StatCard for "Revenue Collected" formats with `toLocaleString("en-IN")`. No locale or currency config. |
| P2-07 | **HelpPanel macros are stubs** | Workspace → Help | Documented in the component itself: "Template pack macros are stubs — some commands require plugin setup." |
| P2-08 | **No offline state for SaaS tab** | Chat, Dashboard, Logs | ConnectBar shows a status banner but individual tabs do not degrade gracefully when the backend is unreachable. Chat input goes dead silently. |
| P2-09 | **200+ hooks unused in any component** | hooks/ directory | 160+ hooks in `hooks/` are not imported by any current component. They document intended future behavior but add 30,000+ lines of dead weight to the build. |
| P2-10 | **No mobile viewport for SaaS tabs** | All tabs | CSS appears desktop-first. No media query breakpoints verified for mobile viewport. WhatsApp-native product with no mobile-responsive web UI is a significant miss. |

---

## Coverage by Backend Module

| Backend Module | Routes | Frontend API Client | Screens | Coverage |
|---|---|---|---|---|
| Legacy CRM (`/crm`) | ~5 | `crmApi.js` ✓ | PaymentPanel, Logs, Dashboard | **Partial** |
| Legacy Runtime (`/runtime`, `/tasks`) | ~7 | `runtimeApi.js` ✓ | OperatorConsole, ExecLog, Workflow | **Full (operator)** |
| Legacy Telemetry (`/health`, `/stats`, `/ops`) | ~4 | `telemetryApi.js` ✓ | Dashboard, Logs, Runtime widgets | **Full** |
| Payment (`/payment/link`) | 1 | `paymentApi.js` ✓ | PaymentPanel | **Full** |
| Auth (`/auth/*`) | 3 | `authApi.js` ✓ | LoginPage, AuthContext | **Full** |
| Browser (`/browser/*`) | 25+ | `browserApi.js` ✓ | BrowserAutomationPanel | **Full** |
| Goals (`/goals/*`) | 8 | **None** | **None** | **0%** |
| Personal OS (`/personal/*`) | 25 | **None** | **None** | **0%** |
| Business OS V5 (`/business/*`) | 30 | **None** | **None** | **0%** |
| Developer OS (`/dev/*`) | 37 | **None** | **None** | **0%** |
| Enterprise OS (`/enterprise/*`) | 43 | **None** | **None** | **0%** |

**V5 backend coverage: 0 of 143 V5 routes are reachable from the frontend.**

---

## Electron-Specific Findings

| Finding | Detail |
|---|---|
| **Load path correct** | Dev: `http://localhost:3000?desktop=1` → Prod: `frontend/build/index.html?desktop=1` |
| **Crash recovery working** | 3-crash max, cache clear on 2nd failure, renderer crash reporting via IPC |
| **Memory pressure handler** | 350MB heap threshold → `low-memory` IPC event → renderer should react (not verified in components) |
| **Power events wired** | `suspend`/`resume`/`network-change` handled. `system-resume` IPC event dispatched but no component subscribes to it visibly. |
| **No auto-update mechanism** | `electron/main.cjs` has no `autoUpdater` integration. Desktop app has no upgrade path without manual reinstall. |
| **Preload bridge complete** | `window.electronAPI` exposes 8 methods + 5 event listeners. All current operator console usage goes through it correctly. |

---

## Routing Architecture Gap

The current tab-based state machine in `App.jsx` has 5 hardcoded tab IDs: `chat`, `insights`, `activity`, `clients`, `runtime`. Adding V5 OS modules requires either:

1. Extending the tab list (flat — becomes unwieldy at 8+ tabs)
2. Adding a second nav tier (section tabs within a primary tab)
3. Moving to React Router with a left sidebar (structural change)

This is a **P1 architectural decision** that must be made before any V5 screen work begins. It is a navigation decision, not a backend or feature decision.

---

## What Is Working Well

- The operator console is the most complete surface: 6 panels + 12 widgets, all wired to real backends.
- The core WhatsApp CRM loop (add lead → automated follow-up → payment link) is end-to-end functional.
- The API client layer (`_client.js`) is robust: retry logic, timeout, 401 interception, duplicate prevention.
- AuthContext is production-quality: 8h JWT, multi-tab sync via BroadcastChannel, silent refresh.
- Error boundaries and toast notifications are in place.
- No mock data in any runtime path — all UI states come from real backend responses or genuine empty states.
