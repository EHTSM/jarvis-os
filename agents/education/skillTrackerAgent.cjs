/**
 * Skill Tracker Agent — tracks progress, scores, and weak areas per user.
 * Central data hub for careerAdvisor and interviewCoach.
 * Feeds into memoryAgent automatically.
 */

const { load, flush, uid, NOW, logToMemory, ok, fail } = require("./_eduStore.cjs");

const STORE = "skill-profiles";

const SKILL_LEVELS = [
    { label: "Novice",       minScore: 0,   color: "grey"   },
    { label: "Beginner",     minScore: 20,  color: "red"    },
    { label: "Intermediate", minScore: 40,  color: "yellow" },
    { label: "Proficient",   minScore: 65,  color: "blue"   },
    { label: "Advanced",     minScore: 80,  color: "green"  },
    { label: "Expert",       minScore: 95,  color: "gold"   }
];

function _level(score) {
    let level = SKILL_LEVELS[0];
    for (const l of SKILL_LEVELS) { if (score >= l.minScore) level = l; }
    return level;
}

function _getProfile(userId) {
    return load(STORE, []).find(p => p.userId === userId) || null;
}

function _saveProfile(profile) {
    const all = load(STORE, []);
    const idx = all.findIndex(p => p.userId === profile.userId);
    if (idx >= 0) all[idx] = profile;
    else all.push(profile);
    flush(STORE, all);
    return profile;
}

function getOrCreate(userId) {
    return _getProfile(userId) || {
        id:          uid("skill"),
        userId,
        skills:      {},   // topic → { scores: [], avg: 0, level: {}, activities: [] }
        totalScore:  0,
        studyStreak: 0,
        lastStudied: null,
        badges:      [],
        weakAreas:   [],
        strongAreas: [],
        createdAt:   NOW(),
        updatedAt:   NOW()
    };
}

function recordActivity({ userId, topic, score, type = "quiz" }) {
    if (!userId || !topic || score === undefined) return null;
    const profile = getOrCreate(userId);

    if (!profile.skills[topic]) {
        profile.skills[topic] = { scores: [], avg: 0, level: _level(0), activities: [], firstStudied: NOW() };
    }

    const skill = profile.skills[topic];
    skill.scores.push({ score, type, date: NOW() });
    if (skill.scores.length > 50) skill.scores.shift();

    skill.avg   = Math.round(skill.scores.reduce((s, e) => s + e.score, 0) / skill.scores.length);
    skill.level = _level(skill.avg);
    skill.activities.push({ type, score, date: NOW() });

    // Update streak
    const today      = new Date().toDateString();
    const lastStudied = profile.lastStudied ? new Date(profile.lastStudied).toDateString() : null;
    if (lastStudied !== today) {
        const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
        profile.studyStreak = lastStudied === yesterday.toDateString() ? profile.studyStreak + 1 : 1;
    }
    profile.lastStudied = NOW();

    // Classify weak/strong
    profile.weakAreas   = Object.entries(profile.skills).filter(([, v]) => v.avg < 50).map(([k]) => k);
    profile.strongAreas = Object.entries(profile.skills).filter(([, v]) => v.avg >= 75).map(([k]) => k);

    // Badge awards
    if (profile.studyStreak >= 7  && !profile.badges.includes("7-Day Streak"))   profile.badges.push("7-Day Streak 🔥");
    if (profile.studyStreak >= 30 && !profile.badges.includes("30-Day Streak"))  profile.badges.push("30-Day Streak 💎");
    if (Object.keys(profile.skills).length >= 5 && !profile.badges.includes("Multi-Skilled")) profile.badges.push("Multi-Skilled 🎯");

    profile.updatedAt = NOW();
    logToMemory("skillTrackerAgent", `${userId}:${topic}`, { score, level: skill.level.label });
    return _saveProfile(profile);
}

function getReport(userId) {
    const profile = _getProfile(userId);
    if (!profile) return { userId, message: "No activity recorded yet", skills: {} };

    const skills = Object.entries(profile.skills).map(([topic, data]) => ({
        topic,
        avg:   data.avg,
        level: data.level.label,
        sessions: data.scores.length,
        trend: data.scores.length >= 2 ? (data.scores.at(-1).score > data.scores.at(-2).score ? "improving" : "declining") : "new"
    }));

    return {
        userId,
        studyStreak:  profile.studyStreak,
        totalTopics:  skills.length,
        strongAreas:  profile.strongAreas,
        weakAreas:    profile.weakAreas,
        badges:       profile.badges,
        skills:       skills.sort((a, b) => b.avg - a.avg),
        overallLevel: _level(skills.length ? Math.round(skills.reduce((s, sk) => s + sk.avg, 0) / skills.length) : 0).label,
        recommendations: [
            ...profile.weakAreas.map(a => `Practice more on: ${a}`),
            profile.studyStreak < 7 ? "Build a 7-day study streak" : "Maintain your streak!"
        ].slice(0, 5),
        lastStudied: profile.lastStudied
    };
}

async function run(task) {
    const p = task.payload || {};
    try {
        let data;
        if (task.type === "record_activity") {
            data = recordActivity({ userId: p.userId, topic: p.topic, score: p.score, type: p.type || "quiz" });
        } else if (task.type === "skill_profile") {
            data = getOrCreate(p.userId || "default");
        } else {
            data = getReport(p.userId || "default");
        }
        return ok("skillTrackerAgent", data, ["Work on weak areas", "Keep your study streak going"]);
    } catch (err) { return fail("skillTrackerAgent", err.message); }
}

module.exports = { recordActivity, getReport, getOrCreate, run };
