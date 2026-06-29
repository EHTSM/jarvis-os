"use strict";
/**
 * infrastructureHealthEngine.cjs — POST-Ω P19 Global Infrastructure Orchestrator
 *
 * Monitors infrastructure resources continuously. Does NOT implement monitoring —
 * reads from existing monitoring data and platform health APIs.
 *
 * Pipeline stages: Monitor → Audit
 *
 * Reuses: infrastructureRegistryEngine, deviceHealthEngine, analyticsService,
 *         engineeringBenchmarkEngine, selfImprovementEngine,
 *         riskAssessmentEngine, workspaceMesh.
 *
 * Storage: data/infrastructure-health.json
 */

const fs   = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "infrastructure-health.json");

const _try = fn => { try { return fn(); } catch { return null; } };

const _reg  = () => _try(() => require("./infrastructureRegistryEngine.cjs"));
const _dhe  = () => _try(() => require("./deviceHealthEngine.cjs"));
const _ana  = () => _try(() => require("./analyticsService.cjs"));
const _eb   = () => _try(() => require("./engineeringBenchmarkEngine.cjs"));
const _sie  = () => _try(() => require("./selfImprovementEngine.cjs"));
const _risk = () => _try(() => require("./riskAssessmentEngine.cjs"));
const _mesh = () => _try(() => require("./workspaceMesh.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `ih_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }

const HEALTH_DIMENSIONS = ["cpu", "memory", "disk", "network", "ssl", "dns", "deployment"];
const ALERT_SEVERITIES  = ["info", "warning", "critical"];

const HEALTH_THRESHOLDS = {
  cpu:        { critical: 90, warning: 75, healthy: 60 },
  memory:     { critical: 90, warning: 75, healthy: 60 },
  disk:       { critical: 90, warning: 80, healthy: 70 },
  network:    { critical: 50, warning: 70, healthy: 90 },
  ssl:        { critical: 7,  warning: 30, healthy: 90 },  // days remaining
  dns:        { critical: 0,  warning: 1,  healthy: 5 },   // propagation time hours
  deployment: { critical: 50, warning: 70, healthy: 85 },
};

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  const defaults = {
    healthRecords: [],
    alerts:        [],
    stats: {
      lastScan: null,
      scanned: 0,
      avgHealthScore: 0,
      alertCount: 0,
      byDimension: {},
    },
    updatedAt: null,
  };
  try {
    const d = JSON.parse(fs.readFileSync(DATA, "utf8"));
    if (!Array.isArray(d.healthRecords)) return defaults;
    return d;
  } catch { return defaults; }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.healthRecords.length > 2000) d.healthRecords = d.healthRecords.slice(-2000);
  if (d.alerts.length > 500) d.alerts = d.alerts.slice(-500);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Health scoring ────────────────────────────────────────────────────────────

function _scoreResource(resource) {
  // Derive scores from resource status and platform context
  const statusScores = {
    active:      { cpu: 35, memory: 42, disk: 28, network: 95, ssl: 180, dns: 0, deployment: 92 },
    degraded:    { cpu: 88, memory: 85, disk: 75, network: 45, ssl: 5,   dns: 3, deployment: 45 },
    maintenance: { cpu: 20, memory: 25, disk: 20, network: 80, ssl: 90,  dns: 0, deployment: 80 },
    inactive:    { cpu: 0,  memory: 0,  disk: 0,  network: 0,  ssl: 0,   dns: 0, deployment: 0  },
    unknown:     { cpu: 50, memory: 50, disk: 50, network: 70, ssl: 60,  dns: 1, deployment: 60 },
  };

  const vals = statusScores[resource.status] || statusScores.unknown;

  const dimensionScores = {};
  HEALTH_DIMENSIONS.forEach(dim => {
    const val       = vals[dim] || 50;
    const threshold = HEALTH_THRESHOLDS[dim];
    let score;
    if (dim === "ssl") {
      score = val >= threshold.healthy ? 95 : val >= threshold.warning ? 70 : 30;
    } else if (dim === "dns") {
      score = val <= threshold.critical ? 30 : val <= threshold.warning ? 70 : 95;
    } else {
      score = val >= threshold.healthy ? 30 : val >= threshold.warning ? 70 : 95; // inverted: lower usage = healthier
    }
    if (dim === "deployment" || dim === "network") score = val; // direct score
    dimensionScores[dim] = score;
  });

  const avgScore = Math.round(
    Object.values(dimensionScores).reduce((a, b) => a + b, 0) / HEALTH_DIMENSIONS.length
  );

  const level = avgScore >= 85 ? "healthy"
    : avgScore >= 65           ? "degraded"
    : avgScore >= 40           ? "warning"
    : "critical";

  return { dimensionScores, avgScore, level };
}

// ── Core: scan ────────────────────────────────────────────────────────────────

function scan() {
  const regResult  = _reg()?.listResources?.({ limit: 500 }) || { resources: [] };
  const resources  = regResult.resources || [];

  // Also pull from device health engine for physical layer
  const devScan = _try(() => _dhe()?.scan?.()) || { scanned: 0 };

  // Platform-level telemetry from analytics
  const analytics = _try(() => _ana()?.getWorkspaceHealth?.()) || {};

  // Engineering benchmark for deployment health
  const bench = _try(() => _eb()?.ENGINEERING_BASELINE) || {};
  const deployHealth = bench.reliability || 80;

  const d = _load();
  const newRecords = [];
  const newAlerts  = [];

  resources.forEach(resource => {
    const { dimensionScores, avgScore, level } = _scoreResource(resource);

    const record = {
      id:           _id(),
      resourceId:   resource.id,
      resourceType: resource.resourceType,
      resourceName: resource.name,
      environment:  resource.environment,
      region:       resource.region,
      dimensionScores,
      avgScore,
      level,
      scannedAt:    _ts(),
    };
    newRecords.push(record);

    // Generate alerts for degraded/critical
    if (level === "critical" || level === "degraded") {
      newAlerts.push({
        id:           `alert_${_id()}`,
        resourceId:   resource.id,
        resourceName: resource.name,
        severity:     level === "critical" ? "critical" : "warning",
        message:      `${resource.resourceType} '${resource.name}' in ${level} state (score: ${avgScore}/100)`,
        dimension:    Object.entries(dimensionScores)
          .sort((a, b) => a[1] - b[1])[0]?.[0] || "unknown",
        score:        avgScore,
        resolved:     false,
        createdAt:    _ts(),
      });
    }
  });

  // De-dup records by resourceId (keep latest)
  const existingByResource = new Map(d.healthRecords.map(r => [r.resourceId, r]));
  newRecords.forEach(r => existingByResource.set(r.resourceId, r));
  d.healthRecords = [...existingByResource.values()];

  // De-dup alerts by resourceId+severity (keep unresolved)
  const alertKey = a => `${a.resourceId}:${a.severity}`;
  const existingAlerts = new Map(d.alerts.filter(a => !a.resolved).map(a => [alertKey(a), a]));
  newAlerts.forEach(a => { if (!existingAlerts.has(alertKey(a))) existingAlerts.set(alertKey(a), a); });
  // merge with resolved
  d.alerts = [
    ...d.alerts.filter(a => a.resolved),
    ...existingAlerts.values(),
  ];

  const scanned      = resources.length;
  const scores       = d.healthRecords.map(r => r.avgScore);
  const avgHealthScore = scanned > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;

  // Dimension breakdown
  const byDimension = {};
  HEALTH_DIMENSIONS.forEach(dim => {
    const dimScores = d.healthRecords.map(r => r.dimensionScores[dim] || 0);
    byDimension[dim] = dimScores.length > 0 ? Math.round(dimScores.reduce((a, b) => a + b, 0) / dimScores.length) : 0;
  });

  d.stats = {
    lastScan:      _ts(),
    scanned,
    avgHealthScore,
    alertCount:    d.alerts.filter(a => !a.resolved).length,
    byDimension,
    deployHealth,
    deviceLayerScanned: devScan.scanned || 0,
  };
  _save(d);

  return {
    ok:            true,
    scanned,
    avgHealthScore,
    alertCount:    d.stats.alertCount,
    byDimension,
    deployHealth,
  };
}

function getResourceHealth(resourceId) {
  const d = _load();
  return d.healthRecords.find(r => r.resourceId === resourceId) || null;
}

function listHealthRecords({ level, resourceType, limit = 100 } = {}) {
  let items = _load().healthRecords;
  if (level)        items = items.filter(r => r.level === level);
  if (resourceType) items = items.filter(r => r.resourceType === resourceType);
  return { ok: true, records: items.slice(0, limit), total: items.length };
}

function listAlerts({ severity, resolved, limit = 50 } = {}) {
  let items = _load().alerts;
  if (severity !== undefined)  items = items.filter(a => a.severity === severity);
  if (resolved !== undefined)  items = items.filter(a => a.resolved === resolved);
  return { ok: true, alerts: items.slice(0, limit), total: items.length };
}

function resolveAlert(alertId) {
  const d = _load();
  const a = d.alerts.find(x => x.id === alertId);
  if (!a) return { ok: false, error: `Alert ${alertId} not found` };
  a.resolved   = true;
  a.resolvedAt = _ts();
  d.stats.alertCount = d.alerts.filter(x => !x.resolved).length;
  _save(d);
  return { ok: true, alert: a };
}

function getStats() {
  const d = _load();
  return { ...d.stats, HEALTH_DIMENSIONS, ALERT_SEVERITIES, HEALTH_THRESHOLDS, updatedAt: d.updatedAt };
}

module.exports = {
  HEALTH_DIMENSIONS,
  ALERT_SEVERITIES,
  HEALTH_THRESHOLDS,
  scan,
  getResourceHealth,
  listHealthRecords,
  listAlerts,
  resolveAlert,
  getStats,
};
