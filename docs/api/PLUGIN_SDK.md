# Plugin SDK

Build custom integrations for Ooplix using the Plugin SDK.

## Overview

Plugins extend Ooplix by registering capabilities, custom actions, and UI panels. They run server-side as CommonJS modules loaded at startup.

## Plugin structure

```
my-plugin/
  index.cjs          — plugin entry point
  manifest.json      — plugin metadata
  README.md
```

## manifest.json

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "What this plugin does",
  "author": "Your Name",
  "capabilities": ["send_message", "read_crm"],
  "hooks": ["on_lead_created", "on_mission_complete"],
  "routes": ["/my-plugin/*"]
}
```

## index.cjs

```js
"use strict";

module.exports = {
  // Called once when Ooplix loads the plugin
  async onLoad(sdk) {
    sdk.registerCapability("my_action", async (params, context) => {
      // your logic
      return { ok: true, result: "done" };
    });

    sdk.registerHook("on_lead_created", async (lead) => {
      // react to CRM events
    });

    // Register a new API route
    sdk.registerRoute("GET", "/my-plugin/status", async (req, res) => {
      res.json({ ok: true, status: "running" });
    });
  },

  async onUnload() {
    // cleanup
  },
};
```

## SDK methods

| Method | Description |
|---|---|
| `sdk.registerCapability(name, handler)` | Register a named capability the AI runtime can call |
| `sdk.registerHook(event, handler)` | Subscribe to platform events |
| `sdk.registerRoute(method, path, handler)` | Add an Express route |
| `sdk.getCRM()` | Access CRM service |
| `sdk.getAI()` | Access the smart router for AI calls |
| `sdk.getMemory()` | Access agent memory |
| `sdk.log(level, message)` | Structured logging |

## Available hooks

| Hook | When fired |
|---|---|
| `on_lead_created` | New CRM lead created |
| `on_lead_updated` | CRM lead updated |
| `on_mission_complete` | Mission marked complete |
| `on_payment_received` | Razorpay webhook verified |
| `on_whatsapp_message` | Incoming WhatsApp message |
| `on_agent_output` | Any agent produces output |

## Installing a plugin

Place the plugin directory in `plugins/` and add to `.env`:

```env
ENABLED_PLUGINS=my-plugin,another-plugin
```

Restart the server. The plugin is loaded at startup.

## Plugin API routes

Plugin routes are served at the paths registered in `manifest.json`. All plugin routes are automatically gated by `requireAuth` unless explicitly marked `public: true` in the route registration.

## Examples

See `plugins/` in the repository for example plugins.
