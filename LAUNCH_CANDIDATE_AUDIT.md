# LAUNCH CANDIDATE AUDIT — Ooplix AI Operating System
**Audit Date:** 2026-06-08  
**Auditor Role:** QA Engineer + Product Owner + Investor + Founder + First-time Customer  
**Branch:** main  
**Phases audited:** All screens, flows, APIs, and Electron shell

---

## EXECUTIVE SUMMARY

| Dimension               | Score |
|-------------------------|-------|
| Authentication          | 7/10  |
| Dashboard               | 8/10  |
| Business OS (CRM)       | 7/10  |
| Agent OS                | 6/10  |
| Memory OS               | 5/10  |
| Workflow OS             | 5/10  |
| Developer Copilot       | 5/10  |
| DevOps Center           | 5/10  |
| Growth OS               | 6/10  |
| Electron Shell          | 7/10  |

**OVERALL LAUNCH READINESS: 55 / 100**

---

## RECOMMENDATION

> **SOFT LAUNCH** — Conditional on 6 critical blockers being resolved before go-live.  
> Core auth, contacts, payment link generation, and dashboard are shippable.  
> Agent execution, Memory, Workflow Designer, DevOps deploy, and Developer Copilot are  
> feature-shell only — advertise them as "in beta" or hide tabs behind a feature flag until  
> live API wiring is verified.

---

## AREA 1: AUTHENTICATION

**Overall Status: PARTIAL**

### Email Signup
- **PASS** — `SignupPage.jsx` fully implemented. Name + email + password with strength meter, validation, duplicate detection.
- Double-write: Firebase Auth first (if configured), then backend `POST /accounts/register`.
- Graceful degradation if Firebase not configured — falls back to backend-only.
- **ISSUE:** Firebase keys are in `frontend/.env.local` only — they are NOT baked into the production build (`.env.production` is blank). Google sign-in and phone OTP will silently fall back to "not available" on any deployed build.

### Email Login
- **PASS** — `LoginPage.jsx` implemented. Email + password, error messages, password show/hide toggle.
- Backend: `POST /auth/login` → scrypt password verification → JWT cookie (8h session).
- Rate-limited: 10 requests per 5 minutes per IP.

### Google Login
- **PARTIAL** — UI button exists. `firebaseSignInGoogle` is implemented.
- **FAIL in Electron** — Popup-based OAuth explicitly blocked in Electron shell; falls back to `openExternal` to system browser. The UX is broken — user authenticates in browser but the app window has no callback mechanism to receive the token.
- **FAIL in production builds** — Firebase keys missing from `.env.production`.

### Phone OTP
- **PARTIAL** — UI implemented with recaptcha setup, OTP send and verify flows.
- **FAIL** — Depends on Firebase being configured. Production build has no Firebase keys. Will silently show "not available."

### Forgot Password
- **PASS** — Clean implementation. Email enumeration protection (user-not-found treated as success). Resend flow works.

### Logout
- **PASS** — `POST /auth/logout` clears cookie. Multi-tab broadcast via BroadcastChannel.

### Session Restore
- **PASS** — `GET /auth/me` on mount. Silent re-check every 5 minutes. Session expiry warning 5 minutes before 8h timeout. 401 interceptor auto-clears user state.

### Auth Issues
| Issue | Severity |
|-------|----------|
| Firebase env vars missing from `.env.production` — Google, Phone OTP dead in prod | CRITICAL |
| Google OAuth broken in Electron (popup → external browser, no callback) | HIGH |
| `REACT_APP_FIREBASE_MEASUREMENT_ID` has a leading space in `.env.local` (` G-ZEF7LEN6C2`) — may break GA4 | LOW |

---

## AREA 2: DASHBOARD

**Overall Status: PASS**

- **PASS** — `Dashboard.jsx` + `ControlCenter.jsx` both implemented with real API calls.
- Metric cards: Lead totals, revenue, automation runs, whatsapp sent — all rendered with skeleton loading states.
- Pipeline bar chart: CSS-only, no library dependency. Renders empty state when no data.
- Automation rows: Live `opsData` from `GET /ops`. Skeleton shown while loading.
- Service status tiles: AI, Queue, WhatsApp, Payments — live indicators from `/health` + `/ops`.
- Emergency stop / resume controls wired to backend.
- ConnectBar: Shown contextually on Pipeline and Contacts tabs only.
- Offline state: Polling every 8s. "Reconnecting…" shown clearly.

### Issues
| Issue | Severity |
|-------|----------|
| No error state if `/ops` returns 500 — tiles silently show "—" | LOW |
| Revenue widget hardcoded to INR — no currency setting | LOW |

---

## AREA 3: BUSINESS OS

**Overall Status: PARTIAL**

### Contact Create / Update — `ContactsV2.jsx`
- **PASS** — Add contact modal with name + phone + service + deal value + notes. Validation present. Duplicate phone detection. `POST /crm` wired.
- Update: Edit drawer implemented with status update, deal value, notes.
- Status chips (New, Hot, Qualified, Won, Paid, Lost) functional.
- WhatsApp follow-up templates with send button wired to `sendFollowUp` → backend.

### Payment Link Generation — `PaymentsV2.jsx`
- **PARTIAL** — UI is complete. `POST /payment/link` is wired. Razorpay setup guide inline.
- **CRITICAL BLOCKER:** `BASE_URL=http://localhost:5050` in `.env` — Razorpay `callback_url` points to localhost. Payment confirmations via webhook will never arrive in production.
- Razorpay keys are live (`rzp_live_*`) but `callback_url` misconfigured.
- WhatsApp follow-up send with payment link works if WA token is valid.

### Reports — `ReportsV2.jsx`
- **PARTIAL** — KPI cards, pipeline chart, automation stats all pull live data.
- **FAIL:** "Advanced reporting" section is a `ComingSoon` banner — no charts or export.

### BusinessOS (Full CRM) — `BusinessOS.jsx`
- **PASS** — 6-tab structure: Dashboard, Leads, Contacts, Pipeline, Campaigns, Revenue.
- All CRUD operations implemented and backed by `/business/*` routes.
- Currency displayed as USD (`_fmtAmt` hardcodes USD) — mismatch with INR product.

### Issues
| Issue | Severity |
|-------|----------|
| `BASE_URL=http://localhost` breaks Razorpay payment webhooks in production | CRITICAL |
| BusinessOS uses USD currency formatting — product is INR-first | MEDIUM |
| Reports advanced section is "Coming Soon" stub | MEDIUM |
| No WhatsApp template approval check before bulk send | MEDIUM |

---

## AREA 4: AGENT OS

**Overall Status: PARTIAL**

### Agent Creation
- **PASS** — Create Agent flow in `AgentOSV2.jsx` Tab Factory: role template selection, name, capabilities multi-select, trigger type. Calls `POST /p20/agents` via `createManagedAgent`.
- Seed agents always shown as fallback if API returns empty.

### Agent Execution
- **PARTIAL** — "Run" button on agent cards calls `executeAgentTask` → `POST /p18/agents/:id/execute`.
- **ISSUE:** Execute call fires but the result is shown only as a toast ("Task dispatched"). No result panel or output view. User has no visibility into what the agent actually did.

### Collaboration
- **PARTIAL** — Collaboration tab renders a seed event log (hardcoded) showing agent handoff events.
- **FAIL** — No live data. Events are static seed constants (`COLLAB_EVENTS_SEED`). Real agent collaboration events from `agentExecutionEngine.cjs` are not surfaced.

### Intelligence Chat
- **PASS** — AI chat in Agent OS calls `sendMessage` → `/jarvis`. Contextual prompts provided. History not persisted to backend.

### Agent OS "Coming Soon" stubs
- **FAIL** — Factory tab sub-section has `ComingSoon` banner ("Advanced scheduling — Coming Soon").
- **FAIL** — Agent detail drawer's "runs" tab has a `ComingSoon` block.

### Issues
| Issue | Severity |
|-------|----------|
| No agent execution output view — user can't see what the agent returned | HIGH |
| Collaboration events are hardcoded seed data, not live | HIGH |
| Agent run history tab shows "Coming Soon" in detail drawer | MEDIUM |

---

## AREA 5: MEMORY OS

**Overall Status: PARTIAL**

### Create Memory
- **PARTIAL** — Memory Index tab shows entries with type chips. "Add Memory" action in Knowledge tab.
- `addKnowledge` → `POST /personal/knowledge` is wired.
- **FAIL:** Memory OS itself has no "create new memory node" button in the Index tab. Users can only view existing nodes.

### Search Memory
- **PASS** — Search bar with type filter in Memory Index tab. `searchMemory` API called.
- Recent queries section shown as static seed data (not from backend).

### Shared Memory
- **PARTIAL** — Shared Fabric tab renders a rich view of global/company/agent/project scope nodes.
- **FAIL:** "Full Graph View" is a `ComingSoon` banner. The fabric view is static seed data (`SHARED_NODES`), not live from `memoryPersistenceLayer.cjs`.

### Intelligence
- **FAIL** — Intelligence tab shows AI insights from static seed constants (`AI_INSIGHTS`). The `ComingSoon` banner reads "Deep Memory Intelligence — Coming Soon". No live ML analysis.

### Knowledge Base
- **FAIL** — Knowledge tab shows seed documents with "Upload" button.
- **FAIL:** "Knowledge Base — Upload Coming Soon" — the upload action shows a ComingSoon banner. No real file upload wired.

### Issues
| Issue | Severity |
|-------|----------|
| Memory Index has no create-new-memory action | HIGH |
| Shared Memory Fabric is entirely seed data — not live | HIGH |
| Intelligence tab is static seeds with "Coming Soon" | HIGH |
| Knowledge Upload shows Coming Soon | HIGH |
| Recent query history is hardcoded | MEDIUM |

---

## AREA 6: WORKFLOW OS

**Overall Status: PARTIAL**

**Navigation gap:** WorkflowOSV2 is only accessible via `tab === "autonomouswf"` ("Auto Workflows" in the More menu). There is no "Workflow" tab directly. Users navigating to "workflow"-related content from the Copilot or Dashboard get confused.

### Run Workflow
- **PASS** — Library tab: workflow cards with Run button. Calls `sendMessage("run {wf.name}", "exec")`.
- Quick trigger input box calls `startCycle` → `POST /p18/cycles`.
- Filtering by category and search work client-side.

### Designer
- **FAIL** — "Workflow Builder — Coming Soon" banner. The Designer tab is a stub.

### History
- **PARTIAL** — History tab calls `listCycles` → `GET /p18/cycles`. Falls back to seed data if API is empty.

### Task Routing
- **PASS** — Task Router tab shows routing rules table and department cards with active work. Drag-and-assign UI functional. Calls `dispatchTask` on "Assign" action.

### Scheduled Workflows
- **PARTIAL** — Scheduled tab renders a table. No real scheduling API wired — shows placeholder message if empty.

### Autonomous Mode
- **PARTIAL** — Autonomous tab shows department cards with live metrics. `startCycle` wired.

### Issues
| Issue | Severity |
|-------|----------|
| Workflow Designer is a "Coming Soon" stub — key promised feature | CRITICAL |
| Tab only accessible via "Auto Workflows" in More menu — poor discoverability | HIGH |
| Scheduled workflow API not wired | MEDIUM |

---

## AREA 7: DEVELOPER COPILOT

**Overall Status: PARTIAL**

### Chat
- **PASS** — Copilot Chat tab sends to `POST /p24/vscode/chat`. Chat history persisted to localStorage (last 60 messages). Contextual prompts provided.

### Repo Search / Intelligence
- **PARTIAL** — Repo Intelligence tab shows seed repos with status. `listIndexedRepos` called.
- **FAIL:** "Repository tracking — Coming Soon" shown when no repos indexed. Index button calls `indexRepo` but the UI has no real progress tracker.

### Code Review
- **PARTIAL** — Review tab shows seed review findings (hardcoded `SEED_REVIEWS`).
- **FAIL:** "Automated PR Code Review — Coming Soon" banner visible. Not connected to a real review engine.

### Architecture Advisor
- **FAIL** — "Architecture Advisor — Coming Soon" banner. Full stub.

### Tool Execution
- **PASS** — Tool Fabric tab shows tools (WhatsApp, Razorpay, CRM, etc.) with status chips and call counts from `listTools`. Execute calls `executeTool`. Degraded tools (Razorpay) shown correctly.

### Engineering Health
- **PARTIAL** — Performance table and SLO indicators pull live data from `telemetryApi`. Historical charts: "Coming Soon."

### Integrations
- **PASS** — Integration catalog shows connected/disconnected state. OAuth connect/revoke via `phase21Api`.

### Issues
| Issue | Severity |
|-------|----------|
| Architecture Advisor is a stub | HIGH |
| Automated Code Review is a stub | HIGH |
| Historical Performance Charts are "Coming Soon" | MEDIUM |
| Repo indexing has no live progress UI | MEDIUM |

---

## AREA 8: DEVOPS CENTER

**Overall Status: PARTIAL**

### Runtime
- **PASS** — Runtime tab calls `getRuntimeStatus` and `getRuntimeHistory`. Emergency stop/resume wired. Queue counts displayed.

### Deployments
- **PARTIAL** — Deployments tab calls `listDeployments` and `getDeployHistory`.
- **FAIL:** "One-click Deploy & Rollback — Coming Soon" on the deploy action pane. Viewing history works; triggering deploys does not.

### Logs
- **PASS** — Logs tab renders log list with level filter and type filter. Calls `getRuntimeHistory` for fallback. Seed logs shown if API empty.

### Alerts
- **PASS** — Alerts tab calls `listAlerts` and `resolveAlert`. Severity color coding. Open/resolved filter.

### Telemetry / Observability
- **PARTIAL** — Observability tab shows service map with latency/uptime.
- **FAIL:** "Distributed Tracing & Service Map — Coming Soon" banner.

### Telemetry Charts
- **FAIL** — "Historical Telemetry Charts — Coming Soon" in Telemetry tab.

### Service Health
- **PASS** — Service health table with real status from `SEED_SERVICES` with live status overlay from `checkHealth`.

### AI Models
- **PASS** — AI Models tab lists OpenRouter, Groq, Anthropic with status, latency, cost.

### Issues
| Issue | Severity |
|-------|----------|
| Deploy trigger UI is "Coming Soon" — can't actually deploy from the UI | HIGH |
| Distributed tracing is "Coming Soon" | MEDIUM |
| Historical telemetry charts are "Coming Soon" | MEDIUM |
| Razorpay consistently flagged as `degraded` — a critical open alert since 2h | HIGH (ops risk) |

---

## AREA 9: GROWTH OS

**Overall Status: PARTIAL**

### SEO Reports
- **PASS** — SEO tab with technical checks, keyword table, score ring. "AI Report" button generates an SEO action plan via `sendMessage`. Report displayed inline with copy button.
- Keyword data is hardcoded but clearly labelled.

### Content Generation
- **PASS** — Content tab with type selector (blog, landing, LinkedIn, email, ad, thread). All types call `sendMessage` with structured prompt. Result shown with copy.
- Tone selector functional. Loading states present.

### Social Generation
- **PARTIAL** — Social tab shows platform cards (Instagram, LinkedIn, Twitter, Facebook).
- **FAIL:** Platform OAuth connect buttons → `"Coming Soon"` toast. Cannot actually connect social accounts.
- **FAIL:** "Auto-posting & Scheduling — Coming Soon" banner.

### Email Generation / Email Marketing
- **PARTIAL** — Email tab with campaign type selector and AI generation working.
- **FAIL:** "Email Provider Integration — Coming Soon" — no Mailchimp/SendGrid connect.

### Referral Engine
- **PASS** — Referral tab shows program setup, share links, and referral stats (from `sendMessage` with referral prompt).

### Launch Tab
- **PASS** — Launch tab renders launch checklist with AI-powered action generation.

### Issues
| Issue | Severity |
|-------|----------|
| Social auto-posting and account connection is "Coming Soon" | HIGH |
| Email provider integration is "Coming Soon" | HIGH |

---

## AREA 10: ELECTRON SHELL

**Overall Status: PARTIAL**

### App Load
- **PASS** — Dev: `loadURL("http://localhost:3000?desktop=1")`. Prod: `loadFile(...)` with `{ query: { desktop: "1" } }`. Correct approach.

### IPC Routes
- **PASS** — `send-command`, `get-server-health`, `get-evolution-score`, `get-suggestions`, `approve-suggestion`, `create-floating-window`, `open-external`, `report-renderer-crash`, `get-renderer-crashes` all implemented.

### Panels
- **PASS** — 5-tab structure identical to web. Desktop-specific `DESKTOP_TABS`. Same `MORE_TABS` accessible via dropdown.

### Offline Handling
- **PASS** — `getServerHealth` IPC polls backend. `server-disconnected` event sent to renderer. `ConnectBar` and status dot reflect offline state.

### Reconnect Handling
- **PASS** — `system-resume`, `network-change`, `window-restored` IPC events implemented. Renderer can re-poll on wake/reconnect.

### Google Auth in Electron
- **FAIL** — Google OAuth uses `openExternal` to system browser. After authentication in the browser, there is no deep-link or IPC mechanism to pass the Firebase token back to the Electron window. The user ends up authenticated in the browser but not in the app. **This is a broken flow.**

### Renderer Crash Recovery
- **PASS** — Up to 3 auto-reloads on renderer crash. Counter resets after 60s clean run. Crash log persisted to `userData/renderer_crashes.json`.

### Issues
| Issue | Severity |
|-------|----------|
| Google OAuth is broken in Electron (no token callback to app window) | HIGH |
| Floating window loads full app — no minibar/compact mode | LOW |
| No app icon configured for production build (`entitlements.mac.plist` exists but icon not verified) | MEDIUM |

---

## CROSS-CUTTING ISSUES

### Security
| Issue | Severity |
|-------|----------|
| `.env` with live API keys (Razorpay live key, WA token, OpenAI key, Groq key, Telegram token) committed to repo | CRITICAL |
| `RAZORPAY_WEBHOOK_SECRET` has a leading space in `.env` — webhook signature verification will fail | HIGH |
| JWT_SECRET is present and strong — OK | PASS |
| `requireAuth` has a dev passthrough that bypasses auth when `JWT_SECRET` not set outside production — risky if NODE_ENV misconfigured | MEDIUM |

### UX / Dead Buttons
| Issue | Severity |
|-------|----------|
| "Coming Soon" found in 14+ distinct component sections — customer sees "Coming Soon" everywhere | HIGH |
| WorkflowOSV2 buried under "Auto Workflows" in More menu — not discoverable as a primary product feature | HIGH |
| No "Workflow OS" tab directly accessible — users who expect a Workflow area can't find it | HIGH |
| Social connect buttons toast "Coming Soon" instead of navigating to setup | MEDIUM |
| Email provider connect in Growth OS is a "Coming Soon" button | MEDIUM |
| AICostCenter shows "Coming Soon" — whole panel is a stub | MEDIUM |
| KnowledgeCenter shows "Coming Soon" | MEDIUM |
| DisasterRecoveryCenter shows "Coming Soon" | MEDIUM |
| EmailMarketingOS shows "Coming Soon" | MEDIUM |
| SupportCenter shows "Coming Soon" | MEDIUM |
| SeoCommandCenter shows "Coming Soon" | MEDIUM |

### API Failures / Misconfigurations
| Issue | Severity |
|-------|----------|
| `BASE_URL=http://localhost:5050` — Razorpay callback_url broken in production | CRITICAL |
| Firebase keys absent from production build — Google OAuth, Phone OTP dead | CRITICAL |
| `RAZORPAY_WEBHOOK_SECRET` leading space — all Razorpay webhooks will return 400 | HIGH |
| Razorpay payment link SLO at 84.2% (target 95%) — live alert open for 2h | HIGH |

### Missing States
| Issue | Severity |
|-------|----------|
| AgentOSV2 execution — no output view, no result display | HIGH |
| Memory OS — no "create node" UI in the primary Index tab | HIGH |
| Shared Memory Fabric — entirely seed data, no live API | HIGH |
| DevOps deploy trigger — "Coming Soon" | HIGH |

---

## PASS / PARTIAL / FAIL MATRIX

| Screen / Feature | Status |
|-----------------|--------|
| **AUTH** | |
| Email Signup | PASS |
| Email Login | PASS |
| Google Login (Web) | PARTIAL |
| Google Login (Electron) | FAIL |
| Phone OTP | PARTIAL |
| Forgot Password | PASS |
| Logout | PASS |
| Session Restore | PASS |
| **DASHBOARD** | |
| Metric widgets | PASS |
| Empty states | PASS |
| Loading states | PASS |
| Offline / error states | PASS |
| **BUSINESS OS** | |
| Contact Create | PASS |
| Contact Update | PASS |
| Payment Link Generation | PARTIAL |
| Reports (basic) | PARTIAL |
| Reports (advanced) | FAIL |
| **AGENT OS** | |
| Agent Creation | PASS |
| Agent Execution (trigger) | PARTIAL |
| Agent Execution (output) | FAIL |
| Collaboration Events | FAIL |
| Intelligence Chat | PASS |
| **MEMORY OS** | |
| Memory Index (view) | PARTIAL |
| Create Memory | FAIL |
| Search Memory | PASS |
| Shared Memory (live) | FAIL |
| Intelligence (live) | FAIL |
| Knowledge Upload | FAIL |
| **WORKFLOW OS** | |
| Run Workflow | PASS |
| Workflow Designer | FAIL |
| History | PARTIAL |
| Task Routing | PASS |
| Autonomous Mode | PARTIAL |
| **DEVELOPER COPILOT** | |
| Chat | PASS |
| Repo Search | PARTIAL |
| Code Review (automated) | FAIL |
| Architecture Advisor | FAIL |
| Tool Execution | PASS |
| **DEVOPS CENTER** | |
| Runtime | PASS |
| Deployments (view) | PARTIAL |
| Deploy (trigger) | FAIL |
| Logs | PASS |
| Alerts | PASS |
| Telemetry / Tracing | FAIL |
| **GROWTH OS** | |
| Content Generation | PASS |
| SEO Reports | PASS |
| Social Generation | PARTIAL |
| Social Auto-post | FAIL |
| Email Generation | PASS |
| Email Provider | FAIL |
| **ELECTRON** | |
| App Load | PASS |
| IPC Routes | PASS |
| Offline Handling | PASS |
| Reconnect Handling | PASS |
| Google Auth | FAIL |
| Crash Recovery | PASS |

---

## CRITICAL BLOCKERS (must fix before go-live)

| # | Blocker | Impact |
|---|---------|--------|
| 1 | `BASE_URL=http://localhost` in `.env` — Razorpay payment confirmations never arrive | Payments broken in production |
| 2 | Firebase env vars not in `.env.production` — Google OAuth, Phone OTP dead in prod build | Auth limited to email-only |
| 3 | Live API keys (Razorpay live, WA token, OpenAI, Groq, Telegram) committed to git `.env` | Security — key rotation required immediately |
| 4 | `RAZORPAY_WEBHOOK_SECRET` has leading space — webhook signature fails | Payment webhook verification broken |
| 5 | Google OAuth broken in Electron (no token passback) | Desktop users can't Google-sign-in |
| 6 | "Coming Soon" stubs in 14+ prominent sections without a feature-gate — customers see dead-end UI everywhere | Trust / conversion risk |

---

## HIGH-PRIORITY RECOMMENDATIONS

1. **Set `BASE_URL` to production domain** before any payment goes live.
2. **Add Firebase keys to `.env.production`** (not `.env.local` only) before building.
3. **Rotate all leaked secrets** in `.env` immediately — never commit API keys.
4. **Fix Razorpay webhook secret** — remove leading space.
5. **Feature-gate "Coming Soon" panels** — either hide tabs behind a flag or add clear beta badge, so customers don't land on dead ends.
6. **Add WorkflowOSV2 as a primary tab** ("Workflows") — it's a core product feature buried under "More."
7. **Add Agent execution output panel** — running an agent and getting no visible result is confusing.
8. **Wire Memory Shared Fabric to live data** — seed data in a live product destroys trust.

---

## LAUNCH READINESS SCORE

```
Authentication:         70 / 100  (weight 15%)  →  10.5
Dashboard:              85 / 100  (weight 10%)  →   8.5
Business OS (CRM):      70 / 100  (weight 15%)  →  10.5
Agent OS:               55 / 100  (weight 10%)  →   5.5
Memory OS:              40 / 100  (weight 10%)  →   4.0
Workflow OS:            50 / 100  (weight 10%)  →   5.0
Developer Copilot:      50 / 100  (weight  8%)  →   4.0
DevOps Center:          55 / 100  (weight  7%)  →   3.9
Growth OS:              60 / 100  (weight  8%)  →   4.8
Electron Shell:         65 / 100  (weight  7%)  →   4.6
─────────────────────────────────────────────────────
TOTAL:                                          61.3 / 100
(adjusted down -6 for 3 critical security/payment blockers)

FINAL SCORE: 55 / 100
```

---

## RECOMMENDATION

### **SOFT LAUNCH**

**What to launch today:**
- Email signup / login flow
- Dashboard (Control Center + Pipeline)
- Contacts + Payment link (after BASE_URL fix)
- Growth OS (SEO + Content + Email generation)
- Developer Copilot (Chat + Tool Fabric)

**What to label "Beta" / hide:**
- Memory OS (Shared Fabric, Intelligence, Knowledge Upload are stubs)
- Workflow Designer (Coming Soon)
- Agent Collaboration (seed data)
- DevOps deploy trigger
- Architecture Advisor / Automated Code Review

**What must be fixed before any paid customer goes live:**
1. `BASE_URL` → production domain
2. Razorpay webhook secret (remove leading space)
3. Firebase keys in production build
4. Rotate all secrets committed in `.env`

---

*Audit generated: 2026-06-08. Next audit recommended after critical blockers resolved.*
