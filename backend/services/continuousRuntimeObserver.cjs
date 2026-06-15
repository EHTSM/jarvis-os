"use strict";
/**
 * continuousRuntimeObserver.cjs — I1: Continuous Runtime Observer
 *
 * The single observation layer feeding Autonomous Engineering.
 * Continuously observes 14 source domains, normalizes every observation
 * into one canonical event schema, and publishes through runtimeEventBus.
 *
 * Observation domains:
 *   git          — repository state, uncommitted changes, branch divergence
 *   files        — local file changes via fs.watch
 *   pm2          — PM2 process health
 *   logs         — structured log error rate
 *   build        — Vite/CRA build output freshness
 *   tests        — test execution results
 *   tasks        — autonomous task queue depth/state
 *   missions     — mission execution state
 *   agents       — agent execution counts/health
 *   plugins      — plugin lifecycle events
 *   extensions   — extension runtime state
 *   memory       — memory layer activity
 *   ai           — AI provider health
 *   system       — CPU/memory/uptime
 *
 * Public API:
 *   start()                  → { started, sourceCount }
 *   stop()                   → void
 *   getStatus()              → { running, uptime, sources[], eventCount }
 *   getEvents(opts)          → { events[], total }
 *   getHealth()              → { healthy, sources{} }
 *   getSources()             → sources[]
 *   getStatistics()          → { throughput, byCategory, bySeverity, dedupStats }
 */

const fs          = require("fs");
const path        = require("path");
const os          = require("os");
const { execSync, exec } = require("child_process");
const crypto      = require("crypto");

const logger = require("../utils/logger");

// ── Lazy service loaders — never throw at module load ─────────────────────
function _getBus()        { try { return require("../../agents/runtime/runtimeEventBus.cjs"); } catch { return null; } }
function _getObs()        { try { return require("./observabilityEngine.cjs"); } catch { return null; } }
function _getLoop()       { try { return require("../../agents/autonomousLoop.cjs"); } catch { return null; } }
function _getMissionRT()  { try { return require("../../agents/runtime/missionRuntime.cjs"); } catch { return null; } }
function _getAgentReg()   { try { return require("../../agents/runtime/agentRegistry.cjs"); } catch { return null; } }
function _getPluginMgr()  { try { return require("./pluginManagerService.cjs"); } catch { return null; } }
function _getExtRT()      { try { return require("./extensionRuntime.cjs"); } catch { return null; } }
function _getMemLayer()   { try { return require("./memoryPersistenceLayer.cjs"); } catch { return null; } }
function _getAiSvc()      { try { return require("./aiService.js"); } catch { return null; } }
function _getExecLog()    { try { return require("../utils/execLog.cjs"); } catch { return null; } }

// ── Paths ──────────────────────────────────────────────────────────────────
const DATA_DIR       = path.join(__dirname, "../../data");
const EVENTS_FILE    = path.join(DATA_DIR, "observer-events.ndjson");
const STATE_FILE     = path.join(DATA_DIR, "observer-state.json");
const REPO_ROOT      = path.resolve(__dirname, "../../");
const BUILD_DIR      = path.join(REPO_ROOT, "frontend/build");
const LOG_FILE       = path.join(DATA_DIR, "logs/structured.ndjson");

// ── Normalized event schema ────────────────────────────────────────────────
let _evSeq = 0;
function _eid() { return `obs_${Date.now()}_${(++_evSeq).toString(36)}`; }

/**
 * Build one canonical observation event.
 * @param {object} opts
 * @returns {{ id, timestamp, source, category, severity, workspace, entity, action, metadata, confidence, correlationId }}
 */
function _mkEvent({ source, category, severity = "INFO", entity, action, metadata = {}, confidence = 1.0, correlationId = null, workspace = "jarvis-os" }) {
    return {
        id:            _eid(),
        timestamp:     new Date().toISOString(),
        source,
        category,
        severity,      // INFO | WARN | ERROR | CRITICAL
        workspace,
        entity,
        action,
        metadata,
        confidence,
        correlationId: correlationId || _eid(),
    };
}

// ── In-memory ring buffer (bounded, 1 000 events) ─────────────────────────
const RING_SIZE   = 1_000;
const _ring       = [];
let   _totalEmit  = 0;

function _pushRing(ev) {
    if (_ring.length >= RING_SIZE) _ring.shift();
    _ring.push(ev);
    _totalEmit++;
}

// ── Deduplication (sliding 30-second window) ───────────────────────────────
// Keyed by sha1(source+entity+action+severity). Prevents event spam when
// a source cycles faster than the change it observes.
const _dedupWindow  = new Map();  // hash → lastSeenTs
const DEDUP_MS      = 30_000;
let   _dedupHits    = 0;

function _dedupKey(ev) {
    return crypto.createHash("sha1")
        .update(`${ev.source}|${ev.entity}|${ev.action}|${ev.severity}`)
        .digest("hex").slice(0, 16);
}

function _isDuplicate(ev) {
    const k   = _dedupKey(ev);
    const now = Date.now();
    const last = _dedupWindow.get(k);
    if (last && (now - last) < DEDUP_MS) { _dedupHits++; return true; }
    _dedupWindow.set(k, now);
    return false;
}

// Sweep stale dedup entries every 60 s to bound memory
let _dedupSweepHandle = null;
function _startDedupSweep() {
    _dedupSweepHandle = setInterval(() => {
        const cutoff = Date.now() - DEDUP_MS;
        for (const [k, ts] of _dedupWindow) {
            if (ts < cutoff) _dedupWindow.delete(k);
        }
    }, 60_000);
    _dedupSweepHandle.unref?.();
}

// ── Category / severity counters (statistics) ─────────────────────────────
const _byCat = {};
const _bySev = { INFO: 0, WARN: 0, ERROR: 0, CRITICAL: 0 };
const _eventTimes = [];   // sliding 60-s window for throughput
const RATE_WIN_MS = 60_000;

function _recordStats(ev) {
    _byCat[ev.category] = (_byCat[ev.category] || 0) + 1;
    _bySev[ev.severity] = (_bySev[ev.severity] || 0) + 1;
    _eventTimes.push(Date.now());
    const cutoff = Date.now() - RATE_WIN_MS;
    while (_eventTimes.length && _eventTimes[0] < cutoff) _eventTimes.shift();
}

// ── Emit: normalize → deduplicate → publish → persist ────────────────────
function _emit(opts) {
    const ev = _mkEvent(opts);
    if (_isDuplicate(ev)) return null;
    _pushRing(ev);
    _recordStats(ev);
    // Fan-out to runtimeEventBus
    try { _getBus()?.emit("observer", ev); } catch { /* non-fatal */ }
    // Fan-out to observabilityEngine metric
    try { _getObs()?.recordMetric(`observer.events.${ev.category}`, 1, { severity: ev.severity }); } catch { /* non-fatal */ }
    // Async NDJSON persist (non-blocking)
    _persistEvent(ev);
    return ev;
}

// Async NDJSON append
let _persistQueue = [];
let _persistBusy  = false;

function _persistEvent(ev) {
    _persistQueue.push(JSON.stringify(ev) + "\n");
    if (_persistBusy) return;
    _persistBusy = true;
    setImmediate(_drainPersist);
}

function _drainPersist() {
    if (!_persistQueue.length) { _persistBusy = false; return; }
    const batch = _persistQueue.splice(0, _persistQueue.length).join("");
    fs.appendFile(EVENTS_FILE, batch, "utf8", (err) => {
        if (err) logger.warn(`[Observer] persist error: ${err.message}`);
        _persistBusy = false;
        if (_persistQueue.length) setImmediate(_drainPersist);
    });
}

// ── Source health tracking ─────────────────────────────────────────────────
const _sourceHealth = {};

function _sourceOk(name) {
    if (!_sourceHealth[name]) _sourceHealth[name] = { name, status: "healthy", lastRunAt: null, lastError: null, runCount: 0, errorCount: 0 };
    _sourceHealth[name].status    = "healthy";
    _sourceHealth[name].lastRunAt = new Date().toISOString();
    _sourceHealth[name].runCount++;
}

function _sourceErr(name, err) {
    if (!_sourceHealth[name]) _sourceHealth[name] = { name, status: "error", lastRunAt: null, lastError: null, runCount: 0, errorCount: 0 };
    _sourceHealth[name].status    = "error";
    _sourceHealth[name].lastError = err?.message || String(err);
    _sourceHealth[name].lastRunAt = new Date().toISOString();
    _sourceHealth[name].errorCount++;
}

// ── Source: git ────────────────────────────────────────────────────────────
let _gitPrevStatus = null;

async function _observeGit() {
    const src = "git";
    try {
        const statusRaw = execSync("git status --porcelain=v2 --branch", { cwd: REPO_ROOT, timeout: 5000, encoding: "utf8" });
        const lines     = statusRaw.trim().split("\n");
        const changed   = lines.filter(l => l.startsWith("1 ") || l.startsWith("2 ") || l.startsWith("? ")).length;
        const branch    = (lines.find(l => l.startsWith("# branch.head"))?.split(" ")[2]) || "unknown";
        const ahead     = parseInt((lines.find(l => l.startsWith("# branch.ab"))?.match(/\+(\d+)/)?.[1]) || "0");
        const behind    = parseInt((lines.find(l => l.startsWith("# branch.ab"))?.match(/-(\d+)/)?.[1]) || "0");

        const sig = `${branch}:${changed}:${ahead}:${behind}`;
        if (sig !== _gitPrevStatus) {
            _gitPrevStatus = sig;
            const severity = changed > 20 ? "WARN" : "INFO";
            _emit({ source: src, category: "git", severity, entity: branch, action: "status_change",
                metadata: { branch, changedFiles: changed, ahead, behind, repoRoot: REPO_ROOT },
                confidence: 1.0 });
        }
        _sourceOk(src);
        return { branch, changedFiles: changed, ahead, behind };
    } catch (err) {
        _sourceErr(src, err);
        return null;
    }
}

// ── Source: files (fs.watch) ───────────────────────────────────────────────
// Watch key workspace dirs. Debounce at 2s per path.
const _fileDebounce = new Map();  // path → timeout
const FILE_DEBOUNCE_MS = 2_000;
const WATCH_DIRS = [
    path.join(REPO_ROOT, "backend"),
    path.join(REPO_ROOT, "agents"),
    path.join(REPO_ROOT, "frontend/src"),
];
const _fileWatchers = [];

function _startFileWatcher() {
    for (const dir of WATCH_DIRS) {
        if (!fs.existsSync(dir)) continue;
        try {
            const w = fs.watch(dir, { recursive: true }, (eventType, filename) => {
                if (!filename) return;
                if (filename.includes("node_modules") || filename.endsWith(".tmp")) return;
                const fullPath = path.join(dir, filename);
                const prev = _fileDebounce.get(fullPath);
                if (prev) clearTimeout(prev);
                _fileDebounce.set(fullPath, setTimeout(() => {
                    _fileDebounce.delete(fullPath);
                    _emit({ source: "files", category: "filesystem", severity: "INFO",
                        entity: path.relative(REPO_ROOT, fullPath),
                        action: eventType === "rename" ? "file_renamed_or_deleted" : "file_changed",
                        metadata: { path: fullPath, eventType, dir },
                        confidence: 0.9 });
                    _sourceOk("files");
                }, FILE_DEBOUNCE_MS));
            });
            w.on("error", (err) => _sourceErr("files", err));
            _fileWatchers.push(w);
        } catch (err) {
            _sourceErr("files", err);
        }
    }
}

function _stopFileWatcher() {
    for (const w of _fileWatchers) { try { w.close(); } catch { /* ok */ } }
    _fileWatchers.length = 0;
}

// ── Source: pm2 ────────────────────────────────────────────────────────────
let _pm2PrevSig = null;

async function _observePm2() {
    const src = "pm2";
    try {
        const raw = await new Promise((resolve, reject) => {
            exec("pm2 jlist", { timeout: 5000, encoding: "utf8" }, (err, stdout) =>
                err ? reject(err) : resolve(stdout));
        });
        const procs = JSON.parse(raw);
        if (!Array.isArray(procs)) { _sourceOk(src); return null; }

        const sig = procs.map(p => `${p.name}:${p.pm2_env?.status}:${p.pm2_env?.restart_time}`).join("|");
        if (sig !== _pm2PrevSig) {
            _pm2PrevSig = sig;
            const offline = procs.filter(p => p.pm2_env?.status !== "online");
            const highRestart = procs.filter(p => (p.pm2_env?.restart_time ?? 0) > 10);
            const severity = offline.length ? "ERROR" : highRestart.length ? "WARN" : "INFO";
            _emit({ source: src, category: "pm2", severity,
                entity: "pm2_fleet", action: "fleet_state_change",
                metadata: { total: procs.length, online: procs.length - offline.length,
                    offline: offline.map(p => p.name), highRestart: highRestart.map(p => p.name) },
                confidence: 1.0 });
        }
        _sourceOk(src);
        return { checked: procs.length };
    } catch (err) {
        // pm2 not installed — degrade gracefully
        if (!_sourceHealth[src]) _sourceOk(src);  // first run: mark ok silently
        _sourceHealth[src].status = "degraded";
        return null;
    }
}

// ── Source: logs ───────────────────────────────────────────────────────────
let _logPrevErrCount = 0;

async function _observeLogs() {
    const src = "logs";
    try {
        const execLog = _getExecLog();
        const entries = execLog ? execLog.tail(100) : [];
        const now     = Date.now();
        const recent  = entries.filter(e => e.ts && (now - new Date(e.ts).getTime()) < 5 * 60_000);
        const errors  = recent.filter(e => e.level === "error" || e.success === false).length;

        if (errors !== _logPrevErrCount) {
            _logPrevErrCount = errors;
            const severity = errors > 10 ? "ERROR" : errors > 3 ? "WARN" : "INFO";
            _emit({ source: src, category: "logs", severity,
                entity: "exec_log", action: "error_rate_change",
                metadata: { errorsLast5Min: errors, recentSampled: recent.length },
                confidence: 0.85 });
        }
        _sourceOk(src);
        return { errors };
    } catch (err) {
        _sourceErr(src, err);
        return null;
    }
}

// ── Source: build ──────────────────────────────────────────────────────────
let _buildPrevAge = null;

async function _observeBuild() {
    const src = "build";
    try {
        const indexHtml = path.join(BUILD_DIR, "index.html");
        if (!fs.existsSync(indexHtml)) {
            _emit({ source: src, category: "build", severity: "WARN",
                entity: "frontend_build", action: "build_missing",
                metadata: { buildDir: BUILD_DIR },
                confidence: 1.0 });
            _sourceOk(src);
            return { exists: false };
        }
        const stat    = fs.statSync(indexHtml);
        const ageMins = Math.round((Date.now() - stat.mtimeMs) / 60_000);
        const ageBucket = Math.floor(ageMins / 10) * 10;  // quantize to 10-min buckets for dedup

        if (ageBucket !== _buildPrevAge) {
            _buildPrevAge = ageBucket;
            const severity = ageMins > 240 ? "WARN" : "INFO";
            _emit({ source: src, category: "build", severity,
                entity: "frontend_build", action: "build_age_update",
                metadata: { ageMins, buildDir: BUILD_DIR, mtime: stat.mtime.toISOString() },
                confidence: 0.9 });
        }
        _sourceOk(src);
        return { exists: true, ageMins };
    } catch (err) {
        _sourceErr(src, err);
        return null;
    }
}

// ── Source: tests ───────────────────────────────────────────────────────────
// Reads last test run from exec log (agent that ran test:runtime)
let _testPrevSig = null;

async function _observeTests() {
    const src = "tests";
    try {
        const execLog = _getExecLog();
        const tail    = execLog ? execLog.tail(200) : [];
        const testRun = [...tail].reverse().find(e => e.type === "test_run" || (e.cmd && e.cmd.includes("test:runtime")));
        if (!testRun) { _sourceOk(src); return null; }

        const sig = `${testRun.ts}:${testRun.pass}:${testRun.fail}`;
        if (sig !== _testPrevSig) {
            _testPrevSig = sig;
            const severity = (testRun.fail > 0) ? "ERROR" : "INFO";
            _emit({ source: src, category: "tests", severity,
                entity: "test_suite", action: testRun.fail > 0 ? "tests_failed" : "tests_passed",
                metadata: { pass: testRun.pass, fail: testRun.fail, total: testRun.total || (testRun.pass + testRun.fail), runAt: testRun.ts },
                confidence: 0.95 });
        }
        _sourceOk(src);
        return { found: true };
    } catch (err) {
        _sourceErr(src, err);
        return null;
    }
}

// ── Source: tasks ───────────────────────────────────────────────────────────
let _taskPrevSig = null;

async function _observeTasks() {
    const src = "tasks";
    try {
        const loop  = _getLoop();
        if (!loop) { _sourceOk(src); return null; }
        const all   = loop.getQueue();
        const pending   = all.filter(t => t.status === "pending").length;
        const running   = all.filter(t => t.status === "running").length;
        const failed    = all.filter(t => t.status === "failed").length;

        const sig = `${pending}:${running}:${failed}`;
        if (sig !== _taskPrevSig) {
            _taskPrevSig = sig;
            const severity = failed > 5 ? "ERROR" : failed > 0 ? "WARN" : running > 0 ? "INFO" : "INFO";
            _emit({ source: src, category: "tasks", severity,
                entity: "task_queue", action: "queue_state_change",
                metadata: { total: all.length, pending, running, failed },
                confidence: 1.0 });
        }
        _sourceOk(src);
        return { pending, running, failed };
    } catch (err) {
        _sourceErr(src, err);
        return null;
    }
}

// ── Source: missions ───────────────────────────────────────────────────────
let _missionPrevSig = null;

async function _observeMissions() {
    const src = "missions";
    try {
        const rt = _getMissionRT();
        if (!rt) { _sourceOk(src); return null; }
        const status  = rt.runtimeStatus();
        const active  = rt.getActiveMission();
        const sig = `${status.missions?.running ?? 0}:${status.missions?.total ?? 0}:${active?.id ?? "none"}`;

        if (sig !== _missionPrevSig) {
            _missionPrevSig = sig;
            _emit({ source: src, category: "missions", severity: "INFO",
                entity: active?.id || "no_active_mission",
                action: active ? "mission_active" : "mission_idle",
                metadata: { activeMissionId: active?.id, activeMissionTitle: active?.title,
                    stats: status.missions, queueDepth: status.orchestrator?.queueDepth },
                confidence: 1.0 });
        }
        _sourceOk(src);
        return { active: !!active };
    } catch (err) {
        _sourceErr(src, err);
        return null;
    }
}

// ── Source: agents ─────────────────────────────────────────────────────────
let _agentPrevSig = null;

async function _observeAgents() {
    const src = "agents";
    try {
        const reg  = _getAgentReg();
        if (!reg) { _sourceOk(src); return null; }
        const all  = reg.listAll();
        const sig  = all.length + ":" + all.filter(a => a.capabilities?.length > 0).length;

        if (sig !== _agentPrevSig) {
            _agentPrevSig = sig;
            _emit({ source: src, category: "agents", severity: "INFO",
                entity: "agent_registry", action: "registry_state_change",
                metadata: { total: all.length, withCapabilities: all.filter(a => a.capabilities?.length > 0).length },
                confidence: 1.0 });
        }
        _sourceOk(src);
        return { total: all.length };
    } catch (err) {
        _sourceErr(src, err);
        return null;
    }
}

// ── Source: plugins ────────────────────────────────────────────────────────
let _pluginPrevSig = null;

async function _observePlugins() {
    const src = "plugins";
    try {
        const mgr      = _getPluginMgr();
        if (!mgr) { _sourceOk(src); return null; }
        const plugins  = mgr.list();
        const enabled  = plugins.filter(p => p.enabled).length;
        const errored  = plugins.filter(p => p.health?.status === "error").length;

        const sig = `${plugins.length}:${enabled}:${errored}`;
        if (sig !== _pluginPrevSig) {
            _pluginPrevSig = sig;
            const severity = errored > 0 ? "WARN" : "INFO";
            _emit({ source: src, category: "plugins", severity,
                entity: "plugin_manager", action: "plugin_state_change",
                metadata: { total: plugins.length, enabled, errored },
                confidence: 1.0 });
        }
        _sourceOk(src);
        return { total: plugins.length, errored };
    } catch (err) {
        _sourceErr(src, err);
        return null;
    }
}

// ── Source: extensions ─────────────────────────────────────────────────────
let _extPrevSig = null;

async function _observeExtensions() {
    const src = "extensions";
    try {
        const extRT = _getExtRT();
        if (!extRT) { _sourceOk(src); return null; }
        const exts    = extRT.listRuntime();
        const running = exts.filter(e => e.state === "running").length;
        const crashed = exts.filter(e => e.state === "crashed").length;

        const sig = `${exts.length}:${running}:${crashed}`;
        if (sig !== _extPrevSig) {
            _extPrevSig = sig;
            const severity = crashed > 0 ? "WARN" : "INFO";
            _emit({ source: src, category: "extensions", severity,
                entity: "extension_runtime", action: "extension_state_change",
                metadata: { total: exts.length, running, crashed },
                confidence: 1.0 });
        }
        _sourceOk(src);
        return { total: exts.length, crashed };
    } catch (err) {
        _sourceErr(src, err);
        return null;
    }
}

// ── Source: memory ─────────────────────────────────────────────────────────
let _memPrevSig = null;

async function _observeMemory() {
    const src = "memory";
    try {
        const mem   = _getMemLayer();
        if (!mem) { _sourceOk(src); return null; }
        const st    = mem.stats();
        const sig   = `${st.total}:${st.archived}`;

        if (sig !== _memPrevSig) {
            _memPrevSig = sig;
            _emit({ source: src, category: "memory", severity: "INFO",
                entity: "memory_layer", action: "memory_state_change",
                metadata: { total: st.total, archived: st.archived, byType: st.byType },
                confidence: 1.0 });
        }
        _sourceOk(src);
        return { total: st.total };
    } catch (err) {
        _sourceErr(src, err);
        return null;
    }
}

// ── Source: AI providers ───────────────────────────────────────────────────
let _aiPrevSig = null;

async function _observeAI() {
    const src = "ai";
    try {
        const ai  = _getAiSvc();
        if (!ai) { _sourceOk(src); return null; }
        const ps  = ai.getProviderStatus();
        const configured = Object.values(ps).filter(p => p.configured).length;
        const sig = `${configured}:${Object.keys(ps).join(",")}`;

        if (sig !== _aiPrevSig) {
            _aiPrevSig = sig;
            const severity = configured === 0 ? "WARN" : "INFO";
            _emit({ source: src, category: "ai", severity,
                entity: "ai_providers", action: "provider_state_change",
                metadata: { providers: Object.keys(ps), configured, details: ps },
                confidence: 1.0 });
        }
        _sourceOk(src);
        return { configured };
    } catch (err) {
        _sourceErr(src, err);
        return null;
    }
}

// ── Source: system resources ───────────────────────────────────────────────
let _sysPrevBucket = null;

async function _observeSystem() {
    const src = "system";
    try {
        const mem       = process.memoryUsage();
        const heapMb    = Math.round(mem.heapUsed / 1_048_576);
        const rssMb     = Math.round(mem.rss      / 1_048_576);
        const freeMb    = Math.round(os.freemem() / 1_048_576);
        const loadAvg   = os.loadavg()[0];
        const uptimeSec = Math.round(process.uptime());
        // Bucket to 5 MB / 0.25 load intervals to prevent event spam
        const bucket = `${Math.floor(heapMb / 5)}:${Math.floor(loadAvg * 4)}`;

        if (bucket !== _sysPrevBucket) {
            _sysPrevBucket = bucket;
            const severity = heapMb > 512 ? "WARN" : loadAvg > 2.0 ? "WARN" : "INFO";
            _emit({ source: src, category: "system", severity,
                entity: "process", action: "resource_snapshot",
                metadata: { heapMb, rssMb, freeMb, loadAvg: +loadAvg.toFixed(2), uptimeSec,
                    cpuCount: os.cpus().length, platform: os.platform() },
                confidence: 1.0 });
        }
        _sourceOk(src);
        return { heapMb, loadAvg: +loadAvg.toFixed(2) };
    } catch (err) {
        _sourceErr(src, err);
        return null;
    }
}

// ── Observation schedule ───────────────────────────────────────────────────
// Intervals chosen for <1% idle CPU and useful signal frequency.
const SOURCES = [
    { name: "git",        fn: _observeGit,        intervalMs: 30_000  },  // 30 s
    { name: "pm2",        fn: _observePm2,         intervalMs: 60_000  },  // 1 min
    { name: "logs",       fn: _observeLogs,        intervalMs: 60_000  },  // 1 min
    { name: "build",      fn: _observeBuild,       intervalMs: 120_000 },  // 2 min
    { name: "tests",      fn: _observeTests,       intervalMs: 120_000 },  // 2 min
    { name: "tasks",      fn: _observeTasks,       intervalMs: 15_000  },  // 15 s
    { name: "missions",   fn: _observeMissions,    intervalMs: 15_000  },  // 15 s
    { name: "agents",     fn: _observeAgents,      intervalMs: 120_000 },  // 2 min
    { name: "plugins",    fn: _observePlugins,     intervalMs: 120_000 },  // 2 min
    { name: "extensions", fn: _observeExtensions,  intervalMs: 120_000 },  // 2 min
    { name: "memory",     fn: _observeMemory,      intervalMs: 120_000 },  // 2 min
    { name: "ai",         fn: _observeAI,          intervalMs: 300_000 },  // 5 min
    { name: "system",     fn: _observeSystem,      intervalMs: 20_000  },  // 20 s
    // files handled via fs.watch (event-driven), no polling interval
];

const _handles    = {};
let   _running    = false;
let   _startedAt  = null;

// ── Public: start ──────────────────────────────────────────────────────────
async function start() {
    if (_running) return { started: false, reason: "already_running" };
    _running   = true;
    _startedAt = Date.now();

    // Ensure data directory and NDJSON file exist
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

    // File watcher (event-driven)
    _startFileWatcher();
    _startDedupSweep();

    // Poll all sources with staggered startup to spread I/O load
    let stagger = 0;
    for (const src of SOURCES) {
        _sourceHealth[src.name] = { name: src.name, status: "starting", lastRunAt: null, lastError: null, runCount: 0, errorCount: 0 };
        // Immediate first run (staggered by 500 ms each)
        setTimeout(async () => {
            try { await src.fn(); } catch { /* _sourceErr already called inside */ }
            // Recurring interval
            _handles[src.name] = setInterval(async () => {
                if (!_running) return;
                try { await src.fn(); } catch { /* non-fatal */ }
            }, src.intervalMs);
            _handles[src.name].unref?.();
        }, stagger);
        stagger += 500;
    }

    // Startup observation event
    _emit({ source: "observer", category: "observer", severity: "INFO",
        entity: "continuous_runtime_observer", action: "started",
        metadata: { sourceCount: SOURCES.length + 1 /* +files */, version: "I1" },
        confidence: 1.0 });

    // Persist state
    _saveState();

    logger.info(`[Observer] I1 started — ${SOURCES.length + 1} sources, ring=${RING_SIZE}`);
    return { started: true, sourceCount: SOURCES.length + 1 };
}

// ── Public: stop ───────────────────────────────────────────────────────────
function stop() {
    _running = false;
    for (const h of Object.values(_handles)) { try { clearInterval(h); } catch { /* ok */ } }
    for (const k of Object.keys(_handles)) delete _handles[k];
    _stopFileWatcher();
    if (_dedupSweepHandle) { clearInterval(_dedupSweepHandle); _dedupSweepHandle = null; }
    _emit({ source: "observer", category: "observer", severity: "INFO",
        entity: "continuous_runtime_observer", action: "stopped", metadata: {}, confidence: 1.0 });
    logger.info("[Observer] stopped");
}

// ── Public: getStatus ──────────────────────────────────────────────────────
function getStatus() {
    return {
        running:     _running,
        version:     "I1",
        startedAt:   _startedAt ? new Date(_startedAt).toISOString() : null,
        uptimeSec:   _startedAt ? Math.round((Date.now() - _startedAt) / 1000) : 0,
        sourceCount: SOURCES.length + 1,
        eventCount:  _totalEmit,
        ringBuffer:  { size: RING_SIZE, filled: _ring.length },
        sources:     Object.values(_sourceHealth),
    };
}

// ── Public: getEvents ──────────────────────────────────────────────────────
function getEvents({ limit = 100, category, severity, source, since } = {}) {
    let events = [..._ring];
    if (category) events = events.filter(e => e.category === category);
    if (severity)  events = events.filter(e => e.severity  === severity);
    if (source)    events = events.filter(e => e.source    === source);
    if (since)     events = events.filter(e => e.timestamp >= since);
    const total = events.length;
    return { events: events.slice(-Math.min(limit, 500)), total };
}

// ── Public: getHealth ──────────────────────────────────────────────────────
function getHealth() {
    const sources = Object.values(_sourceHealth);
    const allHealthy = sources.every(s => s.status === "healthy" || s.status === "starting" || s.status === "degraded");
    return {
        healthy:  allHealthy,
        running:  _running,
        sources:  Object.fromEntries(sources.map(s => [s.name, { status: s.status, lastRunAt: s.lastRunAt, errorCount: s.errorCount }])),
        uptime:   _startedAt ? Date.now() - _startedAt : 0,
    };
}

// ── Public: getSources ─────────────────────────────────────────────────────
function getSources() {
    const intervals = Object.fromEntries(SOURCES.map(s => [s.name, s.intervalMs]));
    intervals.files = 0;  // event-driven
    return Object.values(_sourceHealth).map(s => ({
        ...s,
        intervalMs: intervals[s.name] ?? null,
        type: s.name === "files" ? "event-driven" : "poll",
    }));
}

// ── Public: getStatistics ──────────────────────────────────────────────────
function getStatistics() {
    const now     = Date.now();
    const cutoff  = now - RATE_WIN_MS;
    const recentCount = _eventTimes.filter(t => t >= cutoff).length;
    return {
        totalEmitted:    _totalEmit,
        dedupHits:       _dedupHits,
        throughputPerMin: recentCount,
        ringFill:        _ring.length,
        byCategory:      { ..._byCat },
        bySeverity:      { ..._bySev },
        dedupWindowSize: _dedupWindow.size,
        uptimeSec:       _startedAt ? Math.round((Date.now() - _startedAt) / 1000) : 0,
    };
}

// ── Internal: persist state ────────────────────────────────────────────────
function _saveState() {
    try {
        const tmp = STATE_FILE + ".tmp";
        fs.writeFileSync(tmp, JSON.stringify({ startedAt: _startedAt, version: "I1", sources: SOURCES.map(s => s.name) }, null, 2));
        fs.renameSync(tmp, STATE_FILE);
    } catch { /* non-fatal */ }
}

module.exports = { start, stop, getStatus, getEvents, getHealth, getSources, getStatistics };
