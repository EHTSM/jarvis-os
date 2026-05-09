"use strict";
const { load, flush, ftLog, uid, NOW, simValue, simConfidence, ok, fail } = require("./_futureTechStore.cjs");

const AGENT = "spaceWeatherAI";

const SOLAR_FLARE_CLASSES = ["A","B","C","M","X"];
const KP_BANDS = { quiet:[0,2], unsettled:[3,3], active:[4,4], minor_storm:[5,5], moderate_storm:[6,6], strong_storm:[7,7], severe_storm:[8,8], extreme_storm:[9,9] };
const IMPACT_SYSTEMS = ["power_grids","gps","hf_radio","satellites","pipelines","aviation"];

function getCurrentConditions({ userId }) {
    if (!userId) return fail(AGENT, "userId required");

    const flareClass = SOLAR_FLARE_CLASSES[Math.floor(Math.random() * SOLAR_FLARE_CLASSES.length)];
    const kpIndex    = parseFloat(simValue(0, 9, 1));
    const kpBand     = Object.entries(KP_BANDS).find(([, [min, max]]) => kpIndex >= min && kpIndex <= max)?.[0] || "quiet";

    const conditions = {
        conditionId:     uid("sw"),
        solarWindSpeed:  simValue(300, 800, 0),
        solarWindDensity: simValue(1, 30, 1),
        bz_nT:           simValue(-30, 10, 1),
        kpIndex,
        kpBand,
        solarFlare:      { class: flareClass, probability: simValue(0, 0.9), peakFlux: simValue(1e-8, 1e-3, 10) },
        cme: {
            detected:    Math.random() > 0.7,
            arrivalTime: new Date(Date.now() + simValue(24, 96, 0) * 3600000).toISOString(),
            speed_kms:   simValue(300, 2000, 0)
        },
        affectedSystems: IMPACT_SYSTEMS.filter(() => Math.random() > 0.5),
        alertLevel:      kpIndex >= 7 ? "RED" : kpIndex >= 5 ? "ORANGE" : kpIndex >= 3 ? "YELLOW" : "GREEN",
        observedAt:      NOW()
    };

    const history = load(`sw_history_${userId}`, []);
    history.push({ conditionId: conditions.conditionId, kpIndex, alertLevel: conditions.alertLevel, observedAt: conditions.observedAt });
    flush(`sw_history_${userId}`, history.slice(-2000));

    ftLog(AGENT, userId, "space_weather_checked", { kpIndex, alertLevel: conditions.alertLevel }, "INFO");
    return ok(AGENT, conditions);
}

function getSolarFlareForecast({ userId, forecastHours = 24 }) {
    if (!userId) return fail(AGENT, "userId required");
    if (forecastHours < 1 || forecastHours > 168) return fail(AGENT, "forecastHours must be 1–168");

    const intervals = Math.min(forecastHours, 24);
    const forecast  = Array.from({ length: intervals }, (_, i) => ({
        hour:        i + 1,
        flareClass:  SOLAR_FLARE_CLASSES[Math.floor(Math.random() * SOLAR_FLARE_CLASSES.length)],
        probability: parseFloat(simValue(0, 0.8).toFixed(3)),
        kpIndex:     parseFloat(simValue(0, 9, 1))
    }));

    ftLog(AGENT, userId, "flare_forecast_generated", { forecastHours }, "INFO");
    return ok(AGENT, { forecastHours, intervals: forecast, peakKp: Math.max(...forecast.map(f => f.kpIndex)), note: "Simulated — integrate NOAA SWPC API for real forecasts" });
}

function getGeomageticStormHistory({ userId, days = 30 }) {
    if (!userId) return fail(AGENT, "userId required");
    const history = load(`sw_history_${userId}`, []);
    const storms  = history.filter(h => h.kpIndex >= 5);
    return ok(AGENT, { period_days: days, totalStorms: storms.length, storms: storms.slice(-20).reverse(), kpBands: KP_BANDS });
}

module.exports = { getCurrentConditions, getSolarFlareForecast, getGeomageticStormHistory };
