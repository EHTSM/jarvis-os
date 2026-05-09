"use strict";
const { load, flush, ftLog, uid, NOW, simValue, simConfidence, ok, fail } = require("./_futureTechStore.cjs");

const AGENT = "spaceTrackingAgent";

const OBJECT_TYPES = ["satellite","debris","asteroid","comet","space_station","rocket_body","unknown"];
const RISK_BANDS   = { NONE:[0,0.01], LOW:[0.01,0.1], MEDIUM:[0.1,0.3], HIGH:[0.3,0.7], CRITICAL:[0.7,1] };

function _riskBand(prob) {
    for (const [band, [min, max]] of Object.entries(RISK_BANDS)) {
        if (prob >= min && prob < max) return band;
    }
    return "CRITICAL";
}

function trackObject({ userId, objectId, objectType = "satellite", altitude_km, inclination_deg }) {
    if (!userId) return fail(AGENT, "userId required");
    if (!OBJECT_TYPES.includes(objectType)) return fail(AGENT, `objectType must be: ${OBJECT_TYPES.join(", ")}`);

    const alt = altitude_km || simValue(200, 36000, 0);
    const inc = inclination_deg !== undefined ? inclination_deg : simValue(0, 98, 1);
    const collisionProb = simValue(0, 0.15);

    const tracking = {
        trackId:          uid("trk"),
        objectId:         objectId || `OBJ-${uid("o")}`,
        objectType,
        orbitalElements: {
            altitude_km:     alt,
            inclination_deg: inc,
            period_min:      parseFloat((84.5 * Math.pow(alt / 200, 1.5)).toFixed(1)),
            velocity_kms:    parseFloat((7.8 - alt * 0.0001).toFixed(3)),
            eccentricity:    simValue(0, 0.1, 4)
        },
        position: {
            lat:  simValue(-90, 90, 4),
            lon:  simValue(-180, 180, 4),
            alt_km: alt
        },
        collisionProbability: parseFloat(collisionProb.toFixed(5)),
        collisionRisk:        _riskBand(collisionProb),
        conjunctionObjects:   Math.floor(Math.random() * 5),
        confidence:           simConfidence(),
        trackedAt:            NOW()
    };

    const log = load(`tracking_log_${userId}`, []);
    log.push({ trackId: tracking.trackId, objectId: tracking.objectId, objectType, risk: tracking.collisionRisk, trackedAt: tracking.trackedAt });
    flush(`tracking_log_${userId}`, log.slice(-5000));

    ftLog(AGENT, userId, "object_tracked", { objectId: tracking.objectId, objectType, risk: tracking.collisionRisk }, "INFO");
    return ok(AGENT, tracking);
}

function getConjunctionAlerts({ userId, riskThreshold = "MEDIUM" }) {
    if (!userId) return fail(AGENT, "userId required");
    const validBands = Object.keys(RISK_BANDS);
    if (!validBands.includes(riskThreshold)) return fail(AGENT, `riskThreshold must be: ${validBands.join(", ")}`);

    const alertCount = Math.floor(Math.random() * 8);
    const alerts = Array.from({ length: alertCount }, () => ({
        alertId:   uid("alr"),
        objectA:   `OBJ-${uid("a")}`,
        objectB:   `OBJ-${uid("b")}`,
        tcaTime:   new Date(Date.now() + simValue(1, 72, 0) * 3600000).toISOString(),
        missDistanceM: simValue(50, 5000, 0),
        collisionProb: simValue(0.01, 0.6, 5),
        risk:      ["MEDIUM","HIGH","CRITICAL"][Math.floor(Math.random()*3)],
        generatedAt: NOW()
    }));

    ftLog(AGENT, userId, "conjunction_alerts_retrieved", { count: alerts.length, threshold: riskThreshold }, "INFO");
    return ok(AGENT, { total: alerts.length, riskThreshold, alerts });
}

function getCatalogStats() {
    return ok(AGENT, {
        totalTrackedObjects: Math.floor(27000 + Math.random() * 1000),
        byType: Object.fromEntries(OBJECT_TYPES.map(t => [t, Math.floor(Math.random() * 5000)])),
        activeConjunctionAlerts: Math.floor(Math.random() * 50),
        dataSource: "SIMULATION — integrate with Space-Track.org API for real data",
        updatedAt: NOW()
    });
}

module.exports = { trackObject, getConjunctionAlerts, getCatalogStats };
