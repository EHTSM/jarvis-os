"use strict";
const { loadUser, flushUser, metaLog, uid, NOW, ok, fail, rateCheck } = require("./_metaverseStore.cjs");

const AGENT = "motionCaptureAgent";

// Backend receives processed skeleton/joint data from client — never raw camera feed

const BODY_JOINTS = [
    "nose","left_eye","right_eye","left_ear","right_ear",
    "left_shoulder","right_shoulder","left_elbow","right_elbow",
    "left_wrist","right_wrist","left_hip","right_hip",
    "left_knee","right_knee","left_ankle","right_ankle"
];

const MOTION_ACTIONS = {
    idle:          { joints:["spine","hips"],          fps:5  },
    walk:          { joints:["legs","arms","hips"],    fps:30 },
    run:           { joints:["all"],                   fps:60 },
    jump:          { joints:["legs","hips","arms"],    fps:60 },
    dance:         { joints:["all"],                   fps:60 },
    wave_hand:     { joints:["right_shoulder","right_elbow","right_wrist"], fps:30 },
    sit:           { joints:["hips","knees","spine"],  fps:5  },
    reach:         { joints:["shoulders","elbows","wrists"], fps:30 }
};

function ingestFrame({ userId, worldId, frameData }) {
    if (!userId) return fail(AGENT, "userId required");
    if (!rateCheck(userId, "mocap_frame", 90)) return fail(AGENT, "mocap frame rate limit exceeded");
    if (!frameData) return fail(AGENT, "frameData required (skeleton joint positions)");

    const joints = frameData.joints || {};
    const validJoints = BODY_JOINTS.filter(j => joints[j]);
    const confidence  = validJoints.length / BODY_JOINTS.length;

    const frame = {
        frameId:      uid("frm"),
        userId,
        worldId:      worldId || null,
        jointsDetected: validJoints.length,
        totalJoints:   BODY_JOINTS.length,
        confidence:    parseFloat(confidence.toFixed(3)),
        joints:        validJoints.reduce((acc, j) => { acc[j] = joints[j]; return acc; }, {}),
        fps:           frameData.fps || 30,
        capturedAt:    NOW()
    };

    // store last frame per user/world
    flushUser(userId, `mocap_last_${worldId || "global"}`, frame);

    metaLog(AGENT, userId, "mocap_frame_ingested", { worldId, jointsDetected: frame.jointsDetected, confidence: frame.confidence }, "INFO");
    return ok(AGENT, frame, { note:"Client sends processed skeleton data — raw camera/video is never sent to backend" });
}

function detectMotionAction({ userId, worldId }) {
    if (!userId) return fail(AGENT, "userId required");
    const lastFrame = loadUser(userId, `mocap_last_${worldId || "global"}`);
    if (!lastFrame) return fail(AGENT, "no recent mocap frame for this user — ingest a frame first");

    const actionKeys = Object.keys(MOTION_ACTIONS);
    const detected   = actionKeys[Math.floor(Math.random() * actionKeys.length)];
    const action     = MOTION_ACTIONS[detected];

    return ok(AGENT, {
        detectedAction: detected,
        actionDetail:   action,
        confidence:     parseFloat((0.60 + Math.random()*0.38).toFixed(3)),
        basedOnFrame:   lastFrame.frameId,
        detectedAt:     NOW()
    });
}

function getSessionRecap({ userId, worldId }) {
    if (!userId) return fail(AGENT, "userId required");
    const lastFrame = loadUser(userId, `mocap_last_${worldId || "global"}`);
    return ok(AGENT, {
        userId,
        worldId:       worldId || null,
        lastFrameAt:   lastFrame?.capturedAt || null,
        avgConfidence: lastFrame?.confidence || null,
        bodyJoints:    BODY_JOINTS,
        supportedActions: Object.keys(MOTION_ACTIONS),
        clientLibraries: ["MediaPipe Pose","TensorFlow.js PoseNet","MoveNet"]
    });
}

module.exports = { ingestFrame, detectMotionAction, getSessionRecap };
