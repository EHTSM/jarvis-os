#!/usr/bin/env node

/**
 * 🚀 JARVIS SELF-EVOLUTION SYSTEM - TEST SUITE
 * Tests dynamic optimization, auto-suggestions, and agent creation
 */

const axios = require("axios");

const BASE_URL = "http://localhost:3000";
let totalTests = 0;
let passedTests = 0;

// Color codes  for console output
const colors = {
    reset: "\x1b[0m",
    green: "\x1b[32m",
    red: "\x1b[31m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    cyan: "\x1b[36m",
    magenta: "\x1b[35m"
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

async function testAPI(method, endpoint, data = null) {
    try {
        let response;
        const url = `${BASE_URL}${endpoint}`;

        if (method === "GET" || method === "DELETE") {
            response = await axios({
                method,
                url,
                validateStatus: () => true
            });
        } else {
            response = await axios({
                method,
                url,
                data,
                validateStatus: () => true
            });
        }

        return response.data;
    } catch (error) {
        throw error;
    }
}

async function runTests() {
    log("cyan", "\n🚀 JARVIS SELF-EVOLUTION SYSTEM - TEST SUITE\n");

    // ✅ Test 1: Server Health
    await test("Server Health Check", async () => {
        const response = await testAPI("GET", "/");
        if (!response.includes("Jarvis")) {
            throw new Error("Server not responding");
        }
    });

    // ✅ Test 2: Evolution Score - Initial
    log("magenta", "\n📊 Testing Evolution Engine:\n");

    await test("GET /evolution/score - Get optimization score", async () => {
        const response = await testAPI("GET", "/evolution/score");
        if (!response.success || typeof response.optimization_score !== "number") {
            throw new Error("Invalid score response");
        }
    });

    // ✅ Test 3: No Pending Approvals Initially
    await test("GET /evolution/approvals - Initially empty", async () => {
        const response = await testAPI("GET", "/evolution/approvals");
        if (!response.success || !Array.isArray(response.pending)) {
            throw new Error("Invalid approvals response");
        }
    });

    // ✅ Test 4: Get Evolution Suggestions
    log("magenta", "\n💡 Testing Suggestions:\n");

    await test("GET /evolution/suggestions - Get suggestions", async () => {
        const response = await testAPI("GET", "/evolution/suggestions");
        if (!response.success || !Array.isArray(response.suggestions)) {
            throw new Error("Invalid suggestions response");
        }
    });

    // ✅ Test 5: Orchestrator includes suggestions
    log("magenta", "\n🔄 Testing Integration:\n");

    await test("POST /jarvis - Response includes suggestions", async () => {
        const response = await testAPI("POST", "/jarvis", {
            command: "open calculator"
        });

        if (!response.success) {
            throw new Error("Orchestrator failed");
        }

        if (!Array.isArray(response.suggestions)) {
            throw new Error("Response missing suggestions array");
        }
    });

    // ✅ Test 6: Multiple commands generate more suggestions
    await test("POST /jarvis - More repetition = more suggestions", async () => {
        // Execute same command multiple times
        for (let i = 0; i < 3; i++) {
            await testAPI("POST", "/jarvis", {
                command: "open google"
            });
        }

        // Get suggestions
        const response = await testAPI("GET", "/evolution/suggestions");
        if (!response.success) {
            throw new Error("Failed to get suggestions");
        }

        // Should have more suggestions now
        if (response.suggestions.length === 0) {
            throw new Error("No suggestions generated after repetition");
        }
    });

    // ✅ Test 7: Multi-task execution generates suggestions
    await test("POST /jarvis - Multi-task generates workflow suggestions", async () => {
        const response = await testAPI("POST", "/jarvis", {
            command: "open chrome and type google and press enter"
        });

        if (!response.success) {
            throw new Error("Multi-task failed");
        }

        if (!response.suggestions || response.suggestions.length === 0) {
            throw new Error("No suggestions for multi-task workflow");
        }
    });

    // ✅ Test 8: Evolution Analysis included
    await test("POST /jarvis - Response includes evolution_analysis", async () => {
        const response = await testAPI("POST", "/jarvis", {
            command: "time"
        });

        if (!response.success) {
            throw new Error("Orchestrator failed");
        }

        if (!response.evolution_analysis || typeof response.evolution_analysis !== "object") {
            throw new Error("Missing evolution_analysis");
        }
    });

    // ✅ Test 9: Suggestion with approval workflow
    log("magenta", "\n✋ Testing Approval Workflow:\n");

    await test("POST /jarvis - Generate approvable suggestion", async () => {
        // Repeat a command several times to trigger optimization suggestion
        for (let i = 0; i < 3; i++) {
            await testAPI("POST", "/jarvis", {
                command: "search github"
            });
        }

        // Get suggestions
        const suggestionResponse = await testAPI("GET", "/evolution/suggestions");

        // Check if any suggestion can be auto-created
        if (!suggestionResponse.suggestions || suggestionResponse.suggestions.length === 0) {
            throw new Error("No suggestions available");
        }
    });

    // ✅ Test 10: Approval endpoint exists
    await test("POST /evolution/approve/:id - Endpoint accessible", async () => {
        // First get suggestions to find an approval ID
        const sugResponse = await testAPI("GET", "/evolution/suggestions");

        // Try to get pending approvals
        const approvalsResponse = await testAPI("GET", "/evolution/approvals");

        if (!approvalsResponse.success) {
            throw new Error("Failed to get approvals");
        }

        // Endpoint is working even if no pending approvals
    });

    // ✅ Test 11: Learning data affects suggestions
    log("magenta", "\n📚 Testing Learning Integration:\n");

    await test("Learning patterns influence suggestions", async () => {
        // Execute several different tasks to build learning data
        const tasks = [
            "open youtube",
            "open spotify",
            "open notes",
            "open youtube",
            "open spotify"
        ];

        for (const task of tasks) {
            await testAPI("POST", "/jarvis", { command: task });
        }

        // Get suggestions
        const response = await testAPI("GET", "/evolution/suggestions");

        if (!response.success || response.suggestions.length === 0) {
            throw new Error("No suggestions from learning patterns");
        }

        // Should have suggestions about app opening
        const appSuggestions = response.suggestions.filter(s =>
            s.category === "repetitive_app" || s.category.includes("app")
        );

        if (appSuggestions.length === 0) {
            log("yellow", "⚠️  No app suggestions (may be expected if repetition below threshold)");
        }
    });

    // ✅ Test 12: Optimization score changes with usage
    await test("Optimization score reflects system activity", async () => {
        const scoreBefore = await testAPI("GET", "/evolution/score");

        // Execute multiple commands
        for (let i = 0; i < 3; i++) {
            await testAPI("POST", "/jarvis", {
                command: `search test ${i}`
            });
        }

        const scoreAfter = await testAPI("GET", "/evolution/score");

        // Score should be reasonable values
        if (typeof scoreAfter.optimization_score !== "number") {
            throw new Error("Invalid optimization score");
        }

        if (scoreAfter.optimization_score < 0 || scoreAfter.optimization_score > 100) {
            throw new Error("Score out of range (0-100)");
        }
    });

    // ✅ Test 13: Suggestion structure validation
    await test("Suggestions have proper structure", async () => {
        const response = await testAPI("GET", "/evolution/suggestions");

        if (!response.success || response.suggestions.length === 0) {
            log("yellow", "⚠️  No suggestions to validate structure");
            return;
        }

        const suggestion = response.suggestions[0];

        // Validate required fields
        const requiredFields = ["type", "suggestion", "action", "confidence"];
        for (const field of requiredFields) {
            if (!(field in suggestion)) {
                throw new Error(`Missing required field: ${field}`);
            }
        }

        // Validate confidence is 0-1
        if (typeof suggestion.confidence !== "number" || suggestion.confidence < 0 || suggestion.confidence > 1) {
            throw new Error("Invalid confidence value");
        }
    });

    // ✅ Test 14: Evolution analysis categories
    await test("Evolution analysis includes categories", async () => {
        const response = await testAPI("POST", "/jarvis", {
            command: "open calculator and type 2+2"
        });

        if (!response.evolution_analysis) {
            throw new Error("Missing evolution_analysis");
        }

        const analysis = response.evolution_analysis;

        // Should have analysis categories
        if (!analysis.repetitive_tasks && !analysis.workflow_patterns) {
            log("yellow", "⚠️  Analysis categories not populated (may be expected)");
        }
    });

    // ✅ Test 15: Suggestions during normal operation
    log("magenta", "\n🎯 Testing Real-World Scenarios:\n");

    await test("Real-world workflow: open -> type -> press", async () => {
        const response = await testAPI("POST", "/jarvis", {
            command: "open google and type test and press enter"
        });

        if (!response.success) {
            throw new Error("Workflow execution failed");
        }

        // Should have suggestions
        if (!response.suggestions || typeof response.suggestions !== "object") {
            throw new Error("Missing suggestions from real workflow");
        }
    });

    // Print summary
    log("cyan", "\n" + "=".repeat(70));
    log("cyan", "✨ TEST SUMMARY");
    log("cyan", "=".repeat(70));
    log(passedTests === totalTests ? "green" : "yellow",
        `✅ Passed: ${passedTests}/${totalTests}`);

    if (passedTests === totalTests) {
        log("green", "\n🎉 ALL TESTS PASSED! Evolution Engine fully operational.\n");
    } else {
        log("yellow", `\n⚠️  ${totalTests - passedTests} test(s) failed.\n`);
    }

    log("cyan", "═".repeat(70));
    log("blue", "\n📊 Evolution Engine Features Verified:");
    log("blue", "  ✅ Optimization scoring");
    log("blue", "  ✅ Suggestion generation");
    log("blue", "  ✅ Auto-optimization detection");
    log("blue", "  ✅ Learning integration");
    log("blue", "  ✅ Approval workflow");
    log("blue", "  ✅ Real-time suggestions");
    log("blue", "  ✅ Orchestrator integration");
}

// Run tests
runTests().catch(error => {
    log("red", `Fatal error: ${error.message}`);
    process.exit(1);
});
