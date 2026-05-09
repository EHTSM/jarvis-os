"use strict";
const { load, flush, loadUser, flushUser, ftLog, uid, NOW, simValue, simConfidence, ok, fail } = require("./_futureTechStore.cjs");

const AGENT = "foodSupplyChainAI";

const FOOD_CATEGORIES   = ["grains","vegetables","fruits","dairy","meat","seafood","processed","beverages","spices","legumes"];
const CHAIN_STAGES      = ["production","processing","packaging","storage","transport","distribution","retail","consumption"];
const TRANSPORT_MODES   = ["road","rail","sea","air","cold_chain","pipeline"];
const CERTIFICATION_TYPES = ["organic","fair_trade","halal","kosher","gluten_free","non_GMO","rainforest_alliance","UTZ"];
const RISK_CATEGORIES   = ["contamination","spoilage","shortage","logistics_delay","regulatory","weather","geopolitical","price_volatility"];
const STORAGE_CONDITIONS = ["ambient","refrigerated","frozen","controlled_atmosphere","dry","humidity_controlled"];

function traceProduct({ userId, productId, batchId, category }) {
    if (!userId) return fail(AGENT, "userId required");
    if (category && !FOOD_CATEGORIES.includes(category)) return fail(AGENT, `category must be: ${FOOD_CATEGORIES.join(", ")}`);

    const stages = CHAIN_STAGES.map((stage, i) => ({
        stage,
        stageId:           uid("stg"),
        location:          `Facility_${stage.toUpperCase()}_${Math.floor(Math.random()*100)+1}`,
        country:           ["US","DE","NL","CN","BR","IN","MX","AU"][Math.floor(Math.random()*8)],
        operator:          `Operator_${uid("op")}`,
        entryTime:         new Date(Date.now() - (CHAIN_STAGES.length - i) * 86400000 * simValue(1,5,0)).toISOString(),
        exitTime:          new Date(Date.now() - (CHAIN_STAGES.length - i - 1) * 86400000 * simValue(1,5,0)).toISOString(),
        temperature_C:     parseFloat(simValue(-20, 25, 1)),
        humidity_pct:      parseFloat(simValue(30, 95, 1)),
        qualityCheck:      Math.random() > 0.1 ? "passed" : "flagged",
        certifications:    CERTIFICATION_TYPES.slice(0, Math.floor(Math.random()*3))
    }));

    const trace = {
        traceId:        uid("trc"),
        productId:      productId || uid("prod"),
        batchId:        batchId || uid("batch"),
        category:       category || FOOD_CATEGORIES[Math.floor(Math.random() * FOOD_CATEGORIES.length)],
        stages,
        flaggedStages:  stages.filter(s => s.qualityCheck === "flagged").map(s => s.stage),
        supplyChainLength_days: Math.round(simValue(3, 60, 0)),
        carbonFootprint_kgCO2e: parseFloat(simValue(0.1, 50, 3)),
        certifications: [...new Set(stages.flatMap(s => s.certifications))],
        traceabilityScore: Math.round(simValue(60, 100, 0)),
        tracedAt:       NOW()
    };

    const log = load(`trace_log_${productId || "global"}`, []);
    log.push({ traceId: trace.traceId, productId, batchId, category, tracedAt: trace.tracedAt });
    flush(`trace_log_${productId || "global"}`, log.slice(-500));

    ftLog(AGENT, userId, "product_traced", { productId, batchId, category, flaggedCount: trace.flaggedStages.length }, "INFO");
    return ok(AGENT, trace);
}

function assessSupplyChainRisk({ userId, chainId, categories = FOOD_CATEGORIES, region }) {
    if (!userId) return fail(AGENT, "userId required");
    const invalidCats = categories.filter(c => !FOOD_CATEGORIES.includes(c));
    if (invalidCats.length) return fail(AGENT, `invalid categories: ${invalidCats.join(",")}. Valid: ${FOOD_CATEGORIES.join(", ")}`);

    const risks = RISK_CATEGORIES.map(cat => ({
        category:        cat,
        probability_pct: parseFloat(simValue(5, 80, 1)),
        impact:          ["low","moderate","high","severe"][Math.floor(Math.random()*4)],
        affectedCategories: categories.slice(0, Math.floor(Math.random()*3)+1),
        mitigationOptions:  _getMitigations(cat),
        timeToImpact_days:  Math.round(simValue(1, 180, 0))
    }));

    const overallRisk = Math.round(risks.reduce((s, r) => s + r.probability_pct, 0) / risks.length);
    const assessment = {
        assessmentId:   uid("scr"),
        chainId:        chainId || `chain_${uid("c")}`,
        region:         region || "global",
        categories,
        overallRisk_pct: overallRisk,
        riskBand:       overallRisk > 70 ? "critical" : overallRisk > 50 ? "high" : overallRisk > 30 ? "moderate" : "low",
        risks,
        topRisk:        risks.sort((a, b) => b.probability_pct - a.probability_pct)[0].category,
        confidence:     simConfidence(),
        assessedAt:     NOW()
    };

    ftLog(AGENT, userId, "supply_chain_risk_assessed", { chainId, overallRisk_pct: overallRisk, region }, "INFO");
    return ok(AGENT, assessment);
}

function _getMitigations(riskCategory) {
    const map = {
        contamination:    ["HACCP_implementation","supplier_audits","testing_protocols"],
        spoilage:         ["cold_chain_improvement","packaging_upgrade","inventory_rotation"],
        shortage:         ["diversify_suppliers","safety_stock","forward_contracts"],
        logistics_delay:  ["multi_modal_transport","route_optimization","buffer_warehousing"],
        regulatory:       ["compliance_monitoring","certifications","legal_advisory"],
        weather:          ["crop_insurance","geographic_diversification","climate_smart_sourcing"],
        geopolitical:     ["supplier_diversification","local_sourcing","geopolitical_monitoring"],
        price_volatility: ["futures_hedging","long_term_contracts","cost_reduction_programs"]
    };
    return (map[riskCategory] || ["general_risk_mitigation"]).slice(0, 2);
}

function optimiseInventory({ userId, warehouseId, products, storageCondition = "ambient" }) {
    if (!userId) return fail(AGENT, "userId required");
    if (!STORAGE_CONDITIONS.includes(storageCondition)) return fail(AGENT, `storageCondition must be: ${STORAGE_CONDITIONS.join(", ")}`);

    const items = (products && products.length > 0 ? products : FOOD_CATEGORIES.slice(0, 5)).map(prod => ({
        product:         typeof prod === "string" ? prod : prod.product || "unknown",
        currentStock_t:  parseFloat(simValue(1, 1000, 2)),
        reorderPoint_t:  parseFloat(simValue(10, 200, 1)),
        reorderQty_t:    parseFloat(simValue(50, 500, 1)),
        shelfLife_days:  Math.round(simValue(1, 365, 0)),
        daysToExpiry:    Math.round(simValue(1, 180, 0)),
        demandForecast_t_week: parseFloat(simValue(1, 100, 2)),
        coverageDays:    Math.round(simValue(3, 90, 0)),
        actionRequired:  Math.random() > 0.6 ? ["reorder","rotate_stock","reduce_waste"][Math.floor(Math.random()*3)] : null
    }));

    const optimisation = {
        optimisationId:   uid("inv"),
        warehouseId:      warehouseId || `wh_${uid("w")}`,
        storageCondition,
        items,
        totalSKUs:        items.length,
        criticalItems:    items.filter(i => i.daysToExpiry < 7).length,
        reorderRequired:  items.filter(i => i.currentStock_t < i.reorderPoint_t).length,
        wasteReduction_pct: parseFloat(simValue(5, 35, 1)),
        costSaving_USD:   parseFloat(simValue(1000, 500000, 2)),
        optimisedAt:      NOW()
    };

    ftLog(AGENT, userId, "inventory_optimised", { warehouseId, totalSKUs: items.length, criticalItems: optimisation.criticalItems }, "INFO");
    return ok(AGENT, optimisation);
}

function getFoodSafetyAlerts({ userId, region, category, severity }) {
    if (!userId) return fail(AGENT, "userId required");
    if (category && !FOOD_CATEGORIES.includes(category)) return fail(AGENT, `category must be: ${FOOD_CATEGORIES.join(", ")}`);

    const SEVERITIES = ["info","warning","recall","emergency"];
    const HAZARD_TYPES = ["bacterial","chemical","physical","allergen","mycotoxin","viral","prion"];
    if (severity && !SEVERITIES.includes(severity)) return fail(AGENT, `severity must be: ${SEVERITIES.join(", ")}`);

    const alerts = Array.from({ length: Math.floor(Math.random()*6)+1 }, () => ({
        alertId:        uid("fsa"),
        category:       category || FOOD_CATEGORIES[Math.floor(Math.random() * FOOD_CATEGORIES.length)],
        severity:       severity || SEVERITIES[Math.floor(Math.random()*SEVERITIES.length)],
        hazardType:     HAZARD_TYPES[Math.floor(Math.random() * HAZARD_TYPES.length)],
        product:        `Product_${uid("p")}`,
        affectedBatches: Math.round(simValue(1, 50, 0)),
        region:         region || "global",
        recallRequired: Math.random() > 0.7,
        affectedCountries: ["US","UK","EU","AU"].slice(0, Math.floor(Math.random()*3)+1),
        actionRequired: "Quarantine affected batches and notify downstream distributors",
        issuedAt:       NOW()
    })).filter(a => !severity || a.severity === severity);

    ftLog(AGENT, userId, "food_safety_alerts_retrieved", { region, category, alertCount: alerts.length }, "INFO");
    return ok(AGENT, { region: region || "global", category, total: alerts.length, alerts, categories: FOOD_CATEGORIES, retrievedAt: NOW() });
}

module.exports = { traceProduct, assessSupplyChainRisk, optimiseInventory, getFoodSafetyAlerts };
