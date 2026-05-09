/**
 * Pricing Optimizer — adjusts prices based on conversion rate, demand signals, and competitor data.
 * Reads analytics from businessAnalytics. No hardcoded values.
 */

const { load, flush, NOW } = require("./_store.cjs");

const STORE   = "pricing";
const HISTORY = "pricing-history";

const RULES = {
    conversionTooLow:  { threshold: 2,  action: "decrease", pct: 10, reason: "Conversion < 2% — reduce price to drive volume" },
    conversionHigh:    { threshold: 15, action: "increase", pct: 5,  reason: "Conversion > 15% — room to increase margin" },
    demandSpike:       { threshold: 30, action: "increase", pct: 8,  reason: "Traffic spike — demand pricing opportunity" },
    demandDrop:        { threshold: 5,  action: "decrease", pct: 8,  reason: "Traffic drop — stimulate demand with lower price" }
};

function _prices()      { return load(STORE, {}); }
function _history()     { return load(HISTORY, []); }
function _savePrices(d) { flush(STORE, d); }
function _saveHistory(d){ flush(HISTORY, d); }

/**
 * Set the current price for a product/plan.
 */
function setPrice(productId, price, currency = "INR") {
    const prices = _prices();
    prices[productId] = { price, currency, setAt: NOW() };
    _savePrices(prices);
    return prices[productId];
}

/**
 * Get the current price for a product/plan.
 */
function getPrice(productId) {
    return _prices()[productId] || null;
}

/**
 * Analyze metrics and suggest a price adjustment.
 * @param {string} productId
 * @param {object} metrics  { conversionRate, weeklyTraffic, competitorPrice }
 */
function analyze(productId, metrics = {}) {
    const prices  = _prices();
    const current = prices[productId];
    if (!current) return { error: `No price set for "${productId}". Call setPrice() first.` };

    const { conversionRate = 5, weeklyTraffic = 100, competitorPrice = null } = metrics;
    const suggestions = [];
    let recommendedPrice = current.price;

    if (conversionRate < RULES.conversionTooLow.threshold) {
        const delta = Math.round(current.price * RULES.conversionTooLow.pct / 100);
        suggestions.push({ rule: "conversionTooLow", ...RULES.conversionTooLow, delta: -delta, newPrice: current.price - delta });
        recommendedPrice = Math.max(99, current.price - delta);
    }

    if (conversionRate > RULES.conversionHigh.threshold) {
        const delta = Math.round(current.price * RULES.conversionHigh.pct / 100);
        suggestions.push({ rule: "conversionHigh", ...RULES.conversionHigh, delta: +delta, newPrice: current.price + delta });
        recommendedPrice = current.price + delta;
    }

    if (weeklyTraffic > RULES.demandSpike.threshold * 10) {
        const delta = Math.round(current.price * RULES.demandSpike.pct / 100);
        suggestions.push({ rule: "demandSpike", ...RULES.demandSpike, delta: +delta, newPrice: current.price + delta });
    }

    if (competitorPrice && competitorPrice < current.price * 0.8) {
        const delta = Math.round((current.price - competitorPrice) * 0.5);
        suggestions.push({ rule: "competitorUndercut", reason: "Competitor price 20%+ lower", action: "decrease", delta: -delta, newPrice: current.price - delta });
        recommendedPrice = Math.min(recommendedPrice, current.price - delta);
    }

    // Log recommendation
    const rec = { productId, currentPrice: current.price, recommendedPrice, suggestions, metrics, analyzedAt: NOW() };
    const hist = _history();
    hist.push(rec);
    if (hist.length > 100) hist.splice(0, hist.length - 100);
    _saveHistory(hist);

    return {
        productId,
        currentPrice:     `${current.currency} ${current.price}`,
        recommendedPrice: `${current.currency} ${recommendedPrice}`,
        change:           recommendedPrice - current.price,
        changePct:        Math.round(((recommendedPrice - current.price) / current.price) * 100),
        suggestions,
        metrics,
        advice: suggestions.length
            ? `Apply recommended price: ${current.currency} ${recommendedPrice} (${suggestions[0].reason})`
            : "Current price is optimal — no change needed"
    };
}

/**
 * Apply the recommended price after analysis.
 */
function applyRecommendation(productId, newPrice) {
    const prices  = _prices();
    const current = prices[productId];
    if (!current) throw new Error(`Product "${productId}" not found`);
    const old = current.price;
    prices[productId] = { ...current, price: newPrice, previousPrice: old, updatedAt: NOW() };
    _savePrices(prices);
    return { productId, oldPrice: old, newPrice, appliedAt: NOW() };
}

function history(productId, limit = 10) {
    return _history().filter(h => !productId || h.productId === productId).slice(-limit);
}

async function run(task) {
    const p         = task.payload || {};
    const productId = p.productId || p.product || "default";
    const action    = task.type;

    try {
        let data;
        if (action === "set_price") {
            data = setPrice(productId, p.price, p.currency || "INR");
        } else if (action === "get_price") {
            data = getPrice(productId) || { error: "No price set" };
        } else if (action === "apply_price") {
            data = applyRecommendation(productId, p.newPrice);
        } else {
            data = analyze(productId, { conversionRate: p.conversionRate, weeklyTraffic: p.weeklyTraffic, competitorPrice: p.competitorPrice });
        }
        return { success: true, type: "business_pro", agent: "pricingOptimizer", data };
    } catch (err) {
        return { success: false, type: "business_pro", agent: "pricingOptimizer", data: { error: err.message } };
    }
}

module.exports = { setPrice, getPrice, analyze, applyRecommendation, history, run };
