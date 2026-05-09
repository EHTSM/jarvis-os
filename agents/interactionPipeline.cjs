/**
 * Interaction Pipeline — orchestrates the full input processing chain.
 * multilingual → intentDetection → emotionDetection → personalization
 */
const multilingual     = require("./interaction/multilingual.cjs");
const intentDetection  = require("./interaction/intentDetection.cjs");
const emotionDetection = require("./interaction/emotionDetection.cjs");
const personalization  = require("./interaction/personalization.cjs");

async function processInput(input, user = {}) {
    if (!input) return { text: "", intent: "question", emotion: "neutral", lang: "en", user };

    const langData    = await multilingual.process(input);
    const intentData  = intentDetection.detect(langData.text);
    const emotionData = emotionDetection.detect(langData.text);
    const enriched    = await personalization.apply({
        text:    langData.text,
        user:    { id: null, name: "User", ...user },
        intent:  intentData,
        emotion: emotionData
    });

    return {
        text:    enriched.text,
        intent:  intentData.intent,
        emotion: emotionData.emotion,
        lang:    langData.lang,
        user:    enriched.user,
        original: langData.original
    };
}

module.exports = { processInput };
