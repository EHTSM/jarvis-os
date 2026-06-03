"use strict";
/**
 * Automation Agent — triggers n8n workflow webhooks from Jarvis task types.
 *
 * Webhook mapping (task.type → n8n path):
 *   start_lead_flow    → /webhook/lead-flow
 *   start_content_flow → /webhook/content-flow
 *   start_sales_funnel → /webhook/sales-flow
 *
 * All three webhooks are registered in n8n (created on startup if absent).
 * Falls back to legacy aliases if a webhook returns 404.
 *
 * Features:
 *   - try/catch on every call — no silent crashes
 *   - exponential backoff retry (max 3 attempts)
 *   - execution log in data/workflow-execution-log.json
 *   - health status via getStatus() / getLog()
 */

const axios = require("axios");
const fs    = require("fs");
const path  = require("path");

// ── Configuration ─────────────────────────────────────────────────
const N8N_BASE       = process.env.N8N_URL || "http://localhost:5678";
const TIMEOUT_MS     = 10_000;
const MAX_RETRIES    = 3;
const BASE_DELAY_MS  = 500;   // doubles each retry: 500 → 1000 → 2000

const LOG_PATH       = path.join(__dirname, "../data/workflow-execution-log.json");
const MAX_LOG        = 200;

// ── Webhook map — primary paths + fallback aliases ────────────────
const WEBHOOK_MAP = {
    start_lead_flow:    { path: "lead-flow",    fallback: "whatsapp-lead",    label: "Lead Flow" },
    start_content_flow: { path: "content-flow", fallback: "business-workflow", label: "Content Flow" },
    start_sales_funnel: { path: "sales-flow",   fallback: "razorpay",          label: "Sales Funnel" },
};

// ── Execution log ─────────────────────────────────────────────────
function _loadLog() {
    try { return JSON.parse(fs.readFileSync(LOG_PATH, "utf8")); }
    catch { return []; }
}

function _appendLog(entry) {
    try {
        const log = _loadLog();
        log.unshift(entry);
        fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
        fs.writeFileSync(LOG_PATH, JSON.stringify(log.slice(0, MAX_LOG), null, 2));
    } catch { /* non-fatal */ }
}

// ── HTTP call with retry and backoff ──────────────────────────────
async function _postWithRetry(webhookPath, payload, label) {
    const url = `${N8N_BASE}/webhook/${webhookPath}`;
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const res = await axios.post(url, payload, {
                timeout: TIMEOUT_MS,
                headers: { "Content-Type": "application/json" },
                validateStatus: null,   // don't throw on 4xx/5xx — handle below
            });

            if (res.status === 200 || res.status === 202) {
                return { ok: true, status: res.status, data: res.data, url, attempts: attempt };
            }

            // 404 means webhook not registered — don't retry, return structured error
            if (res.status === 404) {
                return { ok: false, status: 404, error: `n8n webhook not registered: ${webhookPath}`, url, attempts: attempt };
            }

            lastError = `HTTP ${res.status}`;
        } catch (err) {
            lastError = err.code === "ECONNREFUSED"
                ? "n8n not reachable (ECONNREFUSED)"
                : err.message;
        }

        if (attempt < MAX_RETRIES) {
            const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
            console.log(`[AutomationAgent] ${label} attempt ${attempt} failed (${lastError}), retry in ${delay}ms`);
            await new Promise(r => setTimeout(r, delay));
        }
    }

    return { ok: false, error: lastError, url, attempts: MAX_RETRIES };
}

// ── Main execute ──────────────────────────────────────────────────
async function execute(task) {
    const mapping = WEBHOOK_MAP[task.type];

    if (!mapping) {
        return { success: false, error: `automationAgent: unknown task type: ${task.type}` };
    }

    const payload = {
        type:      task.type,
        input:     task.input     || null,
        payload:   task.payload   || null,
        source:    "jarvis",
        timestamp: new Date().toISOString(),
    };

    const startMs = Date.now();

    // Try primary webhook path first
    let result = await _postWithRetry(mapping.path, payload, mapping.label);

    // If primary returns 404, try fallback
    if (!result.ok && result.status === 404 && mapping.fallback) {
        console.log(`[AutomationAgent] Primary webhook missing (${mapping.path}), trying fallback: ${mapping.fallback}`);
        result = await _postWithRetry(mapping.fallback, payload, mapping.label + " (fallback)");
        if (result.ok) result.usedFallback = mapping.fallback;
    }

    const durationMs = Date.now() - startMs;

    const logEntry = {
        ts:          new Date().toISOString(),
        taskType:    task.type,
        label:       mapping.label,
        webhook:     result.usedFallback || mapping.path,
        ok:          result.ok,
        status:      result.status || null,
        error:       result.error  || null,
        attempts:    result.attempts,
        durationMs,
    };
    _appendLog(logEntry);

    if (result.ok) {
        console.log(`[AutomationAgent] ${mapping.label} triggered ✓ (${durationMs}ms, ${result.attempts} attempt(s))`);
        return {
            success:  true,
            message:  `${mapping.label} started`,
            webhook:  result.usedFallback || mapping.path,
            attempts: result.attempts,
            durationMs,
        };
    }

    const errorMsg = `${mapping.label} failed after ${result.attempts} attempt(s): ${result.error}`;
    console.error(`[AutomationAgent] ${errorMsg}`);
    return {
        success:  false,
        error:    errorMsg,
        webhook:  mapping.path,
        attempts: result.attempts,
        durationMs,
    };
}

// ── Health status ─────────────────────────────────────────────────
function getStatus() {
    const log = _loadLog();
    const byType = {};

    for (const entry of log) {
        if (!byType[entry.taskType]) {
            byType[entry.taskType] = { label: entry.label, total: 0, ok: 0, failed: 0, lastRun: null, lastError: null };
        }
        const s = byType[entry.taskType];
        s.total++;
        if (entry.ok) s.ok++; else { s.failed++; s.lastError = entry.error; }
        if (!s.lastRun || entry.ts > s.lastRun) s.lastRun = entry.ts;
    }

    return {
        n8nBase:    N8N_BASE,
        workflows:  byType,
        logEntries: log.length,
    };
}

function getLog(limit = 20) {
    return _loadLog().slice(0, limit);
}

module.exports = { execute, getStatus, getLog };
