"use strict";
const { load, flush, ftLog, uid, NOW, simValue, simConfidence, requireApproval, ok, fail } = require("./_futureTechStore.cjs");

const AGENT = "roboticsControlSystem";

const ROBOT_TYPES  = ["arm","mobile","humanoid","collaborative","delta","scara","surgical","agricultural","warehouse"];
const TASK_TYPES   = ["pick_place","assembly","welding","painting","inspection","surgery_assist","packaging","sorting","navigation"];
const DOF_OPTIONS  = [3,4,6,7,9];

function simulateTask({ userId, robotType = "arm", taskType, dof = 6, payload_kg, environment = {} }) {
    if (!userId) return fail(AGENT, "userId required");
    if (!ROBOT_TYPES.includes(robotType)) return fail(AGENT, `robotType must be: ${ROBOT_TYPES.join(", ")}`);
    if (!TASK_TYPES.includes(taskType))   return fail(AGENT, `taskType must be: ${TASK_TYPES.join(", ")}`);
    if (!DOF_OPTIONS.includes(dof))       return fail(AGENT, `dof must be: ${DOF_OPTIONS.join(", ")}`);

    const steps = Math.round(simValue(5, 20, 0));
    const simulation = {
        simulationId:    uid("rsim"),
        robotType,
        taskType,
        dof,
        payload_kg:      payload_kg || simValue(0.5, 50, 1),
        jointTrajectory: Array.from({ length: steps }, (_, i) => ({
            step: i + 1,
            joints: Array.from({ length: dof }, () => parseFloat(simValue(-180, 180, 2))),
            timestamp_ms: i * Math.round(simValue(50, 500, 0))
        })),
        taskMetrics: {
            cycleTime_s:    parseFloat(simValue(2, 60, 1)),
            accuracy_mm:    parseFloat(simValue(0.01, 2, 3)),
            repeatability_mm: parseFloat(simValue(0.005, 0.5, 4)),
            successRate_pct: parseFloat(simValue(90, 99.9, 1)),
            energyUse_Wh:   parseFloat(simValue(10, 500, 1))
        },
        hazards: environment.humanProximity ? ["collaborative_safety_zone_required"] : [],
        confidence:      simConfidence(),
        simulatedAt:     NOW()
    };

    const log = load(`robot_log_${userId}`, []);
    log.push({ simulationId: simulation.simulationId, robotType, taskType, simulatedAt: simulation.simulatedAt });
    flush(`robot_log_${userId}`, log.slice(-500));

    ftLog(AGENT, userId, "robot_task_simulated", { robotType, taskType, steps }, "INFO");
    return ok(AGENT, simulation);
}

function executeRobotCommand({ userId, robotId, command, jointValues, approved }) {
    const gate = requireApproval(approved, `robot physical command — robot: ${robotId}, command: ${command}`);
    if (gate) return gate;
    if (!userId || !robotId || !command) return fail(AGENT, "userId, robotId, and command required");

    const execution = {
        executionId: uid("rex"),
        robotId,
        command,
        jointValues: jointValues || null,
        status:      "command_dispatched",
        approvedBy:  userId,
        executedAt:  NOW()
    };

    ftLog(AGENT, userId, "robot_command_EXECUTED", { robotId, command }, "WARN");
    return ok(AGENT, execution, "approved_control");
}

function getCapabilityMatrix({ robotType }) {
    if (!ROBOT_TYPES.includes(robotType)) return fail(AGENT, `robotType must be: ${ROBOT_TYPES.join(", ")}`);
    const capabilities = {
        arm:         { tasks:["pick_place","assembly","welding","painting","inspection"], maxPayload_kg:1000, reach_mm:3000 },
        mobile:      { tasks:["navigation","inspection","sorting"], maxPayload_kg:500, reach_mm:null },
        humanoid:    { tasks:["assembly","navigation","inspection"], maxPayload_kg:10,  reach_mm:800 },
        collaborative:{ tasks:["pick_place","assembly","inspection"], maxPayload_kg:35, reach_mm:1700 },
        surgical:    { tasks:["surgery_assist"], maxPayload_kg:0.5, reach_mm:300, approvalMandatory:true },
        agricultural:{ tasks:["pick_place","inspection","navigation"], maxPayload_kg:50, reach_mm:2000 }
    };
    return ok(AGENT, capabilities[robotType] || { note:"generic capabilities", tasks: TASK_TYPES });
}

module.exports = { simulateTask, executeRobotCommand, getCapabilityMatrix };
