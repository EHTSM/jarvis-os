/**
 * Podcast Generator Agent — episode outlines, segment scripts, show notes, guest questions.
 * Formats: solo | interview | panel | narrative | educational
 */

const groq = require("../core/groqClient.cjs");

const SYSTEM = `You are an experienced podcast producer and content strategist.
Create structured, engaging podcast content that keeps listeners hooked.
Respond ONLY with valid JSON.`;

// Episode structure templates
const STRUCTURES = {
    solo: [
        { segment: "Intro & Hook",      duration: "2-3 min",  purpose: "Grab attention, tease main insight" },
        { segment: "Context & Setup",   duration: "3-5 min",  purpose: "Why this topic matters right now" },
        { segment: "Main Point 1",      duration: "5-7 min",  purpose: "Deep dive into first key idea" },
        { segment: "Main Point 2",      duration: "5-7 min",  purpose: "Second key idea with example" },
        { segment: "Main Point 3",      duration: "5-7 min",  purpose: "Third key idea + common mistakes" },
        { segment: "Action Steps",      duration: "3-5 min",  purpose: "Concrete steps listeners can take today" },
        { segment: "Outro & CTA",       duration: "2 min",    purpose: "Subscribe prompt + next episode tease" }
    ],
    interview: [
        { segment: "Host Intro",        duration: "1-2 min",  purpose: "Welcome and episode context" },
        { segment: "Guest Introduction",duration: "3-5 min",  purpose: "Guest background, credibility" },
        { segment: "Origin Story",      duration: "5-8 min",  purpose: "How guest got started, key turning point" },
        { segment: "Main Topic Deep Dive", duration: "15-20 min", purpose: "Core expertise discussion" },
        { segment: "Lessons Learned",   duration: "5-8 min",  purpose: "Biggest mistakes and wins" },
        { segment: "Rapid Fire",        duration: "3-5 min",  purpose: "Quick questions, personality" },
        { segment: "Outro",             duration: "2-3 min",  purpose: "Where to find guest + episode summary" }
    ],
    educational: [
        { segment: "Cold Open",         duration: "1 min",    purpose: "Compelling fact or question" },
        { segment: "Intro",             duration: "2-3 min",  purpose: "What listeners will learn" },
        { segment: "Concept Explained", duration: "5-8 min",  purpose: "Break down the core concept simply" },
        { segment: "Real Examples",     duration: "5-7 min",  purpose: "3 real-world examples" },
        { segment: "How To Apply",      duration: "5-7 min",  purpose: "Listener action framework" },
        { segment: "FAQ",               duration: "3-5 min",  purpose: "Answer top 3 listener questions" },
        { segment: "Summary & CTA",     duration: "2 min",    purpose: "Recap + newsletter/subscribe CTA" }
    ],
    narrative: [
        { segment: "Cold Open",         duration: "2-3 min",  purpose: "Drop into the middle of the story" },
        { segment: "Background",        duration: "3-5 min",  purpose: "Set the scene and characters" },
        { segment: "Rising Action",     duration: "8-10 min", purpose: "The main journey/conflict" },
        { segment: "Climax",            duration: "5-7 min",  purpose: "The key moment or reveal" },
        { segment: "Resolution",        duration: "3-5 min",  purpose: "What happened + takeaway" },
        { segment: "Lessons",           duration: "2-3 min",  purpose: "What listeners can apply" },
        { segment: "Outro",             duration: "2 min",    purpose: "Next episode tease" }
    ]
};

const GUEST_QUESTIONS = {
    opening:  ["How did you first get started in [field]?", "What was the moment you knew this was your path?", "Tell us something about yourself most people don't know."],
    depth:    ["What's the most counterintuitive thing you've learned?", "What advice would you give your 5-years-ago self?", "Where do you think most people get this wrong?"],
    tactical: ["Walk us through your exact process for [topic].", "What tools or systems do you swear by?", "If you had to start from zero today, what would you do first?"],
    rapid:    ["Book that changed your life?", "Best investment you ever made?", "One habit that changed everything?", "What do you believe that most disagree with?"]
};

function _buildEpisode(topic, format, guestName) {
    const structure = STRUCTURES[format] || STRUCTURES.solo;
    const isInterview = format === "interview";

    const segments = structure.map(s => ({
        ...s,
        talkingPoints: [`[Expand on ${s.purpose} for ${topic}]`, "[Real example or story here]", "[Transition to next segment]"],
        scriptOpener:  s.segment === "Intro & Hook" || s.segment === "Cold Open"
            ? `What if everything you thought you knew about ${topic} was wrong? Stay with me — by the end of this episode, you'll see it differently.`
            : `[Script for ${s.segment} segment — tailored to ${topic}]`
    }));

    const questions = isInterview ? {
        opening:  GUEST_QUESTIONS.opening.map(q => q.replace("[field]", topic)),
        depth:    GUEST_QUESTIONS.depth,
        tactical: GUEST_QUESTIONS.tactical.map(q => q.replace("[topic]", topic)),
        rapid:    GUEST_QUESTIONS.rapid
    } : null;

    return {
        topic,
        format,
        estimatedDuration: format === "interview" ? "45-60 min" : "20-30 min",
        title:   `${topic}: Everything You Need to Know`,
        tagline: `The episode that changes how you think about ${topic}`,
        segments,
        guestName: isInterview ? guestName : null,
        guestQuestions: questions,
        showNotes: {
            description:  `In this episode, we cover ${topic} from every angle. Whether you're a beginner or advanced, you'll walk away with actionable insights.`,
            timestamps:   segments.map((s, i) => `[${_calcTime(i, segments)}] ${s.segment}`),
            resources:    ["[Resource 1 mentioned in episode]", "[Resource 2]", "[Guest website if applicable]"],
            cta:          "Subscribe, leave a review, and share with someone who needs to hear this."
        }
    };
}

function _calcTime(index, segments) {
    let totalMin = 0;
    for (let i = 0; i < index; i++) {
        const d = segments[i].duration;
        const n = parseInt(d.split("-")[0]) || 3;
        totalMin += n;
    }
    const m = Math.floor(totalMin);
    const s = 0;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

async function _groqPodcast(topic, format, guestName) {
    const prompt = `Create a complete podcast episode plan for "${topic}" (format: ${format}${guestName ? `, guest: ${guestName}` : ""}).
JSON: { "title": "...", "tagline": "...", "estimatedDuration": "...", "segments": [{ "segment": "name", "duration": "X min", "talkingPoints": ["point1"], "scriptOpener": "..." }], "showNotes": { "description": "...", "cta": "..." }${format === "interview" ? ', "guestQuestions": { "opening": [], "depth": [], "tactical": [], "rapid": [] }' : ""} }`;
    const raw = await groq.chat(SYSTEM, prompt, { maxTokens: 2000 });
    return groq.parseJson(raw);
}

async function generate({ topic, format = "solo", guestName = "" }) {
    if (!topic) throw new Error("topic required");
    try {
        const ai = await _groqPodcast(topic, format, guestName);
        return { topic, format, guestName: guestName || null, ...ai };
    } catch {
        return _buildEpisode(topic, format, guestName);
    }
}

async function run(task) {
    const p         = task.payload || {};
    const topic     = p.topic  || p.about || task.input || "";
    const format    = p.format || "solo";
    const guestName = p.guest  || p.guestName || "";

    if (!topic) return { success: false, type: "content", agent: "podcastGeneratorAgent", data: { error: "topic required" } };

    try {
        const data = await generate({ topic, format, guestName });
        return { success: true, type: "content", agent: "podcastGeneratorAgent", data };
    } catch (err) {
        return { success: false, type: "content", agent: "podcastGeneratorAgent", data: { error: err.message } };
    }
}

module.exports = { generate, run };
