/**
 * Jarvis Evolution Core — tracks system-wide performance and surfaces upgrade recommendations.
 * Observes, measures, and proposes — does NOT self-modify code autonomously.
 */

const { load, flush, uid, NOW, logToMemory, ok, fail } = require("./_autoStore.cjs");

const STORE = "evolution-log";

const EVOLUTION_STAGES = [
    { stage: 1, label: "Bootstrap",    minScore: 0,  description: "Basic task execution, manual oversight needed" },
    { stage: 2, label: "Learning",     minScore: 40, description: "Pattern recognition, improving decisions" },
    { stage: 3, label: "Optimizing",   minScore: 60, description: "Self-optimizing loops, reduced manual intervention" },
    { stage: 4, label: "Autonomous",   minScore: 75, description: "Controlled autonomous execution across domains" },
    { stage: 5, label: "Intelligent",  minScore: 90, description: "Proactive opportunity detection and execution" }
];

const UPGRADE_AREAS = {
    decision_quality:  { metric: "avg_decision_score",  threshold: 20, upgrade: "Retrain decision scorer with more historical data" },
    execution_speed:   { metric: "avg_execution_ms",    threshold: 5000, upgrade: "Parallelize more agent calls via aiArmyManager" },
    success_rate:      { metric: "success_rate",        threshold: 0.6, upgrade: "Raise DECISION_THRESHOLD from 15 to 20" },
    risk_calibration:  { metric: "blocked_rate",        threshold: 0.3, upgrade: "Add more nuanced risk scoring for common action types" }
};

function recordCycle({ runId = "", goal = "", score = 0, decisionScore = 0, agentsUsed = [], durationMs = 0, approved = false, blocked = false }) {
    const db  = load(STORE, { cycles: [], stage: 1, totalRuns: 0, avgScore: 0 });

    const cycle = { id: uid("cyc"), runId, goal: goal.slice(0, 150), score, decisionScore, agentsUsed, durationMs, approved, blocked, recordedAt: NOW() };
    db.cycles.push(cycle);
    db.cycles   = db.cycles.slice(-500);
    db.totalRuns = (db.totalRuns || 0) + 1;

    // Update rolling avg score
    const recentScores = db.cycles.slice(-20).map(c => c.score);
    db.avgScore = +(recentScores.reduce((s, v) => s + v, 0) / recentScores.length).toFixed(1);

    // Determine evolution stage
    const currentStage = [...EVOLUTION_STAGES].reverse().find(s => db.avgScore >= s.minScore) || EVOLUTION_STAGES[0];
    db.stage = currentStage.stage;

    flush(STORE, db);
    logToMemory("jarvisEvolutionCore", `cycle:${runId}`, { score, stage: db.stage });
    return { cycle, currentStage, avgScore: db.avgScore };
}

function getStatus() {
    const db      = load(STORE, { cycles: [], stage: 1, totalRuns: 0, avgScore: 0 });
    const cycles  = db.cycles;

    if (!cycles.length) return { message: "No cycles recorded yet.", stage: EVOLUTION_STAGES[0] };

    const recent       = cycles.slice(-10);
    const successRate  = +((recent.filter(c => c.score >= 60).length / recent.length) * 100).toFixed(0);
    const blockedRate  = +((recent.filter(c => c.blocked).length / recent.length) * 100).toFixed(0);
    const avgDecision  = +(recent.reduce((s, c) => s + (c.decisionScore || 0), 0) / recent.length).toFixed(1);

    const currentStage = [...EVOLUTION_STAGES].reverse().find(s => db.avgScore >= s.minScore) || EVOLUTION_STAGES[0];
    const nextStage    = EVOLUTION_STAGES.find(s => s.stage === currentStage.stage + 1);

    // Identify upgrades needed
    const upgradesNeeded = [];
    if (successRate < 60)   upgradesNeeded.push(UPGRADE_AREAS.success_rate.upgrade);
    if (blockedRate > 30)   upgradesNeeded.push(UPGRADE_AREAS.risk_calibration.upgrade);
    if (avgDecision < 20)   upgradesNeeded.push(UPGRADE_AREAS.decision_quality.upgrade);

    return {
        systemStatus: {
            totalRuns:     db.totalRuns,
            avgScore:      db.avgScore,
            successRate:   successRate + "%",
            blockedRate:   blockedRate + "%",
            avgDecisionScore: avgDecision
        },
        evolution: {
            currentStage:  currentStage,
            nextStage:     nextStage || { label: "Maximum", description: "System at peak capability" },
            progressToNext: nextStage ? +((db.avgScore - currentStage.minScore) / (nextStage.minScore - currentStage.minScore) * 100).toFixed(0) + "%" : "100%"
        },
        upgradesNeeded,
        recentCycles:   recent.slice(-3).map(c => ({ goal: c.goal, score: c.score, approved: c.approved })),
        generatedAt:    NOW()
    };
}

function getEvolutionHistory() {
    const db = load(STORE, { cycles: [] });
    return db.cycles.slice(-20).map(c => ({ score: c.score, approved: c.approved, recordedAt: c.recordedAt }));
}

async function run(task) {
    const p = task.payload || {};
    try {
        let data;
        if (task.type === "evolution_status") {
            data = getStatus();
        } else if (task.type === "evolution_history") {
            data = getEvolutionHistory();
        } else {
            data = recordCycle({ runId: p.runId || "", goal: p.goal || "", score: p.score || 0, decisionScore: p.decisionScore || 0, agentsUsed: p.agentsUsed || [], durationMs: p.durationMs || 0, approved: p.approved || false, blocked: p.blocked || false });
        }
        return ok("jarvisEvolutionCore", data, ["System evolves with every run", "Quality inputs → smarter system"]);
    } catch (err) { return fail("jarvisEvolutionCore", err.message); }
}

module.exports = { recordCycle, getStatus, getEvolutionHistory, EVOLUTION_STAGES, run };
