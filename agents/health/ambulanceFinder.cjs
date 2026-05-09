"use strict";
/**
 * Ambulance Finder — surfaces ambulance numbers and nearby service info.
 * Uses mapsAgent for location lookup if available. Mock-ready for API integration.
 */
const { ok, fail, accessLog, EMERGENCY_NUMBERS } = require("./_healthStore.cjs");

const AGENT = "ambulanceFinder";

// National and state ambulance services (India)
const AMBULANCE_SERVICES = {
    national: [
        { name: "National Emergency (all services)", number: "112", available: "24/7" },
        { name: "Ambulance (National)", number: "108", available: "24/7", note: "Free emergency ambulance in most states" },
        { name: "CATS Ambulance (Delhi)", number: "1099", available: "24/7" },
        { name: "Arogya Setu Ambulance", number: "14567", available: "24/7" }
    ],
    private: [
        { name: "Ziqitza Healthcare", number: "+91-99-9917-9999", note: "Paid ambulance service nationally" },
        { name: "StanPlus Ambulance",  number: "088001-88001", note: "Advanced life support ambulances" },
        { name: "Portea Medical",      number: "1800-121-2323", note: "Home care + ambulance" }
    ],
    apps: [
        { name: "Practo (Ambulance section)", platform: "Android/iOS" },
        { name: "108 Ambulance App (NHM)",    platform: "Android/iOS" },
        { name: "Ola/Uber Emergency feature", platform: "Android/iOS" }
    ]
};

async function findNearbyAmbulance({ userId, location, lat, lng, urgent = false }) {
    if (!userId) return fail(AGENT, "userId required");
    accessLog(userId, AGENT, "ambulance_finder_used", { location, urgent });

    // Try to get location context from mapsAgent if lat/lng available
    let locationInfo = null;
    if (lat && lng) {
        try {
            const maps = require("../../modules/infrastructure/mapsAgent.cjs");
            const r    = await maps.getLocation(`${lat},${lng}`);
            if (r.success) locationInfo = r.data?.location?.address;
        } catch { /* maps not available — continue */ }
    }

    return ok(AGENT, {
        urgent:          urgent ? "⚠️ FOR LIFE-THREATENING EMERGENCIES — CALL 112 NOW" : null,
        callFirst:       "In any emergency — CALL 112 FIRST. Do not wait to search for ambulances.",
        nearbyLocation:  locationInfo || location || "Location not determined",
        services:        AMBULANCE_SERVICES,
        quickDial:       { emergency: "112", ambulance: "108", delhi_cats: "1099" },
        tip:             "When calling: state your name, location (landmark + address), and nature of emergency clearly.",
        giveLocation:    "Give the clearest possible landmark — e.g. 'near DLF Mall, Sector 18, Noida' not just 'Noida'"
    }, { riskLevel: urgent ? "HIGH" : "MEDIUM" });
}

module.exports = { findNearbyAmbulance };
