"use strict";
const { load, flush, uid, NOW, ok, fail, accessLog } = require("./_healthStore.cjs");

const AGENT = "bloodDonorFinder";

const BLOOD_GROUPS = ["A+","A-","B+","B-","AB+","AB-","O+","O-"];

const COMPATIBILITY = {
    "A+":  { canReceiveFrom: ["A+","A-","O+","O-"],        canDonateTo: ["A+","AB+"] },
    "A-":  { canReceiveFrom: ["A-","O-"],                  canDonateTo: ["A+","A-","AB+","AB-"] },
    "B+":  { canReceiveFrom: ["B+","B-","O+","O-"],        canDonateTo: ["B+","AB+"] },
    "B-":  { canReceiveFrom: ["B-","O-"],                  canDonateTo: ["B+","B-","AB+","AB-"] },
    "AB+": { canReceiveFrom: ["A+","A-","B+","B-","AB+","AB-","O+","O-"], canDonateTo: ["AB+"] },
    "AB-": { canReceiveFrom: ["A-","B-","AB-","O-"],       canDonateTo: ["AB+","AB-"] },
    "O+":  { canReceiveFrom: ["O+","O-"],                  canDonateTo: ["A+","B+","AB+","O+"] },
    "O-":  { canReceiveFrom: ["O-"],                       canDonateTo: BLOOD_GROUPS } // Universal donor
};

function registerDonor({ userId, name, bloodGroup, location, phone, lastDonated }) {
    if (!userId || !bloodGroup || !name || !phone)
        return fail(AGENT, "userId, name, bloodGroup and phone required");
    if (!BLOOD_GROUPS.includes(bloodGroup.toUpperCase()))
        return fail(AGENT, `Invalid blood group. Must be one of: ${BLOOD_GROUPS.join(", ")}`);

    accessLog(userId, AGENT, "donor_registered", { bloodGroup });

    const registry = load("_global", "blood_donors", []);
    const donor    = {
        id:           uid("don"),
        userId,
        name,
        bloodGroup:   bloodGroup.toUpperCase(),
        location,
        phone,        // In production: store encrypted; only reveal to verified requests
        lastDonated:  lastDonated || null,
        nextEligible: lastDonated
            ? new Date(new Date(lastDonated).getTime() + 90 * 86400000).toISOString().slice(0, 10)
            : NOW().slice(0, 10),
        active:       true,
        registeredAt: NOW()
    };
    registry.push(donor);
    flush("_global", "blood_donors", registry.slice(-10000));
    return ok(AGENT, { donor: { ...donor, phone: "***stored securely***" }, message: "Registered as blood donor. Thank you for saving lives!" });
}

function findDonors({ userId, bloodGroup, location, urgency = "normal" }) {
    if (!userId)     return fail(AGENT, "userId required");
    if (!bloodGroup) return fail(AGENT, "bloodGroup required");

    accessLog(userId, AGENT, "donor_search", { bloodGroup, location });

    const bg          = bloodGroup.toUpperCase();
    const compatible  = COMPATIBILITY[bg]?.canReceiveFrom || [bg];
    const registry    = load("_global", "blood_donors", []);
    const eligible    = registry.filter(d =>
        d.active && compatible.includes(d.bloodGroup) &&
        new Date(d.nextEligible) <= new Date() &&
        (!location || (d.location || "").toLowerCase().includes(location.toLowerCase()))
    );

    return ok(AGENT, {
        requested:         bg,
        compatible:        compatible,
        donorsFound:       eligible.length,
        donors:            eligible.slice(0, 10).map(d => ({
            id:             d.id,
            name:           d.name,
            bloodGroup:     d.bloodGroup,
            location:       d.location,
            contactMessage: "Contact via hospital blood bank — do not contact donors directly"
        })),
        urgencyNote: urgency === "emergency"
            ? "⚠️ Contact your nearest hospital blood bank immediately. They maintain emergency stock."
            : null,
        bloodBanks:  [
            "iDonate.in — national blood bank directory",
            "Blood Connect: bloodconnect.in",
            "Heal Foundation: 9999788202",
            "Your nearest hospital blood bank (most reliable for emergency)"
        ],
        apps: ["iDonate", "BloodConnect", "Rakthdaan (Delhi)"]
    });
}

function getBloodGroupInfo({ bloodGroup }) {
    const bg   = (bloodGroup || "").toUpperCase();
    const info = COMPATIBILITY[bg];
    if (!info) return fail(AGENT, `Invalid blood group. Must be one of: ${BLOOD_GROUPS.join(", ")}`);
    return ok(AGENT, { bloodGroup: bg, ...info, universalDonor: bg === "O-", universalReceiver: bg === "AB+" });
}

module.exports = { registerDonor, findDonors, getBloodGroupInfo };
