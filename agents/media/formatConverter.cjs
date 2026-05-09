"use strict";
const { ok, fail, uid, NOW, trackEvent } = require("./_mediaStore.cjs");
const AGENT = "formatConverter";

const VIDEO_CONVERSIONS = {
    "mp4":  { codec:"libx264",  note:"Universal — best compatibility" },
    "webm": { codec:"libvpx-vp9",note:"Web streaming, smaller than MP4" },
    "mov":  { codec:"prores",   note:"Apple/Final Cut Pro master format" },
    "avi":  { codec:"mpeg4",    note:"Legacy — avoid for new projects" },
    "mkv":  { codec:"copy",     note:"Container change only — no re-encode" },
    "gif":  { codec:"N/A",      note:"Animated GIF — palette optimised" },
    "ts":   { codec:"copy",     note:"MPEG-TS stream format for HLS" }
};

const AUDIO_CONVERSIONS = {
    "mp3":  { codec:"libmp3lame", bitrate:"320k", note:"Universal lossy" },
    "aac":  { codec:"aac",        bitrate:"256k", note:"Better quality than MP3 at same bitrate" },
    "ogg":  { codec:"libvorbis",  bitrate:"256k", note:"Open source, good for web" },
    "wav":  { codec:"pcm_s16le",  bitrate:"N/A",  note:"Lossless — large file" },
    "flac": { codec:"flac",       bitrate:"N/A",  note:"Lossless compressed" },
    "opus": { codec:"libopus",    bitrate:"128k", note:"Best quality/size for streaming" }
};

const IMAGE_CONVERSIONS = {
    "webp": { tool:"ffmpeg / cwebp", note:"Modern web format" },
    "avif": { tool:"ffmpeg",         note:"Next-gen, best compression" },
    "png":  { tool:"ffmpeg",         note:"Lossless" },
    "jpeg": { tool:"ffmpeg",         note:"Lossy, universal" },
    "svg":  { tool:"Inkscape (manual)",note:"Vector — requires manual tracing" }
};

function convert({ userId, fileId, fileName, sourceFormat, targetFormat, quality }) {
    if (!userId || !fileName || !targetFormat) return fail(AGENT, "userId, fileName, targetFormat required");
    trackEvent("format_convert", { userId, sourceFormat, targetFormat });

    const src    = (sourceFormat || fileName.split(".").pop() || "").toLowerCase();
    const tgt    = targetFormat.toLowerCase();
    const q      = quality || 23;

    let cmd, info;
    if (VIDEO_CONVERSIONS[tgt]) {
        info = VIDEO_CONVERSIONS[tgt];
        cmd  = tgt === "gif"
            ? `ffmpeg -i "${fileName}" -vf "fps=15,scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" output.gif`
            : `ffmpeg -i "${fileName}" -c:v ${info.codec} -crf ${q} -c:a aac output.${tgt}`;
    } else if (AUDIO_CONVERSIONS[tgt]) {
        info = AUDIO_CONVERSIONS[tgt];
        cmd  = info.bitrate !== "N/A"
            ? `ffmpeg -i "${fileName}" -c:a ${info.codec} -b:a ${info.bitrate} output.${tgt}`
            : `ffmpeg -i "${fileName}" -c:a ${info.codec} output.${tgt}`;
    } else if (IMAGE_CONVERSIONS[tgt]) {
        info = IMAGE_CONVERSIONS[tgt];
        cmd  = `ffmpeg -i "${fileName}" output.${tgt}`;
    } else {
        return fail(AGENT, `Unsupported target format "${tgt}". Video: ${Object.keys(VIDEO_CONVERSIONS).join(",")} | Audio: ${Object.keys(AUDIO_CONVERSIONS).join(",")} | Image: ${Object.keys(IMAGE_CONVERSIONS).join(",")}`);
    }

    return ok(AGENT, { fileId, fileName, sourceFormat: src, targetFormat: tgt, formatInfo: info, ffmpegCmd: cmd, quality: q });
}

function getSupportedFormats() {
    return ok(AGENT, { video: VIDEO_CONVERSIONS, audio: AUDIO_CONVERSIONS, image: IMAGE_CONVERSIONS });
}

module.exports = { convert, getSupportedFormats };
