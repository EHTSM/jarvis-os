"use strict";
const { load, flush, uid, NOW, auditLog, ok, fail } = require("./_legalStore.cjs");
const AGENT = "caseLawSearchAgent";

const LANDMARK_CASES = {
    india: [
        { name:"Kesavananda Bharati v. State of Kerala (1973)", area:"constitutional", principle:"Basic structure doctrine — Parliament cannot alter the basic structure of the Constitution", court:"Supreme Court of India" },
        { name:"Maneka Gandhi v. Union of India (1978)",         area:"constitutional", principle:"Right to life includes the right to live with dignity; procedure established by law must be fair", court:"Supreme Court of India" },
        { name:"Vishaka v. State of Rajasthan (1997)",           area:"employment",    principle:"Sexual harassment at workplace guidelines (precursor to POSH Act)", court:"Supreme Court of India" },
        { name:"K.S. Puttaswamy v. Union of India (2017)",       area:"privacy",       principle:"Right to Privacy is a fundamental right under Article 21", court:"Supreme Court of India" },
        { name:"Navtej Singh Johar v. Union of India (2018)",    area:"constitutional", principle:"Section 377 IPC struck down — consensual same-sex relations decriminalised", court:"Supreme Court of India" },
        { name:"State of Bihar v. Project Uchcha Vidya (2008)", area:"contract",       principle:"Doctrine of frustration — contract discharged when performance becomes impossible", court:"Supreme Court of India" }
    ],
    international: [
        { name:"Donoghue v. Stevenson (1932)",     area:"tort",     principle:"Neighbour principle — basis of modern negligence law", court:"UK House of Lords" },
        { name:"Carlill v. Carbolic Smoke Ball Co (1893)", area:"contract", principle:"Offers to the world — unilateral contracts can be binding", court:"UK Court of Appeal" },
        { name:"Brown v. Board of Education (1954)", area:"constitutional", principle:"Racial segregation in public schools unconstitutional", court:"US Supreme Court" },
        { name:"eBay v. MercExchange (2006)",       area:"ip",       principle:"Patent injunctions not automatic — courts apply four-factor test", court:"US Supreme Court" },
        { name:"Google LLC v. Oracle America (2021)", area:"ip",     principle:"Java API copying by Google fair use under US copyright law", court:"US Supreme Court" }
    ]
};

const LEGAL_DATABASES = [
    { name:"Indian Kanoon",        url:"indiankanoon.org",     jurisdiction:"India",         free:true },
    { name:"Supreme Court India",  url:"sci.gov.in",           jurisdiction:"India",         free:true },
    { name:"Westlaw",              url:"westlaw.com",          jurisdiction:"Global",        free:false },
    { name:"LexisNexis",           url:"lexisnexis.com",       jurisdiction:"Global",        free:false },
    { name:"Canlii",               url:"canlii.org",           jurisdiction:"Canada",        free:true },
    { name:"Bailii",               url:"bailii.org",           jurisdiction:"UK/Ireland",    free:true },
    { name:"Google Scholar",       url:"scholar.google.com",   jurisdiction:"USA",           free:true }
];

function searchCaseLaw({ userId, query, jurisdiction = "india", area, limit = 5 }) {
    if (!userId || !query) return fail(AGENT, "userId and query required");
    auditLog(AGENT, userId, "case_law_search", { query, jurisdiction, area });

    const j     = jurisdiction.toLowerCase();
    const pool  = (LANDMARK_CASES[j] || []).concat(LANDMARK_CASES.international || []);
    const terms = query.toLowerCase().split(/\s+/);

    let results = pool.filter(c =>
        (area ? c.area === area.toLowerCase() : true) &&
        (terms.some(t => c.name.toLowerCase().includes(t) || c.principle.toLowerCase().includes(t) || c.area.includes(t)))
    ).slice(0, limit);

    if (!results.length) results = pool.filter(c => area ? c.area === area.toLowerCase() : true).slice(0, limit);

    const databases = LEGAL_DATABASES.filter(db => db.jurisdiction.toLowerCase().includes(j) || db.jurisdiction === "Global");

    return ok(AGENT, {
        query,
        jurisdiction,
        area,
        results,
        matchCount:   results.length,
        databases,
        searchLinks:  databases.map(db => ({ name: db.name, url: `https://${db.url}/search?q=${encodeURIComponent(query)}`, free: db.free })),
        note:         "Landmark cases shown. Use the databases above for comprehensive case law research."
    });
}

function getLandmarkCases({ jurisdiction = "india", area }) {
    if (!userId) return fail(AGENT, "userId required");
    const j   = jurisdiction.toLowerCase();
    let cases = [...(LANDMARK_CASES[j] || []), ...LANDMARK_CASES.international];
    if (area) cases = cases.filter(c => c.area === area.toLowerCase());
    return ok(AGENT, { jurisdiction, area, cases, databases: LEGAL_DATABASES });
}

// Override: allow calling without userId for reference lookup
function getLandmarkCasesPublic({ area, jurisdiction = "india" }) {
    const j   = jurisdiction.toLowerCase();
    let cases = [...(LANDMARK_CASES[j] || []), ...LANDMARK_CASES.international];
    if (area) cases = cases.filter(c => c.area === area.toLowerCase());
    return ok(AGENT, { cases, databases: LEGAL_DATABASES });
}

module.exports = { searchCaseLaw, getLandmarkCasesPublic, LEGAL_DATABASES };
