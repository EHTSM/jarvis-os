"use strict";

const brainComputerInterfaceAgent  = require("./brainComputerInterfaceAgent.cjs");
const neuralLinkSimulation         = require("./neuralLinkSimulation.cjs");
const thoughtToTextAgent           = require("./thoughtToTextAgent.cjs");
const emotionSyncEngine            = require("./emotionSyncEngine.cjs");
const personalityCloneAI           = require("./personalityCloneAI.cjs");
const digitalTwinCreator           = require("./digitalTwinCreator.cjs");
const memoryBackupAI               = require("./memoryBackupAI.cjs");
const lifeLoggerAgent              = require("./lifeLoggerAgent.cjs");
const personalHistoryAI            = require("./personalHistoryAI.cjs");
const legacyAISystem               = require("./legacyAISystem.cjs");
const voicePersonalityClone        = require("./voicePersonalityClone.cjs");
const behaviourSimulationAI        = require("./behaviourSimulationAI.cjs");
const identityReplicationAgent     = require("./identityReplicationAgent.cjs");
const avatarConsciousAI            = require("./avatarConsciousAI.cjs");
const virtualHumanCreator          = require("./virtualHumanCreator.cjs");
const metaverseAgent               = require("./metaverseAgent.cjs");
const digitalImmortalitySystem     = require("./digitalImmortalitySystem.cjs");
const aiCompanionPro               = require("./aiCompanionPro.cjs");
const relationshipSimulationAI     = require("./relationshipSimulationAI.cjs");
const emotionalIntelligenceCore    = require("./emotionalIntelligenceCore.cjs");

const humanAIAgents = {
    brainComputerInterfaceAgent,
    neuralLinkSimulation,
    thoughtToTextAgent,
    emotionSyncEngine,
    personalityCloneAI,
    digitalTwinCreator,
    memoryBackupAI,
    lifeLoggerAgent,
    personalHistoryAI,
    legacyAISystem,
    voicePersonalityClone,
    behaviourSimulationAI,
    identityReplicationAgent,
    avatarConsciousAI,
    virtualHumanCreator,
    metaverseAgent,
    digitalImmortalitySystem,
    aiCompanionPro,
    relationshipSimulationAI,
    emotionalIntelligenceCore
};

console.log(`HumanAI agents loaded: ${Object.keys(humanAIAgents).length}`);
module.exports = humanAIAgents;
