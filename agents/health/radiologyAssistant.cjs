"use strict";
/**
 * Radiology Assistant — helps users understand radiology reports in plain language.
 * NEVER provides a clinical interpretation or final conclusion.
 * Explains medical terminology only.
 */
const { load, flush, uid, NOW, ok, fail, accessLog } = require("./_healthStore.cjs");

const AGENT = "radiologyAssistant";

// Common radiology terms → plain English explanations
const RADIOLOGY_TERMS = {
    "consolidation":          "Solidification of lung tissue, often indicating fluid or infection (like pneumonia).",
    "effusion":               "Fluid collection in a body cavity (e.g. pleural effusion = fluid around lungs).",
    "opacity":                "An area that appears denser/whiter on X-ray than the surrounding tissue. Can be fluid, tissue, or infiltrate.",
    "atelectasis":            "Partial collapse or incomplete expansion of lung tissue. Can be mild (common) or significant.",
    "cardiomegaly":           "The heart appears enlarged on chest X-ray. Needs cardiac evaluation.",
    "nodule":                 "A small, round, well-defined lesion. Most are benign but need follow-up as directed.",
    "mass":                   "A larger lesion >3 cm. Requires further evaluation to determine nature.",
    "calcification":          "Calcium deposits appearing bright white. Often benign (old infection, injury) but needs context.",
    "lucency":                "Area that appears darker/blacker than expected on X-ray, suggesting less density (air, fat).",
    "osteophyte":             "Bony outgrowth (bone spur) at joint edges — common sign of osteoarthritis.",
    "disc space narrowing":   "Reduced space between vertebrae — suggests disc degeneration.",
    "sclerosis":              "Increased bone density in a specific area.",
    "fracture":               "Break in continuity of bone.",
    "subluxation":            "Partial dislocation of a joint.",
    "heterogeneous":          "Non-uniform appearance — varies in density/signal. Needs radiologist interpretation.",
    "homogeneous":            "Uniform appearance throughout — generally a favourable feature.",
    "enhancement":            "On contrast CT/MRI: area shows increased brightness after contrast injection — indicates blood flow or specific tissue types.",
    "T1 T2":                  "MRI sequences: T1 emphasises anatomy; T2 shows fluid as bright white. Radiologist uses both for interpretation.",
    "signal intensity":       "On MRI: describes brightness of tissue. 'Increased signal' = brighter. Meaning depends on sequence and context.",
    "impression":             "The radiologist's summary conclusion — most important part of the report.",
    "bilateral":              "Affecting both sides of the body simultaneously.",
    "unilateral":             "Affecting only one side.",
    "anterior posterior":     "Front to back (AP) — a standard X-ray view direction.",
    "NAD":                    "No Abnormality Detected — report suggests normal findings.",
    "WNL":                    "Within Normal Limits — findings are within expected normal range."
};

function explainReport({ userId, reportText, terms = [] }) {
    if (!userId)                              return fail(AGENT, "userId required");
    if (!reportText && !terms.length)        return fail(AGENT, "reportText or terms array required");

    accessLog(userId, AGENT, "report_explained");

    // Extract terms to explain from report text
    const toExplain = terms.length ? terms : [];
    if (reportText) {
        const lowerReport = reportText.toLowerCase();
        for (const [term] of Object.entries(RADIOLOGY_TERMS)) {
            if (lowerReport.includes(term.toLowerCase())) toExplain.push(term);
        }
    }

    const explanations = [];
    for (const term of [...new Set(toExplain)]) {
        const lower    = term.toLowerCase().trim();
        const matched  = Object.entries(RADIOLOGY_TERMS).find(([k]) => k.toLowerCase() === lower || lower.includes(k.toLowerCase()));
        explanations.push({
            term,
            plainEnglish: matched ? matched[1] : "Term not in our glossary — ask your radiologist or doctor to explain this."
        });
    }

    const entry = {
        id:          uid("rad"),
        userId,
        termsFound:  toExplain.length,
        reportSnippet: reportText ? reportText.slice(0, 200) : null,
        loggedAt:    NOW()
    };
    const log = load(userId, "radiology_log", []);
    log.push(entry);
    flush(userId, "radiology_log", log.slice(-100));

    return ok(AGENT, {
        explanations,
        found:       explanations.length,
        glossary:    Object.keys(RADIOLOGY_TERMS),
        important:   [
            "These explanations are of medical terminology only — NOT a clinical interpretation of your report.",
            "Only the radiologist who prepared the report can interpret it clinically.",
            "Discuss the 'Impression' section (final conclusion) with your referring doctor.",
            "If unsure about your report, ask your doctor for a plain-language explanation."
        ]
    });
}

function lookupTerm({ userId, term }) {
    if (!userId || !term) return fail(AGENT, "userId and term required");
    accessLog(userId, AGENT, "term_lookup");
    const lower   = term.toLowerCase().trim();
    const matched = Object.entries(RADIOLOGY_TERMS).find(([k]) => k.toLowerCase() === lower || lower.includes(k.toLowerCase()));
    return ok(AGENT, matched
        ? { term, plainEnglish: matched[1] }
        : { term, plainEnglish: "Term not found in glossary. Consult your radiologist or treating doctor." }
    );
}

module.exports = { explainReport, lookupTerm };
