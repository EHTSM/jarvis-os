"use strict";
const { load, flush, uid, NOW, securityLog, ok, fail } = require("./_securityStore.cjs");
const AGENT = "privacyManagerPro";

const PII_PATTERNS = {
    email:          { pattern:/\b[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}\b/g,                  type:"email",          sensitivity:"MEDIUM" },
    phone_india:    { pattern:/(\+91[\s-]?)?[6-9]\d{9}\b/g,                           type:"phone",          sensitivity:"MEDIUM" },
    aadhaar:        { pattern:/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,                     type:"aadhaar",        sensitivity:"HIGH" },
    pan_card:       { pattern:/\b[A-Z]{5}[0-9]{4}[A-Z]\b/g,                           type:"pan",            sensitivity:"HIGH" },
    credit_card:    { pattern:/\b(?:\d[ -]?){13,16}\b/g,                              type:"credit_card",    sensitivity:"CRITICAL" },
    passport:       { pattern:/\b[A-Z][0-9]{7}\b/g,                                   type:"passport",       sensitivity:"HIGH" },
    ip_address:     { pattern:/\b(?:\d{1,3}\.){3}\d{1,3}\b/g,                         type:"ip_address",     sensitivity:"LOW" },
    date_of_birth:  { pattern:/\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b/g,            type:"date_of_birth",  sensitivity:"MEDIUM" }
};

const DATA_SUBJECT_RIGHTS = {
    gdpr: ["Right of Access (Art.15)","Right to Rectification (Art.16)","Right to Erasure (Art.17)","Right to Restriction (Art.18)","Right to Portability (Art.20)","Right to Object (Art.21)"],
    dpdp: ["Right to Access information","Right to Correction","Right to Erasure","Right to Grievance Redressal","Right to Nominate"],
    ccpa: ["Right to Know","Right to Delete","Right to Opt-Out","Right to Non-Discrimination","Right to Correct"]
};

function scanForPII({ userId, text, maskOutput = true }) {
    if (!userId || !text) return fail(AGENT, "userId and text required");
    securityLog(AGENT, userId, "pii_scan", { textLength: text.length }, "INFO");

    const findings = [];
    let maskedText = text;

    for (const [name, { pattern, type, sensitivity }] of Object.entries(PII_PATTERNS)) {
        const matches = [...text.matchAll(pattern)];
        if (matches.length) {
            findings.push({ type, name, count: matches.length, sensitivity, examples: matches.slice(0,2).map(m => maskOutput ? _mask(m[0], type) : m[0]) });
            if (maskOutput) {
                maskedText = maskedText.replace(pattern, m => _mask(m, type));
            }
        }
    }

    const criticalFound = findings.some(f => f.sensitivity === "CRITICAL");
    if (criticalFound) securityLog(AGENT, userId, "critical_pii_found", { types: findings.map(f => f.type) }, "HIGH");

    return ok(AGENT, {
        hasPII:     findings.length > 0,
        findings,
        maskedText: maskOutput ? maskedText : "[maskOutput=false — raw text not returned for security]",
        recommendation: criticalFound ? "⚠️ CRITICAL PII detected — do not log or transmit this data unencrypted" : findings.length ? "PII found — apply appropriate controls" : "No PII detected"
    });
}

function _mask(value, type) {
    if (type === "credit_card") return "**** **** **** " + value.replace(/\D/g,"").slice(-4);
    if (type === "aadhaar")     return "XXXX XXXX " + value.replace(/\D/g,"").slice(-4);
    if (type === "email")       { const [l, d] = value.split("@"); return l.slice(0,2) + "****@" + d; }
    return value.slice(0, 2) + "*".repeat(Math.max(0, value.length - 4)) + value.slice(-2);
}

function handleDataSubjectRequest({ userId, subjectId, requestType, regulation = "gdpr" }) {
    if (!userId || !subjectId || !requestType) return fail(AGENT, "userId, subjectId, requestType required");
    securityLog(AGENT, userId, "dsr_received", { requestType, regulation }, "INFO");

    const rights = DATA_SUBJECT_RIGHTS[regulation.toLowerCase()] || DATA_SUBJECT_RIGHTS.gdpr;
    const deadline = new Date(Date.now() + 30 * 86400000).toISOString().slice(0,10);

    const dsr = {
        id:         uid("dsr"),
        userId,
        subjectId,
        requestType,
        regulation,
        deadline,
        rights,
        workflowSteps: [
            "Verify identity of requester (within 2 days)",
            "Acknowledge receipt (within 3 days)",
            "Locate all data related to subject",
            "Fulfill request or state legitimate grounds for refusal",
            `Respond within statutory deadline: ${deadline}`,
            "Log the request and response"
        ],
        createdAt:  NOW()
    };

    const dsrs = load(userId, "data_subject_requests", []);
    dsrs.push(dsr);
    flush(userId, "data_subject_requests", dsrs.slice(-1000));

    return ok(AGENT, dsr);
}

function getDataSubjectRights() { return ok(AGENT, DATA_SUBJECT_RIGHTS); }

module.exports = { scanForPII, handleDataSubjectRequest, getDataSubjectRights };
