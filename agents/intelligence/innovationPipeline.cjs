"use strict";
const { load, flush, uid, NOW, ok, fail, MAX_IDEAS, limitIdeas } = require("./_intelligenceStore.cjs");
const AGENT = "innovationPipeline";

const INNOVATION_STAGES = [
    { id:"S1", name:"Problem Framing",    output:"Clear problem statement and success criteria" },
    { id:"S2", name:"Insight Generation", output:"Validated insights and patterns from data" },
    { id:"S3", name:"Concept Design",     output:"Conceptual models and solution blueprints" },
    { id:"S4", name:"Prototyping",         output:"Minimum viable representation of concept" },
    { id:"S5", name:"Validation",          output:"Evidence-based assessment of viability" },
    { id:"S6", name:"Scaling Plan",        output:"Roadmap for scaling successful concepts" }
];

const INNOVATION_TYPES = {
    incremental:  { name:"Incremental",   desc:"10% improvement on existing solution",   effort:"LOW",    risk:"LOW"    },
    architectural:{ name:"Architectural", desc:"Reconfigures existing components",        effort:"MEDIUM", risk:"MEDIUM" },
    disruptive:   { name:"Disruptive",    desc:"Creates new market or disrupts incumbent",effort:"HIGH",   risk:"HIGH"   },
    radical:      { name:"Radical",       desc:"Fundamentally new solution from scratch", effort:"HIGH",   risk:"VERY_HIGH" }
};

function buildInnovationPlan({ userId, goal, ideas = [], type = "incremental" }) {
    if (!userId || !goal) return fail(AGENT, "userId and goal required");
    if (!INNOVATION_TYPES[type]) return fail(AGENT, `type must be: ${Object.keys(INNOVATION_TYPES).join(", ")}`);

    const safeIdeas   = limitIdeas(ideas);
    const innovType   = INNOVATION_TYPES[type];
    const planId      = uid("inn");

    const stages = INNOVATION_STAGES.map((stage, i) => {
        const relevantIdea = safeIdeas[i % Math.max(safeIdeas.length, 1)];
        return {
            stageId:  stage.id,
            name:     stage.name,
            output:   stage.output,
            activity: `Apply ${innovType.name} innovation to "${goal}": ${stage.output.toLowerCase()}. ${relevantIdea ? `Building on: "${(relevantIdea.thought || relevantIdea.idea || "").slice(0, 60)}"` : ""}`,
            duration: ["1 week","2 weeks","3 weeks","4 weeks","2 weeks","4 weeks"][i],
            status:   "PLANNED"
        };
    });

    const plan = {
        planId,
        goal,
        innovationType:  innovType.name,
        typeDescription: innovType.desc,
        effort:          innovType.effort,
        risk:            innovType.risk,
        stages,
        totalDuration:   "16 weeks",
        successMetrics:  ["Hypothesis validated with real data", "MVP tested with 10+ users", "Measurable improvement achieved"],
        ideasIncorporated: safeIdeas.length,
        createdAt:       NOW()
    };

    const registry = load(userId, "innovation_registry", []);
    registry.push({ planId, goal, type, stage: "PLANNED", createdAt: NOW() });
    flush(userId, "innovation_registry", registry.slice(-500));

    return ok(AGENT, plan);
}

function advanceStage({ userId, planId, stageId, evidence, outcome }) {
    if (!userId || !planId || !stageId) return fail(AGENT, "userId, planId, and stageId required");

    const registry = load(userId, "innovation_registry", []);
    const plan     = registry.find(p => p.planId === planId);
    if (!plan) return fail(AGENT, `Plan ${planId} not found`);

    plan.currentStage = stageId;
    plan.lastEvidence = evidence || null;
    plan.lastOutcome  = outcome  || null;
    plan.updatedAt    = NOW();
    flush(userId, "innovation_registry", registry);

    const stage = INNOVATION_STAGES.find(s => s.id === stageId);
    return ok(AGENT, { planId, advanced: true, newStage: stageId, stageName: stage?.name, updatedAt: plan.updatedAt });
}

function getInnovationTypes() {
    return ok(AGENT, { types: Object.entries(INNOVATION_TYPES).map(([k,v]) => ({ key:k, ...v })), stages: INNOVATION_STAGES });
}

module.exports = { buildInnovationPlan, advanceStage, getInnovationTypes };
