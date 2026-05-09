"use strict";
const { load, flush, loadUser, flushUser, ftLog, uid, NOW, simValue, simConfidence, ok, fail } = require("./_futureTechStore.cjs");

const AGENT = "carbonTrackingAgent";

const EMISSION_SECTORS  = ["energy","transport","industry","agriculture","buildings","waste","land_use","aviation","shipping"];
const GHG_TYPES         = ["CO2","CH4","N2O","HFC","PFC","SF6","NF3"];
const SCOPE_TYPES       = [1,2,3];
const OFFSET_TYPES      = ["reforestation","blue_carbon","direct_air_capture","biochar","soil_carbon","enhanced_weathering","ocean_alkalinity"];
const REPORTING_STDS    = ["GHG_Protocol","ISO_14064","TCFD","CDP","SBTi","GRI"];

function trackEmissions({ userId, entityId, entityType = "organisation", period = "monthly", scopes = SCOPE_TYPES }) {
    if (!userId) return fail(AGENT, "userId required");
    const invalidScopes = scopes.filter(s => !SCOPE_TYPES.includes(s));
    if (invalidScopes.length) return fail(AGENT, `invalid scopes: ${invalidScopes.join(",")}. Valid: 1, 2, 3`);

    const emissions = {};
    scopes.forEach(scope => {
        emissions[`scope${scope}`] = {
            total_tCO2e:   parseFloat(simValue(10, 50000, 2)),
            byGHG:         Object.fromEntries(GHG_TYPES.map(g => [g, parseFloat(simValue(0, 5000, 2))])),
            bySector:      Object.fromEntries(EMISSION_SECTORS.map(s => [s, parseFloat(simValue(0, 10000, 2))])),
            verificationStatus: ["pending","verified","third_party_verified"][Math.floor(Math.random()*3)]
        };
    });

    const totalCO2e = parseFloat(Object.values(emissions).reduce((s, e) => s + e.total_tCO2e, 0).toFixed(2));
    const record = {
        trackingId:   uid("carb"),
        entityId:     entityId || `entity_${uid("e")}`,
        entityType,
        period,
        reportingYear: new Date().getFullYear(),
        emissions,
        totalCO2e,
        intensity:    parseFloat(simValue(0.1, 100, 3)),
        trend:        Math.random() > 0.5 ? "increasing" : "decreasing",
        confidence:   simConfidence(),
        trackedAt:    NOW()
    };

    const history = loadUser(userId, "emission_records", []);
    history.push({ trackingId: record.trackingId, entityId, totalCO2e, trackedAt: record.trackedAt });
    flushUser(userId, "emission_records", history.slice(-1000));

    ftLog(AGENT, userId, "emissions_tracked", { entityId, totalCO2e, period }, "INFO");
    return ok(AGENT, record);
}

function calculateCarbonFootprint({ userId, activities }) {
    if (!userId) return fail(AGENT, "userId required");
    if (!activities || !Array.isArray(activities)) return fail(AGENT, "activities array required");

    const breakdown = activities.map(act => ({
        activity:    act.activity || "unknown",
        quantity:    act.quantity || 1,
        unit:        act.unit || "unit",
        emissionFactor_kgCO2e: parseFloat(simValue(0.01, 50, 4)),
        total_kgCO2e: parseFloat(simValue(0.1, 10000, 2)),
        sector:      EMISSION_SECTORS[Math.floor(Math.random() * EMISSION_SECTORS.length)],
        ghgType:     GHG_TYPES[Math.floor(Math.random() * GHG_TYPES.length)]
    }));

    const totalKgCO2e = parseFloat(breakdown.reduce((s, b) => s + b.total_kgCO2e, 0).toFixed(2));
    const footprint = {
        footprintId:  uid("fp"),
        totalKgCO2e,
        totalTCO2e:   parseFloat((totalKgCO2e / 1000).toFixed(4)),
        breakdown,
        offsetRequired_tCO2e: parseFloat((totalKgCO2e / 1000).toFixed(4)),
        calculatedAt: NOW(),
        note:         "Simulated emission factors — integrate DEFRA/EPA factor databases for operational accuracy"
    };

    ftLog(AGENT, userId, "footprint_calculated", { activityCount: activities.length, totalKgCO2e }, "INFO");
    return ok(AGENT, footprint);
}

function getOffsetOpportunities({ userId, targetTCO2e, offsetTypes = OFFSET_TYPES, budget_USD }) {
    if (!userId) return fail(AGENT, "userId required");
    const invalidTypes = offsetTypes.filter(t => !OFFSET_TYPES.includes(t));
    if (invalidTypes.length) return fail(AGENT, `invalid offsetTypes: ${invalidTypes.join(",")}. Valid: ${OFFSET_TYPES.join(", ")}`);

    const opportunities = offsetTypes.map(type => {
        const pricePerTon = parseFloat(simValue(3, 500, 2));
        const available_tCO2e = Math.round(simValue(100, 1000000, 0));
        return {
            type,
            pricePerTon_USD:   pricePerTon,
            available_tCO2e,
            permanence:        ["temporary","long_term","permanent"][Math.floor(Math.random()*3)],
            additionalBenefits:["biodiversity","water_quality","community_development"].slice(0, Math.floor(Math.random()*3)+1),
            verificationStandard: ["VCS","Gold_Standard","CCBS","ACR"][Math.floor(Math.random()*4)],
            totalCost_USD:     budget_USD ? Math.min(budget_USD, parseFloat((pricePerTon * (targetTCO2e || 100)).toFixed(2))) : parseFloat((pricePerTon * (targetTCO2e || 100)).toFixed(2))
        };
    });

    opportunities.sort((a, b) => a.pricePerTon_USD - b.pricePerTon_USD);
    ftLog(AGENT, userId, "offsets_found", { targetTCO2e, typeCount: offsetTypes.length }, "INFO");
    return ok(AGENT, { targetTCO2e: targetTCO2e || null, opportunities, offsetTypes: OFFSET_TYPES, reportingStandards: REPORTING_STDS, foundAt: NOW() });
}

function generateEmissionReport({ userId, entityId, standard = "GHG_Protocol", year }) {
    if (!userId) return fail(AGENT, "userId required");
    if (!REPORTING_STDS.includes(standard)) return fail(AGENT, `standard must be: ${REPORTING_STDS.join(", ")}`);

    const reportYear = year || new Date().getFullYear() - 1;
    const history    = loadUser(userId, "emission_records", []);
    const relevant   = history.filter(r => r.trackedAt && r.trackedAt.startsWith(String(reportYear)));

    const report = {
        reportId:        uid("rpt"),
        entityId:        entityId || `entity_${uid("e")}`,
        reportingStandard: standard,
        reportYear,
        totalScope1_tCO2e: parseFloat(simValue(100, 10000, 2)),
        totalScope2_tCO2e: parseFloat(simValue(50, 8000, 2)),
        totalScope3_tCO2e: parseFloat(simValue(200, 50000, 2)),
        emissionIntensity: parseFloat(simValue(0.5, 50, 3)),
        reductionVsBaseline_pct: parseFloat(simValue(-10, 40, 1)),
        ghgTypes:        GHG_TYPES,
        sectors:         EMISSION_SECTORS,
        dataPoints:      relevant.length,
        verificationStatus: "self_reported",
        generatedAt:     NOW()
    };

    ftLog(AGENT, userId, "emission_report_generated", { entityId, standard, reportYear }, "INFO");
    return ok(AGENT, report);
}

module.exports = { trackEmissions, calculateCarbonFootprint, getOffsetOpportunities, generateEmissionReport };
