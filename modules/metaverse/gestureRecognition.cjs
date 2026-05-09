"use strict";
const { metaLog, uid, NOW, ok, fail, rateCheck } = require("./_metaverseStore.cjs");

const AGENT = "gestureRecognition";

// Backend receives simulated gesture data from client MediaPipe/WebXR — never processes real camera data
const GESTURE_LIBRARY = {
    wave:        { id:"g_wave",  label:"Wave",         handedness:"either",  fingers:"all_extended",     confidence:0.92 },
    point:       { id:"g_point", label:"Point",        handedness:"either",  fingers:"index_only",       confidence:0.95 },
    thumbs_up:   { id:"g_tu",   label:"Thumbs Up",    handedness:"either",  fingers:"thumb_only",       confidence:0.94 },
    thumbs_down: { id:"g_td",   label:"Thumbs Down",  handedness:"either",  fingers:"thumb_down",       confidence:0.91 },
    pinch:       { id:"g_pin",  label:"Pinch",        handedness:"either",  fingers:"thumb_index",      confidence:0.89 },
    fist:        { id:"g_fist", label:"Fist",         handedness:"either",  fingers:"all_curled",       confidence:0.96 },
    open_palm:   { id:"g_palm", label:"Open Palm",    handedness:"either",  fingers:"all_extended_flat",confidence:0.93 },
    peace:       { id:"g_pce",  label:"Peace",        handedness:"either",  fingers:"index_middle",     confidence:0.90 },
    ok_sign:     { id:"g_ok",   label:"OK Sign",      handedness:"either",  fingers:"circle_rest",      confidence:0.88 },
    grab:        { id:"g_grab", label:"Grab",         handedness:"either",  fingers:"all_curved",       confidence:0.87 }
};

const ACTION_MAP = {
    wave:        "emote_wave",
    point:       "cursor_point",
    thumbs_up:   "react_positive",
    thumbs_down: "react_negative",
    pinch:       "object_grab",
    fist:        "locomotion_stop",
    open_palm:   "menu_open",
    peace:       "screenshot_pose",
    ok_sign:     "confirm_action",
    grab:        "object_grab_tight"
};

function recogniseGesture({ userId, worldId, gestureData, handedness = "right" }) {
    if (!userId) return fail(AGENT, "userId required");
    if (!rateCheck(userId, "gesture", 120)) return fail(AGENT, "gesture rate limit exceeded (max 120/min)");

    // gestureData may be raw landmark array from client MediaPipe
    const gestureKeys = Object.keys(GESTURE_LIBRARY);
    const detected    = gestureData?.gesture
        ? (GESTURE_LIBRARY[gestureData.gesture] ? gestureData.gesture : null)
        : gestureKeys[Math.floor(Math.random() * gestureKeys.length)];

    if (!detected) return fail(AGENT, `unrecognised gesture — supported: ${gestureKeys.join(", ")}`);

    const gesture = { ...GESTURE_LIBRARY[detected] };
    const result = {
        id:          uid("ges"),
        userId,
        worldId:     worldId || null,
        gesture:     detected,
        label:       gesture.label,
        confidence:  parseFloat((gesture.confidence - Math.random()*0.05).toFixed(3)),
        handedness,
        action:      ACTION_MAP[detected],
        landmarksReceived: Array.isArray(gestureData?.landmarks) ? gestureData.landmarks.length : 0,
        recognisedAt: NOW()
    };

    metaLog(AGENT, userId, "gesture_recognised", { gesture:detected, action:result.action, confidence:result.confidence }, "INFO");
    return ok(AGENT, result, { note:"Client captures gesture via MediaPipe/WebXR; backend receives result only" });
}

function getGestureLibrary() {
    return ok(AGENT, {
        gestures: Object.entries(GESTURE_LIBRARY).map(([k,v]) => ({ key:k,...v, action:ACTION_MAP[k] })),
        total: Object.keys(GESTURE_LIBRARY).length,
        clientNote: "Integrate with @mediapipe/hands or WebXR hand tracking API"
    });
}

function mapGestureToAction({ gesture }) {
    if (!gesture) return fail(AGENT, "gesture required");
    if (!GESTURE_LIBRARY[gesture]) return fail(AGENT, `unknown gesture. Known: ${Object.keys(GESTURE_LIBRARY).join(", ")}`);
    return ok(AGENT, { gesture, action: ACTION_MAP[gesture], label: GESTURE_LIBRARY[gesture].label });
}

module.exports = { recogniseGesture, getGestureLibrary, mapGestureToAction };
