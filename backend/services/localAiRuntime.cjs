"use strict";
/**
 * Local AI Runtime — Ollama, LM Studio auto-discovery, model health, GPU/CPU status.
 *
 * Discovery: polls well-known local ports, no external deps.
 * State: data/local-ai-runtime.json
 */

const fs    = require("fs");
const path  = require("path");
const http  = require("http");
const logger = require("../utils/logger");

const STATE_FILE = path.join(__dirname, "../../data/local-ai-runtime.json");

const RUNTIMES = {
  ollama:   { id: "ollama",   name: "Ollama",    port: 11434, pathModels: "/api/tags",    pathGen: "/api/generate",    website: "https://ollama.com"    },
  lmstudio: { id: "lmstudio", name: "LM Studio", port: 1234,  pathModels: "/v1/models",   pathGen: "/v1/chat/completions", website: "https://lmstudio.ai" },
};

function _load() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); }
  catch { return {}; }
}

function _save(d) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(d, null, 2));
  } catch { /* non-fatal */ }
}

function _httpGet(port, path_, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: "127.0.0.1", port, path: path_, timeout: timeoutMs }, res => {
      let data = "";
      res.on("data", c => { data += c; });
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
  });
}

/**
 * Probe a single runtime and return its status.
 */
async function probeRuntime(runtimeId) {
  const rt = RUNTIMES[runtimeId];
  if (!rt) return null;
  const ts = new Date().toISOString();
  try {
    const resp = await _httpGet(rt.port, rt.pathModels, 2000);
    if (resp.status !== 200) return { id: runtimeId, name: rt.name, running: false, ts };

    // Parse model list
    let models = [];
    if (runtimeId === "ollama" && resp.body?.models) {
      models = resp.body.models.map(m => ({
        id:   m.name,
        name: m.name,
        size: m.size,
        modified: m.modified_at,
        details: m.details,
      }));
    } else if (runtimeId === "lmstudio" && resp.body?.data) {
      models = resp.body.data.map(m => ({ id: m.id, name: m.id }));
    }

    return { id: runtimeId, name: rt.name, running: true, port: rt.port, models, ts };
  } catch {
    return { id: runtimeId, name: rt.name, running: false, port: rt.port, models: [], ts };
  }
}

/**
 * Discover all local runtimes. Returns array of runtime status.
 */
async function discover() {
  const results = await Promise.all(Object.keys(RUNTIMES).map(probeRuntime));
  const state = _load();
  for (const r of results) {
    if (r) state[r.id] = r;
  }
  _save(state);
  return results.filter(Boolean);
}

/**
 * Get cached runtime state (no network call).
 */
function getCached() {
  const state = _load();
  return Object.values(RUNTIMES).map(rt => ({
    ...rt,
    ...(state[rt.id] || { running: false, models: [] }),
  }));
}

/**
 * List installed models across all running runtimes.
 */
async function listModels() {
  const runtimes = await discover();
  const models = [];
  for (const rt of runtimes) {
    if (!rt.running) continue;
    for (const m of (rt.models || [])) {
      models.push({ ...m, runtimeId: rt.id, runtimeName: rt.name });
    }
  }
  return models;
}

/**
 * Estimate GPU/CPU availability via OS info (Node built-ins only).
 */
function getSystemInfo() {
  const os = require("os");
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem  = os.freemem();
  return {
    cpuModel:    cpus[0]?.model || "unknown",
    cpuCores:    cpus.length,
    cpuArch:     os.arch(),
    platform:    os.platform(),
    totalMemGB:  parseFloat((totalMem / 1073741824).toFixed(1)),
    freeMemGB:   parseFloat((freeMem  / 1073741824).toFixed(1)),
    usedMemPct:  Math.round((1 - freeMem / totalMem) * 100),
    // GPU: best-effort (no native binding)
    gpuNote: "GPU detection requires native bindings — use Ollama's /api/tags details.size for VRAM estimate",
  };
}

/**
 * Full health snapshot.
 */
async function health() {
  const [runtimes, sysinfo] = await Promise.all([discover(), Promise.resolve(getSystemInfo())]);
  return { runtimes, sysinfo, ts: new Date().toISOString() };
}

module.exports = { discover, getCached, listModels, probeRuntime, getSystemInfo, health, RUNTIMES };
