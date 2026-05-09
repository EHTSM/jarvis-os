"use strict";

const agiSimulationCore      = require("./agiSimulationCore.cjs");
const multiBrainSystem        = require("./multiBrainSystem.cjs");
const parallelThinkingEngine  = require("./parallelThinkingEngine.cjs");
const selfReflectionAI        = require("./selfReflectionAI.cjs");
const memoryEvolutionEngine   = require("./memoryEvolutionEngine.cjs");
const intelligenceAmplifier   = require("./intelligenceAmplifier.cjs");
const creativityEngine        = require("./creativityEngine.cjs");
const curiosityEngine         = require("./curiosityEngine.cjs");
const explorationAI           = require("./explorationAI.cjs");
const learningAgent           = require("./learningAgent.cjs");
const thoughtGenerator        = require("./thoughtGenerator.cjs");
const ideaValidator           = require("./ideaValidator.cjs");
const innovationPipeline      = require("./innovationPipeline.cjs");
const hypothesisGenerator     = require("./hypothesisGenerator.cjs");
const scientificDiscoveryAI   = require("./scientificDiscoveryAI.cjs");
const researchPaperWriter     = require("./researchPaperWriter.cjs");
const experimentSimulator     = require("./experimentSimulator.cjs");
const quantumInterface        = require("./quantumInterface.cjs");
const advancedReasoningCore   = require("./advancedReasoningCore.cjs");

const intelligenceAgents = {
    agiSimulationCore,
    multiBrainSystem,
    parallelThinkingEngine,
    selfReflectionAI,
    memoryEvolutionEngine,
    intelligenceAmplifier,
    creativityEngine,
    curiosityEngine,
    explorationAI,
    learningAgent,
    thoughtGenerator,
    ideaValidator,
    innovationPipeline,
    hypothesisGenerator,
    scientificDiscoveryAI,
    researchPaperWriter,
    experimentSimulator,
    quantumInterface,
    advancedReasoningCore
};

console.log(`Intelligence agents loaded: ${Object.keys(intelligenceAgents).length}`);
module.exports = intelligenceAgents;
