"use strict";
const { load, flush, ftLog, uid, NOW, simValue, simConfidence, requireApproval, ok, fail } = require("./_futureTechStore.cjs");

const AGENT = "autonomousVehicleAI";

const SAE_LEVELS    = [0,1,2,3,4,5];
const VEHICLE_TYPES = ["sedan","suv","truck","bus","pod","shuttle","delivery_bot","motorcycle"];
const SENSOR_SUITES = ["basic","standard","premium","full_redundancy"];
const SCENARIO_TYPES= ["urban","highway","rural","parking","intersection","emergency_stop","lane_change","pedestrian_crossing"];

function planRoute({ userId, origin, destination, vehicleType = "sedan", saeLevel = 4, preferences = {} }) {
    if (!userId) return fail(AGENT, "userId required");
    if (!origin || !destination) return fail(AGENT, "origin and destination required");
    if (!SAE_LEVELS.includes(saeLevel)) return fail(AGENT, `saeLevel must be: ${SAE_LEVELS.join(", ")}`);
    if (!VEHICLE_TYPES.includes(vehicleType)) return fail(AGENT, `vehicleType must be: ${VEHICLE_TYPES.join(", ")}`);

    const distance_km = simValue(1, 500, 1);
    const route = {
        routeId:        uid("rt"),
        origin,
        destination,
        vehicleType,
        saeLevel,
        distance_km,
        duration_min:   Math.round(distance_km / simValue(30, 80, 0) * 60),
        segments:       Math.round(distance_km / 10),
        waypoints:      Math.round(distance_km / 5),
        safetyScore:    simValue(70, 99, 1),
        trafficImpact:  ["low","moderate","high"][Math.floor(Math.random()*3)],
        weatherImpact:  ["none","light","moderate","severe"][Math.floor(Math.random()*4)],
        energyEst_kWh:  parseFloat((distance_km * 0.2 * simValue(0.8, 1.2)).toFixed(2)),
        autonomyReady:  saeLevel >= 4,
        requiresHuman:  saeLevel < 3,
        plannedAt:      NOW()
    };

    const log = load(`av_routes_${userId}`, []);
    log.push({ routeId: route.routeId, origin, destination, saeLevel, plannedAt: route.plannedAt });
    flush(`av_routes_${userId}`, log.slice(-500));

    ftLog(AGENT, userId, "route_planned", { routeId: route.routeId, distance_km, saeLevel }, "INFO");
    return ok(AGENT, route);
}

function simulateScenario({ userId, scenario, vehicleType = "sedan", saeLevel = 4, conditions = {} }) {
    if (!userId) return fail(AGENT, "userId required");
    if (!SCENARIO_TYPES.includes(scenario)) return fail(AGENT, `scenario must be: ${SCENARIO_TYPES.join(", ")}`);

    const decisions = {
        urban:                ["slow_for_cyclist","yield_at_crosswalk","lane_merge_check","traffic_signal_obey"],
        highway:              ["lane_keep","adaptive_cruise","merge_safe_gap","emergency_brake"],
        rural:                ["pothole_avoidance","animal_crossing_slow","low_visibility_reduce_speed"],
        parking:              ["spot_detection","reverse_manoeuvre","pedestrian_clear"],
        intersection:         ["right_of_way_yield","blind_spot_check","all_way_stop"],
        emergency_stop:       ["max_deceleration","hazard_lights","safe_pullover"],
        lane_change:          ["mirror_check","blind_spot_radar","gap_acceptance","signal_activation"],
        pedestrian_crossing:  ["pedestrian_detection","full_stop","wait_clear","proceed_slow"]
    };

    const simulation = {
        simulationId:     uid("avs"),
        scenario,
        vehicleType,
        saeLevel,
        weatherCondition: conditions.weather || "clear",
        decisionSequence: decisions[scenario] || [],
        reactionTime_ms:  saeLevel >= 4 ? Math.round(simValue(50,200,0)) : Math.round(simValue(200,800,0)),
        outcomeSuccess:   Math.random() > (saeLevel >= 3 ? 0.02 : 0.15),
        safetyMargin_m:   parseFloat(simValue(0.5, 5, 2)),
        confidence:       simConfidence(),
        simulatedAt:      NOW()
    };

    ftLog(AGENT, userId, "av_scenario_simulated", { scenario, saeLevel, success: simulation.outcomeSuccess }, "INFO");
    return ok(AGENT, simulation);
}

function activateAutonomousMode({ userId, vehicleId, saeLevel, routeId, approved }) {
    const gate = requireApproval(approved, `activate autonomous mode on vehicle ${vehicleId} at SAE L${saeLevel}`);
    if (gate) return gate;
    if (!userId || !vehicleId) return fail(AGENT, "userId and vehicleId required");
    if (saeLevel < 4) return fail(AGENT, "autonomous activation only available for SAE Level 4 or 5 vehicles");

    const activation = {
        activationId: uid("avm"),
        vehicleId,
        saeLevel,
        routeId:      routeId || null,
        status:       "autonomous_mode_active",
        approvedBy:   userId,
        activatedAt:  NOW()
    };

    ftLog(AGENT, userId, "AV_AUTONOMOUS_ACTIVATED", { vehicleId, saeLevel }, "WARN");
    return ok(AGENT, activation, "approved_control");
}

module.exports = { planRoute, simulateScenario, activateAutonomousMode };
