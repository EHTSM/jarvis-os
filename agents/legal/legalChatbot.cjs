"use strict";
const { load, flush, uid, NOW, auditLog, ok, fail, DISCLAIMER } = require("./_legalStore.cjs");
const AGENT = "legalChatbot";

const FAQ_MAP = [
    { q:["what is an fir","file fir","how to file fir"], a:"An FIR (First Information Report) is filed at the nearest police station where the offence occurred. You can file it in person, by post, or online via the State Police portal. The police are obligated to register cognisable offences. You can approach the Superintendent of Police or Magistrate if they refuse." },
    { q:["consumer forum","consumer complaint","file consumer complaint"], a:"File a consumer complaint at the District Consumer Forum (disputes up to ₹50L), State Commission (₹50L-₹2Cr), or National Commission (>₹2Cr). File within 2 years of the cause of action. You can also file on the NCDRC portal (edaakhil.nic.in) for online complaints." },
    { q:["notice period","resignation notice","quit job notice"], a:"Statutory minimum notice is usually 1 month (varies by state and contract). Your employment contract governs the actual notice period. Garden leave and payment in lieu are common alternatives. Review your appointment letter carefully." },
    { q:["rent agreement","rental agreement","lease agreement"], a:"Rental agreements should be registered if the term is 12 months or more. Key clauses: rent, deposit (typically 2-3 months), maintenance, notice period, lock-in period, and termination. Unregistered agreements have limited evidentiary value." },
    { q:["divorce india","how to divorce","legal separation"], a:"In India, divorce can be filed under the relevant personal law (Hindu Marriage Act, Muslim Personal Law, Special Marriage Act, etc.). Grounds include cruelty, desertion, adultery, and mutual consent. Mutual consent divorce is generally quicker (minimum 6 months cooling-off period may apply)." },
    { q:["startup equity","founder shares","equity vesting"], a:"Standard founder vesting is 4-year vesting with a 1-year cliff. Employee stock options (ESOPs) typically vest over 3-4 years. The shareholders agreement governs these terms. Seek a startup lawyer to review cap table and ESOP pool structure." },
    { q:["gst registration","when to register gst","gst threshold"], a:"GST registration is mandatory if annual turnover exceeds ₹40L (goods) or ₹20L (services) — ₹10L in special category states. Certain businesses require registration regardless of turnover (e-commerce sellers, inter-state suppliers, etc.)." },
    { q:["copyright registration","how to register copyright"], a:"Copyright arises automatically on creation in India — registration is not mandatory but provides evidentiary benefits. Register at the Copyright Office (copyright.gov.in). Registration takes 1-3 months and is valid for the author's lifetime + 60 years." },
    { q:["right to information","rti","file rti"], a:"File an RTI application to a Central/State Public Information Officer within 2 years of your age being at least 18. Application fee: ₹10 (Central) — varies by state. Response must be given within 30 days. File online at rtionline.gov.in." },
    { q:["legal notice","send legal notice","how to send legal notice"], a:"A legal notice is a formal written communication before initiating legal proceedings. It should be sent by registered post / email with read receipt, drafted by a lawyer, and contain: facts, relief sought, timeline to respond (usually 15-30 days), and signature." }
];

const CRISIS_KEYWORDS = [/(arrested|taken into custody|police station)/i, /(domestic violence|assault|threat)/i, /(evicted immediately|illegal eviction)/i];
const CRISIS_RESOURCES = { police:"100 (India Emergency)", legal_aid:"NALSA Helpline: 15100", women_helpline:"181 (Women Helpline)", domestic_violence:"1091 / iCall" };

function chat({ userId, message }) {
    if (!userId || !message) return fail(AGENT, "userId and message required");
    auditLog(AGENT, userId, "legal_chat", { messageLength: message.length });

    const lower   = message.toLowerCase();
    const crisis  = CRISIS_KEYWORDS.find(p => p.test(message));

    if (crisis) {
        return ok(AGENT, {
            response: "It seems you may be in an urgent situation. Please contact the relevant emergency services immediately.",
            urgency:  "HIGH",
            resources:CRISIS_RESOURCES,
            followUp: "Consult a lawyer immediately. NALSA provides free legal aid — call 15100."
        });
    }

    const matched = FAQ_MAP.find(f => f.q.some(q => lower.includes(q.split(" ")[0]) && lower.includes(q.split(" ").slice(-1)[0])));

    const history = load(userId, "chat_history", []);
    const entry   = { id: uid("ch"), message, response: matched?.a || null, timestamp: NOW() };
    history.push(entry);
    flush(userId, "chat_history", history.slice(-100));

    if (matched) return ok(AGENT, { response: matched.a, suggestSpecialist: true });

    return ok(AGENT, {
        response: "I don't have a specific answer for this question in my knowledge base. Here's what I recommend: (1) Describe your issue in more detail, (2) Specify your jurisdiction, (3) Consult a qualified lawyer — NALSA (15100) provides free legal aid for eligible individuals.",
        suggestions: ["Try rephrasing your question", "Specify the area of law (contract, employment, property, etc.)", "Mention your location for jurisdiction-specific guidance"],
        freeLegalAid:"NALSA: 15100 | eCourts Portal: ecourts.gov.in"
    });
}

module.exports = { chat };
