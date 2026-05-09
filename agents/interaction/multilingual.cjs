/**
 * Multilingual — detect language, translate to English for processing,
 * and translate response back to original language.
 */
const axios = require("axios");

// Script-based language detection (fast, no API)
const SCRIPT_PATTERNS = {
    hi:  /[ऀ-ॿ]/,           // Devanagari  (Hindi)
    ar:  /[؀-ۿ]/,           // Arabic / Urdu
    zh:  /[一-鿿]/,           // Chinese
    ja:  /[぀-ゟ゠-ヿ]/, // Japanese
    ko:  /[가-힯]/,           // Korean
    ru:  /[Ѐ-ӿ]/,           // Cyrillic
};

// Common romanized Hindi/Urdu words (Hinglish)
const HINGLISH_WORDS = [
    "kya", "hai", "mujhe", "karo", "bata", "yahan", "wahan",
    "aur", "nahi", "haan", "matlab", "theek", "zaroor", "bilkul",
    "achha", "suno", "batao", "chahiye", "karein", "dijiye"
];

const LANG_NAMES = {
    hi: "Hindi", ar: "Arabic", zh: "Chinese",
    ja: "Japanese", ko: "Korean", ru: "Russian"
};

function detectLang(text) {
    for (const [lang, pattern] of Object.entries(SCRIPT_PATTERNS)) {
        if (pattern.test(text)) return lang;
    }
    const lower = text.toLowerCase();
    if (HINGLISH_WORDS.some(w => lower.includes(` ${w} `) || lower.startsWith(w + " "))) {
        return "hi-roman"; // Hinglish — process as English
    }
    return "en";
}

async function _callGroq(systemPrompt, userText) {
    if (!process.env.GROQ_API_KEY) return userText;
    try {
        const res = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "llama-3.3-70b-versatile",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user",   content: userText }
                ],
                temperature: 0.1,
                max_tokens: 500
            },
            {
                headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
                timeout: 8000
            }
        );
        return res.data.choices[0].message.content.trim();
    } catch {
        return userText; // fallback: original text
    }
}

async function translateToEnglish(text, fromLang) {
    // These are already English or Roman-script English
    if (["en", "hi-roman"].includes(fromLang)) return text;
    const langName = LANG_NAMES[fromLang] || fromLang;
    return _callGroq(
        `Translate the following ${langName} text to English. Return ONLY the translation, no explanation.`,
        text
    );
}

async function translateBack(text, toLang) {
    if (!toLang || ["en", "hi-roman"].includes(toLang)) return text;
    const langName = LANG_NAMES[toLang] || toLang;
    return _callGroq(
        `Translate the following English text to ${langName}. Return ONLY the translation, no explanation.`,
        text
    );
}

async function process(text) {
    const lang       = detectLang(text);
    const translated = await translateToEnglish(text, lang);
    return { text: translated, lang, original: text };
}

module.exports = { process, translateToEnglish, translateBack, detectLang };
