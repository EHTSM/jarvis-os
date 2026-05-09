"use strict";
const { load, flush, uid, NOW, auditLog, ok, fail } = require("./_legalStore.cjs");
const AGENT = "ipProtectionAgent";

const IP_TYPES = {
    patent:    { duration:"20 years from filing", registration:"Mandatory", body:"Patent Office (India) / USPTO / EPO", timeToGrant:"2-5 years", cost:"₹1,600–₹8,000 filing (India); $800–$1,600 (USPTO)" },
    trademark: { duration:"10 years (renewable)", registration:"Recommended (arises from use)", body:"Trade Marks Registry India / USPTO / EUIPO", timeToGrant:"12-18 months", cost:"₹4,500–₹9,000 (India)" },
    copyright: { duration:"Author's life + 60 years (India)", registration:"Optional (auto on creation)", body:"Copyright Office India / USCO", timeToGrant:"1-3 months", cost:"₹500–₹5,000 (India)" },
    design:    { duration:"10 years (extendable to 15)", registration:"Mandatory", body:"Patent Office (Design Wing) India", timeToGrant:"6-12 months", cost:"₹1,000–₹4,000 (India)" },
    trade_secret:{ duration:"Indefinite (while secret)", registration:"None — protect via NDA+security", body:"N/A", timeToGrant:"Immediate", cost:"NDA drafting cost" }
};

const IP_REGISTRATION_STEPS = {
    trademark_india: [
        "Conduct TM search on ipindia.gov.in/tmrpublicsearch",
        "File application on ipindiaonline.gov.in (Form TM-A)",
        "Examination report issued (6-12 months)",
        "Respond to objections if any",
        "Publication in Trade Marks Journal",
        "Opposition period (4 months)",
        "Registration certificate issued"
    ],
    patent_india: [
        "Conduct prior art search (espacenet.epo.org, ipindiapatents.nic.in)",
        "File provisional or complete specification",
        "Publication after 18 months (automatic)",
        "Request for examination (Form 18/18B within 48 months)",
        "First Examination Report (FER) response",
        "Grant of patent"
    ],
    copyright_india: [
        "Create the work (copyright arises automatically)",
        "File application on copyright.gov.in (Form XIV for literary/artistic)",
        "Pay filing fee",
        "Examination by Copyright Office",
        "Registration certificate issued"
    ]
};

function assessIPProtection({ userId, assetType, assetDescription, jurisdiction = "India", commercialValue = "medium" }) {
    if (!userId || !assetType) return fail(AGENT, "userId and assetType required");
    auditLog(AGENT, userId, "ip_assessment", { assetType, jurisdiction });

    const key  = assetType.toLowerCase().replace(/\s+/g,"_");
    const info = IP_TYPES[key];
    if (!info) return fail(AGENT, `Unknown IP type. Options: ${Object.keys(IP_TYPES).join(", ")}`);

    const stepsKey = `${key}_${jurisdiction.toLowerCase()}`;
    const steps    = IP_REGISTRATION_STEPS[stepsKey] || IP_REGISTRATION_STEPS[`${key}_india`] || [];

    const assessment = {
        id:            uid("ip"),
        userId,
        assetType:     key,
        assetDescription,
        jurisdiction,
        commercialValue,
        ipInfo:        info,
        registrationSteps: steps,
        immediateActions:  [
            "Document the creation with timestamps (email yourself, use git, blockchain timestamp)",
            "Do NOT disclose publicly before filing (critical for patents)",
            "Sign NDAs with anyone who sees the asset",
            `File ${key} application promptly — first to file wins in most jurisdictions`
        ],
        enforcementOptions:["Cease and Desist letter","DMCA takedown (for online copyright)","IP litigation","Customs recordal (for border enforcement)","Domain dispute (UDRP for trademarks)"],
        monitoringServices:["Google Alerts for your brand/product name","IPWatchdog.com","MarkMonitor","Brand protection services"],
        createdAt:     NOW()
    };

    const records = load(userId, "ip_assessments", []);
    records.push({ id: assessment.id, assetType: key, jurisdiction, createdAt: assessment.createdAt });
    flush(userId, "ip_assessments", records.slice(-100));

    return ok(AGENT, assessment);
}

function getIPTypes() { return ok(AGENT, IP_TYPES); }
function getRegistrationSteps({ assetType, jurisdiction = "india" }) {
    const key = `${assetType?.toLowerCase()?.replace(/\s+/g,"_")}_${jurisdiction.toLowerCase()}`;
    return ok(AGENT, { steps: IP_REGISTRATION_STEPS[key] || IP_REGISTRATION_STEPS[`${assetType?.toLowerCase()}_india`] || [] });
}

module.exports = { assessIPProtection, getIPTypes, getRegistrationSteps };
