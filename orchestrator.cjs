const axios = require("axios");
const { plannerAgent } = require("./agents/planner.cjs");
const executor = require("./agents/executor.cjs");
const { memoryAgent, getMemoryState, clearMemoryState } = require("./agents/memory.cjs");
const { scheduleTask } = require("./scheduler.cjs");
const { ContextEngine } = require("./agents/contextEngine.cjs");
const { LearningSystem } = require("./agents/learningSystem.cjs");
const { VoiceAgent } = require("./agents/voiceAgent.cjs");
const { DesktopAgent } = require("./agents/desktopAgent.cjs");
const { AgentFactory } = require("./agents/agentFactory.cjs");
const { EvolutionEngine } = require("./agents/evolutionEngine.cjs");

// Singleton instances for c
// ontext awareness and learning
const contextEngine = new ContextEngine();
const learningSystem = new LearningSystem();
const voiceAgent = new VoiceAgent();
const desktopAgent = new DesktopAgent();
const agentFactory = new AgentFactory();
const evolutionEngine = new EvolutionEngine(learningSystem, agentFactory);

async function callGroqAI(query, contextMessages = [], systemPrompt = null) {
    const defaultPrompt = "You are Jarvis AI with memory and context awareness. You plan tasks, execute safe actions, and answer unknown queries using AI.";

    const messages = [
        {
            role: "system",
            content: systemPrompt || defaultPrompt
        },
        ...contextMessages,
        {
            role: "user",
            content: query
        }
    ];

    const aiResponse = await axios.post(
        "https://api.groq.com/openai/v1/chat/completions",
        {
            model: "llama-3.3-70b-versatile",
            messages,
            temperature: 0.7
        },
        {
            headers: {
                "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
                "Content-Type": "application/json"
            }
        }
    );

    return aiResponse.data?.choices?.[0]?.message?.content || "";
}

function generateMemoryMessages() {
    const memoryState = getMemoryState();
    return memoryState.shortTerm.map((entry) => ({
        role: "system",
        content: `Previous interaction at ${entry.timestamp}: input="${entry.input}", tasks=[${entry.tasks.map((task) => task.type).join(", ")}], results=[${entry.results.map((item) => {
            if (typeof item === "string") return item;
            return JSON.stringify(item);
        }).join("; ")} ]`
    }));
}

async function orchestrator(input) {
    const startTime = Date.now();

    // Get context from previous interactions
    const contextData = contextEngine.getContextSummary();
    const contextPrompt = contextEngine.getContextPrompt();

    // Enhanced planner with context
    const tasks = plannerAgent(input, contextData);
    const results = [];
    const logs = [];
    let processedBy = "System";

    // Validate tasks array
    if (!Array.isArray(tasks) || tasks.length === 0) {
        logs.push("No tasks parsed from input");
        return {
            tasks: [],
            results: [],
            memory_status: null,
            logs
        };
    }

    logs.push(`Parsed ${tasks.length} task(s) from input`);

    // Execute all tasks sequentially - GUARANTEE each task runs
    for (let index = 0; index < tasks.length; index += 1) {
        const task = tasks[index];
        const taskIndex = index + 1;

        logs.push(`Task ${taskIndex}/${tasks.length}: Processing type="${task.type}" label="${task.label}"`);

        let taskResult = await executorAgent(task);

        if (taskResult && taskResult.type === "trigger") {
            // ✅ HANDLE TRIGGER SCHEDULING
            try {
                const scheduledResult = scheduleTask(taskResult, (action) => orchestrator(action));
                taskResult = {
                    ...taskResult,
                    scheduled: true,
                    ...scheduledResult
                };
                logs.push(`Task ${taskIndex} scheduled: ${taskResult.task_id}`);
            } catch (error) {
                taskResult.error = error.message;
                logs.push(`Task ${taskIndex} scheduling failed: ${error.message}`);
            }
        } else if (taskResult && taskResult.type === "clear_memory") {
            const cleared = clearMemoryState();
            taskResult = {
                type: "clear_memory",
                result: "Memory cleared",
                memory_status: cleared
            };
            logs.push(`Task ${taskIndex} executed: Memory cleared`);
        } else if (taskResult === null) {
            logs.push(`Task ${taskIndex} delegated to AI`);
            const contextMessages = generateMemoryMessages();
            // Add context-aware system prompt
            const systemPrompt = contextPrompt || "You are Jarvis AI with memory and context awareness. You plan tasks, execute safe actions, and answer unknown queries using AI.";
            const aiResponse = await callGroqAI(task.payload.query || input, contextMessages, systemPrompt);
            taskResult = {
                type: "ai",
                result: aiResponse
            };
            processedBy = "Groq AI";
            logs.push(`Task ${taskIndex} executed: AI response received`);
        } else {
            logs.push(`Task ${taskIndex} executed: ${task.type}`);
        }

        // Accumulate result for this task - each task gets its own result entry
        results.push({ task, result: taskResult });
    }

    logs.push(`Completed all ${tasks.length} task(s) successfully`);

    const memoryStatus = memoryAgent({
        input,
        tasks,
        results,
        processedBy
    });

    // Extract successful results for learning
    const successfulResults = results.filter(r => r.result && !r.result.error);
    const executionDuration = Date.now() - startTime;

    // 🧠 Learn from this interaction
    try {
        learningSystem.analyzeCommand(
            input,
            tasks,
            successfulResults.map(r => r.result),
            {
                success: successfulResults.length === results.filter(r => r.result).length,
                duration: executionDuration
            }
        );
    } catch (error) {
        logs.push(`⚠️  Learning update failed: ${error.message}`);
    }

    // 📝 Add to context history for future interactions
    try {
        contextEngine.addConversation(
            input,
            tasks,
            results,
            { processedBy, duration: executionDuration }
        );
    } catch (error) {
        logs.push(`⚠️  Context update failed: ${error.message}`);
    }

    // 🤖 Call Evolution Engine for auto-optimization suggestions
    let evolutionSuggestions = { suggestions: [] };
    try {
        const executionData = {
            tasks,
            results,
            duration: executionDuration
        };
        evolutionSuggestions = evolutionEngine.analyzeAndSuggest(executionData);
        logs.push(`🚀 Evolution analysis: ${evolutionSuggestions.suggestions.length} optimization opportunities detected`);
    } catch (error) {
        logs.push(`⚠️  Evolution engine error: ${error.message}`);
    }

    return {
        tasks,
        results,
        memory_status: memoryStatus,
        logs,
        suggestions: evolutionSuggestions.suggestions || [],
        evolution_analysis: evolutionSuggestions.analysis || {}
    };
}

module.exports = {
    orchestrator,
    getMemoryState,
    clearMemoryState,
    contextEngine,
    learningSystem,
    voiceAgent,
    desktopAgent,
    agentFactory,
    evolutionEngine
};
