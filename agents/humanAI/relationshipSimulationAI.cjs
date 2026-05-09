"use strict";
const { load, flush, uid, NOW, humanAILog, requireConsent, watermark, ok, fail, blocked } = require("./_humanAIStore.cjs");
const AGENT = "relationshipSimulationAI";

// ⚠️ SIMULATION ONLY — for social skill practice and empathy training only
// NOT a replacement for real human relationships

const RELATIONSHIP_TYPES = ["friendship","mentorship","professional","family","romantic_simulation","conflict_practice","networking"];
const DYNAMIC_FACTORS    = ["trust","communication","conflict_resolution","empathy","boundary_setting","appreciation","shared_goals"];
const SCENARIO_CONTEXTS  = ["first_meeting","deep_conversation","disagreement","celebration","difficult_news","collaboration","casual_chat"];

const RELATIONSHIP_BOUNDARY_NOTICE =
    "⚠️ RELATIONSHIP SIMULATION — This is a social practice tool only. " +
    "Romantic simulations are for skill-building purposes exclusively. " +
    "This does NOT replace real human connection or professional counselling.";

function createRelationshipSim({ userId, consent, simName, relationshipType = "friendship", dynamicWeights = {}, persona = {} }) {
    const gate = requireConsent(consent, "relationship simulation creation");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId) return fail(AGENT, "userId required");
    if (!RELATIONSHIP_TYPES.includes(relationshipType)) return fail(AGENT, `relationshipType must be: ${RELATIONSHIP_TYPES.join(", ")}`);

    const dynamics = {};
    DYNAMIC_FACTORS.forEach(f => {
        dynamics[f] = dynamicWeights[f] !== undefined ? Math.min(100, Math.max(0, Number(dynamicWeights[f]))) : Math.round(40 + Math.random() * 50);
    });
    const healthScore = Math.round(Object.values(dynamics).reduce((a,b)=>a+b,0) / DYNAMIC_FACTORS.length);

    const sim = {
        id:              uid("rs"),
        simName:         simName || `RelSim_${uid("rn")}`,
        relationshipType,
        dynamics,
        healthScore,
        healthBand:      healthScore >= 75 ? "thriving" : healthScore >= 50 ? "stable" : healthScore >= 25 ? "struggling" : "at_risk",
        persona:         { name: persona.name || "SimPersona", traits: persona.traits || [] },
        createdAt:       NOW(),
        ...watermark(AGENT)
    };

    const sims = load(userId, "relationship_sims", []);
    sims.push({ id: sim.id, simName: sim.simName, relationshipType, healthScore, persona: sim.persona, dynamics: sim.dynamics, createdAt: sim.createdAt });
    flush(userId, "relationship_sims", sims.slice(-100));

    humanAILog(AGENT, userId, "relationship_sim_created", { simId: sim.id, relationshipType, healthScore }, "INFO");
    return ok(AGENT, sim, { boundaryNotice: RELATIONSHIP_BOUNDARY_NOTICE });
}

function practiceScenario({ userId, consent, simId, scenarioContext, userInput }) {
    const gate = requireConsent(consent, "relationship scenario practice");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId || !simId) return fail(AGENT, "userId and simId required");
    if (!SCENARIO_CONTEXTS.includes(scenarioContext)) return fail(AGENT, `scenarioContext must be: ${SCENARIO_CONTEXTS.join(", ")}`);
    if (!userInput) return fail(AGENT, "userInput required");

    const sims = load(userId, "relationship_sims", []);
    const sim = sims.find(s => s.id === simId);
    if (!sim) return fail(AGENT, `simId ${simId} not found`);

    const SCENARIO_OPENERS = {
        first_meeting:       "Nice to meet you! What brings you here?",
        deep_conversation:   "I've been thinking about something important — can we talk?",
        disagreement:        "I feel differently about this. Can I share my perspective?",
        celebration:         "I'm so happy for you! Tell me everything!",
        difficult_news:      "I need to share something that's been weighing on me.",
        collaboration:       "Let's figure this out together — what do you think we should do first?",
        casual_chat:         "Hey! How's things? Anything interesting happening lately?"
    };

    const practice = {
        id:              uid("prac"),
        simId,
        scenarioContext,
        relationshipType: sim.relationshipType,
        personaName:     sim.persona.name,
        userInput:       String(userInput).slice(0, 500),
        simulatedResponse: `[${sim.persona.name} — ${sim.relationshipType}] ${SCENARIO_OPENERS[scenarioContext]}`,
        empathyFeedback:   `[FEEDBACK] Consider: ${["acknowledging their perspective","asking a follow-up question","sharing your own experience","validating their feelings"][Math.floor(Math.random()*4)]}`,
        practiceScore:     Math.round(55 + Math.random() * 43),
        practicedAt:       NOW(),
        ...watermark(AGENT)
    };

    humanAILog(AGENT, userId, "relationship_scenario_practised", { simId, scenarioContext }, "INFO");
    return ok(AGENT, practice, { boundaryNotice: RELATIONSHIP_BOUNDARY_NOTICE });
}

function getDynamicsReport({ userId, consent, simId }) {
    const gate = requireConsent(consent, "relationship dynamics report");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId || !simId) return fail(AGENT, "userId and simId required");

    const sims = load(userId, "relationship_sims", []);
    const sim = sims.find(s => s.id === simId);
    if (!sim) return fail(AGENT, `simId ${simId} not found`);

    return ok(AGENT, { ...sim, reportedAt: NOW() });
}

function listSims({ userId, consent }) {
    const gate = requireConsent(consent, "relationship sim listing");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId) return fail(AGENT, "userId required");

    const sims = load(userId, "relationship_sims", []);
    return ok(AGENT, { total: sims.length, sims, relationshipTypes: RELATIONSHIP_TYPES, scenarioContexts: SCENARIO_CONTEXTS });
}

module.exports = { createRelationshipSim, practiceScenario, getDynamicsReport, listSims };
