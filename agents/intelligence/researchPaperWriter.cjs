"use strict";
const { load, flush, uid, NOW, ok, fail, MAX_IDEAS, INTELLIGENCE_DISCLAIMER } = require("./_intelligenceStore.cjs");
const AGENT = "researchPaperWriter";

const PAPER_SECTIONS = ["Abstract","Introduction","Literature Review","Methodology","Results","Discussion","Conclusion","References"];

const CITATION_STYLES = { apa:"APA 7th Edition", mla:"MLA 9th Edition", chicago:"Chicago 17th Edition", ieee:"IEEE" };

const JOURNAL_TIERS = {
    A_STAR: { name:"A* (Top-tier)",  examples:["Nature","Science","Cell","NEJM","JMLR"], impactFactor:">15" },
    A:      { name:"A (High-impact)",examples:["PLOS ONE","IEEE Trans.","ACM SIGKDD"],   impactFactor:"5-15" },
    B:      { name:"B (Good)",       examples:["Springer journals","Elsevier domain-specific"], impactFactor:"2-5" },
    C:      { name:"C (Decent)",     examples:["Conference proceedings","Workshop papers"], impactFactor:"<2" }
};

function generatePaperOutline({ userId, title, domain, hypothesis, insights = [], methodology = "experimental", citationStyle = "apa" }) {
    if (!userId || !title) return fail(AGENT, "userId and title required");
    if (!CITATION_STYLES[citationStyle]) return fail(AGENT, `citationStyle must be: ${Object.keys(CITATION_STYLES).join(", ")}`);

    const h        = hypothesis?.hypothesis || hypothesis || `Investigating ${title}`;
    const top5     = insights.slice(0, MAX_IDEAS);
    const paperId  = uid("ppr");

    const sections = {
        abstract:     `This paper investigates ${title}. We hypothesize that ${h}. Using ${methodology} methodology, we examine key variables and present findings relevant to ${domain || "the field"}. Results suggest [findings to be added after experiments]. Implications for theory and practice are discussed.`,
        introduction: `The problem of ${title} is significant because [motivation]. Prior work has shown [gap]. This paper contributes [specific contribution]. We proceed as follows: [structure].`,
        literatureReview: `Relevant prior work includes: [citation 1], [citation 2], [citation 3]. Key gaps: the relationship between ${h} has not been systematically examined in ${domain || "this context"}.`,
        methodology: `${methodology.charAt(0).toUpperCase() + methodology.slice(1)} design. Independent variable: [X]. Dependent variable: [Y]. Control: [baseline]. Sample: [N subjects]. Statistical method: [test].`,
        results:     `Preliminary simulation results (n=simulated): ${top5.map((ins,i) => `Finding ${i+1}: ${(ins.thought || ins.hypothesis || ins).toString().slice(0,80)}`).join("; ") || "Results pending real-world experiments."}`,
        discussion:  `Findings support/refute [hypothesis]. Limitations: simulation-only; requires empirical validation. Future work: [extensions].`,
        conclusion:  `This paper presented ${title}. Key contribution: [specific claim]. Future directions: empirical study with real data, peer review, and replication.`,
        references:  `[All citations formatted in ${CITATION_STYLES[citationStyle]}. Minimum 20 peer-reviewed sources recommended for submission.]`
    };

    const recommendedJournals = Object.entries(JOURNAL_TIERS).slice(0,3).map(([tier, info]) => ({
        tier, name: info.name, examples: info.examples.slice(0,2), impactFactor: info.impactFactor
    }));

    const log = load(userId, "paper_registry", []);
    log.push({ paperId, title, domain, citationStyle, createdAt: NOW() });
    flush(userId, "paper_registry", log.slice(-200));

    return ok(AGENT, {
        paperId,
        title,
        domain:        domain || "Interdisciplinary",
        hypothesis:    h,
        sections:      PAPER_SECTIONS.map(s => ({ section:s, content: sections[s.toLowerCase().replace(/ /g,"")], wordTarget: s === "Introduction" ? 500 : s === "Methodology" ? 800 : 300 })),
        citationStyle: CITATION_STYLES[citationStyle],
        recommendedJournals,
        wordTarget:    4000,
        note:          "SIMULATION — this is a structural outline only. Real research, experiments, and citations are required before any submission.",
        disclaimer:    INTELLIGENCE_DISCLAIMER
    });
}

function getPaperStructure() {
    return ok(AGENT, { sections: PAPER_SECTIONS, citationStyles: Object.entries(CITATION_STYLES).map(([k,v]) => ({ key:k, name:v })), journalTiers: Object.entries(JOURNAL_TIERS).map(([k,v]) => ({ tier:k, ...v })), disclaimer: INTELLIGENCE_DISCLAIMER });
}

module.exports = { generatePaperOutline, getPaperStructure };
