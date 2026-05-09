"use strict";
const { load, flush, uid, NOW, humanAILog, requireConsent, watermark, ok, fail, blocked } = require("./_humanAIStore.cjs");
const AGENT = "identityReplicationAgent";

// ⚠️ SIMULATION ONLY — STRICT ETHICAL LIMITS:
//    - Consent required on EVERY action
//    - No biometric data processed
//    - No impersonation of others — self-model ONLY
//    - All outputs watermarked as synthetic

const IDENTITY_COMPONENTS = ["values","beliefs","preferences","communication_style","decision_patterns","emotional_tendencies","knowledge_domain"];

function buildIdentitySnapshot({ userId, consent, snapshotLabel, components = {}, selfDescription }) {
    const gate = requireConsent(consent, "identity snapshot creation");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId) return fail(AGENT, "userId required");
    if (!selfDescription) return fail(AGENT, "selfDescription required — must be authored by the user themselves");

    const validComponents = {};
    Object.entries(components).forEach(([k, v]) => {
        if (IDENTITY_COMPONENTS.includes(k)) validComponents[k] = String(v).slice(0, 500);
    });

    const snapshot = {
        id:              uid("id"),
        snapshotLabel:   snapshotLabel || `Snapshot_${NOW().slice(0,10)}`,
        selfDescription: String(selfDescription).slice(0,2000),
        components:      validComponents,
        componentCount:  Object.keys(validComponents).length,
        snapshotDate:    NOW(),
        ...watermark(AGENT)
    };

    const snapshots = load(userId, "identity_snapshots", []);
    snapshots.push({ id: snapshot.id, snapshotLabel: snapshot.snapshotLabel, componentCount: snapshot.componentCount, snapshotDate: snapshot.snapshotDate });
    flush(userId, "identity_snapshots", snapshots.slice(-200));

    humanAILog(AGENT, userId, "identity_snapshot_created", { snapshotId: snapshot.id }, "INFO");
    return ok(AGENT, snapshot, { ethicalNote: "Self-authored snapshot only. No third-party identity replication permitted." });
}

function compareSnapshots({ userId, consent, snapshotIdA, snapshotIdB }) {
    const gate = requireConsent(consent, "identity snapshot comparison");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId || !snapshotIdA || !snapshotIdB) return fail(AGENT, "userId, snapshotIdA, and snapshotIdB required");

    const snapshots = load(userId, "identity_snapshots", []);
    const a = snapshots.find(s => s.id === snapshotIdA);
    const b = snapshots.find(s => s.id === snapshotIdB);
    if (!a) return fail(AGENT, `snapshotIdA ${snapshotIdA} not found`);
    if (!b) return fail(AGENT, `snapshotIdB ${snapshotIdB} not found`);

    const drift = Math.round(Math.random() * 40);
    const comparison = {
        id:          uid("cmp"),
        snapshotIdA,
        snapshotIdB,
        labelA:      a.snapshotLabel,
        labelB:      b.snapshotLabel,
        driftScore:  drift,
        driftBand:   drift < 10 ? "stable" : drift < 25 ? "moderate_change" : "significant_shift",
        comparedAt:  NOW(),
        ...watermark(AGENT)
    };

    humanAILog(AGENT, userId, "identity_snapshots_compared", { snapshotIdA, snapshotIdB, drift }, "INFO");
    return ok(AGENT, comparison);
}

function listSnapshots({ userId, consent }) {
    const gate = requireConsent(consent, "identity snapshot listing");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId) return fail(AGENT, "userId required");

    const snapshots = load(userId, "identity_snapshots", []);
    return ok(AGENT, { total: snapshots.length, snapshots: snapshots.slice(-50).reverse(), availableComponents: IDENTITY_COMPONENTS });
}

function deleteSnapshot({ userId, consent, snapshotId, confirm }) {
    const gate = requireConsent(consent, "identity snapshot deletion");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId || !snapshotId) return fail(AGENT, "userId and snapshotId required");
    if (!confirm) return fail(AGENT, "confirm:true required to delete an identity snapshot");

    let snapshots = load(userId, "identity_snapshots", []);
    const before = snapshots.length;
    snapshots = snapshots.filter(s => s.id !== snapshotId);
    if (snapshots.length === before) return fail(AGENT, `snapshotId ${snapshotId} not found`);
    flush(userId, "identity_snapshots", snapshots);

    humanAILog(AGENT, userId, "identity_snapshot_deleted", { snapshotId }, "WARN");
    return ok(AGENT, { deleted: snapshotId });
}

module.exports = { buildIdentitySnapshot, compareSnapshots, listSnapshots, deleteSnapshot };
