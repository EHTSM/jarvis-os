/**
 * electron/src/api.js — stub forwarding to the canonical backend.
 * The active UI is /frontend. This file exists only so electron/src/
 * compiles without errors if accidentally started (PORT=3001).
 */

const BASE_URL = "http://localhost:5050";

function _norm(raw) {
    if (!raw) return { success: false, reply: "No response" };
    if (raw.reply !== undefined) return { success: raw.success !== false, ...raw };
    const d = raw.data || raw;
    return {
        success: d.success !== false,
        reply:   d.reply || d.message || (d.success !== false ? "Done." : d.error || "Failed"),
        intent:  d.intent || "unknown",
        mode:    d.mode   || "smart"
    };
}

export async function sendMessage(input, mode = "smart") {
    if (!input?.trim()) return { success: false, reply: "No input" };
    try {
        const res  = await fetch(`${BASE_URL}/jarvis`, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ input, mode })
        });
        return _norm(await res.json());
    } catch (err) {
        return { success: false, reply: err.message };
    }
}

export async function checkHealth() {
    try { return (await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(3000) })).ok; }
    catch { return false; }
}

export async function getEvolutionScore() {
    try { const d = await (await fetch(`${BASE_URL}/evolution/score`)).json(); return d.optimization_score ?? 50; }
    catch { return 50; }
}

export async function getSuggestions() {
    try { const d = await (await fetch(`${BASE_URL}/evolution/suggestions`)).json(); return d.suggestions || []; }
    catch { return []; }
}

export async function approveSuggestion(id) {
    try { return (await fetch(`${BASE_URL}/evolution/approve/${id}`, { method: "POST" })).json(); }
    catch (err) { return { success: false, error: err.message }; }
}

export { BASE_URL };
