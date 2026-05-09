"use strict";
const { load, flush, ftLog, uid, NOW, simValue, simConfidence, requireApproval, ok, fail, blocked } = require("./_futureTechStore.cjs");

const AGENT = "droneControlAI";

// ⚠️ ALL CONTROL ACTIONS require approved:true — suggestions are always free
const DRONE_TYPES   = ["quadcopter","fixed_wing","hexacopter","octocopter","vtol","delivery","inspection","surveillance"];
const FLIGHT_MODES  = ["manual","stabilized","gps_hold","mission","rtl","land","auto"];
const SUGGESTION_TYPES = ["route","altitude","speed","battery_management","obstacle_avoidance","payload_drop","inspection_pattern"];

function suggestMission({ userId, droneType = "quadcopter", objectiveType, waypoints = [], constraints = {} }) {
    if (!userId) return fail(AGENT, "userId required");
    if (!DRONE_TYPES.includes(droneType)) return fail(AGENT, `droneType must be: ${DRONE_TYPES.join(", ")}`);

    const suggestion = {
        suggestionId:  uid("dsu"),
        droneType,
        objectiveType: objectiveType || "survey",
        waypoints:     waypoints.slice(0, 50).map((wp, i) => ({
            wpIndex:    i,
            lat:        wp.lat  || simValue(-90, 90, 6),
            lon:        wp.lon  || simValue(-180, 180, 6),
            alt_m:      wp.alt  || simValue(10, 120, 0),
            action:     wp.action || "waypoint",
            dwellTime_s: wp.dwell || 0
        })),
        suggestedAlt_m:     constraints.maxAlt || simValue(30, 120, 0),
        suggestedSpeed_ms:  constraints.maxSpeed || simValue(5, 20, 1),
        estimatedFlightMin: Math.round(simValue(5, 45, 0)),
        batteryRequired_pct: Math.round(simValue(20, 80, 0)),
        riskAssessment: {
            weatherRisk:    ["low","moderate","high"][Math.floor(Math.random()*3)],
            airspaceConflict: Math.random() > 0.8,
            nfzCheck:       Math.random() > 0.9 ? "CONFLICT_DETECTED" : "CLEAR",
            overallRisk:    simValue(10, 80, 1)
        },
        actionRequired: "HUMAN_APPROVAL",
        note: "⚠️ Suggestion only — call executeControl() with approved:true to proceed",
        generatedAt: NOW()
    };

    const log = load(`drone_log_${userId}`, []);
    log.push({ suggestionId: suggestion.suggestionId, droneType, objectiveType, generatedAt: suggestion.generatedAt });
    flush(`drone_log_${userId}`, log.slice(-1000));

    ftLog(AGENT, userId, "drone_mission_suggested", { droneType, objectiveType, waypoints: waypoints.length }, "INFO");
    return ok(AGENT, suggestion, "simulation");
}

function executeControl({ userId, droneId, command, parameters = {}, approved }) {
    const gate = requireApproval(approved, `drone control — command: ${command}`);
    if (gate) return gate;
    if (!userId || !droneId || !command) return fail(AGENT, "userId, droneId, and command required");
    if (!FLIGHT_MODES.concat(["takeoff","land","rtl","arm","disarm"]).includes(command)) {
        return fail(AGENT, `command must be: ${[...FLIGHT_MODES,"takeoff","land","rtl","arm","disarm"].join(", ")}`);
    }

    const execution = {
        executionId: uid("dex"),
        droneId,
        command,
        parameters,
        status:      "command_sent",
        approvedBy:  userId,
        executedAt:  NOW()
    };

    ftLog(AGENT, userId, "drone_control_EXECUTED", { droneId, command }, "WARN");
    return ok(AGENT, execution, "approved_control");
}

function getDroneStatus({ userId, droneId }) {
    if (!userId || !droneId) return fail(AGENT, "userId and droneId required");
    return ok(AGENT, {
        droneId,
        status:      ["idle","flying","charging","maintenance","offline"][Math.floor(Math.random()*5)],
        battery_pct: Math.round(simValue(10, 100, 0)),
        alt_m:       simValue(0, 120, 1),
        speed_ms:    simValue(0, 20, 1),
        gpsLock:     Math.random() > 0.1,
        flightMode:  FLIGHT_MODES[Math.floor(Math.random() * FLIGHT_MODES.length)],
        checkedAt:   NOW()
    }, "simulation");
}

module.exports = { suggestMission, executeControl, getDroneStatus };
