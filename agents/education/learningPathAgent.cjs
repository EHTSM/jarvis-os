/**
 * Learning Path Agent — CENTRAL BRAIN of the education layer.
 * Builds personalized roadmaps. Orchestrates courseGenerator + lessonPlanner + skillTracker.
 */

const groq = require("../core/groqClient.cjs");
const { load, flush, uid, NOW, logToMemory, ok, fail } = require("./_eduStore.cjs");

const SYSTEM = `You are an expert learning architect. Create precise, achievable learning paths.
Respond ONLY with valid JSON.`;

const STORE = "learning-paths";

const GOAL_TEMPLATES = {
    job:   { phases: ["Foundation", "Core Skills", "Projects", "Portfolio", "Job Hunt"], duration: "3-6 months" },
    exam:  { phases: ["Syllabus Mastery", "Practice", "Mock Tests", "Weak Areas", "Final Revision"], duration: "2-4 months" },
    skill: { phases: ["Basics", "Intermediate", "Advanced", "Real Projects", "Expert Level"], duration: "1-3 months" },
    hobby: { phases: ["Introduction", "Core Concepts", "Practice", "Creative Projects"], duration: "4-8 weeks" }
};

async function build({ goal, topic, currentLevel = "beginner", availableHours = 2, userId = "" }) {
    if (!goal && !topic) throw new Error("goal or topic required");
    const subject   = topic || goal;
    const goalType  = /job|career|hire|placement/.test(goal?.toLowerCase() || "") ? "job"
                    : /exam|test|certification/.test(goal?.toLowerCase() || "") ? "exam"
                    : /skill|learn|master/.test(goal?.toLowerCase() || "") ? "skill" : "skill";
    const template  = GOAL_TEMPLATES[goalType];

    // Get skill data if available
    let currentSkills = {};
    try { currentSkills = require("./skillTrackerAgent.cjs").getReport(userId); } catch { /* no data */ }

    let path;
    try {
        const prompt = `Build a ${goalType} learning path for "${goal || topic}".
Current level: ${currentLevel}. Available: ${availableHours}h/day.
${currentSkills.weakAreas?.length ? `Weak areas to address: ${currentSkills.weakAreas.join(", ")}` : ""}
JSON: {
  "title": "...",
  "totalDuration": "...",
  "phases": [{ "phase": N, "name": "...", "duration": "...", "topics": ["..."], "resources": ["..."], "milestone": "...", "project": "..." }],
  "prerequisites": ["..."],
  "tools": ["..."],
  "jobOutcomes": ["..."],
  "dailySchedule": "..."
}`;
        const raw = await groq.chat(SYSTEM, prompt, { maxTokens: 1200 });
        path      = groq.parseJson(raw);
    } catch { /* template fallback */ }

    const phases = path?.phases || template.phases.map((name, i) => ({
        phase:     i + 1,
        name,
        duration:  `${Math.ceil(parseInt(template.duration) / template.phases.length)} weeks`,
        topics:    [`${subject} — ${name} topics`],
        resources: [`${subject} ${name} guide`, `Practice exercises`],
        milestone: `Complete ${name} of ${subject}`,
        project:   i >= 2 ? `Build a ${name}-level ${subject} project` : null
    }));

    const learning_path = {
        id:            uid("lp"),
        userId,
        goal,
        topic:         subject,
        goalType,
        currentLevel,
        availableHours,
        totalDuration: path?.totalDuration || template.duration,
        phases,
        prerequisites: path?.prerequisites || [`${subject} basics`],
        tools:         path?.tools || [`${subject} IDE/tools`],
        jobOutcomes:   path?.jobOutcomes || [`${subject} Developer`, `${subject} Specialist`],
        nextAction:    `Start Phase 1: ${phases[0]?.name}`,
        createdAt:     NOW()
    };

    // Trigger course generation for main topic
    try {
        const courseGen = require("./courseGeneratorAgent.cjs");
        const course    = await courseGen.generate({ topic: subject, level: currentLevel, userId });
        learning_path.courseId = course.id;
    } catch { /* non-critical */ }

    // Trigger lesson plan
    try {
        const planner = require("./lessonPlannerAgent.cjs");
        const plan    = await planner.create({ goal, topic: subject, availableHoursPerDay: availableHours, userId });
        learning_path.lessonPlanId = plan.id;
    } catch { /* non-critical */ }

    const all = load(STORE, []);
    all.push(learning_path);
    flush(STORE, all.slice(-50));
    logToMemory("learningPathAgent", goal || topic, { goalType, phases: phases.length, duration: learning_path.totalDuration });

    return learning_path;
}

function getUserPaths(userId) { return load(STORE, []).filter(p => p.userId === userId); }

async function run(task) {
    const p = task.payload || {};
    try {
        let data;
        if (task.type === "user_paths") {
            data = { paths: getUserPaths(p.userId || "") };
        } else {
            data = await build({ goal: p.goal || task.input || "", topic: p.topic || p.subject || "", currentLevel: p.level || "beginner", availableHours: p.hours || 2, userId: p.userId || "" });
        }
        return ok("learningPathAgent", data, [`Start: ${data.nextAction || "Phase 1"}`, "Generate quiz for first topic"]);
    } catch (err) { return fail("learningPathAgent", err.message); }
}

module.exports = { build, getUserPaths, run };
