"use strict";

const metaverseBuilder        = require("./metaverseBuilder.cjs");
const worldGenerator3D        = require("./worldGenerator3D.cjs");
const vrInteractionAgent      = require("./vrInteractionAgent.cjs");
const virtualOfficeAI         = require("./virtualOfficeAI.cjs");
const virtualClassroom        = require("./virtualClassroom.cjs");
const digitalMarketplace      = require("./digitalMarketplace.cjs");
const nftGeneratorAI          = require("./nftGeneratorAI.cjs");
const nftTradingAgent         = require("./nftTradingAgent.cjs");
const virtualLandManager      = require("./virtualLandManager.cjs");
const avatarController3D      = require("./avatarController3D.cjs");
const gestureRecognition      = require("./gestureRecognition.cjs");
const motionCaptureAgent      = require("./motionCaptureAgent.cjs");
const virtualEventManager     = require("./virtualEventManager.cjs");
const metaverseEconomyAI      = require("./metaverseEconomyAI.cjs");
const virtualCurrencySystem   = require("./virtualCurrencySystem.cjs");
const crossWorldSync          = require("./crossWorldSync.cjs");
const digitalAssetManager     = require("./digitalAssetManager.cjs");
const virtualSecurityAI       = require("./virtualSecurityAI.cjs");
const realitySimulationEngine = require("./realitySimulationEngine.cjs");
const arOverlayAgent          = require("./arOverlayAgent.cjs");

const metaverseModules = {
    metaverseBuilder,
    worldGenerator3D,
    vrInteractionAgent,
    virtualOfficeAI,
    virtualClassroom,
    digitalMarketplace,
    nftGeneratorAI,
    nftTradingAgent,
    virtualLandManager,
    avatarController3D,
    gestureRecognition,
    motionCaptureAgent,
    virtualEventManager,
    metaverseEconomyAI,
    virtualCurrencySystem,
    crossWorldSync,
    digitalAssetManager,
    virtualSecurityAI,
    realitySimulationEngine,
    arOverlayAgent
};

console.log(`Metaverse modules loaded: ${Object.keys(metaverseModules).length}`);
module.exports = metaverseModules;
