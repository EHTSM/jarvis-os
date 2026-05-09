"use strict";
const { load, flush, uid, NOW, ok, fail, trackEvent } = require("./_mediaStore.cjs");
const AGENT = "thumbnailOptimizer";

const PLATFORM_SPECS = {
    youtube:    { width:1280,  height:720,  format:"JPEG/PNG/WebP",  maxSizeMB:2,   aspectRatio:"16:9",  minWidth:640 },
    instagram:  { width:1080,  height:1080, format:"JPEG/PNG",       maxSizeMB:8,   aspectRatio:"1:1",   minWidth:320 },
    instagram_story:{ width:1080,height:1920,format:"JPEG/PNG",      maxSizeMB:8,   aspectRatio:"9:16",  minWidth:500 },
    tiktok:     { width:1080,  height:1920, format:"JPEG/PNG",       maxSizeMB:10,  aspectRatio:"9:16",  minWidth:540 },
    twitter:    { width:1200,  height:675,  format:"JPEG/PNG/WebP",  maxSizeMB:5,   aspectRatio:"16:9",  minWidth:400 },
    linkedin:   { width:1200,  height:627,  format:"JPEG/PNG",       maxSizeMB:5,   aspectRatio:"1.91:1",minWidth:400 },
    spotify:    { width:3000,  height:3000, format:"JPEG/PNG",       maxSizeMB:10,  aspectRatio:"1:1",   minWidth:1400 },
    podcast:    { width:3000,  height:3000, format:"JPEG/PNG",       maxSizeMB:500, aspectRatio:"1:1",   minWidth:1400 }
};

const DESIGN_PRINCIPLES = [
    "High contrast — dark background with bright text, or vice versa",
    "Rule of thirds — subject off-center for visual interest",
    "Face close-up with expressive emotion increases CTR by up to 38%",
    "Max 6 words of text — readable at small size (mobile thumbnail = 80px wide)",
    "Brand consistent colour palette + font across all thumbnails",
    "Test A/B variants — YouTube Studio allows thumbnail experiments",
    "Avoid misleading thumbnails — platform policies penalise clickbait",
    "Use odd numbers in lists (3, 5, 7) — drives curiosity"
];

const CTR_BENCHMARKS = {
    youtube: { low:"<2%", average:"2-5%", good:"5-8%", great:">8%" },
    email:   { low:"<1%", average:"1-3%", good:"3-5%", great:">5%" }
};

function optimiseThumbnail({ userId, contentId, platform = "youtube", currentCTR, title, currentIssues = [] }) {
    if (!userId || !contentId) return fail(AGENT, "userId and contentId required");
    trackEvent("thumbnail_optimise", { userId, platform });

    const spec = PLATFORM_SPECS[platform.toLowerCase().replace(/\s+/g,"_")] || PLATFORM_SPECS.youtube;
    const benchmark = CTR_BENCHMARKS[platform] || CTR_BENCHMARKS.youtube;

    const ctrStatus = currentCTR
        ? currentCTR < 2 ? "LOW" : currentCTR < 5 ? "AVERAGE" : currentCTR < 8 ? "GOOD" : "GREAT"
        : "UNKNOWN";

    const recommendations = [...DESIGN_PRINCIPLES];
    if (currentIssues.includes("too_much_text"))  recommendations.unshift("Reduce to max 5 words — text is invisible at small size");
    if (currentIssues.includes("low_contrast"))   recommendations.unshift("Increase contrast ratio to minimum 4.5:1 (WCAG AA)");
    if (currentIssues.includes("no_face"))        recommendations.unshift("Add human face with visible emotion — proven CTR booster");
    if (currentIssues.includes("generic_colors")) recommendations.unshift("Replace generic palette with bold brand colour — stands out in feed");

    const result = {
        id:           uid("to"),
        userId,
        contentId,
        platform,
        spec,
        currentCTR,
        ctrStatus,
        ctrBenchmark: benchmark,
        recommendations: recommendations.slice(0, 6),
        resizeCmd:    `ffmpeg -i input.jpg -vf scale=${spec.width}:${spec.height} thumbnail.jpg`,
        tools:        ["Canva","Adobe Firefly","Midjourney","Photoshop","Remove.bg (for background removal)"],
        abTestNote:   "Create 2-3 variants, run for 48-72h, keep highest CTR",
        createdAt:    NOW()
    };

    const log = load(userId, "thumbnail_optimisations", []);
    log.push(result);
    flush(userId, "thumbnail_optimisations", log.slice(-100));

    return ok(AGENT, { result });
}

function getPlatformSpecs() { return ok(AGENT, { specs: PLATFORM_SPECS, designPrinciples: DESIGN_PRINCIPLES, ctrBenchmarks: CTR_BENCHMARKS }); }

module.exports = { optimiseThumbnail, getPlatformSpecs };
