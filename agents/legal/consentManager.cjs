"use strict";
const { load, flush, uid, NOW, auditLog, ok, fail } = require("./_legalStore.cjs");
const AGENT = "consentManager";

const CONSENT_TYPES = {
    data_processing:  { lawfulBasis:"Consent (GDPR Art.6(1)(a))", revocable:true,  requiresAge:true },
    marketing_email:  { lawfulBasis:"Consent (CAN-SPAM/DPDP)",    revocable:true,  requiresAge:false },
    cookies:          { lawfulBasis:"Consent (ePrivacy Directive)",revocable:true,  requiresAge:false },
    clinical_trial:   { lawfulBasis:"Informed Consent",            revocable:true,  requiresAge:true, witnessRequired:true },
    legal_document:   { lawfulBasis:"Contractual (free consent)",  revocable:false, requiresAge:true },
    biometric:        { lawfulBasis:"Explicit Consent",            revocable:true,  requiresAge:true, sensitiveData:true },
    children_data:    { lawfulBasis:"Verified Parental Consent",   revocable:true,  requiresAge:false, parentalRequired:true }
};

function recordConsent({ userId, subjectId, subjectName, consentType, purpose, dataCategories = [], ipAddress, channel = "web", expiryDays }) {
    if (!userId || !subjectId || !consentType) return fail(AGENT, "userId, subjectId, consentType required");
    if (!purpose) return fail(AGENT, "purpose required — consent must be specific and informed");

    const key    = consentType.toLowerCase().replace(/\s+/g,"_");
    const typeInfo = CONSENT_TYPES[key];
    if (!typeInfo) return fail(AGENT, `Unknown consent type. Available: ${Object.keys(CONSENT_TYPES).join(", ")}`);

    auditLog(AGENT, userId, "consent_recorded", { consentType: key, subjectId, purpose });

    const record = {
        id:            uid("con"),
        userId,
        subjectId,
        subjectName,
        consentType:   key,
        purpose,
        dataCategories,
        lawfulBasis:   typeInfo.lawfulBasis,
        channel,
        ipAddress:     ipAddress || "not_captured",
        timestamp:     NOW(),
        expiresAt:     expiryDays ? new Date(Date.now() + expiryDays * 86400000).toISOString() : null,
        active:        true,
        revocable:     typeInfo.revocable,
        requiresParental: typeInfo.parentalRequired || false
    };

    const consents = load(userId, "consent_records", []);
    consents.push(record);
    flush(userId, "consent_records", consents.slice(-10000));

    return ok(AGENT, { record, complianceNote: "Consent records must be retained for the duration of the relationship + required retention period." });
}

function revokeConsent({ userId, consentId, subjectId, reason }) {
    if (!userId || !consentId) return fail(AGENT, "userId and consentId required");
    auditLog(AGENT, userId, "consent_revoked", { consentId, subjectId, reason });

    const consents = load(userId, "consent_records", []);
    const record   = consents.find(c => c.id === consentId);
    if (!record)   return fail(AGENT, "Consent record not found");
    if (!record.revocable) return fail(AGENT, "This consent type cannot be revoked (contractual basis)");

    record.active    = false;
    record.revokedAt = NOW();
    record.revokeReason = reason || "Subject requested revocation";
    flush(userId, "consent_records", consents);

    return ok(AGENT, { revoked: true, consentId, notice: "Stop all processing immediately. Inform data processors within 72 hours." });
}

function getConsentRecord({ userId, subjectId }) {
    if (!userId) return fail(AGENT, "userId required");
    const consents = load(userId, "consent_records", []);
    const active   = consents.filter(c => c.active && (!subjectId || c.subjectId === subjectId));
    const revoked  = consents.filter(c => !c.active && (!subjectId || c.subjectId === subjectId));
    return ok(AGENT, { active, revoked, total: consents.length });
}

function checkConsent({ userId, subjectId, consentType, purpose }) {
    if (!userId || !subjectId || !consentType) return fail(AGENT, "userId, subjectId, consentType required");
    const consents = load(userId, "consent_records", []);
    const valid    = consents.filter(c =>
        c.active &&
        c.subjectId === subjectId &&
        c.consentType === consentType.toLowerCase().replace(/\s+/g,"_") &&
        (!c.expiresAt || new Date(c.expiresAt) > new Date()) &&
        (!purpose || c.purpose.toLowerCase().includes(purpose.toLowerCase()))
    );
    return ok(AGENT, { hasValidConsent: valid.length > 0, records: valid });
}

module.exports = { recordConsent, revokeConsent, getConsentRecord, checkConsent };
