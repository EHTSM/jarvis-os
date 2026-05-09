"use strict";
const { load, flush, ftLog, uid, NOW, simValue, simConfidence, ok, fail } = require("./_futureTechStore.cjs");

const AGENT = "renewableEnergyManager";

const SOURCE_TYPES   = ["solar_pv","solar_thermal","wind_onshore","wind_offshore","hydro","geothermal","tidal","biomass"];
const STORAGE_TYPES  = ["lithium_ion","flow_battery","pumped_hydro","compressed_air","hydrogen","flywheel"];
const FORECAST_TYPES = ["hourly","daily","weekly","monthly"];

function getSolarForecast({ userId, latitude, longitude, capacityKWp = 100, forecastType = "daily" }) {
    if (!userId) return fail(AGENT, "userId required");
    if (!FORECAST_TYPES.includes(forecastType)) return fail(AGENT, `forecastType must be: ${FORECAST_TYPES.join(", ")}`);

    const periods = { hourly:24, daily:7, weekly:4, monthly:12 }[forecastType];
    const forecast = Array.from({ length: periods }, (_, i) => {
        const irradiance = simValue(0, 1200);
        const generation = parseFloat((irradiance / 1000 * capacityKWp * simValue(0.15, 0.22)).toFixed(2));
        return {
            period:        i + 1,
            irradiance_Wm2: parseFloat(irradiance.toFixed(1)),
            generation_kWh: generation,
            efficiency_pct: parseFloat(simValue(14, 22, 1)),
            cloudCover_pct: parseFloat(simValue(0, 100, 1))
        };
    });

    const totalGeneration = parseFloat(forecast.reduce((s, f) => s + f.generation_kWh, 0).toFixed(2));
    ftLog(AGENT, userId, "solar_forecast_generated", { latitude, capacityKWp, forecastType }, "INFO");
    return ok(AGENT, { forecastType, periods, capacityKWp, latitude, longitude: longitude || null, totalGeneration_kWh: totalGeneration, forecast, note:"Simulated — integrate PVGIS or SolarEdge APIs for real data" });
}

function getWindForecast({ userId, latitude, longitude, turbineCapacityKW = 2000, hubHeight_m = 100, forecastType = "daily" }) {
    if (!userId) return fail(AGENT, "userId required");

    const periods = { hourly:24, daily:7, weekly:4, monthly:12 }[forecastType] || 7;
    const forecast = Array.from({ length: periods }, (_, i) => {
        const windSpeed = simValue(0, 25);
        const cutIn = 3, rated = 12, cutOut = 25;
        let powerFactor = 0;
        if (windSpeed >= cutIn && windSpeed <= rated) powerFactor = (windSpeed - cutIn) / (rated - cutIn);
        else if (windSpeed > rated && windSpeed < cutOut) powerFactor = 1;
        const generation = parseFloat((powerFactor * turbineCapacityKW).toFixed(2));
        return { period: i+1, windSpeed_ms: parseFloat(windSpeed.toFixed(1)), generation_kWh: generation, capacityFactor: parseFloat(powerFactor.toFixed(3)) };
    });

    const totalGeneration = parseFloat(forecast.reduce((s,f) => s + f.generation_kWh, 0).toFixed(2));
    ftLog(AGENT, userId, "wind_forecast_generated", { latitude, turbineCapacityKW, forecastType }, "INFO");
    return ok(AGENT, { forecastType, periods, turbineCapacityKW, hubHeight_m, totalGeneration_kWh: totalGeneration, forecast });
}

function optimiseStorageDispatch({ userId, storageType = "lithium_ion", capacityKWh, currentSOC_pct, gridDemandProfile = [] }) {
    if (!userId) return fail(AGENT, "userId required");
    if (!STORAGE_TYPES.includes(storageType)) return fail(AGENT, `storageType must be: ${STORAGE_TYPES.join(", ")}`);

    const soc = currentSOC_pct || simValue(20, 90);
    const dispatch = {
        dispatchId:    uid("dsp"),
        storageType,
        capacityKWh:   capacityKWh || simValue(100, 10000, 0),
        currentSOC_pct: parseFloat(soc.toFixed(1)),
        schedule:      Array.from({ length: 24 }, (_, h) => ({
            hour:      h,
            action:    soc > 70 && h >= 8 && h <= 18 ? "discharge" : "charge",
            power_kW:  parseFloat(simValue(10, 500, 1)),
            projectedSOC: parseFloat(simValue(20, 95, 1))
        })),
        cyclesRemaining: Math.round(simValue(1000, 6000, 0)),
        dailySaving_USD: parseFloat(simValue(50, 2000, 2)),
        optimisedAt:   NOW()
    };

    ftLog(AGENT, userId, "storage_dispatch_optimised", { storageType, capacityKWh: dispatch.capacityKWh }, "INFO");
    return ok(AGENT, dispatch);
}

function getRenewableMix({ userId, region }) {
    if (!userId) return fail(AGENT, "userId required");
    const mix = Object.fromEntries(SOURCE_TYPES.map(s => [s, { share_pct: parseFloat(simValue(0, 30, 1)), capacity_GW: parseFloat(simValue(0, 50, 1)), growthYoY_pct: parseFloat(simValue(-5, 40, 1)) }]));
    const totalShare = parseFloat(Object.values(mix).reduce((s,m) => s+m.share_pct, 0).toFixed(1));
    return ok(AGENT, { region: region || "global", renewableMix: mix, totalRenewableShare_pct: Math.min(totalShare, 100), storageTypes: STORAGE_TYPES, checkedAt: NOW() });
}

module.exports = { getSolarForecast, getWindForecast, optimiseStorageDispatch, getRenewableMix };
