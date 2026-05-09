"use strict";
const { load, flush, ftLog, uid, NOW, simValue, simConfidence, ok, fail } = require("./_futureTechStore.cjs");

const AGENT = "environmentalAI";

const ECOSYSTEM_TYPES   = ["tropical_rainforest","temperate_forest","grassland","wetland","coral_reef","mangrove","arctic_tundra","savanna","desert","alpine"];
const BIODIVERSITY_METRICS = ["species_richness","shannon_index","evenness","endemic_species","threatened_species","invasive_species"];
const POLLUTION_TYPES   = ["air","water","soil","noise","light","plastic","heavy_metal","radioactive","microplastic"];
const AIR_POLLUTANTS    = ["PM2_5","PM10","NO2","SO2","O3","CO","VOC","NH3"];
const WATER_QUALITY_PARAMS = ["pH","DO","BOD","COD","turbidity","nitrates","phosphates","coliform","heavy_metals"];
const SOIL_TYPES        = ["clay","sandy","loamy","silty","chalky","peaty"];

function monitorEcosystem({ userId, ecosystemId, ecosystemType, metrics = BIODIVERSITY_METRICS }) {
    if (!userId) return fail(AGENT, "userId required");
    if (ecosystemType && !ECOSYSTEM_TYPES.includes(ecosystemType)) {
        return fail(AGENT, `ecosystemType must be: ${ECOSYSTEM_TYPES.join(", ")}`);
    }
    const invalidMetrics = metrics.filter(m => !BIODIVERSITY_METRICS.includes(m));
    if (invalidMetrics.length) return fail(AGENT, `invalid metrics: ${invalidMetrics.join(",")}. Valid: ${BIODIVERSITY_METRICS.join(", ")}`);

    const biodiversity = {};
    metrics.forEach(m => {
        biodiversity[m] = {
            value:    parseFloat(simValue(0, 100, 3)),
            baseline: parseFloat(simValue(0, 100, 3)),
            trend:    Math.random() > 0.5 ? "stable" : Math.random() > 0.5 ? "improving" : "declining",
            status:   ["healthy","stressed","degraded","critical"][Math.floor(Math.random()*4)]
        };
    });

    const health = {
        monitoringId:   uid("eco"),
        ecosystemId:    ecosystemId || `eco_${uid("e")}`,
        ecosystemType:  ecosystemType || ECOSYSTEM_TYPES[Math.floor(Math.random() * ECOSYSTEM_TYPES.length)],
        healthScore:    Math.round(simValue(20, 95, 0)),
        biodiversity,
        carbonStock_tCO2e: parseFloat(simValue(100, 500000, 1)),
        waterCycleIntegrity_pct: parseFloat(simValue(30, 99, 1)),
        threatenedSpeciesCount:  Math.round(simValue(0, 50, 0)),
        invasiveSpeciesCount:    Math.round(simValue(0, 20, 0)),
        humanPressureIndex:      parseFloat(simValue(0, 100, 1)),
        confidence:     simConfidence(),
        monitoredAt:    NOW(),
        note:           "Simulated data — integrate remote sensing and eDNA APIs for real monitoring"
    };

    const log = load(`ecosystem_log_${ecosystemId || "default"}`, []);
    log.push({ monitoringId: health.monitoringId, healthScore: health.healthScore, monitoredAt: health.monitoredAt });
    flush(`ecosystem_log_${ecosystemId || "default"}`, log.slice(-2000));

    ftLog(AGENT, userId, "ecosystem_monitored", { ecosystemId, ecosystemType, healthScore: health.healthScore }, "INFO");
    return ok(AGENT, health);
}

function analyseAirQuality({ userId, locationId, latitude, longitude, pollutants = AIR_POLLUTANTS }) {
    if (!userId) return fail(AGENT, "userId required");
    const invalidPoll = pollutants.filter(p => !AIR_POLLUTANTS.includes(p));
    if (invalidPoll.length) return fail(AGENT, `invalid pollutants: ${invalidPoll.join(",")}. Valid: ${AIR_POLLUTANTS.join(", ")}`);

    const readings = {};
    pollutants.forEach(p => {
        const concentration = parseFloat(simValue(0, 500, 2));
        const thresholds = { PM2_5:25, PM10:50, NO2:40, SO2:20, O3:100, CO:4, VOC:200, NH3:400 };
        readings[p] = {
            concentration_μgm3: concentration,
            threshold_μgm3:     thresholds[p] || 100,
            exceedance:         concentration > (thresholds[p] || 100),
            healthCategory:     concentration > 200 ? "hazardous" : concentration > 100 ? "very_unhealthy" : concentration > 55 ? "unhealthy" : concentration > 35 ? "moderate" : "good"
        };
    });

    const aqi = Math.round(simValue(0, 500, 0));
    const analysis = {
        analysisId:    uid("aq"),
        locationId:    locationId || `loc_${uid("l")}`,
        latitude:      latitude || null,
        longitude:     longitude || null,
        AQI:           aqi,
        AQICategory:   aqi > 200 ? "hazardous" : aqi > 150 ? "very_unhealthy" : aqi > 100 ? "unhealthy" : aqi > 50 ? "moderate" : "good",
        readings,
        exceedances:   pollutants.filter(p => readings[p].exceedance),
        healthAdvisory: aqi > 100 ? "Sensitive groups should reduce outdoor activity" : "Air quality is acceptable",
        confidence:    simConfidence(),
        sampledAt:     NOW()
    };

    ftLog(AGENT, userId, "air_quality_analysed", { locationId, AQI: aqi }, "INFO");
    return ok(AGENT, analysis);
}

function monitorWaterQuality({ userId, waterbodyId, waterbodyType = "river", params = WATER_QUALITY_PARAMS }) {
    if (!userId) return fail(AGENT, "userId required");
    const BODY_TYPES = ["river","lake","reservoir","coastal","groundwater","wetland"];
    if (!BODY_TYPES.includes(waterbodyType)) return fail(AGENT, `waterbodyType must be: ${BODY_TYPES.join(", ")}`);

    const readings = {};
    params.forEach(p => {
        const ranges = { pH:[6.5,8.5], DO:[5,12], BOD:[1,30], COD:[10,100], turbidity:[0.1,200], nitrates:[0.1,50], phosphates:[0.01,5], coliform:[0,1000], heavy_metals:[0,50] };
        const [mn, mx] = ranges[p] || [0, 100];
        readings[p] = {
            value:    parseFloat(simValue(mn, mx, 2)),
            unit:     { pH:"", DO:"mg/L", BOD:"mg/L", COD:"mg/L", turbidity:"NTU", nitrates:"mg/L", phosphates:"mg/L", coliform:"CFU/100mL", heavy_metals:"μg/L" }[p] || "unit",
            status:   Math.random() > 0.7 ? "exceeded" : "within_limits"
        };
    });

    const overallStatus = readings && Object.values(readings).some(r => r.status === "exceeded") ? "impaired" : "good";
    ftLog(AGENT, userId, "water_quality_monitored", { waterbodyId, waterbodyType, overallStatus }, "INFO");
    return ok(AGENT, {
        monitoringId:  uid("wq"),
        waterbodyId:   waterbodyId || `wb_${uid("w")}`,
        waterbodyType,
        overallStatus,
        readings,
        potabilityIndex: Math.round(simValue(0, 100, 0)),
        pollutionSources: ["agricultural_runoff","industrial_discharge","urban_runoff"].slice(0, Math.floor(Math.random()*3)+1),
        sampledAt:     NOW()
    });
}

function assessSoilHealth({ userId, plotId, soilType = "loamy", depth_cm = 30 }) {
    if (!userId) return fail(AGENT, "userId required");
    if (!SOIL_TYPES.includes(soilType)) return fail(AGENT, `soilType must be: ${SOIL_TYPES.join(", ")}`);

    const assessment = {
        assessmentId:       uid("soil"),
        plotId:             plotId || `plot_${uid("p")}`,
        soilType,
        depth_cm,
        pH:                 parseFloat(simValue(4.5, 8.5, 2)),
        organicMatter_pct:  parseFloat(simValue(0.5, 8, 2)),
        nitrogen_ppm:       parseFloat(simValue(5, 200, 1)),
        phosphorus_ppm:     parseFloat(simValue(2, 100, 1)),
        potassium_ppm:      parseFloat(simValue(50, 600, 1)),
        moisture_pct:       parseFloat(simValue(5, 60, 1)),
        microbialActivity:  ["low","moderate","high"][Math.floor(Math.random()*3)],
        erosionRisk:        ["low","moderate","high","severe"][Math.floor(Math.random()*4)],
        contamination:      Math.random() > 0.7,
        healthScore:        Math.round(simValue(30, 95, 0)),
        fertility:          ["poor","fair","good","excellent"][Math.floor(Math.random()*4)],
        recommendations:    ["add_compost","reduce_tillage","cover_crops","liming","nitrogen_fixation"].slice(0, Math.floor(Math.random()*3)+1),
        assessedAt:         NOW()
    };

    ftLog(AGENT, userId, "soil_assessed", { plotId, soilType, healthScore: assessment.healthScore }, "INFO");
    return ok(AGENT, assessment);
}

module.exports = { monitorEcosystem, analyseAirQuality, monitorWaterQuality, assessSoilHealth };
