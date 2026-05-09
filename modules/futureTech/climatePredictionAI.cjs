"use strict";
const { load, flush, ftLog, uid, NOW, simValue, simConfidence, ok, fail } = require("./_futureTechStore.cjs");

const AGENT = "climatePredictionAI";

const CLIMATE_MODELS   = ["CMIP6","RegCM","WRF","ECMWF_IFS","NASA_GISS","HADGEM3","ACCESS_CM2"];
const SCENARIOS        = ["SSP1-2.6","SSP2-4.5","SSP3-7.0","SSP5-8.5"];
const CLIMATE_VARS     = ["temperature","precipitation","humidity","wind_speed","sea_level","ice_extent","co2_ppm","ch4_ppb"];
const TIMESCALES       = ["decadal","centennial","seasonal","interannual"];
const TIPPING_ELEMENTS = ["AMOC_collapse","Amazon_dieback","WAIS_destabilisation","permafrost_thaw","coral_bleaching","Greenland_melt","boreal_forest_shift","monsoon_disruption"];

function predictClimate({ userId, region, scenario = "SSP2-4.5", model = "CMIP6", timescale = "decadal", horizonYears = 30 }) {
    if (!userId) return fail(AGENT, "userId required");
    if (!SCENARIOS.includes(scenario)) return fail(AGENT, `scenario must be: ${SCENARIOS.join(", ")}`);
    if (!TIMESCALES.includes(timescale)) return fail(AGENT, `timescale must be: ${TIMESCALES.join(", ")}`);

    const steps  = timescale === "seasonal" ? 4 : timescale === "interannual" ? 10 : timescale === "decadal" ? Math.ceil(horizonYears / 10) : Math.ceil(horizonYears / 100);
    const stepLabel = { seasonal:"season", interannual:"year", decadal:"decade", centennial:"century" }[timescale];

    const projection = Array.from({ length: steps }, (_, i) => ({
        step:               i + 1,
        label:              `${stepLabel}_${i+1}`,
        temperature_delta_C: parseFloat(simValue(0.1, 4.5, 2)),
        precipitation_delta_pct: parseFloat(simValue(-30, 30, 1)),
        sealevel_rise_mm:   parseFloat(simValue(0, 2000, 1)),
        extremeEventIndex:  parseFloat(simValue(1.0, 5.0, 2)),
        confidence_pct:     Math.max(30, 95 - i * (90 / steps))
    }));

    const variables = Object.fromEntries(CLIMATE_VARS.map(v => [v, {
        baseline:   parseFloat(simValue(0, 100, 2)),
        projected:  parseFloat(simValue(0, 120, 2)),
        delta_pct:  parseFloat(simValue(-20, 40, 1)),
        trend:      Math.random() > 0.4 ? "increasing" : "decreasing"
    }]));

    const prediction = {
        predictionId:    uid("clim"),
        region:          region || "global",
        scenario,
        model,
        timescale,
        horizonYears,
        overallWarming_C: parseFloat(simValue(0.5, 4.5, 2)),
        riskLevel:        ["low","moderate","high","severe","catastrophic"][Math.floor(Math.random() * 5)],
        projection,
        variables,
        confidence:      simConfidence(),
        generatedAt:     NOW(),
        note:            "Simulated projection — integrate CMIP6/ECMWF data pipelines for operational use"
    };

    const log = load(`climate_predictions_${region || "global"}`, []);
    log.push({ predictionId: prediction.predictionId, scenario, model, overallWarming_C: prediction.overallWarming_C, generatedAt: prediction.generatedAt });
    flush(`climate_predictions_${region || "global"}`, log.slice(-500));

    ftLog(AGENT, userId, "climate_predicted", { region, scenario, model, horizonYears }, "INFO");
    return ok(AGENT, prediction);
}

function analyseExtremeEvents({ userId, region, eventType, periodYears = 10 }) {
    if (!userId) return fail(AGENT, "userId required");
    const EVENT_TYPES = ["heatwave","drought","flood","hurricane","wildfire","blizzard","tornado","ice_storm"];
    if (eventType && !EVENT_TYPES.includes(eventType)) return fail(AGENT, `eventType must be: ${EVENT_TYPES.join(", ")}`);

    const types = eventType ? [eventType] : EVENT_TYPES;
    const events = types.map(type => ({
        type,
        historicalFreq_per_decade: parseFloat(simValue(0.5, 20, 1)),
        projectedFreq_per_decade:  parseFloat(simValue(1, 40, 1)),
        frequencyIncrease_pct:     parseFloat(simValue(0, 200, 1)),
        intensityIncrease_pct:     parseFloat(simValue(0, 80, 1)),
        affectedArea_km2:          Math.round(simValue(1000, 5000000, 0)),
        economicLoss_USD_billion:  parseFloat(simValue(0.1, 500, 2)),
        confidence:                simConfidence()
    }));

    ftLog(AGENT, userId, "extreme_events_analysed", { region, eventType, periodYears }, "INFO");
    return ok(AGENT, { region: region || "global", periodYears, events, eventTypes: EVENT_TYPES, analysedAt: NOW() });
}

function getTippingPointRisk({ userId, elements = TIPPING_ELEMENTS }) {
    if (!userId) return fail(AGENT, "userId required");
    const invalid = elements.filter(e => !TIPPING_ELEMENTS.includes(e));
    if (invalid.length) return fail(AGENT, `invalid tipping elements: ${invalid.join(",")}. Valid: ${TIPPING_ELEMENTS.join(", ")}`);

    const risks = elements.map(el => ({
        element:            el,
        probability_pct:    parseFloat(simValue(5, 85, 1)),
        triggerTemp_C:      parseFloat(simValue(1.0, 4.5, 2)),
        timeToTrigger_yrs:  Math.round(simValue(5, 200, 0)),
        cascadeRisk:        Math.random() > 0.5 ? "high" : "moderate",
        irreversible:       Math.random() > 0.3
    }));

    const highRisk = risks.filter(r => r.probability_pct > 60).map(r => r.element);
    ftLog(AGENT, userId, "tipping_points_assessed", { elementCount: elements.length }, "INFO");
    return ok(AGENT, { elements: risks, highRiskElements: highRisk, tippingElementCatalog: TIPPING_ELEMENTS, assessedAt: NOW() });
}

function getClimateScenarioComparison({ userId, region, scenarios = SCENARIOS }) {
    if (!userId) return fail(AGENT, "userId required");
    const comparison = scenarios.map(s => ({
        scenario:          s,
        warming2100_C:     parseFloat(simValue(1.0, 5.0, 2)),
        seaRise2100_mm:    Math.round(simValue(200, 2000, 0)),
        gdpImpact_pct:     parseFloat(simValue(-20, -1, 2)),
        biodiversityLoss_pct: parseFloat(simValue(10, 70, 1)),
        displacedPeople_M:    parseFloat(simValue(50, 1000, 1)),
        confidence:        simConfidence()
    }));

    ftLog(AGENT, userId, "scenario_comparison_done", { region, scenarioCount: scenarios.length }, "INFO");
    return ok(AGENT, { region: region || "global", comparison, scenarios: SCENARIOS, models: CLIMATE_MODELS, variables: CLIMATE_VARS, comparedAt: NOW() });
}

module.exports = { predictClimate, analyseExtremeEvents, getTippingPointRisk, getClimateScenarioComparison };
