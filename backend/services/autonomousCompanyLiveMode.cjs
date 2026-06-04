"use strict";
/**
 * AutonomousCompanyLiveMode — wires together the full autonomy stack
 * (OoplixAutonomyEngine + AutonomousTaskLoop + AgentExecutionEngine +
 * SelfHealingRuntime + ContinuousLearningEngine) into a single
 * live-mode execution loop.
 *
 * When running, every tick:
 *   1. Generate tasks via OoplixAutonomyEngine.runAutonomousCycle()
 *   2. Dispatch all pending tasks
 *   3. Poll task outcomes and record influence
 *   4. Trigger SelfHealingRuntime.probe() to fix stuck/failed items
 *   5. Trigger ContinuousLearningEngine.runFullAnalysis() (throttled)
 *   6. Emit progress events to ObservabilityEngine
 *
 * Tick interval: configurable via LIVE_MODE_INTERVAL_MS env var (default 5 min).
 *
 * Persists live-mode state to data/live-mode-state.json.
 *
 * Public API:
 *   start(opts)          → { sessionId, status: "running" }
 *   stop()               → { sessionId, status: "stopped" }
 *   tick()               → { results } (manual single tick)
 *   getState()           → LiveModeState
 *   getSessionHistory()  → { sessions[] }
 */

const fs   = require("fs");
const path = require("path");
const logger = require("../utils/logger");
const auditLog = require("../utils/auditLog.cjs");

const STATE_FILE    = path.join(__dirname, "../../data/live-mode-state.json");
const SESSION_FILE  = path.join(__dirname, "../../data/live-mode-sessions.json");

const DEFAULT_INTERVAL_MS = parseInt(process.env.LIVE_MODE_INTERVAL_MS) || 5 * 60_000;
const LEARN_THROTTLE_MS   = 15 * 60_000;   // run full analysis at most every 15 min

function _rj(f, fb) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return fb; } }
function _wj(f, d) {
    const dir = path.dirname(f);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = f + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(d, null, 2));
    fs.renameSync(tmp, f);
}

let _sessions = _rj(SESSION_FILE, []);
let _state    = _rj(STATE_FILE,   { status: "stopped", sessionId: null, ticks: 0, lastTickAt: null, startedAt: null, stoppedAt: null, errors: [] });
let _timer    = null;
let _lastLearnAt = 0;
let _seq      = _sessions.length;
function _sid() { return `lm_${Date.now()}_${(++_seq).toString(36)}`; }

function _saveState()    { try { _wj(STATE_FILE,   _state);                  } catch { /* non-fatal */ } }
function _saveSessions() { try { _wj(SESSION_FILE, _sessions.slice(-100));   } catch { /* non-fatal */ } }

// ── Lazy module loaders ──────────────────────────────────────────────────
function _oae() { try { return require("./ooplixAutonomyEngine.cjs");       } catch { return null; } }
function _shr() { try { return require("./selfHealingRuntime.cjs");         } catch { return null; } }
function _cle() { try { return require("./continuousLearningEngine.cjs");   } catch { return null; } }
function _obs() { try { return require("./observabilityEngine.cjs");        } catch { return null; } }
function _atl() { try { return require("./autonomousTaskLoop.cjs");         } catch { return null; } }

// ── Single execution tick ─────────────────────────────────────────────────
async function tick() {
    const tickStart = Date.now();
    const results   = { at: new Date().toISOString(), steps: [], errors: [] };

    // Step 1: Generate + dispatch tasks
    try {
        const oae = _oae();
        if (oae) {
            const cycleResult = await oae.runAutonomousCycle();
            results.steps.push({ step: "ooplix_cycle", created: cycleResult.created?.length || 0, dispatched: cycleResult.dispatched?.length || 0 });
            _obs()?.recordMetric("livemode.tasks_created",    cycleResult.created?.length    || 0);
            _obs()?.recordMetric("livemode.tasks_dispatched", cycleResult.dispatched?.length || 0);
        }
    } catch (e) { results.errors.push({ step: "ooplix_cycle", error: e.message }); }

    // Step 2: Check autonomous task loop cycle outcomes
    try {
        const atl = _atl();
        if (atl) {
            const { stats } = atl.listCycles({ limit: 10 });
            results.steps.push({ step: "cycle_stats", ...stats });
            _obs()?.recordMetric("livemode.cycle_success_rate", stats.avgSuccessRate || 0);
        }
    } catch (e) { results.errors.push({ step: "cycle_stats", error: e.message }); }

    // Step 3: Self-healing probe
    try {
        const shr = _shr();
        if (shr) {
            const healResult = await shr.probe();
            results.steps.push({ step: "self_heal", healed: healResult.healed?.length || 0, failed: healResult.failed?.length || 0 });
            _obs()?.recordMetric("livemode.healed", healResult.healed?.length || 0);
        }
    } catch (e) { results.errors.push({ step: "self_heal", error: e.message }); }

    // Step 4: Learning analysis (throttled)
    if (Date.now() - _lastLearnAt >= LEARN_THROTTLE_MS) {
        try {
            const cle = _cle();
            if (cle) {
                const analysis = cle.runFullAnalysis();
                _lastLearnAt  = Date.now();
                results.steps.push({ step: "learning", newLessons: analysis.stats?.newLessonsThisRun || 0, openRecs: analysis.stats?.openRecommendations || 0 });
                _obs()?.recordMetric("livemode.lessons_generated", analysis.stats?.newLessonsThisRun || 0);
            }
        } catch (e) { results.errors.push({ step: "learning", error: e.message }); }
    }

    // Step 5: Observability snapshot
    try {
        const obs = _obs();
        if (obs) {
            obs.recordMetric("livemode.tick_duration_ms", Date.now() - tickStart);
            obs.structuredLog("info", "Live mode tick completed", { tickDurationMs: Date.now() - tickStart, steps: results.steps.length, errors: results.errors.length });
        }
    } catch { /* non-critical */ }

    // Update state
    _state.ticks++;
    _state.lastTickAt = new Date().toISOString();
    _state.lastTickDurationMs = Date.now() - tickStart;
    if (results.errors.length) {
        _state.errors = [...(_state.errors || []).slice(-19), ...results.errors];
    }
    _saveState();
    logger.info(`[LiveMode] Tick #${_state.ticks} — ${results.steps.length} steps, ${results.errors.length} errors, ${Date.now() - tickStart}ms`);
    return results;
}

// ── Start / Stop ──────────────────────────────────────────────────────────
function start(opts = {}) {
    if (_timer) throw new Error("Live mode already running");
    const sessionId   = _sid();
    const intervalMs  = opts.intervalMs || DEFAULT_INTERVAL_MS;

    _state = { status: "running", sessionId, ticks: 0, lastTickAt: null, startedAt: new Date().toISOString(), stoppedAt: null, errors: [], intervalMs };
    _saveState();
    _sessions.push({ sessionId, startedAt: _state.startedAt, stoppedAt: null, tickCount: 0, intervalMs });
    _saveSessions();
    auditLog.append({ type: "livemode_start", sessionId, intervalMs });
    logger.info(`[LiveMode] Started session ${sessionId} (interval: ${intervalMs}ms)`);

    // Run first tick immediately
    tick().catch(e => logger.warn(`[LiveMode] First tick error: ${e.message}`));

    // Then on interval
    _timer = setInterval(() => {
        tick().catch(e => {
            logger.warn(`[LiveMode] Tick error: ${e.message}`);
            _state.errors = [...(_state.errors || []).slice(-19), { ts: new Date().toISOString(), error: e.message }];
            _saveState();
        });
    }, intervalMs);
    if (_timer.unref) _timer.unref();

    return { sessionId, status: "running", intervalMs };
}

function stop() {
    if (!_timer) throw new Error("Live mode is not running");
    clearInterval(_timer);
    _timer = null;

    const sessionId = _state.sessionId;
    _state.status    = "stopped";
    _state.stoppedAt = new Date().toISOString();
    _saveState();

    const sess = _sessions.find(s => s.sessionId === sessionId);
    if (sess) { sess.stoppedAt = _state.stoppedAt; sess.tickCount = _state.ticks; _saveSessions(); }
    auditLog.append({ type: "livemode_stop", sessionId, ticks: _state.ticks });
    logger.info(`[LiveMode] Stopped session ${sessionId} after ${_state.ticks} ticks`);
    return { sessionId, status: "stopped", ticks: _state.ticks };
}

function getState()          { return { ..._state, isRunning: !!_timer }; }
function getSessionHistory() { return { sessions: [..._sessions].reverse().slice(0, 50) }; }

module.exports = { start, stop, tick, getState, getSessionHistory };
