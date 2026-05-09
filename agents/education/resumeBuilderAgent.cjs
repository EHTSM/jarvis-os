/**
 * Resume Builder Agent — generates ATS-optimized resumes.
 * Reads skillTrackerAgent to auto-populate skills section.
 */

const groq = require("../core/groqClient.cjs");
const { load, flush, uid, NOW, logToMemory, ok, fail } = require("./_eduStore.cjs");

const SYSTEM = `You are an expert resume writer and ATS optimization specialist.
Create professional, keyword-rich resumes that pass ATS screening.
Respond ONLY with valid JSON.`;

const STORE = "resumes";

const ATS_KEYWORDS = {
    tech:      ["developed", "implemented", "architected", "optimized", "deployed", "integrated", "automated", "reduced", "improved", "scaled"],
    marketing: ["generated", "grew", "increased", "drove", "managed", "executed", "launched", "analyzed", "optimized", "led"],
    finance:   ["analyzed", "forecasted", "managed", "reduced", "increased", "monitored", "reported", "assessed", "evaluated", "coordinated"],
    general:   ["achieved", "delivered", "collaborated", "led", "managed", "created", "improved", "resolved", "supported", "coordinated"]
};

function _buildAtsScore(resume) {
    let score = 50;
    const text = JSON.stringify(resume).toLowerCase();

    // Check for ATS essentials
    if (resume.summary?.length >= 50)                                              score += 10;
    if (resume.experience?.length >= 2)                                            score += 10;
    if (resume.skills?.length >= 8)                                                score += 10;
    if (/\d+%|\d+x|\$[\d,]+|₹[\d,]+/.test(text))                                 score += 10; // quantified results
    if (resume.education?.length)                                                   score += 5;
    if (ATS_KEYWORDS.tech.some(k => text.includes(k)))                             score += 5;

    return Math.min(100, score);
}

async function build({ userId = "", name, email, phone, role, experience = [], education = [], skills = [], projects = [], certifications = [], linkedIn = "", github = "", summary = "" }) {
    if (!name || !role) throw new Error("name and role required");

    // Auto-pull skills from skillTracker
    let trackedSkills = [];
    try {
        const report  = require("./skillTrackerAgent.cjs").getReport(userId);
        trackedSkills = report.skills?.filter(s => s.avg >= 50).map(s => s.topic) || [];
    } catch { /* no skill data */ }

    const allSkills = [...new Set([...skills, ...trackedSkills])];

    let resume;
    try {
        const expStr = experience.map(e => `${e.title} at ${e.company} (${e.duration}): ${e.achievements?.join(", ")}`).join("; ");
        const prompt = `Create an ATS-optimized resume for ${name} applying for ${role}.
Experience: ${expStr || "to be generated"}. Skills: ${allSkills.join(", ")}.
JSON: {
  "summary": "3-4 sentence professional summary with keywords",
  "experience": [{ "title": "...", "company": "...", "duration": "...", "location": "...", "achievements": ["quantified achievement 1", "achievement 2"] }],
  "skills": { "technical": ["..."], "soft": ["..."], "tools": ["..."] },
  "education": [{ "degree": "...", "institution": "...", "year": "...", "gpa": "..." }],
  "atsKeywords": ["keyword 1", "keyword 2"],
  "coverLetterHook": "opening line for cover letter"
}`;
        const raw  = await groq.chat(SYSTEM, prompt, { maxTokens: 1200 });
        const ai   = groq.parseJson(raw);
        resume     = {
            summary:       ai.summary || summary,
            experience:    ai.experience || experience,
            skills:        ai.skills || { technical: allSkills, soft: [], tools: [] },
            education:     ai.education || education,
            atsKeywords:   ai.atsKeywords || ATS_KEYWORDS.tech.slice(0, 5),
            coverLetterHook: ai.coverLetterHook || `I am excited to apply for the ${role} position.`
        };
    } catch {
        resume = {
            summary:       summary || `Results-driven ${role} with expertise in ${allSkills.slice(0, 3).join(", ")}. Proven track record of delivering high-quality solutions. Strong problem-solving skills with a passion for continuous learning.`,
            experience,
            skills:        { technical: allSkills, soft: ["Communication", "Problem Solving", "Teamwork"], tools: [] },
            education,
            atsKeywords:   ATS_KEYWORDS.tech.slice(0, 5),
            coverLetterHook: `I am excited to apply for the ${role} position.`
        };
    }

    const doc = {
        id:       uid("resume"),
        userId,
        name,
        email:    email || "",
        phone:    phone || "",
        linkedIn: linkedIn || "",
        github:   github || "",
        role,
        ...resume,
        projects:       projects,
        certifications: certifications,
        atsScore:       _buildAtsScore({ ...resume, skills: allSkills }),
        format:         "JSON — render with puppeteer or jsPDF for PDF output",
        tips: [
            "Quantify every achievement with numbers (%, $, ×)",
            "Tailor keywords to the job description for each application",
            "Keep to 1 page for <5 years experience, 2 pages max for senior roles",
            "Use standard section headers — ATS parsers expect them"
        ],
        createdAt: NOW()
    };

    const all = load(STORE, []);
    all.push(doc);
    flush(STORE, all.slice(-50));
    logToMemory("resumeBuilderAgent", `${name}: ${role}`, { atsScore: doc.atsScore, skills: allSkills.length });
    return doc;
}

function getUserResumes(userId) { return load(STORE, []).filter(r => r.userId === userId); }

async function run(task) {
    const p = task.payload || {};
    try {
        let data;
        if (task.type === "user_resumes") {
            data = { resumes: getUserResumes(p.userId || "") };
        } else {
            data = await build({
                userId:         p.userId || "",
                name:           p.name || "Your Name",
                email:          p.email || "",
                phone:          p.phone || "",
                role:           p.role || p.position || task.input || "Software Developer",
                experience:     p.experience || [],
                education:      p.education || [],
                skills:         p.skills || [],
                projects:       p.projects || [],
                certifications: p.certifications || [],
                linkedIn:       p.linkedIn || "",
                github:         p.github || "",
                summary:        p.summary || ""
            });
        }
        return ok("resumeBuilderAgent", data, [`ATS Score: ${data.atsScore || 0}%`, "Tailor keywords for each job application"]);
    } catch (err) { return fail("resumeBuilderAgent", err.message); }
}

module.exports = { build, getUserResumes, run };
