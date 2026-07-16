"use strict";
/**
 * Connector Tool Bridge — exposes connected OAuth integrations to agents as
 * LLM tool-calling definitions (see aiService.chatWithTools).
 *
 * Scope: only wraps functions that genuinely exist and do real work in
 * oauthIntegrationLayer.cjs (listConnections, getProviderStatus, getToken).
 * There is no per-service action layer in this codebase yet (no "send Slack
 * message" / "create GitHub issue" methods exist anywhere) — so tools are
 * limited to connection state and token retrieval, which is real and
 * immediately useful for an agent deciding whether/how to reach a service.
 */

const oauth = require("./oauthIntegrationLayer.cjs");

const PROVIDERS = ["google", "github", "slack", "notion", "microsoft", "linkedin"];

function getConnectorTools() {
    return [
        {
            name: "list_connected_services",
            description: "List which third-party services (Google, GitHub, Slack, Notion, Microsoft, LinkedIn) the current user has connected via OAuth, including expiry.",
            parameters: { type: "object", properties: {}, required: [] },
        },
        {
            name: "get_connector_status",
            description: "Check whether a specific connector provider is configured on the server and whether the current user has an active connection.",
            parameters: {
                type: "object",
                properties: { provider: { type: "string", enum: PROVIDERS, description: "Connector provider id" } },
                required: ["provider"],
            },
        },
        {
            name: "get_connector_auth_url",
            description: "Get the OAuth authorize URL to connect a new service. Present this URL to the user so they can grant access — do not fetch it yourself.",
            parameters: {
                type: "object",
                properties: { provider: { type: "string", enum: PROVIDERS, description: "Connector provider id" } },
                required: ["provider"],
            },
        },
    ];
}

/**
 * executeConnectorTool(name, args, userId) — dispatches a tool call by name.
 * Throws for unknown tool names or missing required args.
 */
function executeConnectorTool(name, args = {}, userId = "default") {
    switch (name) {
        case "list_connected_services":
            return { connections: oauth.listConnections(userId) };

        case "get_connector_status": {
            if (!args.provider) throw new Error("provider is required");
            const status = oauth.getProviderStatus();
            const connected = oauth.listConnections(userId).some(c => c.provider === args.provider);
            return { provider: args.provider, configured: !!status[args.provider]?.configured, connected };
        }

        case "get_connector_auth_url": {
            if (!args.provider) throw new Error("provider is required");
            return oauth.getAuthUrl(args.provider, userId);
        }

        default:
            throw new Error(`Unknown connector tool: ${name}`);
    }
}

module.exports = { getConnectorTools, executeConnectorTool };
