"use strict";
const { load, flush, uid, NOW, ok, fail, trackEvent } = require("./_mediaStore.cjs");
const AGENT = "podcastEditorAgent";

const EDIT_OPERATIONS = {
    trim:          "Remove silence or dead air from start/end",
    noise_reduce:  "Reduce background noise and hiss",
    normalise:     "Normalise loudness to -16 LUFS (podcast standard)",
    compress:      "Apply dynamic compression for consistent levels",
    eq:            "Equalize voice frequencies (boost 200-300Hz warmth, cut 400-500Hz muddiness)",
    chapter_mark:  "Add timestamp chapter markers",
    intro_outro:   "Prepend/append intro and outro audio",
    remove_ums:    "Remove filler words (um, uh, like) [manual review required]",
    crossfade:     "Apply crossfade between guest segments",
    stereo_split:  "Split host/guest to L/R channels then mix to stereo"
};

const PODCAST_SPECS = {
    spotify:   { format:"MP3",  bitrate:"128-192kbps", sampleRate:"44.1kHz", loudness:"-14 LUFS", maxSize:"200MB" },
    apple:     { format:"MP3",  bitrate:"128kbps",     sampleRate:"44.1kHz", loudness:"-16 LUFS", maxSize:"1GB" },
    google:    { format:"MP3",  bitrate:"128kbps",     sampleRate:"44.1kHz", loudness:"-16 LUFS", maxSize:"500MB" },
    youtube:   { format:"MP4",  bitrate:"192kbps",     sampleRate:"48kHz",   loudness:"-14 LUFS", maxSize:"256GB" },
    anchor:    { format:"MP3",  bitrate:"128kbps",     sampleRate:"44.1kHz", loudness:"-16 LUFS", maxSize:"250MB" }
};

function createEditPlan({ userId, episodeId, episodeTitle, rawFilePath, targetPlatforms = ["spotify"], operations = [], durationSec, guestCount = 1 }) {
    if (!userId || !episodeTitle) return fail(AGENT, "userId and episodeTitle required");
    trackEvent("podcast_edit_plan", { userId, targetPlatforms });

    const recommendedOps = ["trim","noise_reduce","normalise","compress","eq"];
    if (guestCount > 1)  recommendedOps.push("stereo_split","crossfade");
    if (durationSec > 600) recommendedOps.push("chapter_mark");

    const plan = {
        id:               uid("pe"),
        userId,
        episodeId,
        episodeTitle,
        rawFilePath,
        durationSec,
        guestCount,
        targetPlatforms,
        platformSpecs:    targetPlatforms.map(p => ({ platform: p, spec: PODCAST_SPECS[p.toLowerCase()] || PODCAST_SPECS.spotify })),
        operations:       (operations.length ? operations : recommendedOps).map(op => ({
            operation: op,
            description: EDIT_OPERATIONS[op] || op,
            status: "pending"
        })),
        masterSpec:       { loudness:"-16 LUFS", sampleRate:"44.1kHz", format:"MP3 320kbps (master)" },
        exportFormats:    ["MP3","WAV (master)","OGG"],
        tools:            ["Audacity (free)","Adobe Audition","Descript","Reaper","GarageBand (macOS)"],
        ffmpegCommands: {
            normalise:   `ffmpeg -i input.mp3 -af loudnorm=I=-16:LRA=11:TP=-1.5 output.mp3`,
            noise_reduce:`ffmpeg -i input.mp3 -af "afftdn=nf=-25" output.mp3`,
            trim:        `ffmpeg -i input.mp3 -ss 00:00:05 -to 00:59:55 -c copy output.mp3`
        },
        createdAt:        NOW()
    };

    const plans = load(userId, "podcast_edits", []);
    plans.push(plan);
    flush(userId, "podcast_edits", plans.slice(-100));

    return ok(AGENT, { plan });
}

function updateOperationStatus({ userId, planId, operation, status, notes }) {
    if (!userId || !planId || !operation) return fail(AGENT, "userId, planId, operation required");
    const plans = load(userId, "podcast_edits", []);
    const plan  = plans.find(p => p.id === planId);
    if (!plan)  return fail(AGENT, "Edit plan not found");

    const op = plan.operations.find(o => o.operation === operation);
    if (op) { op.status = status; op.notes = notes; op.updatedAt = NOW(); }
    flush(userId, "podcast_edits", plans);

    const allDone = plan.operations.every(o => o.status === "done");
    return ok(AGENT, { planId, operation, status, allOperationsDone: allDone });
}

function getPlatformSpecs({ platform }) {
    if (platform) {
        const spec = PODCAST_SPECS[platform.toLowerCase()];
        return spec ? ok(AGENT, spec) : fail(AGENT, `Unknown platform. Options: ${Object.keys(PODCAST_SPECS).join(", ")}`);
    }
    return ok(AGENT, PODCAST_SPECS);
}

module.exports = { createEditPlan, updateOperationStatus, getPlatformSpecs };
