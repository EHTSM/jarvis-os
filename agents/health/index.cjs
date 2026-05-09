"use strict";
/**
 * Health Layer Index — loads all 41 health agents.
 * Health agents are routed via executor _buildHandlers() directly.
 * Idempotent: safe to require multiple times.
 */

const HEALTH_AGENTS = {
    // Core safety flow
    symptomChecker:           require("./symptomChecker.cjs"),
    triageAgent:              require("./triageAgent.cjs"),
    diagnosisSupportAgent:    require("./diagnosisSupportAgent.cjs"),
    doctorRecommendationAgent:require("./doctorRecommendationAgent.cjs"),

    // Medical management
    appointmentBookingAgent:  require("./appointmentBookingAgent.cjs"),
    medicalRecordManager:     require("./medicalRecordManager.cjs"),
    prescriptionAnalyzer:     require("./prescriptionAnalyzer.cjs"),
    drugInteractionChecker:   require("./drugInteractionChecker.cjs"),
    healthRiskPredictor:      require("./healthRiskPredictor.cjs"),

    // Fitness & nutrition
    fitnessMonitoringAgent:   require("./fitnessMonitoringAgent.cjs"),
    calorieCounterAgent:      require("./calorieCounterAgent.cjs"),
    dietRecommendationAgent:  require("./dietRecommendationAgent.cjs"),

    // Mental health
    mentalHealthAssistant:    require("./mentalHealthAssistant.cjs"),
    therapyChatbot:           require("./therapyChatbot.cjs"),
    stressAnalyzer:           require("./stressAnalyzer.cjs"),
    meditationCoach:          require("./meditationCoach.cjs"),
    sleepTherapyAgent:        require("./sleepTherapyAgent.cjs"),
    habitRecoveryAgent:       require("./habitRecoveryAgent.cjs"),
    addictionTracker:         require("./addictionTracker.cjs"),
    wellnessPlanner:          require("./wellnessPlanner.cjs"),

    // Specialized care
    yogaTrainerAgent:         require("./yogaTrainerAgent.cjs"),
    pregnancyCareAgent:       require("./pregnancyCareAgent.cjs"),
    childHealthTracker:       require("./childHealthTracker.cjs"),
    elderCareAgent:           require("./elderCareAgent.cjs"),

    // Emergency & finders
    emergencyAlertAgent:      require("./emergencyAlertAgent.cjs"),
    ambulanceFinder:          require("./ambulanceFinder.cjs"),
    hospitalFinder:           require("./hospitalFinder.cjs"),
    bloodDonorFinder:         require("./bloodDonorFinder.cjs"),

    // Research & tech
    medicalResearchAgent:     require("./medicalResearchAgent.cjs"),
    clinicalTrialFinder:      require("./clinicalTrialFinder.cjs"),
    genomicsFutureAgent:      require("./genomicsFutureAgent.cjs"),
    wearableDataAnalyzer:     require("./wearableDataAnalyzer.cjs"),
    healthDashboard:          require("./healthDashboard.cjs"),

    // Admin & advanced
    insuranceClaimAgent:      require("./insuranceClaimAgent.cjs"),
    medicalBillingAgent:      require("./medicalBillingAgent.cjs"),
    healthReportGenerator:    require("./healthReportGenerator.cjs"),
    doctorNotesAgent:         require("./doctorNotesAgent.cjs"),
    telemedicineAgent:        require("./telemedicineAgent.cjs"),
    healthChatSupport:        require("./healthChatSupport.cjs"),
    medicalImageAnalyzer:     require("./medicalImageAnalyzer.cjs"),
    radiologyAssistant:       require("./radiologyAssistant.cjs")
};

module.exports = HEALTH_AGENTS;
