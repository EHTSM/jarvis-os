"use strict";
const { load, flush, ftLog, uid, NOW, simValue, simConfidence, requireApproval, ok, fail } = require("./_futureTechStore.cjs");

const AGENT = "energyGridAI";

const GRID_ZONES      = ["residential","commercial","industrial","agricultural","transmission"];
const ENERGY_SOURCES  = ["coal","natural_gas","nuclear","hydro","solar","wind","battery","import"];
const STABILITY_BANDS = { critical:[0,30], unstable:[30,50], marginal:[50,70], stable:[70,90], optimal:[90,100] };

function _stabilityBand(pct) {
    for (const [band,[min,max]] of Object.entries(STABILITY_BANDS)) {
        if (pct >= min && pct < max) return band;
    }
    return "optimal";
}

function getGridStatus({ userId, gridId }) {
    if (!userId) return fail(AGENT, "userId required");

    const stability = simValue(30, 100);
    const status = {
        statusId:       uid("gs"),
        gridId:         gridId || "national_grid",
        frequency_hz:   parseFloat((50 + simValue(-0.5, 0.5, 3)).toFixed(3)),
        voltage_kV:     parseFloat((400 + simValue(-5, 5, 1)).toFixed(1)),
        totalDemand_MW: Math.round(simValue(5000, 50000, 0)),
        totalSupply_MW: Math.round(simValue(5000, 55000, 0)),
        stability_pct:  parseFloat(stability.toFixed(1)),
        stabilityBand:  _stabilityBand(stability),
        renewableShare_pct: parseFloat(simValue(10, 85, 1)),
        sources:        Object.fromEntries(ENERGY_SOURCES.map(s => [s, { output_MW: Math.round(simValue(0, 5000, 0)), online: Math.random() > 0.1 }])),
        activeFaults:   Math.floor(Math.random() * 5),
        loadShedding:   stability < 40,
        checkedAt:      NOW()
    };

    const history = load(`grid_history_${gridId || "national"}`, []);
    history.push({ statusId: status.statusId, stability_pct: status.stability_pct, stabilityBand: status.stabilityBand, checkedAt: status.checkedAt });
    flush(`grid_history_${gridId || "national"}`, history.slice(-5000));

    ftLog(AGENT, userId, "grid_status_checked", { gridId: status.gridId, stability_pct: status.stability_pct }, "INFO");
    return ok(AGENT, status);
}

function optimiseDistribution({ userId, gridId, zones = GRID_ZONES, peakShaving = false }) {
    if (!userId) return fail(AGENT, "userId required");
    const invalidZones = zones.filter(z => !GRID_ZONES.includes(z));
    if (invalidZones.length) return fail(AGENT, `invalid zones: ${invalidZones.join(",")}. Valid: ${GRID_ZONES.join(", ")}`);

    const optimisation = {
        optimisationId:    uid("gopt"),
        gridId:            gridId || "national_grid",
        peakShaving,
        zoneAllocations:   Object.fromEntries(zones.map(z => [z, {
            currentLoad_MW:    Math.round(simValue(100, 5000, 0)),
            optimisedLoad_MW:  Math.round(simValue(100, 4500, 0)),
            savingPercent:     parseFloat(simValue(2, 20, 1)),
            priority:          Math.floor(simValue(1, 5, 0))
        }])),
        totalSaving_MW:    parseFloat(simValue(50, 2000, 0)),
        co2Reduction_tCO2: parseFloat(simValue(10, 500, 1)),
        confidence:        simConfidence(),
        actionNote:        "Call applyGridControl() with approved:true to implement on live grid",
        optimisedAt:       NOW()
    };

    ftLog(AGENT, userId, "distribution_optimised", { gridId: optimisation.gridId, zones: zones.length }, "INFO");
    return ok(AGENT, optimisation);
}

function applyGridControl({ userId, gridId, controlActions, approved }) {
    const gate = requireApproval(approved, `apply grid control actions to ${gridId}`);
    if (gate) return gate;
    if (!userId || !gridId || !controlActions) return fail(AGENT, "userId, gridId, and controlActions required");

    const control = { controlId: uid("gc"), gridId, controlActions, appliedBy: userId, appliedAt: NOW() };
    ftLog(AGENT, userId, "GRID_CONTROL_APPLIED", { gridId, actionCount: Array.isArray(controlActions) ? controlActions.length : 1 }, "WARN");
    return ok(AGENT, control, "approved_control");
}

function forecastDemand({ userId, gridId, hours = 24 }) {
    if (!userId) return fail(AGENT, "userId required");
    const forecast = Array.from({ length: hours }, (_, i) => ({
        hour:       new Date(Date.now() + i*3600000).toISOString().slice(11,16),
        demand_MW:  Math.round(simValue(3000, 50000, 0)),
        renewableAvail_pct: parseFloat(simValue(5, 80, 1))
    }));
    return ok(AGENT, { gridId: gridId || "national", hoursAhead: hours, forecast, sources: ENERGY_SOURCES });
}

module.exports = { getGridStatus, optimiseDistribution, applyGridControl, forecastDemand };
