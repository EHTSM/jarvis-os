"use strict";
const { load, flush, uid, NOW, humanAILog, requireConsent, watermark, ok, fail, blocked } = require("./_humanAIStore.cjs");
const AGENT = "digitalImmortalitySystem";

// ⚠️ SIMULATION ONLY — CRITICAL ETHICAL LIMITS:
//    - Strictly user-authored content only
//    - NO autonomous posthumous AI agents are created
//    - NO simulation of consciousness after death
//    - All output labelled SIMULATION; never presented as the real person

const PRESERVATION_TYPES = ["values_record","memory_archive","wisdom_collection","creative_portfolio","message_to_future","ethical_will"];
const ACTIVATION_CONDITIONS = ["specific_date","user_designated_trustee_request","never_auto"];

const IMMORTALITY_ETHICAL_NOTICE =
    "⚠️ DIGITAL LEGACY NOTICE — This system preserves USER-AUTHORED content only. " +
    "It does NOT create, simulate, or activate an autonomous AI representation of any person after death. " +
    "No AI will impersonate this user. All content remains static user-authored records.";

function createPreservationRecord({ userId, consent, preservationType, title, content, activationCondition = "never_auto", trusteeName }) {
    const gate = requireConsent(consent, "digital preservation record");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId) return fail(AGENT, "userId required");
    if (!PRESERVATION_TYPES.includes(preservationType)) return fail(AGENT, `preservationType must be: ${PRESERVATION_TYPES.join(", ")}`);
    if (!ACTIVATION_CONDITIONS.includes(activationCondition)) return fail(AGENT, `activationCondition must be: ${ACTIVATION_CONDITIONS.join(", ")}`);
    if (!content || !title) return fail(AGENT, "content and title required");

    const record = {
        id:                 uid("di"),
        preservationType,
        title,
        content:            String(content).slice(0, 20000),
        activationCondition,
        trusteeName:        trusteeName || null,
        status:             "preserved",
        createdAt:          NOW(),
        ...watermark(AGENT)
    };

    const vault = load(userId, "immortality_vault", []);
    vault.push({ id: record.id, preservationType, title, activationCondition, status: record.status, createdAt: record.createdAt });
    flush(userId, "immortality_vault", vault.slice(-500));

    humanAILog(AGENT, userId, "preservation_record_created", { recordId: record.id, preservationType }, "INFO");
    return ok(AGENT, record, { ethicalNotice: IMMORTALITY_ETHICAL_NOTICE });
}

function getVault({ userId, consent, preservationType }) {
    const gate = requireConsent(consent, "digital immortality vault access");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId) return fail(AGENT, "userId required");

    let vault = load(userId, "immortality_vault", []);
    if (preservationType) vault = vault.filter(r => r.preservationType === preservationType);

    humanAILog(AGENT, userId, "immortality_vault_accessed", { count: vault.length }, "INFO");
    return ok(AGENT, { total: vault.length, records: vault, ethicalNotice: IMMORTALITY_ETHICAL_NOTICE });
}

function getVaultSummary({ userId, consent }) {
    const gate = requireConsent(consent, "vault summary");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId) return fail(AGENT, "userId required");

    const vault = load(userId, "immortality_vault", []);
    const byType = {};
    PRESERVATION_TYPES.forEach(t => { byType[t] = vault.filter(r => r.preservationType === t).length; });

    return ok(AGENT, { totalRecords: vault.length, byType, preservationTypes: PRESERVATION_TYPES, ethicalNotice: IMMORTALITY_ETHICAL_NOTICE });
}

function revokeRecord({ userId, consent, recordId, confirm }) {
    const gate = requireConsent(consent, "preservation record revocation");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId || !recordId) return fail(AGENT, "userId and recordId required");
    if (!confirm) return fail(AGENT, "confirm:true required — this permanently removes the preservation record");

    let vault = load(userId, "immortality_vault", []);
    const before = vault.length;
    vault = vault.filter(r => r.id !== recordId);
    if (vault.length === before) return fail(AGENT, `recordId ${recordId} not found`);
    flush(userId, "immortality_vault", vault);

    humanAILog(AGENT, userId, "preservation_record_revoked", { recordId }, "WARN");
    return ok(AGENT, { revoked: recordId, right_to_erasure: "honoured" });
}

module.exports = { createPreservationRecord, getVault, getVaultSummary, revokeRecord };
