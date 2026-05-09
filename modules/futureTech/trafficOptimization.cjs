"use strict";
const { load, flush, ftLog, uid, NOW, simValue, simConfidence, requireApproval, ok, fail } = require("./_futureTechStore.cjs");

const AGENT = "trafficOptimization";

const JUNCTION_TYPES   = ["signalized","roundabout","interchange","pedestrian","school_zone","highway_ramp"];
const CONGESTION_BANDS = { free_flow:[0,20], light:[20,40], moderate:[40,60], heavy:[60,80], gridlock:[80,100] };
const SIGNAL_PHASES    = ["north_south_green","east_west_green","pedestrian","all_red","emergency_override"];
const OPTIMISATION_MODES = ["fixed_time","actuated","adaptive","coordinated","ai_optimised"];

function _getCongestionBand(pct) {
    for (const [band, [min, max]] of Object.entries(CONGESTION_BANDS)) {
        if (pct >= min && pct < max) return band;
    }
    return "gridlock";
}

function analyseNetworkCongestion({ userId, cityId, sectorIds = [] }) {
    if (!userId) return fail(AGENT, "userId required");

    const sectorCount = sectorIds.length || Math.floor(simValue(5, 20, 0));
    const sectors = Array.from({ length: sectorCount }, (_, i) => {
        const congPct = simValue(0, 100);
        return {
            sectorId:        sectorIds[i] || `SEC-${i+1}`,
            congestion_pct:  parseFloat(congPct.toFixed(1)),
            band:            _getCongestionBand(congPct),
            avgSpeed_kph:    parseFloat((120 * (1 - congPct/100)).toFixed(1)),
            volume_veh_hr:   Math.round(simValue(100, 3000, 0)),
            incidents:       Math.floor(Math.random() * 3),
            travelTimeIndex: parseFloat(simValue(1.0, 4.0, 2))
        };
    });

    const networkCongestion = parseFloat((sectors.reduce((s,r) => s + r.congestion_pct, 0) / sectors.length).toFixed(1));

    const analysis = {
        analysisId:       uid("tra"),
        cityId:           cityId || "default_city",
        networkCongestion_pct: networkCongestion,
        networkBand:      _getCongestionBand(networkCongestion),
        sectors,
        hotspots:         sectors.filter(s => s.congestion_pct > 70).map(s => s.sectorId),
        totalIncidents:   sectors.reduce((s, r) => s + r.incidents, 0),
        confidence:       simConfidence(),
        analysedAt:       NOW()
    };

    const log = load(`traffic_log_${cityId || "default"}`, []);
    log.push({ analysisId: analysis.analysisId, networkCongestion_pct: networkCongestion, analysedAt: analysis.analysedAt });
    flush(`traffic_log_${cityId || "default"}`, log.slice(-2000));

    ftLog(AGENT, userId, "congestion_analysed", { cityId: analysis.cityId, networkCongestion_pct: networkCongestion }, "INFO");
    return ok(AGENT, analysis);
}

function optimiseSignalTiming({ userId, junctionId, junctionType = "signalized", mode = "adaptive", volumes = {} }) {
    if (!userId) return fail(AGENT, "userId required");
    if (!JUNCTION_TYPES.includes(junctionType)) return fail(AGENT, `junctionType must be: ${JUNCTION_TYPES.join(", ")}`);
    if (!OPTIMISATION_MODES.includes(mode)) return fail(AGENT, `mode must be: ${OPTIMISATION_MODES.join(", ")}`);

    const optimised = {
        optimisationId: uid("sig"),
        junctionId:     junctionId || `JCT-${uid("j")}`,
        junctionType,
        mode,
        currentPhases:  SIGNAL_PHASES.slice(0, 4).map(p => ({ phase: p, duration_s: Math.round(simValue(15, 60, 0)) })),
        optimisedPhases: SIGNAL_PHASES.slice(0, 4).map(p => ({ phase: p, duration_s: Math.round(simValue(15, 60, 0)) })),
        metrics: {
            delayReduction_pct: parseFloat(simValue(5, 40, 1)),
            throughputIncrease_pct: parseFloat(simValue(5, 30, 1)),
            emissionReduction_pct:  parseFloat(simValue(3, 20, 1))
        },
        actionNote:  "Suggestion only — call applySignalControl() with approved:true to apply to live signals",
        optimisedAt: NOW()
    };

    ftLog(AGENT, userId, "signal_optimised", { junctionId: optimised.junctionId, mode }, "INFO");
    return ok(AGENT, optimised);
}

function applySignalControl({ userId, junctionId, phaseConfig, approved }) {
    const gate = requireApproval(approved, `apply signal control to live junction ${junctionId}`);
    if (gate) return gate;
    if (!userId || !junctionId || !phaseConfig) return fail(AGENT, "userId, junctionId, and phaseConfig required");

    const control = { controlId: uid("ctl"), junctionId, phaseConfig, appliedBy: userId, appliedAt: NOW() };
    ftLog(AGENT, userId, "SIGNAL_CONTROL_APPLIED", { junctionId }, "WARN");
    return ok(AGENT, control, "approved_control");
}

function getTrafficForecast({ userId, cityId, hours = 6 }) {
    if (!userId) return fail(AGENT, "userId required");
    const forecast = Array.from({ length: hours }, (_, i) => ({
        hour:    new Date(Date.now() + i*3600000).toISOString().slice(11,16),
        congestion_pct: parseFloat(simValue(10, 90).toFixed(1)),
        band:    _getCongestionBand(simValue(10, 90))
    }));
    return ok(AGENT, { cityId: cityId || "default", hoursAhead: hours, forecast, note: "Simulated forecast — integrate traffic APIs for real data" });
}

module.exports = { analyseNetworkCongestion, optimiseSignalTiming, applySignalControl, getTrafficForecast };
