"use strict";
const { load, flush, ftLog, uid, NOW, simValue, simConfidence, requireApproval, ok, fail } = require("./_futureTechStore.cjs");

const AGENT = "disasterPredictionAI";

const DISASTER_TYPES  = ["earthquake","tsunami","hurricane","tornado","flood","wildfire","landslide","volcanic_eruption","drought","blizzard","heatwave","pandemic"];
const RISK_LEVELS     = ["negligible","low","moderate","high","critical","catastrophic"];
const ALERT_LEVELS    = ["green","yellow","orange","red","purple"];
const POPULATION_ZONES = ["urban","suburban","rural","coastal","mountainous","floodplain","seismic_zone","fire_prone"];

function _riskLevel(probability_pct) {
    if (probability_pct < 5)  return "negligible";
    if (probability_pct < 20) return "low";
    if (probability_pct < 40) return "moderate";
    if (probability_pct < 65) return "high";
    if (probability_pct < 85) return "critical";
    return "catastrophic";
}

function _alertLevel(risk) {
    const map = { negligible:"green", low:"green", moderate:"yellow", high:"orange", critical:"red", catastrophic:"purple" };
    return map[risk] || "yellow";
}

function predictDisasterRisk({ userId, region, disasterTypes = DISASTER_TYPES, horizonDays = 30 }) {
    if (!userId) return fail(AGENT, "userId required");
    const invalid = disasterTypes.filter(d => !DISASTER_TYPES.includes(d));
    if (invalid.length) return fail(AGENT, `invalid disaster types: ${invalid.join(",")}. Valid: ${DISASTER_TYPES.join(", ")}`);

    const risks = disasterTypes.map(type => {
        const probability = parseFloat(simValue(1, 90, 1));
        const risk        = _riskLevel(probability);
        return {
            type,
            probability_pct:      probability,
            riskLevel:            risk,
            alertLevel:           _alertLevel(risk),
            expectedMagnitude:    parseFloat(simValue(1, 10, 1)),
            potentialImpactZone_km2: Math.round(simValue(10, 500000, 0)),
            estimatedCasualties:  Math.round(simValue(0, 100000, 0)),
            economicDamage_USD_B: parseFloat(simValue(0.01, 500, 2)),
            timeToEvent_days:     parseFloat(simValue(1, horizonDays, 1)),
            confidence:           simConfidence()
        };
    });

    const highestRisk = risks.sort((a, b) => b.probability_pct - a.probability_pct)[0];

    const prediction = {
        predictionId:   uid("dis"),
        region:         region || "global",
        horizonDays,
        overallAlertLevel: _alertLevel(_riskLevel(highestRisk.probability_pct)),
        risks,
        highestThreat:  highestRisk.type,
        totalHighRisk:  risks.filter(r => ["high","critical","catastrophic"].includes(r.riskLevel)).length,
        generatedAt:    NOW(),
        note:           "Simulated prediction — integrate seismic/meteorological sensor networks for operational use"
    };

    const log = load(`disaster_log_${region || "global"}`, []);
    log.push({ predictionId: prediction.predictionId, region, highestThreat: prediction.highestThreat, generatedAt: prediction.generatedAt });
    flush(`disaster_log_${region || "global"}`, log.slice(-1000));

    ftLog(AGENT, userId, "disaster_risk_predicted", { region, disasterTypeCount: disasterTypes.length, highestThreat: prediction.highestThreat }, "INFO");
    return ok(AGENT, prediction);
}

function getEarlyWarning({ userId, region, disasterType }) {
    if (!userId) return fail(AGENT, "userId required");
    if (!DISASTER_TYPES.includes(disasterType)) return fail(AGENT, `disasterType must be: ${DISASTER_TYPES.join(", ")}`);

    const probability = parseFloat(simValue(10, 95, 1));
    const risk        = _riskLevel(probability);
    const alert       = _alertLevel(risk);

    const warning = {
        warningId:       uid("warn"),
        region:          region || "global",
        disasterType,
        alertLevel:      alert,
        riskLevel:       risk,
        probability_pct: probability,
        estimatedOnset:  new Date(Date.now() + simValue(3600000, 259200000, 0)).toISOString(),
        estimatedDuration_hours: parseFloat(simValue(1, 168, 1)),
        affectedArea_km2: Math.round(simValue(100, 200000, 0)),
        precautionaryActions: _getPrecautions(disasterType),
        evacuationRequired: probability > 65,
        confidence:      simConfidence(),
        issuedAt:        NOW()
    };

    ftLog(AGENT, userId, "early_warning_issued", { region, disasterType, alertLevel: alert, probability_pct: probability }, probability > 65 ? "WARN" : "INFO");
    return ok(AGENT, warning);
}

function _getPrecautions(disasterType) {
    const map = {
        earthquake:        ["secure_heavy_objects","identify_safe_spots","prepare_emergency_kit","register_evacuation_plan"],
        tsunami:           ["move_to_high_ground","avoid_coastal_areas","monitor_official_alerts","do_not_return_until_cleared"],
        hurricane:         ["board_windows","stock_supplies","evacuate_flood_zones","charge_devices"],
        tornado:           ["identify_shelter","avoid_windows","mobile_home_evacuation","monitor_sirens"],
        flood:             ["move_valuables_upstairs","avoid_floodwater","turn_off_utilities","monitor_water_levels"],
        wildfire:          ["create_defensible_space","prepare_go_bag","know_evacuation_routes","monitor_air_quality"],
        landslide:         ["avoid_steep_slopes","monitor_rainfall","evacuate_if_directed"],
        volcanic_eruption: ["prepare_respirator","avoid_downwind_areas","evacuate_exclusion_zone"],
        drought:           ["conserve_water","reduce_irrigation","drought_resistant_crops"],
        blizzard:          ["stock_supplies","avoid_travel","insulate_pipes","generator_check"],
        heatwave:          ["stay_hydrated","avoid_midday_sun","check_on_elderly","cooling_centres"],
        pandemic:          ["follow_health_guidelines","stock_medical_supplies","remote_work_plan"]
    };
    return (map[disasterType] || ["general_emergency_preparedness"]).slice(0, 3);
}

function issueEvacuationAlert({ userId, regionId, disasterType, severity, approved }) {
    const gate = requireApproval(approved, `issue official evacuation alert for region ${regionId} — disaster: ${disasterType}`);
    if (gate) return gate;
    if (!userId || !regionId || !disasterType) return fail(AGENT, "userId, regionId, and disasterType required");
    if (!DISASTER_TYPES.includes(disasterType)) return fail(AGENT, `disasterType must be: ${DISASTER_TYPES.join(", ")}`);

    const alert = {
        alertId:      uid("evac"),
        regionId,
        disasterType,
        severity:     severity || "high",
        message:      `EVACUATION ORDER: Immediate evacuation required for ${regionId} due to ${disasterType} threat.`,
        evacuationRoutes: ["Route_A","Route_B","Route_C"].slice(0, Math.floor(Math.random()*3)+1),
        shelterLocations: Math.round(simValue(1, 10, 0)),
        issuedBy:     userId,
        issuedAt:     NOW(),
        expiresAt:    new Date(Date.now() + 86400000).toISOString()
    };

    ftLog(AGENT, userId, "EVACUATION_ALERT_ISSUED", { regionId, disasterType, severity }, "WARN");
    return ok(AGENT, alert, "approved_control");
}

function getHistoricalDisasterData({ userId, region, disasterType, yearRange = 10 }) {
    if (!userId) return fail(AGENT, "userId required");
    if (disasterType && !DISASTER_TYPES.includes(disasterType)) return fail(AGENT, `disasterType must be: ${DISASTER_TYPES.join(", ")}`);

    const currentYear = new Date().getFullYear();
    const events = Array.from({ length: Math.round(simValue(3, 20, 0)) }, (_, i) => ({
        eventId:      uid("hist"),
        year:         Math.round(currentYear - Math.random() * yearRange),
        type:         disasterType || DISASTER_TYPES[Math.floor(Math.random() * DISASTER_TYPES.length)],
        magnitude:    parseFloat(simValue(1, 10, 1)),
        casualties:   Math.round(simValue(0, 50000, 0)),
        damage_USD_B: parseFloat(simValue(0.01, 200, 2)),
        duration_days: Math.round(simValue(1, 30, 0))
    })).sort((a, b) => b.year - a.year);

    ftLog(AGENT, userId, "historical_data_retrieved", { region, disasterType, yearRange }, "INFO");
    return ok(AGENT, { region: region || "global", disasterType, yearRange, eventCount: events.length, events, disasterTypes: DISASTER_TYPES, riskLevels: RISK_LEVELS, retrievedAt: NOW() });
}

module.exports = { predictDisasterRisk, getEarlyWarning, issueEvacuationAlert, getHistoricalDisasterData };
