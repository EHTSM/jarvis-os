const axios = require("axios");

const BASE_URL = "http://localhost:3000";

async function testServer() {
    console.log("🧪 Testing Jarvis Server with Multi-Agent Orchestrator\n");

    try {
        // Test 1: Health check
        console.log("Test 1: Health Check");
        const healthRes = await axios.get(`${BASE_URL}/`);
        console.log("✅ Status:", healthRes.data);
        console.log("");

        // Test 2: Multi-task request "and"
        console.log("Test 2: Multi-task request with 'and' separator");
        console.log("Request: open google and tell me time\n");
        const res1 = await axios.post(`${BASE_URL}/jarvis`, {
            command: "open google and tell me time"
        });
        console.log("✅ Tasks parsed:", res1.data.tasks.length);
        console.log("✅ Results generated:", res1.data.results.length);
        res1.data.tasks.forEach((task, idx) => {
            console.log(`   Task ${idx + 1}: ${task.type} - ${task.label}`);
        });
        res1.data.results.forEach((result, idx) => {
            console.log(`   Result ${idx + 1}: ${result.result.result}`);
        });
        console.log("Logs:", res1.data.logs);
        console.log("");

        // Test 3: Multi-task request with comma
        console.log("Test 3: Multi-task request with comma separator");
        console.log("Request: search node.js, search javascript, what time\n");
        const res2 = await axios.post(`${BASE_URL}/jarvis`, {
            command: "search node.js, search javascript, what time"
        });
        console.log("✅ Tasks parsed:", res2.data.tasks.length);
        console.log("✅ Results generated:", res2.data.results.length);
        res2.data.tasks.forEach((task, idx) => {
            console.log(`   Task ${idx + 1}: ${task.type}`);
        });
        console.log("");

        // Test 4: Get memory
        console.log("Test 4: Get Memory State");
        const memRes = await axios.get(`${BASE_URL}/memory`);
        console.log("✅ Memory state retrieved:");
        console.log(`   Short-term entries: ${memRes.data.short_term_count}`);
        console.log(`   Long-term entries: ${memRes.data.long_term_count}`);
        console.log("");

        console.log("✅ All server tests passed!");

    } catch (error) {
        console.error("❌ Test failed:", error.response?.data || error.message);
    }
}

// Wait a moment for server to start, then run tests
setTimeout(testServer, 1000);
