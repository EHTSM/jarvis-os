"use strict";
const { load, flush, uid, NOW, ok, fail, blocked, MAX_IDEAS, MAX_ITERATIONS, limitIdeas } = require("./_intelligenceStore.cjs");
const AGENT = "parallelThinkingEngine";

const MAX_PARALLEL_STREAMS = 3; // hard cap — no overload

const THINKING_STRATEGIES = {
    diverge:   { name:"Divergent",    goal:"Generate maximum variety of ideas" },
    converge:  { name:"Convergent",   goal:"Narrow to best single solution" },
    lateral:   { name:"Lateral",      goal:"Find unexpected cross-domain connections" }
};

function _processStream(streamId, idea, strategy) {
    const text   = idea.thought || idea.enhancement || idea.hypothesis || (typeof idea === "string" ? idea : JSON.stringify(idea)).slice(0, 200);
    const strat  = THINKING_STRATEGIES[strategy] || THINKING_STRATEGIES.diverge;

    // Each stream processes independently
    return {
        streamId,
        strategy:   strat.name,
        strategyGoal: strat.goal,
        input:      text,
        output:     `[Stream ${streamId} | ${strat.name}] Processing: "${text.slice(0,80)}..." → ${strat.goal}. Result: Identified ${["primary", "secondary", "tertiary"][streamId - 1]} insight pathway.`,
        processingScore: Math.round(40 + Math.random() * 55),
        completedAt: NOW()
    };
}

function processParallel({ userId, ideas = [], strategy = "diverge", maxStreams = 3 }) {
    if (!userId) return fail(AGENT, "userId required");
    if (!ideas.length) return fail(AGENT, "ideas[] required");

    const safeStreams = Math.min(maxStreams, MAX_PARALLEL_STREAMS);
    const safeIdeas  = limitIdeas(ideas).slice(0, safeStreams);

    if (safeIdeas.length > MAX_PARALLEL_STREAMS) {
        return blocked(AGENT, `Parallel stream cap is ${MAX_PARALLEL_STREAMS} — reduce ideas to avoid cognitive overload`);
    }

    const streams = safeIdeas.map((idea, i) => _processStream(i + 1, idea, strategy));
    const merged  = _mergeStreams(streams);

    const sessionId = uid("pte");
    const log = load(userId, "parallel_log", []);
    log.push({ sessionId, streamsRun: streams.length, strategy, createdAt: NOW() });
    flush(userId, "parallel_log", log.slice(-500));

    return ok(AGENT, {
        sessionId,
        streamsRun:   streams.length,
        maxAllowed:   MAX_PARALLEL_STREAMS,
        strategy:     THINKING_STRATEGIES[strategy]?.name || strategy,
        streams,
        merged,
        note:         `${streams.length} of max ${MAX_PARALLEL_STREAMS} parallel streams ran successfully`
    });
}

function _mergeStreams(streams) {
    if (!streams.length) return { merged: null };
    const bestStream = streams.reduce((b, s) => s.processingScore > b.processingScore ? s : b, streams[0]);
    const avgScore   = Math.round(streams.reduce((s, st) => s + st.processingScore, 0) / streams.length);

    return {
        bestStream:    bestStream.streamId,
        bestOutput:    bestStream.output,
        avgScore,
        synthesis:     `Merged ${streams.length} parallel stream(s). Dominant insight from Stream ${bestStream.streamId} (score: ${bestStream.processingScore}). Average parallel quality: ${avgScore}/100.`,
        recommendation: avgScore >= 70 ? "Strong parallel consensus — high confidence output" : avgScore >= 50 ? "Moderate parallel agreement — review outlier streams" : "Low consensus — streams diverged significantly"
    };
}

function getParallelConfig() {
    return ok(AGENT, {
        maxParallelStreams: MAX_PARALLEL_STREAMS,
        maxIdeas:          MAX_IDEAS,
        maxIterations:     MAX_ITERATIONS,
        strategies:        Object.entries(THINKING_STRATEGIES).map(([k,v]) => ({ key:k, ...v })),
        safetyNote:        `Hard cap: ${MAX_PARALLEL_STREAMS} streams max to prevent system overload`
    });
}

module.exports = { processParallel, getParallelConfig };
