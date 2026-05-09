/**
 * Script Writer Agent — generates structured scripts for video, ads, sales, tutorials.
 *
 * Formats: youtube | ad | sales | explainer | tutorial | podcast_intro
 * Structure: Hook → Problem → Solution → Proof → CTA
 *
 * Uses Groq when GROQ_API_KEY is set; falls back to templates.
 */

const groq = require("../core/groqClient.cjs");

const SYSTEM = `You are a professional scriptwriter for digital content creators.
Write structured, engaging scripts that convert viewers into customers.
Respond ONLY with valid JSON — no markdown.`;

// ── Templates (no-API fallback) ──────────────────────────────────
const TEMPLATES = {
    youtube: (topic, tone) => ({
        format:    "youtube",
        duration:  "8-12 minutes",
        sections: [
            { name: "Hook",      duration: "0:00-0:30", script: `Are you struggling with ${topic}? In the next few minutes, I'll show you exactly how to solve it — stay until the end for the biggest tip.` },
            { name: "Intro",     duration: "0:30-1:00", script: `Hey, welcome back! Today we're diving deep into ${topic}. If you're new here, I help [your audience] achieve [result] — hit subscribe so you don't miss it.` },
            { name: "Problem",   duration: "1:00-2:00", script: `Here's the real problem with ${topic}: most people don't know [common mistake]. This costs them [time/money/results].` },
            { name: "Solution",  duration: "2:00-7:00", script: `Here's the exact system I use: Step 1 — [step]. Step 2 — [step]. Step 3 — [step]. Let me walk you through each one.` },
            { name: "Proof",     duration: "7:00-8:30", script: `Here's what happened when I applied this: [result]. And [client name] went from [before] to [after] in just [timeframe].` },
            { name: "CTA",       duration: "8:30-9:00", script: `If you found this helpful, smash that like button and drop a comment below: what's your biggest challenge with ${topic}? See you in the next one.` }
        ],
        tone
    }),

    ad: (topic, tone) => ({
        format:   "ad",
        duration: "30-60 seconds",
        sections: [
            { name: "Hook",     duration: "0-5s",  script: `Stop scrolling — if you deal with ${topic}, this is for you.` },
            { name: "Problem",  duration: "5-15s", script: `Most people waste [time/money] on ${topic} because they don't know [insight].` },
            { name: "Solution", duration: "15-25s", script: `We built [product] to solve exactly this. [Key benefit 1]. [Key benefit 2]. [Key benefit 3].` },
            { name: "Social Proof", duration: "25-35s", script: `Over [X] customers already use it. [Short testimonial].` },
            { name: "CTA",      duration: "35-40s", script: `Click below. Start free. No credit card needed.` }
        ],
        tone
    }),

    sales: (topic, tone) => ({
        format:   "sales",
        duration: "3-5 minutes",
        sections: [
            { name: "Attention",    script: `Imagine a world where ${topic} is completely solved for you — automatically, without the guesswork.` },
            { name: "Interest",     script: `Right now, you're probably doing [current approach] and getting [disappointing result]. There's a better way.` },
            { name: "Desire",       script: `What if you could [desired outcome]? Our customers regularly see [specific result] within [timeframe].` },
            { name: "Proof",        script: `[Customer name] was exactly where you are. After using our system: [transformation story].` },
            { name: "Offer",        script: `Today only, you can get [product] for [price]. That includes [bonus 1], [bonus 2], and [bonus 3].` },
            { name: "Urgency",      script: `This offer expires [date/time]. We only take [X] new clients per month — here's how to apply.` },
            { name: "CTA",          script: `Click the button below right now and let's get you started.` }
        ],
        tone
    }),

    explainer: (topic, tone) => ({
        format:   "explainer",
        duration: "2-3 minutes",
        sections: [
            { name: "What",  script: `${topic} is [simple one-line explanation]. Think of it like [analogy].` },
            { name: "Why",   script: `This matters because [reason]. Without understanding this, you'll struggle with [consequence].` },
            { name: "How",   script: `Here's how it works in 3 steps: [Step 1], [Step 2], [Step 3].` },
            { name: "When",  script: `The best time to use this is when [situation]. Avoid it when [counter-situation].` },
            { name: "Close", script: `Now you know exactly what ${topic} is and how to use it. Try [first action] today.` }
        ],
        tone
    }),

    tutorial: (topic, tone) => ({
        format:   "tutorial",
        duration: "5-15 minutes",
        sections: [
            { name: "Intro",    script: `In this tutorial, you'll learn how to [outcome from ${topic}]. By the end, you'll be able to [specific skill].` },
            { name: "Prerequisites", script: `Before we start, make sure you have: [tool 1], [tool 2], [tool 3].` },
            { name: "Step 1",   script: `First, [action]. Here's exactly what to do: [detailed steps].` },
            { name: "Step 2",   script: `Next, [action]. This is the part most people skip, but it's critical: [key insight].` },
            { name: "Step 3",   script: `Finally, [action]. Here's a common mistake to avoid: [mistake + fix].` },
            { name: "Recap",    script: `Let's recap: you now know how to [skill 1], [skill 2], and [skill 3].` },
            { name: "Next",     script: `Your next step: [action to take right now]. Drop your questions in the comments.` }
        ],
        tone
    })
};

async function _groqScript(format, topic, tone) {
    const prompt = `Write a complete ${format} video script about "${topic}" in a ${tone} tone.
Return JSON: { "format": "${format}", "duration": "estimated duration", "sections": [{ "name": "section name", "duration": "time", "script": "full script text" }], "writingTips": ["tip1", "tip2"] }`;
    const raw = await groq.chat(SYSTEM, prompt, { maxTokens: 1500 });
    return groq.parseJson(raw);
}

/**
 * Generate a script.
 * @param {string} format   youtube | ad | sales | explainer | tutorial
 * @param {string} topic    The subject of the script
 * @param {string} tone     professional | casual | energetic | motivational
 */
async function write({ format = "youtube", topic, tone = "engaging" }) {
    if (!topic) throw new Error("topic required");

    try {
        return await _groqScript(format, topic, tone);
    } catch {
        const tmplFn = TEMPLATES[format] || TEMPLATES.youtube;
        return tmplFn(topic, tone);
    }
}

async function run(task) {
    const p      = task.payload || {};
    const topic  = p.topic || p.about || task.input || "";
    const format = p.format || "youtube";
    const tone   = p.tone   || "engaging";

    if (!topic) return { success: false, type: "content", agent: "scriptWriterAgent", data: { error: "topic required" } };

    try {
        const data = await write({ format, topic, tone });
        return { success: true, type: "content", agent: "scriptWriterAgent", data };
    } catch (err) {
        return { success: false, type: "content", agent: "scriptWriterAgent", data: { error: err.message } };
    }
}

module.exports = { write, run };
