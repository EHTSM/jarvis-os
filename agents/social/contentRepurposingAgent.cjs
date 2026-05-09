/**
 * Content Repurposing Agent — converts long-form content into platform-specific formats.
 * Blog → Tweets, Reels, LinkedIn posts, Carousels, Email.
 * Does NOT duplicate caption/hashtag agents — calls them for enhancement.
 */

const groq = require("../core/groqClient.cjs");
const { uid, NOW } = require("./_socialStore.cjs");

const SYSTEM = `You are a content repurposing strategist. Transform long-form content into viral short-form assets.
Respond ONLY with valid JSON.`;

const REPURPOSE_MAP = {
    twitter_thread: {
        from:    "blog/video/article",
        format:  "5-10 tweet thread",
        rule:    "1 idea per tweet. Tweet 1 = hook. Last tweet = CTA. 280 chars max each.",
        maxTweets: 10
    },
    instagram_carousel: {
        from:    "blog/listicle",
        format:  "10-slide carousel",
        rule:    "Slide 1 = hook title. Slides 2-9 = 1 tip each. Slide 10 = CTA.",
        slides:  10
    },
    instagram_reel: {
        from:    "any",
        format:  "60-90 second reel script",
        rule:    "3-second hook. Problem. Solution. Proof. CTA. No intro/outro padding."
    },
    linkedin_post: {
        from:    "blog/case study",
        format:  "1500-char LinkedIn post",
        rule:    "Hook line. 2-line gap. 3 bullet insights. Story. CTA."
    },
    email_newsletter: {
        from:    "blog/video",
        format:  "200-word email",
        rule:    "Subject line. Problem. 3 key insights. Single CTA link."
    },
    youtube_short: {
        from:    "any",
        format:  "60-second YouTube Short script",
        rule:    "Hook in 3 sec. Deliver value in 50 sec. CTA in last 7 sec."
    },
    tiktok: {
        from:    "any",
        format:  "15-30 second TikTok concept",
        rule:    "Pattern interrupt opening. Fast pacing. On-screen text matches voice."
    }
};

function _buildThread(content, numTweets = 7) {
    const words   = content.split(" ").filter(Boolean);
    const chunkSz = Math.ceil(words.length / numTweets);
    return Array.from({ length: numTweets }, (_, i) => {
        if (i === 0) return `🧵 ${words.slice(0, 15).join(" ")}...\n\nA thread:`;
        if (i === numTweets - 1) return `That's a wrap! If this helped:\n→ RT the first tweet\n→ Follow for more\n→ Reply with your thoughts 👇`;
        return words.slice(i * chunkSz, (i + 1) * chunkSz).join(" ");
    });
}

function _buildCarousel(content, slides = 8) {
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 20);
    const result    = [{ slide: 1, text: `💡 ${sentences[0]?.trim() || "Key Insight"}` }];
    for (let i = 1; i < slides - 1; i++) {
        result.push({ slide: i + 1, text: sentences[i]?.trim() || `Point ${i}` });
    }
    result.push({ slide: slides, text: "Follow for more content like this 👆\nSave for later 📌" });
    return result;
}

async function repurpose({ content, targetFormat = "twitter_thread", title = "", platform = "" }) {
    if (!content) throw new Error("content required");
    const fmt  = REPURPOSE_MAP[targetFormat] || REPURPOSE_MAP.twitter_thread;
    let result;

    // Template-based fast path
    if (targetFormat === "twitter_thread") {
        result = { tweets: _buildThread(content, 7), charCounts: _buildThread(content, 7).map(t => t.length) };
    } else if (targetFormat === "instagram_carousel") {
        result = { slides: _buildCarousel(content, 8) };
    } else {
        result = { draft: content.slice(0, 300) + "..." };
    }

    // Groq enhancement
    try {
        const prompt = `Repurpose this content for ${targetFormat}. Original: "${content.slice(0, 400)}".
Rule: ${fmt.rule}.
JSON: { "output": [...], "hook": "...", "cta": "...", "tips": ["..."] }`;
        const raw  = await groq.chat(SYSTEM, prompt, { maxTokens: 700 });
        const ai   = groq.parseJson(raw);
        result = { ...result, aiVersion: ai };
    } catch { /* template only */ }

    return {
        id:       uid("rep"),
        title:    title || content.slice(0, 40),
        from:     fmt.from,
        targetFormat,
        format:   fmt.format,
        result,
        createdAt: NOW()
    };
}

async function repurposeAll(content, formats = ["twitter_thread", "instagram_carousel", "linkedin_post"]) {
    const results = [];
    for (const fmt of formats) {
        try { results.push(await repurpose({ content, targetFormat: fmt })); }
        catch (err) { results.push({ targetFormat: fmt, error: err.message }); }
    }
    return { repurposed: results.length, results };
}

async function run(task) {
    const p = task.payload || {};
    try {
        let data;
        if (task.type === "repurpose_all") {
            data = await repurposeAll(p.content || "", p.formats || ["twitter_thread", "instagram_carousel", "linkedin_post"]);
        } else {
            data = await repurpose({ content: p.content || p.text || "", targetFormat: p.format || p.targetFormat || "twitter_thread", title: p.title || "" });
        }
        return { success: true, type: "social", agent: "contentRepurposingAgent", data };
    } catch (err) {
        return { success: false, type: "social", agent: "contentRepurposingAgent", data: { error: err.message } };
    }
}

module.exports = { repurpose, repurposeAll, REPURPOSE_MAP, run };
