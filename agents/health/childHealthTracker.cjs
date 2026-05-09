"use strict";
const { load, flush, uid, NOW, ok, fail, escalate, accessLog } = require("./_healthStore.cjs");

const AGENT = "childHealthTracker";

// WHO vaccination schedule (India, simplified)
const VACCINATION_SCHEDULE = {
    "At birth":       ["BCG", "Hepatitis B (birth dose)", "OPV-0"],
    "6 weeks":        ["DTwP-1", "IPV-1", "Hib-1", "Hepatitis B-2", "Rotavirus-1", "PCV-1"],
    "10 weeks":       ["DTwP-2", "IPV-2", "Hib-2", "Rotavirus-2", "PCV-2"],
    "14 weeks":       ["DTwP-3", "IPV-3", "Hib-3", "Hepatitis B-3", "Rotavirus-3", "PCV-3"],
    "6 months":       ["OPV-1", "Influenza (yearly from 6m)"],
    "9 months":       ["MMR-1", "OPV-2"],
    "12 months":      ["Hepatitis A-1", "Chickenpox-1"],
    "15 months":      ["MMR-2", "DTwP booster-1", "IPV booster", "Hib booster", "PCV booster"],
    "18 months":      ["Hepatitis A-2", "Chickenpox-2"],
    "2 years":        ["OPV-3", "Typhoid"],
    "5 years":        ["DTwP booster-2", "OPV booster", "Typhoid booster"],
    "10-12 years":    ["Tdap", "HPV (girls, 2 doses)"],
    "15-18 years":    ["Tdap booster", "MMR-3 (if not given)"]
};

// WHO child growth milestones (simplified)
const MILESTONES = {
    "2 months":   ["Smiles at faces", "Coos and makes sounds", "Follows objects with eyes", "Holds head up briefly"],
    "4 months":   ["Laughs", "Holds head steady", "Reaches for toys", "Recognises familiar faces"],
    "6 months":   ["Sits with support", "Responds to own name", "Rolls over", "Starts solid foods"],
    "9 months":   ["Pulls to stand", "Says 'mama/dada'", "Crawls", "Picks up small objects (pincer grasp)"],
    "12 months":  ["First steps", "2-3 words", "Waves bye-bye", "Points to objects"],
    "18 months":  ["10-20 words", "Walks well", "Points to body parts", "Simple pretend play"],
    "2 years":    ["50+ words, 2-word phrases", "Runs", "Kicks ball", "Follows 2-step instructions"],
    "3 years":    ["3-4 word sentences", "Rides tricycle", "Dresses with help", "Imaginative play"],
    "5 years":    ["Full sentences", "Counts to 10", "Draws person with 6+ parts", "Hops on one foot"]
};

// High-risk child symptoms
const HIGH_RISK_CHILD = ["high fever infant under 3 months","seizure child","difficulty breathing child","rash with fever","stiff neck child","blue lips","not waking"];

function getVaccinationSchedule({ userId, childAgeMonths }) {
    if (!userId) return fail(AGENT, "userId required");
    accessLog(userId, AGENT, "vaccination_schedule_viewed");
    return ok(AGENT, {
        schedule:        VACCINATION_SCHEDULE,
        reminder:        "Always consult your paediatrician for personalised vaccination schedule. Schedules may vary.",
        catchUp:         "Missed vaccines can usually be given — consult your paediatrician for a catch-up schedule.",
        governmentScheme:"India's Universal Immunisation Programme (UIP) provides free vaccines at government health centres."
    });
}

function getMilestones({ userId, ageMonths }) {
    if (!userId || ageMonths === undefined) return fail(AGENT, "userId and ageMonths required");
    accessLog(userId, AGENT, "milestones_viewed");

    const ageYears = ageMonths / 12;
    const nearest  = Object.keys(MILESTONES).find(k => {
        const [num, unit] = k.split(" ");
        const months = unit.includes("year") ? Number(num) * 12 : Number(num);
        return ageMonths <= months;
    }) || "5 years";

    return ok(AGENT, {
        ageMonths,
        nearestMilestone: nearest,
        milestones:       MILESTONES[nearest] || [],
        allMilestones:    MILESTONES,
        note:             "Milestones vary widely between children. Consult your paediatrician if concerned about development.",
        redFlags:         ["Not making eye contact by 6 months", "No babbling by 12 months", "Losing previously acquired skills at any age — see doctor immediately"]
    });
}

function logChildHealth({ userId, childName, ageMonths, weight, height, symptoms = [], vaccinesGiven = [], notes = "" }) {
    if (!userId || !childName) return fail(AGENT, "userId and childName required");

    accessLog(userId, AGENT, "child_health_logged");

    const sympText = symptoms.join(" ").toLowerCase();
    if (HIGH_RISK_CHILD.some(s => sympText.includes(s.split(" ")[0]))) {
        return escalate(AGENT, "High-risk child symptom detected. Seek immediate paediatric emergency care.", "HIGH");
    }

    const entry = { id: uid("ch"), userId, childName, ageMonths, weight, height, symptoms, vaccinesGiven, notes, date: NOW().slice(0, 10), loggedAt: NOW() };
    const log   = load(userId, `child_log_${childName.replace(/\s/g,"_").slice(0,20)}`, []);
    log.push(entry);
    flush(userId, `child_log_${childName.replace(/\s/g,"_").slice(0,20)}`, log.slice(-1000));
    return ok(AGENT, { entry });
}

module.exports = { getVaccinationSchedule, getMilestones, logChildHealth };
