> [!WARNING]
> ARCHIVED / LEGACY / NOT ACTIVE PRODUCTION RUNTIME
> This document describes historical or experimental architecture that is not part of the active Jarvis production core.

# API LAYER REFACTOR REPORT
Phase M — Security Cleanup + Frontend Maturity  
Date: 2026-05-16

---

## 1. BEFORE: MONOLITHIC api.js

`frontend/src/api.js` was 283 lines containing:
- Shared HTTP client internals (`_fetch`, `_normalize`, `_isElectron`, `BASE_URL`)
- Global 401 handler (`setOn401`, `_on401`)
- 26 exported functions across 6 distinct domains
- 3 evolution functions (removed in Task C)
- No clear organizational boundary between concerns

All 9 consuming components imported from `"../api"` or `"../../api"` regardless of which
domain they needed.

---

## 2. AFTER: DOMAIN FILES + BARREL

### File structure

```
frontend/src/
├── _client.js       — shared: BASE_URL, setOn401, _fetch, _normalize, _isElectron
├── authApi.js       — getAuthStatus, loginOperator, logoutOperator
├── runtimeApi.js    — emergencyStop, emergencyResume, getRuntimeStatus,
│                      getRuntimeHistory, getTasks, dispatchTask, queueTask, addTask
├── crmApi.js        — getLeads, createLead, sendFollowUp, sendTelegram, testWhatsAppSend
├── telemetryApi.js  — checkHealth, getStats, getOpsData, getMetrics
├── paymentApi.js    — generatePaymentLink
└── api.js           — barrel: re-exports everything + keeps sendMessage
```

### api.js (barrel)

```js
export { BASE_URL, setOn401 } from "./_client";
export * from "./authApi";
export * from "./runtimeApi";
export * from "./crmApi";
export * from "./telemetryApi";
export * from "./paymentApi";
export async function sendMessage(...) { ... }  // primary Jarvis gateway, uses _normalize
```

---

## 3. BACKWARD COMPATIBILITY

All 9 existing consumers continue to use `import { xxx } from "../api"` unchanged:

| Component | Imported functions | Domain source |
|-----------|-------------------|---------------|
| App.jsx | sendMessage, checkHealth, getStats, getOpsData, emergencyStop, emergencyResume | api.js, telemetryApi, runtimeApi |
| AuthContext.jsx | getAuthStatus, loginOperator, logoutOperator, setOn401 | authApi, _client |
| PaymentPanel.jsx | generatePaymentLink, getLeads | paymentApi, crmApi |
| GovernorPanel.jsx | emergencyStop, emergencyResume | runtimeApi |
| AddClientForm.jsx | createLead | crmApi |
| WorkflowPanel.jsx | dispatchTask, queueTask | runtimeApi |
| AIConsolePanel.jsx | sendMessage | api.js |
| WhatsAppSetup.jsx | testWhatsAppSend | crmApi |
| OperatorConsole.jsx | BASE_URL, getOpsData, getTasks, getRuntimeStatus, getRuntimeHistory | _client, telemetryApi, runtimeApi |

Zero import changes required. The barrel ensures all existing paths resolve.

---

## 4. WHAT WAS REMOVED

- `getEvolutionScore()` — called removed backend endpoint `/evolution/score`
- `getSuggestions()` — called removed backend endpoint `/evolution/suggestions`
- `approveSuggestion()` — called removed backend endpoint `/evolution/approve/:id`

None were called from any component. Dead code.

---

## 5. DOMAIN FILE RESPONSIBILITIES

### _client.js

Internal shared module. Not a direct consumer import target.
- `BASE_URL` — API base URL from `REACT_APP_API_URL` or localhost:5050
- `setOn401(fn)` — registers global logout callback (called by AuthContext)
- `_fetch(path, opts)` — authenticated fetch with 10s timeout, 401 interception
- `_normalize(raw)` — normalizes Jarvis gateway responses to `{ success, reply, intent, ... }`
- `_isElectron()` — detects Electron IPC environment

### authApi.js

Session lifecycle. `AuthContext.jsx` should own this domain.

### runtimeApi.js

All `/runtime/*` endpoints. `OperatorConsole` and `WorkflowPanel` are the main consumers.
Emergency controls are here — not in a separate file — because they're runtime-level operations.

### crmApi.js

Customer data + outbound messaging. Groups:
- CRM CRUD (`getLeads`, `createLead`)
- Outbound messaging (`sendFollowUp` → WhatsApp, `sendTelegram`, `testWhatsAppSend`)

WhatsApp and Telegram are grouped with CRM because their primary use case is customer
communication as part of the CRM workflow. If a standalone messaging panel is added
later, extract to `messagingApi.js`.

### telemetryApi.js

Read-only observability. No writes. `App.jsx` and `OperatorConsole` poll these.

### paymentApi.js

Razorpay payment link generation. Single function — exists as a separate file because
payment is a distinct domain even if small.

---

## 6. USAGE GUIDANCE FOR NEW CODE

Prefer direct domain imports when writing new components:
```js
// Good — explicit domain
import { dispatchTask, queueTask } from "../runtimeApi";
import { getLeads } from "../crmApi";

// Also fine — backward-compatible barrel
import { dispatchTask, getLeads } from "../api";
```

Do NOT import from `_client.js` directly from components — `_fetch` and `_normalize` are
implementation details. Use the domain functions instead.
