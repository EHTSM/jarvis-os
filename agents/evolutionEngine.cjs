/**
 * Evolution Engine - Self-Evolution & Optimization System
 * Analyzes usage patterns and auto-optimizes Jarvis capabilities
 * Detects repetitive tasks and suggests/creates agents
 */

class EvolutionEngine {
    constructor(learningSystem, agentFactory) {
        this.learningSystem = learningSystem;
        this.agentFactory = agentFactory;
        this.REPETITION_THRESHOLD = 3;
        this.executionTime = {};
        this.pendingApprovals = new Map(); // Store pending agent creation approvals
    }

    /**
     * Analyze current execution and generate suggestions
     * @param {object} executionData - Execution info {tasks, results, duration}
     * @returns {object} - Suggestions and optimization opportunities
     */
    analyzeAndSuggest(executionData) {
        const suggestions = [];

        try {
            // Get learning data
            const frequency = this.learningSystem.getFrequency();
            const habits = this.learningSystem.getUserHabits();

            // 1. Detect repetitive single tasks
            const repetitiveTasks = this.detectRepetitiveTasks(frequency);
            suggestions.push(...repetitiveTasks);

            // 2. Detect multi-step workflows
            const workflowOptimizations = this.detectWorkflowPatterns(habits);
            suggestions.push(...workflowOptimizations);

            // 3. Detect slow operations
            const slowOperations = this.detectSlowOperations(executionData);
            suggestions.push(...slowOperations);

            // 4. Detect API/Data patterns
            const apiPatterns = this.detectAPIPatterns(frequency);
            suggestions.push(...apiPatterns);

            // Filter and rank suggestions by priority/confidence
            return {
                suggestions: suggestions.slice(0, 5), // Top 5 suggestions
                total_opportunities: suggestions.length,
                analysis: {
                    repetitive_tasks: repetitiveTasks.length,
                    workflow_patterns: workflowOptimizations.length,
                    slow_operations: slowOperations.length
                }
            };
        } catch (error) {
            console.error("Evolution analysis error:", error.message);
            return { suggestions: [], error: error.message };
        }
    }

    /**
     * Detect tasks that are repeated 3+ times
     */
    detectRepetitiveTasks(frequency) {
        const suggestions = [];

        for (const task of frequency.slice(0, 20)) {
            if (task.count >= this.REPETITION_THRESHOLD) {
                // getFrequency() returns {type, count} — "task" field does not exist
                const taskName = String(task.type || task.task || "");

                // Detect specific patterns
                if (taskName.includes("open ")) {
                    const app = taskName.replace(/^open\s+/, "").trim();
                    suggestions.push({
                        type: "shortcut",
                        category: "repetitive_app",
                        task: taskName,
                        count: task.count,
                        suggestion: `You open "${app}" ${task.count} times. Create shortcut?`,
                        action: "create_shortcut",
                        payload: { app, agent_name: `${app}Shortcut` },
                        confidence: Math.min(0.95, 0.5 + task.count * 0.15),
                        priority: "medium"
                    });
                }

                // Detect search patterns
                if (taskName.includes("search ") || taskName.includes("find ")) {
                    suggestions.push({
                        type: "automation",
                        category: "search",
                        task: taskName,
                        count: task.count,
                        suggestion: `You search "${taskName}" ${task.count} times. Save as saved search?`,
                        action: "create_search_agent",
                        payload: { query: taskName },
                        confidence: Math.min(0.90, 0.5 + task.count * 0.15),
                        priority: "low"
                    });
                }

                // Detect generic patterns
                if (task.count >= 5) {
                    suggestions.push({
                        type: "agent",
                        category: "automation",
                        task: taskName,
                        count: task.count,
                        suggestion: `Detected "${taskName}" done ${task.count} times. Auto-optimize?`,
                        action: "auto_create_agent",
                        payload: { task_name: taskName, frequency: task.count },
                        confidence: Math.min(0.85, 0.4 + task.count * 0.12),
                        priority: "medium"
                    });
                }
            }
        }

        return suggestions;
    }

    /**
     * Detect multi-step workflow patterns
     */
    detectWorkflowPatterns(habits) {
        const suggestions = [];

        if (!habits || !habits.workflow_patterns) {
            return suggestions;
        }

        for (const [pattern, count] of Object.entries(habits.workflow_patterns)) {
            if (count >= 2) {
                const steps = pattern.split("+").length;

                if (steps >= 2) {
                    suggestions.push({
                        type: "workflow",
                        category: "multi_step",
                        pattern: pattern,
                        count: count,
                        suggestion: `Workflow "${pattern}" repeated ${count} times (${steps} steps). Create automation?`,
                        action: "create_workflow_agent",
                        payload: { workflow: pattern, frequency: count },
                        confidence: Math.min(0.88, 0.6 + count * 0.15),
                        priority: "high"
                    });
                }
            }
        }

        return suggestions;
    }

    /**
     * Detect slow operations
     */
    detectSlowOperations(executionData) {
        const suggestions = [];

        if (!executionData || !executionData.results) {
            return suggestions;
        }

        // Analyze task execution times
        const slowThreshold = 500; // ms
        const slowTasks = [];

        for (const result of executionData.results) {
            if (result.result && result.task) {
                const taskType = result.task.type;
                const duration = result.duration || 0;

                if (duration > slowThreshold && !this.executionTime[taskType]) {
                    slowTasks.push({
                        task: taskType,
                        duration: duration
                    });
                }
            }
        }

        if (slowTasks.length > 0) {
            const slowestTask = slowTasks.sort((a, b) => b.duration - a.duration)[0];

            suggestions.push({
                type: "performance",
                category: "slow_operation",
                task: slowestTask.task,
                duration: slowestTask.duration,
                suggestion: `Task "${slowestTask.task}" takes ${slowestTask.duration}ms. Optimize?`,
                action: "optimize_task",
                payload: { task_type: slowestTask.task },
                confidence: 0.70,
                priority: "low"
            });
        }

        return suggestions;
    }

    /**
     * Detect API/data fetching patterns
     */
    detectAPIPatterns(frequency) {
        const suggestions = [];

        const apiKeywords = ["fetch", "get", "api", "http", "data", "weather", "news"];
        const dataKeywords = ["process", "transform", "analyze", "parse", "filter"];

        let apiCount = 0;
        let dataCount = 0;

        for (const task of frequency.slice(0, 20)) {
            const taskLower = String(task.type || task.task || "").toLowerCase();

            if (apiKeywords.some(kw => taskLower.includes(kw))) {
                apiCount += task.count;
            }

            if (dataKeywords.some(kw => taskLower.includes(kw))) {
                dataCount += task.count;
            }
        }

        if (apiCount >= 5) {
            suggestions.push({
                type: "optimization",
                category: "api_patterns",
                task: "API Calls",
                count: apiCount,
                suggestion: `You frequently fetch external data (${apiCount} times). Create reusable API agent?`,
                action: "create_api_agent",
                payload: { agent_type: "api", pattern: "frequent_fetching" },
                confidence: 0.82,
                priority: "medium"
            });
        }

        if (dataCount >= 5) {
            suggestions.push({
                type: "optimization",
                category: "data_processing",
                task: "Data Processing",
                count: dataCount,
                suggestion: `You process data frequently (${dataCount} times). Create processor agent?`,
                action: "create_processor_agent",
                payload: { agent_type: "processor", pattern: "frequent_processing" },
                confidence: 0.80,
                priority: "medium"
            });
        }

        return suggestions;
    }

    /**
     * Generate agent creation from suggestion
     * Returns pending approval for safety
     */
    getSuggestionForApproval(suggestion) {
        if (!suggestion || !suggestion.action) {
            return null;
        }

        const approvalId = `approval_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Create pending approval
        this.pendingApprovals.set(approvalId, {
            suggestion: suggestion,
            created_at: new Date(),
            status: "pending"
        });

        return {
            approval_id: approvalId,
            suggestion: suggestion,
            message: `${suggestion.suggestion} Reply with: YES/NO to ${approvalId}`
        };
    }

    /**
     * Handle approval of a suggestion
     */
    async handleApproval(approvalId, approved) {
        const approval = this.pendingApprovals.get(approvalId);

        if (!approval) {
            return { success: false, error: "Approval not found" };
        }

        if (!approved) {
            this.pendingApprovals.delete(approvalId);
            return { success: false, message: "Approval rejected" };
        }

        // Execute the approved action
        const suggestion = approval.suggestion;
        let result = { success: false };

        try {
            switch (suggestion.action) {
                case "create_shortcut":
                case "create_search_agent":
                case "auto_create_agent":
                    result = await this.autoCreateAgent(suggestion);
                    break;

                case "create_workflow_agent":
                    result = await this.createWorkflowAgent(suggestion);
                    break;

                case "create_api_agent":
                    result = await this.createAPIAgent(suggestion);
                    break;

                case "create_processor_agent":
                    result = await this.createProcessorAgent(suggestion);
                    break;

                default:
                    result = { success: false, error: "Unknown action" };
            }

            if (result.success) {
                approval.status = "approved";
                this.pendingApprovals.delete(approvalId);
            }
        } catch (error) {
            result = { success: false, error: error.message };
        }

        return result;
    }

    /**
     * Auto-create agent from repetitive task
     */
    async autoCreateAgent(suggestion) {
        try {
            const taskName = suggestion.payload.task_name || suggestion.task;
            const agentName = this.generateAgentName(taskName);

            const spec = {
                description: `Auto-optimized agent for: ${taskName}`,
                config: {
                    original_task: taskName,
                    optimization_reason: "repetitive_pattern",
                    detected_frequency: suggestion.count
                }
            };

            // Determine agent type based on task
            let agentType = "processor"; // default

            if (taskName.includes("open ")) {
                agentType = "processor";
                spec.description = `Quick launcher for ${taskName}`;
            } else if (taskName.includes("search") || taskName.includes("fetch")) {
                agentType = "api";
            } else if (taskName.includes("analyze") || taskName.includes("process")) {
                agentType = "processor";
            }

            const result = this.agentFactory.createAgent(agentName, agentType, spec);

            if (result.success) {
                console.log(`✨ Auto-created ${agentType} agent: ${agentName}`);
                return {
                    success: true,
                    agent: agentName,
                    type: agentType,
                    message: `Auto-created "${agentName}" agent for optimization`
                };
            }

            return result;
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Create workflow automation agent
     */
    async createWorkflowAgent(suggestion) {
        try {
            const workflow = suggestion.payload.workflow;
            const agentName = this.generateAgentName(`workflow_${workflow.replace(/\s+/g, "_")}`);

            const spec = {
                description: `Automated workflow: ${workflow}`,
                config: {
                    workflow_pattern: workflow,
                    optimization_reason: "workflow_automation",
                    detected_frequency: suggestion.count
                }
            };

            const result = this.agentFactory.createAgent(agentName, "processor", spec);

            if (result.success) {
                console.log(`✨ Created workflow agent: ${agentName}`);
                return {
                    success: true,
                    agent: agentName,
                    message: `Automated workflow "${workflow}" with agent`
                };
            }

            return result;
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Create API agent for data fetching
     */
    async createAPIAgent(suggestion) {
        try {
            const agentName = this.generateAgentName("api_optimization");

            const spec = {
                description: "Auto-optimized API fetcher",
                config: {
                    optimization_reason: "frequent_api_calls",
                    pattern: "batch_fetch",
                    caching_enabled: true
                }
            };

            const result = this.agentFactory.createAgent(agentName, "api", spec);

            if (result.success) {
                console.log(`✨ Created API optimization agent: ${agentName}`);
                return {
                    success: true,
                    agent: agentName,
                    message: "Created API agent to optimize data fetching"
                };
            }

            return result;
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Create processor agent for data transformation
     */
    async createProcessorAgent(suggestion) {
        try {
            const agentName = this.generateAgentName("processor_optimization");

            const spec = {
                description: "Auto-optimized data processor",
                config: {
                    optimization_reason: "frequent_data_processing",
                    pattern: "transform_and_filter",
                    inputType: "array",
                    outputType: "object"
                }
            };

            const result = this.agentFactory.createAgent(agentName, "processor", spec);

            if (result.success) {
                console.log(`✨ Created processor optimization agent: ${agentName}`);
                return {
                    success: true,
                    agent: agentName,
                    message: "Created processor agent to optimize data processing"
                };
            }

            return result;
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Generate unique agent name from task
     */
    generateAgentName(task) {
        // Remove non-alphanumeric, convert to camelCase
        const cleaned = task
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, "")
            .replace(/\s+/g, "_")
            .replace(/_/g, " ")
            .trim()
            .split(" ")
            .map((word, idx) => (idx === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)))
            .join("");

        // Add timestamp for uniqueness
        const timestamp = Date.now().toString().slice(-6);
        return `${cleaned || "agent"}_${timestamp}`;
    }

    /**
     * Get system health & optimization score
     */
    getOptimizationScore() {
        try {
            const frequency = this.learningSystem.getFrequency();
            const habits = this.learningSystem.getUserHabits();

            let score = 50; // Base score

            // Repetition indicates opportunity for improvement (lower is better)
            const repetitionScore = frequency.slice(0, 10).reduce((sum, task) => {
                return sum + Math.min(task.count / 10, 1); // Normalize
            }, 0);

            score += Math.min(repetitionScore, 25); // Max +25 for patterns

            // Habit patterns indicate optimization opportunity
            const patternCount = Object.keys(habits.workflow_patterns || {}).length;
            score += Math.min(patternCount * 2, 25); // Max +25 for patterns

            // Cap at 100
            score = Math.min(score, 100);

            return {
                optimization_score: Math.round(score),
                areas: {
                    repetitive_tasks: repetitionScore > 0 ? "High" : "Low",
                    workflow_patterns: patternCount > 2 ? "High" : "Low",
                    opportunities: Math.max(
                        frequency.filter(f => f.count >= 3).length,
                        Object.keys(habits.workflow_patterns || {}).length,
                        0
                    )
                }
            };
        } catch (error) {
            return { optimization_score: 0, error: error.message };
        }
    }

    /**
     * Get pending approvals
     */
    getPendingApprovals() {
        const pending = [];

        for (const [id, approval] of this.pendingApprovals.entries()) {
            if (approval.status === "pending") {
                pending.push({
                    id,
                    suggestion: approval.suggestion,
                    created_at: approval.created_at
                });
            }
        }

        return pending;
    }
}

module.exports = { EvolutionEngine };
