/**
 * Business CRM Agent — thin adapter over agents/crm.cjs.
 * Single source of truth: agents/crm.cjs → data/leads.json.
 * DO NOT add separate file storage here.
 */

const { saveLead, updateLead, getLeads } = require("../crm.cjs");

const VALID_STATUSES = ["new", "interested", "hot", "paid", "lost", "follow_up"];

async function run(task) {
    const p = task.payload || {};

    switch (task.type) {
        case "crm_add":
        case "add_lead":
        case "save_lead": {
            if (!p.name && !p.phone) {
                return { success: false, type: "crmAgent", data: { error: "name or phone required" } };
            }
            saveLead({
                name:    p.name    || "Unknown",
                phone:   p.phone   || "",
                email:   p.email   || "",
                source:  p.source  || "jarvis",
                message: p.message || "",
                amount:  p.amount  || 0
            });
            return { success: true, type: "crmAgent", data: { message: `Lead saved: ${p.name || p.phone}` } };
        }

        case "crm_leads":
        case "get_leads":
        case "list_leads":
        case "show_leads": {
            const all    = getLeads();
            const filter = p.status;
            const leads  = filter ? all.filter(l => l.status === filter) : all;
            return { success: true, type: "crmAgent", data: { leads, total: leads.length, filter: filter || "all" } };
        }

        case "crm_update":
        case "update_lead":
        case "update_status": {
            if (!p.phone) return { success: false, type: "crmAgent", data: { error: "phone required" } };
            if (p.status && !VALID_STATUSES.includes(p.status)) {
                return { success: false, type: "crmAgent", data: { error: `Invalid status. Use: ${VALID_STATUSES.join(", ")}` } };
            }
            updateLead(p.phone, { status: p.status, ...p.updates });
            return { success: true, type: "crmAgent", data: { message: `Lead ${p.phone} updated to ${p.status}` } };
        }

        case "crm_stats": {
            const all = getLeads();
            const byStatus = VALID_STATUSES.reduce((acc, s) => {
                acc[s] = all.filter(l => l.status === s).length;
                return acc;
            }, {});
            return {
                success: true, type: "crmAgent",
                data: { total: all.length, byStatus, sources: [...new Set(all.map(l => l.source).filter(Boolean))] }
            };
        }

        default:
            return { success: false, type: "crmAgent", data: { error: `Unknown CRM task: ${task.type}` } };
    }
}

module.exports = { run };
