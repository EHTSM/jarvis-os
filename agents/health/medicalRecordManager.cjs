"use strict";
/**
 * Medical Record Manager — stores user health records with mock encryption.
 * Privacy enforced: access logged, records per-user isolated.
 * NEVER used to diagnose — storage and retrieval only.
 */
const { load, flush, uid, NOW, ok, fail, accessLog } = require("./_healthStore.cjs");

const AGENT        = "medicalRecordManager";
const RECORD_TYPES = ["lab_report","prescription","diagnosis_letter","discharge_summary","vaccination_record","imaging_report","doctor_notes","insurance_document","other"];

function addRecord({ userId, type, title, content, doctorName, hospitalName, date, tags = [] }) {
    if (!userId)  return fail(AGENT, "userId required");
    if (!type)    return fail(AGENT, "type required");
    if (!title)   return fail(AGENT, "title required");
    if (!content) return fail(AGENT, "content required");
    if (!RECORD_TYPES.includes(type))
        return fail(AGENT, `Invalid type. Use: ${RECORD_TYPES.join(", ")}`);

    accessLog(userId, AGENT, "record_added", { type, title });

    // Store with mock encryption flag for sensitive health data
    const record = {
        id:           uid("rec"),
        userId,
        type,
        title,
        content,  // In production: encrypt this field with AES-256
        doctorName:   doctorName || "",
        hospitalName: hospitalName || "",
        date:         date || NOW().slice(0, 10),
        tags,
        createdAt:    NOW()
    };

    const records = load(userId, "medical_records", []);
    records.push(record);
    flush(userId, "medical_records", records.slice(-2000), true); // encrypted flag = true
    return ok(AGENT, { record, message: "Record saved securely." });
}

function getRecords({ userId, type, tag, search, limit = 20 }) {
    if (!userId) return fail(AGENT, "userId required");
    accessLog(userId, AGENT, "records_accessed", { type, search });

    let records = load(userId, "medical_records", [], true);
    if (type)   records = records.filter(r => r.type === type);
    if (tag)    records = records.filter(r => r.tags && r.tags.includes(tag));
    if (search) {
        const q = search.toLowerCase();
        records = records.filter(r =>
            r.title.toLowerCase().includes(q) ||
            r.doctorName.toLowerCase().includes(q) ||
            r.hospitalName.toLowerCase().includes(q) ||
            (r.tags || []).some(t => t.toLowerCase().includes(q))
        );
    }
    return ok(AGENT, {
        records: records.slice(-limit).reverse(),
        total:   records.length
    });
}

function deleteRecord({ userId, recordId }) {
    if (!userId || !recordId) return fail(AGENT, "userId and recordId required");
    accessLog(userId, AGENT, "record_deleted", { recordId });
    const records = load(userId, "medical_records", [], true);
    const filtered = records.filter(r => r.id !== recordId);
    if (filtered.length === records.length) return fail(AGENT, "Record not found");
    flush(userId, "medical_records", filtered, true);
    return ok(AGENT, { deleted: recordId, message: "Record permanently deleted." });
}

function getHealthProfile({ userId }) {
    if (!userId) return fail(AGENT, "userId required");
    accessLog(userId, AGENT, "profile_viewed");
    const profile = load(userId, "health_profile", {});
    return ok(AGENT, profile);
}

function updateHealthProfile({ userId, bloodGroup, allergies = [], chronicConditions = [], currentMedications = [], height, weight, emergencyContact }) {
    if (!userId) return fail(AGENT, "userId required");
    accessLog(userId, AGENT, "profile_updated");
    const profile = load(userId, "health_profile", {});
    const updated = {
        ...profile,
        bloodGroup:          bloodGroup         || profile.bloodGroup,
        allergies:           allergies.length   ? allergies           : (profile.allergies || []),
        chronicConditions:   chronicConditions.length ? chronicConditions : (profile.chronicConditions || []),
        currentMedications:  currentMedications.length ? currentMedications : (profile.currentMedications || []),
        height:              height             || profile.height,
        weight:              weight             || profile.weight,
        emergencyContact:    emergencyContact   || profile.emergencyContact,
        updatedAt:           NOW()
    };
    flush(userId, "health_profile", updated, true);
    return ok(AGENT, updated);
}

module.exports = { addRecord, getRecords, deleteRecord, getHealthProfile, updateHealthProfile };
