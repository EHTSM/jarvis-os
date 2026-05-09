"use strict";
const { uid, NOW, auditLog, ok, fail } = require("./_legalStore.cjs");
const AGENT = "patentSearchAgent";

const PATENT_DATABASES = [
    { name:"India Patent Advanced Search (IPADS)", url:"ipindiapatents.nic.in",   free:true,  coverage:"India" },
    { name:"Espacenet (EPO)",                       url:"worldwide.espacenet.com", free:true,  coverage:"Global 120M+" },
    { name:"Google Patents",                         url:"patents.google.com",     free:true,  coverage:"Global 120M+" },
    { name:"USPTO Patent Full-Text Search",          url:"ppubs.uspto.gov",        free:true,  coverage:"USA" },
    { name:"WIPO PatentScope",                       url:"patentscope.wipo.int",   free:true,  coverage:"PCT applications" },
    { name:"Derwent Innovation",                     url:"derwentinnovation.com",  free:false, coverage:"Global with analytics" }
];

const IPC_CLASSES = {
    "A":  "Human Necessities (agriculture, foodstuffs, personal articles)",
    "B":  "Performing Operations / Transporting",
    "C":  "Chemistry / Metallurgy",
    "D":  "Textiles / Paper",
    "E":  "Fixed Constructions",
    "F":  "Mechanical Engineering / Lighting / Heating / Weapons",
    "G":  "Physics (instruments, computing, nuclear)",
    "H":  "Electricity (electronics, communications, electric power)"
};

const PATENT_ELIGIBILITY = {
    eligible:     ["machine","process","manufacture","composition of matter","technical invention","software-implemented technical solution (EU)","business method with technical effect (limited)"],
    not_eligible: ["abstract idea (USA)","mathematical concept","mental process","laws of nature","natural phenomena","purely abstract software (USA — Alice test)","traditional knowledge","discovery as such (India)","medical treatment methods (India)"]
};

function searchPriorArt({ userId, inventionTitle, description, keywords = [], ipcClass }) {
    if (!userId || !inventionTitle) return fail(AGENT, "userId and inventionTitle required");
    auditLog(AGENT, userId, "patent_search", { inventionTitle, ipcClass });

    const cleanKeywords = keywords.length ? keywords : inventionTitle.split(" ").filter(w => w.length > 3);

    return ok(AGENT, {
        id:             uid("ps"),
        inventionTitle,
        description,
        searchKeywords: cleanKeywords,
        ipcClass,
        ipcDescription: ipcClass ? IPC_CLASSES[ipcClass.charAt(0).toUpperCase()] : "Determine your IPC class at ipc.wipo.int",
        databases:      PATENT_DATABASES,
        searchQueries:  {
            googlePatents:  `https://patents.google.com/?q=${cleanKeywords.map(encodeURIComponent).join(",")}&before=priority:${new Date().getFullYear()}0101`,
            espacenet:      `https://worldwide.espacenet.com/patent/search?q=txt%3D"${cleanKeywords.slice(0,3).join("+")}"`,
            wipo:           `https://patentscope.wipo.int/search/en/search.jsf?query=${cleanKeywords.slice(0,3).map(encodeURIComponent).join("+")}`,
            india:          `https://ipindiapatents.nic.in/results.php?q=${cleanKeywords.slice(0,2).map(encodeURIComponent).join("+")}`
        },
        eligibility:    PATENT_ELIGIBILITY,
        searchTips:     ["Search for synonyms and related terms","Search competitor company names","Check PCT applications for pending international patents","Use CPC (Cooperative Patent Classification) for more granular search","Hire a patent attorney for comprehensive freedom-to-operate opinion"],
        nextSteps:      ["If no blocking prior art found → consider filing provisional application","If blocking art found → assess design-around options or licensing","Consult a registered patent agent (Patent Agents Examination — India)"],
        createdAt:      NOW()
    });
}

function getPatentDatabases()    { return ok(AGENT, { databases: PATENT_DATABASES }); }
function getEligibilityGuide()   { return ok(AGENT, { eligibility: PATENT_ELIGIBILITY, ipcClasses: IPC_CLASSES }); }

module.exports = { searchPriorArt, getPatentDatabases, getEligibilityGuide };
