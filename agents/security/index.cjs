"use strict";

const privacyManagerPro      = require("./privacyManagerPro.cjs");
const dataEncryptionAgent    = require("./dataEncryptionAgent.cjs");
const threatDetectionSystem  = require("./threatDetectionSystem.cjs");
const intrusionDetectionAgent= require("./intrusionDetectionAgent.cjs");
const firewallAI             = require("./firewallAI.cjs");
const malwareScanner         = require("./malwareScanner.cjs");
const phishingDetector       = require("./phishingDetector.cjs");
const identityProtectionAgent= require("./identityProtectionAgent.cjs");
const fraudDetectionSystem   = require("./fraudDetectionSystem.cjs");
const transactionMonitor     = require("./transactionMonitor.cjs");
const secureFileVault        = require("./secureFileVault.cjs");
const authChecker            = require("./authChecker.cjs");
const inputValidator         = require("./inputValidator.cjs");

const securityAgents = {
    privacyManagerPro,
    dataEncryptionAgent,
    threatDetectionSystem,
    intrusionDetectionAgent,
    firewallAI,
    malwareScanner,
    phishingDetector,
    identityProtectionAgent,
    fraudDetectionSystem,
    transactionMonitor,
    secureFileVault,
    authChecker,
    inputValidator
};

console.log(`Security agents loaded: ${Object.keys(securityAgents).length}`);
module.exports = securityAgents;
