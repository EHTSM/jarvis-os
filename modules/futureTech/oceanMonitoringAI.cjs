"use strict";
const { load, flush, ftLog, uid, NOW, simValue, simConfidence, ok, fail } = require("./_futureTechStore.cjs");

const AGENT = "oceanMonitoringAI";

const OCEAN_BASINS    = ["Pacific","Atlantic","Indian","Arctic","Southern","Mediterranean","Caribbean","Gulf_of_Mexico"];
const OCEAN_LAYERS    = ["surface","mesopelagic","bathypelagic","abyssopelagic","hadalpelagic"];
const CURRENT_SYSTEMS = ["Gulf_Stream","Kuroshio","Antarctic_Circumpolar","California","Benguela","Agulhas","North_Equatorial","Labrador"];
const MARINE_HABITATS = ["coral_reef","kelp_forest","seagrass","mangrove","open_ocean","deep_sea","polar","estuary"];
const OCEAN_THREATS   = ["acidification","warming","deoxygenation","plastic_pollution","overfishing","coastal_runoff","noise_pollution","shipping"];

function getOceanStatus({ userId, basinId, layer = "surface" }) {
    if (!userId) return fail(AGENT, "userId required");
    if (basinId && !OCEAN_BASINS.includes(basinId)) return fail(AGENT, `basinId must be: ${OCEAN_BASINS.join(", ")}`);
    if (!OCEAN_LAYERS.includes(layer)) return fail(AGENT, `layer must be: ${OCEAN_LAYERS.join(", ")}`);

    const temperature_C = layer === "surface" ? parseFloat(simValue(-2, 32, 2)) : parseFloat(simValue(-2, 10, 2));
    const status = {
        statusId:        uid("ocn"),
        basinId:         basinId || "Pacific",
        layer,
        temperature_C,
        salinity_ppt:    parseFloat(simValue(30, 40, 3)),
        pH:              parseFloat(simValue(7.7, 8.3, 3)),
        dissolvedO2_mgL: parseFloat(simValue(2, 12, 2)),
        chlorophyll_mgm3: parseFloat(simValue(0.01, 20, 3)),
        seaLevel_anomaly_mm: parseFloat(simValue(-100, 200, 1)),
        waveHeight_m:    parseFloat(simValue(0.1, 15, 2)),
        currentSpeed_ms: parseFloat(simValue(0.01, 3, 3)),
        iceExtent_km2:   layer === "surface" && (basinId === "Arctic" || basinId === "Southern") ? Math.round(simValue(1000000, 14000000, 0)) : null,
        acidificationLevel: parseFloat(simValue(7.7, 8.3, 3)),
        microplastic_ppm: parseFloat(simValue(0.001, 10, 4)),
        confidence:      simConfidence(),
        checkedAt:       NOW()
    };

    const log = load(`ocean_log_${basinId || "global"}`, []);
    log.push({ statusId: status.statusId, basinId: status.basinId, temperature_C, pH: status.pH, checkedAt: status.checkedAt });
    flush(`ocean_log_${basinId || "global"}`, log.slice(-2000));

    ftLog(AGENT, userId, "ocean_status_checked", { basinId: status.basinId, layer, temperature_C }, "INFO");
    return ok(AGENT, status);
}

function analyseMarineEcosystem({ userId, habitatId, habitatType, threats = OCEAN_THREATS }) {
    if (!userId) return fail(AGENT, "userId required");
    if (habitatType && !MARINE_HABITATS.includes(habitatType)) return fail(AGENT, `habitatType must be: ${MARINE_HABITATS.join(", ")}`);

    const threatAssessment = threats.map(t => ({
        threat:          t,
        severity:        ["low","moderate","high","critical"][Math.floor(Math.random()*4)],
        trend:           Math.random() > 0.4 ? "worsening" : "stable",
        impact_pct:      parseFloat(simValue(5, 80, 1))
    }));

    const ecosystem = {
        analysisId:         uid("meco"),
        habitatId:          habitatId || `hab_${uid("h")}`,
        habitatType:        habitatType || MARINE_HABITATS[Math.floor(Math.random() * MARINE_HABITATS.length)],
        healthScore:        Math.round(simValue(20, 95, 0)),
        biodiversityIndex:  parseFloat(simValue(0.1, 1.0, 3)),
        coralCoverage_pct:  habitatType === "coral_reef" ? parseFloat(simValue(5, 80, 1)) : null,
        biomass_gm2:        parseFloat(simValue(10, 10000, 1)),
        primaryProductivity_gCm2yr: parseFloat(simValue(50, 1000, 1)),
        threatAssessment,
        dominantThreats:    threatAssessment.filter(t => t.severity === "critical" || t.severity === "high").map(t => t.threat),
        restorationPriority: Math.random() > 0.5 ? "high" : "medium",
        protectedStatus:    Math.random() > 0.4,
        confidence:         simConfidence(),
        analysedAt:         NOW()
    };

    ftLog(AGENT, userId, "marine_ecosystem_analysed", { habitatId, habitatType, healthScore: ecosystem.healthScore }, "INFO");
    return ok(AGENT, ecosystem);
}

function trackOceanCurrents({ userId, currentSystem }) {
    if (!userId) return fail(AGENT, "userId required");
    if (currentSystem && !CURRENT_SYSTEMS.includes(currentSystem)) return fail(AGENT, `currentSystem must be: ${CURRENT_SYSTEMS.join(", ")}`);

    const currents = (currentSystem ? [currentSystem] : CURRENT_SYSTEMS).map(sys => ({
        system:           sys,
        speed_ms:         parseFloat(simValue(0.1, 3.5, 3)),
        flowRate_Sv:      parseFloat(simValue(1, 150, 1)),
        temperatureAnomaly_C: parseFloat(simValue(-2, 2, 3)),
        direction_deg:    Math.round(simValue(0, 360, 0)),
        strength_pct:     parseFloat(simValue(50, 130, 1)),
        anomalyDetected:  Math.random() > 0.7,
        trend:            Math.random() > 0.5 ? "stable" : Math.random() > 0.5 ? "strengthening" : "weakening"
    }));

    ftLog(AGENT, userId, "ocean_currents_tracked", { systemCount: currents.length }, "INFO");
    return ok(AGENT, { currentSystem: currentSystem || "all", currents, currentSystems: CURRENT_SYSTEMS, trackedAt: NOW() });
}

function forecastSeaLevelRise({ userId, coastalCity, scenario = "SSP2-4.5", horizonYears = 50 }) {
    if (!userId) return fail(AGENT, "userId required");
    const SCENARIOS = ["SSP1-2.6","SSP2-4.5","SSP3-7.0","SSP5-8.5"];
    if (!SCENARIOS.includes(scenario)) return fail(AGENT, `scenario must be: ${SCENARIOS.join(", ")}`);

    const steps = Math.ceil(horizonYears / 10);
    const projection = Array.from({ length: steps }, (_, i) => ({
        decade:           2020 + (i+1) * 10,
        sealevelRise_mm:  Math.round(simValue((i+1)*20, (i+1)*200, 0)),
        stormSurgeRisk_pct: parseFloat(simValue(10, 90, 1)),
        floodFreq_per_yr: parseFloat(simValue(0.1, 52, 1)),
        confidence_pct:   Math.max(30, 90 - i * 10)
    }));

    const forecast = {
        forecastId:          uid("slr"),
        coastalCity:         coastalCity || "generic_coastal_city",
        scenario,
        horizonYears,
        totalRise_mm:        projection[projection.length - 1].sealevelRise_mm,
        riskCategory:        projection[projection.length - 1].sealevelRise_mm > 500 ? "extreme" : projection[projection.length - 1].sealevelRise_mm > 200 ? "high" : "moderate",
        populationAtRisk_M:  parseFloat(simValue(0.1, 50, 2)),
        infrastructureAtRisk_USD_B: parseFloat(simValue(1, 5000, 1)),
        projection,
        confidence:          simConfidence(),
        generatedAt:         NOW()
    };

    ftLog(AGENT, userId, "sea_level_forecast_generated", { coastalCity, scenario, horizonYears }, "INFO");
    return ok(AGENT, forecast);
}

module.exports = { getOceanStatus, analyseMarineEcosystem, trackOceanCurrents, forecastSeaLevelRise };
