"use strict";
const { ultimateLog, isKillSwitchActive, load, flush, uid, NOW, ok, fail, killed } = require("./_ultimateStore.cjs");

const AGENT = "civilizationSimulator";

// Simulation-only module — models civilizational-scale systems for research,
// planning, and education. NO real-world control actions. Advisory only.

const CIVILISATION_DOMAINS  = ["energy","food","water","health","education","governance","economy","environment","technology","security","culture","infrastructure"];
const SIMULATION_SCENARIOS  = ["business_as_usual","sustainable_transition","rapid_decarbonisation","tech_acceleration","conflict_disruption","pandemic_recovery"];
const TIME_HORIZONS         = ["5_year","10_year","25_year","50_year","100_year"];

function simulateCivilisationState({ scenario = "business_as_usual", timeHorizon = "25_year", domains = CIVILISATION_DOMAINS, startYear }) {
    if (!SIMULATION_SCENARIOS.includes(scenario)) return fail(AGENT, `scenario must be: ${SIMULATION_SCENARIOS.join(", ")}`);
    if (!TIME_HORIZONS.includes(timeHorizon)) return fail(AGENT, `timeHorizon must be: ${TIME_HORIZONS.join(", ")}`);
    if (isKillSwitchActive()) return killed(AGENT);

    const baseYear   = startYear || new Date().getFullYear();
    const yearSpan   = parseInt(timeHorizon.split("_")[0]);
    const stepCount  = Math.min(yearSpan, 10);
    const stepSize   = Math.ceil(yearSpan / stepCount);

    const domainStates = Object.fromEntries(domains.map(d => [d, {
        currentScore:    Math.round(40 + Math.random() * 50),
        projectedScore:  Math.round(30 + Math.random() * 65),
        trend:           ["declining","stable","improving","rapidly_improving"][Math.floor(Math.random()*4)],
        criticalFactors: [`${d}_policy`, `${d}_investment`, `${d}_technology`].slice(0, 2)
    }]));

    const timeline = Array.from({ length: stepCount }, (_, i) => ({
        year:          baseYear + (i + 1) * stepSize,
        globalScore:   Math.round(40 + Math.random() * 55),
        population_B:  parseFloat((8 + (i * 0.1)).toFixed(2)),
        gdp_USD_T:     parseFloat((100 + i * 8 + Math.random() * 10).toFixed(1)),
        temperature_C: parseFloat((1.2 + i * 0.15 + Math.random() * 0.3).toFixed(2)),
        keyEvent:      `${scenario}_milestone_${i+1}`
    }));

    const simulation = {
        simulationId:    uid("civ"),
        scenario,
        timeHorizon,
        baseYear,
        endYear:         baseYear + yearSpan,
        domainStates,
        timeline,
        overallTrajectory: Math.random() > 0.5 ? "improving" : "declining",
        criticalInterventions: domains.slice(0, 3).map(d => `Prioritise ${d} investment`),
        confidence:      Math.round(40 + Math.random() * 45),
        simulatedAt:     NOW(),
        disclaimer:      "Civilisation simulation is for research and planning purposes only. Not a prediction."
    };

    const log = load("civilisation_simulations", []);
    log.push({ simulationId: simulation.simulationId, scenario, timeHorizon, simulatedAt: simulation.simulatedAt });
    flush("civilisation_simulations", log.slice(-100));

    ultimateLog(AGENT, "civilisation_simulated", { scenario, timeHorizon }, "INFO");
    return ok(AGENT, simulation);
}

function getScenarioComparison({ domains = CIVILISATION_DOMAINS.slice(0, 5) }) {
    if (isKillSwitchActive()) return killed(AGENT);

    const comparison = SIMULATION_SCENARIOS.map(scenario => ({
        scenario,
        domains: Object.fromEntries(domains.map(d => [d, { score2050: Math.round(30 + Math.random() * 70), trend: Math.random() > 0.5 ? "positive" : "negative" }])),
        globalScore2050: Math.round(30 + Math.random() * 65),
        temperature2100_C: parseFloat((1.5 + Math.random() * 3).toFixed(2))
    }));

    return ok(AGENT, { domains, scenarios: SIMULATION_SCENARIOS, comparison, comparedAt: NOW() });
}

module.exports = { simulateCivilisationState, getScenarioComparison, CIVILISATION_DOMAINS, SIMULATION_SCENARIOS };
