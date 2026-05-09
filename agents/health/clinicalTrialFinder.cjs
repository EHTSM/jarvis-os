"use strict";
const { ok, fail, accessLog } = require("./_healthStore.cjs");
const AGENT = "clinicalTrialFinder";

function findTrials({ userId, condition, phase, location = "India" }) {
    if (!userId || !condition) return fail(AGENT, "userId and condition required");
    accessLog(userId, AGENT, "trials_searched", { condition });

    return ok(AGENT, {
        condition, phase, location,
        searchDatabases: [
            { name: "ClinicalTrials.gov", url: "clinicaltrials.gov", note: "Largest registry — search by condition and location" },
            { name: "CTRI (India)", url: "ctri.nic.in", note: "Clinical Trials Registry India — mandatory registration for Indian trials" },
            { name: "WHO ICTRP", url: "who.int/clinical-trials-registry-platform", note: "International registry" },
            { name: "EU Clinical Trials Register", url: "clinicaltrialsregister.eu", note: "EU-based trials" }
        ],
        searchTips: [
            `Search: "${condition}" on clinicaltrials.gov`,
            "Filter by: Recruiting, Location: India, Phase",
            "Contact the Principal Investigator (PI) listed on each trial",
            "Ask your specialist if they know of relevant trials"
        ],
        important: [
            "Clinical trials are research studies — participation is voluntary",
            "Always discuss with your doctor before enrolling",
            "Legitimate trials never charge participants",
            "Read the Informed Consent Form carefully before signing"
        ],
        contacts: {
            ICMR:  "011-23731116 (Indian Council of Medical Research)",
            CDSCO: "011-23236975 (drugs regulatory authority India)"
        }
    });
}

module.exports = { findTrials };
