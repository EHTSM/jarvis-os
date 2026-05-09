"use strict";
/**
 * Health Chat Support — general health Q&A with safety guards.
 * Crisis signals → immediate escalation. No clinical answers.
 */
const { load, flush, uid, NOW, ok, fail, escalate, accessLog, EMERGENCY_NUMBERS } = require("./_healthStore.cjs");

const AGENT = "healthChatSupport";

const CRISIS_KEYWORDS = ["suicidal","self harm","self-harm","want to die","kill myself","chest pain severe","can't breathe","stroke","unconscious","overdose on purpose"];

const FAQ_MAP = {
    "how much water":       "Adults generally need 8-10 glasses (2-2.5 litres) of water per day. This increases with exercise and hot weather.",
    "how much sleep":       "Adults need 7-9 hours of sleep per night. Teens need 8-10 hours. Children need more.",
    "bmi":                  "BMI = weight(kg) / height(m)². Normal: 18.5-24.9. Overweight: 25-29.9. Obese: 30+. Note: BMI has limitations for athletes and elderly.",
    "blood pressure normal":"Normal BP: below 120/80 mmHg. Elevated: 120-129/<80. Hypertension: ≥130/80 mmHg.",
    "normal heart rate":    "Resting heart rate: 60-100 bpm for adults. Athletes may be lower (40-60 bpm). Check in the morning before getting up.",
    "how to lose weight":   "Sustainable weight loss: 300-500 kcal/day deficit through diet + exercise. Aim for 0.5-1 kg per week. Avoid crash diets.",
    "vitamins":             "Most people get sufficient vitamins from a balanced diet. Vitamin D3 (especially in India), B12 (vegetarians/vegans), and Folic acid (pregnancy) are commonly needed.",
    "fasting":              "Intermittent fasting has evidence for metabolic health. Common forms: 16:8 or 5:2. Diabetics and pregnant women should consult a doctor first.",
    "paracetamol dose":     "Standard adult dose: 500-1000mg every 4-6 hours. Maximum: 4000mg/24h. Reduce to 2000mg/24h with alcohol use or liver issues.",
    "vaccine schedule":     "Refer to the National Immunisation Schedule (India). Adults should get: Flu vaccine annually, Td booster every 10 years, Hepatitis B if not immunised.",
    "when to see doctor":   "See a doctor if: symptoms persist >3 days, are severe, worsening, or unusual. Always for: chest pain, breathing difficulty, high fever in infants, or any sudden severe symptom.",
    "mental health help":   "Seeking help for mental health is a sign of strength. Contact iCall: 9152987821, or your GP for a referral to a psychiatrist/psychologist.",
    "ayurveda":             "Ayurveda is a traditional system with various herbal treatments. Some have evidence; others don't. Always tell your doctor about Ayurvedic supplements as some interact with medications.",
    "supplements":          "Most supplements are not regulated the same way as medications. Quality varies. Consult a doctor or dietitian before starting supplements.",
    "antibiotics":          "Antibiotics treat bacterial infections only — not viruses (like common cold or flu). Never take leftover antibiotics or someone else's prescription. Complete the full course."
};

function askQuestion({ userId, question }) {
    if (!userId)   return fail(AGENT, "userId required");
    if (!question) return fail(AGENT, "question required");

    accessLog(userId, AGENT, "question_asked");

    // Crisis check — non-negotiable
    if (CRISIS_KEYWORDS.some(k => question.toLowerCase().includes(k))) {
        return escalate(AGENT, "Crisis signal detected. Please reach out for immediate help.", "HIGH");
    }

    const lower   = question.toLowerCase();
    const matched = Object.entries(FAQ_MAP).find(([k]) => lower.includes(k));

    const log = load(userId, "chat_log", []);
    log.push({ id: uid("hc"), question: question.slice(0, 200), at: NOW() });
    flush(userId, "chat_log", log.slice(-1000));

    if (matched) {
        return ok(AGENT, {
            question,
            answer:     matched[1],
            confidence: "general_knowledge",
            note:       "This is general health information only. Consult a doctor for personalised advice."
        });
    }

    return ok(AGENT, {
        question,
        answer:    "I don't have a specific answer for that question in my database. For accurate health information, I recommend consulting a doctor or visiting trusted sources like WHO (who.int), MedlinePlus (medlineplus.gov), or AIIMS (aiims.edu).",
        resources: ["who.int","medlineplus.gov","icmr.gov.in","aiims.edu"],
        emergencyNumbers: EMERGENCY_NUMBERS,
        note:      "Never delay seeking medical care based on information from any AI or website."
    });
}

module.exports = { askQuestion };
