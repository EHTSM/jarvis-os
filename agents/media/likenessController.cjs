"use strict";
const { load, flush, uid, NOW, ok, fail, blocked, trackEvent, requireSafeContext } = require("./_mediaStore.cjs");
const AGENT = "likenessController";

// SAFETY AGENT: All likeness use requires explicit consent:true + watermark metadata.
// This agent is the enforcement gate — no content involving a real person's likeness
// passes without a verifiable consent record.

const CONSENT_DURATION_DAYS = 365;

function registerConsent({ userId, subjectName, subjectId, contentTypes = [], platforms = [], expiryDays, grantedBy, consentDocument }) {
    if (!userId || !subjectName) return fail(AGENT, "userId and subjectName required");
    if (!contentTypes.length)    return fail(AGENT, "contentTypes array required (e.g. ['image','voice','video'])");
    if (!grantedBy)              return fail(AGENT, "grantedBy (legal name of consenting party) required");

    trackEvent("likeness_consent_register", { userId, subjectName });

    const consentRecord = {
        id:           uid("lc"),
        userId,
        subjectName,
        subjectId:    subjectId || uid("sub"),
        contentTypes,
        platforms,
        grantedBy,
        consentDocument: consentDocument || null,
        expiryDays:   expiryDays || CONSENT_DURATION_DAYS,
        expiresAt:    new Date(Date.now() + (expiryDays || CONSENT_DURATION_DAYS) * 86400000).toISOString(),
        active:       true,
        registeredAt: NOW()
    };

    const consents = load(userId, "likeness_consents", []);
    consents.push(consentRecord);
    flush(userId, "likeness_consents", consents);

    return ok(AGENT, { consentId: consentRecord.id, consentRecord, notice: "Consent registered. Always store original consent documentation securely." });
}

function checkConsent({ userId, subjectName, subjectId, contentType, platform }) {
    if (!userId || (!subjectName && !subjectId)) return fail(AGENT, "userId + (subjectName or subjectId) required");
    if (!contentType) return fail(AGENT, "contentType required");

    const consents = load(userId, "likeness_consents", []);
    const matching = consents.filter(c =>
        c.active &&
        (c.subjectName === subjectName || c.subjectId === subjectId) &&
        c.contentTypes.includes(contentType) &&
        new Date(c.expiresAt) > new Date()
    );

    if (!matching.length) {
        return blocked(AGENT, `No valid consent found for "${subjectName || subjectId}" for content type "${contentType}". Obtain and register consent before proceeding.`);
    }
    if (platform && !matching.some(c => !c.platforms.length || c.platforms.includes(platform))) {
        return blocked(AGENT, `Consent for "${subjectName}" does not cover platform "${platform}". Update consent scope.`);
    }

    return ok(AGENT, { approved: true, consentRecord: matching[0], notice: "Consent verified. Watermark metadata is mandatory on all generated content." });
}

function revokeConsent({ userId, consentId, subjectName, reason }) {
    if (!userId || !consentId) return fail(AGENT, "userId and consentId required");
    const consents = load(userId, "likeness_consents", []);
    const record   = consents.find(c => c.id === consentId);
    if (!record)   return fail(AGENT, "Consent record not found");

    record.active     = false;
    record.revokedAt  = NOW();
    record.revokeReason = reason || "Revoked by request";
    flush(userId, "likeness_consents", consents);

    return ok(AGENT, { consentId, revoked: true, notice: "Consent revoked. All content using this likeness must be taken down immediately." });
}

function enforceWatermark({ userId, contentId, subjectName, contentType, watermarkData }) {
    if (!userId || !contentId || !subjectName) return fail(AGENT, "userId, contentId, subjectName required");
    if (!watermarkData) return blocked(AGENT, "Watermark metadata is mandatory. Provide watermarkData: { creator, tool, timestamp, consentId }");

    trackEvent("likeness_watermark", { userId, contentId, subjectName });

    const manifest = {
        id:          uid("wm"),
        contentId,
        subjectName,
        contentType,
        watermark:   { ...watermarkData, enforcedAt: NOW() },
        generatedBy: "Jarvis OS likenessController",
        c2paCompatible: true,
        createdAt:   NOW()
    };

    const manifests = load(userId, "watermark_manifests", []);
    manifests.push(manifest);
    flush(userId, "watermark_manifests", manifests.slice(-1000));

    return ok(AGENT, { manifest, notice: "Watermark manifest recorded. Embed this into content metadata (EXIF/ID3/MP4 atoms)." });
}

function getConsentRegistry({ userId }) {
    if (!userId) return fail(AGENT, "userId required");
    const consents = load(userId, "likeness_consents", []);
    const active   = consents.filter(c => c.active && new Date(c.expiresAt) > new Date());
    const expired  = consents.filter(c => !c.active || new Date(c.expiresAt) <= new Date());
    return ok(AGENT, { active, expired, total: consents.length });
}

module.exports = { registerConsent, checkConsent, revokeConsent, enforceWatermark, getConsentRegistry };
