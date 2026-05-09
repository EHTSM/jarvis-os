"use strict";

const agents = {
    satelliteDataAI:       require("./satelliteDataAI.cjs"),
    spaceTrackingAgent:    require("./spaceTrackingAgent.cjs"),
    astronomyAI:           require("./astronomyAI.cjs"),
    spaceWeatherAI:        require("./spaceWeatherAI.cjs"),
    marsSimulationAgent:   require("./marsSimulationAgent.cjs"),
    spaceMissionPlanner:   require("./spaceMissionPlanner.cjs"),
    droneControlAI:        require("./droneControlAI.cjs"),
    roboticsControlSystem: require("./roboticsControlSystem.cjs"),
    autonomousVehicleAI:   require("./autonomousVehicleAI.cjs"),
    smartCityAI:           require("./smartCityAI.cjs"),
    trafficOptimization:   require("./trafficOptimization.cjs"),
    energyGridAI:          require("./energyGridAI.cjs"),
    renewableEnergyManager:require("./renewableEnergyManager.cjs"),
    climatePredictionAI:   require("./climatePredictionAI.cjs"),
    carbonTrackingAgent:   require("./carbonTrackingAgent.cjs"),
    environmentalAI:       require("./environmentalAI.cjs"),
    disasterPredictionAI:  require("./disasterPredictionAI.cjs"),
    oceanMonitoringAI:     require("./oceanMonitoringAI.cjs"),
    agriculturalAI:        require("./agriculturalAI.cjs"),
    foodSupplyChainAI:     require("./foodSupplyChainAI.cjs")
};

console.log(`[futureTech] ${Object.keys(agents).length} agents loaded`);

module.exports = agents;
