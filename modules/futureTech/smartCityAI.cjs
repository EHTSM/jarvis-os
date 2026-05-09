"use strict";
const { load, flush, ftLog, uid, NOW, simValue, simConfidence, ok, fail } = require("./_futureTechStore.cjs");

const AGENT = "smartCityAI";

const CITY_DOMAINS   = ["transport","energy","water","waste","safety","health","environment","economy","housing","governance"];
const KPI_METRICS    = ["efficiency","sustainability","livability","resilience","equity","smartness"];
const DISTRICT_TYPES = ["residential","commercial","industrial","mixed","green","transit_hub","cultural"];

function getCityHealthScore({ userId, cityId, domains = CITY_DOMAINS }) {
    if (!userId) return fail(AGENT, "userId required");
    const invalidDomains = domains.filter(d => !CITY_DOMAINS.includes(d));
    if (invalidDomains.length) return fail(AGENT, `invalid domains: ${invalidDomains.join(",")}. Valid: ${CITY_DOMAINS.join(", ")}`);

    const scores = {};
    domains.forEach(d => { scores[d] = { score: Math.round(simValue(40, 95, 0)), trend: Math.random() > 0.5 ? "improving" : "declining", alerts: Math.floor(Math.random() * 5) }; });
    const overallScore = Math.round(Object.values(scores).reduce((sum, d) => sum + d.score, 0) / domains.length);

    const health = {
        healthId:      uid("chs"),
        cityId:        cityId || "default_city",
        overallScore,
        scoreBand:     overallScore >= 80 ? "excellent" : overallScore >= 60 ? "good" : overallScore >= 40 ? "fair" : "poor",
        domains:       scores,
        kpiSummary:    Object.fromEntries(KPI_METRICS.map(k => [k, Math.round(simValue(40, 95, 0))])),
        activeAlerts:  Object.values(scores).reduce((sum, d) => sum + d.alerts, 0),
        checkedAt:     NOW()
    };

    const history = load(`city_health_${cityId || "default"}`, []);
    history.push({ healthId: health.healthId, overallScore, checkedAt: health.checkedAt });
    flush(`city_health_${cityId || "default"}`, history.slice(-1000));

    ftLog(AGENT, userId, "city_health_scored", { cityId: health.cityId, overallScore }, "INFO");
    return ok(AGENT, health);
}

function optimiseDistrict({ userId, districtId, districtType = "mixed", objectives = ["energy","transport"] }) {
    if (!userId) return fail(AGENT, "userId required");
    if (!DISTRICT_TYPES.includes(districtType)) return fail(AGENT, `districtType must be: ${DISTRICT_TYPES.join(", ")}`);

    const optimisation = {
        optimisationId: uid("opt"),
        districtId:     districtId || `dist_${uid("d")}`,
        districtType,
        objectives,
        recommendations: objectives.map(obj => ({
            domain:         obj,
            currentScore:   Math.round(simValue(40, 70, 0)),
            projectedScore: Math.round(simValue(70, 95, 0)),
            interventions:  _getInterventions(obj),
            estimatedROI:   parseFloat(simValue(1.2, 4.5, 2)),
            timelineMonths: Math.round(simValue(3, 36, 0))
        })),
        totalSavings_pct: parseFloat(simValue(5, 35, 1)),
        confidence:       simConfidence(),
        optimisedAt:      NOW()
    };

    ftLog(AGENT, userId, "district_optimised", { districtId: optimisation.districtId, objectives: objectives.length }, "INFO");
    return ok(AGENT, optimisation);
}

function _getInterventions(domain) {
    const map = {
        energy:    ["smart_metering","led_street_lights","solar_rooftops","demand_response"],
        transport: ["adaptive_signals","ev_charging","bike_lanes","bus_rapid_transit"],
        water:     ["leak_detection","smart_irrigation","grey_water_recycling"],
        waste:     ["smart_bins","route_optimization","composting_program"],
        safety:    ["cctv_analytics","emergency_response_ai","flood_sensors"]
    };
    return (map[domain] || ["general_optimization"]).slice(0, 3);
}

function getInfrastructureAlerts({ userId, cityId, severity }) {
    if (!userId) return fail(AGENT, "userId required");
    const alerts = Array.from({ length: Math.floor(Math.random() * 8) }, () => ({
        alertId:    uid("alt"),
        domain:     CITY_DOMAINS[Math.floor(Math.random() * CITY_DOMAINS.length)],
        severity:   ["info","warning","critical"][Math.floor(Math.random()*3)],
        message:    "Simulated infrastructure alert — integrate IoT sensors for real data",
        location:   `Zone-${Math.floor(Math.random()*10)+1}`,
        issuedAt:   NOW()
    })).filter(a => !severity || a.severity === severity);

    return ok(AGENT, { cityId: cityId || "default", total: alerts.length, alerts, domains: CITY_DOMAINS });
}

module.exports = { getCityHealthScore, optimiseDistrict, getInfrastructureAlerts };
