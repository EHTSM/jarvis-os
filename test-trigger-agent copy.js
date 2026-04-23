const { triggerAgent } = require("./agents/trigger");

console.log("🧪 Testing triggerAgent\n");

// Test 1
console.log("Test 1: 'remind me in 5 seconds to test'");
const result1 = triggerAgent("remind me in 5 seconds to test");
console.log(JSON.stringify(result1, null, 2));
console.log("");

// Test 2
console.log("Test 2: 'daily at 9:30 am send notification'");
const result2 = triggerAgent("daily at 9:30 am send notification");
console.log(JSON.stringify(result2, null, 2));
console.log("");

// Test 3
console.log("Test 3: 'remind me at 3 pm'");
const result3 = triggerAgent("remind me at 3 pm");
console.log(JSON.stringify(result3, null, 2));
console.log("");

// Test 4
console.log("Test 4: 'what time is it' (non-trigger)");
const result4 = triggerAgent("what time is it");
console.log(JSON.stringify(result4, null, 2));
