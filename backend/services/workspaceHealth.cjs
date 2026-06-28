"use strict";
/**
 * workspaceHealth.cjs — POST-Ω Sprint P9 Autonomous Workspace Mesh
 *
 * Monitors health of every workspace in the mesh:
 *   - heartbeat tracking (last seen / latency)
 *   - health scoring (0-100) per workspace
 *   - bottleneck detection
 *   - alert generation for degraded / failed workspaces
 *   - automated recovery triggers via workspaceCoordinator
 *
 * Reuses: workspaceRegistry, workspaceSynchronization, missionMemory.
 *
 * Storage: data/workspace-health.json
 */

const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "workspace-health.json");

const _try = fn => { try { return fn(); } catch { return null; } };
const _wr  = () => _try(() => require("./workspaceRegistry.cjs"));
const _mm  = () => _try(() => require("./missionMemory.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `health_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`; }

// Health thresholds
const HEALTHY_THRESHOLD    = 80;
const DEGRADED_THRESHOLD   = 50;
const HEARTBEAT_STALE_MS   = 5 * 60 * 1000;   // 5 min
const HEARTBEAT_DEAD_MS    = 15 * 60 * 1000;   // 15 min

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch {
    return {
      checks:  [],   // last 1000 health checks
      alerts:  [],   // last 200 alerts
      metrics: {},   // workspaceId → rolling metrics
      stats:   { checksRun: 0, alertsGenerated: 0, recoveryTriggered: 0 },
      updatedAt: null,
    };
  }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.checks.length > 1000) d.checks = d.checks.slice(-1000);
  if (d.alerts.length > 200)  d.alerts = d.alerts.slice(-200);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Health score calculation ──────────────────────────────────────────────────

function _calcHealthScore(ws, metrics) {
  let score = 100;

  // Recency penalty
  const lastSeen = ws.lastSeen ? Date.now() - new Date(ws.lastSeen).getTime() : Infinity;
  if (lastSeen > HEARTBEAT_DEAD_MS)   score -= 60;
  else if (lastSeen > HEARTBEAT_STALE_MS) score -= 25;

  // Error rate penalty (from rolling metrics)
  const m = metrics || {};
  if (m.errorRate !== undefined) score -= Math.round(m.errorRate * 30);

  // Latency penalty
  if (m.avgLatencyMs !== undefined) {
    if (m.avgLatencyMs > 5000) score -= 20;
    else if (m.avgLatencyMs > 2000) score -= 10;
  }

  // Mission load penalty
  const missionCount = (ws.missions || []).length;
  if (missionCount > 10) score -= 15;
  else if (missionCount > 5) score -= 5;

  return Math.max(0, Math.min(100, score));
}

// ── Heartbeat ─────────────────────────────────────────────────────────────────

function heartbeat(workspaceId, { latencyMs, metadata = {} } = {}) {
  const ws = _wr()?.get?.(workspaceId);
  if (!ws) return { ok: false, error: "workspace not found" };

  const d = _load();

  // Update rolling metrics
  if (!d.metrics[workspaceId]) d.metrics[workspaceId] = { latencies: [], errors: 0, pings: 0 };
  const m = d.metrics[workspaceId];
  m.pings++;
  if (latencyMs !== undefined) {
    m.latencies.push(latencyMs);
    if (m.latencies.length > 20) m.latencies = m.latencies.slice(-20);
    m.avgLatencyMs = Math.round(m.latencies.reduce((a, b) => a + b, 0) / m.latencies.length);
  }
  m.errorRate = metadata.errorRate || 0;
  m.lastPing  = _ts();

  const score = _calcHealthScore(ws, m);

  d.checks.push({ id: _id(), workspaceId, workspaceType: ws.type, score, latencyMs, ts: _ts() });
  d.stats.checksRun++;

  // Update registry health
  _wr()?.setStatus?.(workspaceId, score < DEGRADED_THRESHOLD ? "degraded" : "active", score);

  // Alert if health dropped below degraded threshold
  if (score < DEGRADED_THRESHOLD) {
    const alert = {
      id: _id(), workspaceId, workspaceType: ws.type,
      severity: score < 20 ? "critical" : "warning",
      message:  `Workspace ${ws.label} (${ws.type}) health dropped to ${score}`,
      score, ts: _ts(), acknowledged: false,
    };
    d.alerts.push(alert);
    d.stats.alertsGenerated++;
  }

  _save(d);
  return { ok: true, workspaceId, score, status: score >= HEALTHY_THRESHOLD ? "healthy" : score >= DEGRADED_THRESHOLD ? "degraded" : "critical" };
}

// ── Full mesh health check ────────────────────────────────────────────────────

function checkMesh() {
  const workspaces = _wr()?.list?.() || [];
  const d = _load();
  const results = [];

  for (const ws of workspaces) {
    const m     = d.metrics[ws.id] || {};
    const score = _calcHealthScore(ws, m);

    // Auto-mark failed if no heartbeat for 15 min and was active
    const lastSeen = ws.lastSeen ? Date.now() - new Date(ws.lastSeen).getTime() : Infinity;
    if (lastSeen > HEARTBEAT_DEAD_MS && ws.status === "active") {
      _wr()?.setStatus?.(ws.id, "failed", 0);
    }

    results.push({
      workspaceId: ws.id, type: ws.type, label: ws.label,
      status: ws.status, score, category: ws.category,
    });
  }

  return {
    ok:      true,
    healthy: results.filter(r => r.score >= HEALTHY_THRESHOLD).length,
    degraded:results.filter(r => r.score >= DEGRADED_THRESHOLD && r.score < HEALTHY_THRESHOLD).length,
    critical:results.filter(r => r.score < DEGRADED_THRESHOLD).length,
    total:   results.length,
    workspaces: results,
  };
}

// ── Bottleneck detection ──────────────────────────────────────────────────────

function detectBottlenecks() {
  const workspaces = _wr()?.list?.({ status: "active" }) || [];
  const d = _load();
  const bottlenecks = [];

  for (const ws of workspaces) {
    const m = d.metrics[ws.id] || {};
    const missionCount = (ws.missions || []).length;

    // High mission load
    if (missionCount > 8) {
      bottlenecks.push({ workspaceId: ws.id, type: ws.type, label: ws.label, kind: "high_mission_load", missionCount });
    }
    // High latency
    if (m.avgLatencyMs > 3000) {
      bottlenecks.push({ workspaceId: ws.id, type: ws.type, label: ws.label, kind: "high_latency", avgLatencyMs: m.avgLatencyMs });
    }
    // High error rate
    if (m.errorRate > 0.3) {
      bottlenecks.push({ workspaceId: ws.id, type: ws.type, label: ws.label, kind: "high_error_rate", errorRate: m.errorRate });
    }
  }

  return { ok: true, bottlenecks, count: bottlenecks.length };
}

// ── Alert management ──────────────────────────────────────────────────────────

function getAlerts({ severity, acknowledged, limit = 50 } = {}) {
  let alerts = _load().alerts;
  if (severity !== undefined)     alerts = alerts.filter(a => a.severity === severity);
  if (acknowledged !== undefined) alerts = alerts.filter(a => a.acknowledged === acknowledged);
  return { ok: true, alerts: alerts.slice(-limit) };
}

function acknowledgeAlert(alertId) {
  const d = _load();
  const a = d.alerts.find(x => x.id === alertId);
  if (!a) return { ok: false, error: "alert not found" };
  a.acknowledged = true;
  a.acknowledgedAt = _ts();
  _save(d);
  return { ok: true };
}

// ── Workspace-level metrics ───────────────────────────────────────────────────

function getWorkspaceMetrics(workspaceId) {
  const d  = _load();
  const ws = _wr()?.get?.(workspaceId);
  if (!ws) return { ok: false, error: "workspace not found" };
  const m  = d.metrics[workspaceId] || {};
  const score = _calcHealthScore(ws, m);
  const recentChecks = d.checks.filter(c => c.workspaceId === workspaceId).slice(-10);
  return { ok: true, workspaceId, workspaceType: ws.type, label: ws.label, score, metrics: m, recentChecks };
}

function getStats() {
  const d = _load();
  return {
    ...d.stats,
    trackedWorkspaces: Object.keys(d.metrics).length,
    openAlerts:   d.alerts.filter(a => !a.acknowledged).length,
    updatedAt:    d.updatedAt,
  };
}

module.exports = {
  HEALTHY_THRESHOLD,
  DEGRADED_THRESHOLD,
  heartbeat,
  checkMesh,
  detectBottlenecks,
  getAlerts,
  acknowledgeAlert,
  getWorkspaceMetrics,
  getStats,
};
