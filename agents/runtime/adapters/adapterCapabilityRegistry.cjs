"use strict";

// Capability discovery and routing registry for execution adapters.
// Maps capabilities to adapter instances and provides selection logic.

const MAX_ADAPTERS = 100;

const KNOWN_CAPABILITIES = new Set([
  "terminal_exec", "filesystem_read", "filesystem_write", "git_read", "git_write",
  "vscode_open", "vscode_command", "browser_navigate", "browser_interact",
  "process_spawn", "process_track", "process_kill",
  "log_stream", "health_report", "sandbox_eval",
]);

let _counter  = 0;
let _adapters = new Map();   // adapterId → manifest record
let _byCapability = new Map(); // capability → Set<adapterId>

function registerAdapter(adapterId, {
  adapterType,
  capabilities = [],
  version       = "1.0.0",
  sandboxed     = true,
  writeAllowed  = false,
  metadata      = {},
} = {}) {
  if (!adapterId) return { registered: false, reason: "missing_adapter_id" };
  if (!adapterType) return { registered: false, reason: "missing_adapter_type" };
  if (_adapters.size >= MAX_ADAPTERS) return { registered: false, reason: "adapter_limit_reached" };
  if (_adapters.has(adapterId)) return { registered: false, reason: "already_registered" };

  const manifest = Object.freeze({
    adapterId, adapterType, capabilities: [...capabilities],
    version, sandboxed, writeAllowed,
    metadata:     Object.freeze({ ...metadata }),
    registeredAt: new Date().toISOString(),
    registrationId: `reg-${++_counter}`,
  });
  _adapters.set(adapterId, manifest);

  // Index by capability
  for (const cap of capabilities) {
    if (!_byCapability.has(cap)) _byCapability.set(cap, new Set());
    _byCapability.get(cap).add(adapterId);
  }

  return { registered: true, adapterId, adapterType, capabilityCount: capabilities.length };
}

function deregisterAdapter(adapterId) {
  const manifest = _adapters.get(adapterId);
  if (!manifest) return { deregistered: false, reason: "adapter_not_found" };

  // Remove from capability index
  for (const cap of manifest.capabilities) {
    _byCapability.get(cap)?.delete(adapterId);
  }
  _adapters.delete(adapterId);
  return { deregistered: true, adapterId };
}

// Find all adapters that have a given capability
function findCapable(capability, { requireSandboxed = false, requireWriteAllowed = false } = {}) {
  const ids = _byCapability.get(capability);
  if (!ids || ids.size === 0) return [];
  return Array.from(ids)
    .map(id => _adapters.get(id))
    .filter(m => m
      && (!requireSandboxed  || m.sandboxed)
      && (!requireWriteAllowed || m.writeAllowed)
    )
    .map(m => ({ adapterId: m.adapterId, adapterType: m.adapterType, version: m.version }));
}

// Find best adapter for capability (first registered wins; can extend with priority later)
function selectAdapter(capability, options = {}) {
  const candidates = findCapable(capability, options);
  if (candidates.length === 0) return { found: false, reason: "no_capable_adapter" };
  return { found: true, adapter: candidates[0] };
}

function getAdapterManifest(adapterId) {
  const m = _adapters.get(adapterId);
  if (!m) return { found: false };
  return { found: true, ...m };
}

function listCapabilities(adapterId) {
  const m = _adapters.get(adapterId);
  if (!m) return { found: false };
  return { found: true, adapterId, capabilities: [...m.capabilities] };
}

function listAdapters() {
  return Array.from(_adapters.values()).map(m => ({
    adapterId:   m.adapterId,
    adapterType: m.adapterType,
    capabilities: m.capabilities,
    sandboxed:   m.sandboxed,
  }));
}

// Check if a specific capability exists anywhere in the registry
function hasCapability(capability) {
  const ids = _byCapability.get(capability);
  return { exists: ids ? ids.size > 0 : false, capability, adapterCount: ids?.size ?? 0 };
}

function addCapability(adapterId, capability) {
  const m = _adapters.get(adapterId);
  if (!m) return { added: false, reason: "adapter_not_found" };
  // Manifests are frozen — update the capabilities set separately via _byCapability
  if (!_byCapability.has(capability)) _byCapability.set(capability, new Set());
  _byCapability.get(capability).add(adapterId);
  return { added: true, adapterId, capability };
}

function getRegistryMetrics() {
  const byType = {};
  for (const [, m] of _adapters) byType[m.adapterType] = (byType[m.adapterType] ?? 0) + 1;
  return {
    totalAdapters:      _adapters.size,
    totalCapabilities:  _byCapability.size,
    byAdapterType:      byType,
    knownCapabilities:  KNOWN_CAPABILITIES.size,
  };
}

function reset() {
  _counter      = 0;
  _adapters     = new Map();
  _byCapability = new Map();
}

module.exports = {
  registerAdapter, deregisterAdapter, findCapable, selectAdapter,
  getAdapterManifest, listCapabilities, listAdapters, hasCapability,
  addCapability, getRegistryMetrics, reset,
  KNOWN_CAPABILITIES: Array.from(KNOWN_CAPABILITIES),
};
