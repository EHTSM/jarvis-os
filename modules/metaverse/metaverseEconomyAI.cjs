"use strict";
const { loadGlobal, flushGlobal, metaLog, uid, NOW, ok, fail } = require("./_metaverseStore.cjs");

const AGENT = "metaverseEconomyAI";

const ECONOMIC_INDICATORS = ["gdp_sim","avg_transaction_value","daily_active_traders","listing_volume","land_value_index","nft_floor_price"];

function getEconomySnapshot({ worldId }) {
    const ledger    = loadGlobal("mvc_ledger", []);
    const market    = loadGlobal("marketplace_listings", []);
    const nftOrders = loadGlobal("nft_orders", []);
    const events    = loadGlobal("event_registry", []);

    const now     = new Date();
    const day24h  = new Date(now - 86400000).toISOString();
    const recentTx = ledger.filter(t => t.timestamp > day24h);
    const totalVolume24h = recentTx.reduce((sum, t) => sum + (t.amount || 0), 0);
    const activeListings  = market.filter(l => l.status === "active").length;
    const activeNFTOrders = nftOrders.filter(o => o.status === "active").length;
    const activeEvents    = events.filter(e => e.status === "live" || e.status === "upcoming").length;

    const snapshot = {
        snapshotId:          uid("eco"),
        worldId:             worldId || "global",
        period:              "24h",
        transactions24h:     recentTx.length,
        volume24h_MVC:       parseFloat(totalVolume24h.toFixed(2)),
        avgTxValue:          recentTx.length ? parseFloat((totalVolume24h / recentTx.length).toFixed(2)) : 0,
        activeMarketListings: activeListings,
        activeNFTOrders,
        activeEvents,
        economicHealth:      totalVolume24h > 1000 ? "thriving" : totalVolume24h > 100 ? "stable" : "low_activity",
        indicators:          ECONOMIC_INDICATORS,
        snapshotAt:          NOW()
    };

    metaLog(AGENT, "system", "economy_snapshot", { worldId: snapshot.worldId, volume24h: snapshot.volume24h_MVC }, "INFO");
    return ok(AGENT, snapshot);
}

function runEconomicSimulation({ scenarioName, policyChanges = {} }) {
    if (!scenarioName) return fail(AGENT, "scenarioName required");

    const base   = loadGlobal("mvc_ledger", []).length;
    const txFee  = policyChanges.txFeeRate ?? 0.025;
    const mintBonus = policyChanges.mintBonus ?? 0;

    const simulation = {
        simId:        uid("sim"),
        scenarioName,
        policyChanges,
        projections: {
            "7d_volume_MVC":    parseFloat((base * 7 * (1 + mintBonus - txFee) * 10).toFixed(2)),
            "30d_volume_MVC":   parseFloat((base * 30 * (1 + mintBonus - txFee) * 10).toFixed(2)),
            inflation_risk:     txFee < 0.01 ? "HIGH" : txFee < 0.03 ? "MEDIUM" : "LOW",
            liquidity_forecast: mintBonus > 0.1 ? "strong" : "moderate"
        },
        confidence:   Math.round(55 + Math.random()*35),
        simulatedAt:  NOW()
    };

    metaLog(AGENT, "system", "economy_simulated", { scenarioName }, "INFO");
    return ok(AGENT, simulation, { note:"Educational economic simulation only — no real financial data" });
}

function getPriceHistory({ assetType = "MVC", periods = 30 }) {
    const history = [];
    let price = 1.0;
    const from = new Date();
    for (let i = periods; i >= 0; i--) {
        price = parseFloat((price * (0.95 + Math.random()*0.1)).toFixed(4));
        const d = new Date(from - i*86400000);
        history.push({ date:d.toISOString().slice(0,10), open:price, close:parseFloat((price*(0.98+Math.random()*0.04)).toFixed(4)), volume:Math.round(Math.random()*10000) });
    }
    return ok(AGENT, { assetType, periods, priceHistory:history, currency:"MVC", note:"Simulated price history — not real market data" });
}

module.exports = { getEconomySnapshot, runEconomicSimulation, getPriceHistory };
