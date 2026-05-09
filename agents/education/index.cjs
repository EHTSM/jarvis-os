/**
 * Education layer registry — registers all 20 education agents with agentManager.
 */

const agentManager = require("../multi/agentManager.cjs");

const EDU_AGENTS = {
    courseGenerator:     require("./courseGeneratorAgent.cjs"),
    lessonPlanner:       require("./lessonPlannerAgent.cjs"),
    quizGenerator:       require("./quizGeneratorAgent.cjs"),
    examSimulator:       require("./examSimulatorAgent.cjs"),
    doubtSolver:         require("./doubtSolverAgent.cjs"),
    notesGenerator:      require("./notesGeneratorAgent.cjs"),
    flashcard:           require("./flashcardAgent.cjs"),
    skillTracker:        require("./skillTrackerAgent.cjs"),
    certification:       require("./certificationAgent.cjs"),
    learningPath:        require("./learningPathAgent.cjs"),
    languageTutor:       require("./languageTutorAgent.cjs"),
    codingTutor:         require("./codingTutorAgent.cjs"),
    careerAdvisor:       require("./careerAdvisorAgent.cjs"),
    resumeBuilder:       require("./resumeBuilderAgent.cjs"),
    interviewCoach:      require("./interviewCoachAgent.cjs"),
    knowledgeTester:     require("./knowledgeTesterAgent.cjs"),
    bookSummary:         require("./bookSummaryAgent.cjs"),
    researchAssistant:   require("./researchAssistantAgent.cjs"),
    academicWriter:      require("./academicWriterAgent.cjs"),
    knowledgeGraph:      require("./knowledgeGraphAgent.cjs")
};

for (const [name, agent] of Object.entries(EDU_AGENTS)) {
    if (!agentManager.has(name)) {
        try {
            agentManager.register(name, agent, { category: "education", autoRegistered: true });
        } catch (err) {
            console.error(`[education/index] Failed to register ${name}:`, err.message);
        }
    }
}

module.exports = EDU_AGENTS;
