"use strict";
const { load, flush, uid, NOW, ok, fail, MAX_IDEAS, INTELLIGENCE_DISCLAIMER } = require("./_intelligenceStore.cjs");
const AGENT = "scientificDiscoveryAI";

const DISCOVERY_TYPES = {
    observation:   { name:"Observation",    desc:"Describing an unexplained phenomenon" },
    classification:{ name:"Classification", desc:"Grouping phenomena by shared properties" },
    correlation:   { name:"Correlation",    desc:"Identifying co-variation between variables" },
    mechanism:     { name:"Mechanism",      desc:"Explaining HOW and WHY something occurs" },
    law:           { name:"Scientific Law",  desc:"Mathematical relationship confirmed across many experiments" },
    theory:        { name:"Theory",         desc:"Comprehensive explanation integrating many findings" }
};

const SCIENTIFIC_METHODS = [
    { step:1, name:"Observation",        action:"Document the phenomenon with as much detail as possible" },
    { step:2, name:"Question",           action:"Formulate a precise, testable research question" },
    { step:3, name:"Background",         action:"Review existing literature and prior findings" },
    { step:4, name:"Hypothesis",         action:"State a falsifiable prediction" },
    { step:5, name:"Experiment Design",  action:"Design controlled experiment with clear variables" },
    { step:6, name:"Data Collection",    action:"Collect and record measurements systematically" },
    { step:7, name:"Analysis",           action:"Apply appropriate statistical methods to the data" },
    { step:8, name:"Conclusion",         action:"Accept, reject, or refine hypothesis based on results" },
    { step:9, name:"Peer Review",        action:"Submit findings for independent replication and critique" },
    { step:10,name:"Publication",        action:"Publish findings with methodology for reproducibility" }
];

function frameDiscovery({ userId, phenomenon, domain, discoveryType = "observation", insights = [] }) {
    if (!userId || !phenomenon) return fail(AGENT, "userId and phenomenon required");
    if (!DISCOVERY_TYPES[discoveryType]) return fail(AGENT, `discoveryType must be: ${Object.keys(DISCOVERY_TYPES).join(", ")}`);

    const dtype     = DISCOVERY_TYPES[discoveryType];
    const topInsight= insights[0]?.thought || insights[0]?.hypothesis || insights[0] || phenomenon;

    const discoveryId = uid("sci");
    const discovery   = {
        discoveryId,
        phenomenon,
        domain:          domain || "unspecified",
        discoveryType:   dtype.name,
        typeDescription: dtype.desc,
        researchQuestion:`What is the underlying mechanism by which "${phenomenon}" produces measurable effects in ${domain || "its domain"}?`,
        methodology:     SCIENTIFIC_METHODS.slice(0, 5).map(s => ({ step:s.step, name:s.name, specificAction:`${s.action} for "${phenomenon}"` })),
        keyVariables: {
            independent: `Presence/absence or magnitude of "${phenomenon}"`,
            dependent:   "Measurable outcome metric",
            control:     "Baseline condition without intervention",
            confounds:   "Time, environment, observer bias, sample characteristics"
        },
        expectedSignal:  `If the hypothesis is correct, we expect to see a statistically significant (p<0.05) change in the dependent variable within a controlled setting.`,
        priorInsight:    topInsight ? String(topInsight).slice(0, 200) : null,
        publicationReadiness: "CONCEPT_STAGE",
        createdAt:       NOW()
    };

    const log = load(userId, "discovery_log", []);
    log.push({ discoveryId, phenomenon, domain, discoveryType, createdAt: NOW() });
    flush(userId, "discovery_log", log.slice(-500));

    return ok(AGENT, { ...discovery, disclaimer: INTELLIGENCE_DISCLAIMER, note: "SIMULATION — framing only; no real scientific research was conducted" });
}

function getScientificMethod() {
    return ok(AGENT, { steps: SCIENTIFIC_METHODS, discoveryTypes: Object.entries(DISCOVERY_TYPES).map(([k,v]) => ({ key:k, ...v })), disclaimer: INTELLIGENCE_DISCLAIMER });
}

module.exports = { frameDiscovery, getScientificMethod };
