"use strict";
const { ultimateLog, isKillSwitchActive, load, flush, uid, NOW, ok, fail, killed } = require("./_ultimateStore.cjs");

const AGENT = "worldDataAggregator";

const DATA_SOURCES   = ["satellite","iot_sensors","public_apis","news_feeds","financial_markets","weather_services","government_data","research_databases","social_signals","geospatial"];
const DATA_CATEGORIES = ["climate","economy","health","infrastructure","security","technology","demographics","environment","energy","food"];

function aggregateWorldData({ categories = DATA_CATEGORIES, sources = DATA_SOURCES, region = "global" }) {
    if (isKillSwitchActive()) return killed(AGENT);
    const invalidCats = categories.filter(c => !DATA_CATEGORIES.includes(c));
    if (invalidCats.length) return fail(AGENT, `invalid categories: ${invalidCats.join(",")}. Valid: ${DATA_CATEGORIES.join(", ")}`);

    const datasets = categories.map(cat => ({
        category:      cat,
        sources:       sources.slice(0, Math.floor(2 + Math.random() * 4)).map(s => ({
            source:    s,
            records:   Math.round(1000 + Math.random() * 1000000),
            freshness: ["real_time","hourly","daily","weekly"][Math.floor(Math.random()*4)],
            reliability: Math.round(60 + Math.random() * 40)
        })),
        totalRecords:  Math.round(10000 + Math.random() * 10000000),
        latestUpdate:  NOW(),
        qualityScore:  Math.round(60 + Math.random() * 40)
    }));

    const aggregation = {
        aggregationId:  uid("wda"),
        region,
        categories,
        datasets,
        totalDatasets:  datasets.length,
        totalRecords:   datasets.reduce((s, d) => s + d.totalRecords, 0),
        overallQuality: Math.round(datasets.reduce((s, d) => s + d.qualityScore, 0) / datasets.length),
        aggregatedAt:   NOW(),
        note:           "Data aggregation is simulated. Integrate authoritative APIs for production deployment."
    };

    const log = load("aggregation_log", []);
    log.push({ aggregationId: aggregation.aggregationId, region, categoryCount: categories.length, aggregatedAt: aggregation.aggregatedAt });
    flush("aggregation_log", log.slice(-500));

    ultimateLog(AGENT, "world_data_aggregated", { region, categoryCount: categories.length, totalRecords: aggregation.totalRecords }, "INFO");
    return ok(AGENT, aggregation);
}

function getDataPulse({ category, region = "global" }) {
    if (!category) return fail(AGENT, "category is required");
    if (!DATA_CATEGORIES.includes(category)) return fail(AGENT, `category must be: ${DATA_CATEGORIES.join(", ")}`);
    if (isKillSwitchActive()) return killed(AGENT);

    const pulse = {
        pulseId:       uid("pls"),
        category,
        region,
        currentValue:  parseFloat((Math.random() * 100).toFixed(2)),
        trend:         Math.random() > 0.5 ? "rising" : "falling",
        velocity:      parseFloat((Math.random() * 10).toFixed(3)),
        alerts:        Math.random() > 0.7 ? [`Anomaly detected in ${category} data stream`] : [],
        sampledAt:     NOW()
    };

    ultimateLog(AGENT, "data_pulse_sampled", { category, region }, "INFO");
    return ok(AGENT, pulse);
}

function queryDataCatalog({ search, category }) {
    const sources = category
        ? DATA_SOURCES.filter(() => Math.random() > 0.3)
        : DATA_SOURCES;

    return ok(AGENT, {
        search:        search || null,
        category:      category || null,
        sources:       sources.map(s => ({ source: s, categories: DATA_CATEGORIES.slice(0, Math.floor(1 + Math.random() * 4)), available: Math.random() > 0.1 })),
        allCategories: DATA_CATEGORIES,
        allSources:    DATA_SOURCES,
        catalogAt:     NOW()
    });
}

module.exports = { aggregateWorldData, getDataPulse, queryDataCatalog, DATA_CATEGORIES, DATA_SOURCES };
