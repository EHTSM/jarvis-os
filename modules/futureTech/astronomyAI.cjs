"use strict";
const { ftLog, uid, NOW, simValue, ok, fail } = require("./_futureTechStore.cjs");

const AGENT = "astronomyAI";

const CELESTIAL_OBJECTS = {
    sun:     { type:"star",   distance_ly:0.0000158, mass_solar:1,       diameter_km:1392700 },
    moon:    { type:"moon",   distance_ly:0.0000000040, mass_solar:0.000012, diameter_km:3474 },
    mercury: { type:"planet", distance_ly:0.000006, mass_solar:0.000002, diameter_km:4879,  moons:0 },
    venus:   { type:"planet", distance_ly:0.000015, mass_solar:0.0000024,diameter_km:12104, moons:0 },
    mars:    { type:"planet", distance_ly:0.000024, mass_solar:0.000003, diameter_km:6779,  moons:2 },
    jupiter: { type:"planet", distance_ly:0.000078, mass_solar:0.000955, diameter_km:139820,moons:95 },
    saturn:  { type:"planet", distance_ly:0.000143, mass_solar:0.000286, diameter_km:116460,moons:146,rings:true },
    uranus:  { type:"planet", distance_ly:0.000286, mass_solar:0.0000436,diameter_km:50724, moons:27 },
    neptune: { type:"planet", distance_ly:0.000476, mass_solar:0.0000515,diameter_km:49244, moons:16 }
};

const STAR_TYPES      = ["O","B","A","F","G","K","M"];
const GALAXY_TYPES    = ["spiral","elliptical","irregular","lenticular","dwarf"];
const QUERY_TOPICS    = ["planets","stars","galaxies","black_holes","nebulae","exoplanets","dark_matter","cosmology","space_missions","telescopes"];

function queryObject({ userId, objectName }) {
    if (!userId) return fail(AGENT, "userId required");
    if (!objectName) return fail(AGENT, "objectName required");

    const key = objectName.toLowerCase().trim();
    const data = CELESTIAL_OBJECTS[key];

    if (data) {
        ftLog(AGENT, userId, "object_queried", { objectName: key }, "INFO");
        return ok(AGENT, { objectName: key, ...data, queriedAt: NOW() });
    }

    // unknown — generate plausible simulated data
    const simObj = {
        objectName: key,
        type:       "unknown_object",
        note:       `Simulated data for "${objectName}" — connect to NASA/ESA APIs for real ephemeris`,
        distance_ly: simValue(0.001, 100000),
        magnitude:   simValue(-2, 15, 1),
        spectralClass: STAR_TYPES[Math.floor(Math.random() * STAR_TYPES.length)],
        queriedAt:   NOW()
    };
    ftLog(AGENT, userId, "object_queried_sim", { objectName: key }, "INFO");
    return ok(AGENT, simObj);
}

function searchByTopic({ userId, topic, depth = "overview" }) {
    if (!userId) return fail(AGENT, "userId required");
    if (!QUERY_TOPICS.includes(topic)) return fail(AGENT, `topic must be: ${QUERY_TOPICS.join(", ")}`);

    const SUMMARIES = {
        planets:     "8 planets orbit the Sun in our Solar System, from rocky terrestrials to gas giants.",
        stars:       "Stars are plasma spheres powered by nuclear fusion, classified by the OBAFGKM spectral sequence.",
        galaxies:    "Galaxies are gravitationally bound systems of stars; the Milky Way is a barred spiral galaxy.",
        black_holes: "Black holes are regions where gravity prevents escape of matter and light; formed from stellar collapse.",
        nebulae:     "Nebulae are interstellar clouds of gas and dust, often stellar nurseries or remnants.",
        exoplanets:  "Over 5,000 confirmed exoplanets exist; detected via transit, radial velocity, and direct imaging.",
        dark_matter: "~27% of the universe is dark matter — undetected directly but inferred from gravitational effects.",
        cosmology:   "The observable universe is ~93 billion light-years in diameter, ~13.8 billion years old.",
        space_missions:"Active missions include Artemis (Moon), Mars Sample Return, Webb, Voyager 1&2 (interstellar).",
        telescopes:  "Key observatories: JWST (infrared), Hubble (optical/UV), Chandra (X-ray), Fermi (gamma)."
    };

    ftLog(AGENT, userId, "topic_searched", { topic, depth }, "INFO");
    return ok(AGENT, {
        topic,
        depth,
        summary:  SUMMARIES[topic],
        relatedObjects: Object.keys(CELESTIAL_OBJECTS).slice(0, 4),
        knowledgeCutoff: "August 2025 — use NASA/ESA live feeds for current data",
        queriedAt: NOW()
    });
}

function calculateDistance({ userId, objectA, objectB }) {
    if (!userId) return fail(AGENT, "userId required");
    if (!objectA || !objectB) return fail(AGENT, "objectA and objectB required");
    const a = CELESTIAL_OBJECTS[objectA.toLowerCase()];
    const b = CELESTIAL_OBJECTS[objectB.toLowerCase()];
    if (!a || !b) return fail(AGENT, `one or both objects not in catalogue. Known: ${Object.keys(CELESTIAL_OBJECTS).join(", ")}`);

    const dist_ly   = Math.abs(a.distance_ly - b.distance_ly);
    const dist_au   = parseFloat((dist_ly * 63241.1).toFixed(2));
    const dist_km   = parseFloat((dist_au * 1.496e8).toFixed(0));
    const travelYrs = parseFloat((dist_ly / 0.00001).toFixed(0)); // current spacecraft speed

    return ok(AGENT, { objectA, objectB, distance_ly: dist_ly, distance_au: dist_au, distance_km: dist_km, travelTimeYearsAtCurrentSpeed: travelYrs });
}

function getVisibilityForecast({ userId, latitude, longitude }) {
    if (!userId) return fail(AGENT, "userId required");
    const forecast = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(Date.now() + i * 86400000);
        return {
            date:           d.toISOString().slice(0, 10),
            moonPhase:      ["new","waxing_crescent","first_quarter","waxing_gibbous","full","waning_gibbous","last_quarter","waning_crescent"][Math.floor(Math.random()*8)],
            seeingCondition:["poor","average","good","excellent"][Math.floor(Math.random()*4)],
            visiblePlanets: ["Mars","Jupiter","Saturn"].filter(() => Math.random() > 0.5),
            bestViewingHour: `${Math.floor(simValue(21,4,0))}:00 local`
        };
    });
    return ok(AGENT, { latitude, longitude, forecastDays: 7, forecast, note:"Simulated forecast — use Clear Outside or Astrospheric APIs for real data" });
}

module.exports = { queryObject, searchByTopic, calculateDistance, getVisibilityForecast };
