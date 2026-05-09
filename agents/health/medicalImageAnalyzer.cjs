"use strict";
/**
 * Medical Image Analyzer — describes images only. NO diagnosis whatsoever.
 * For image analysis AI (future): Claude Vision / GPT-4V integration point.
 * Current mode: educational description of what common images typically show.
 */
const { ok, fail, accessLog } = require("./_healthStore.cjs");

const AGENT = "medicalImageAnalyzer";

const IMAGE_TYPES = {
    xray:   { name: "X-Ray (Radiograph)", description: "Uses ionising radiation to produce 2D images. Dense structures (bone) appear white; air-filled structures (lungs) appear black.", uses: ["Chest X-ray for lungs/heart","Bone fractures","Joint assessment","Abdominal X-ray"] },
    mri:    { name: "MRI (Magnetic Resonance Imaging)", description: "Uses magnetic fields and radio waves. Excellent soft tissue contrast. No radiation.", uses: ["Brain and spinal cord","Joints (ACL, meniscus)","Abdominal organs","Breast imaging"] },
    ct:     { name: "CT Scan (Computed Tomography)", description: "Multiple X-ray images processed by computer into cross-sectional slices. Fast acquisition.", uses: ["Head CT for brain bleed","Chest CT for PE or COVID","Abdominal CT for appendicitis","Cancer staging"] },
    ultrasound: { name: "Ultrasound (USG)", description: "Uses sound waves. Real-time imaging. Safe in pregnancy. No radiation.", uses: ["Obstetric (pregnancy)","Abdominal organs","Thyroid and lymph nodes","Echocardiography (heart)","Guided biopsies"] },
    ecg:    { name: "ECG / EKG (Electrocardiogram)", description: "Records electrical activity of heart via electrodes. Shows rhythm, rate, conduction.", uses: ["Arrhythmia detection","Heart attack (ST changes)","QT prolongation","Pacemaker function"] },
    endoscopy: { name: "Endoscopy", description: "Camera on flexible tube inserted into body cavities. Allows direct visualisation and biopsy.", uses: ["Upper GI: oesophagus, stomach, duodenum","Lower GI: colonoscopy","Bronchoscopy: airways","Arthroscopy: joints"] },
    pathology: { name: "Pathology Slide / Biopsy Report", description: "Microscopic examination of tissue samples by a pathologist.", uses: ["Cancer diagnosis and grading","Infection identification","Inflammatory conditions","Pre-cancer detection"] }
};

function describeImageType({ userId, imageType, query }) {
    if (!userId) return fail(AGENT, "userId required");
    accessLog(userId, AGENT, "image_type_described", { imageType });

    const key     = (imageType || "").toLowerCase().replace(/\s+/g,"_");
    const matched = IMAGE_TYPES[key] || Object.entries(IMAGE_TYPES).find(([k]) => (query || "").toLowerCase().includes(k))?.[1];

    if (!matched) {
        return ok(AGENT, {
            available: Object.keys(IMAGE_TYPES),
            message:   "Specify an image type from the available list for a detailed description.",
            critical:  "NEVER use AI image analysis as a substitute for professional radiological reporting."
        });
    }

    return ok(AGENT, {
        imageType: key,
        info:      typeof matched === "object" && matched.name ? matched : (matched[1] || matched),
        critical:  "This is EDUCATIONAL information only. Medical images must be interpreted by a qualified radiologist or specialist. AI image descriptions are NOT a diagnostic tool.",
        recommended: "Always get images formally reported by a radiologist. Ask your doctor to explain the report to you."
    });
}

function logImageUpload({ userId, imageType, notes = "" }) {
    if (!userId || !imageType) return fail(AGENT, "userId and imageType required");
    accessLog(userId, AGENT, "image_logged");
    return ok(AGENT, {
        logged:  true,
        message: "Image reference noted. Remember to get this reviewed by a qualified radiologist.",
        note:    "Jarvis does not store or analyse actual medical images. This is a reference log only."
    });
}

module.exports = { describeImageType, logImageUpload };
