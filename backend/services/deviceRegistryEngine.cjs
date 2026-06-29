"use strict";
/**
 * deviceRegistryEngine.cjs — POST-Ω P17 Physical World Integration
 *
 * Maintains: capabilities, health, ownership, firmware, location for every
 *   registered physical device across all adapter types.
 *
 * Reuses: workspaceMesh, workforceManager, knowledgeFederationEngine,
 *         autonomousExecutionEngine, capitalAllocationEngine.
 *
 * NO hardware drivers. NO vendor SDKs. Adapter-based only.
 *
 * Storage: data/device-registry.json
 */

const fs   = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "device-registry.json");

const _try = fn => { try { return fn(); } catch { return null; } };

const _wm   = () => _try(() => require("./workspaceMesh.cjs"));
const _wf   = () => _try(() => require("./workforceManager.cjs"));
const _kfe  = () => _try(() => require("./knowledgeFederationEngine.cjs"));
const _exe  = () => _try(() => require("./autonomousExecutionEngine.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `dev_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }

const ADAPTER_TYPES = [
  "iot",
  "smart_office",
  "camera",
  "sensor",
  "smart_display",
  "raspberry_pi",
  "plc",
  "mqtt",
  "rest_device",
  "webhook",
  "generic_robotics",
];

const DEVICE_STATUSES = ["online", "offline", "degraded", "maintenance", "unverified"];

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  const defaults = {
    devices: [],
    stats: { total: 0, byAdapter: {}, byStatus: {}, online: 0, offline: 0 },
    updatedAt: null,
  };
  try {
    const d = JSON.parse(fs.readFileSync(DATA, "utf8"));
    if (!Array.isArray(d.devices)) return defaults;
    return d;
  } catch { return defaults; }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.devices.length > 5000) d.devices = d.devices.slice(-5000);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

function _recomputeStats(d) {
  const byAdapter = {};
  ADAPTER_TYPES.forEach(a => { byAdapter[a] = 0; });
  const byStatus = {};
  DEVICE_STATUSES.forEach(s => { byStatus[s] = 0; });
  d.devices.forEach(dev => {
    if (byAdapter[dev.adapterType] !== undefined) byAdapter[dev.adapterType]++;
    if (byStatus[dev.status] !== undefined) byStatus[dev.status]++;
  });
  d.stats = {
    total:   d.devices.length,
    byAdapter,
    byStatus,
    online:  byStatus.online  || 0,
    offline: byStatus.offline || 0,
  };
}

// ── Core: register ────────────────────────────────────────────────────────────

function register(spec = {}) {
  if (!spec.adapterType || !ADAPTER_TYPES.includes(spec.adapterType)) {
    return { ok: false, error: `adapterType required. Valid: ${ADAPTER_TYPES.join(", ")}` };
  }

  const device = {
    id:           spec.id || _id(),
    name:         spec.name || `${spec.adapterType}-${Date.now()}`,
    adapterType:  spec.adapterType,
    status:       spec.status || "unverified",
    capabilities: spec.capabilities || [],
    location:     spec.location     || null,
    ownership:    spec.ownership     || null,
    firmware:     spec.firmware      || null,
    endpoint:     spec.endpoint      || null,
    meta:         spec.meta          || {},
    healthScore:  100,
    registeredAt: _ts(),
    lastSeenAt:   _ts(),
  };

  const d = _load();
  // De-dup by id
  const idx = d.devices.findIndex(dv => dv.id === device.id);
  if (idx >= 0) {
    d.devices[idx] = { ...d.devices[idx], ...device, lastSeenAt: _ts() };
  } else {
    d.devices.push(device);
  }
  _recomputeStats(d);
  _save(d);

  return { ok: true, device };
}

function verify(id) {
  const d = _load();
  const dev = d.devices.find(dv => dv.id === id);
  if (!dev) return { ok: false, error: "device not found" };
  dev.status    = "online";
  dev.verifiedAt = _ts();
  _recomputeStats(d);
  _save(d);
  return { ok: true, device: dev };
}

function updateStatus(id, status) {
  if (!DEVICE_STATUSES.includes(status)) return { ok: false, error: `invalid status: ${status}` };
  const d = _load();
  const dev = d.devices.find(dv => dv.id === id);
  if (!dev) return { ok: false, error: "device not found" };
  dev.status     = status;
  dev.lastSeenAt = _ts();
  _recomputeStats(d);
  _save(d);
  return { ok: true, device: dev };
}

function getDevice(id) {
  return _load().devices.find(d => d.id === id) || null;
}

function listDevices({ adapterType, status, limit = 100 } = {}) {
  let devs = _load().devices;
  if (adapterType) devs = devs.filter(d => d.adapterType === adapterType);
  if (status)      devs = devs.filter(d => d.status === status);
  return { ok: true, devices: devs.slice(0, limit), total: devs.length };
}

function deregister(id) {
  const d = _load();
  const before = d.devices.length;
  d.devices = d.devices.filter(dv => dv.id !== id);
  if (d.devices.length === before) return { ok: false, error: "device not found" };
  _recomputeStats(d);
  _save(d);
  return { ok: true, removed: id };
}

function getStats() {
  const d = _load();
  return { ...d.stats, ADAPTER_TYPES, DEVICE_STATUSES, updatedAt: d.updatedAt };
}

module.exports = {
  ADAPTER_TYPES,
  DEVICE_STATUSES,
  register,
  verify,
  updateStatus,
  getDevice,
  listDevices,
  deregister,
  getStats,
};
