/**
 * Course Generator Agent — builds full structured courses with modules, lessons, and outcomes.
 */

const groq = require("../core/groqClient.cjs");
const { load, flush, uid, NOW, logToMemory, ok, fail } = require("./_eduStore.cjs");

const SYSTEM = `You are an expert curriculum designer. Create comprehensive, structured courses.
Respond ONLY with valid JSON.`;

const STORE = "courses";

const LEVEL_CONFIG = {
    beginner:     { modules: 4, lessonsPerModule: 3, prereqs: "None" },
    intermediate: { modules: 6, lessonsPerModule: 4, prereqs: "Basic familiarity" },
    advanced:     { modules: 8, lessonsPerModule: 5, prereqs: "Solid foundation required" }
};

function _buildTemplate(topic, level, niche) {
    const cfg    = LEVEL_CONFIG[level] || LEVEL_CONFIG.beginner;
    const modules = Array.from({ length: cfg.modules }, (_, i) => ({
        module:   i + 1,
        title:    `Module ${i + 1}: ${i === 0 ? `Introduction to ${topic}` : i === cfg.modules - 1 ? `Advanced ${topic} & Next Steps` : `${topic} — Part ${i + 1}`}`,
        duration: "1 week",
        lessons:  Array.from({ length: cfg.lessonsPerModule }, (_, j) => ({
            lesson:    j + 1,
            title:     `Lesson ${j + 1}`,
            type:      ["video", "reading", "exercise"][j % 3],
            duration:  "30 min",
            objective: `Understand and apply core concept ${j + 1} of ${topic}`
        })),
        quiz:     { title: `Module ${i + 1} Quiz`, questions: 10 }
    }));

    return {
        id:           uid("course"),
        title:        `Complete ${topic} Course`,
        topic,
        niche:        niche || topic,
        level,
        duration:     `${cfg.modules} weeks`,
        totalLessons: cfg.modules * cfg.lessonsPerModule,
        prerequisites: cfg.prereqs,
        outcomes: [
            `Master the fundamentals of ${topic}`,
            `Build real-world projects using ${topic}`,
            `Pass certifications related to ${topic}`,
            `Advance your career with ${topic} skills`
        ],
        modules,
        createdAt: NOW()
    };
}

async function generate({ topic, level = "beginner", niche = "", userId = "" }) {
    if (!topic) throw new Error("topic required");

    let course = _buildTemplate(topic, level, niche);

    try {
        const prompt = `Design a ${level} course on "${topic}" for ${niche || "general learners"}.
JSON: {
  "title": "...",
  "tagline": "...",
  "outcomes": ["..."],
  "modules": [{ "module": 1, "title": "...", "description": "...", "keySkills": ["..."], "lessons": [{ "lesson": 1, "title": "...", "type": "video|reading|exercise", "duration": "...", "objective": "..." }], "quiz": { "title": "...", "questions": 10 } }],
  "prerequisites": "...",
  "targetAudience": "...",
  "certificationPath": "..."
}`;
        const raw = await groq.chat(SYSTEM, prompt, { maxTokens: 1200 });
        const ai  = groq.parseJson(raw);
        course    = { ...course, ...ai, id: course.id, createdAt: course.createdAt, userId };
    } catch { course.userId = userId; }

    const all = load(STORE, []);
    all.push(course);
    flush(STORE, all.slice(-100));
    logToMemory("courseGeneratorAgent", topic, { title: course.title, modules: course.modules?.length });

    return course;
}

function list()        { return load(STORE, []); }
function get(id)       { return load(STORE, []).find(c => c.id === id) || null; }

async function run(task) {
    const p = task.payload || {};
    try {
        let data;
        if (task.type === "list_courses") { data = { courses: list() }; }
        else if (task.type === "get_course") { data = get(p.id) || { error: "Not found" }; }
        else { data = await generate({ topic: p.topic || p.subject || task.input || "General Knowledge", level: p.level || "beginner", niche: p.niche || "", userId: p.userId || "" }); }
        return ok("courseGeneratorAgent", data, [`Start lesson 1 of your ${data.title || "course"}`, "Generate a quiz to test this module"]);
    } catch (err) { return fail("courseGeneratorAgent", err.message); }
}

module.exports = { generate, list, get, run };
