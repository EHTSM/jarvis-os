"use strict";
const { ok, fail, accessLog } = require("./_healthStore.cjs");
const AGENT = "genomicsFutureAgent";

function getGenomicsInfo({ userId, topic }) {
    if (!userId) return fail(AGENT, "userId required");
    accessLog(userId, AGENT, "genomics_info_requested", { topic });

    const topics = {
        overview: {
            title:   "What is Genomic Medicine?",
            content: "Genomic medicine uses information from an individual's complete genetic material (genome) to tailor healthcare decisions. It moves away from 'one size fits all' toward personalised medicine.",
            applications: ["Cancer genomics — targeted therapies based on tumour mutations","Pharmacogenomics — matching drugs to genetic metabolism profiles","Hereditary disease risk (BRCA, Lynch syndrome, etc.)","Newborn screening for genetic conditions","Pathogen genomics (COVID variant tracking)"]
        },
        consumer_tests: {
            title:   "Consumer Genetic Tests (e.g. 23andMe, MyHeritage Health)",
            content: "Direct-to-consumer tests analyse specific genetic variants. They provide ancestry and some health risk information.",
            limitations: ["Do NOT replace clinical genetic testing","Detect only a subset of variants","Results need interpretation by genetic counsellor","Privacy and data security concerns with DTC companies"],
            advice:  "Discuss results with a clinical geneticist or genetic counsellor before making any health decisions."
        },
        pharmacogenomics: {
            title:   "Pharmacogenomics — Personalised Drug Therapy",
            content: "Your genes influence how your body processes medications. CYP450 enzyme variants affect metabolism of many common drugs.",
            examples: ["CYP2D6 variants affect codeine, tamoxifen, SSRIs","HLA-B*5701 — predicts abacavir hypersensitivity","DPYD variants — fluorouracil toxicity risk"],
            india:   "PGIMER Chandigarh and AIIMS offer pharmacogenomic testing panels."
        },
        future: {
            title:   "Future of Genomic Medicine",
            content: "The next decade will see routine genome sequencing entering clinical practice.",
            developments: ["Whole genome sequencing under $100 becoming standard","AI-powered variant interpretation","Gene therapy for monogenic disorders (sickle cell, haemophilia)","CAR-T cell therapy expansion","CRISPR clinical trials in rare diseases"]
        }
    };

    const key    = topic?.toLowerCase().replace(/\s+/g,"_") || "overview";
    const matched = topics[key] || topics.overview;

    return ok(AGENT, {
        data:       matched,
        available:  Object.keys(topics),
        disclaimer: "Genomic medicine is a rapidly evolving field. This is educational content only. Consult a clinical geneticist for personal genomic guidance.",
        centres:    ["AIIMS Genomics Core (New Delhi)","CCMB Hyderabad","IndiGen Programme (CSIR)","MedGenome Labs (Bangalore)"]
    });
}

module.exports = { getGenomicsInfo };
