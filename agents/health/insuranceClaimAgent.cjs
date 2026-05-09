"use strict";
const { load, flush, uid, NOW, ok, fail, accessLog } = require("./_healthStore.cjs");

const AGENT = "insuranceClaimAgent";

const CLAIM_TYPES   = ["hospitalisation","surgery","diagnostic","medication","icu","daycare","pre_post_hospitalisation","maternity","mental_health","dental","vision","accident"];
const CLAIM_STATUS  = ["draft","submitted","under_review","approved","rejected","appealed","paid"];

function createClaim({ userId, claimType, hospitalName, admissionDate, dischargeDate, diagnosis, billAmount, policyNumber, insurerName, documents = [] }) {
    if (!userId || !claimType || !billAmount || !policyNumber)
        return fail(AGENT, "userId, claimType, billAmount and policyNumber required");
    if (!CLAIM_TYPES.includes(claimType))
        return fail(AGENT, `Invalid claimType. Use: ${CLAIM_TYPES.join(", ")}`);

    accessLog(userId, AGENT, "claim_created", { claimType, billAmount });

    const claim = {
        id:            uid("clm"),
        userId,
        claimType,
        hospitalName:  hospitalName || "",
        admissionDate: admissionDate || "",
        dischargeDate: dischargeDate || "",
        diagnosis:     diagnosis || "",
        billAmount:    Number(billAmount),
        policyNumber,
        insurerName:   insurerName || "",
        documents,
        status:        "draft",
        timeline:      [{ status: "draft", date: NOW(), note: "Claim created" }],
        createdAt:     NOW()
    };

    const claims = load(userId, "insurance_claims", []);
    claims.push(claim);
    flush(userId, "insurance_claims", claims.slice(-200));

    return ok(AGENT, {
        claim,
        requiredDocuments: _getRequiredDocs(claimType),
        nextSteps: [
            "Collect all required documents (originals + copies)",
            "Submit to insurer within 30 days of discharge (most policies)",
            "Keep copies of everything submitted",
            "Note your claim number for follow-up",
            "Contact insurer's TPA (Third Party Administrator) for cashless claims"
        ],
        cashlessNote: "For cashless treatment, notify insurer/TPA BEFORE hospitalisation (or within 24h for emergency). Get pre-authorisation."
    });
}

function _getRequiredDocs(claimType) {
    const base = ["Claim form (from insurer)","Original hospital bills with itemised breakup","Discharge summary","Doctor's prescription and reports","Policy documents","ID proof","Cancelled cheque"];
    if (claimType === "surgery")         base.push("OT notes","Anaesthesiologist charges");
    if (claimType === "maternity")       base.push("Delivery notes","Newborn certificate");
    if (claimType === "accident")        base.push("FIR/police report","Medico-legal case (MLC) report");
    if (claimType === "icu")             base.push("ICU admission certificate","ICU charges breakdown");
    if (claimType === "mental_health")   base.push("Psychiatrist referral letter","Treatment plan");
    return base;
}

function updateClaimStatus({ userId, claimId, status, note = "" }) {
    if (!userId || !claimId || !status) return fail(AGENT, "userId, claimId and status required");
    if (!CLAIM_STATUS.includes(status)) return fail(AGENT, `Invalid status. Use: ${CLAIM_STATUS.join(", ")}`);
    accessLog(userId, AGENT, "claim_updated", { claimId, status });

    const claims = load(userId, "insurance_claims", []);
    const idx    = claims.findIndex(c => c.id === claimId);
    if (idx === -1) return fail(AGENT, "Claim not found");

    claims[idx].status = status;
    claims[idx].timeline.push({ status, date: NOW(), note });
    flush(userId, "insurance_claims", claims);
    return ok(AGENT, claims[idx]);
}

function getClaims({ userId, status }) {
    if (!userId) return fail(AGENT, "userId required");
    let claims = load(userId, "insurance_claims", []);
    if (status) claims = claims.filter(c => c.status === status);
    return ok(AGENT, { claims: claims.slice(-50).reverse(), total: claims.length });
}

function getRejectionHelp({ userId, reason }) {
    if (!userId) return fail(AGENT, "userId required");
    const advice = {
        "pre_existing": "Pre-existing exclusions have mandatory waiting periods (usually 2-4 years). Review your policy document for exact terms.",
        "non_disclosure": "If insurer claims non-disclosure, you have the right to appeal. Consult an insurance ombudsman.",
        "waiting_period": "Check your policy for specific waiting periods. You may be eligible for reimbursement after the waiting period expires.",
        "not_covered": "Review your policy exclusions carefully. Many lifestyle conditions, dental, and vision need riders.",
        "document_missing": "Resubmit with complete documentation. Ask hospital for duplicate originals if lost.",
        "default": "For any rejected claim: 1) Get rejection reason in writing, 2) Appeal within 15 days, 3) Escalate to IRDAI Grievance Portal (igms.irda.gov.in), 4) Insurance Ombudsman if needed (free service)"
    };
    const key = reason?.toLowerCase().replace(/\s+/g,"_");
    const matched = Object.entries(advice).find(([k]) => (reason || "").toLowerCase().includes(k.replace(/_/g," ")));
    return ok(AGENT, {
        advice: matched ? matched[1] : advice.default,
        escalation: {
            IRDAI: "igms.irda.gov.in (Grievance portal)",
            Ombudsman: "Insurance Ombudsman — free service, binds insurers",
            NCDRC: "Consumer forums — for large amounts"
        }
    });
}

module.exports = { createClaim, updateClaimStatus, getClaims, getRejectionHelp };
