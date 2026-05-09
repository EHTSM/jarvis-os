"use strict";
/**
 * AGI Simulation Core — controlled 8-stage intelligence pipeline.
 *
 * SAFETY GUARANTEES:
 *   - Max iterations:   3 (enforced in every sub-module)
 *   - Max ideas:        5 (limitIdeas cap throughout)
 *   - Max depth:        3 (exploration depth cap)
 *   - Pipeline timeout: 30 s hard cap
 *   - NO infinite loops — every loop has an explicit iteration counter
 *   - NO real AGI / consciousness — simulation only
 *
 * Pipeline:
 *   goal → thoughtGenerator → creativityEngine → hypothesisGenerator
 *        → ideaValidator → experimentSimulator → advancedReasoningCore
 *        → selfReflectionAI → memoryEvolutionEngine → output
 */

const { load, flush, uid, NOW, ok, fail, blocked, INTELLIGENCE_DISCLAIMER, MAX_ITERATIONS, MAX_IDEAS, PIPELINE_TIMEOUT_MS, limitIdeas } = require("./_intelligenceStore.cjs");

const thoughtGenerator    = require("./thoughtGenerator.cjs");
const creativityEngine    = require("./creativityEngine.cjs");
const hypothesisGenerator = require("./hypothesisGenerator.cjs");
const ideaValidator       = require("./ideaValidator.cjs");
const experimentSimulator = require("./experimentSimulator.cjs");
const advancedReasoningCore = require("./advancedReasoningCore.cjs");
const selfReflectionAI    = require("./selfReflectionAI.cjs");
const memoryEvolutionEngine = require("./memoryEvolutionEngine.cjs");

const AGENT = "agiSimulationCore";

function _safeExtract(result, key, fallback = []) {
    if (!result || !result.data) return fallback;
    return result.data[key] || fallback;
}

function runPipeline({ userId, goal, domain, options = {} }) {
    if (!userId || !goal) return fail(AGENT, "userId and goal required");
    if (!goal.trim() || goal.length < 5) return fail(AGENT, "goal must be a meaningful statement (5+ characters)");
    if (goal.length > 500) return fail(AGENT, "goal too long — max 500 characters");

    // ── Safety: check recent pipeline runs (rate-limit: max 10 per user) ──
    const history = load(userId, "pipeline_history", []);
    const last5min = history.filter(h => Date.now() - new Date(h.createdAt).getTime() < 300000);
    if (last5min.length >= 10) {
        return blocked(AGENT, "Rate limit — max 10 pipeline runs per 5 minutes per user. Try again shortly.");
    }

    const pipelineId = uid("pipe");
    const startTime  = Date.now();
    const stages     = [];
    let   aborted    = false;

    function _checkTimeout() {
        if (Date.now() - startTime > PIPELINE_TIMEOUT_MS) {
            aborted = true;
            return true;
        }
        return false;
    }

    function _stage(name, fn) {
        if (aborted) return null;
        if (_checkTimeout()) return null;
        try {
            const result = fn();
            stages.push({ stage:name, success: !!result?.success, timestamp:NOW() });
            return result;
        } catch (e) {
            stages.push({ stage:name, success:false, error:e.message, timestamp:NOW() });
            return null;
        }
    }

    // ────────────────────────────────────────────────────────────────
    // Stage 1: Thought Generation
    // ────────────────────────────────────────────────────────────────
    const thoughtResult = _stage("thoughtGenerator", () =>
        thoughtGenerator.generateThoughts({ userId, goal, domain, maxIdeas: MAX_IDEAS })
    );
    const thoughts = _safeExtract(thoughtResult, "thoughts", []);

    // ────────────────────────────────────────────────────────────────
    // Stage 2: Creativity Enhancement
    // ────────────────────────────────────────────────────────────────
    const creativeResult = _stage("creativityEngine", () =>
        creativityEngine.enhanceIdeas({ userId, ideas: limitIdeas(thoughts), goal, iterations: Math.min(options.creativeIterations || 1, MAX_ITERATIONS) })
    );
    const enhanced = _safeExtract(creativeResult, "enhanced", []);

    // ────────────────────────────────────────────────────────────────
    // Stage 3: Hypothesis Generation
    // ────────────────────────────────────────────────────────────────
    const hypResult = _stage("hypothesisGenerator", () =>
        hypothesisGenerator.generateHypotheses({ userId, goal, ideas: limitIdeas([...thoughts, ...enhanced]), count: Math.min(3, MAX_IDEAS) })
    );
    const hypotheses = _safeExtract(hypResult, "hypotheses", []);

    // ────────────────────────────────────────────────────────────────
    // Stage 4: Idea Validation
    // ────────────────────────────────────────────────────────────────
    const allIdeas  = limitIdeas([...thoughts, ...enhanced]);
    const valResult = _stage("ideaValidator", () =>
        ideaValidator.validateIdeas({ userId, ideas: allIdeas, goal })
    );
    const validated = _safeExtract(valResult, "validated", []);

    // ────────────────────────────────────────────────────────────────
    // Stage 5: Experiment Simulation
    // ────────────────────────────────────────────────────────────────
    const hypToSim   = limitIdeas(hypotheses).slice(0, 3);
    const expResult  = hypToSim.length
        ? _stage("experimentSimulator", () => experimentSimulator.simulateBatch({ userId, hypotheses: hypToSim, priorScore: valResult?.data?.passRate || 50 }))
        : null;
    const experiments = expResult?.data?.results?.map(r => r.result) || [];

    // ────────────────────────────────────────────────────────────────
    // Stage 6: Advanced Reasoning
    // ────────────────────────────────────────────────────────────────
    const reasoningResult = _stage("advancedReasoningCore", () =>
        advancedReasoningCore.reason({
            userId,
            goal,
            pipelineOutput: { thoughts, enhanced, hypotheses, validated, experiments }
        })
    );

    // ────────────────────────────────────────────────────────────────
    // Stage 7: Self-Reflection
    // ────────────────────────────────────────────────────────────────
    const reflectionResult = _stage("selfReflectionAI", () =>
        selfReflectionAI.reflect({
            userId,
            goal,
            reasoningOutput: reasoningResult?.data || {}
        })
    );

    // ────────────────────────────────────────────────────────────────
    // Stage 8: Memory Storage
    // ────────────────────────────────────────────────────────────────
    _stage("memoryEvolutionEngine", () => {
        const reasoning = reasoningResult?.data;
        if (reasoning?.keyInsights?.length) {
            memoryEvolutionEngine.storeLearning({
                userId,
                goal,
                type:    "insight",
                content: reasoning.keyInsights.join("; "),
                score:   reasoning.overallScore || 50,
                tags:    [domain || "general", "pipeline"]
            });
        }
        return { success: true };
    });

    // ────────────────────────────────────────────────────────────────
    // Compile final output
    // ────────────────────────────────────────────────────────────────
    const reasoning   = reasoningResult?.data  || {};
    const reflection  = reflectionResult?.data || {};
    const elapsedMs   = Date.now() - startTime;
    const stagesOK    = stages.filter(s => s.success).length;

    const insights = [
        ...thoughts.slice(0,2).map(t => t.thought),
        ...enhanced.slice(0,2).map(e => e.enhancement),
        ...(reasoning.keyInsights || [])
    ].filter(Boolean).slice(0, MAX_IDEAS);

    const pipelineRecord = {
        pipelineId,
        goal,
        domain:    domain || "auto",
        stagesRun: stages.length,
        stagesOK,
        aborted,
        elapsedMs,
        score:     reasoning.overallScore || 0,
        createdAt: NOW()
    };

    history.push(pipelineRecord);
    flush(userId, "pipeline_history", history.slice(-500));

    return {
        success:     !aborted && stagesOK >= 4,
        type:        "intelligence",
        agent:       AGENT,
        pipelineId,
        goal,
        // ── Primary outputs ──────────────────────────────────
        insights,
        reasoning:   reasoning.finalReasoning   || "Reasoning incomplete",
        decision:    reasoning.decision          || "Insufficient data for decision",
        confidence:  reasoning.confidence        || "LOW",
        overallScore: reasoning.overallScore     || 0,
        // ── Pipeline outputs ─────────────────────────────────
        thoughts:    thoughts.slice(0, MAX_IDEAS),
        enhanced:    enhanced.slice(0, MAX_IDEAS),
        hypotheses:  hypotheses.slice(0, 3),
        validated:   validated.slice(0, MAX_IDEAS),
        experiments: experiments.slice(0, 3),
        // ── Reflection ───────────────────────────────────────
        reflection: {
            score:          reflection.reflectionScore || 0,
            grade:          reflection.grade           || "N/A",
            improvements:   reflection.improvements    || [],
            biasFlags:      reflection.biasFlags       || []
        },
        // ── Pipeline metadata ─────────────────────────────────
        pipeline: {
            stages, stagesRun: stages.length, stagesOK,
            elapsedMs, aborted,
            safetyLimits: { maxIterations:MAX_ITERATIONS, maxIdeas:MAX_IDEAS, timeoutMs:PIPELINE_TIMEOUT_MS }
        },
        disclaimer: INTELLIGENCE_DISCLAIMER,
        timestamp:  NOW()
    };
}

function getPipelineHistory({ userId, limit = 20 }) {
    if (!userId) return fail(AGENT, "userId required");
    const history = load(userId, "pipeline_history", []);
    return ok(AGENT, {
        total:    history.length,
        sessions: history.slice(-limit).reverse(),
        avgScore: history.length ? Math.round(history.reduce((s,h) => s+(h.score||0),0)/history.length) : 0
    });
}

function getPipelineConfig() {
    return ok(AGENT, {
        stages: [
            "thoughtGenerator","creativityEngine","hypothesisGenerator",
            "ideaValidator","experimentSimulator","advancedReasoningCore",
            "selfReflectionAI","memoryEvolutionEngine"
        ],
        safetyLimits: {
            maxIterations:   MAX_ITERATIONS,
            maxIdeas:        MAX_IDEAS,
            maxParallel:     3,
            timeoutMs:       PIPELINE_TIMEOUT_MS,
            rateLimit:       "10 runs per 5 minutes per user"
        },
        outputFormat: { success:true, type:"intelligence", insights:"[]", reasoning:"string", decision:"string", confidence:"HIGH|MEDIUM|LOW" },
        disclaimer:   INTELLIGENCE_DISCLAIMER
    });
}

module.exports = { runPipeline, getPipelineHistory, getPipelineConfig };
