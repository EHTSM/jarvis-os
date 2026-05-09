"use strict";
const { load, flush, uid, NOW, ok, fail, accessLog } = require("./_healthStore.cjs");

const AGENT = "telemedicineAgent";

const TELEMEDICINE_PLATFORMS = [
    { name: "Apollo 247",         url: "apollo247.com",       note: "24/7 video consultations, prescriptions, lab tests", price: "₹299-599/consult" },
    { name: "Practo",             url: "practo.com",          note: "Doctor search, video/chat consultations",             price: "₹200-800/consult" },
    { name: "mFine",              url: "mfine.co",            note: "AI-assisted triage + specialist consultations",       price: "₹299-999/consult" },
    { name: "1mg Online Doctor",  url: "1mg.com",             note: "Consultations + medicine delivery",                   price: "₹200-500/consult" },
    { name: "Tata 1mg",           url: "1mg.com",             note: "Lab tests + telemedicine integration",                price: "₹250-600/consult" },
    { name: "eSanjeevani (Free)", url: "esanjeevaniopd.in",   note: "Government free telemedicine (National Teleconsultation Service)", price: "FREE" },
    { name: "AIIMS eCare",        url: "aiims.edu/en/econsult",note: "AIIMS specialist video consultations",              price: "Subsidised" }
];

const CONSULT_TYPES = ["general","specialist","mental_health","paediatric","gynaecology","dermatology","orthopaedic","cardiology","follow_up","prescription_renewal","lab_review"];

function bookVirtualConsult({ userId, consultType = "general", preferredDate, preferredTime, symptoms = [], language = "English", notes = "" }) {
    if (!userId) return fail(AGENT, "userId required");
    if (!CONSULT_TYPES.includes(consultType))
        return fail(AGENT, `Invalid consultType. Use: ${CONSULT_TYPES.join(", ")}`);

    accessLog(userId, AGENT, "virtual_consult_booked", { consultType });

    const session = {
        id:           uid("tele"),
        userId,
        consultType,
        preferredDate: preferredDate || "Flexible",
        preferredTime: preferredTime || "Flexible",
        symptoms,
        language,
        notes,
        status:       "pending_confirmation",
        platforms:    TELEMEDICINE_PLATFORMS.filter(p => {
            if (consultType === "mental_health") return ["Practo","mFine","Apollo 247","eSanjeevani (Free)"].includes(p.name);
            return true;
        }).slice(0, 4),
        createdAt: NOW()
    };

    const sessions = load(userId, "tele_sessions", []);
    sessions.push(session);
    flush(userId, "tele_sessions", sessions.slice(-100));

    return ok(AGENT, {
        session,
        preparationTips: [
            "Test your internet connection and camera/microphone before the consultation",
            "Have your medical records, current medications list, and previous reports ready",
            "Write down your symptoms and questions beforehand",
            "Be in a private, quiet location",
            "Have your health profile handy"
        ],
        government: "eSanjeevani (esanjeevaniopd.in) is FREE — supported by Ministry of Health & Family Welfare"
    });
}

function getPlatforms({ userId, consultType, budget }) {
    if (!userId) return fail(AGENT, "userId required");
    accessLog(userId, AGENT, "platforms_viewed");

    let platforms = [...TELEMEDICINE_PLATFORMS];
    if (budget === "free") platforms = platforms.filter(p => p.price.includes("FREE") || p.price.includes("free"));

    return ok(AGENT, { platforms, tip: "eSanjeevani is completely free and government-backed — ideal for routine consultations." });
}

module.exports = { bookVirtualConsult, getPlatforms };
