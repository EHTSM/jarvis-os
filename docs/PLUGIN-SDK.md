# JARVIS OS — Plugin SDK

Plugins extend JARVIS OS with new capabilities, lifecycle hooks, and HTTP routes at runtime without modifying core code. The SDK is implemented in `backend/services/pluginSDK.cjs`.

## Plugin Schema

A plugin is a plain JavaScript object with the following shape:

```js
{
  id:           "my-plugin",           // string, unique identifier
  name:         "My Plugin",           // string, human-readable name
  version:      "1.0.0",              // string, semver
  description:  "What it does",       // string
  author:       "Your Name",           // string
  capabilities: ["cap_one", "cap_two"], // string[], capabilities this plugin provides
  hooks: {                            // optional, lifecycle hook functions
    onLoad:             (plugin) => {},
    onUnload:           (plugin) => {},
    onAgentTask:        (task)   => {},
    onRecommendation:   (rec)    => {},
    onMemorySave:       (node)   => {},
  },
  routes: [                           // optional, additional HTTP routes
    {
      method:  "GET",
      path:    "/my-plugin/status",
      handler: (req, res) => res.json({ ok: true }),
    },
  ],
  meta: {                             // required, arbitrary metadata object
    category: "analytics",           // string, used for filtering
    tags:     ["reporting", "kpi"],  // string[], used for filtering
  },
}
```

All string fields are required. `capabilities`, `hooks`, `routes`, and `meta` have specific validation rules (see `_validatePlugin` in `pluginSDK.cjs`).

## Lifecycle Hooks

| Hook | When called | Signature |
|---|---|---|
| `onLoad` | Synchronously at `registerPlugin()` | `(plugin) => void` |
| `onUnload` | At `unregisterPlugin()` (best-effort, errors swallowed) | `(plugin) => void` |
| `onAgentTask` | When an agent task is dispatched (via `executeHook`) | `(task) => any \| Promise<any>` |
| `onRecommendation` | When a proactive recommendation is generated | `(rec) => any \| Promise<any>` |
| `onMemorySave` | When a memory node is saved | `(node) => any \| Promise<any>` |

Hooks are called in registration order. Each hook runs in its own try/catch — a failing hook does not block other plugins. Async hooks are awaited.

`executeHook(hookName, ...args)` returns an array of `{ pluginId, result }` or `{ pluginId, error }` objects.

## Registering a Plugin

### Via API (runtime registration)

```bash
POST /p26/plugins
Authorization: Bearer <token>
Content-Type: application/json

{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "Example plugin",
  "author": "EHTSM",
  "capabilities": ["report_generate"],
  "meta": { "category": "analytics" }
}
```

Response: `{ "success": true, "pluginId": "my-plugin", "registered": true }`

### Via code (server-side registration)

```js
const sdk = require("./backend/services/pluginSDK.cjs");

sdk.registerPlugin({
  id: "my-plugin",
  name: "My Plugin",
  version: "1.0.0",
  description: "Example plugin",
  author: "EHTSM",
  capabilities: ["report_generate"],
  hooks: {
    onLoad: (p) => console.log(`${p.name} loaded`),
  },
  meta: { category: "analytics" },
});
```

### Unregistering

```bash
DELETE /p26/plugins/:id
```

`onUnload` is called before removal. Capabilities provided exclusively by this plugin are removed from the capability registry.

## Capability System

When a plugin is registered, each string in its `capabilities` array is automatically registered in the capability registry as:

```js
{
  id:           "my-plugin:report_generate",
  name:         "report_generate",
  description:  "Capability \"report_generate\" provided by plugin \"my-plugin\"",
  providedBy:   "my-plugin",
  providerType: "plugin",
  category:     "analytics",   // from plugin.meta.category
}
```

Built-in agent capabilities are also bootstrapped into the registry on startup (10 built-in agents × their capability lists).

### Querying capabilities

```bash
# List all capabilities
GET /p26/capabilities

# Map of capability name → [providerId, ...]
GET /p26/capabilities/map

# Find all providers for a capability name
GET /p26/capabilities/find?name=report_generate

# Register a standalone capability
POST /p26/capabilities
{ "id": "agent:custom:my_cap", "name": "my_cap", "providedBy": "custom", "providerType": "agent" }
```

## Template System

Templates are reusable workflow blueprints with variable substitution.

### Template schema

```js
{
  id:          "daily-report",
  name:        "Daily Report",
  category:    "reporting",
  description: "Generates a daily KPI report",
  variables:   ["DATE", "DEPARTMENT"],   // string[], required vars for instantiation
  template:    "Generate a report for {{ DATE }} in {{ DEPARTMENT }}",
  // any additional fields are preserved
}
```

### Template API

```bash
# Register a template
POST /p26/templates
{ "id": "daily-report", "name": "Daily Report", "category": "reporting",
  "variables": ["DATE"], "template": "Report for {{ DATE }}" }

# List all templates (optional ?category= filter)
GET /p26/templates

# Instantiate a template with variable values
POST /p26/templates/daily-report/instantiate
{ "DATE": "2026-06-14" }
# Returns: { "result": "Report for 2026-06-14", "templateId": "daily-report", ... }
```

Instantiation replaces `{{ VAR_NAME }}` placeholders. Unreplaced placeholders are left as-is (no error).

## Example Plugin

```js
const sdk = require("./backend/services/pluginSDK.cjs");

const slackPlugin = {
  id:          "slack-notifier",
  name:        "Slack Notifier",
  version:     "1.0.0",
  description: "Posts agent results to a Slack channel",
  author:      "ops-team",
  capabilities: ["slack_notify"],
  hooks: {
    onLoad: (plugin) => {
      console.log("[SlackNotifier] Plugin loaded");
    },
    onAgentTask: async (task) => {
      if (task.status === "completed" && task.output) {
        await fetch(process.env.SLACK_WEBHOOK, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: `Agent result: ${task.output}` }),
        });
      }
    },
    onUnload: (plugin) => {
      console.log("[SlackNotifier] Plugin unloaded");
    },
  },
  routes: [
    {
      method: "GET",
      path:   "/slack-notifier/health",
      handler: (req, res) => res.json({ status: "ok", plugin: "slack-notifier" }),
    },
  ],
  meta: {
    category: "notifications",
    tags:     ["slack", "alerts"],
  },
};

sdk.registerPlugin(slackPlugin);
```

## Security

- Plugin routes are mounted only when explicitly requested via `getPluginRoutes()`. The core system does not auto-mount plugin routes — you must wire them into the Express app yourself.
- `onLoad` errors bubble to the caller of `registerPlugin()`, preventing silent registration of broken plugins.
- `onUnload` errors are swallowed (best-effort) to prevent blocking deregistration.
- Plugin IDs must be globally unique — attempting to register a duplicate throws an error.
- The `routes[].handler` field must be a function; non-function handlers are rejected at validation.
- Plugin metadata is persisted to `data/plugin-registry.json` (serialisable form only — functions are stripped). Plugin code is never persisted; re-registration is required on restart.
- There is no sandboxing. Plugins run in the same Node.js process with full access. Only register plugins from trusted sources.
