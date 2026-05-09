"use strict";
const { load, flush, uid, NOW, ok, fail, trackEvent } = require("./_mediaStore.cjs");
const AGENT = "sceneDetectionAgent";

const SCENE_TYPES = {
    cut:        "Hard cut between different shots",
    fade:       "Fade to black or white between scenes",
    dissolve:   "Cross-dissolve overlap transition",
    wipe:       "Wipe transition",
    action:     "High motion / action sequence",
    dialogue:   "Talking head / interview scene",
    b_roll:     "Cutaway / illustrative footage",
    title_card: "Text card or title screen",
    product:    "Product close-up or showcase"
};

function detectScenes({ userId, videoId, videoTitle, totalDurationSec, manualTimestamps = [] }) {
    if (!userId || !videoId) return fail(AGENT, "userId and videoId required");
    trackEvent("scene_detect", { userId, videoId });

    const job = {
        id:            uid("sd"),
        userId,
        videoId,
        videoTitle,
        totalDurationSec,
        method:        manualTimestamps.length ? "manual" : "auto",
        autoDetectCmd: `ffmpeg -i video.mp4 -filter:v "select='gt(scene,0.3)',showinfo" -vsync vfr thumbs_%04d.png 2>&1 | grep pts_time`,
        pyScendetect:  `scenedetect -i video.mp4 detect-content list-scenes`,
        scenes:        manualTimestamps.length
            ? manualTimestamps.map((ts, i) => ({
                id:        uid("sc"),
                index:     i + 1,
                startSec:  ts.start,
                endSec:    ts.end,
                durationSec: ts.end - ts.start,
                type:      ts.type || "cut",
                label:     ts.label || `Scene ${i + 1}`,
                description: ts.description || ""
              }))
            : [{ id: uid("sc"), index: 1, startSec: 0, endSec: totalDurationSec || 60, type: "cut", label: "Full video", note: "Run auto-detect or add manual timestamps" }],
        tools:         ["PySceneDetect (open source)","ffmpeg scene filter","Adobe Premiere Auto-Cut","DaVinci Resolve Scene Cut Detection"],
        status:        "pending",
        createdAt:     NOW()
    };

    const jobs = load(userId, "scene_jobs", []);
    jobs.push(job);
    flush(userId, "scene_jobs", jobs.slice(-100));

    return ok(AGENT, { job, sceneTypes: SCENE_TYPES });
}

function labelScene({ userId, jobId, sceneId, type, label, description }) {
    if (!userId || !jobId || !sceneId) return fail(AGENT, "userId, jobId, sceneId required");
    const jobs = load(userId, "scene_jobs", []);
    const job  = jobs.find(j => j.id === jobId);
    if (!job)  return fail(AGENT, "Scene detection job not found");
    const scene = job.scenes.find(s => s.id === sceneId);
    if (!scene) return fail(AGENT, "Scene not found");

    if (type)        scene.type        = type;
    if (label)       scene.label       = label;
    if (description) scene.description = description;
    flush(userId, "scene_jobs", jobs);

    return ok(AGENT, { jobId, scene });
}

module.exports = { detectScenes, labelScene };
