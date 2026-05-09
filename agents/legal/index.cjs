"use strict";

const legalAdvisorAI         = require("./legalAdvisorAI.cjs");
const contractAnalyzer       = require("./contractAnalyzer.cjs");
const caseLawSearchAgent     = require("./caseLawSearchAgent.cjs");
const legalDocumentGenerator = require("./legalDocumentGenerator.cjs");
const complianceChecker      = require("./complianceChecker.cjs");
const policyGenerator        = require("./policyGenerator.cjs");
const legalChatbot           = require("./legalChatbot.cjs");
const disputeResolutionAgent = require("./disputeResolutionAgent.cjs");
const arbitrationAgent       = require("./arbitrationAgent.cjs");
const ipProtectionAgent      = require("./ipProtectionAgent.cjs");
const copyrightProtection    = require("./copyrightProtection.cjs");
const patentSearchAgent      = require("./patentSearchAgent.cjs");
const licensingAgent         = require("./licensingAgent.cjs");
const termsGenerator         = require("./termsGenerator.cjs");
const consentManager         = require("./consentManager.cjs");

const legalAgents = {
    legalAdvisorAI,
    contractAnalyzer,
    caseLawSearchAgent,
    legalDocumentGenerator,
    complianceChecker,
    policyGenerator,
    legalChatbot,
    disputeResolutionAgent,
    arbitrationAgent,
    ipProtectionAgent,
    copyrightProtection,
    patentSearchAgent,
    licensingAgent,
    termsGenerator,
    consentManager
};

console.log(`Legal agents loaded: ${Object.keys(legalAgents).length}`);
module.exports = legalAgents;
