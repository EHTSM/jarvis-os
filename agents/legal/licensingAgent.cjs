"use strict";
const { load, flush, uid, NOW, auditLog, ok, fail, DISCLAIMER } = require("./_legalStore.cjs");
const AGENT = "licensingAgent";

const LICENSE_TYPES = {
    exclusive:       { description:"Only licensee can use the IP — licensor cannot grant to others", risk:"HIGH for licensor", reward:"Highest royalties" },
    non_exclusive:   { description:"Licensor can grant same rights to multiple licensees", risk:"LOW for licensor", reward:"Lower royalties per deal" },
    sole:            { description:"Licensor and licensee both can use — no third parties", risk:"MEDIUM", reward:"Medium royalties" },
    compulsory:      { description:"Government-mandated license — common in pharma/patents", risk:"Regulated", reward:"Government-set royalty" },
    open_source:     { description:"Code/content freely available under open-source terms", risk:"LOW", reward:"Community/reputation" },
    creative_commons:{ description:"Content license with various permission levels", risk:"LOW", reward:"Attribution/community" },
    franchise:       { description:"Brand + system licensed for business operation", risk:"MEDIUM (both parties)", reward:"Ongoing royalty + fees" }
};

const OPEN_SOURCE_LICENSES = {
    "MIT":       { permissions:["Commercial","Distribution","Modification","Private"],  conditions:["License notice"],              copyleft:false },
    "Apache 2.0":{ permissions:["Commercial","Distribution","Modification","Patent"],   conditions:["License notice","State changes"],copyleft:false },
    "GPL v3":    { permissions:["Commercial","Distribution","Modification","Patent"],   conditions:["Source code","Same license"],    copyleft:true },
    "LGPL":      { permissions:["Commercial","Distribution","Modification"],            conditions:["Library linking notice"],         copyleft:"weak" },
    "BSD 2/3":   { permissions:["Commercial","Distribution","Modification"],            conditions:["License notice"],                copyleft:false },
    "CC0":       { permissions:["Commercial","Distribution","Modification","No conditions"], conditions:[], copyleft:false },
    "CC-BY":     { permissions:["Commercial","Distribution","Modification"],            conditions:["Attribution"],                    copyleft:false },
    "CC-BY-SA":  { permissions:["Commercial","Distribution","Modification"],            conditions:["Attribution","ShareAlike"],       copyleft:true },
    "CC-BY-NC":  { permissions:["Distribution","Modification"],                        conditions:["Attribution","NonCommercial"],     copyleft:false }
};

function createLicenseAgreement({ userId, ipType, licenseType, licensor, licensee, territory = "Global", royaltyPercent, term, jurisdiction = "India" }) {
    if (!userId || !ipType || !licenseType) return fail(AGENT, "userId, ipType, licenseType required");
    auditLog(AGENT, userId, "license_created", { ipType, licenseType, territory });

    const typeInfo = LICENSE_TYPES[licenseType.toLowerCase().replace(/\s+/g,"_")] || LICENSE_TYPES.non_exclusive;

    const agreement = {
        id:          uid("lic"),
        userId,
        ipType,
        licenseType,
        licensor,
        licensee,
        territory,
        royaltyPercent:royaltyPercent || "To be negotiated",
        term:        term || "3 years",
        jurisdiction,
        typeInfo,
        keyTerms: [
            "Grant of license (scope defined above)",
            `Territory: ${territory}`,
            `Term: ${term || "3 years"} with renewal option`,
            `Royalty: ${royaltyPercent ? royaltyPercent + "%" : "As separately agreed"}`,
            "Quality control rights (for franchise/trademark licenses)",
            "Sub-licensing: Not permitted without written consent",
            "Termination: For cause (30 days notice), insolvency",
            `Governing Law: ${jurisdiction}`
        ],
        benchmarks: { royaltyRanges: { software:"3-15%", music:"10-25%", pharma:"5-15%", brand:"3-8%", patent:"5-25%" } },
        draftNote:   "DRAFT ONLY — Have a qualified IP lawyer review before execution.",
        createdAt:   NOW()
    };

    const records = load(userId, "license_agreements", []);
    records.push({ id: agreement.id, ipType, licenseType, createdAt: agreement.createdAt });
    flush(userId, "license_agreements", records.slice(-100));

    return ok(AGENT, agreement);
}

function compareLicenses({ licenseKeys = [] }) {
    const result = licenseKeys.reduce((acc, k) => {
        const info = OPEN_SOURCE_LICENSES[k];
        if (info) acc[k] = info;
        return acc;
    }, {});
    return ok(AGENT, { comparison: result, allLicenses: OPEN_SOURCE_LICENSES });
}

function getLicenseTypes() { return ok(AGENT, { types: LICENSE_TYPES, openSource: OPEN_SOURCE_LICENSES }); }

module.exports = { createLicenseAgreement, compareLicenses, getLicenseTypes };
