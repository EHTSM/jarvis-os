import { _fetch } from "./_client";

// ── Missions ──────────────────────────────────────────────────────────
export async function getMissions()                   { return _fetch("/p27/missions"); }
export async function getMission(id)                  { return _fetch(`/p27/missions/${id}`); }
export async function getMissionStats()               { return _fetch("/p27/missions/stats"); }
export async function createMission(payload)          { return _fetch("/p27/missions", { method: "POST", body: JSON.stringify(payload) }); }
export async function updateMission(id, payload)      { return _fetch(`/p27/missions/${id}`, { method: "PATCH", body: JSON.stringify(payload) }); }
export async function getMissionReplay(id)            { return _fetch(`/p27/missions/${id}/replay`); }
export async function addMissionSubtask(id, payload)  { return _fetch(`/p27/missions/${id}/subtasks`, { method: "POST", body: JSON.stringify(payload) }); }
export async function addMissionDecision(id, payload) { return _fetch(`/p27/missions/${id}/decisions`, { method: "POST", body: JSON.stringify(payload) }); }
export async function addMissionArtifact(id, payload) { return _fetch(`/p27/missions/${id}/artifacts`, { method: "POST", body: JSON.stringify(payload) }); }
export async function addMissionFailure(id, payload)  { return _fetch(`/p27/missions/${id}/failures`, { method: "POST", body: JSON.stringify(payload) }); }
export async function addMissionLearning(id, payload) { return _fetch(`/p27/missions/${id}/learnings`, { method: "POST", body: JSON.stringify(payload) }); }

// ── Executive ─────────────────────────────────────────────────────────
export async function getExecutiveDecisions()         { return _fetch("/p27/executive/decisions"); }
export async function getExecutiveDecision(id)        { return _fetch(`/p27/executive/decisions/${id}`); }
export async function prioritize(payload)             { return _fetch("/p27/executive/prioritize", { method: "POST", body: JSON.stringify(payload) }); }
export async function compareOptions(payload)         { return _fetch("/p27/executive/compare", { method: "POST", body: JSON.stringify(payload) }); }
export async function estimateEffort(payload)         { return _fetch("/p27/executive/estimate", { method: "POST", body: JSON.stringify(payload) }); }
export async function chooseOption(payload)           { return _fetch("/p27/executive/choose", { method: "POST", body: JSON.stringify(payload) }); }
export async function assessRisk(payload)             { return _fetch("/p27/executive/risk", { method: "POST", body: JSON.stringify(payload) }); }

// ── Planning ──────────────────────────────────────────────────────────
export async function getPlanningHorizons()           { return _fetch("/p27/planning/horizons"); }
export async function getPlanningHorizon(horizon)     { return _fetch(`/p27/planning/horizons/${horizon}`); }
export async function refreshHorizon(horizon)         { return _fetch(`/p27/planning/horizons/${horizon}/refresh`, { method: "POST" }); }
export async function getPlanningRecommend()          { return _fetch("/p27/planning/recommend"); }
export async function getPlanningStats()              { return _fetch("/p27/planning/stats"); }
export async function completeObjective(id)           { return _fetch(`/p27/planning/objectives/${id}/complete`, { method: "POST" }); }

// ── AI Routing ────────────────────────────────────────────────────────
export async function getAiProviders()                { return _fetch("/p27/ai/providers"); }
export async function routeAi(payload)                { return _fetch("/p27/ai/route", { method: "POST", body: JSON.stringify(payload) }); }
export async function aiChat(payload)                 { return _fetch("/p27/ai/chat", { method: "POST", body: JSON.stringify(payload) }); }

// ── Self-Improvement ──────────────────────────────────────────────────
export async function getImprovementMetrics()         { return _fetch("/p27/improvement/metrics"); }
export async function getImprovementReports()         { return _fetch("/p27/improvement/reports"); }
export async function getLatestImprovementReport()    { return _fetch("/p27/improvement/reports/latest"); }
export async function runImprovementReport(payload)   { return _fetch("/p27/improvement/report", { method: "POST", body: JSON.stringify(payload || {}) }); }
export async function getImprovementHistory()         { return _fetch("/p27/improvement/history"); }
export async function addImprovementOverride(payload) { return _fetch("/p27/improvement/overrides", { method: "POST", body: JSON.stringify(payload) }); }
export async function recordOutcome(payload)          { return _fetch("/p27/improvement/outcomes", { method: "POST", body: JSON.stringify(payload) }); }
