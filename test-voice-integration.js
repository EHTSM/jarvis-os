/**
 * 🎤 VOICE + SMART COMMAND ENGINE - Integration Test
 * 
 * This test verifies the complete end-to-end flow:
 * Voice Input → Smart Parser → Backend → Response → UI Display
 * 
 * Run: node test-voice-integration.js
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:3000';

console.log('\n🎤 VOICE + SMART COMMAND ENGINE - INTEGRATION TEST\n');
console.log('═'.repeat(80));

// Test scenarios
const testScenarios = [
    {
        name: 'Voice Command: Open YouTube',
        command: 'open youtube',
        expectedType: 'open_url',
        expectedAction: 'open_browser'
    },
    {
        name: 'Voice Command: Set Reminder',
        command: 'remind me to complete the project',
        expectedType: 'reminder',
        expectedAction: 'set_reminder'
    },
    {
        name: 'Voice Command: Start Timer',
        command: 'set a timer for 10 minutes',
        expectedType: 'timer',
        expectedAction: 'start_timer'
    },
    {
        name: 'Voice Command: Search',
        command: 'search for machine learning tutorials',
        expectedType: 'web_search',
        expectedAction: 'web_search'
    },
    {
        name: 'Voice Command: App Launch',
        command: 'open spotify',
        expectedType: 'open_app',
        expectedAction: 'launch_app'
    },
    {
        name: 'Voice Command: Greeting',
        command: 'hello jarvis how are you',
        expectedType: 'greeting',
        expectedAction: 'respond'
    },
    {
        name: 'Voice Command: Time Query',
        command: 'what time is it',
        expectedType: 'time',
        expectedAction: 'respond'
    },
    {
        name: 'Voice Command: Note Taking',
        command: 'take note about this meeting',
        expectedType: 'note',
        expectedAction: 'save_note'
    },
    {
        name: 'Voice Command: Unknown',
        command: 'xyz random gibberish',
        expectedType: 'unknown',
        expectedAction: 'unknown'
    }
];

// Run all tests
(async () => {
    let passed = 0;
    let failed = 0;

    for (const scenario of testScenarios) {
        try {
            console.log(`\n✨ ${scenario.name}`);
            console.log('─'.repeat(80));
            console.log(`   Command: "${scenario.command}"`);

            const response = await axios.post(`${BASE_URL}/parse-command`, {
                command: scenario.command
            });

            const { parsed, result } = response.data;

            console.log(`   🧠 Parsed Type: ${parsed.type}`);
            console.log(`   ⚙️  Action: ${parsed.action}`);
            console.log(`   📝 Label: ${parsed.label}`);

            // Verify expected values
            const typeMatch = parsed.type === scenario.expectedType;
            const actionMatch = parsed.action === scenario.expectedAction;

            if (typeMatch && actionMatch) {
                console.log(`   ✅ SUCCESS - Correctly identified!`);
                console.log(`   📤 Result: ${result.message}`);
                passed++;
            } else {
                console.log(`   ❌ FAILED - Type/Action mismatch`);
                console.log(`      Expected: ${scenario.expectedType} / ${scenario.expectedAction}`);
                console.log(`      Got: ${parsed.type} / ${parsed.action}`);
                failed++;
            }
        } catch (error) {
            console.log(`   ❌ ERROR - ${error.message}`);
            failed++;
        }
    }

    console.log('\n' + '═'.repeat(80));
    console.log(`\n📊 TEST RESULTS:`);
    console.log(`   ✅ Passed: ${passed}/${testScenarios.length}`);
    console.log(`   ❌ Failed: ${failed}/${testScenarios.length}`);
    console.log(`   Success Rate: ${((passed / testScenarios.length) * 100).toFixed(1)}%\n`);

    if (passed === testScenarios.length) {
        console.log('🎉 ALL TESTS PASSED! Voice + Smart Command Engine is READY!\n');
    } else {
        console.log('⚠️  Some tests failed. Check the output above.\n');
    }

    process.exit(failed > 0 ? 1 : 0);
})();
