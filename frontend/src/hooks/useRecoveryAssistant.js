// Phase 264: Autonomous recovery assistant.
// Detects runtime instability from friction/history, proposes ranked recovery plans,
// estimates recovery confidence. All local — no external calls.

const HIST_KEY    = "jarvis_workflow_hist";
const FRICTION_KEY = "jarvis_friction_signals";

// Phase 264: instability signals — scored severity
function _getInstabilitySignals() {
  try {
    const friction = JSON.parse(localStorage.getItem(FRICTION_KEY) || "[]");
    const hist     = JSON.parse(localStorage.getItem(HIST_KEY) || "[]");
    const now      = Date.now();
    const recent10m = friction.filter(e => now - e.ts < 10 * 60 * 1000);
    const recent30m = friction.filter(e => now - e.ts < 30 * 60 * 1000);

    const signals = [];

    const reconnects = recent10m.filter(e => e.type === "reconnect_event" || e.type === "reconnect_during_input").length;
    if (reconnects >= 3) signals.push({ id: "reconnect_storm",  severity: "high",   label: "Reconnect storm detected",        count: reconnects });
    else if (reconnects >= 1) signals.push({ id: "reconnect_noise", severity: "medium", label: "Intermittent reconnects",     count: reconnects });

    const crashes = recent30m.filter(e => e.type === "crash" || e.type === "startup_corruption").length;
    if (crashes >= 1) signals.push({ id: "crash_detected", severity: "high", label: "Crash events in recent history", count: crashes });

    const recentFails = hist.filter(h => !h.ok && now - (h.ts || 0) < 15 * 60 * 1000).length;
    if (recentFails >= 5) signals.push({ id: "failure_spike",  severity: "high",   label: "High dispatch failure rate",    count: recentFails });
    else if (recentFails >= 2) signals.push({ id: "failure_noise", severity: "medium", label: "Elevated dispatch failures", count: recentFails });

    const hesitations = recent10m.filter(e => e.type === "hesitation" || e.type === "abandonment").length;
    if (hesitations >= 4) signals.push({ id: "operator_friction", severity: "medium", label: "Operator confusion pattern", count: hesitations });

    const startupCorruption = friction.find(e => e.type === "startup_corruption");
    if (startupCorruption) signals.push({ id: "startup_corruption", severity: "high", label: "Startup state corruption detected" });

    return signals;
  } catch { return []; }
}

// Phase 264: recovery plan generator — maps instability signals to ranked action plans
function _buildRecoveryPlan(signals) {
  const plans = [];

  signals.forEach(sig => {
    switch (sig.id) {
      case "reconnect_storm":
        plans.push({
          id: "restart_backend",
          action: "Restart the backend",
          cmd: "pm2 restart jarvis-backend",
          confidence: 80,
          reason: "Reconnect storms usually clear after a clean backend restart",
          risk: "low",
        });
        plans.push({
          id: "force_refresh",
          action: "Force-refresh the stream",
          cmd: null, // UI action
          actionKey: "forceRefresh",
          confidence: 60,
          reason: "Refreshes the SSE connection without restarting the server",
          risk: "none",
        });
        break;
      case "reconnect_noise":
        plans.push({
          id: "check_health",
          action: "Check backend health",
          cmd: "pm2 list",
          confidence: 70,
          reason: "Confirm the backend process is online before investigating further",
          risk: "none",
        });
        break;
      case "crash_detected":
        plans.push({
          id: "tail_logs",
          action: "Inspect crash logs",
          cmd: "pm2 logs jarvis-backend --lines 50 --noprefix",
          confidence: 85,
          reason: "Crash logs usually contain the root cause within the last 50 lines",
          risk: "none",
        });
        plans.push({
          id: "restart_clean",
          action: "Clean restart",
          cmd: "pm2 restart jarvis-backend",
          confidence: 70,
          reason: "A clean restart clears transient crash state",
          risk: "low",
        });
        break;
      case "failure_spike":
        plans.push({
          id: "check_queue",
          action: "Check queue pressure",
          cmd: "npm run check-health",
          confidence: 75,
          reason: "High failure rates often coincide with queue overflow",
          risk: "none",
        });
        break;
      case "startup_corruption":
        plans.push({
          id: "rollback_settings",
          action: "Restore saved settings",
          cmd: null,
          actionKey: "rollback",
          confidence: 90,
          reason: "Startup corruption indicates corrupted localStorage — rollback restores last known good state",
          risk: "low",
        });
        break;
      case "operator_friction":
        plans.push({
          id: "open_help",
          action: "Open the help guide",
          cmd: null,
          actionKey: "showHelp",
          confidence: 65,
          reason: "Hesitation patterns suggest the operator may be uncertain — the guide explains common workflows",
          risk: "none",
        });
        break;
    }
  });

  // Deduplicate by id and sort by confidence descending
  const seen = new Set();
  return plans
    .filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; })
    .sort((a, b) => b.confidence - a.confidence);
}

// Phase 264: overall recovery confidence — 0–100
function _overallRecoveryConfidence(signals, plans) {
  if (!signals.length) return 100;
  const highCount = signals.filter(s => s.severity === "high").length;
  const medCount  = signals.filter(s => s.severity === "medium").length;
  const basePenalty = highCount * 20 + medCount * 8;
  const planBonus   = Math.min(20, plans.length * 5);
  return Math.max(0, Math.min(100, 100 - basePenalty + planBonus));
}

// Phase 813: Recovery dedup guard — prevents re-executing the same plan within 5 min.
// Stored in localStorage as { planId → ts }. Max 20 entries, auto-prunes on load.
const _DEDUP_KEY    = "jarvis_recovery_dedup";
const _DEDUP_TTL    = 5 * 60 * 1000;  // 5 minutes
const _DEDUP_MAX    = 20;

function _loadDedup() {
  try {
    const raw = JSON.parse(localStorage.getItem(_DEDUP_KEY) || "{}");
    const now = Date.now();
    // Prune expired entries on load
    const pruned = Object.fromEntries(
      Object.entries(raw).filter(([, ts]) => now - ts < _DEDUP_TTL)
    );
    return pruned;
  } catch { return {}; }
}

function _markExecuted(planId) {
  try {
    const dedup = _loadDedup();
    dedup[planId] = Date.now();
    // Cap at DEDUP_MAX — remove oldest when over limit
    const entries = Object.entries(dedup).sort(([, a], [, b]) => b - a);
    const capped = Object.fromEntries(entries.slice(0, _DEDUP_MAX));
    localStorage.setItem(_DEDUP_KEY, JSON.stringify(capped));
  } catch {}
}

function _wasRecentlyExecuted(planId) {
  try {
    const dedup = _loadDedup();
    const ts = dedup[planId];
    return ts && Date.now() - ts < _DEDUP_TTL;
  } catch { return false; }
}

// Phase 264: React hook
import { useState, useEffect, useCallback, useMemo } from "react";

export function useRecoveryAssistant() {
  const [signals, setSignals]     = useState([]);
  const [plan, setPlan]           = useState([]);
  const [confidence, setConf]     = useState(100);
  const [dismissed, setDismissed] = useState(false);

  const evaluate = useCallback(() => {
    const sigs  = _getInstabilitySignals();
    const plans = _buildRecoveryPlan(sigs);
    const conf  = _overallRecoveryConfidence(sigs, plans);
    setSignals(sigs);
    setPlan(plans);
    setConf(conf);
    setDismissed(false);
  }, []);

  // Evaluate on mount; re-evaluate when visibility changes (session resume)
  useEffect(() => {
    evaluate();
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  const dismiss = useCallback(() => setDismissed(true), []);

  // Phase 813: mark a plan as executed (for dedup guard)
  const markExecuted = useCallback((planId) => _markExecuted(planId), []);

  // Phase 813: filter plan to exclude recently-executed items
  const dedupedPlan = useMemo(
    () => plan.filter(p => !_wasRecentlyExecuted(p.id)),
    [plan]
  );

  const isUnstable = signals.some(s => s.severity === "high");
  const hasSignals = signals.length > 0;

  return { signals, plan: dedupedPlan, allPlan: plan, confidence, isUnstable, hasSignals, dismissed, dismiss, evaluate, markExecuted };
}
