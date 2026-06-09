"use strict";
/**
 * registerWorkflows — ensures the three Jarvis trigger workflows exist in n8n.
 *
 * Called at server startup. Idempotent: skips any webhook that already exists.
 * Requires N8N_API_KEY in .env (generate at http://localhost:5678 → Settings → API).
 * Requires N8N_URL (default: http://localhost:5678).
 *
 * Creates three minimal Webhook → Respond workflows:
 *   POST /webhook/lead-flow
 *   POST /webhook/content-flow
 *   POST /webhook/sales-flow
 */

const axios = require("axios");

const WORKFLOWS_TO_REGISTER = [
    {
        name:         "Jarvis_Lead_Flow",
        webhookPath:  "lead-flow",
        description:  "Lead flow automation entry point — triggered by start_lead_flow task",
        responseMsg:  "Lead flow triggered 🚀",
    },
    {
        name:         "Jarvis_Content_Flow",
        webhookPath:  "content-flow",
        description:  "Content flow automation entry point — triggered by start_content_flow task",
        responseMsg:  "Content flow triggered 🎬",
    },
    {
        name:         "Jarvis_Sales_Flow",
        webhookPath:  "sales-flow",
        description:  "Sales funnel automation entry point — triggered by start_sales_funnel task",
        responseMsg:  "Sales funnel triggered 💰",
    },
];

function _buildWorkflowPayload(wf) {
    const webhookNodeId  = `wh-${wf.webhookPath}`;
    const respondNodeId  = `rsp-${wf.webhookPath}`;

    return {
        name:   wf.name,
        active: true,
        nodes:  [
            {
                id:          webhookNodeId,
                name:        "Webhook",
                type:        "n8n-nodes-base.webhook",
                typeVersion: 2.1,
                position:    [0, 0],
                parameters:  {
                    httpMethod:   "POST",
                    path:         wf.webhookPath,
                    responseMode: "responseNode",
                    options:      {},
                },
            },
            {
                id:          respondNodeId,
                name:        "Respond",
                type:        "n8n-nodes-base.respondToWebhook",
                typeVersion: 1.5,
                position:    [240, 0],
                parameters:  {
                    respondWith:  "json",
                    responseBody: JSON.stringify({ message: wf.responseMsg, status: "ok" }),
                    options:      {},
                },
            },
        ],
        connections: {
            Webhook: {
                main: [[{ node: "Respond", type: "main", index: 0 }]],
            },
        },
        settings: { executionOrder: "v1" },
    };
}

async function _getExistingWorkflowNames(apiUrl, apiKey) {
    const res = await axios.get(`${apiUrl}/api/v1/workflows`, {
        headers: { "X-N8N-API-KEY": apiKey },
        timeout: 8000,
    });
    return new Set((res.data?.data || []).map(w => w.name));
}

async function _createWorkflow(apiUrl, apiKey, payload) {
    const res = await axios.post(`${apiUrl}/api/v1/workflows`, payload, {
        headers: { "X-N8N-API-KEY": apiKey, "Content-Type": "application/json" },
        timeout: 8000,
    });
    return res.data;
}

/**
 * Register missing Jarvis trigger workflows in n8n.
 * Silently skips if N8N_API_KEY is not set.
 *
 * @returns {Promise<{registered:string[], skipped:string[], errors:string[]}>}
 */
async function registerWorkflows() {
    const apiKey = process.env.N8N_API_KEY;
    const apiUrl = process.env.N8N_URL || "http://localhost:5678";

    if (!apiKey) {
        console.info("[n8n] N8N_API_KEY not set — skipping workflow auto-registration");
        console.info("[n8n] To enable: generate a key at http://localhost:5678 → Settings → API, add N8N_API_KEY=<key> to .env");
        return { registered: [], skipped: WORKFLOWS_TO_REGISTER.map(w => w.name), errors: [] };
    }

    const result = { registered: [], skipped: [], errors: [] };

    let existing;
    try {
        existing = await _getExistingWorkflowNames(apiUrl, apiKey);
    } catch (err) {
        const msg = err.response?.status === 401
            ? "N8N_API_KEY is invalid — generate a new one at http://localhost:5678 → Settings → API"
            : `n8n API unreachable: ${err.message}`;
        console.warn(`[n8n] Registration skipped: ${msg}`);
        result.errors.push(msg);
        return result;
    }

    for (const wf of WORKFLOWS_TO_REGISTER) {
        if (existing.has(wf.name)) {
            console.info(`[n8n] Workflow already registered: ${wf.name}`);
            result.skipped.push(wf.name);
            continue;
        }

        try {
            const created = await _createWorkflow(apiUrl, apiKey, _buildWorkflowPayload(wf));
            console.info(`[n8n] Registered: ${wf.name} → POST /webhook/${wf.webhookPath} (id=${created.id})`);
            result.registered.push(wf.name);
        } catch (err) {
            const msg = `Failed to register ${wf.name}: ${err.response?.data?.message || err.message}`;
            console.warn(`[n8n] ${msg}`);
            result.errors.push(msg);
        }
    }

    return result;
}

module.exports = { registerWorkflows };
