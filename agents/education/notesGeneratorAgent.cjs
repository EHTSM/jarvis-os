/**
 * Notes Generator Agent — converts lessons, topics, or raw text into structured study notes.
 */

const groq = require("../core/groqClient.cjs");
const { load, flush, uid, NOW, logToMemory, saveToKnowledge, ok, fail } = require("./_eduStore.cjs");

const SYSTEM = `You are an expert note-taker. Create clear, concise, exam-ready study notes.
Use structured format with headings, bullet points, and key terms highlighted.
Respond ONLY with valid JSON.`;

const STORE = "notes";

const NOTE_STYLES = {
    cornell:    "Two-column format: main notes on right, cues on left, summary at bottom",
    outline:    "Hierarchical outline with main topics and sub-points",
    mindmap:    "Central topic branching out to key concepts and sub-concepts",
    bullet:     "Clean bullet-point format with key terms bolded",
    flashcard:  "Q&A pairs suitable for self-testing"
};

async function generate({ topic, content = "", style = "bullet", subject = "", userId = "" }) {
    if (!topic && !content) throw new Error("topic or content required");
    const subject_ = subject || topic;

    let notes;
    try {
        const prompt = `Create ${style}-style study notes on "${topic || subject_}".
${content ? `Source content: "${content.slice(0, 600)}"` : ""}
JSON: {
  "title": "...",
  "subject": "...",
  "keyPoints": ["point 1", "point 2"],
  "sections": [{ "heading": "...", "content": "...", "keyTerms": ["term: definition"] }],
  "summary": "...",
  "mnemonics": ["helpful memory trick"],
  "examTips": ["likely exam question 1", "likely exam question 2"],
  "furtherReading": ["resource 1", "resource 2"]
}`;
        const raw  = await groq.chat(SYSTEM, prompt, { maxTokens: 900 });
        notes      = groq.parseJson(raw);
    } catch {
        notes = {
            title:   `${topic} — Study Notes`,
            subject: subject_,
            keyPoints: [`Core concept of ${topic}`, `Applications of ${topic}`, `Common patterns in ${topic}`],
            sections: [
                { heading: "Introduction", content: `${topic} is a fundamental concept in ${subject_ || "this field"}. Understanding it requires grasping the core principles.`, keyTerms: [`${topic}: core definition`] },
                { heading: "Key Concepts", content: `The main concepts include: 1) Foundational principles, 2) Practical applications, 3) Common patterns.`, keyTerms: [] },
                { heading: "Examples & Applications", content: `Real-world applications of ${topic} demonstrate its importance in modern practice.`, keyTerms: [] }
            ],
            summary:        `${topic} involves understanding core concepts and their practical applications. Master the fundamentals before advancing.`,
            mnemonics:      [`Remember ${topic} with: ${topic.split(" ").map(w => w[0]).join("")}...`],
            examTips:       [`Explain the purpose of ${topic}`, `Compare ${topic} with related concepts`],
            furtherReading: [`${topic} documentation`, `${topic} practice problems`]
        };
    }

    const note = {
        id:      uid("note"),
        topic,
        subject: subject_,
        style,
        userId,
        ...notes,
        wordCount: JSON.stringify(notes).split(" ").length,
        createdAt: NOW()
    };

    const all = load(STORE, []);
    all.push(note);
    flush(STORE, all.slice(-200));
    logToMemory("notesGeneratorAgent", topic, { subject: subject_, style, sections: notes.sections?.length });
    saveToKnowledge(`notes:${topic}`, note.summary || "", "education");

    return note;
}

function getUserNotes(userId) { return load(STORE, []).filter(n => n.userId === userId); }

async function run(task) {
    const p = task.payload || {};
    try {
        const data = await generate({
            topic:   p.topic || p.subject || task.input || "",
            content: p.content || p.text || "",
            style:   p.style || "bullet",
            subject: p.subject || "",
            userId:  p.userId || ""
        });
        return ok("notesGeneratorAgent", data, ["Create flashcards from these notes", "Take a quiz on this topic"]);
    } catch (err) { return fail("notesGeneratorAgent", err.message); }
}

module.exports = { generate, getUserNotes, NOTE_STYLES, run };
