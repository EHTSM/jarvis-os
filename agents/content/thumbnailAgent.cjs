/**
 * Thumbnail Agent — generates thumbnail design briefs.
 * Returns title text, subtitle, color palette, layout concept, and style guide.
 * No image generation here — that's imageGeneratorAgent. This is the creative brief.
 */

const groq = require("../core/groqClient.cjs");

const SYSTEM = `You are a YouTube thumbnail designer and visual strategist.
Design thumbnails that maximize click-through rate (CTR).
Follow proven formulas: big bold text, contrasting colors, emotional face (if applicable), clear subject.
Respond ONLY with valid JSON.`;

// High-CTR color palettes
const PALETTES = {
    high_energy:  { bg: "#FF4500", text: "#FFFFFF", accent: "#FFD700", mood: "urgent, exciting" },
    professional: { bg: "#1A1A2E", text: "#E0E0E0", accent: "#00D4FF", mood: "authoritative, trustworthy" },
    bright:       { bg: "#FFFF00", text: "#000000", accent: "#FF0000", mood: "attention-grabbing, fun" },
    dark_pro:     { bg: "#0D0D0D", text: "#FF6B35", accent: "#FFFFFF", mood: "premium, mysterious" },
    clean:        { bg: "#FFFFFF", text: "#1A1A1A", accent: "#4CAF50", mood: "minimal, clean, trustworthy" },
    viral:        { bg: "#FF1493", text: "#FFFFFF", accent: "#00FF00", mood: "bold, viral, social-native" }
};

// Layout formulas per content type
const LAYOUTS = {
    tutorial:   { layout: "Left: bold text (70% width). Right: product/screen/hands. Face: top-right corner thumbnail.", elements: ["Bold step number", "Action verb in title", "Arrow pointing to key element"] },
    comparison: { layout: "Split screen: left vs right. VS text in center. Subject icons on each side.", elements: ["Left option label", "Right option label", "VS divider", "Winner badge (optional)"] },
    listicle:   { layout: "Number badge (top-left, large). Bold title. Relevant icons/images as background.", elements: ["Big number", "Short punchy title (max 5 words)", "Relevant background imagery"] },
    story:      { layout: "Full-bleed emotional image. Text overlay at bottom. Gradient overlay for readability.", elements: ["Emotional hook text", "Gradient overlay (bottom 40%)", "Creator face (top-right)"] },
    tips:       { layout: "Checklist visual on left. Bold 'X Tips' headline right. Clean white/light bg.", elements: ["Checklist icon", "Number of tips (large)", "Sub-headline", "Brand logo"] },
    reveal:     { layout: "Before/After split or mystery blur. Bold 'REVEALED' or question mark headline.", elements: ["Before state", "After state or blur", "Curiosity-driving headline"] }
};

function _detectType(topic) {
    const t = topic.toLowerCase();
    if (/how to|tutorial|step|guide|learn/.test(t))                   return "tutorial";
    if (/vs|compare|better|which|difference/.test(t))                  return "comparison";
    if (/\d+ |tips|ways|reasons|things|hacks|mistakes/.test(t))        return "listicle";
    if (/story|journey|how i|from|to/.test(t))                         return "story";
    if (/tips|secrets|tricks/.test(t))                                 return "tips";
    if (/reveal|secret|exposed|truth/.test(t))                         return "reveal";
    return "tutorial";
}

function _pickPalette(type) {
    const map = { tutorial: "professional", comparison: "bright", listicle: "high_energy", story: "dark_pro", tips: "clean", reveal: "viral" };
    return PALETTES[map[type]] || PALETTES.professional;
}

function _templateBrief(topic, type) {
    const layoutType = type || _detectType(topic);
    const palette    = _pickPalette(layoutType);
    const layout     = LAYOUTS[layoutType] || LAYOUTS.tutorial;

    // Auto-generate title options
    const words  = topic.split(" ").filter(w => w.length > 2);
    const short  = words.slice(0, 3).join(" ").toUpperCase();

    return {
        topic,
        type:     layoutType,
        titleText: {
            primary:   short || topic.toUpperCase(),
            secondary: `The complete guide to ${topic}`,
            options:   [`${topic} EXPLAINED`, `STOP doing ${topic} WRONG`, `The TRUTH about ${topic}`, `${topic} in 2025`]
        },
        colorPalette: palette,
        layout: layout.layout,
        elements: layout.elements,
        textOverlay: {
            font:       "Bold sans-serif (Impact, Montserrat ExtraBold)",
            size:       "Headline: 80-120px | Subtext: 40-50px",
            shadow:     "4px black drop shadow for readability",
            maxWords:   5
        },
        imageSuggestions: [
            `High-emotion face looking at camera (surprise/excitement)`,
            `Product or screen showing ${topic} in action`,
            `Before/after result related to ${topic}`
        ],
        dimensionSpec: { width: 1280, height: 720, format: "JPG/PNG", safeZone: "Keep key elements within 1200×650" }
    };
}

async function _groqBrief(topic, type) {
    const prompt = `Create a YouTube thumbnail design brief for "${topic}" (type: ${type}).
JSON: { "titleText": { "primary": "MAIN HEADLINE", "options": ["opt1","opt2","opt3"] }, "colorPalette": { "bg": "#hex", "text": "#hex", "accent": "#hex" }, "layout": "description", "elements": ["element1","element2"], "imageSuggestions": ["suggestion1","suggestion2"], "ctaScore": "estimated CTR impact: low/medium/high" }`;
    const raw = await groq.chat(SYSTEM, prompt, { maxTokens: 800 });
    return groq.parseJson(raw);
}

async function generate({ topic, type = null }) {
    if (!topic) throw new Error("topic required");
    const detectedType = type || _detectType(topic);
    try {
        const ai = await _groqBrief(topic, detectedType);
        return { topic, type: detectedType, ...ai, dimensionSpec: { width: 1280, height: 720 } };
    } catch {
        return _templateBrief(topic, detectedType);
    }
}

async function run(task) {
    const p     = task.payload || {};
    const topic = p.topic || p.about || task.input || "";
    const type  = p.type  || null;

    if (!topic) return { success: false, type: "content", agent: "thumbnailAgent", data: { error: "topic required" } };

    try {
        const data = await generate({ topic, type });
        return { success: true, type: "content", agent: "thumbnailAgent", data };
    } catch (err) {
        return { success: false, type: "content", agent: "thumbnailAgent", data: { error: err.message } };
    }
}

module.exports = { generate, run };
