"use strict";
const { load, flush, uid, NOW, ok, fail, trackEvent } = require("./_mediaStore.cjs");
const AGENT = "clipGenerator";

const CLIP_FORMATS = {
    short:     { maxSec:60,  platform:["TikTok","Instagram Reels","YouTube Shorts"], aspectRatio:"9:16" },
    medium:    { maxSec:180, platform:["YouTube","Twitter","LinkedIn"],               aspectRatio:"16:9" },
    teaser:    { maxSec:30,  platform:["Instagram","Twitter","Facebook"],             aspectRatio:"16:9" },
    highlight: { maxSec:120, platform:["YouTube","Twitch Clips"],                    aspectRatio:"16:9" },
    thumbnail_moment:{ maxSec:5, platform:["YouTube thumbnail"],                     aspectRatio:"16:9" }
};

function generateClip({ userId, sourceVideoId, sourceTitle, startSec, endSec, clipType = "short", addCaptions = true, addBranding = false }) {
    if (!userId || !sourceVideoId) return fail(AGENT, "userId and sourceVideoId required");
    if (endSec <= startSec) return fail(AGENT, "endSec must be greater than startSec");

    const duration = endSec - startSec;
    const format   = CLIP_FORMATS[clipType] || CLIP_FORMATS.short;
    if (duration > format.maxSec) return fail(AGENT, `Clip type "${clipType}" max is ${format.maxSec}s. Got ${duration}s.`);

    trackEvent("clip_generate", { userId, clipType, duration });

    const clip = {
        id:           uid("cl"),
        userId,
        sourceVideoId,
        sourceTitle,
        startSec,
        endSec,
        durationSec:  duration,
        clipType,
        format,
        addCaptions,
        addBranding,
        ffmpegCmd:    `ffmpeg -i source.mp4 -ss ${startSec} -t ${duration} -c:v libx264 -c:a aac clip.mp4`,
        ffmpegVertical:`ffmpeg -i source.mp4 -ss ${startSec} -t ${duration} -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2" clip_vertical.mp4`,
        captionsNote: addCaptions ? "Run subtitleGenerator → burn-in with ffmpeg subtitles filter" : "No captions",
        status:       "pending",
        createdAt:    NOW()
    };

    const clips = load(userId, "clips", []);
    clips.push(clip);
    flush(userId, "clips", clips.slice(-500));

    return ok(AGENT, { clip });
}

function batchGenerateClips({ userId, sourceVideoId, sourceTitle, segments = [] }) {
    if (!userId || !sourceVideoId || !segments.length) return fail(AGENT, "userId, sourceVideoId, segments required");
    const results = segments.map(s => generateClip({ userId, sourceVideoId, sourceTitle, ...s }));
    const ok_     = results.filter(r => r.status === 200);
    const failed_ = results.filter(r => r.status !== 200);
    return ok(AGENT, { total: segments.length, generated: ok_.length, failed: failed_.length, clips: ok_.map(r => r.data) });
}

function getClipFormats() { return ok(AGENT, CLIP_FORMATS); }

module.exports = { generateClip, batchGenerateClips, getClipFormats };
