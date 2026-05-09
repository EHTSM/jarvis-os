/**
 * Language Tutor Agent — grammar correction, translation, vocabulary, speaking exercises.
 * Supports: English, Hindi, Spanish, French, German, Japanese, Arabic, and more.
 */

const groq = require("../core/groqClient.cjs");
const { uid, NOW, logToMemory, ok, fail } = require("./_eduStore.cjs");

const SYSTEM = `You are a patient, encouraging language tutor. Correct errors kindly, explain rules clearly.
Always provide examples in context. Respond ONLY with valid JSON.`;

const SUPPORTED_LANGUAGES = ["English", "Hindi", "Spanish", "French", "German", "Japanese", "Arabic", "Mandarin", "Portuguese", "Russian"];

const EXERCISE_TYPES = {
    grammar:       "Identify and correct grammatical errors",
    vocabulary:    "Learn new words with usage examples",
    translation:   "Translate sentences between languages",
    speaking:      "Speaking practice prompts and pronunciation tips",
    reading:       "Comprehension passages with questions",
    writing:       "Structured writing exercises",
    conversation:  "Guided conversation scenarios"
};

async function teach({ input, exerciseType = "grammar", targetLanguage = "English", nativeLanguage = "English", level = "beginner", userId = "" }) {
    if (!input) throw new Error("input required");

    let result;
    try {
        const prompt = `Language teaching task — ${exerciseType} for ${level} ${targetLanguage} learner (native: ${nativeLanguage}).
Input: "${input}"
JSON: {
  "correction": "corrected version if any errors",
  "errors": [{ "original": "...", "corrected": "...", "rule": "...", "explanation": "..." }],
  "vocabularyHighlights": [{ "word": "...", "meaning": "...", "example": "...", "difficulty": "easy|medium|hard" }],
  "translation": "if applicable",
  "grammarTip": "one focused grammar rule",
  "speakingPrompt": "a follow-up speaking practice prompt",
  "nextExercise": "what to practice next",
  "encouragement": "brief positive feedback"
}`;
        const raw = await groq.chat(SYSTEM, prompt, { maxTokens: 700 });
        result    = groq.parseJson(raw);
    } catch {
        result = {
            correction:          input,
            errors:              [],
            vocabularyHighlights: [{ word: input.split(" ")[0], meaning: "Practice this word in a sentence", example: `I use ${input.split(" ")[0]} every day.`, difficulty: "easy" }],
            grammarTip:          `Focus on subject-verb agreement in ${targetLanguage}`,
            speakingPrompt:      `Try saying this in a full sentence: "${input}"`,
            nextExercise:        "Practice 5 sentences using today's vocabulary",
            encouragement:       "Great effort! Keep practicing every day 🌟"
        };
    }

    const lesson = { id: uid("lang"), userId, exerciseType, targetLanguage, nativeLanguage, level, input, ...result, taughtAt: NOW() };
    logToMemory("languageTutorAgent", `${targetLanguage}: ${input.slice(0, 50)}`, { exerciseType, level });
    return lesson;
}

async function getDailyLesson({ targetLanguage = "English", level = "beginner", userId = "" }) {
    const topics = {
        beginner:     ["Greetings", "Numbers", "Colors", "Days of the week", "Basic verbs"],
        intermediate: ["Tenses", "Prepositions", "Conjunctions", "Common idioms", "Question formation"],
        advanced:     ["Subjunctive mood", "Complex sentences", "Business vocabulary", "Nuanced expressions", "Writing style"]
    };
    const dailyTopics = topics[level] || topics.beginner;
    const topic       = dailyTopics[new Date().getDay() % dailyTopics.length];

    return teach({ input: `Teach me about: ${topic}`, exerciseType: "vocabulary", targetLanguage, level, userId });
}

async function run(task) {
    const p = task.payload || {};
    try {
        let data;
        if (task.type === "daily_lesson") {
            data = await getDailyLesson({ targetLanguage: p.language || "English", level: p.level || "beginner", userId: p.userId || "" });
        } else {
            data = await teach({ input: p.text || p.sentence || task.input || "", exerciseType: p.type || p.exercise || "grammar", targetLanguage: p.language || "English", nativeLanguage: p.nativeLanguage || "English", level: p.level || "beginner", userId: p.userId || "" });
        }
        return ok("languageTutorAgent", data, [data.nextExercise || "Practice daily", data.speakingPrompt || "Try speaking it aloud"]);
    } catch (err) { return fail("languageTutorAgent", err.message); }
}

module.exports = { teach, getDailyLesson, SUPPORTED_LANGUAGES, EXERCISE_TYPES, run };
