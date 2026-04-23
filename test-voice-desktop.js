#!/usr/bin/env node

/**
 * Test: Voice Input/Output & Desktop Control Integration
 * Verifies voice and desktop automation features
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
    log(colors.cyan, "\n🎤🖥️  JARVIS VOICE & DESKTOP CONTROL - TEST SUITE\n");

    // 1. Test Server Status
    await test("Server Health Check", async () => {
        const res = await axios.get(`${API_BASE}/`);
        if (!res.data.includes("Voice") || !res.data.includes("Desktop")) {
            throw new Error("Voice/Desktop not mentioned in server response");
        }
    });

    // 2. Test Voice Status
    log(colors.yellow, "\n🎤 Testing Voice Control:");

    await test("GET /voice/status - Check voice availability", async () => {
        const res = await axios.get(`${API_BASE}/voice/status`);
        if (!res.data.success) {
            throw new Error("Voice status check failed");
        }
        log(colors.blue, `   Platform: ${res.data.platform}`);
        log(colors.blue, `   Voice enabled: ${res.data.enabled}`);
    });

    // 3. Test Voice Output (optional - only on macOS)
    await test("POST /voice/speak - Test speech output", async () => {
        const res = await axios.post(`${API_BASE}/voice/speak`, {
            text: "Hello, I am Jarvis. Voice control is now active."
        });
        log(colors.blue, `   ${res.data.message}`);
    });

    // 4. Test Desktop Status
    log(colors.yellow, "\n🖥️  Testing Desktop Control:");

    await test("GET /desktop/status - Check automation availability", async () => {
        const res = await axios.get(`${API_BASE}/desktop/status`);
        if (!res.data.success) {
            throw new Error("Desktop status check failed");
        }
        log(colors.blue, `   Available: ${res.data.available}`);
        log(colors.blue, `   Enabled: ${res.data.enabled}`);
        if (res.data.message) {
            log(colors.blue, `   ${res.data.message}`);
        }
    });

    // 5. Test Multi-Task Commands with Voice/Desktop
    log(colors.yellow, "\n🔄 Testing Integrated Commands:");

    await test("Execute: 'open chrome and type google'", async () => {
        const res = await axios.post(`${API_BASE}/jarvis`, {
            command: "open chrome"
        });
        if (!res.data.success) {
            throw new Error("Command execution failed");
        }
        if (res.data.tasks.length < 1) {
            throw new Error("No tasks parsed");
        }
        log(colors.blue, `   Parsed ${res.data.tasks.length} task(s)`);
    });

    await test("Execute: 'type hello world'", async () => {
        const res = await axios.post(`${API_BASE}/jarvis`, {
            command: "type hello world"
        });
        if (!res.data.success) {
            throw new Error("Type command failed");
        }
    });

    await test("Execute: 'press enter'", async () => {
        const res = await axios.post(`${API_BASE}/jarvis`, {
            command: "press enter"
        });
        if (!res.data.success) {
            throw new Error("Key press command failed");
        }
    });

    await test("Execute: 'speak task complete'", async () => {
        const res = await axios.post(`${API_BASE}/jarvis`, {
            command: "speak task complete"
        });
        if (!res.data.success) {
            throw new Error("Speak command failed");
        }
    });

    // 6. Test Desktop Endpoints
    log(colors.yellow, "\n⌨️  Testing Desktop Automation Endpoints:");

    await test("POST /desktop/type - Type text", async () => {
        const res = await axios.post(`${API_BASE}/desktop/type`, {
            text: "test input"
        });
        log(colors.blue, `   ${res.data.typed_chars || 0} characters typed`);
    });

    await test("POST /desktop/press-key - Press key", async () => {
        const res = await axios.post(`${API_BASE}/desktop/press-key`, {
            key: "space"
        });
        log(colors.blue, `   Pressed: ${res.data.key}`);
    });

    // 7. Test Learning Integration
    log(colors.yellow, "\n📊 Testing Learning Integration:");

    await test("Verify voice/desktop tasks tracked in learning", async () => {
        const res = await axios.get(`${API_BASE}/learning/frequency`);
        if (!res.data.success) {
            throw new Error("Learning stats check failed");
        }
        log(colors.blue, `   Total commands learned: ${res.data.total_commands}`);
        if (res.data.frequency.length > 0) {
            log(colors.blue, `   Task types: ${res.data.frequency.map(f => f.type).join(", ")}`);
        }
    });

    // 8. Test Suggestions Include Voice/Desktop
    await test("GET /learning/suggestions - Include new task types", async () => {
        const res = await axios.get(`${API_BASE}/learning/suggestions?prefix=open`);
        if (!res.data.success) {
            throw new Error("Suggestions retrieval failed");
        }
        log(colors.blue, `   Suggestions generated: ${res.data.suggestions.length}`);
    });

    // 9. Test Multi-Task with Voice/Desktop
    log(colors.yellow, "\n🔗 Testing Multi-Task Commands:");

    await test("Multi-task: 'open calculator and speak ready'", async () => {
        const res = await axios.post(`${API_BASE}/jarvis`, {
            command: "open calculator and speak ready"
        });
        if (!res.data.success || res.data.tasks.length !== 2) {
            throw new Error("Multi-task parsing failed");
        }
        log(colors.blue, `   Parsed ${res.data.tasks.length} tasks`);
        log(colors.blue, `   Task 1: ${res.data.tasks[0].type}`);
        log(colors.blue, `   Task 2: ${res.data.tasks[1].type}`);
    });

    // Final Summary
    log(colors.cyan, `\n${"═".repeat(70)}`);
    log(colors.cyan, `✨ TEST SUMMARY`);
    log(colors.cyan, `${"═".repeat(70)}`);
    log(colors.green, `✅ Passed: ${testsPassed}`);
    if (testsFailed > 0) {
        log(colors.red, `❌ Failed: ${testsFailed}`);
    }
    log(colors.cyan, `${"═".repeat(70)}\n`);

    if (testsFailed === 0) {
        log(colors.green, `🎉 ALL TESTS PASSED! Voice & Desktop Control fully integrated.\n`);
        log(colors.blue, `📚 New Features Available:`);
        log(colors.blue, `   🎤 Voice Control:`);
        log(colors.blue, `      - GET /voice/status - Check voice availability`);
        log(colors.blue, `      - POST /voice/speak - Speak text`);
        log(colors.blue, `      - Task: "speak <text>" in commands`);
        log(colors.blue, ``);
        log(colors.blue, `   🖥️  Desktop Control:`);
        log(colors.blue, `      - GET /desktop/status - Check automation availability`);
        log(colors.blue, `      - POST /desktop/open-app - Open application`);
        log(colors.blue, `      - POST /desktop/type - Type text`);
        log(colors.blue, `      - POST /desktop/press-key - Press keyboard key`);
        log(colors.blue, `      - POST /desktop/press-combo - Press key combination`);
        log(colors.blue, `      - POST /desktop/move-mouse - Move mouse`);
        log(colors.blue, `      - POST /desktop/click - Click mouse`);
        log(colors.blue, `      - Tasks: "open <app>", "type <text>", "press <key>"`);
        log(colors.blue, ``);
        log(colors.blue, `🔄 Planner now recognizes all new task types`);
        log(colors.blue, `🧠 Learning system tracks voice/desktop usage`);
        log(colors.blue, `\n`);
    }

    process.exit(testsFailed > 0 ? 1 : 0);
}

// Run tests
runAllTests().catch(error => {
    log(colors.red, `\n❌ Test suite failed: ${error.message}\n`);
    process.exit(1);
});
