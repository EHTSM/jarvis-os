"use strict";
const { load, flush, uid, NOW, humanAILog, requireConsent, watermark, ok, fail, blocked } = require("./_humanAIStore.cjs");
const AGENT = "behaviourSimulationAI";

// ⚠️ SIMULATION ONLY — no real person is modelled or their behaviour predicted without consent

const BEHAVIOUR_DOMAINS = ["decision_making","social_interaction","risk_tolerance","learning_style","stress_response","habit_formation","motivation_pattern"];
const SCENARIO_TYPES    = ["professional","social","conflict","opportunity","crisis","routine","novel_challenge"];

function buildBehaviourModel({ userId, consent, modelName, domainInputs = {}, traits = {} }) {
    const gate = requireConsent(consent, "behaviour model creation");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId) return fail(AGENT, "userId required");

    const domainScores = {};
    BEHAVIOUR_DOMAINS.forEach(d => {
        domainScores[d] = domainInputs[d] !== undefined
            ? Math.min(100, Math.max(0, Number(domainInputs[d])))
            : Math.round(30 + Math.random() * 65);
    });

    const model = {
        id:           uid("bm"),
        modelName:    modelName || `BehaviourModel_${uid("bn")}`,
        domainScores,
        traits,
        riskToleranceIndex: domainScores["risk_tolerance"] || 50,
        adaptabilityScore:  Math.round((domainScores["learning_style"] + domainScores["novel_challenge"] || 100) / 2),
        createdAt:    NOW(),
        ...watermark(AGENT)
    };

    const models = load(userId, "behaviour_models", []);
    models.push({ id: model.id, modelName: model.modelName, createdAt: model.createdAt });
    flush(userId, "behaviour_models", models.slice(-100));

    humanAILog(AGENT, userId, "behaviour_model_built", { modelId: model.id }, "INFO");
    return ok(AGENT, model, { notice: "SIMULATION ONLY — probabilistic model, not a deterministic prediction of any real person" });
}

function simulateScenario({ userId, consent, modelId, scenarioType, scenarioDescription }) {
    const gate = requireConsent(consent, "scenario simulation");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId || !modelId) return fail(AGENT, "userId and modelId required");
    if (!SCENARIO_TYPES.includes(scenarioType)) return fail(AGENT, `scenarioType must be: ${SCENARIO_TYPES.join(", ")}`);
    if (!scenarioDescription) return fail(AGENT, "scenarioDescription required");

    const models = load(userId, "behaviour_models", []);
    const model = models.find(m => m.id === modelId);
    if (!model) return fail(AGENT, `modelId ${modelId} not found`);

    const outcomes = ["approach","avoid","delegate","escalate","negotiate","observe_and_wait","improvise"];
    const chosenOutcome = outcomes[Math.floor(Math.random() * outcomes.length)];

    const simulation = {
        id:               uid("sc"),
        modelId,
        scenarioType,
        scenarioDescription: String(scenarioDescription).slice(0, 500),
        predictedResponse:   `[SIMULATED] In a ${scenarioType} scenario, predicted behaviour: ${chosenOutcome}`,
        chosenOutcome,
        confidence:          Math.round(50 + Math.random() * 40),
        alternativeOutcomes: outcomes.filter(o => o !== chosenOutcome).slice(0, 2),
        simulatedAt:         NOW(),
        ...watermark(AGENT)
    };

    humanAILog(AGENT, userId, "behaviour_simulated", { modelId, scenarioType }, "INFO");
    return ok(AGENT, simulation);
}

function listModels({ userId, consent }) {
    const gate = requireConsent(consent, "behaviour model listing");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId) return fail(AGENT, "userId required");

    const models = load(userId, "behaviour_models", []);
    return ok(AGENT, { total: models.length, models, domains: BEHAVIOUR_DOMAINS, scenarioTypes: SCENARIO_TYPES });
}

module.exports = { buildBehaviourModel, simulateScenario, listModels };
