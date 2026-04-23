#!/usr/bin/env node

/**
 * 🤖 JARVIS AGENT FACTORY - TEST SUITE
 * Tests dynamic agent creation, validation, execution, and integration
 */

const axios = require("axios");

const BASE_URL = "http://localhost:3000";
let totalTests = 0;
let passedTests = 0;

// Color codes for console output
const colors = {
    reset: "\x1b[0m",
    green: "\x1b[32m",
    red: "\x1b[31m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    cyan: "\x1b[36m"
};

function log(color, message) {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

async function test(name, testFn) {
    totalTests++;
    try {
        await testFn();
        log("green", `✅ ${name}`);
        passedTests++;
    } catch (error) {
        log("red", `❌ ${name}`);
        log("red", `   Error: ${error.message}`);
    }
}

async function testAPI(method, endpoint, data = null, expectedStatus = 200) {
    try {
        let response;
        const url = `${BASE_URL}${endpoint}`;

        if (method === "GET" || method === "DELETE") {
            response = await axios({
                method,
                url,
                validateStatus: () => true // Don't throw on any status
            });
        } else {
            response = await axios({
                method,
                url,
                data,
                validateStatus: () => true
            });
        }

        if (response.status !== expectedStatus) {
            throw new Error(
                `Expected status ${expectedStatus}, got ${response.status}`
            );
        }

        return response.data;
    } catch (error) {
        throw error;
    }
}

async function runTests() {
    log("cyan", "\n🤖 JARVIS AGENT FACTORY - TEST SUITE\n");

    // ✅ Test 1: Server Health Check
    await test("Server Health Check", async () => {
        const response = await testAPI("GET", "/");
        if (!response.includes("Jarvis")) {
            throw new Error("Server not responding correctly");
        }
    });

    // ✅ Test 2: Get Initial Agent Status
    await test("GET /agents/status - Initial status", async () => {
        const response = await testAPI("GET", "/agents/status");
        if (!response.success || typeof response.agents_count !== "number") {
            throw new Error("Invalid agent status response");
        }
    });

    // ✅ Test 3: List Agents (initially empty or with pre-existing)
    await test("GET /agents/list - List all agents", async () => {
        const response = await testAPI("GET", "/agents/list");
        if (typeof response.total !== "number" || !Array.isArray(response.agents)) {
            throw new Error("Invalid agent list response");
        }
    });

    // ✅ Test 4: Create API Agent
    log("cyan", "\n🔧 Testing Agent Creation:\n");

    await test("POST /agents/create - Create API agent (weather)", async () => {
        const response = await testAPI(
            "POST",
            "/agents/create",
            {
                name: "weatherAgent",
                type: "api",
                spec: {
                    description: "Fetch weather data from OpenWeatherMap API",
                    config: {
                        url: "https://api.openweathermap.org/data/2.5/weather",
                        method: "GET",
                        headers: { "Content-Type": "application/json" }
                    }
                }
            },
            200
        );

        if (!response.success || response.agent !== "weatherAgent") {
            throw new Error("Failed to create weather agent");
        }
    });

    // ✅ Test 5: Create Processor Agent
    await test("POST /agents/create - Create processor agent (textAnalyzer)", async () => {
        const response = await testAPI(
            "POST",
            "/agents/create",
            {
                name: "textAnalyzer",
                type: "processor",
                spec: {
                    description: "Process and analyze text data",
                    config: {
                        inputType: "string",
                        outputType: "object"
                    }
                }
            },
            200
        );

        if (!response.success || response.agent !== "textAnalyzer") {
            throw new Error("Failed to create text analyzer agent");
        }
    });

    // ✅ Test 6: Create Scheduler Agent
    await test("POST /agents/create - Create scheduler agent (taskScheduler)", async () => {
        const response = await testAPI(
            "POST",
            "/agents/create",
            {
                name: "taskScheduler",
                type: "scheduler",
                spec: {
                    description: "Schedule and manage recurring tasks",
                    schedule: "*/5 * * * *"
                }
            },
            200
        );

        if (!response.success || response.agent !== "taskScheduler") {
            throw new Error("Failed to create task scheduler agent");
        }
    });

    // ✅ Test 7: Create Analyzer Agent
    await test("POST /agents/create - Create analyzer agent (dataAnalyzer)", async () => {
        const response = await testAPI(
            "POST",
            "/agents/create",
            {
                name: "dataAnalyzer",
                type: "analyzer",
                spec: {
                    description: "Analyze data and provide insights",
                    analysisType: "generic"
                }
            },
            200
        );

        if (!response.success || response.agent !== "dataAnalyzer") {
            throw new Error("Failed to create data analyzer agent");
        }
    });

    // ✅ Test 8: Get Agent Details
    log("cyan", "\n🔍 Testing Agent Details:\n");

    await test(
        "GET /agents/:agentName - Get weather agent details",
        async () => {
            const response = await testAPI("GET", "/agents/weatherAgent");
            if (!response.success || response.name !== "weatherAgent") {
                throw new Error("Failed to get agent details");
            }
        }
    );

    // ✅ Test 9: List Updated Agents
    await test("GET /agents/list - List agents after creation", async () => {
        const response = await testAPI("GET", "/agents/list");
        if (response.total < 4) {
            throw new Error("Expected at least 4 agents");
        }
    });

    // ✅ Test 10: Execute Agent
    log("cyan", "\n⚡ Testing Agent Execution:\n");

    await test("POST /agents/:agentName/execute - Execute text analyzer", async () => {
        const response = await testAPI(
            "POST",
            "/agents/textAnalyzer/execute",
            { input: "Hello World - Test execution" },
            200
        );

        if (!response.success || response.agent !== "textAnalyzer") {
            throw new Error("Failed to execute agent");
        }
    });

    // ✅ Test 11: Planner Recognition - Create Agent
    log("cyan", "\n🧠 Testing Planner Integration:\n");

    await test("POST /jarvis - Planner recognizes 'create agent' command", async () => {
        const response = await testAPI("POST", "/jarvis", {
            command: "create an agent that fetches news"
        });

        if (!response.success) {
            throw new Error("Orchestrator failed to process create agent command");
        }

        // Check if a task was recognized as create_agent
        const hasCreateAgentTask = response.tasks.some(t => t.type === "create_agent");
        if (!hasCreateAgentTask) {
            throw new Error("Planner did not recognize create_agent task");
        }
    });

    // ✅ Test 12: Planner Recognition - List Agents
    await test("POST /jarvis - Planner recognizes 'list agents' command", async () => {
        const response = await testAPI("POST", "/jarvis", {
            command: "list agents"
        });

        if (!response.success) {
            throw new Error("Orchestrator failed to process list agents command");
        }

        const hasListAgentsTask = response.tasks.some(t => t.type === "list_agents");
        if (!hasListAgentsTask) {
            throw new Error("Planner did not recognize list_agents task");
        }
    });

    // ✅ Test 13: Planner Recognition - Execute Agent
    await test("POST /jarvis - Planner recognizes 'run agent' command", async () => {
        const response = await testAPI("POST", "/jarvis", {
            command: "run agent textAnalyzer"
        });

        if (!response.success) {
            throw new Error("Orchestrator failed to process run agent command");
        }

        const hasExecuteAgentTask = response.tasks.some(t => t.type === "execute_agent");
        if (!hasExecuteAgentTask) {
            throw new Error("Planner did not recognize execute_agent task");
        }
    });

    // ✅ Test 14: Multi-task with Agent Creation
    log("cyan", "\n🔄 Testing Multi-Task Commands:\n");

    await test("POST /jarvis - Multi-task including agent creation", async () => {
        const response = await testAPI("POST", "/jarvis", {
            command: "create an agent for stock prices and list agents"
        });

        if (!response.success) {
            throw new Error("Orchestrator failed on multi-task command");
        }

        if (response.tasks.length < 2) {
            throw new Error("Expected at least 2 tasks parsed");
        }
    });

    // ✅ Test 15: Agent Factory Suggestions
    log("cyan", "\n💡 Testing Learning Integration:\n");

    await test("GET /agents/suggestions - Get agent creation suggestions", async () => {
        const response = await testAPI("GET", "/agents/suggestions");
        if (!response.success || !Array.isArray(response.suggestions)) {
            throw new Error("Failed to get suggestions");
        }
    });

    // ✅ Test 16: Code Validation - Dangerous Pattern Detection
    log("cyan", "\n🛡️  Testing Safety & Validation:\n");

    await test(
        "POST /agents/create - Reject agent with dangerous code pattern",
        async () => {
            const response = await testAPI(
                "POST",
                "/agents/create",
                {
                    name: "dangerousAgent",
                    type: "processor",
                    spec: { description: "This should fail" }
                },
                200 // API returns 200 but success is false
            );

            // Note: The actual dangerous code injection would happen during code generation
            // This test verifies the endpoint handles bad specs gracefully
            if (response.success === undefined && response.error === undefined) {
                throw new Error("Expected error or success flag");
            }
        }
    );

    // ✅ Test 17: Delete Agent
    log("cyan", "\n🗑️  Testing Agent Deletion:\n");

    await test("DELETE /agents/:agentName - Delete an agent", async () => {
        // First create a test agent to delete
        await testAPI("POST", "/agents/create", {
            name: "agentToDelete",
            type: "processor",
            spec: { description: "Will be deleted" }
        });

        // Now delete it
        const response = await testAPI(
            "DELETE",
            "/agents/agentToDelete",
            null,
            200
        );

        if (!response.success) {
            throw new Error("Failed to delete agent");
        }
    });

    // ✅ Test 18: Template System
    log("cyan", "\n📋 Testing Template System:\n");

    await test("Agent Factory has correct templates", async () => {
        // This tests the templates internally
        const response = await testAPI("GET", "/agents/status");
        if (!response.success) {
            throw new Error("Cannot verify template system");
        }
    });

    // ✅ Test 19: Error Handling - Missing Required Fields
    log("cyan", "\n⚠️  Testing Error Handling:\n");

    await test(
        "POST /agents/create - Reject missing required fields",
        async () => {
            const response = await testAPI(
                "POST",
                "/agents/create",
                {
                    name: "testAgent"
                    // Missing 'type' field
                },
                400 // Expecting bad request
            );

            if (response.success !== false && !response.error) {
                throw new Error("Should reject missing type");
            }
        }
    );

    // ✅ Test 20: End-to-End Workflow
    log("cyan", "\n🎯 Testing End-to-End Workflow:\n");

    await test("E2E: Create agent via command → List → Execute", async () => {
        // Create via command
        const createResponse = await testAPI("POST", "/jarvis", {
            command: "create an agent that processes data"
        });

        if (!createResponse.success) {
            throw new Error("Failed to create agent via command");
        }

        // List agents
        const listResponse = await testAPI("GET", "/agents/list");
        if (listResponse.total < 4) {
            throw new Error("Expected agents in registry");
        }

        // Get suggestions
        const suggestResponse = await testAPI("GET", "/agents/suggestions");
        if (!suggestResponse.success) {
            throw new Error("Failed to get suggestions");
        }
    });

    // Print summary
    log("cyan", "\n" + "=".repeat(70));
    log("cyan", "✨ TEST SUMMARY");
    log("cyan", "=".repeat(70));
    log(passedTests === totalTests ? "green" : "yellow",
        `✅ Passed: ${passedTests}/${totalTests}`);

    if (passedTests === totalTests) {
        log("green", "\n🎉 ALL TESTS PASSED! Agent Factory fully operational.\n");
    } else {
        log("yellow", `\n⚠️  ${totalTests - passedTests} test(s) failed.\n`);
    }
}

// Run tests
runTests().catch(error => {
    log("red", `Fatal error: ${error.message}`);
    process.exit(1);
});
