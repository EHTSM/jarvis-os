"use strict";
const { load, flush, uid, NOW, humanAILog, requireConsent, watermark, ok, fail, blocked } = require("./_humanAIStore.cjs");
const AGENT = "digitalTwinCreator";

// ⚠️ SIMULATION ONLY — no real person is replicated, cloned, or represented

const TWIN_LAYERS = ["behavioural","cognitive","emotional","physiological","social"];
const FIDELITY_LEVELS = { low:1, medium:2, high:3, ultra:4 };

function createTwin({ userId, consent, twinName, fidelity = "medium", enabledLayers = TWIN_LAYERS }) {
    const gate = requireConsent(consent, "digital twin creation");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId) return fail(AGENT, "userId required");
    if (!FIDELITY_LEVELS[fidelity]) return fail(AGENT, `fidelity must be: ${Object.keys(FIDELITY_LEVELS).join(", ")}`);
    const invalidLayers = enabledLayers.filter(l => !TWIN_LAYERS.includes(l));
    if (invalidLayers.length) return fail(AGENT, `invalid layers: ${invalidLayers.join(",")}. Valid: ${TWIN_LAYERS.join(", ")}`);

    const twin = {
        id:           uid("dt"),
        twinName:     twinName || `DigitalTwin_${uid("dn")}`,
        fidelity,
        fidelityScore: FIDELITY_LEVELS[fidelity],
        enabledLayers,
        layerModels:  Object.fromEntries(enabledLayers.map(l => [l, { status:"initialised", accuracy: Math.round(50 + Math.random() * 45) }])),
        syncStatus:   "idle",
        createdAt:    NOW(),
        ...watermark(AGENT)
    };

    const twins = load(userId, "digital_twins", []);
    twins.push({ id: twin.id, twinName: twin.twinName, fidelity, createdAt: twin.createdAt });
    flush(userId, "digital_twins", twins.slice(-50));

    humanAILog(AGENT, userId, "digital_twin_created", { twinId: twin.id, fidelity, layers: enabledLayers.length }, "INFO");
    return ok(AGENT, twin, { notice: "SIMULATION ONLY — this twin does not represent any real person" });
}

function syncTwin({ userId, consent, twinId, dataSnapshot = {} }) {
    const gate = requireConsent(consent, "digital twin sync");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId || !twinId) return fail(AGENT, "userId and twinId required");

    const twins = load(userId, "digital_twins", []);
    const twin = twins.find(t => t.id === twinId);
    if (!twin) return fail(AGENT, `twinId ${twinId} not found`);

    const syncResult = {
        id:         uid("ts"),
        twinId,
        fieldsProvided: Object.keys(dataSnapshot).length,
        syncAccuracy:   Math.round(60 + Math.random() * 38),
        drift:          parseFloat((Math.random() * 5).toFixed(3)),
        syncedAt:       NOW(),
        ...watermark(AGENT)
    };

    humanAILog(AGENT, userId, "digital_twin_synced", { twinId, fields: syncResult.fieldsProvided }, "INFO");
    return ok(AGENT, syncResult);
}

function queryTwin({ userId, consent, twinId, query }) {
    const gate = requireConsent(consent, "digital twin query");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId || !twinId) return fail(AGENT, "userId and twinId required");
    if (!query) return fail(AGENT, "query required");

    const result = {
        id:        uid("tq"),
        twinId,
        query,
        answer:    `[SIMULATED TWIN RESPONSE] Query: "${String(query).slice(0,150)}" — predicted outcome based on modelled twin state`,
        confidence: Math.round(55 + Math.random() * 40),
        queriedAt:  NOW(),
        ...watermark(AGENT)
    };

    humanAILog(AGENT, userId, "digital_twin_queried", { twinId }, "INFO");
    return ok(AGENT, result);
}

function listTwins({ userId, consent }) {
    const gate = requireConsent(consent, "digital twin listing");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId) return fail(AGENT, "userId required");

    const twins = load(userId, "digital_twins", []);
    return ok(AGENT, { total: twins.length, twins });
}

module.exports = { createTwin, syncTwin, queryTwin, listTwins };
