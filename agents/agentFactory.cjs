/**
 * Agent Factory - Dynamic Agent Generation System
 * Creates, validates, registers, and manages generated agents
 * Allows Jarvis to evolve by creating new capabilities on demand
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execSync } = require("child_process");

class AgentFactory {
    constructor(generatedDir = path.join(__dirname, "generated")) {
        this.generatedDir = generatedDir;
        this.registry = new Map(); // agentName → {config, instance, file}
        this.templates = this.initializeTemplates();
        this.codeValidators = this.initializeValidators();
        this.loadExistingAgents();
    }

    /**
     * Initialize standard agent templates
     */
    initializeTemplates() {
        return {
            // API-based agents (fetch data from external sources)
            api: {
                name: "API Agent Template",
                params: ["url", "method", "headers", "parser"],
                schema: `
class <<CLASSNAME>> {
    constructor() {
        this.name = "<<NAME>>";
        this.description = "<<DESCRIPTION>>";
        this.config = <<CONFIG>>;
    }

    async execute(input) {
        try {
            // Implement API call logic here
            const response = await fetch(this.config.url, {
                method: this.config.method || 'GET',
                headers: this.config.headers || {}
            });
            const data = await response.json();
            return this.parse(data, input);
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    parse(data, input) {
        // Implement data parsing logic here
        return { success: true, data };
    }
}

module.exports = { <<CLASSNAME>> };
                `
            },

            // Data processing agents
            processor: {
                name: "Data Processor Template",
                params: ["inputType", "outputType", "transformLogic"],
                schema: `
class <<CLASSNAME>> {
    constructor() {
        this.name = "<<NAME>>";
        this.description = "<<DESCRIPTION>>";
        this.inputType = "<<INPUTTYPE>>";
        this.outputType = "<<OUTPUTTYPE>>";
    }

    async execute(input) {
        try {
            const processed = await this.process(input);
            return { success: true, result: processed };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async process(input) {
        // Implement transformation logic here
        // Example: transform, filter, aggregate data
        return input;
    }
}

module.exports = { <<CLASSNAME>> };
                `
            },

            // Scheduled/timed agents
            scheduler: {
                name: "Scheduler Agent Template",
                params: ["schedule", "action", "condition"],
                schema: `
class <<CLASSNAME>> {
    constructor() {
        this.name = "<<NAME>>";
        this.description = "<<DESCRIPTION>>";
        this.schedule = "<<SCHEDULE>>"; // cron format or interval
        this.lastRun = null;
    }

    async shouldExecute() {
        // Implement schedule checking logic
        return true;
    }

    async execute(input) {
        try {
            const result = await this.performAction(input);
            this.lastRun = new Date();
            return { success: true, result };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async performAction(input) {
        // Implement scheduled action here
        return input;
    }
}

module.exports = { <<CLASSNAME>> };
                `
            },

            // Analysis agents
            analyzer: {
                name: "Analyzer Agent Template",
                params: ["analysisType", "metrics", "thresholds"],
                schema: `
class <<CLASSNAME>> {
    constructor() {
        this.name = "<<NAME>>";
        this.description = "<<DESCRIPTION>>";
        this.analysisType = "<<ANALYSISTYPE>>";
    }

    async execute(input) {
        try {
            const analysis = await this.analyze(input);
            return { success: true, analysis };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async analyze(input) {
        // Implement analysis logic here
        return {
            insights: [],
            metrics: {},
            recommendations: []
        };
    }
}

module.exports = { <<CLASSNAME>> };
                `
            }
        };
    }

    /**
     * Initialize code validators (for safety)
     */
    initializeValidators() {
        return {
            // Check for dangerous patterns
            dangerousPatterns: [
                /require\s*\(\s*['"]child_process['"]\s*\)/g, // child_process (unless wrapped)
                /eval\s*\(/g, // eval
                /Function\s*\(/g, // Function constructor
                /process\.exit/g, // process exit
                /fs\.unlinkSync|fs\.rmSync/g, // destructive filesystem
                /rm\s+-rf/g, // shell rm -rf
                /delete\s+process/g, // deleting process
            ],

            // Required patterns for safety
            requiredPatterns: [
                /class\s+\w+/g, // class definition
                /module\.exports\s*=/, // proper export
                /async\s+execute/g, // execute method
            ],

            // Complexity limits
            maxLines: 500,
            maxFunctionLength: 100,
        };
    }

    /**
     * Create a new agent from specification
     * @param {string} agentName - Name of the agent
     * @param {string} type - Template type (api, processor, scheduler, analyzer)
     * @param {object} spec - Agent specification
     * @returns {object} - Creation result
     */
    createAgent(agentName, type, spec) {
        try {
            // Validate input
            if (!agentName || !type) {
                return { success: false, error: "Agent name and type required" };
            }

            if (!this.templates[type]) {
                return {
                    success: false,
                    error: `Unknown template type: ${type}. Available: ${Object.keys(this.templates).join(", ")}`
                };
            }

            // Generate code
            const code = this.generateCode(agentName, type, spec);

            // Validate code
            const validation = this.validateCode(code);
            if (!validation.valid) {
                return { success: false, error: validation.errors.join("; ") };
            }

            // Save agent file
            const fileName = this.camelToKebab(agentName);
            const filePath = path.join(this.generatedDir, `${fileName}.js`);

            if (fs.existsSync(filePath)) {
                return {
                    success: false,
                    error: `Agent '${agentName}' already exists at ${filePath}`
                };
            }

            fs.writeFileSync(filePath, code, "utf8");
            console.log(`✨ Created agent: ${agentName} at ${filePath}`);

            // Register agent
            const registration = this.registerAgent(agentName, type, filePath, spec);

            if (!registration.success) {
                // Clean up file if registration failed
                fs.unlinkSync(filePath);
                return registration;
            }

            return {
                success: true,
                agent: agentName,
                file: filePath,
                type,
                instance: registration.instance
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Generate agent code from template
     */
    generateCode(agentName, type, spec) {
        const template = this.templates[type].schema;
        const className = this.toPascalCase(agentName);
        const config = JSON.stringify(spec.config || {}, null, 2);
        const description = spec.description || `Auto-generated ${type} agent`;

        let code = template
            .replace(/<<CLASSNAME>>/g, className)
            .replace(/<<NAME>>/g, agentName)
            .replace(/<<DESCRIPTION>>/g, description)
            .replace(/<<CONFIG>>/g, config)
            .replace(/<<INPUTTYPE>>/g, spec.inputType || "object")
            .replace(/<<OUTPUTTYPE>>/g, spec.outputType || "object")
            .replace(/<<ANALYSISTYPE>>/g, spec.analysisType || "generic")
            .replace(/<<SCHEDULE>>/g, spec.schedule || "*/5 * * * *");

        // Add metadata comment
        code = `/**
 * Auto-generated Agent: ${agentName}
 * Type: ${type}
 * Created: ${new Date().toISOString()}
 * Template: ${this.templates[type].name}
 */

${code}`;

        return code;
    }

    /**
     * Validate generated code for safety and correctness
     */
    validateCode(code) {
        const errors = [];

        // Check line count
        const lines = code.split("\n").length;
        if (lines > this.codeValidators.maxLines) {
            errors.push(
                `Code exceeds max lines (${lines} > ${this.codeValidators.maxLines})`
            );
        }

        // Check for dangerous patterns
        for (const pattern of this.codeValidators.dangerousPatterns) {
            if (pattern.test(code)) {
                errors.push(`Dangerous pattern detected: ${pattern}`);
            }
        }

        // Verify syntax
        try {
            new vm.Script(code);
        } catch (syntaxError) {
            errors.push(`Syntax error: ${syntaxError.message}`);
        }

        // Verify required patterns
        let requiredCount = 0;
        for (const pattern of this.codeValidators.requiredPatterns) {
            if (pattern.test(code)) {
                requiredCount++;
            }
        }

        if (requiredCount < this.codeValidators.requiredPatterns.length) {
            errors.push(
                "Missing required patterns (class definition, async execute, module.exports)"
            );
        }

        return {
            valid: errors.length === 0,
            errors,
            lineCount: lines
        };
    }

    /**
     * Register agent in registry and load instance
     */
    registerAgent(agentName, type, filePath, spec) {
        try {
            // Load the agent module
            delete require.cache[require.resolve(filePath)]; // Clear cache
            const agentModule = require(filePath);

            // Get class name
            const className = this.toPascalCase(agentName);
            const AgentClass =
                agentModule[className] ||
                agentModule.default ||
                Object.values(agentModule)[0];
            if (typeof AgentClass !== "function") {
                throw new Error("AgentClass is not a constructor");
            }

            // Create instance
            const instance = new AgentClass();

            // Register
            this.registry.set(agentName, {
                name: agentName,
                type,
                file: filePath,
                instance,
                config: spec,
                created: new Date(),
                status: "active"
            });

            console.log(`✅ Registered agent: ${agentName}`);

            return {
                success: true,
                instance
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Load all existing agents from generated directory
     */
    loadExistingAgents() {
        try {
            if (!fs.existsSync(this.generatedDir)) {
                return;
            }

            const files = fs
                .readdirSync(this.generatedDir)
                .filter((f) => f.endsWith(".js"));

            for (const file of files) {
                try {
                    const filePath = path.join(this.generatedDir, file);
                    const agentName = this.kebabToCamel(file.replace(".js", ""));

                    // Load module
                    delete require.cache[require.resolve(filePath)];
                    const agentModule = require(filePath);
                    const className = this.toPascalCase(agentName);
                    //
                    const AgentClass =
                        agentModule[className] ||
                        agentModule.default ||
                        Object.values(agentModule)[0];

                    if (typeof AgentClass !== "function") {
                        console.error("❌ Invalid AgentClass:", agentModule);
                        continue;
                    }
                    if (AgentClass) {
                        const instance = new AgentClass();
                        this.registry.set(agentName, {
                            name: agentName,
                            file: filePath,
                            instance,
                            status: "loaded",
                            created: fs.statSync(filePath).birthtime
                        });
                    }
                } catch (error) {
                    console.warn(
                        `⚠️  Failed to load agent ${file}: ${error.message}`
                    );
                }
            }

            console.log(
                `📦 Loaded ${this.registry.size} existing agents from ${this.generatedDir}`
            );
        } catch (error) {
            console.error(`Failed to load agents: ${error.message}`);
        }
    }

    /**
     * Execute an agent
     */
    async executeAgent(agentName, input) {
        const agent = this.registry.get(agentName);

        if (!agent) {
            return {
                success: false,
                error: `Agent '${agentName}' not found. Available: ${Array.from(this.registry.keys()).join(", ")}`
            };
        }

        try {
            const result = await agent.instance.execute(input);
            return {
                success: true,
                agent: agentName,
                result
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                agent: agentName
            };
        }
    }

    /**
     * List all registered agents
     */
    listAgents() {
        const agents = Array.from(this.registry.values()).map((agent) => ({
            name: agent.name,
            type: agent.type,
            status: agent.status,
            created: agent.created
        }));

        return {
            total: agents.length,
            agents
        };
    }

    /**
     * Get agent details
     */
    getAgent(agentName) {
        const agent = this.registry.get(agentName);

        if (!agent) {
            return { success: false, error: `Agent '${agentName}' not found` };
        }

        return {
            success: true,
            name: agent.name,
            type: agent.type,
            status: agent.status,
            file: agent.file,
            created: agent.created
        };
    }

    /**
     * Delete an agent
     */
    deleteAgent(agentName) {
        const agent = this.registry.get(agentName);

        if (!agent) {
            return { success: false, error: `Agent '${agentName}' not found` };
        }

        try {
            // Remove file
            if (fs.existsSync(agent.file)) {
                fs.unlinkSync(agent.file);
            }

            // Remove from registry
            this.registry.delete(agentName);

            console.log(`🗑️  Deleted agent: ${agentName}`);

            return { success: true, message: `Agent '${agentName}' deleted` };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Suggest agent creation based on learning patterns
     */
    suggestAgentCreation(learningData) {
        const suggestions = [];

        // Analyze usage patterns
        const frequently_used = Object.entries(learningData.frequency || {})
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5);

        // Check for repeated API patterns
        const apiPatterns = frequently_used.filter(([cmd]) =>
            cmd.includes("fetch") || cmd.includes("api") || cmd.includes("http")
        );

        if (apiPatterns.length > 3) {
            suggestions.push({
                type: "api",
                reason: "Frequent API calls detected",
                recommendation: `Create API Agent for ${apiPatterns[0][0]}`,
                confidence: 0.85
            });
        }

        // Check for data processing patterns
        const processingPatterns = frequently_used.filter(([cmd]) =>
            cmd.includes("process") || cmd.includes("transform") || cmd.includes("parse")
        );

        if (processingPatterns.length > 3) {
            suggestions.push({
                type: "processor",
                reason: "Frequent data processing detected",
                recommendation: `Create Processor Agent for ${processingPatterns[0][0]}`,
                confidence: 0.8
            });
        }

        // Check for scheduled patterns
        const scheduledPatterns = frequently_used.filter(([cmd]) =>
            cmd.includes("schedule") || cmd.includes("daily") || cmd.includes("every")
        );

        if (scheduledPatterns.length > 2) {
            suggestions.push({
                type: "scheduler",
                reason: "Frequent scheduling detected",
                recommendation:
                    "Create Scheduler Agent for automated tasks",
                confidence: 0.75
            });
        }

        return suggestions;
    }

    // Utility methods
    toPascalCase(str) {
        return str
            .replace(/(?:^\w|[A-Z]|\b\w)/g, (word) => word.toUpperCase())
            .replace(/[_-]/g, "");
    }

    camelToKebab(str) {
        return str.replace(/([a-z0-9]|(?=[A-Z]))([A-Z])/g, "$1-$2").toLowerCase();
    }

    kebabToCamel(str) {
        return str.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
    }
}

module.exports = { AgentFactory };