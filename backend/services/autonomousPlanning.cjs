"use strict";
/**
 * AutonomousPlanning — Track F, Priority F3 of the Jarvis Brain project.
 *
 * Planning horizons with continuous next-objective recommendation.
 * Builds on existing services without duplicating their logic.
 *
 * Data read (read-only):
 *   data/engineering-autopilot.json  — mission records (missionId, goal, domain, status, steps[])
 *   data/recommendations.json        — open recommendations from ContinuousLearningEngine
 *   data/lessons.json                — failure/success lessons from ContinuousLearningEngine
 *   data/autonomous-cycles.json      — cycle history from AutonomousTaskLoop
 *
 * Writes:
 *   data/planning-horizons.json      — horizon plans + stats cache
 *
 * Public API (all exported):
 *   generatePlan(horizon, context)   → { horizon, objectives[], blockers[], risks[], generatedAt }
 *   recommendNextObjective(context)  → { objective, rationale, estimatedImpact, estimatedHours, confidence, supportingData{} }
 *   getAllHorizons()                  → { horizons{}, stats{}, lastUpdated }
 *   getHorizon(horizon)              → single horizon plan | null
 *   refreshHorizon(horizon)          → force-regenerated horizon plan
 *   getPlanningStats()               → { totalPlansGenerated, lastRefreshed{}, objectiveCompletionRate, avgObjectivesPerHorizon }
 *   markObjectiveComplete(objectiveId, outcome) → { objectiveId, markedAt, outcome, completionRate }
 *
 * Scoring: score = (impact * 0.4) + (urgency * 0.3) + (ease * 0.2) + (strategic_alignment * 0.1)
 *   All sub-scores 0-100 derived from available data signals.
 */

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");
const logger = require("../utils/logger");

// ── File paths ────────────────────────────────────────────────────────────────
const DATA_DIR           = path.join(__dirname, "../../data");
const HORIZONS_FILE      = path.join(DATA_DIR, "planning-horizons.json");

const DATA_SOURCES = {
    missions:  path.join(DATA_DIR, "engineering-autopilot.json"),
    recs:      path.join(DATA_DIR, "recommendations.json"),
    lessons:   path.join(DATA_DIR, "lessons.json"),
    cycles:    path.join(DATA_DIR, "autonomous-cycles.json"),
};

// ── Horizon configuration ─────────────────────────────────────────────────────
const HORIZONS = ["immediate", "today", "week", "month", "roadmap"];

const HORIZON_CONFIG = {
    immediate: { label: "Immediate (now → 2h)",   maxAgeMs: 2  * 3600_000, maxObjectives: 10,  windowMs: 2  * 3600_000 },
    today:     { label: "Today (0 → 24h)",         maxAgeMs: 6  * 3600_000, maxObjectives: 10,  windowMs: 24 * 3600_000 },
    week:      { label: "Week (0 → 7d)",           maxAgeMs: 24 * 3600_000, maxObjectives: 20,  windowMs: 7  * 86_400_000 },
    month:     { label: "Month (0 → 30d)",         maxAgeMs: 48 * 3600_000, maxObjectives: 20,  windowMs: 30 * 86_400_000 },
    roadmap:   { label: "Roadmap (30d+)",          maxAgeMs: 72 * 3600_000, maxObjectives: 30,  windowMs: null },
};

// Cache staleness threshold for getAllHorizons() — 60 minutes
const STALE_THRESHOLD_MS = 60 * 60_000;

// ── I/O helpers ───────────────────────────────────────────────────────────────
function _rj(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function _wj(file, data) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
}

// ── Data loaders ──────────────────────────────────────────────────────────────
function _loadMissions()  { return _rj(DATA_SOURCES.missions, []); }
function _loadRecs()      { return _rj(DATA_SOURCES.recs,     []); }
function _loadLessons()   { return _rj(DATA_SOURCES.lessons,  []); }
function _loadCycles()    { return _rj(DATA_SOURCES.cycles,   []); }
function _loadStore()     { return _rj(HORIZONS_FILE, { horizons: {}, stats: _emptyStats(), lastUpdated: null }); }

function _emptyStats() {
    return {
        totalPlansGenerated: 0,
        lastRefreshed:       {},
        completedObjectives: [],
        horizonGenerations:  {},
    };
}

// ── Scoring helpers ───────────────────────────────────────────────────────────

/**
 * Compute lesson-frequency map: sourcePattern → occurrence count.
 * Used to derive `impact` for failure-based objectives.
 */
function _buildLessonFreqMap(lessons) {
    const map = new Map();
    for (const l of lessons) {
        const key = l.sourcePattern || l.lessonId;
        map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
}

/**
 * Normalise a value in [0, max] to [0, 100].
 */
function _norm(val, max) {
    if (!max || max <= 0) return 0;
    return Math.min(100, Math.round((val / max) * 100));
}

/**
 * Score an objective candidate.
 * Returns a number 0-100.
 *
 * score = (impact * 0.4) + (urgency * 0.3) + (ease * 0.2) + (strategic_alignment * 0.1)
 */
function _scoreObjective(candidate, { maxFrequency, topMissionTags }) {
    const { impact = 0, urgency = 0, ease = 0, strategic_alignment = 0 } = candidate._scores || {};
    return Math.round(impact * 0.4 + urgency * 0.3 + ease * 0.2 + strategic_alignment * 0.1);
}

/**
 * Derive impact score (0-100) from:
 *   - recommendation priority (1=high, 2=med, 3=low): maps to 100/66/33
 *   - lesson frequency for the source pattern (normalized against max)
 */
function _deriveImpact(source, lessonFreqMap, maxFrequency) {
    let base = 30; // default
    if (source.recPriority !== undefined) {
        base = source.recPriority === 1 ? 90 : source.recPriority === 2 ? 60 : 30;
    } else if (source.missionStatus === "failed") {
        base = 70;
    } else if (source.missionStatus === "completed") {
        base = 20;
    }

    // Boost from lesson frequency
    const freq    = lessonFreqMap.get(source.lessonPattern || "") || 0;
    const freqBoost = _norm(freq, maxFrequency) * 0.3; // up to 30% bonus
    return Math.min(100, Math.round(base + freqBoost));
}

/**
 * Derive urgency (0-100):
 *   - deadline proximity: if mission has a scheduledAt, closer → higher urgency
 *   - blocking count: how many open cycles list this goal as a dependency (approximated)
 *   - rec status "open" + priority 1 → max urgency boost
 */
function _deriveUrgency(source, horizon) {
    const nowMs = Date.now();
    let urgency = 40; // default medium

    // Recommendation priority
    if (source.recPriority === 1) urgency = Math.min(100, urgency + 40);
    else if (source.recPriority === 2) urgency = Math.min(100, urgency + 20);

    // Horizon proximity bonus
    if (horizon === "immediate") urgency = Math.min(100, urgency + 25);
    else if (horizon === "today") urgency = Math.min(100, urgency + 15);

    // Deadline-based urgency for missions with scheduledAt
    if (source.scheduledAt) {
        const daysUntil = (new Date(source.scheduledAt).getTime() - nowMs) / 86_400_000;
        if (daysUntil <= 0)  urgency = 100;
        else if (daysUntil <= 1) urgency = Math.min(100, urgency + 30);
        else if (daysUntil <= 7) urgency = Math.min(100, urgency + 15);
    }

    // Failed cycle = urgent to address
    if (source.cycleStatus === "failed") urgency = Math.min(100, urgency + 20);

    return urgency;
}

/**
 * Derive ease (0-100): inverse of estimated hours, normalized.
 * Short tasks score high ease; long tasks score low.
 * Max credible task size = 80h → scores 0.
 */
function _deriveEase(estimatedHours) {
    const h = Math.max(0.25, estimatedHours || 4);
    // Ease = 100 * (1 - h/maxH)
    const maxH = 80;
    return Math.round(Math.max(0, 100 * (1 - Math.min(h, maxH) / maxH)));
}

/**
 * Derive strategic alignment (0-100): does this objective's tags overlap
 * with the primary mission domain vocabulary?
 */
function _deriveStrategicAlignment(tags, topMissionTags) {
    if (!tags || !tags.length || !topMissionTags || !topMissionTags.size) return 40;
    const overlap = tags.filter(t => topMissionTags.has(t)).length;
    return Math.min(100, Math.round((overlap / Math.max(1, tags.length)) * 100) + 20);
}

/**
 * Build the set of top mission domain tags from mission data.
 * Used as the strategic alignment baseline.
 */
function _buildTopMissionTags(missions) {
    const freq = new Map();
    for (const m of missions) {
        const tags = _extractMissionTags(m);
        for (const t of tags) freq.set(t, (freq.get(t) || 0) + 1);
    }
    // Keep top 20 tags by frequency
    const sorted = Array.from(freq.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20);
    return new Set(sorted.map(([t]) => t));
}

/**
 * Extract normalised tags from a mission record.
 */
function _extractMissionTags(mission) {
    const text = ((mission.goal || "") + " " + (mission.domain || "") + " " + (mission.agent || "")).toLowerCase();
    const words = text.split(/[\s_\-,./]+/).filter(w => w.length > 3);
    return [...new Set(words)];
}

/**
 * Estimate hours for an objective based on its source type and complexity signals.
 */
function _estimateHours(source) {
    if (source.type === "rec" && source.recPriority === 1) return 3;
    if (source.type === "rec" && source.recPriority === 2) return 6;
    if (source.type === "rec") return 8;
    if (source.type === "mission_failed") return 4;
    if (source.type === "lesson_failure") return 5;
    if (source.type === "cycle") return 2;
    if (source.type === "mission_pending") return 8;
    return 4;
}

/**
 * Map an objective's tags to a horizon based on urgency + estimated hours.
 */
function _assignHorizon(urgency, estimatedHours) {
    if (urgency >= 85 || estimatedHours <= 1) return "immediate";
    if (urgency >= 65 || estimatedHours <= 4) return "today";
    if (urgency >= 45 || estimatedHours <= 16) return "week";
    if (urgency >= 25 || estimatedHours <= 40) return "month";
    return "roadmap";
}

// ── Objective builder ─────────────────────────────────────────────────────────

/**
 * Build a raw list of objective candidates from all data sources.
 * Returns an array of partially-scored candidate objects.
 */
function _buildCandidates({ missions, recs, lessons, cycles }) {
    const candidates = [];

    // 1. Unfinished / failed missions
    for (const m of missions) {
        if (m.status === "pending" || m.status === "running" || m.status === "failed") {
            candidates.push({
                _sourceType:    m.status === "failed" ? "mission_failed" : "mission_pending",
                _sourceId:      m.missionId,
                type:           m.status === "failed" ? "mission_failed" : "mission_pending",
                title:          `${m.status === "failed" ? "Retry failed mission" : "Complete pending mission"}: ${(m.goal || "").slice(0, 100)}`,
                description:    `Mission ${m.missionId} (domain: ${m.domain || "general"}, agent: ${m.agent || "auto"}) is ${m.status}. Goal: ${(m.goal || "").slice(0, 200)}`,
                recPriority:    m.status === "failed" ? 1 : 2,
                missionStatus:  m.status,
                scheduledAt:    m.scheduledAt || null,
                lessonPattern:  null,
                cycleStatus:    null,
                tags:           _extractMissionTags(m),
            });
        }
    }

    // 2. Open recommendations
    for (const r of recs) {
        if (r.status !== "open") continue;
        candidates.push({
            _sourceType:   "rec",
            _sourceId:     r.recId,
            type:          "rec",
            title:         `Address recommendation: ${(r.title || "").slice(0, 100)}`,
            description:   (r.detail || r.title || "").slice(0, 300),
            recPriority:   r.priority || 3,
            missionStatus: null,
            scheduledAt:   null,
            lessonPattern: (r.title || "").slice(0, 40),
            cycleStatus:   null,
            tags:          _tagFromText(r.title + " " + (r.detail || "") + " " + (r.type || "")),
        });
    }

    // 3. Recurring failures from lessons (top failure lessons by source pattern)
    const failureLessons = lessons.filter(l => l.type === "failure" && l.severity !== "info");
    // Group by source pattern, keep most recent per pattern
    const patternMap = new Map();
    for (const l of failureLessons) {
        const key = l.sourcePattern || l.lessonId;
        const existing = patternMap.get(key);
        if (!existing || new Date(l.createdAt) > new Date(existing.createdAt)) {
            patternMap.set(key, l);
        }
    }
    for (const [pattern, l] of patternMap) {
        candidates.push({
            _sourceType:   "lesson_failure",
            _sourceId:     l.lessonId,
            type:          "lesson_failure",
            title:         `Resolve recurring failure: ${(l.title || "").slice(0, 100)}`,
            description:   `${(l.detail || "").slice(0, 200)} Recommendation: ${(l.recommendation || "investigate").slice(0, 200)}`,
            recPriority:   l.severity === "high" ? 1 : l.severity === "medium" ? 2 : 3,
            missionStatus: null,
            scheduledAt:   null,
            lessonPattern: pattern,
            cycleStatus:   null,
            tags:          _tagFromText(l.title + " " + (l.detail || "")),
        });
    }

    // 4. Failed / pending cycle items
    const recentCycles = cycles
        .filter(c => c.status === "failed" || (c.status === "pending"))
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 30);
    for (const c of recentCycles) {
        candidates.push({
            _sourceType:   "cycle",
            _sourceId:     c.cycleId,
            type:          "cycle",
            title:         `Resume cycle task: ${(c.goal || "").slice(0, 100)}`,
            description:   `Cycle ${c.cycleId} (type: ${c.goalType || "general"}) ${c.status}. ${c.status === "failed" ? "Needs investigation and retry." : "Awaiting execution."}`,
            recPriority:   c.status === "failed" ? 2 : 3,
            missionStatus: null,
            scheduledAt:   c.scheduledAt || null,
            lessonPattern: null,
            cycleStatus:   c.status,
            tags:          _tagFromText((c.goal || "") + " " + (c.goalType || "")),
        });
    }

    return candidates;
}

function _tagFromText(text) {
    const words = (text || "").toLowerCase().split(/[\s_\-,./:()\[\]]+/).filter(w => w.length > 3);
    return [...new Set(words)].slice(0, 10);
}

// ── Main plan generator ────────────────────────────────────────────────────────

/**
 * Core planning pipeline.
 * Returns a fully-formed horizon plan object.
 */
function _buildPlan(horizon, context, { missions, recs, lessons, cycles }) {
    const cfg = HORIZON_CONFIG[horizon];
    if (!cfg) throw new Error(`Unknown horizon: ${horizon}`);

    // Build frequency and tag reference sets
    const lessonFreqMap  = _buildLessonFreqMap(lessons);
    const maxFrequency   = Math.max(1, ...lessonFreqMap.values());
    const topMissionTags = _buildTopMissionTags(missions);

    // Build candidates
    const raw = _buildCandidates({ missions, recs, lessons, cycles });

    // Score every candidate
    const scored = raw.map(c => {
        const estimatedHours = _estimateHours(c);
        const impact             = _deriveImpact(c, lessonFreqMap, maxFrequency);
        const urgency            = _deriveUrgency(c, horizon);
        const ease               = _deriveEase(estimatedHours);
        const strategic_alignment = _deriveStrategicAlignment(c.tags, topMissionTags);

        c._scores       = { impact, urgency, ease, strategic_alignment };
        c._estimatedHours = estimatedHours;
        c._score        = Math.round(impact * 0.4 + urgency * 0.3 + ease * 0.2 + strategic_alignment * 0.1);
        c._horizon      = _assignHorizon(urgency, estimatedHours);
        return c;
    });

    // Filter to objectives appropriate for this horizon
    // immediate/today → only their own horizon; week/month/roadmap → include lower horizons too
    const horizonRank = { immediate: 0, today: 1, week: 2, month: 3, roadmap: 4 };
    const myRank      = horizonRank[horizon];
    const filtered    = horizon === "immediate" || horizon === "today"
        ? scored.filter(c => c._horizon === horizon)
        : scored.filter(c => horizonRank[c._horizon] <= myRank);

    // Sort by score descending, take top N
    const sorted = filtered.sort((a, b) => b._score - a._score).slice(0, cfg.maxObjectives);

    // Build structured objectives
    const objectives = sorted.map(c => {
        const id = `obj_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
        return {
            id,
            title:          c.title,
            description:    c.description + (context ? ` | Context: ${JSON.stringify(context).slice(0, 100)}` : ""),
            priority:       c.recPriority || 2,
            estimatedHours: c._estimatedHours,
            horizon,
            rationale:      _buildRationale(c, horizon),
            dependencies:   [], // no dependency graph in current data model
            tags:           c.tags,
            score:          c._score,
            sourceType:     c._sourceType,
            sourceId:       c._sourceId,
        };
    });

    // Identify blockers: highest-priority recommendations with recPriority = 1 not yet in objectives
    const topRecIds = new Set(objectives.filter(o => o.sourceType === "rec").map(o => o.sourceId));
    const blockers  = recs
        .filter(r => r.status === "open" && r.priority === 1 && !topRecIds.has(r.recId))
        .slice(0, 5)
        .map(r => ({
            id:          r.recId,
            description: (r.title || "").slice(0, 120),
            type:        r.type || "fix",
        }));

    // Risks: high-severity failure lessons not captured by objectives
    const lessonSourceIds = new Set(objectives.filter(o => o.sourceType === "lesson_failure").map(o => o.sourceId));
    const risks = lessons
        .filter(l => l.type === "failure" && l.severity === "high" && !lessonSourceIds.has(l.lessonId))
        .slice(0, 5)
        .map(l => ({
            id:          l.lessonId,
            description: (l.title || "").slice(0, 120),
            severity:    l.severity,
        }));

    return {
        horizon,
        label:        cfg.label,
        objectives,
        blockers,
        risks,
        generatedAt:  new Date().toISOString(),
        objectiveCount: objectives.length,
    };
}

function _buildRationale(c, horizon) {
    const parts = [];
    if (c._sourceType === "rec") {
        parts.push(`Open recommendation (priority ${c.recPriority}) from continuous learning engine.`);
    } else if (c._sourceType === "mission_failed") {
        parts.push(`Mission failed and requires retry to maintain system progress.`);
    } else if (c._sourceType === "mission_pending") {
        parts.push(`Mission is pending execution — blocking downstream work.`);
    } else if (c._sourceType === "lesson_failure") {
        parts.push(`Recurring failure pattern detected in lesson store. Addressing reduces system entropy.`);
    } else if (c._sourceType === "cycle") {
        parts.push(`Autonomous cycle task did not complete. Replaying stabilises task throughput.`);
    }
    parts.push(`Composite score: ${c._score}/100 (impact=${c._scores.impact}, urgency=${c._scores.urgency}, ease=${c._scores.ease}, alignment=${c._scores.strategic_alignment}).`);
    parts.push(`Assigned to ${horizon} horizon based on urgency (${c._scores.urgency}) and estimated effort (${c._estimatedHours}h).`);
    return parts.join(" ");
}

// ── Persistence helpers ────────────────────────────────────────────────────────

function _saveHorizon(store, horizon, plan) {
    store.horizons[horizon] = plan;
    store.stats.lastRefreshed[horizon] = plan.generatedAt;
    store.stats.totalPlansGenerated    = (store.stats.totalPlansGenerated || 0) + 1;
    store.stats.horizonGenerations     = store.stats.horizonGenerations || {};
    store.stats.horizonGenerations[horizon] = (store.stats.horizonGenerations[horizon] || 0) + 1;
    store.lastUpdated = new Date().toISOString();
}

function _isStale(plan) {
    if (!plan || !plan.generatedAt) return true;
    return Date.now() - new Date(plan.generatedAt).getTime() > STALE_THRESHOLD_MS;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * generatePlan(horizon, context)
 * Generates a fresh plan for the given horizon.
 * Saves to planning-horizons.json atomically.
 */
function generatePlan(horizon, context) {
    if (!HORIZONS.includes(horizon)) {
        throw new Error(`Invalid horizon "${horizon}". Valid: ${HORIZONS.join(", ")}`);
    }

    logger.info(`[AutonomousPlanning] generatePlan: ${horizon}`);

    const missions = _loadMissions();
    const recs     = _loadRecs();
    const lessons  = _loadLessons();
    const cycles   = _loadCycles();

    const plan  = _buildPlan(horizon, context, { missions, recs, lessons, cycles });
    const store = _loadStore();
    _saveHorizon(store, horizon, plan);

    try { _wj(HORIZONS_FILE, store); } catch (err) { logger.warn(`[AutonomousPlanning] persist failed: ${err.message}`); }

    logger.info(`[AutonomousPlanning] ${horizon}: ${plan.objectives.length} objectives, ${plan.blockers.length} blockers, ${plan.risks.length} risks`);
    return plan;
}

/**
 * recommendNextObjective(context)
 * Returns the single highest-impact next engineering objective.
 * Uses immediate horizon plan (regenerated if stale), then falls back to today.
 */
function recommendNextObjective(context) {
    logger.info("[AutonomousPlanning] recommendNextObjective");

    const store = _loadStore();
    let candidates = [];

    // Gather immediate and today horizon objectives
    for (const h of ["immediate", "today"]) {
        let plan = store.horizons[h];
        if (!plan || _isStale(plan)) {
            plan = generatePlan(h, context);
        }
        candidates = candidates.concat((plan.objectives || []).map(o => ({ ...o, _horizonSource: h })));
    }

    if (!candidates.length) {
        // Fall back to week horizon
        let plan = store.horizons.week;
        if (!plan || _isStale(plan)) plan = generatePlan("week", context);
        candidates = (plan.objectives || []).map(o => ({ ...o, _horizonSource: "week" }));
    }

    if (!candidates.length) {
        return {
            objective:       null,
            rationale:       "No objectives found across immediate, today, and week horizons. All missions may be complete.",
            estimatedImpact: 0,
            estimatedHours:  0,
            confidence:      10,
            supportingData:  { totalCandidates: 0 },
        };
    }

    // Rank by:
    //   1. blocking other work (blockers in plan contain this obj's sourceId)
    //   2. highest failure frequency in lessons (sourceType === lesson_failure, highest score)
    //   3. highest composite score
    //   4. shortest time (lowest estimatedHours)
    const store2 = _loadStore();
    const allBlockerIds = new Set();
    for (const h of HORIZONS) {
        const plan = store2.horizons[h];
        if (plan && plan.blockers) {
            for (const b of plan.blockers) allBlockerIds.add(b.id);
        }
    }

    function _rankKey(o) {
        const isBlocker  = allBlockerIds.has(o.sourceId) ? 1 : 0;
        const isFailure  = o.sourceType === "lesson_failure" ? 1 : 0;
        const score      = o.score || 0;
        const hoursPenalty = -Math.min(o.estimatedHours || 4, 80);
        // Lexicographic sort: [blocker, failure, score, -hours]
        return [isBlocker, isFailure, score, hoursPenalty];
    }

    candidates.sort((a, b) => {
        const ka = _rankKey(a), kb = _rankKey(b);
        for (let i = 0; i < ka.length; i++) {
            if (kb[i] !== ka[i]) return kb[i] - ka[i];
        }
        return 0;
    });

    const best = candidates[0];

    // Compute confidence: based on source type and score
    let confidence = 50;
    if (best.sourceType === "rec" && best.priority === 1) confidence = 85;
    else if (best.sourceType === "lesson_failure") confidence = 78;
    else if (best.sourceType === "mission_failed")  confidence = 72;
    else if (best.score >= 70) confidence = 70;
    else if (best.score >= 50) confidence = 60;

    const rationale = [
        `Top objective from ${best._horizonSource} horizon with composite score ${best.score}/100.`,
        `Source type: ${best.sourceType} (id: ${best.sourceId}).`,
        best.rationale || "",
        allBlockerIds.has(best.sourceId) ? "This objective is listed as a blocker in one or more horizon plans." : "",
    ].filter(Boolean).join(" ");

    return {
        objective:       best,
        rationale,
        estimatedImpact: best.score,
        estimatedHours:  best.estimatedHours,
        confidence,
        supportingData: {
            totalCandidates: candidates.length,
            horizonSource:   best._horizonSource,
            sourceType:      best.sourceType,
            sourceId:        best.sourceId,
            score:           best.score,
            isBlocker:       allBlockerIds.has(best.sourceId),
        },
    };
}

/**
 * getAllHorizons()
 * Returns all 5 horizon plans from cache, regenerating any that are stale (> 60 min).
 */
function getAllHorizons() {
    const store = _loadStore();
    let dirty   = false;

    const missions = _loadMissions();
    const recs     = _loadRecs();
    const lessons  = _loadLessons();
    const cycles   = _loadCycles();

    for (const h of HORIZONS) {
        const plan = store.horizons[h];
        if (!plan || _isStale(plan)) {
            logger.info(`[AutonomousPlanning] getAllHorizons: regenerating stale horizon "${h}"`);
            const fresh = _buildPlan(h, null, { missions, recs, lessons, cycles });
            _saveHorizon(store, h, fresh);
            dirty = true;
        }
    }

    if (dirty) {
        try { _wj(HORIZONS_FILE, store); } catch (err) { logger.warn(`[AutonomousPlanning] persist failed: ${err.message}`); }
    }

    return { horizons: store.horizons, stats: store.stats, lastUpdated: store.lastUpdated };
}

/**
 * getHorizon(horizon)
 * Returns a single horizon plan from cache (no staleness check — use refreshHorizon for that).
 */
function getHorizon(horizon) {
    if (!HORIZONS.includes(horizon)) {
        throw new Error(`Invalid horizon "${horizon}". Valid: ${HORIZONS.join(", ")}`);
    }
    const store = _loadStore();
    return store.horizons[horizon] || null;
}

/**
 * refreshHorizon(horizon)
 * Force-regenerates a specific horizon plan and saves it to file.
 */
function refreshHorizon(horizon) {
    if (!HORIZONS.includes(horizon)) {
        throw new Error(`Invalid horizon "${horizon}". Valid: ${HORIZONS.join(", ")}`);
    }
    return generatePlan(horizon, null);
}

/**
 * getPlanningStats()
 * Returns planning statistics.
 */
function getPlanningStats() {
    const store = _loadStore();
    const stats = store.stats || _emptyStats();

    // Compute objective completion rate
    const completed = (stats.completedObjectives || []);
    const totalGenerated = stats.totalPlansGenerated || 0;
    const completionRate = completed.length > 0
        ? Math.round((completed.length / Math.max(1, completed.length + totalGenerated * 2)) * 100)
        : 0;

    // Average objectives per horizon
    let totalObjectives = 0;
    let horizonCount    = 0;
    for (const h of HORIZONS) {
        const plan = store.horizons[h];
        if (plan && Array.isArray(plan.objectives)) {
            totalObjectives += plan.objectives.length;
            horizonCount++;
        }
    }
    const avgObjectivesPerHorizon = horizonCount > 0
        ? Math.round(totalObjectives / horizonCount)
        : 0;

    return {
        totalPlansGenerated:    totalGenerated,
        lastRefreshed:          stats.lastRefreshed || {},
        objectiveCompletionRate: completionRate,
        avgObjectivesPerHorizon,
        completedObjectiveCount: completed.length,
        horizonGenerations:     stats.horizonGenerations || {},
    };
}

/**
 * markObjectiveComplete(objectiveId, outcome)
 * Marks an objective as complete and records the outcome.
 * Used for completion rate tracking.
 */
function markObjectiveComplete(objectiveId, outcome) {
    if (!objectiveId) throw new Error("objectiveId is required");

    const store = _loadStore();
    if (!store.stats) store.stats = _emptyStats();
    if (!Array.isArray(store.stats.completedObjectives)) store.stats.completedObjectives = [];

    // Prevent duplicate completion records
    const already = store.stats.completedObjectives.find(c => c.objectiveId === objectiveId);
    if (already) {
        logger.info(`[AutonomousPlanning] markObjectiveComplete: ${objectiveId} already completed`);
        return {
            objectiveId,
            markedAt:       already.markedAt,
            outcome:        already.outcome,
            completionRate: getPlanningStats().objectiveCompletionRate,
            duplicate:      true,
        };
    }

    const record = {
        objectiveId,
        markedAt: new Date().toISOString(),
        outcome:  outcome || "completed",
    };

    store.stats.completedObjectives.push(record);
    // Cap the completed list to the last 1000 entries
    store.stats.completedObjectives = store.stats.completedObjectives.slice(-1000);
    store.lastUpdated = new Date().toISOString();

    try { _wj(HORIZONS_FILE, store); } catch (err) { logger.warn(`[AutonomousPlanning] persist failed: ${err.message}`); }

    logger.info(`[AutonomousPlanning] markObjectiveComplete: ${objectiveId} → ${outcome}`);

    return {
        objectiveId,
        markedAt:       record.markedAt,
        outcome:        record.outcome,
        completionRate: getPlanningStats().objectiveCompletionRate,
    };
}

// ── Module export ─────────────────────────────────────────────────────────────
module.exports = {
    generatePlan,
    recommendNextObjective,
    getAllHorizons,
    getHorizon,
    refreshHorizon,
    getPlanningStats,
    markObjectiveComplete,
};
