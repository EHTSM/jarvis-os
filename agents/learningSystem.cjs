/**
 * learningSystem: Analyzes user behavior and learns patterns
 * Stores learning data persistently for continuous improvement
 */

const fs = require("fs");
const path = require("path");

const LEARNING_FILE = path.join(__dirname, "../data/learning.json");

// Ensure data directory exists
const dataDir = path.dirname(LEARNING_FILE);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

class LearningSystem {
    constructor() {
        this.learningData = this.loadLearning();
        this.sessionStats = {
            commands_analyzed: 0,
            patterns_created: 0,
            suggestions_given: 0
        };
    }

    /**
     * Load learning data from persistent storage
     */
    loadLearning() {
        try {
            if (fs.existsSync(LEARNING_FILE)) {
                const data = fs.readFileSync(LEARNING_FILE, "utf8");
                return JSON.parse(data);
            }
        } catch (error) {
            console.log("⚠️  Could not load learning file, starting fresh");
        }

        return {
            frequency: {},           // Task type → count
            patterns: [],            // Common command patterns
            commandHistory: [],      // All executed commands
            habits: {},              // User habits
            successRate: {},         // Task type → success rate
            lastUpdated: new Date().toISOString()
        };
    }

    /**
     * Save learning data to persistent storage
     */
    saveLearning() {
        try {
            this.learningData.lastUpdated = new Date().toISOString();
            fs.writeFileSync(LEARNING_FILE, JSON.stringify(this.learningData, null, 2));
        } catch (error) {
            console.error("❌ Failed to save learning data:", error.message);
        }
    }

    /**
     * Analyze executed command and update learning
     */
    analyzeCommand(input, tasks, results, metadata = {}) {
        this.sessionStats.commands_analyzed++;

        // Track command frequency
        this.learningData.commandHistory.push({
            timestamp: new Date().toISOString(),
            input,
            tasks: tasks.map(t => t.type),
            success: metadata.success !== false,
            duration: metadata.duration || 0
        });

        // Keep only last 1000 commands
        if (this.learningData.commandHistory.length > 1000) {
            this.learningData.commandHistory = this.learningData.commandHistory.slice(-1000);
        }

        // Update task frequency
        tasks.forEach(task => {
            const type = task.type;
            this.learningData.frequency[type] = (this.learningData.frequency[type] || 0) + 1;

            // Track success rate
            if (!this.learningData.successRate[type]) {
                this.learningData.successRate[type] = { success: 0, total: 0 };
            }
            this.learningData.successRate[type].total++;
            if (metadata.success !== false) {
                this.learningData.successRate[type].success++;
            }
        });

        // Update patterns
        this.identifyPatterns(input, tasks);

        // Save to disk
        this.saveLearning();
    }

    /**
     * Identify patterns in commands
     */
    identifyPatterns(input, tasks) {
        const taskTypes = tasks.map(t => t.type).join("+");

        // Check if this pattern already exists
        let pattern = this.learningData.patterns.find(p => p.signature === taskTypes);

        if (pattern) {
            pattern.count++;
            pattern.examples.push(input);
            // Keep only last 10 examples
            pattern.examples = pattern.examples.slice(-10);
        } else {
            // Create new pattern
            pattern = {
                signature: taskTypes,
                count: 1,
                examples: [input],
                first_seen: new Date().toISOString(),
                learned: false
            };
            this.learningData.patterns.push(pattern);
            this.sessionStats.patterns_created++;
        }

        // Mark as learned if seen 3+ times
        if (pattern.count >= 3 && !pattern.learned) {
            pattern.learned = true;
            console.log(`🧠 Learned pattern: ${taskTypes} (seen ${pattern.count} times)`);
        }

        // Keep patterns sorted by frequency
        this.learningData.patterns.sort((a, b) => b.count - a.count);
    }

    /**
     * Get frequency analysis for a task type
     */
    getFrequency(taskType = null) {
        if (taskType) {
            return {
                type: taskType,
                count: this.learningData.frequency[taskType] || 0,
                percentage: this.getTotalCommands() > 0
                    ? ((this.learningData.frequency[taskType] || 0) / this.getTotalCommands() * 100).toFixed(2)
                    : 0
            };
        }

        return Object.entries(this.learningData.frequency)
            .map(([type, count]) => ({
                type,
                count,
                percentage: (count / this.getTotalCommands() * 100).toFixed(2)
            }))
            .sort((a, b) => b.count - a.count);
    }

    /**
     * Get learned patterns
     */
    getPatterns(limit = 10) {
        return this.learningData.patterns
            .filter(p => p.learned)
            .slice(0, limit)
            .map(p => ({
                signature: p.signature,
                count: p.count,
                examples: p.examples.slice(0, 3),
                first_seen: p.first_seen
            }));
    }

    /**
     * Get smart suggestions based on partial input
     */
    getSuggestions(partialInput) {
        const partial = partialInput.toLowerCase();
        const suggestions = [];

        // Suggest based on command history
        this.learningData.commandHistory
            .filter(cmd => cmd.input.toLowerCase().startsWith(partial))
            .slice(-5)
            .forEach(cmd => {
                suggestions.push({
                    suggestion: cmd.input,
                    source: "history",
                    frequency: this.learningData.frequency[cmd.tasks[0]] || 0
                });
            });

        // Suggest based on patterns
        this.learningData.patterns
            .filter(p => p.learned)
            .slice(0, 3)
            .forEach(p => {
                const example = p.examples[0];
                if (example.toLowerCase().includes(partial)) {
                    suggestions.push({
                        suggestion: example,
                        source: "pattern",
                        pattern: p.signature,
                        count: p.count
                    });
                }
            });

        // Suggest most frequent actions
        if (partial.length >= 2) {
            Object.entries(this.learningData.frequency)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .forEach(([action, count]) => {
                    suggestions.push({
                        suggestion: `${partialInput} ${action}`,
                        source: "frequent",
                        action,
                        count
                    });
                });
        }

        // Remove duplicates and sort by relevance
        const unique = [];
        const seen = new Set();
        suggestions.forEach(s => {
            if (!seen.has(s.suggestion)) {
                seen.add(s.suggestion);
                unique.push(s);
            }
        });

        return unique.slice(0, 5);
    }

    /**
     * Get user habits
     */
    getUserHabits() {
        const habits = {
            most_frequent_tasks: this.getFrequency().slice(0, 5),
            learned_patterns: this.getPatterns(5),
            total_commands: this.getTotalCommands(),
            unique_commands: new Set(this.learningData.commandHistory.map(c => c.input)).size,
            average_tasks_per_command: this.getAverageTasksPerCommand(),
            estimated_usage_level: this.estimateUsageLevel()
        };

        return habits;
    }

    /**
     * Get average tasks per command
     */
    getAverageTasksPerCommand() {
        if (this.learningData.commandHistory.length === 0) return 0;
        const totalTasks = this.learningData.commandHistory.reduce((sum, cmd) => sum + cmd.tasks.length, 0);
        return (totalTasks / this.learningData.commandHistory.length).toFixed(2);
    }

    /**
     * Estimate user usage level
     */
    estimateUsageLevel() {
        const total = this.getTotalCommands();
        if (total < 10) return "beginner";
        if (total < 50) return "intermediate";
        if (total < 200) return "advanced";
        return "expert";
    }

    /**
     * Get success rate for a task type
     */
    getSuccessRate(taskType = null) {
        if (taskType) {
            const stats = this.learningData.successRate[taskType];
            if (!stats) return 0;
            return (stats.success / stats.total * 100).toFixed(2);
        }

        return Object.entries(this.learningData.successRate)
            .map(([type, stats]) => ({
                type,
                success_rate: (stats.success / stats.total * 100).toFixed(2),
                successes: stats.success,
                total: stats.total
            }))
            .sort((a, b) => b.success_rate - a.success_rate);
    }

    /**
     * Get total commands analyzed
     */
    getTotalCommands() {
        return Object.values(this.learningData.frequency).reduce((a, b) => a + b, 0);
    }

    /**
     * Get learning statistics
     */
    getStats() {
        return {
            session: this.sessionStats,
            data: {
                total_commands_learned: this.getTotalCommands(),
                unique_tasks: Object.keys(this.learningData.frequency).length,
                patterns_learned: this.learningData.patterns.filter(p => p.learned).length,
                command_history_size: this.learningData.commandHistory.length,
                last_updated: this.learningData.lastUpdated
            }
        };
    }

    /**
     * Recommend optimization path for frequent tasks
     */
    getOptimizationSuggestions() {
        const suggestions = [];
        const frequency = this.getFrequency();

        // Suggest shortcuts for frequent tasks
        frequency.slice(0, 3).forEach(f => {
            if (f.count >= 5) {
                suggestions.push({
                    task: f.type,
                    frequency_count: f.count,
                    suggestion: `"${f.type}" is frequently used (${f.count} times). Consider creating a shortcut or alias.`,
                    optimization_type: "shortcut"
                });
            }
        });

        // Suggest multi-task combinations
        const patterns = this.learningData.patterns.filter(p => p.count >= 3);
        patterns.slice(0, 2).forEach(p => {
            suggestions.push({
                pattern: p.signature,
                frequency_count: p.count,
                suggestion: `Pattern "${p.signature}" detected. You often combine these tasks.`,
                optimization_type: "pattern"
            });
        });

        return suggestions;
    }

    /**
     * Clear all learning data (for privacy/reset)
     */
    clearLearning() {
        this.learningData = {
            frequency: {},
            patterns: [],
            commandHistory: [],
            habits: {},
            successRate: {},
            lastUpdated: new Date().toISOString()
        };
        this.saveLearning();
        console.log("🗑️  Learning data cleared");
    }

    /**
     * Export learning data
     */
    exportLearning() {
        return this.learningData;
    }
}

module.exports = {
    LearningSystem
};
