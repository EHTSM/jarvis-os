/**
 * Image Processor Agent — real pixel-level image processing via sharp.
 *
 * Enterprise Capability Expansion mission. Confirmed genuinely absent
 * before this: /creative/image/upscale and /creative/image/edit always
 * fell through creativeStudio's generic text-LLM stub (description only,
 * generated:false) — no real image bytes were ever processed. sharp
 * (0.35.3, prebuilt libvips binary on this platform, no native compile)
 * provides real resize/format-convert/compress. Background removal is
 * intentionally NOT claimed as real here — that needs ML segmentation,
 * which sharp does not do; the honest text fallback stays wired for that
 * capability rather than faking a cutout.
 */

const fs   = require("fs");
const path = require("path");
const sharp = require("sharp");
const { assertSafeNavigationTarget } = require("../../backend/utils/urlSafety.cjs");

const IMAGE_DIR = path.join(__dirname, "../../data/processed-images");
const FETCH_TIMEOUT_MS = 20_000;
const MAX_SOURCE_BYTES = 25 * 1024 * 1024; // 25MB cap on fetched source images

async function _loadSourceBytes(imageUrl) {
    if (/^data:image\/[a-zA-Z+]+;base64,/.test(imageUrl)) {
        return Buffer.from(imageUrl.split(",")[1], "base64");
    }
    if (/^https?:\/\//.test(imageUrl)) {
        // Creative Ecosystem mission: an authenticated caller's imageUrl was
        // fetched server-side with no protection against SSRF — a request
        // for http://169.254.169.254/... (cloud metadata) or an internal
        // RFC1918 host would have been fetched and its bytes processed and
        // returned. Reuses the same shared choke point already proven across
        // the browser-automation family (agents/browser/actionEngine.cjs and
        // 12 other call sites) rather than adding a second guard.
        const safety = await assertSafeNavigationTarget(imageUrl);
        if (!safety.safe) throw new Error(`Refusing to fetch source image: ${safety.reason}`);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        try {
            const res = await fetch(imageUrl, { signal: controller.signal });
            if (!res.ok) throw new Error(`Source fetch failed: HTTP ${res.status}`);
            const len = Number(res.headers.get("content-length") || 0);
            if (len && len > MAX_SOURCE_BYTES) throw new Error("Source image exceeds 25MB limit");
            const buf = Buffer.from(await res.arrayBuffer());
            if (buf.length > MAX_SOURCE_BYTES) throw new Error("Source image exceeds 25MB limit");
            return buf;
        } finally {
            clearTimeout(timer);
        }
    }
    // Local path relative to the data dir a prior generation wrote to
    // (e.g. an asset produced by this same system) — never an arbitrary
    // absolute filesystem path from user input.
    const rel = imageUrl.replace(/^\/+/, "");
    const abs = path.join(__dirname, "../..", rel);
    const root = path.join(__dirname, "../../data");
    if (!abs.startsWith(root + path.sep)) throw new Error("Local image path must be under data/");
    if (!fs.existsSync(abs)) throw new Error("Local image not found");
    return fs.readFileSync(abs);
}

/**
 * upscale({ imageUrl, scale, format }) -> real resized/re-encoded image bytes on disk
 * @param {number} scale multiplier, e.g. 2 for 2x (clamped 1-4)
 * @param {string} format "png" | "jpeg" | "webp" (defaults to source format)
 */
async function upscale({ imageUrl, scale = 2, format } = {}) {
    if (!imageUrl) throw new Error("imageUrl required");
    const clampedScale = Math.min(4, Math.max(1, Number(scale) || 2));

    const source = await _loadSourceBytes(imageUrl);
    const meta = await sharp(source).metadata();
    const targetWidth = Math.round((meta.width || 512) * clampedScale);

    let pipeline = sharp(source).resize({ width: targetWidth, withoutEnlargement: false, kernel: "lanczos3" });
    const outFormat = format || meta.format || "png";
    if (outFormat === "jpeg" || outFormat === "jpg") pipeline = pipeline.jpeg({ quality: 92 });
    else if (outFormat === "webp") pipeline = pipeline.webp({ quality: 92 });
    else pipeline = pipeline.png();

    const buffer = await pipeline.toBuffer();
    fs.mkdirSync(IMAGE_DIR, { recursive: true });
    const ext = outFormat === "jpg" ? "jpeg" : outFormat;
    const filename = `upscale_${Date.now()}.${ext}`;
    fs.writeFileSync(path.join(IMAGE_DIR, filename), buffer);

    return {
        generated: true, via: "sharp",
        filename, sizeBytes: buffer.length,
        originalWidth: meta.width, originalHeight: meta.height,
        outputWidth: targetWidth, scale: clampedScale, format: outFormat,
    };
}

/**
 * edit({ imageUrl, resize, format, rotate, grayscale, quality }) -> real transformed image
 * A general-purpose real transform: resize (width/height), rotate, grayscale,
 * format conversion, and quality/compression — all genuine sharp operations,
 * not an AI-driven content edit (no inpainting/generative edit is claimed).
 */
async function edit({ imageUrl, resize, format, rotate, grayscale, quality } = {}) {
    if (!imageUrl) throw new Error("imageUrl required");
    const source = await _loadSourceBytes(imageUrl);
    const meta = await sharp(source).metadata();

    let pipeline = sharp(source);
    if (resize && (resize.width || resize.height)) {
        pipeline = pipeline.resize({ width: resize.width || null, height: resize.height || null, fit: resize.fit || "cover" });
    }
    if (rotate) pipeline = pipeline.rotate(Number(rotate));
    if (grayscale) pipeline = pipeline.grayscale();

    const outFormat = format || meta.format || "png";
    const q = Math.min(100, Math.max(1, Number(quality) || 92));
    if (outFormat === "jpeg" || outFormat === "jpg") pipeline = pipeline.jpeg({ quality: q });
    else if (outFormat === "webp") pipeline = pipeline.webp({ quality: q });
    else pipeline = pipeline.png();

    const buffer = await pipeline.toBuffer();
    fs.mkdirSync(IMAGE_DIR, { recursive: true });
    const ext = outFormat === "jpg" ? "jpeg" : outFormat;
    const filename = `edit_${Date.now()}.${ext}`;
    fs.writeFileSync(path.join(IMAGE_DIR, filename), buffer);

    return {
        generated: true, via: "sharp",
        filename, sizeBytes: buffer.length,
        originalWidth: meta.width, originalHeight: meta.height,
        format: outFormat, operations: { resize: !!resize, rotate: !!rotate, grayscale: !!grayscale },
    };
}

module.exports = { upscale, edit };
