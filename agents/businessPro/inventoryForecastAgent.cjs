/**
 * Inventory Forecast Agent — predicts stock needs from order history.
 * Pure calculation; reads from ecommerceManager.
 */

const { listProducts, listOrders } = require("./ecommerceManager.cjs");
const { NOW } = require("./_store.cjs");

const SAFETY_MULTIPLIER = 1.25; // 25% buffer above forecast

function _velocityDays(orders, productId, days = 30) {
    const since = Date.now() - days * 86_400_000;
    let sold = 0;
    for (const o of orders) {
        if (new Date(o.createdAt).getTime() < since) continue;
        for (const item of o.items || []) {
            if (item.productId === productId || item.name === productId) sold += item.qty || 1;
        }
    }
    return sold / days; // units per day
}

function forecastProduct(product, orders, forecastDays = 30) {
    const velocity    = _velocityDays(orders, product.id, 30);
    const demand      = Math.ceil(velocity * forecastDays);
    const recommended = Math.ceil(demand * SAFETY_MULTIPLIER);
    const deficit     = Math.max(0, recommended - product.stock);
    const daysLeft    = velocity > 0 ? Math.floor(product.stock / velocity) : 999;

    return {
        id:          product.id,
        name:        product.name,
        sku:         product.sku,
        currentStock: product.stock,
        velocity:    +velocity.toFixed(3),
        demandNext:  demand,
        recommended,
        deficit,
        daysLeft,
        status:      daysLeft <= 7 ? "critical" : daysLeft <= 14 ? "low" : "ok",
        forecastAt:  NOW()
    };
}

function forecast({ days = 30, onlyLow = false } = {}) {
    const products = listProducts({ active: true });
    const orders   = listOrders({ limit: 500 });
    let results    = products.map(p => forecastProduct(p, orders, days));
    if (onlyLow) results = results.filter(r => r.status !== "ok");
    results.sort((a, b) => a.daysLeft - b.daysLeft);
    return { forecast: results, generatedAt: NOW(), forecastDays: days };
}

async function run(task) {
    const p = task.payload || {};
    try {
        const data = forecast({ days: p.days || 30, onlyLow: p.onlyLow || false });
        return { success: true, type: "business_pro", agent: "inventoryForecastAgent", data };
    } catch (err) {
        return { success: false, type: "business_pro", agent: "inventoryForecastAgent", data: { error: err.message } };
    }
}

module.exports = { forecast, forecastProduct, run };
