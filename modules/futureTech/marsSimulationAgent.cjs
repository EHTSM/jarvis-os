"use strict";
const { load, flush, ftLog, uid, NOW, simValue, simConfidence, ok, fail } = require("./_futureTechStore.cjs");

const AGENT = "marsSimulationAgent";

const LANDING_SITES  = ["jezero_crater","gale_crater","hellas_planitia","olympus_mons_base","isidis_planitia","arabia_terra","utopia_planitia"];
const HAZARD_TYPES   = ["dust_storm","radiation_spike","temperature_drop","terrain_obstacle","equipment_failure","comms_blackout"];
const RESOURCE_TYPES = ["water_ice","perchlorates","co2","iron_oxide","silicates","methane"];

function getEnvironmentReading({ userId, landingSite = "jezero_crater", sol }) {
    if (!userId) return fail(AGENT, "userId required");
    if (!LANDING_SITES.includes(landingSite)) return fail(AGENT, `landingSite must be: ${LANDING_SITES.join(", ")}`);

    const currentSol = sol || Math.floor(Date.now() / 88775244); // Mars sol since epoch

    const reading = {
        readingId:      uid("mrs"),
        sol:            currentSol,
        landingSite,
        atmosphere: {
            pressure_Pa:  simValue(600, 900, 1),
            temperature_C:{ surface: simValue(-90, 20, 1), air: simValue(-100, 0, 1) },
            co2_pct:      95.3 + simValue(-0.5, 0.5, 2),
            wind_mps:     simValue(0, 25, 1),
            windDir_deg:  simValue(0, 360, 0),
            dustOpacity:  simValue(0.3, 2.5, 2)
        },
        radiation: {
            surface_mGy_day: simValue(0.2, 0.8, 3),
            GCR_intensity:   simValue(100, 300, 0),
            solarEvent:      Math.random() > 0.9
        },
        hazards: HAZARD_TYPES.filter(() => Math.random() > 0.75).map(h => ({ type:h, severity:["low","moderate","high"][Math.floor(Math.random()*3)] })),
        recordedAt: NOW()
    };

    const log = load(`mars_log_${userId}`, []);
    log.push({ readingId: reading.readingId, sol: reading.sol, site: landingSite, hazards: reading.hazards.length });
    flush(`mars_log_${userId}`, log.slice(-10000));

    ftLog(AGENT, userId, "mars_reading_taken", { site: landingSite, sol: currentSol, hazards: reading.hazards.length }, "INFO");
    return ok(AGENT, reading);
}

function simulateResourceSurvey({ userId, landingSite = "jezero_crater", resources = RESOURCE_TYPES.slice(0, 3) }) {
    if (!userId) return fail(AGENT, "userId required");
    const invalidRes = resources.filter(r => !RESOURCE_TYPES.includes(r));
    if (invalidRes.length) return fail(AGENT, `invalid resources: ${invalidRes.join(",")}. Valid: ${RESOURCE_TYPES.join(", ")}`);

    const survey = {
        surveyId:    uid("srv"),
        landingSite,
        resources:   Object.fromEntries(resources.map(r => [r, {
            detected:     Math.random() > 0.3,
            concentration: simValue(0, 15, 2),
            unit:         r === "water_ice" ? "vol%" : r === "methane" ? "ppb" : "wt%",
            depth_m:      simValue(0.1, 10, 1),
            extractable:  Math.random() > 0.5
        }])),
        confidence:  simConfidence(),
        surveyedAt:  NOW()
    };

    ftLog(AGENT, userId, "resource_survey_simulated", { site: landingSite, resourceCount: resources.length }, "INFO");
    return ok(AGENT, survey);
}

function planBaseLocation({ userId, preferredSite, requirements = {} }) {
    if (!userId) return fail(AGENT, "userId required");
    const site = LANDING_SITES.includes(preferredSite) ? preferredSite : LANDING_SITES[0];

    const plan = {
        planId:      uid("bp"),
        recommendedSite: site,
        siteScore:   simValue(50, 95, 1),
        factors: {
            waterIceProximity: simValue(0, 10, 1),
            solarExposure:     simValue(40, 90, 1),
            terrainFlatness:   simValue(50, 99, 1),
            radiationShelter:  simValue(20, 80, 1),
            dustStormRisk:     simValue(10, 80, 1)
        },
        structureRecommendations: ["subsurface_habitat","inflatable_dome","regolith_shielding","solar_array_field"],
        estimatedBuildSols:       Math.round(simValue(30, 200, 0)),
        plannedAt:   NOW()
    };

    ftLog(AGENT, userId, "base_location_planned", { site, score: plan.siteScore }, "INFO");
    return ok(AGENT, plan);
}

module.exports = { getEnvironmentReading, simulateResourceSurvey, planBaseLocation };
