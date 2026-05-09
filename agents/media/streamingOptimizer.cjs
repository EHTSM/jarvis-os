"use strict";
const { load, flush, uid, NOW, ok, fail, trackEvent } = require("./_mediaStore.cjs");
const AGENT = "streamingOptimizer";

const STREAMING_PROFILES = {
    hls_360p:  { width:640,  height:360,  videoBitrate:"800k",  audioBitrate:"96k",  fps:30, codec:"libx264" },
    hls_480p:  { width:854,  height:480,  videoBitrate:"1400k", audioBitrate:"128k", fps:30, codec:"libx264" },
    hls_720p:  { width:1280, height:720,  videoBitrate:"2800k", audioBitrate:"128k", fps:30, codec:"libx264" },
    hls_1080p: { width:1920, height:1080, videoBitrate:"5000k", audioBitrate:"192k", fps:30, codec:"libx264" },
    hls_4k:    { width:3840, height:2160, videoBitrate:"20000k",audioBitrate:"256k", fps:30, codec:"libx265" },
    dash_720p: { width:1280, height:720,  videoBitrate:"2800k", audioBitrate:"128k", fps:30, codec:"libx264", format:"dash" },
    dash_1080p:{ width:1920, height:1080, videoBitrate:"5000k", audioBitrate:"192k", fps:30, codec:"libx264", format:"dash" }
};

const PLATFORM_INGEST = {
    youtube:    { rtmpUrl:"rtmp://a.rtmp.youtube.com/live2/",  encoder:"OBS/Streamlabs",  maxBitrate:"51000kbps" },
    twitch:     { rtmpUrl:"rtmp://live.twitch.tv/app/",        encoder:"OBS/Streamlabs",  maxBitrate:"6000kbps" },
    instagram:  { rtmpUrl:"rtmps://live-upload.instagram.com:443/rtmp/", encoder:"OBS",  maxBitrate:"4000kbps" },
    facebook:   { rtmpUrl:"rtmps://live-api-s.facebook.com:443/rtmp/",  encoder:"OBS",  maxBitrate:"4000kbps" },
    restream:   { rtmpUrl:"rtmp://live.restream.io/live/",     encoder:"OBS/Restream",    maxBitrate:"6000kbps", note:"Multistream to multiple platforms" }
};

function createStreamProfile({ userId, contentId, targetPlatforms = ["youtube"], qualities = ["hls_720p","hls_1080p"], segmentDuration = 6 }) {
    if (!userId) return fail(AGENT, "userId required");
    trackEvent("stream_profile", { userId, targetPlatforms });

    const profiles = qualities.map(q => STREAMING_PROFILES[q]).filter(Boolean);
    if (!profiles.length) return fail(AGENT, `No valid qualities. Options: ${Object.keys(STREAMING_PROFILES).join(", ")}`);

    const profile = {
        id:             uid("so"),
        userId,
        contentId,
        targetPlatforms,
        qualities,
        profiles,
        segmentDurationSec: segmentDuration,
        hlsPlaylistCmd: `ffmpeg -i input.mp4 ${qualities.map(q => {
            const p = STREAMING_PROFILES[q];
            return `-map 0:v -map 0:a -s:v ${p.width}x${p.height} -b:v:0 ${p.videoBitrate}`;
        }).join(" ")} -var_stream_map "v:0,a:0" -master_pl_name master.m3u8 -f hls -hls_time ${segmentDuration} stream_%v/index.m3u8`,
        platformIngest: targetPlatforms.reduce((acc, p) => { acc[p] = PLATFORM_INGEST[p.toLowerCase()]; return acc; }, {}),
        cdnNote:        "Upload HLS segments to CDN (see cdnManager) for global delivery",
        createdAt:      NOW()
    };

    const profiles_ = load(userId, "stream_profiles", []);
    profiles_.push(profile);
    flush(userId, "stream_profiles", profiles_.slice(-50));

    return ok(AGENT, { profile });
}

function getStreamingProfiles() { return ok(AGENT, { profiles: STREAMING_PROFILES, platforms: PLATFORM_INGEST }); }

module.exports = { createStreamProfile, getStreamingProfiles };
