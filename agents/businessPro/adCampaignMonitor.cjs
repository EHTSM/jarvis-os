/**
 * Ad Campaign Monitor — tracks campaign performance metrics.
 * Stores in data/businesspro/campaigns.json.
 * Supports: create, update metrics, get reports, pause/resume.
 */

const { load, flush, uid, NOW } = require("./_store.cjs");

const STORE = "campaigns";

function _all()        { return load(STORE, []); }
function _save(data)   { flush(STORE, data); }

const PLATFORMS = ["facebook","google","instagram","linkedin","whatsapp","tiktok"];

/**
 * Create a new ad campaign record.
 */
function create({ name, platform, budget, targetAudience = "", adCopy = "" }) {
    if (!name)     throw new Error("name required");
    if (!platform || !PLATFORMS.includes(platform)) throw new Error(`platform must be one of: ${PLATFORMS.join(", ")}`);
    if (!budget)   throw new Error("budget (INR) required");

    const campaigns = _all();
    const campaign  = {
        id:             uid("camp"),
        name,
        platform,
        budget,
        spent:          0,
        status:         "active",
        adCopy,
        targetAudience,
        metrics:        { impressions: 0, clicks: 0, conversions: 0, leads: 0, revenue: 0 },
        ctr:            0,
        cpc:            0,
        roas:           0,
        createdAt:      NOW(),
        updatedAt:      NOW()
    };
    campaigns.push(campaign);
    _save(campaigns);
    return campaign;
}

/**
 * Update campaign metrics (call after each analytics sync).
 */
function updateMetrics(id, metrics = {}) {
    const campaigns = _all();
    const campaign  = campaigns.find(c => c.id === id);
    if (!campaign) throw new Error("Campaign not found");

    Object.assign(campaign.metrics, metrics);

    // Recalculate derived metrics
    const { impressions, clicks, conversions, revenue } = campaign.metrics;
    campaign.ctr     = impressions ? Math.round((clicks / impressions) * 10000) / 100 : 0;  // %
    campaign.cpc     = clicks && campaign.spent ? Math.round(campaign.spent / clicks) : 0;
    campaign.roas    = campaign.spent ? Math.round((revenue / campaign.spent) * 100) / 100 : 0;
    campaign.updatedAt = NOW();

    _save(campaigns);
    return campaign;
}

/**
 * Pause or resume a campaign.
 */
function setStatus(id, status) {
    if (!["active","paused","completed","cancelled"].includes(status)) throw new Error("Invalid status");
    const campaigns = _all();
    const campaign  = campaigns.find(c => c.id === id);
    if (!campaign) throw new Error("Campaign not found");
    campaign.status    = status;
    campaign.updatedAt = NOW();
    _save(campaigns);
    return campaign;
}

/**
 * Get a performance report for all campaigns or a specific one.
 */
function report(id = null) {
    const campaigns = id ? _all().filter(c => c.id === id) : _all();
    const totalSpent   = campaigns.reduce((s, c) => s + (c.spent || 0), 0);
    const totalRevenue = campaigns.reduce((s, c) => s + (c.metrics.revenue || 0), 0);
    const totalLeads   = campaigns.reduce((s, c) => s + (c.metrics.leads || 0), 0);

    return {
        campaigns,
        summary: {
            total:        campaigns.length,
            active:       campaigns.filter(c => c.status === "active").length,
            totalSpent:   `₹${totalSpent}`,
            totalRevenue: `₹${totalRevenue}`,
            totalLeads,
            overallROAS:  totalSpent ? Math.round((totalRevenue / totalSpent) * 100) / 100 : 0
        }
    };
}

/**
 * Auto-suggest actions based on campaign performance.
 */
function autoSuggest() {
    const campaigns = _all().filter(c => c.status === "active");
    const actions   = [];

    for (const c of campaigns) {
        if (c.ctr < 1 && c.metrics.impressions > 1000) {
            actions.push({ campaignId: c.id, name: c.name, action: "pause_or_rework_copy", reason: `CTR ${c.ctr}% is below 1% threshold` });
        }
        if (c.roas < 1 && c.spent > 500) {
            actions.push({ campaignId: c.id, name: c.name, action: "reduce_budget", reason: `ROAS ${c.roas} < 1 — spending more than earning` });
        }
        if (c.roas > 3) {
            actions.push({ campaignId: c.id, name: c.name, action: "scale_budget", reason: `ROAS ${c.roas} > 3 — strong performer, increase budget` });
        }
        if (c.spent >= c.budget * 0.9) {
            actions.push({ campaignId: c.id, name: c.name, action: "replenish_budget", reason: `${Math.round((c.spent / c.budget) * 100)}% of budget consumed` });
        }
    }

    return { suggestions: actions, analyzedAt: NOW() };
}

async function run(task) {
    const p  = task.payload || {};
    const id = p.id || null;

    try {
        let data;
        switch (task.type) {
            case "create_campaign":    data = create(p); break;
            case "update_campaign":    data = updateMetrics(id, p.metrics || {}); break;
            case "pause_campaign":     data = setStatus(id, "paused"); break;
            case "resume_campaign":    data = setStatus(id, "active"); break;
            case "campaign_report":    data = report(id); break;
            case "campaign_suggest":   data = autoSuggest(); break;
            default:                   data = report();
        }
        return { success: true, type: "business_pro", agent: "adCampaignMonitor", data };
    } catch (err) {
        return { success: false, type: "business_pro", agent: "adCampaignMonitor", data: { error: err.message } };
    }
}

module.exports = { create, updateMetrics, setStatus, report, autoSuggest, run };
