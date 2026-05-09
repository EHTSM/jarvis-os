"use strict";
const { load, flush, uid, NOW, ok, fail, trackEvent } = require("./_mediaStore.cjs");
const AGENT = "videoEditorPro";

const TRANSITIONS = ["cut","fade","dissolve","wipe_left","wipe_right","zoom_in","zoom_out","spin","flash","glitch"];
const COLOR_GRADES = {
    cinematic:   { lut:"Cinematic_Teal_Orange", contrast:"+15", saturation:"-10", shadow:"teal tint" },
    warm:        { lut:"Warm_Vintage",           contrast:"+5",  saturation:"+10", shadow:"orange tint" },
    cold:        { lut:"Cold_Blue",              contrast:"+10", saturation:"-5",  shadow:"blue tint" },
    black_white: { lut:"Desaturate",             contrast:"+20", saturation:"-100",shadow:"neutral" },
    vibrant:     { lut:"Vibrant_Pop",            contrast:"+5",  saturation:"+30", shadow:"neutral" },
    documentary: { lut:"Flat_Natural",           contrast:"0",   saturation:"0",   shadow:"neutral" }
};

const PLATFORM_EXPORT_PRESETS = {
    youtube_1080p: { resolution:"1920x1080",  fps:30, codec:"H.264", bitrate:"8Mbps",  container:"MP4" },
    youtube_4k:    { resolution:"3840x2160",  fps:30, codec:"H.265", bitrate:"35Mbps", container:"MP4" },
    instagram_reel:{ resolution:"1080x1920",  fps:30, codec:"H.264", bitrate:"3.5Mbps",container:"MP4" },
    tiktok:        { resolution:"1080x1920",  fps:30, codec:"H.264", bitrate:"3Mbps",  container:"MP4" },
    twitter:       { resolution:"1280x720",   fps:30, codec:"H.264", bitrate:"2.5Mbps",container:"MP4" },
    linkedin:      { resolution:"1920x1080",  fps:30, codec:"H.264", bitrate:"5Mbps",  container:"MP4" },
    podcast_video: { resolution:"1920x1080",  fps:24, codec:"H.264", bitrate:"4Mbps",  container:"MP4" }
};

function createEditProject({ userId, title, rawClips = [], targetPlatform = "youtube_1080p", colorGrade = "cinematic", durationSec, aspectRatio = "16:9" }) {
    if (!userId || !title) return fail(AGENT, "userId and title required");
    trackEvent("video_edit_project", { userId, targetPlatform });

    const exportPreset = PLATFORM_EXPORT_PRESETS[targetPlatform] || PLATFORM_EXPORT_PRESETS.youtube_1080p;
    const grade        = COLOR_GRADES[colorGrade] || COLOR_GRADES.cinematic;

    const project = {
        id:           uid("vp"),
        userId,
        title,
        rawClips:     rawClips.length ? rawClips : [{ name:"clip_01", durationSec: durationSec || 60, note:"Add your raw clip files" }],
        timeline:     [],
        targetPlatform,
        exportPreset,
        colorGrade:   { name: colorGrade, ...grade },
        aspectRatio,
        audioMix: {
            dialogue:    "0dB (reference)",
            music:       "-18dB under dialogue",
            sfx:         "-12dB",
            exportLUFS:  targetPlatform.includes("youtube") ? "-14 LUFS" : "-16 LUFS"
        },
        transitions:  TRANSITIONS,
        tools:        ["DaVinci Resolve (free)","Adobe Premiere Pro","Final Cut Pro (macOS)","CapCut (free)","ffmpeg (CLI)"],
        ffmpegExport: `ffmpeg -i input.mp4 -vf scale=${exportPreset.resolution.replace("x",":")},fps=${exportPreset.fps} -c:v libx264 -b:v ${exportPreset.bitrate} -c:a aac output.mp4`,
        status:       "draft",
        createdAt:    NOW()
    };

    const projects = load(userId, "video_projects", []);
    projects.push(project);
    flush(userId, "video_projects", projects.slice(-50));

    return ok(AGENT, { project });
}

function addTimelineClip({ userId, projectId, clipName, startSec, endSec, transitionIn = "cut", transitionOut = "cut" }) {
    if (!userId || !projectId) return fail(AGENT, "userId and projectId required");
    const projects = load(userId, "video_projects", []);
    const project  = projects.find(p => p.id === projectId);
    if (!project)  return fail(AGENT, "Project not found");

    project.timeline.push({ clipName, startSec, endSec, durationSec: endSec - startSec, transitionIn, transitionOut, order: project.timeline.length + 1 });
    flush(userId, "video_projects", projects);
    return ok(AGENT, { projectId, timeline: project.timeline });
}

function getPlatformPresets() { return ok(AGENT, { presets: PLATFORM_EXPORT_PRESETS, colorGrades: COLOR_GRADES, transitions: TRANSITIONS }); }

module.exports = { createEditProject, addTimelineClip, getPlatformPresets };
