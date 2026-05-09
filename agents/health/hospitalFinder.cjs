"use strict";
/**
 * Hospital Finder — finds nearby hospitals using mapsAgent integration.
 * Falls back to guidance when maps API key is absent.
 */
const { ok, fail, accessLog, EMERGENCY_NUMBERS } = require("./_healthStore.cjs");

const AGENT = "hospitalFinder";

const HOSPITAL_TYPES = ["general","emergency","specialty","maternity","children","psychiatric","cancer","eye","dental","government"];

// Major hospital chains (India) for fallback info
const MAJOR_CHAINS = [
    { name: "AIIMS", type: "government", note: "All India Institute of Medical Sciences — government, highly specialised", helpline: "011-26588500" },
    { name: "Apollo Hospitals",   type: "private",     note: "Pan-India private network", helpline: "1860-500-1066" },
    { name: "Fortis Healthcare",  type: "private",     note: "Multi-specialty private hospitals", helpline: "1800-210-6363" },
    { name: "Max Healthcare",     type: "private",     note: "North India focus", helpline: "011-71006699" },
    { name: "Manipal Hospitals",  type: "private",     note: "South and pan-India", helpline: "1800-102-4647" },
    { name: "Medanta",            type: "private",     note: "Gurugram + expansion", helpline: "0124-4141414" },
    { name: "NIMHANS",            type: "government",  note: "National Institute of Mental Health (Bangalore)", helpline: "080-46110007" },
    { name: "ESI Hospitals",      type: "government",  note: "For ESI (ESIC) card holders — free treatment", helpline: "1800-11-2526" }
];

async function findNearbyHospitals({ userId, location, lat, lng, type = "general", radius = 5, emergency = false }) {
    if (!userId) return fail(AGENT, "userId required");
    accessLog(userId, AGENT, "hospital_search", { location, type, emergency });

    if (emergency) {
        return ok(AGENT, {
            EMERGENCY: "⚠️ For life-threatening emergencies, call 112 NOW. Do not wait for hospital search.",
            callNow: EMERGENCY_NUMBERS,
            tip: "State your location clearly when calling 112."
        }, { riskLevel: "HIGH" });
    }

    // Try Google Maps integration
    let mapsResults = null;
    if ((lat && lng) || location) {
        try {
            const maps    = require("../../modules/infrastructure/mapsAgent.cjs");
            const query   = lat && lng ? `hospitals near ${lat},${lng}` : `${type} hospital near ${location}`;
            const r       = await maps.getLocation(query);
            if (r.success) mapsResults = r.data;
        } catch { /* no maps API — continue with fallback */ }
    }

    if (!HOSPITAL_TYPES.includes(type)) type = "general";

    return ok(AGENT, {
        searchedNear:    location || (lat && lng ? `${lat},${lng}` : "Not specified"),
        type,
        radius:          `${radius} km`,
        mapsResults,
        majorChains:     MAJOR_CHAINS.filter(h => type === "general" || h.type === type || h.name.toLowerCase().includes(type)),
        howToFind:       [
            "Google Maps: search 'hospital near me' or 'emergency room near me'",
            "Practo app: find hospitals and book OPD",
            "1mg app: locate nearby hospitals and clinics",
            "Call 104 (Health Helpline) for nearest government facility"
        ],
        govHospitalTip:  "Government hospitals (AIIMS, Civil, ESI) provide free or heavily subsidised care. Ask for the PMJAY (Ayushman Bharat) scheme desk.",
        emergencyNumbers: EMERGENCY_NUMBERS
    });
}

module.exports = { findNearbyHospitals };
