"use strict";

const auditTrailGenerator  = require("./auditTrailGenerator.cjs");
const governanceDashboard  = require("./governanceDashboard.cjs");
const regulationTracker    = require("./regulationTracker.cjs");
const riskComplianceAI     = require("./riskComplianceAI.cjs");
const governanceVotingAI   = require("./governanceVotingAI.cjs");
const daoManager           = require("./daoManager.cjs");
const transparencyEngine   = require("./transparencyEngine.cjs");
const ethicsAIMonitor      = require("./ethicsAIMonitor.cjs");
const blockchainVerification = require("./blockchainVerification.cjs");
const smartContractAgent   = require("./smartContractAgent.cjs");
const cryptoWalletManager  = require("./cryptoWalletManager.cjs");
const tokenizationAgent    = require("./tokenizationAgent.cjs");

const governanceAgents = {
    auditTrailGenerator,
    governanceDashboard,
    regulationTracker,
    riskComplianceAI,
    governanceVotingAI,
    daoManager,
    transparencyEngine,
    ethicsAIMonitor,
    blockchainVerification,
    smartContractAgent,
    cryptoWalletManager,
    tokenizationAgent
};

console.log(`Governance agents loaded: ${Object.keys(governanceAgents).length}`);
module.exports = governanceAgents;
