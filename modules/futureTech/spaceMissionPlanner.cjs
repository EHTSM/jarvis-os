"use strict";
const { load, flush, ftLog, uid, NOW, simValue, simConfidence, ok, fail } = require("./_futureTechStore.cjs");

const AGENT = "spaceMissionPlanner";

const MISSION_TYPES     = ["orbital","lunar","mars","asteroid","deep_space","space_station","cubesat","commercial_launch"];
const MISSION_PHASES    = ["concept","pre-A","phase-A","phase-B","phase-C","phase-D","operations","closeout"];
const SPACECRAFT_TYPES  = ["crewed","robotic","cargo","relay","observatory","lander","rover","flyby"];
const LAUNCH_VEHICLES   = ["falcon_9","falcon_heavy","starship","sls","atlas_v","ariane_6","vulcan","new_glenn"];

function createMission({ userId, missionName, missionType, spacecraftType = "robotic", targetBody, launchWindow, objectives = [] }) {
    if (!userId || !missionName) return fail(AGENT, "userId and missionName required");
    if (!MISSION_TYPES.includes(missionType)) return fail(AGENT, `missionType must be: ${MISSION_TYPES.join(", ")}`);
    if (!SPACECRAFT_TYPES.includes(spacecraftType)) return fail(AGENT, `spacecraftType must be: ${SPACECRAFT_TYPES.join(", ")}`);

    const mission = {
        missionId:       uid("msn"),
        missionName,
        missionType,
        spacecraftType,
        targetBody:      targetBody || "TBD",
        launchWindow:    launchWindow || new Date(Date.now() + simValue(365, 1825, 0) * 86400000).toISOString().slice(0,10),
        currentPhase:    "concept",
        objectives:      objectives.slice(0, 10),
        deltaV_kms:      parseFloat(simValue(3, 12, 2)),
        missionDuration: { transit_days: Math.round(simValue(30, 730, 0)), operations_days: Math.round(simValue(30, 1000, 0)) },
        budget_M_USD:    parseFloat(simValue(50, 5000, 0)),
        riskScore:       parseFloat(simValue(20, 85, 1)),
        confidence:      simConfidence(),
        createdAt:       NOW()
    };

    const missions = load(`missions_${userId}`, []);
    missions.push({ missionId: mission.missionId, missionName, missionType, currentPhase: "concept", createdAt: mission.createdAt });
    flush(`missions_${userId}`, missions.slice(-200));
    flush(`mission_${mission.missionId}`, mission);

    ftLog(AGENT, userId, "mission_created", { missionId: mission.missionId, missionType }, "INFO");
    return ok(AGENT, mission);
}

function advanceMissionPhase({ userId, missionId }) {
    if (!userId || !missionId) return fail(AGENT, "userId and missionId required");
    const mission = load(`mission_${missionId}`);
    if (!mission) return fail(AGENT, `missionId ${missionId} not found`);
    const phaseIdx = MISSION_PHASES.indexOf(mission.currentPhase);
    if (phaseIdx === MISSION_PHASES.length - 1) return fail(AGENT, "mission is already in final phase (closeout)");

    mission.currentPhase = MISSION_PHASES[phaseIdx + 1];
    mission.updatedAt = NOW();
    flush(`mission_${missionId}`, mission);

    ftLog(AGENT, userId, "mission_phase_advanced", { missionId, newPhase: mission.currentPhase }, "INFO");
    return ok(AGENT, { missionId, previousPhase: MISSION_PHASES[phaseIdx], newPhase: mission.currentPhase });
}

function selectLaunchVehicle({ userId, payload_kg, orbit, crewed = false }) {
    if (!userId) return fail(AGENT, "userId required");
    if (typeof payload_kg !== "number" || payload_kg <= 0) return fail(AGENT, "payload_kg must be > 0");

    const ranked = LAUNCH_VEHICLES.map(v => ({
        vehicle:      v,
        maxPayload_kg: Math.round(simValue(1000, 100000, 0)),
        costPerKg_USD: Math.round(simValue(1000, 10000, 0)),
        crewRated:    ["falcon_9","starship","sls","new_glenn"].includes(v) && crewed,
        reliability:  parseFloat(simValue(0.85, 0.99, 3)),
        score:        parseFloat(simValue(50, 99, 1))
    })).filter(v => v.maxPayload_kg >= payload_kg).sort((a,b) => b.score - a.score);

    return ok(AGENT, { payload_kg, orbit, crewed, recommendations: ranked.slice(0,3), allVehicles: LAUNCH_VEHICLES });
}

function getMissionList({ userId }) {
    if (!userId) return fail(AGENT, "userId required");
    const missions = load(`missions_${userId}`, []);
    return ok(AGENT, { total: missions.length, missions, missionTypes: MISSION_TYPES, phases: MISSION_PHASES });
}

module.exports = { createMission, advanceMissionPhase, selectLaunchVehicle, getMissionList };
