const { orchestrator, getMemoryState } = require("./orchestrator");

async function runTests() {
    console.log("🧪 Testing Multi-Task Execution\n");

    // Test 1: Multi-task with "and"
    console.log("Test 1: Multi-task input with 'and' separator");
    console.log('Input: "open google and tell me time"\n');

    const result1 = await orchestrator("open google and tell me time");
    console.log(`✓ Parsed ${result1.tasks.length} tasks:`);
    result1.tasks.forEach((task, idx) => {
        console.log(`  ${idx + 1}. Type: ${task.type}, Label: ${task.label}`);
    });
    console.log(`✓ Executed ${result1.results.length} results:`);
    result1.results.forEach((item, idx) => {
        console.log(`  ${idx + 1}. ${item.result.result}`);
    });
    console.log("Logs:", result1.logs);
    console.log("\n---\n");

    // Test 2: Multi-task with comma separator
    console.log("Test 2: Multi-task input with ',' separator");
    console.log('Input: "search python, search javascript, what time"\n');

    const result2 = await orchestrator("search python, search javascript, what time");
    console.log(`✓ Parsed ${result2.tasks.length} tasks:`);
    result2.tasks.forEach((task, idx) => {
        console.log(`  ${idx + 1}. Type: ${task.type}, Label: ${task.label}`);
    });
    console.log(`✓ Executed ${result2.results.length} results:`);
    result2.results.forEach((item, idx) => {
        console.log(`  ${idx + 1}. ${item.result.result}`);
    });
    console.log("Logs:", result2.logs);
    console.log("\n---\n");

    // Test 3: Single task (fallback)
    console.log("Test 3: Single task (fallback behavior)");
    console.log('Input: "what time"\n');

    const result3 = await orchestrator("what time");
    console.log(`✓ Parsed ${result3.tasks.length} task(s):`);
    result3.tasks.forEach((task, idx) => {
        console.log(`  ${idx + 1}. Type: ${task.type}, Label: ${task.label}`);
    });
    console.log(`✓ Executed ${result3.results.length} result(s):`);
    result3.results.forEach((item, idx) => {
        console.log(`  ${idx + 1}. ${item.result.result}`);
    });
    console.log("Logs:", result3.logs);
    console.log("\n---\n");

    // Test 4: Multi-task with "then" separator
    console.log("Test 4: Multi-task input with 'then' separator");
    console.log('Input: "open youtube then tell me date"\n');

    const result4 = await orchestrator("open youtube then tell me date");
    console.log(`✓ Parsed ${result4.tasks.length} tasks:`);
    result4.tasks.forEach((task, idx) => {
        console.log(`  ${idx + 1}. Type: ${task.type}, Label: ${task.label}`);
    });
    console.log(`✓ Executed ${result4.results.length} results:`);
    result4.results.forEach((item, idx) => {
        console.log(`  ${idx + 1}. ${item.result.result}`);
    });
    console.log("Logs:", result4.logs);
    console.log("\n---\n");

    console.log("✅ All tests completed!");
}

runTests().catch(console.error);
