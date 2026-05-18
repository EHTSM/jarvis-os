/**
 * 🤖 MASTER AGENT MANAGER (500 Agents)
 * Coordinates all specialized agents
 * Like Iron Man's FRIDAY/JARVIS system
 */

const SpecializedAgent = require('./SpecializedAgent.cjs');
const { generateAll500Agents } = require('./AgentGenerator.cjs');

class MasterAgentManager {
    constructor() {
        this.agents = new Map();
        this.agentsByDomain = new Map();
        this.taskQueue = [];
        this.completedTasks = [];
        this.learningMode = true;
        this.initialized = false;

        console.log('🚀 Initializing Master Agent Manager...');
    }

    /**
     * Initialize and create all 500 agents
     */
    async initialize() {
        console.log('\n╔══════════════════════════════════════════════════════════╗');
        console.log('║   🤖 JARVIS 500 AGENT SYSTEM - INITIALIZATION START    ║');
        console.log('╚══════════════════════════════════════════════════════════╝\n');

        try {
            // Generate all 500 agent configurations
            const agentConfigs = generateAll500Agents();

            // Create instances of all agents
            for (const [agentName, config] of Object.entries(agentConfigs)) {
                const agent = new SpecializedAgent(config);
                this.agents.set(agentName, agent);

                // Index by domain for faster lookup
                if (!this.agentsByDomain.has(config.domain)) {
                    this.agentsByDomain.set(config.domain, []);
                }
                this.agentsByDomain.get(config.domain).push(agentName);
            }

            this.initialized = true;

            console.log('\n✅ All 500 agents initialized successfully!\n');
            this.printSystemStatus();

            return true;
        } catch (error) {
            console.error('❌ Error initializing agents:', error);
            return false;
        }
    }

    /**
     * Get agent by name
     */
    getAgent(agentName) {
        return this.agents.get(agentName);
    }

    /**
     * Get all agents in a domain
     */
    getAgentsByDomain(domain) {
        return this.agentsByDomain.get(domain) || [];
    }

    /**
     * Route task to most appropriate agent(s)
     */
    async routeTask(task, targetDomain = null) {
        console.log(`\n📤 Routing task: ${task.name} (Type: ${task.type})`);

        if (!this.initialized) {
            console.error('❌ Agent system not initialized!');
            return null;
        }

        // Determine best agent(s) for this task
        const domain = targetDomain || task.domain;
        const agentsInDomain = this.getAgentsByDomain(domain);

        if (agentsInDomain.length === 0) {
            console.warn(`⚠️  No agents found for domain: ${domain}`);
            return null;
        }

        // Get best available agent
        const selectedAgent = this.selectBestAgent(agentsInDomain);

        if (!selectedAgent) {
            console.error('❌ Could not select agent for task');
            return null;
        }

        // Execute task with selected agent
        console.log(`✅ Selected agent: ${selectedAgent}`);
        const result = await this.executeTaskWithAgent(selectedAgent, task);

        return result;
    }

    /**
     * Select best agent based on performance metrics
     */
    selectBestAgent(agentNames) {
        let bestAgent = null;
        let bestScore = -1;

        for (const agentName of agentNames) {
            const agent = this.getAgent(agentName);
            if (!agent) continue;

            // Score = success_rate + (tasks_completed / 100)
            const score = agent.metrics.success_rate + (agent.metrics.tasks_completed / 100);

            if (score > bestScore) {
                bestScore = score;
                bestAgent = agentName;
            }
        }

        return bestAgent;
    }

    /**
     * Execute task with specific agent
     */
    async executeTaskWithAgent(agentName, task) {
        const agent = this.getAgent(agentName);

        if (!agent) {
            console.error(`❌ Agent not found: ${agentName}`);
            return null;
        }

        // Execute the task
        const result = await agent.executeTask(task);

        // Track completed task
        this.completedTasks.push({
            task: task.name,
            agent: agentName,
            result,
            timestamp: new Date().toISOString()
        });

        return {
            agent: agentName,
            task: task.name,
            ...result
        };
    }

    /**
     * Execute task with multiple agents (collaborative)
     */
    async executeTaskWithTeam(task, numberOfAgents = 3) {
        console.log(`\n👥 Team execution: Assigning ${numberOfAgents} agents to: ${task.name}`);

        // Get agents from different domains
        const domains = Array.from(this.agentsByDomain.keys());
        const selectedDomains = domains
            .sort(() => Math.random() - 0.5)
            .slice(0, Math.min(numberOfAgents, domains.length));

        const teamResults = [];

        for (const domain of selectedDomains) {
            const result = await this.routeTask(task, domain);
            if (result) {
                teamResults.push(result);
            }
        }

        console.log(`\n✅ Team completed task with ${teamResults.length} agents\n`);

        return {
            task: task.name,
            team_size: teamResults.length,
            results: teamResults
        };
    }

    /**
     * Enable continuous learning and improvement
     */
    async startContinuousLearning() {
        console.log('\n📚 Starting continuous learning mode...\n');

        const learningInterval = setInterval(async () => {
            console.log('🧠 Agents performing self-improvement cycle...');

            let improvementCount = 0;
            for (const [agentName, agent] of this.agents) {
                await agent.learnAndImprove();
                improvementCount++;
            }

            console.log(`✅ ${improvementCount} agents improved themselves!\n`);
        }, 60000); // Every minute (adjust as needed)

        return learningInterval;
    }

    /**
     * Get all agent statistics
     */
    getSystemStatistics() {
        const stats = {
            total_agents: this.agents.size,
            domains: this.agentsByDomain.size,
            total_tasks_completed: this.completedTasks.length,
            agents_by_domain: {},
            system_performance: {
                avg_success_rate: 0,
                avg_response_time: 0,
                total_learning_score: 0
            }
        };

        let totalSuccessRate = 0;
        let totalResponseTime = 0;
        let totalLearningScore = 0;

        for (const [domain, agents] of this.agentsByDomain) {
            stats.agents_by_domain[domain] = agents.length;
        }

        for (const [_, agent] of this.agents) {
            totalSuccessRate += agent.metrics.success_rate;
            totalResponseTime += agent.metrics.avg_response_time;
            totalLearningScore += agent.metrics.learning_score;
        }

        const agentCount = this.agents.size || 1;
        stats.system_performance.avg_success_rate = (totalSuccessRate / agentCount).toFixed(2);
        stats.system_performance.avg_response_time = Math.round(totalResponseTime / agentCount);
        stats.system_performance.total_learning_score = totalLearningScore;

        return stats;
    }

    /**
     * List all agents in the system
     */
    listAllAgents() {
        const agents = [];

        for (const [domain, agentNames] of this.agentsByDomain) {
            agents.push({
                domain,
                count: agentNames.length,
                agents: agentNames
            });
        }

        return agents;
    }

    /**
     * Print detailed system status
     */
    printSystemStatus() {
        const stats = this.getSystemStatistics();

        console.log('╔══════════════════════════════════════════════════════════╗');
        console.log('║         🤖 JARVIS 500 AGENT SYSTEM STATUS REPORT        ║');
        console.log('╚══════════════════════════════════════════════════════════╝\n');

        console.log(`📊 SYSTEM STATISTICS:`);
        console.log(`   Total Agents: ${stats.total_agents}`);
        console.log(`   Total Domains: ${stats.domains}`);
        console.log(`   Tasks Completed: ${stats.total_tasks_completed}`);

        console.log(`\n🎯 AGENT DISTRIBUTION BY DOMAIN:`);
        const domainEntries = Object.entries(stats.agents_by_domain)
            .sort((a, b) => b[1] - a[1]);

        domainEntries.forEach(([domain, count]) => {
            console.log(`   ${domain}: ${count} agents`);
        });

        console.log(`\n⚡ SYSTEM PERFORMANCE:`);
        console.log(`   Average Success Rate: ${stats.system_performance.avg_success_rate}%`);
        console.log(`   Average Response Time: ${stats.system_performance.avg_response_time}ms`);
        console.log(`   Total Learning Score: ${stats.system_performance.total_learning_score}`);

        console.log(`\n✅ System is ready for deployment!\n`);
    }

    /**
     * Test the system with sample tasks
     */
    async runDemoTasks() {
        console.log('\n🎬 Running demo tasks...\n');

        const demoTasks = [
            {
                name: 'Send Marketing Campaign',
                type: 'generate_content',
                domain: 'MARKETING',
                content_type: 'email_campaign'
            },
            {
                name: 'Process Financial Data',
                type: 'process_data',
                domain: 'FINANCE',
                data: { amount: 1000, type: 'expense' }
            },
            {
                name: 'Code Review',
                type: 'analyze',
                domain: 'DEVELOPMENT',
                target: 'pull_request_123'
            },
            {
                name: 'Customer Support Ticket',
                type: 'execute',
                domain: 'SUPPORT'
            },
            {
                name: 'Sales Lead Qualification',
                type: 'optimize',
                domain: 'SALES'
            }
        ];

        for (const task of demoTasks) {
            const result = await this.routeTask(task);
            console.log(`   Result: ${result.success ? '✅ SUCCESS' : '❌ FAILED'}`);
        }

        console.log('\n✅ Demo tasks completed!\n');
    }
}

// Export the manager
module.exports = MasterAgentManager;
// ============ STANDALONE EXECUTION ============

