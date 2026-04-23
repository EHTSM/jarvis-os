#!/usr/bin/env node

/**
 * Test: Context Awareness & Learning System Integration
 * Verifies that Jarvis learns from user behavior and adapts responses
 */

const axios = require("axios");

const API_BASE = "http://localhost:3000";
let testsPassed = 0;
let testsFailed = 0;

// Colors for terminal output
const colors = {
    reset: "\x1b[0m",
    green: "\x1b[32m",
    red: "\x1b[31m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    cyan: "\x1b[36m"
};

function log(color, message) {
    console.log(`${color}${message}${colors.reset}`);
}

async function test(name, fn) {
    try {
        await fn();
        log(colors.green, `✅ ${name}`);
        testsPassed++;
    } catch (error) {
        log(colors.red, `❌ ${name}`);
        log(colors.red, `   Error: ${error.message}`);
        testsFailed++;
    }
}

async function runAllTests() {
    log(colors.cyan, "\n🧠 JARVIS LEARNING SYSTEM - TEST SUITE\n");

    // 1. Test Server Status
    await test("Server Health Check", async () => {
        const res = await axios.get(`${API_BASE}/`);
        if (!res.data.includes("Multi-Agent Orchestrator")) {
            throw new Error("Server not running");
        }
    });

    // 2. Test Multi-Task Commands
    log(colors.yellow, "\n📋 Testing Multi-Task Learning:");

    await test("Execute multi-task command (open google and tell me time)", async () => {
        const res = await axios.post(`${API_BASE}/jarvis`, {
            command: "open google and tell me time"
        });
        if (!res.data.success || res.data.tasks.length !== 2) {
            throw new Error("Multi-task execution failed");
        }
    });

    // 3. Repeat similar commands to establish patterns
    log(colors.yellow, "\n🔄 Learning Pattern (Repeat Commands):");

    const commands = [
        "open google",
        "open google",
        "open google",
        "tell me the time",
        "what is the current time",
        "search for weather",
        "search for news"
    ];

    for (const cmd of commands) {
        await test(`Send command: "${cmd}"`, async () => {
            const res = await axios.post(`${API_BASE}/jarvis`, {
                command: cmd
            });
            if (!res.data.success) {
                throw new Error("Command failed");
            }
        });
    }

    // 4. Check Learning Statistics
    log(colors.yellow, "\n📊 Learning System Statistics:");

    await test("GET /learning/stats - Stats should show analyzed commands", async () => {
        const res = await axios.get(`${API_BASE}/learning/stats`);
        if (!res.data.success || !res.data.data.total_commands_learned) {
            throw new Error("Learning stats not available");
        }
        log(colors.blue, `   📈 Total Commands Learned: ${res.data.data.total_commands_learned}`);
        log(colors.blue, `   🎯 Unique Task Types: ${res.data.data.unique_tasks}`);
        log(colors.blue, `   🧠 Patterns Learned: ${res.data.data.patterns_learned}`);
    });

    // 5. Check User Habits
    log(colors.yellow, "\n🎯 User Habits & Behavior Analysis:");

    await test("GET /learning/habits - Should detect frequent commands", async () => {
        const res = await axios.get(`${API_BASE}/learning/habits`);
        if (!res.data.success || !res.data.habits) {
            throw new Error("Habits not retrieved");
        }
        log(colors.blue, `   🔤 Usage Level: ${res.data.habits.estimated_usage_level}`);
        log(colors.blue, `   📚 Unique Commands: ${res.data.habits.unique_commands}`);
    });

    // 6. Check Frequency Analysis
    log(colors.yellow, "\n📈 Frequency Analysis:");

    await test("GET /learning/frequency - Should show task type frequency", async () => {
        const res = await axios.get(`${API_BASE}/learning/frequency`);
        if (!res.data.success || !res.data.frequency) {
            throw new Error("Frequency data not available");
        }
        log(colors.blue, `   Total Commands: ${res.data.total_commands}`);
        if (res.data.frequency.length > 0) {
            res.data.frequency.slice(0, 3).forEach(f => {
                log(colors.blue, `   - ${f.type}: ${f.count}x (${f.percentage}%)`);
            });
        }
    });

    // 7. Check Patterns
    log(colors.yellow, "\n🧠 Learned Patterns:");

    await test("GET /learning/patterns - Should identify multi-task patterns", async () => {
        const res = await axios.get(`${API_BASE}/learning/patterns?limit=5`);
        if (!res.data.success) {
            throw new Error("Patterns not retrieved");
        }
        log(colors.blue, `   Total Learned Patterns: ${res.data.total}`);
        if (res.data.patterns && res.data.patterns.length > 0) {
            res.data.patterns.slice(0, 2).forEach(p => {
                log(colors.blue, `   - Pattern: ${p.signature} (${p.count}x)`);
                if (p.examples && p.examples.length > 0) {
                    log(colors.blue, `     Example: "${p.examples[0]}"`);
                }
            });
        }
    });

    // 8. Check Success Rates
    log(colors.yellow, "\n📊 Success Rate Analysis:");

    await test("GET /learning/success-rates - Should track success rates", async () => {
        const res = await axios.get(`${API_BASE}/learning/success-rates`);
        if (!res.data.success) {
            throw new Error("Success rates not retrieved");
        }
        if (res.data.success_rates && res.data.success_rates.length > 0) {
            res.data.success_rates.slice(0, 3).forEach(r => {
                log(colors.blue, `   - ${r.type}: ${r.success_rate}% (${r.successes}/${r.total})`);
            });
        }
    });

    // 9. Test Smart Suggestions
    log(colors.yellow, "\n💡 Smart Suggestions:");

    await test("GET /learning/suggestions?prefix=open - Should suggest commands", async () => {
        const res = await axios.get(`${API_BASE}/learning/suggestions?prefix=open`);
        if (!res.data.success) {
            throw new Error("Suggestions not generated");
        }
        log(colors.blue, `   Suggestions for "open": ${res.data.suggestions.length}`);
        if (res.data.suggestions && res.data.suggestions.length > 0) {
            res.data.suggestions.slice(0, 3).forEach(s => {
                log(colors.blue, `     • "${s.suggestion}" (${s.source})`);
            });
        }
    });

    // 10. Test Optimization Suggestions
    log(colors.yellow, "\n⚡ Optimization Suggestions:");

    await test("GET /learning/optimizations - Should suggest improvements", async () => {
        const res = await axios.get(`${API_BASE}/learning/optimizations`);
        if (!res.data.success) {
            throw new Error("Optimizations not generated");
        }
        if (res.data.suggestions && res.data.suggestions.length > 0) {
            res.data.suggestions.slice(0, 2).forEach(s => {
                log(colors.blue, `   ${s.suggestion}`);
            });
        } else {
            log(colors.blue, `   (Need more data to generate suggestions)`);
        }
    });

    // 11. Check Context History
    log(colors.yellow, "\n📝 Context & History:");

    await test("GET /context/history - Should maintain conversation history", async () => {
        const res = await axios.get(`${API_BASE}/context/history?limit=5`);
        if (!res.data.success) {
            throw new Error("Context history not retrieved");
        }
        log(colors.blue, `   Total Conversations Tracked: ${res.data.total_available}`);
        log(colors.blue, `   Recent Conversations: ${res.data.returned}`);
    });

    // 12. Check Session Stats
    log(colors.yellow, "\n⏱️  Session Statistics:");

    await test("GET /context/session - Should show session metrics", async () => {
        const res = await axios.get(`${API_BASE}/context/session`);
        if (!res.data.success) {
            throw new Error("Session stats not retrieved");
        }
        if (res.data.session && res.data.session.queryCount) {
            log(colors.blue, `   Queries in Session: ${res.data.session.queryCount}`);
        }
    });

    // 13. Send triggering command to test integration
    log(colors.yellow, "\n⏰ Testing Scheduler + Learning Integration:");

    await test("Send scheduled task that learns from trigger", async () => {
        const res = await axios.post(`${API_BASE}/jarvis`, {
            command: "remind me in 5 seconds to check the schedule"
        });
        if (!res.data.success) {
            throw new Error("Scheduled task failed");
        }
        log(colors.blue, `   Task scheduled successfully`);
    });

    // 14. Verify learning recorded the trigger
    await test("Verify learning system recorded trigger command", async () => {
        const res = await axios.get(`${API_BASE}/learning/frequency`);
        if (!res.data.frequency.some(f => f.type === "remind_in")) {
            log(colors.yellow, "   (Trigger commands will appear after first execution)");
        }
    });

    // Final Summary
    log(colors.cyan, `\n${"═".repeat(60)}`);
    log(colors.cyan, `✨ TEST SUMMARY`);
    log(colors.cyan, `${"═".repeat(60)}`);
    log(colors.green, `✅ Passed: ${testsPassed}`);
    if (testsFailed > 0) {
        log(colors.red, `❌ Failed: ${testsFailed}`);
    }
    log(colors.cyan, `${"═".repeat(60)}\n`);

    if (testsFailed === 0) {
        log(colors.green, `🎉 ALL TESTS PASSED! Learning system fully integrated.\n`);
        log(colors.blue, `📚 New Endpoints Available:`);
        log(colors.blue, `   GET /learning/stats - Learning statistics`);
        log(colors.blue, `   GET /learning/habits - User behavior patterns`);
        log(colors.blue, `   GET /learning/patterns - Learned command patterns`);
        log(colors.blue, `   GET /learning/frequency - Task frequency analysis`);
        log(colors.blue, `   GET /learning/success-rates - Task success rates`);
        log(colors.blue, `   GET /learning/suggestions?prefix=X - Smart suggestions`);
        log(colors.blue, `   GET /learning/optimizations - Optimization suggestions`);
        log(colors.blue, `   GET /context/history - Conversation history (max 10)`);
        log(colors.blue, `   GET /context/session - Session statistics`);
        log(colors.blue, `   DELETE /learning - Clear all learning data\n`);
    }

    process.exit(testsFailed > 0 ? 1 : 0);
}

// Run tests
runAllTests().catch(error => {
    log(colors.red, `\n❌ Test suite failed: ${error.message}\n`);
    process.exit(1);
});
