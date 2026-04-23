/**
 * contextEngine: Maintains conversation context and historical awareness
 * Tracks last 10 conversations for context-aware responses
 */

class ContextEngine {
    constructor() {
        this.conversationHistory = [];
        this.maxHistorySize = 10;
        this.currentSession = {
            startTime: new Date(),
            queryCount: 0,
            tasks: [],
            patterns: []
        };
    }

    /**
     * Add a conversation to history
     */
    addConversation(input, tasks, results, metadata = {}) {
        const conversation = {
            timestamp: new Date().toISOString(),
            input,
            taskCount: tasks.length,
            taskTypes: tasks.map(t => t.type),
            resultCount: results.length,
            executedBy: metadata.processedBy || "System",
            duration: metadata.duration || 0,
            ...metadata
        };

        this.conversationHistory.push(conversation);

        // Maintain max history size
        if (this.conversationHistory.length > this.maxHistorySize) {
            this.conversationHistory.shift();
        }

        // Update session stats
        this.currentSession.queryCount++;
        this.currentSession.tasks.push(...tasks.map(t => t.type));

        return conversation;
    }

    /**
     * Get conversation history
     */
    getHistory() {
        return this.conversationHistory;
    }

    /**
     * Get last N conversations
     */
    getLastConversations(n = 5) {
        return this.conversationHistory.slice(-n);
    }

    /**
     * Find similar past conversations
     */
    findSimilar(input, threshold = 0.3) {
        const inputWords = input.toLowerCase().split(/\s+/);
        const similarities = this.conversationHistory.map(conv => {
            const convWords = conv.input.toLowerCase().split(/\s+/);
            const commonWords = inputWords.filter(w => convWords.includes(w));
            const similarity = commonWords.length / Math.max(inputWords.length, convWords.length);
            return {
                conversation: conv,
                similarity,
                commonWords
            };
        });

        return similarities
            .filter(s => s.similarity >= threshold)
            .sort((a, b) => b.similarity - a.similarity);
    }

    /**
     * Get context summary for AI
     */
    getContextSummary(detailed = false) {
        if (this.conversationHistory.length === 0) {
            return "No conversation history yet.";
        }

        const summary = {
            total_conversations: this.conversationHistory.length,
            recent_tasks: this.conversationHistory.slice(-3).map(c => c.taskTypes).flat(),
            most_common_types: this.getMostCommonTaskTypes(5),
            session_duration: new Date() - this.currentSession.startTime,
            queries_in_session: this.currentSession.queryCount
        };

        if (detailed) {
            summary.recent_history = this.conversationHistory.slice(-5);
        }

        return summary;
    }

    /**
     * Get most common task types
     */
    getMostCommonTaskTypes(limit = 5) {
        const typeCounts = {};
        this.conversationHistory.forEach(conv => {
            conv.taskTypes.forEach(type => {
                typeCounts[type] = (typeCounts[type] || 0) + 1;
            });
        });

        return Object.entries(typeCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, limit)
            .map(([type, count]) => ({ type, count }));
    }

    /**
     * Get user behavior patterns
     */
    getUserPatterns() {
        return {
            total_interactions: this.conversationHistory.length,
            average_tasks_per_query: this.conversationHistory.length > 0
                ? this.currentSession.tasks.length / this.conversationHistory.length
                : 0,
            common_task_types: this.getMostCommonTaskTypes(10),
            last_interaction: this.conversationHistory[this.conversationHistory.length - 1]?.timestamp,
            session_start: this.currentSession.startTime.toISOString()
        };
    }

    /**
     * Get context as prompt for AI
     */
    getContextPrompt() {
        const patterns = this.getMostCommonTaskTypes(3);
        const recentTypes = this.conversationHistory.slice(-5).flatMap(c => c.taskTypes);

        let prompt = "Based on conversation history:\n";
        prompt += `- User has executed ${this.conversationHistory.length} queries so far\n`;

        if (patterns.length > 0) {
            prompt += `- Most common actions: ${patterns.map(p => p.type).join(", ")}\n`;
        }

        if (recentTypes.length > 0) {
            prompt += `- Recent focus: ${recentTypes.slice(-3).join(", ")}\n`;
        }

        prompt += "- Use this context to provide more relevant responses.\n";

        return prompt;
    }

    /**
     * Clear history (for privacy or testing)
     */
    clearHistory() {
        this.conversationHistory = [];
        this.currentSession = {
            startTime: new Date(),
            queryCount: 0,
            tasks: [],
            patterns: []
        };
    }

    /**
     * Get session statistics
     */
    getSessionStats() {
        return {
            session_start: this.currentSession.startTime.toISOString(),
            session_duration_ms: new Date() - this.currentSession.startTime,
            total_queries: this.currentSession.queryCount,
            total_tasks: this.currentSession.tasks.length,
            unique_task_types: new Set(this.currentSession.tasks).size,
            conversation_history_size: this.conversationHistory.length,
            memory_usage: {
                history_entries: this.conversationHistory.length,
                max_history: this.maxHistorySize
            }
        };
    }
}

module.exports = {
    ContextEngine
};
