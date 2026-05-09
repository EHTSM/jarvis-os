/**
 * Flashcard Agent — generates spaced repetition flashcards (SM-2 algorithm compatible).
 */

const groq = require("../core/groqClient.cjs");
const { load, flush, uid, NOW, logToMemory, ok, fail } = require("./_eduStore.cjs");

const SYSTEM = `You are a flashcard expert who creates concise, memorable flashcards.
Front: A clear question or prompt. Back: A concise, memorable answer.
Respond ONLY with valid JSON.`;

const STORE = "flashcards";

// SM-2 simplified interval calculator
function _nextReview(easeFactor = 2.5, interval = 1, quality = 3) {
    // quality: 0-2 = fail, 3-5 = pass
    if (quality < 3) return { interval: 1, easeFactor: Math.max(1.3, easeFactor - 0.2) };
    const newEase = easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    const newInterval = interval === 1 ? 1 : interval === 2 ? 6 : Math.round(interval * easeFactor);
    const reviewDate  = new Date();
    reviewDate.setDate(reviewDate.getDate() + newInterval);
    return { interval: newInterval, easeFactor: Math.max(1.3, newEase), nextReview: reviewDate.toISOString() };
}

async function generate({ topic, count = 10, subject = "", userId = "", fromNotes = "" }) {
    if (!topic && !fromNotes) throw new Error("topic required");

    let cards = [];
    try {
        const source = fromNotes ? `Source notes: "${fromNotes.slice(0, 500)}"` : "";
        const prompt = `Create ${count} spaced repetition flashcards on "${topic || subject}". ${source}
JSON: { "flashcards": [{ "front": "Question/prompt", "back": "Concise answer", "hint": "...", "tags": ["tag1"], "difficulty": "easy|medium|hard" }] }`;
        const raw  = await groq.chat(SYSTEM, prompt, { maxTokens: 1000 });
        const ai   = groq.parseJson(raw);
        cards      = ai?.flashcards || [];
    } catch {
        cards = [
            { front: `What is ${topic}?`,                  back: `${topic} is a core concept in ${subject || "this field"}.`, difficulty: "easy" },
            { front: `When should you use ${topic}?`,       back: `Use ${topic} when you need to achieve a specific outcome.`, difficulty: "medium" },
            { front: `What is the main benefit of ${topic}?`, back: `The main benefit is efficiency and clarity in application.`, difficulty: "easy" },
            { front: `Name 3 key properties of ${topic}.`,  back: `1) Core property, 2) Secondary property, 3) Advanced property.`, difficulty: "hard" },
            { front: `Compare ${topic} with a related concept.`, back: `Unlike related concepts, ${topic} uniquely provides...`, difficulty: "hard" }
        ].slice(0, count);
    }

    const deckId  = uid("deck");
    const deck    = {
        id:        deckId,
        topic,
        subject:   subject || topic,
        userId,
        totalCards: cards.length,
        cards:     cards.map((c, i) => ({
            id:          uid("card"),
            deckId,
            ...c,
            easeFactor:  2.5,
            interval:    1,
            repetitions: 0,
            nextReview:  NOW(),
            lastReview:  null,
            createdAt:   NOW()
        })),
        createdAt: NOW()
    };

    const all = load(STORE, []);
    all.push(deck);
    flush(STORE, all.slice(-100));
    logToMemory("flashcardAgent", topic, { cards: cards.length });

    return deck;
}

function getDueCards(userId, limit = 20) {
    const now   = new Date();
    const decks = load(STORE, []).filter(d => d.userId === userId);
    const due   = [];
    for (const deck of decks) {
        for (const card of deck.cards || []) {
            if (new Date(card.nextReview) <= now) due.push({ ...card, deckTopic: deck.topic });
        }
    }
    return due.slice(0, limit);
}

function reviewCard(deckId, cardId, quality = 3) {
    const decks = load(STORE, []);
    const deck  = decks.find(d => d.id === deckId);
    if (!deck) throw new Error("Deck not found");
    const card  = deck.cards.find(c => c.id === cardId);
    if (!card) throw new Error("Card not found");

    const { interval, easeFactor, nextReview } = _nextReview(card.easeFactor, card.interval, quality);
    Object.assign(card, { easeFactor, interval, nextReview: nextReview || NOW(), lastReview: NOW(), repetitions: (card.repetitions || 0) + 1 });
    flush(STORE, decks);
    return { cardId, quality, interval, nextReview: card.nextReview };
}

async function run(task) {
    const p = task.payload || {};
    try {
        let data;
        if (task.type === "review_card") {
            data = reviewCard(p.deckId, p.cardId, p.quality || 3);
        } else if (task.type === "due_cards") {
            data = { cards: getDueCards(p.userId || "", p.limit || 20) };
        } else {
            data = await generate({ topic: p.topic || p.subject || task.input || "", count: p.count || 10, subject: p.subject || "", userId: p.userId || "", fromNotes: p.notes || "" });
        }
        return ok("flashcardAgent", data, ["Review due cards daily for best retention", "Aim for quality 4+ ratings to build long intervals"]);
    } catch (err) { return fail("flashcardAgent", err.message); }
}

module.exports = { generate, getDueCards, reviewCard, run };
