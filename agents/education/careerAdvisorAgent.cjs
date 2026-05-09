/**
 * Career Advisor Agent — recommends career paths based on skills + market demand.
 * Reads from skillTrackerAgent to personalize recommendations.
 */

const groq = require("../core/groqClient.cjs");
const { uid, NOW, logToMemory, ok, fail } = require("./_eduStore.cjs");

const SYSTEM = `You are an expert career coach with deep knowledge of the job market.
Give practical, actionable career advice based on current industry demand.
Respond ONLY with valid JSON.`;

const CAREER_MAP = {
    javascript:  [{ role: "Frontend Developer", demand: "Very High", salary: "₹6-25 LPA", timeline: "3-6 months" }, { role: "Full Stack Developer", demand: "Very High", salary: "₹8-35 LPA", timeline: "6-12 months" }],
    python:      [{ role: "Data Analyst", demand: "High", salary: "₹5-20 LPA", timeline: "3-6 months" }, { role: "ML Engineer", demand: "Very High", salary: "₹12-50 LPA", timeline: "12-18 months" }],
    data:        [{ role: "Data Scientist", demand: "Very High", salary: "₹10-45 LPA", timeline: "12 months" }, { role: "Data Analyst", demand: "High", salary: "₹5-20 LPA", timeline: "6 months" }],
    marketing:   [{ role: "Digital Marketer", demand: "High", salary: "₹4-18 LPA", timeline: "3 months" }, { role: "Growth Hacker", demand: "High", salary: "₹6-25 LPA", timeline: "6 months" }],
    design:      [{ role: "UI/UX Designer", demand: "Very High", salary: "₹5-22 LPA", timeline: "6 months" }, { role: "Product Designer", demand: "High", salary: "₹8-30 LPA", timeline: "12 months" }],
    cloud:       [{ role: "Cloud Engineer", demand: "Very High", salary: "₹10-40 LPA", timeline: "6-12 months" }, { role: "DevOps Engineer", demand: "Very High", salary: "₹12-45 LPA", timeline: "12 months" }],
    finance:     [{ role: "Financial Analyst", demand: "Medium", salary: "₹5-20 LPA", timeline: "6 months" }, { role: "Investment Banker", demand: "Medium", salary: "₹12-50 LPA", timeline: "18 months" }],
    writing:     [{ role: "Content Writer", demand: "High", salary: "₹3-12 LPA", timeline: "1-2 months" }, { role: "Technical Writer", demand: "Medium", salary: "₹5-18 LPA", timeline: "3-6 months" }]
};

function _matchCareers(skills = [], interests = []) {
    const all     = [...skills, ...interests].map(s => s.toLowerCase());
    const matched = new Map();

    for (const [domain, careers] of Object.entries(CAREER_MAP)) {
        if (all.some(s => s.includes(domain) || domain.includes(s))) {
            for (const career of careers) {
                if (!matched.has(career.role)) matched.set(career.role, career);
            }
        }
    }
    return [...matched.values()];
}

async function advise({ userId = "", skills = [], interests = [], experience = 0, goal = "" }) {
    // Pull from skillTracker if userId provided
    let trackedSkills = skills;
    let weakAreas     = [];
    try {
        const report  = require("./skillTrackerAgent.cjs").getReport(userId);
        if (report.skills?.length) trackedSkills = report.skills.map(s => s.topic);
        weakAreas = report.weakAreas || [];
    } catch { /* no skill data */ }

    const allSkills  = [...new Set([...trackedSkills, ...skills])];
    const matched    = _matchCareers(allSkills, interests);

    let advice;
    try {
        const prompt = `Career advice for someone with skills: ${allSkills.join(", ")}.
Experience: ${experience} years. Goal: "${goal}". Interests: ${interests.join(", ")}.
JSON: {
  "topCareers": [{ "role": "...", "demand": "...", "salary": "...", "timeline": "...", "why": "...", "skills_needed": ["..."] }],
  "skillGaps": ["skill to add"],
  "actionPlan": ["step 1", "step 2", "step 3"],
  "marketInsight": "current market trend",
  "salaryNegotiationTip": "...",
  "networkingTip": "..."
}`;
        const raw = await groq.chat(SYSTEM, prompt, { maxTokens: 800 });
        advice    = groq.parseJson(raw);
    } catch { /* fallback */ }

    const result = {
        id:           uid("career"),
        userId,
        skills:       allSkills,
        interests,
        experience,
        goal,
        topCareers:   advice?.topCareers || matched.slice(0, 3),
        skillGaps:    advice?.skillGaps || weakAreas.slice(0, 5),
        actionPlan:   advice?.actionPlan || ["Build a portfolio", "Apply to 5 jobs this week", "Network on LinkedIn"],
        marketInsight: advice?.marketInsight || "AI and cloud skills are in highest demand in 2025",
        resources:    ["LinkedIn Jobs", "Naukri.com", "AngelList", "We Work Remotely"],
        createdAt:    NOW()
    };

    logToMemory("careerAdvisorAgent", goal || allSkills.join(","), { careers: result.topCareers?.length });
    return result;
}

async function run(task) {
    const p = task.payload || {};
    try {
        const data = await advise({ userId: p.userId || "", skills: p.skills || [], interests: p.interests || [], experience: p.experience || 0, goal: p.goal || task.input || "" });
        return ok("careerAdvisorAgent", data, data.actionPlan?.slice(0, 2) || ["Build your portfolio", "Apply for jobs"]);
    } catch (err) { return fail("careerAdvisorAgent", err.message); }
}

module.exports = { advise, run };
