/**
 * Compliance Manager — tracks regulatory compliance status per tenant.
 */

const { load, flush, requireAuth, auditLog, uid, NOW, ok, fail, forbidden } = require("./_enterpriseStore.cjs");

const FRAMEWORKS = {
    gdpr:   { name: "GDPR",          region: "EU",    controls: ["data_mapping","consent_mgmt","breach_notification","dsr_process","dpa_signed"] },
    iso27001:{ name: "ISO 27001",     region: "Global",controls: ["risk_assessment","isms_policy","access_control","incident_response","audit_trail"] },
    soc2:   { name: "SOC 2",          region: "US",    controls: ["availability","security","confidentiality","processing_integrity","privacy"] },
    hipaa:  { name: "HIPAA",          region: "US",    controls: ["phi_protection","access_controls","audit_log","encryption","breach_notice"] },
    india_pdpb:{ name:"India PDPB",   region:"India",  controls: ["consent","data_localization","grievance_officer","privacy_notice","retention_policy"] }
};

function getStatus(tenantId, requesterId, framework = "gdpr") {
    const auth = requireAuth(tenantId, requesterId, "admin");
    if (!auth.ok) return forbidden("complianceManager", auth.error);

    const fw      = FRAMEWORKS[framework] || FRAMEWORKS.gdpr;
    const status  = load(tenantId, `compliance-${framework}`, {});
    const controls = fw.controls.map(c => ({
        control:     c,
        status:      status[c] || "not_started",
        lastChecked: status[`${c}_date`] || null
    }));

    const passed   = controls.filter(c => c.status === "compliant").length;
    const score    = Math.round(passed / controls.length * 100);

    return ok("complianceManager", {
        tenantId, framework: fw.name, region: fw.region,
        controls, score: score + "%",
        status: score === 100 ? "compliant" : score >= 60 ? "partial" : "non_compliant",
        checkedAt: NOW()
    });
}

function updateControl({ tenantId, userId, framework, control, status }) {
    const auth = requireAuth(tenantId, userId, "admin");
    if (!auth.ok) return forbidden("complianceManager", auth.error);

    const fw    = FRAMEWORKS[framework];
    if (!fw?.controls.includes(control)) return fail("complianceManager", `Unknown control: ${control}`);

    const state = load(tenantId, `compliance-${framework}`, {});
    state[control]            = status;
    state[`${control}_date`]  = NOW();
    state[`${control}_updatedBy`] = userId;
    flush(tenantId, `compliance-${framework}`, state);
    auditLog(tenantId, userId, "compliance_updated", { framework, control, status });
    return ok("complianceManager", { updated: true, control, status });
}

async function run(task) {
    const p = task.payload || {};
    try {
        const data = task.type === "update_control" ? updateControl(p) : getStatus(p.tenantId, p.userId, p.framework || "gdpr");
        return data;
    } catch (err) { return fail("complianceManager", err.message); }
}

module.exports = { getStatus, updateControl, FRAMEWORKS, run };
