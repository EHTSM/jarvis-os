/**
 * Funnel Builder Agent — creates and manages multi-step sales funnels.
 * Funnels persist to data/businesspro/funnels.json.
 * Payment step links to existing paymentAgent.
 * Lead tracking uses existing crm.cjs.
 */

const { load, flush, uid, MAX_BATCH, NOW } = require("./_store.cjs");
const { getLeads, updateLead }             = require("../crm.cjs");

const STORE = "funnels";

// Built-in funnel templates
const TEMPLATES = {
    saas: {
        name: "SaaS Lead-to-Close",
        steps: [
            { order: 1, type: "capture",  name: "Lead Capture",     action: "collect_name_phone",    delay: 0 },
            { order: 2, type: "nurture",  name: "Welcome Message",  action: "send_welcome_whatsapp", delay: 0 },
            { order: 3, type: "nurture",  name: "Value Email #1",   action: "send_email",            delay: 1440 },  // 24h
            { order: 4, type: "offer",    name: "Demo Offer",       action: "send_demo_invite",      delay: 2880 },  // 48h
            { order: 5, type: "close",    name: "Payment Link",     action: "send_payment_link",     delay: 60   },
            { order: 6, type: "upsell",   name: "Upsell Premium",   action: "send_upsell_offer",     delay: 1440 }
        ]
    },
    ecommerce: {
        name: "E-commerce Purchase Funnel",
        steps: [
            { order: 1, type: "capture",  name: "Visitor",          action: "track_visit",           delay: 0    },
            { order: 2, type: "nurture",  name: "Product View",     action: "show_product",          delay: 0    },
            { order: 3, type: "offer",    name: "Add to Cart CTA",  action: "cart_reminder",         delay: 30   },
            { order: 4, type: "close",    name: "Checkout",         action: "send_payment_link",     delay: 60   },
            { order: 5, type: "upsell",   name: "Order Bump",       action: "send_order_bump",       delay: 0    },
            { order: 6, type: "nurture",  name: "Post-Purchase",    action: "send_thank_you",        delay: 1440 }
        ]
    },
    lead_gen: {
        name: "Lead Generation Funnel",
        steps: [
            { order: 1, type: "capture", name: "Free Lead Magnet",  action: "deliver_lead_magnet",  delay: 0    },
            { order: 2, type: "nurture", name: "Follow-Up #1",      action: "send_whatsapp",        delay: 1440 },
            { order: 3, type: "nurture", name: "Follow-Up #2",      action: "send_whatsapp",        delay: 2880 },
            { order: 4, type: "offer",   name: "Tripwire Offer",    action: "send_low_ticket_offer",delay: 4320 },
            { order: 5, type: "close",   name: "Core Offer",        action: "send_payment_link",    delay: 1440 }
        ]
    }
};

function _all()          { return load(STORE, []); }
function _save(funnels)  { flush(STORE, funnels); }

/**
 * Create a new funnel.
 * @param {string} name
 * @param {string} template   saas | ecommerce | lead_gen | custom
 * @param {Array}  customSteps  required when template = "custom"
 */
function create(name, template = "saas", customSteps = null) {
    const funnels = _all();
    const tmpl    = TEMPLATES[template];
    if (!tmpl && !customSteps) throw new Error(`Template "${template}" not found. Use: ${Object.keys(TEMPLATES).join(", ")} or pass customSteps`);

    const funnel = {
        id:        uid("funnel"),
        name:      name || tmpl?.name || "Custom Funnel",
        template,
        steps:     customSteps || tmpl.steps.map(s => ({ ...s, id: uid("step") })),
        active:    true,
        leads:     [],
        stats:     { entered: 0, completed: 0, converted: 0, revenue: 0 },
        createdAt: NOW(),
        updatedAt: NOW()
    };
    funnels.push(funnel);
    _save(funnels);
    return funnel;
}

/**
 * Add a lead to a funnel — tracks their current step.
 */
function enterFunnel(funnelId, phone) {
    const funnels = _all();
    const funnel  = funnels.find(f => f.id === funnelId);
    if (!funnel) throw new Error("Funnel not found");

    const leads = getLeads();
    const lead  = leads.find(l => l.phone === phone);
    if (!lead) throw new Error("Lead not found in CRM");

    // Avoid duplicates
    if (funnel.leads.find(l => l.phone === phone)) {
        return { alreadyEnrolled: true, funnel: funnel.name, phone };
    }

    funnel.leads.push({ phone, name: lead.name, currentStep: 1, enteredAt: NOW(), status: "active" });
    funnel.stats.entered++;
    _save(funnels);

    updateLead(phone, { funnel: funnel.name, funnelStep: 1, funnelStatus: "active" });
    return { enrolled: true, funnel: funnel.name, phone, firstStep: funnel.steps[0] };
}

/**
 * Advance a lead to the next funnel step.
 */
function advanceStep(funnelId, phone) {
    const funnels  = _all();
    const funnel   = funnels.find(f => f.id === funnelId);
    if (!funnel) throw new Error("Funnel not found");

    const entry = funnel.leads.find(l => l.phone === phone);
    if (!entry) throw new Error("Lead not in this funnel");
    if (entry.status === "completed") return { alreadyComplete: true };

    const nextStep = entry.currentStep + 1;
    const step     = funnel.steps.find(s => s.order === nextStep);

    entry.currentStep = nextStep;
    entry.updatedAt   = NOW();

    if (!step) {
        entry.status = "completed";
        funnel.stats.completed++;
    }

    updateLead(phone, { funnelStep: nextStep, funnelStatus: entry.status });
    _save(funnels);
    return { phone, funnel: funnel.name, currentStep: nextStep, step: step || null, completed: !step };
}

function get(id) { return _all().find(f => f.id === id) || null; }
function list()  { return _all(); }
function stats() {
    const all = _all();
    return { total: all.length, active: all.filter(f => f.active).length, templates: Object.keys(TEMPLATES) };
}

async function run(task) {
    const p        = task.payload || {};
    const action   = task.type;

    try {
        let data;
        if (action === "build_funnel" || action === "create_funnel") {
            data = create(p.name, p.template || "saas", p.steps || null);
        } else if (action === "enter_funnel") {
            data = enterFunnel(p.funnelId, p.phone);
        } else if (action === "advance_funnel") {
            data = advanceStep(p.funnelId, p.phone);
        } else if (action === "list_funnels") {
            data = { funnels: list(), stats: stats() };
        } else if (action === "funnel_stats") {
            data = stats();
        } else {
            data = { funnels: list(), stats: stats() };
        }
        return { success: true, type: "business_pro", agent: "funnelBuilderAgent", data };
    } catch (err) {
        return { success: false, type: "business_pro", agent: "funnelBuilderAgent", data: { error: err.message } };
    }
}

module.exports = { create, enterFunnel, advanceStep, get, list, stats, run };
