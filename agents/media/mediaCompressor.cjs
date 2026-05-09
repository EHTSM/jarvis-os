"use strict";
const { load, flush, uid, NOW, ok, fail, trackEvent } = require("./_mediaStore.cjs");
const AGENT = "mediaCompressor";

const COMPRESSION_PRESETS = {
    web_optimised: { videoCodec:"libx264",  crf:23, preset:"medium",   audioCodec:"aac",  audioBitrate:"128k", ext:"mp4",  note:"Best for web embedding" },
    high_quality:  { videoCodec:"libx264",  crf:18, preset:"slow",     audioCodec:"aac",  audioBitrate:"192k", ext:"mp4",  note:"Near-lossless, larger file" },
    mobile:        { videoCodec:"libx264",  crf:28, preset:"fast",     audioCodec:"aac",  audioBitrate:"96k",  ext:"mp4",  note:"Smaller file for mobile" },
    archive:       { videoCodec:"libx265",  crf:20, preset:"slow",     audioCodec:"aac",  audioBitrate:"192k", ext:"mp4",  note:"HEVC — half the size of H.264" },
    gif_optimised: { videoCodec:"N/A",      crf:"N/A",preset:"N/A",   audioCodec:"N/A",  audioBitrate:"N/A",  ext:"gif",  note:"Palette optimised GIF" },
    social_share:  { videoCodec:"libx264",  crf:25, preset:"fast",     audioCodec:"aac",  audioBitrate:"128k", ext:"mp4",  note:"Fast encode, social platform ready" }
};

const IMAGE_FORMATS = {
    webp:  { tool:"cwebp / ffmpeg",   savings:"25-35% vs JPEG",  quality:"80",  lossless:false },
    avif:  { tool:"avifenc / ffmpeg", savings:"40-50% vs JPEG",  quality:"60",  lossless:false },
    jpeg:  { tool:"jpegoptim / ffmpeg",savings:"up to 30% lossless",quality:"85",lossless:true },
    png:   { tool:"pngquant",         savings:"up to 70% lossy", quality:"80",  lossless:false }
};

function compressVideo({ userId, fileId, fileName, inputSizeMB, preset = "web_optimised", targetResolution, targetBitrate }) {
    if (!userId) return fail(AGENT, "userId required");
    trackEvent("video_compress", { userId, preset });

    const presetDef = COMPRESSION_PRESETS[preset] || COMPRESSION_PRESETS.web_optimised;
    const crfFlag   = presetDef.crf !== "N/A" ? `-crf ${presetDef.crf}` : "";
    const scaleFlag = targetResolution ? `-vf scale=${targetResolution.replace("x",":")}` : "";

    const job = {
        id:          uid("mc"),
        userId,
        fileId,
        fileName,
        inputSizeMB,
        preset,
        presetConfig:presetDef,
        estimatedOutputSizeMB: inputSizeMB ? Math.round(inputSizeMB * (presetDef.crf <= 20 ? 0.6 : presetDef.crf <= 25 ? 0.4 : 0.3)) : null,
        ffmpegCmd:   `ffmpeg -i "${fileName}" ${scaleFlag} -c:v ${presetDef.videoCodec} ${crfFlag} -preset ${presetDef.preset} -c:a ${presetDef.audioCodec} -b:a ${presetDef.audioBitrate} output_${preset}.${presetDef.ext}`,
        status:      "pending",
        createdAt:   NOW()
    };

    const jobs = load(userId, "compress_jobs", []);
    jobs.push(job);
    flush(userId, "compress_jobs", jobs.slice(-200));

    return ok(AGENT, { job });
}

function compressImage({ userId, fileId, fileName, targetFormat = "webp", quality }) {
    if (!userId) return fail(AGENT, "userId required");
    const fmt     = IMAGE_FORMATS[targetFormat.toLowerCase()] || IMAGE_FORMATS.webp;
    const q       = quality || fmt.quality;
    const cmd     = targetFormat === "webp"
        ? `cwebp -q ${q} "${fileName}" -o output.webp`
        : `ffmpeg -i "${fileName}" -c:v lib${targetFormat} -quality ${q} output.${targetFormat}`;

    return ok(AGENT, { fileId, fileName, targetFormat, quality: q, formatInfo: fmt, convertCmd: cmd });
}

function getPresets() { return ok(AGENT, { videoPresets: COMPRESSION_PRESETS, imageFormats: IMAGE_FORMATS }); }

module.exports = { compressVideo, compressImage, getPresets };
