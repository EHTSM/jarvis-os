"use strict";
const { load, flush, uid, NOW, ok, fail, escalate, accessLog, EMERGENCY_NUMBERS } = require("./_healthStore.cjs");

const AGENT = "elderCareAgent";

const FALL_RISK_FACTORS = ["weakness","balance issues","dizziness","previous fall","poor vision","multiple medications","low blood pressure on standing","footwear issues","home hazards"];

function getElderCarePlan({ userId, age, conditions = [], medications = [], livingAlone = false }) {
    if (!userId) return fail(AGENT, "userId required");
    accessLog(userId, AGENT, "care_plan_requested");

    const riskFactors = [];
    const recommendations = [];

    // Age-based risk
    if (age >= 80) { riskFactors.push("Age 80+ — highest risk group"); recommendations.push("Regular geriatric assessment every 6 months"); }
    else if (age >= 70) { riskFactors.push("Age 70+ — elevated risk"); }

    // Conditions
    if (conditions.some(c => c.toLowerCase().includes("diabetes"))) {
        riskFactors.push("Diabetes — foot care and hypoglycaemia awareness critical");
        recommendations.push("Daily foot inspection. Annual HbA1c and eye exam. CGM if needed.");
    }
    if (conditions.some(c => c.toLowerCase().includes("dementia") || c.toLowerCase().includes("alzheimer"))) {
        riskFactors.push("Cognitive impairment — safety and supervision needs");
        recommendations.push("GPS alert wearable recommended. Structured daily routine. Caregiver support essential.");
    }
    if (conditions.some(c => c.toLowerCase().includes("osteoporosis"))) {
        riskFactors.push("Osteoporosis — fracture risk on falls");
        recommendations.push("Calcium (1200mg/day) and Vitamin D3 (600-800 IU). Discuss bisphosphonates with doctor. DEXA scan.");
    }
    if (conditions.some(c => c.toLowerCase().includes("hypertension") || c.toLowerCase().includes("blood pressure"))) {
        riskFactors.push("Hypertension — standing dizziness (orthostatic hypotension) risk");
        recommendations.push("Rise slowly from sitting/lying. Regular BP monitoring. Reduce salt.");
    }

    // Polypharmacy
    if (medications.length >= 5) {
        riskFactors.push("Polypharmacy (5+ medications) — drug interaction and fall risk");
        recommendations.push("Request a medication review from GP or pharmacist. Deprescribing may be safe.");
    }

    // Living alone
    if (livingAlone) {
        riskFactors.push("Living alone — delayed emergency response risk");
        recommendations.push("Consider medical alert pendant/watch. Daily check-in call from family. Emergency numbers visible.");
    }

    // Universal elder care recommendations
    const universal = [
        "Annual comprehensive health check including vision, hearing, dental, and falls assessment",
        "Medication review every 6-12 months with GP",
        "Exercise: 150 min/week of moderate activity + balance exercises to prevent falls",
        "Calcium + Vitamin D3 supplementation unless contraindicated",
        "Flu vaccine annually; pneumococcal vaccine (ask doctor)",
        "Regular social engagement to reduce dementia risk",
        "Mental health check — depression is common and under-diagnosed in elderly",
        "Home safety assessment: remove trip hazards, add grab rails in bathroom"
    ];

    return ok(AGENT, {
        riskFactors:      riskFactors.length ? riskFactors : ["No specific risk factors identified from provided information"],
        recommendations:  [...recommendations, ...universal],
        fallPrevention:   {
            homeChanges:  ["Remove loose rugs","Add grab rails in bathroom and staircase","Improve lighting","Keep walkways clear"],
            exercises:    ["Tai Chi (best evidence for fall prevention)","Chair yoga","Balance exercises (stand on one foot with support)"],
            footwear:     "Wear well-fitting shoes with non-slip soles indoors and outdoors"
        },
        emergencyNumbers: EMERGENCY_NUMBERS,
        helplines:        { elderline: "14567 (Ministry of Social Justice Elder Helpline)", care: "HelpAge India: 1800-180-1253" }
    });
}

function addMedicationReminder({ userId, medicationName, dosage, frequency, times = [] }) {
    if (!userId || !medicationName) return fail(AGENT, "userId and medicationName required");
    accessLog(userId, AGENT, "medication_reminder_added");

    const reminder = { id: uid("mr"), medicationName, dosage, frequency, times, active: true, createdAt: NOW() };
    const reminders = load(userId, "medication_reminders", []);
    reminders.push(reminder);
    flush(userId, "medication_reminders", reminders.slice(-50));

    return ok(AGENT, {
        reminder,
        note: "This is a reminder helper only. Never change medication without consulting your doctor.",
        tip:  "Pill organisers (7-day dosette boxes) significantly reduce missed or double doses."
    });
}

function getMedicationReminders({ userId }) {
    if (!userId) return fail(AGENT, "userId required");
    return ok(AGENT, load(userId, "medication_reminders", []));
}

module.exports = { getElderCarePlan, addMedicationReminder, getMedicationReminders };
