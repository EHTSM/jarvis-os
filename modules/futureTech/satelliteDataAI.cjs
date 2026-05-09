"use strict";
const { load, flush, ftLog, uid, NOW, simValue, simConfidence, ok, fail } = require("./_futureTechStore.cjs");

const AGENT = "satelliteDataAI";

const SATELLITE_TYPES  = ["optical","radar","infrared","multispectral","hyperspectral","lidar"];
const DATA_PRODUCTS    = ["ndvi","land_use","cloud_cover","temperature","moisture","elevation","urban_density","deforestation"];
const ORBIT_TYPES      = ["LEO","MEO","GEO","HEO","SSO"];

function processSatellitePass({ userId, satelliteId, orbitType = "LEO", dataProducts = ["ndvi","cloud_cover"], region, sensorType = "multispectral" }) {
    if (!userId) return fail(AGENT, "userId required");
    if (!ORBIT_TYPES.includes(orbitType)) return fail(AGENT, `orbitType must be: ${ORBIT_TYPES.join(", ")}`);
    if (!SATELLITE_TYPES.includes(sensorType)) return fail(AGENT, `sensorType must be: ${SATELLITE_TYPES.join(", ")}`);
    const invalidProducts = dataProducts.filter(p => !DATA_PRODUCTS.includes(p));
    if (invalidProducts.length) return fail(AGENT, `invalid dataProducts: ${invalidProducts.join(",")}. Valid: ${DATA_PRODUCTS.join(", ")}`);

    const pass = {
        passId:        uid("sat"),
        satelliteId:   satelliteId || `SAT-${uid("s")}`,
        orbitType,
        sensorType,
        region:        region || "global",
        dataProducts:  Object.fromEntries(dataProducts.map(p => [p, {
            value:      simValue(0, 1),
            unit:       p === "temperature" ? "°C" : p === "elevation" ? "m" : "index",
            quality:    simConfidence(),
            anomaly:    Math.random() > 0.85
        }])),
        swathWidthKm:  orbitType === "LEO" ? simValue(100, 300, 0) : simValue(500, 1000, 0),
        resolutionM:   orbitType === "LEO" ? simValue(1, 30, 1) : simValue(100, 1000, 0),
        passedAt:      NOW(),
        nextPassAt:    new Date(Date.now() + (orbitType === "LEO" ? 90 : 1440) * 60000).toISOString(),
        confidence:    simConfidence()
    };

    const history = load(`sat_passes_${userId}`, []);
    history.push({ passId: pass.passId, satelliteId: pass.satelliteId, region: pass.region, passedAt: pass.passedAt });
    flush(`sat_passes_${userId}`, history.slice(-1000));

    ftLog(AGENT, userId, "satellite_pass_processed", { passId: pass.passId, region: pass.region, products: dataProducts.length }, "INFO");
    return ok(AGENT, pass);
}

function analyseRegion({ userId, region, dataProducts = DATA_PRODUCTS, timeRangedays = 30 }) {
    if (!userId || !region) return fail(AGENT, "userId and region required");

    const analysis = {
        analysisId:   uid("ana"),
        region,
        timeRangeDays: timeRangedays,
        metrics:      Object.fromEntries(dataProducts.map(p => [p, {
            mean:    simValue(0, 1),
            min:     simValue(0, 0.4),
            max:     simValue(0.6, 1),
            trend:   Math.random() > 0.5 ? "increasing" : "decreasing",
            anomalyCount: Math.floor(Math.random() * 5)
        }])),
        coveragePercent: simValue(60, 99),
        cloudFreeDays:   Math.round(timeRangedays * simValue(0.3, 0.9)),
        overallHealth:   Math.random() > 0.7 ? "good" : Math.random() > 0.4 ? "moderate" : "stressed",
        analysedAt:      NOW()
    };

    ftLog(AGENT, userId, "region_analysed", { region, products: dataProducts.length, timeRangeDays: timeRangedays }, "INFO");
    return ok(AGENT, analysis);
}

function getSupportedProducts() {
    return ok(AGENT, { satelliteTypes: SATELLITE_TYPES, dataProducts: DATA_PRODUCTS, orbitTypes: ORBIT_TYPES });
}

module.exports = { processSatellitePass, analyseRegion, getSupportedProducts };
