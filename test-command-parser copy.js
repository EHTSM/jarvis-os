/**
 * 🧪 Test Command Parser
 * Run: node test-command-parser.js
 */

const { parseCommand, executeCommand } = require('./commandParser');

console.log('\n🧪 JARVIS COMMAND PARSER TEST SUITE\n');

// Test cases
const testCommands = [
    'open youtube',
    'open google',
    'remind me to call mom',
    'set timer for 5 minutes',
    'search javascript tutorials',
    'take a note about this',
    'what time is it',
    'how are you',
    'hello jarvis',
    'open vscode',
    'open spotify',
    'open chrome',
    'invalid random command',
];

console.log('📋 Testing Commands:\n');
console.log('═'.repeat(80));

testCommands.forEach((cmd, idx) => {
    console.log(`\n✨ Test ${idx + 1}: "${cmd}"`);
    console.log('─'.repeat(80));

    // Parse the command
    const parsed = parseCommand(cmd);
    console.log('🧠 Parsed:', JSON.stringify(parsed, null, 2));

    // Execute the command
    const result = executeCommand(parsed);
    console.log('✅ Result:', JSON.stringify(result, null, 2));
});

console.log('\n' + '═'.repeat(80));
console.log('✅ Test Suite Complete!\n');
