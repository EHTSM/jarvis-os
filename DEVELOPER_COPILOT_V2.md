# DEVELOPER COPILOT V2
**Phase:** 39 — Frontend Rebuild Strategy
**Date:** 2026-06-07
**Status:** Specification — No code written
**Scope:** Build section — Developer Copilot, Engineering, Integrations, Tool Fabric. Backend unchanged.

---

## 1. OVERVIEW

Developer Copilot covers all developer-facing screens under the **Build** navigation group.

| New Screen | Old Tab IDs | Old Components | Section |
|---|---|---|---|
| Developer Copilot | `copilot` | `DeveloperCopilotCenter.jsx` | Build |
| Engineering | `engineering` | `EngineeringCenter.jsx` | Build |
| Integrations | `integrations` | `IntegrationCenter.jsx` | Build |
| Tool Fabric | `toolfabric` | `ToolFabricCenter.jsx` | Build |
| Plugins | Electron panel | `operator/PluginManagerPanel.jsx` | Build (Electron) |

---

## 2. DEVELOPER COPILOT SCREEN V2

### 2.1 Purpose

AI-assisted code review, architecture suggestions, and developer Q&A. Uses the same `sendMessage` API as the main chat but in a developer-specific context.

### 2.2 APIs Used

```javascript
sendMessage(input, mode)    // POST /jarvis with mode="code" or "smart"
getDevRepos({ status, language, search, limit })  // GET /dev/repos
getDevRepo(repoId)                                // GET /dev/repos/{id}
createDevRepo(payload)                            // POST /dev/repos
updateDevRepo(repoId, payload)                    // PATCH /dev/repos/{id}
```

### 2.3 Screen Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Build › Developer Copilot                                       │
│                                                                  │
│  Developer Copilot                                               │
│  AI-assisted development · Code review · Architecture            │
│──────────────────────────────────────────────────────────────────│
│  [ Copilot ] [ Repos ] [ Code Review ] [ Architecture ]          │
│    ────────                                                      │
│──────────────────────────────────────────────────────────────────│
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐      │
│  │  COPILOT CHAT                                          │      │
│  │  ─────────────────────────────────────────────────     │      │
│  │                                                        │      │
│  │  ┌──────────────────────────────────────────────────┐  │      │
│  │  │ Jarvis  14:33                                    │  │      │
│  │  │ I'm your Developer Copilot. I can help with:     │  │      │
│  │  │ • Code review and bug analysis                   │  │      │
│  │  │ • Architecture decisions                         │  │      │
│  │  │ • API design and endpoint planning               │  │      │
│  │  │ • Debugging and performance analysis             │  │      │
│  │  │                                                  │  │      │
│  │  │ What are you working on?                         │  │      │
│  │  └──────────────────────────────────────────────────┘  │      │
│  │                                                        │      │
│  │  QUICK PROMPTS                                         │      │
│  │  [ Review my latest changes ]  [ Debug this error ]   │      │
│  │  [ Suggest improvements ]      [ Explain this code ]  │      │
│  │                                                        │      │
│  │  [ Ask Copilot anything about your code…    ] [ ▶ ]  │      │
│  └────────────────────────────────────────────────────────┘      │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 2.4 Chat Context

The copilot chat passes `mode: "code"` to `sendMessage`. The backend Jarvis model handles this mode — no frontend logic change required.

Suggested prompts (developer-specific):
1. "Review my latest changes"
2. "What tests should I write for this feature?"
3. "Suggest architecture improvements"
4. "Analyze this error: [paste stack trace]"
5. "Help me design an API endpoint for [use case]"

Chat message design: same as Intelligence screen (AGENT_OS_V2.md section 4.4) with one addition:
- Code blocks in responses: monospace font, `--surface-2` background, `--radius-sm`, horizontal scroll
- Syntax highlighting: none (too heavy) — just monospace + dim background

### 2.5 Repos Sub-tab

Displays developer repositories from `GET /dev/repos`.

```
┌──────────────────────────────────────────────────────────────────┐
│  [ 🔍 Search repos… ]                          [ + Add Repo ]    │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │ [icon]  jarvis-os                         ● ACTIVE      │     │
│  │ Node.js · Express · React                               │     │
│  │ Last activity: 2h ago   Issues: 3   PRs: 1              │     │
│  │ [ Open ] [ Analyze ] [ Review →]                        │     │
│  ├─────────────────────────────────────────────────────────┤     │
│  │ [icon]  mobile-app                        ● ACTIVE      │     │
│  │ Flutter · Dart · Firebase                               │     │
│  │ Last activity: 1d ago   Issues: 0   PRs: 0              │     │
│  └─────────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────────┘
```

Repo card:
- Icon: language-specific (JS=yellow circle, Dart=blue, Python=green, etc.)
- Status chip: ACTIVE / INACTIVE / ARCHIVED
- "Analyze": `sendMessage("analyze repo " + repoName, "code")`
- "Review →": `sendMessage("code review " + repoName, "code")`
- "Open": external link to repo URL if set

If `GET /dev/repos` returns empty or 404:
```
◎ Repository tracking — Coming Soon
Link your repositories to enable AI code review and analysis.
```

### 2.6 Code Review Sub-tab

Coming Soon:
```
◎ Automated Code Review — Coming Soon
Connect your GitHub/GitLab to enable PR-level AI review,
security scanning, and architecture analysis.
```

### 2.7 Architecture Sub-tab

Coming Soon:
```
◎ Architecture Advisor — Coming Soon
Upload your codebase schema or describe your architecture.
Jarvis will identify bottlenecks and suggest improvements.
```

---

## 3. ENGINEERING SCREEN V2

### 3.1 Purpose

Engineering operations — system health, performance, self-healing. Replaces `EngineeringCenter.jsx` + `SelfHealingCenter.jsx`.

### 3.2 APIs Used

```javascript
checkHealth()           // GET /health
getOpsData()            // GET /ops
getMetrics()            // GET /metrics
getRuntimeHistory(n)    // GET /runtime/history
```

### 3.3 Screen Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Build › Engineering                                             │
│                                                                  │
│  Engineering                                                     │
│  System health, performance, and self-healing                    │
│──────────────────────────────────────────────────────────────────│
│  [ Health ] [ Performance ] [ Self-Healing ] [ Errors ]          │
│    ────────                                                      │
│──────────────────────────────────────────────────────────────────│
│                                                                  │
│  SYSTEM HEALTH                                                   │
│                                                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │ Uptime          │  │ Memory          │  │ Response Time   │  │
│  │ 99.8%           │  │ 312 MB / 512 MB │  │ 320ms avg       │  │
│  │ 36h 42m         │  │ ██████████░░    │  │ ↓ 12% vs 1h ago │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
│                                                                  │
│  SERVICES                                                        │
│  ─────────────────────────────────────────────────────────────   │
│  ● AI Engine           ONLINE    99.1% uptime    320ms avg       │
│  ● WhatsApp            ONLINE    Active          220ms avg       │
│  ● Payments (Razorpay) DEGRADED  Auth issue      N/A            │
│  ● Telegram            ONLINE    Active          180ms avg       │
│  ● Task Queue          ONLINE    4 running       —               │
│                                                                  │
│  RECENT ERRORS                                                   │
│  ─────────────────────────────────────────────────────────────   │
│  Jun 6 14:20  workflow_runner timeout (30s)       ERROR          │
│  Jun 5 18:30  WhatsApp template rejected          ERROR          │
│  [ View all errors in Activity → ]                               │
└──────────────────────────────────────────────────────────────────┘
```

### 3.4 Service Row Design

```
[● STATUS DOT]  [Service Name]     [STATUS CHIP]  [Uptime %]  [Avg ms]
```

Status sources from `GET /health → services` and `GET /ops → services`.
Payments row: if Razorpay 401 detected, show DEGRADED chip in amber with "Auth issue" detail.

### 3.5 Performance Sub-tab

```
┌──────────────────────────────────────────────────────────────────┐
│  PERFORMANCE METRICS (from GET /metrics)                         │
│                                                                  │
│  Endpoint Response Times (avg, last 1h)                          │
│  POST /jarvis              320ms   ████████████████░░░░          │
│  GET  /crm                  45ms   ████░░░░░░░░░░░░░░░░          │
│  POST /payment/link         890ms  ████████████████████████░░    │
│  GET  /billing/status        30ms  ███░░░░░░░░░░░░░░░░░░░░       │
│                                                                  │
│  ◎ Historical performance charts — Coming Soon                   │
└──────────────────────────────────────────────────────────────────┘
```

### 3.6 Self-Healing Sub-tab

```
┌──────────────────────────────────────────────────────────────────┐
│  SELF-HEALING STATUS                                             │
│                                                                  │
│  ● Agent restart monitor     ACTIVE                             │
│  ● Task retry on failure     ACTIVE (max 3×, backoff)           │
│  ● Dead-letter queue         ACTIVE (data/dead-letter.json)     │
│  ● Renderer crash recovery   ACTIVE (Electron only)             │
│                                                                  │
│  RECOVERY EVENTS (last 7 days)                                   │
│  Jun 6  Agent jarvis-core restarted after crash   RECOVERED      │
│  Jun 4  Task retried 3× — moved to dead letter    DEAD LETTER    │
│  Jun 3  Renderer crash #2 — auto-reloaded         RECOVERED      │
└──────────────────────────────────────────────────────────────────┘
```

---

## 4. INTEGRATIONS SCREEN V2

### 4.1 Purpose

Connect third-party services via OAuth. Replaces `IntegrationCenter.jsx` which already has live OAuth status.

### 4.2 APIs Used (unchanged from V1)

```javascript
getOAuthProviderStatus()        // GET /oauth/status
listOAuthConnections()          // GET /oauth/connections
revokeOAuth(providerId)         // DELETE /oauth/connections/{id}
getOAuthUrl(providerId)         // GET /oauth/url/{id}
```

### 4.3 Screen Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Build › Integrations                                            │
│                                                                  │
│  Integrations                                                    │
│  Connect third-party services to extend Jarvis capabilities      │
│──────────────────────────────────────────────────────────────────│
│  [ Connected ] [ Available ] [ API Keys ]                        │
│                                                                  │
│  CONNECTED (2)                                                   │
│  ─────────────────────────────────────────────────────────────   │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │  [logo]  WhatsApp Business                   ● CONNECTED │    │
│  │  Sending follow-ups and payment reminders               │     │
│  │  Connected: Jun 3 2026   Phone: +91-XXXXXXXXXX          │     │
│  │  [ Configure ] [ Disconnect ]                           │     │
│  ├─────────────────────────────────────────────────────────┤     │
│  │  [logo]  Razorpay                          ⚠ DEGRADED   │    │
│  │  Payment link generation                                │     │
│  │  API keys return authentication error                   │     │
│  │  [ Fix credentials → ]                                  │     │
│  └─────────────────────────────────────────────────────────┘     │
│                                                                  │
│  AVAILABLE (not connected)                                       │
│  ─────────────────────────────────────────────────────────────   │
│  [logo] Google Workspace   [logo] Slack    [logo] Notion         │
│  [ Connect ]               [ Connect ]     [ Connect ]           │
│                                                                  │
│  API KEYS                                                        │
│  ─────────────────────────────────────────────────────────────   │
│  Manage API keys in your server's .env file.                    │
│  [ View .env docs → ]                                           │
└──────────────────────────────────────────────────────────────────┘
```

### 4.4 Integration Card Design

```
┌─────────────────────────────────────────────────────────┐
│  [Service Logo 32px]  [Service Name]    [STATUS CHIP]   │
│  [Description — 1 line]                                 │
│  [Connected since / detail / error message]             │
│  [ Action 1 ] [ Action 2 ]                              │
└─────────────────────────────────────────────────────────┘
```

Status chips: `CONNECTED` (green) / `DEGRADED` (amber, with error detail) / `NOT CONNECTED` (dim).

Razorpay degraded state: shows "Fix credentials →" button that navigates to WorkspaceSettings with Razorpay section scrolled into view.

"Connect" buttons: call `getOAuthUrl(providerId)` → redirect to OAuth page.

---

## 5. TOOL FABRIC SCREEN V2

### 5.1 Purpose

Registry of tools available to agents. Replaces `ToolFabricCenter.jsx`. Mostly Coming Soon but shows what's live.

### 5.2 Screen Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Build › Tool Fabric                                             │
│                                                                  │
│  Tool Fabric                          [ + Register Tool ] (soon) │
│  Tools and capabilities available to agents                      │
│──────────────────────────────────────────────────────────────────│
│                                                                  │
│  ACTIVE TOOLS (8)                                                │
│  ─────────────────────────────────────────────────────────────   │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │ 💬  WhatsApp    │  │ 💳  Razorpay   │  │ 📊  CRM Query  │  │
│  │ Send messages   │  │ Payment links   │  │ Lead lookup     │  │
│  │ ● ACTIVE        │  │ ⚠ DEGRADED     │  │ ● ACTIVE        │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │ 🤖  Jarvis AI   │  │ ✅  Task Queue  │  │ 📝  Memory      │  │
│  │ NL processing   │  │ Task dispatch   │  │ Context read    │  │
│  │ ● ACTIVE        │  │ ● ACTIVE        │  │ ● ACTIVE        │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
│                                                                  │
│  ◎ Custom Tool Registration — Coming Soon                        │
│  Register custom API endpoints as agent tools.                  │
└──────────────────────────────────────────────────────────────────┘
```

Tool status sourced from `GET /health → services` + `GET /ops`.
Tool grid: 3 columns desktop, 2 columns tablet, 1 column mobile.

---

## 6. RESPONSIVE SPEC

| Screen | Mobile (< 768px) | Desktop |
|---|---|---|
| Copilot | Full-screen chat, prompts hidden | Split: chat + repo panel |
| Engineering | Single column stats | 3-column metric cards + service table |
| Integrations | Stacked cards | 2-column (connected + available) |
| Tool Fabric | 2-column grid | 3-column grid |

---

## 7. PLUGIN MANAGER (ELECTRON ONLY)

**Location:** Electron operator sidebar or within Build › Tool Fabric.

**Reuses:** `operator/PluginManagerPanel.jsx` V1 implementation (already has live IPC status).

**V2 changes (visual only):**
- Apply V2 design tokens
- Ensure card matches Engineering service card pattern
- IPC Status section already live (from Phase 37)

**No logic changes needed** — the panel already calls `window.electronAPI.getServerHealth()` and `window.electronAPI.getRendererCrashes()`.
