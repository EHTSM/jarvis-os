"use strict";
const { load, flush, uid, NOW, humanAILog, requireConsent, watermark, ok, fail, blocked } = require("./_humanAIStore.cjs");
const AGENT = "neuralLinkSimulation";

// ⚠️ SIMULATION ONLY — no real neural link hardware or brain data is accessed

const LINK_PROTOCOLS = {
    sensory:  { name:"Sensory Input",   bandwidth:"1-10 Mbps",  latency:"<5ms",   description:"Simulated afferent signal pathway" },
    motor:    { name:"Motor Output",    bandwidth:"0.1-1 Mbps", latency:"<2ms",   description:"Simulated efferent command pathway" },
    memory:   { name:"Memory Bridge",   bandwidth:"100+ Mbps",  latency:"<50ms",  description:"Simulated hippocampal encoding link" },
    language: { name:"Language Link",   bandwidth:"10-50 Mbps", latency:"<10ms",  description:"Simulated Broca/Wernicke area link" },
    vision:   { name:"Vision Bypass",   bandwidth:"1+ Gbps",    latency:"<1ms",   description:"Simulated visual cortex direct feed" }
};

const SYNC_STATES = ["handshake","calibrating","synced","drifting","disconnected"];

function initLink({ userId, consent, protocol = "sensory", deviceId }) {
    const gate = requireConsent(consent, "neural link simulation");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId) return fail(AGENT, "userId required");
    if (!LINK_PROTOCOLS[protocol]) return fail(AGENT, `protocol must be: ${Object.keys(LINK_PROTOCOLS).join(", ")}`);

    const link = {
        id:          uid("nl"),
        userId,
        deviceId:    deviceId || uid("dev"),
        protocol,
        protocolInfo: LINK_PROTOCOLS[protocol],
        syncState:   "synced",
        signalStrength: Math.round(70 + Math.random() * 28),
        packetLoss:  parseFloat((Math.random() * 2).toFixed(3)),
        sessionStart: NOW(),
        ...watermark(AGENT)
    };

    const sessions = load(userId, "nl_sessions", []);
    sessions.push({ id: link.id, protocol, syncState: link.syncState, started: link.sessionStart });
    flush(userId, "nl_sessions", sessions.slice(-500));

    humanAILog(AGENT, userId, "neural_link_initiated", { protocol, deviceId: link.deviceId }, "INFO");
    return ok(AGENT, link, { warning: "⚠️ Neural link simulation only — no real hardware connected" });
}

function transmitSignal({ userId, consent, linkId, signalPayload, direction = "afferent" }) {
    const gate = requireConsent(consent, "neural signal transmission");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId || !linkId) return fail(AGENT, "userId and linkId required");
    if (!["afferent","efferent","bidirectional"].includes(direction)) return fail(AGENT, "direction: afferent|efferent|bidirectional");

    const transmission = {
        id:              uid("tx"),
        linkId,
        direction,
        payload:         signalPayload ? `[SIMULATED] ${String(signalPayload).slice(0,200)}` : "[SIMULATED] baseline pulse",
        packetsSent:     Math.round(100 + Math.random() * 900),
        packetsReceived: 0,
        latencyMs:       parseFloat((Math.random() * 15 + 1).toFixed(2)),
        checksumOK:      true,
        transmittedAt:   NOW(),
        ...watermark(AGENT)
    };
    transmission.packetsReceived = Math.round(transmission.packetsSent * (0.97 + Math.random() * 0.03));

    humanAILog(AGENT, userId, "neural_signal_transmitted", { linkId, direction, packetsSent: transmission.packetsSent }, "INFO");
    return ok(AGENT, transmission);
}

function getLinkStatus({ userId, consent }) {
    const gate = requireConsent(consent, "neural link status");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId) return fail(AGENT, "userId required");

    const sessions = load(userId, "nl_sessions", []);
    return ok(AGENT, { totalSessions: sessions.length, recentSessions: sessions.slice(-10).reverse(), supportedProtocols: Object.keys(LINK_PROTOCOLS) });
}

function getSupportedProtocols() {
    return ok(AGENT, { protocols: Object.entries(LINK_PROTOCOLS).map(([k,v]) => ({ key:k,...v })) });
}

module.exports = { initLink, transmitSignal, getLinkStatus, getSupportedProtocols };
