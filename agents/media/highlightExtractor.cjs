"use strict";
const { load, flush, uid, NOW, ok, fail, trackEvent } = require("./_mediaStore.cjs");
const AGENT = "highlightExtractor";

const HIGHLIGHT_SIGNALS = {
    audio_peak:     { description:"Loud audio spike — crowd cheers, explosions, music drops", weight:3 },
    chat_surge:     { description:"Chat messages spike rapidly during live stream",            weight:4 },
    view_spike:     { description:"Rewatch rate spikes — viewers replay this moment",          weight:5 },
    scene_change:   { description:"Rapid scene changes indicating action",                     weight:2 },
    keyword:        { description:"Speaker says highlight-worthy keyword",                     weight:3 },
    engagement_drop:{ description:"Viewers leave → signal to CUT, not highlight",             weight:-2 }
};

function extractHighlights({ userId, videoId, videoTitle, signals = [], manualMoments = [], targetHighlightCount = 5, maxHighlightSec = 60 }) {
    if (!userId || !videoId) return fail(AGENT, "userId and videoId required");
    trackEvent("highlight_extract", { userId, videoId });

    const manualHighlights = manualMoments.map((m, i) => ({
        id:          uid("hl"),
        rank:        i + 1,
        startSec:    m.startSec,
        endSec:      m.endSec || m.startSec + Math.min(maxHighlightSec, 30),
        durationSec: (m.endSec || m.startSec + 30) - m.startSec,
        source:      "manual",
        score:       m.score || 10,
        label:       m.label || `Highlight ${i + 1}`,
        clipCmd:     `ffmpeg -i video.mp4 -ss ${m.startSec} -t ${(m.endSec || m.startSec + 30) - m.startSec} -c copy highlight_${i+1}.mp4`
    }));

    const job = {
        id:            uid("he"),
        userId,
        videoId,
        videoTitle,
        method:        manualMoments.length ? "manual" : "auto",
        signalsUsed:   signals.length ? signals : Object.keys(HIGHLIGHT_SIGNALS),
        targetCount:   targetHighlightCount,
        maxHighlightSec,
        highlights:    manualHighlights,
        autoDetectOptions: {
            chatSurge:   "Use Twitch/YouTube Clip API for chat rate",
            audioSpike:  `ffmpeg -i video.mp4 -af "volumedetect" -vn -sn -dn -f null /dev/null 2>&1`,
            aiHighlight: "Use Wisecut / Vidyo.ai / OpusClip for automatic highlight detection"
        },
        tools:         ["Wisecut.video","Vidyo.ai","OpusClip","Munch.ai","Twitch Clips API","YouTube Chapters"],
        status:        "pending",
        createdAt:     NOW()
    };

    const jobs = load(userId, "highlight_jobs", []);
    jobs.push(job);
    flush(userId, "highlight_jobs", jobs.slice(-100));

    return ok(AGENT, { job, signals: HIGHLIGHT_SIGNALS });
}

function addHighlight({ userId, jobId, startSec, endSec, label, score }) {
    if (!userId || !jobId) return fail(AGENT, "userId and jobId required");
    const jobs = load(userId, "highlight_jobs", []);
    const job  = jobs.find(j => j.id === jobId);
    if (!job)  return fail(AGENT, "Highlight job not found");

    const hl = { id: uid("hl"), startSec, endSec, durationSec: endSec - startSec, label: label || `Highlight ${job.highlights.length + 1}`, score: score || 5, source: "manual", addedAt: NOW() };
    job.highlights.push(hl);
    job.highlights.sort((a, b) => (b.score || 0) - (a.score || 0));
    flush(userId, "highlight_jobs", jobs);

    return ok(AGENT, { jobId, highlight: hl });
}

module.exports = { extractHighlights, addHighlight };
