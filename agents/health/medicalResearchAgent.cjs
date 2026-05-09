"use strict";
/**
 * Medical Research Agent — provides educational health information from curated sources.
 * All content clearly labelled as educational. Not clinical guidance.
 */
const { ok, fail, accessLog } = require("./_healthStore.cjs");

const AGENT = "medicalResearchAgent";

const RESEARCH_TOPICS = {
    diabetes: {
        summary:   "Diabetes is a metabolic condition characterised by high blood sugar due to insufficient insulin production or action.",
        types:     ["Type 1 (autoimmune)", "Type 2 (lifestyle-related)", "Gestational", "MODY (rare genetic forms)"],
        keyFacts:  ["India has 77 million diabetics — 2nd highest in world","Type 2 is largely preventable through lifestyle changes","HbA1c < 7% is the typical management target"],
        management:["Diet modification","Physical activity","Medications (Metformin, Insulin, GLP-1 agonists)","Regular monitoring"],
        sources:   ["IDF Diabetes Atlas 2021","ICMR Diabetic Guidelines 2022","ADA Standards of Care 2023"]
    },
    hypertension: {
        summary:   "Hypertension (high blood pressure) is sustained blood pressure ≥130/80 mmHg. A major risk factor for heart disease and stroke.",
        keyFacts:  ["'Silent killer' — often has no symptoms","1 in 3 adults in India affected","Lifestyle changes alone can reduce BP by 10-15 mmHg"],
        management:["DASH diet (low sodium, high potassium)","Exercise 150 min/week","Weight loss","Antihypertensive medications as needed"],
        sources:   ["JNC 8 Guidelines","ESC/ESH 2018 Hypertension Guidelines","ICMR 2021"]
    },
    cancer: {
        summary:   "Cancer is characterised by uncontrolled cell growth. Most cancers are influenced by genetic + environmental factors.",
        keyFacts:  ["Most common in India: breast, cervical, oral, lung, colorectal","Regular screening catches most cancers early when curable","Tobacco causes 30% of all cancer deaths"],
        prevention:["No tobacco (smoked or chewed)","HPV vaccination for cervical cancer prevention","Regular screening per age/gender","Healthy weight and exercise"],
        sources:   ["WHO IARC","ICMR NCDIR Cancer Registry","NCCN Guidelines"]
    },
    mental_health: {
        summary:   "Mental health conditions include depression, anxiety, bipolar disorder, schizophrenia, OCD, PTSD, and more.",
        keyFacts:  ["1 in 4 people affected by mental illness lifetime","Depression is leading cause of disability worldwide","Treatment gap in India exceeds 80%"],
        treatments:["Psychotherapy (CBT, DBT, ACT)","Medications (antidepressants, mood stabilisers)","Lifestyle (exercise, sleep, social support)","Crisis services"],
        sources:   ["WHO MH Atlas 2020","NIMHANS Guidelines","The Lancet Psychiatry"]
    },
    covid: {
        summary:   "COVID-19 is a respiratory illness caused by SARS-CoV-2. Symptoms range from mild to severe.",
        keyFacts:  ["Vaccination significantly reduces severe disease and death","Long COVID affects 10-30% of infected","Masks reduce transmission in high-risk settings"],
        management:["Vaccination (updated boosters)","Antivirals (Paxlovid) for high-risk patients","Supportive care","Isolation when symptomatic"],
        sources:   ["WHO COVID-19 Dashboard","ICMR Guidelines","CDC"]
    }
};

function searchResearch({ userId, query, topic }) {
    if (!userId || (!query && !topic)) return fail(AGENT, "userId and query or topic required");
    accessLog(userId, AGENT, "research_searched", { query, topic });

    const key    = topic || query || "";
    const lower  = key.toLowerCase();

    // Match to topic
    const matched = Object.entries(RESEARCH_TOPICS).find(([k]) =>
        lower.includes(k) || k.includes(lower.replace(/\s+/g,"_"))
    );

    if (matched) {
        return ok(AGENT, {
            topic:     matched[0],
            data:      matched[1],
            important: "This is educational information only. For personalised medical guidance, consult a healthcare professional.",
            databases: ["PubMed (pubmed.ncbi.nlm.nih.gov)","WHO (who.int)","ICMR (icmr.gov.in)","MedlinePlus (medlineplus.gov)"]
        });
    }

    return ok(AGENT, {
        query,
        found: false,
        message:   "No specific research article found in our local database for this query.",
        guidance:  "For peer-reviewed research, visit: PubMed, Cochrane Library, or WHO website.",
        databases: ["pubmed.ncbi.nlm.nih.gov","cochranelibrary.com","who.int","uptodate.com"],
        availableTopics: Object.keys(RESEARCH_TOPICS)
    });
}

module.exports = { searchResearch };
