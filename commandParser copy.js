/**
 * ⚙️ JARVIS Command Parser
 * Converts natural language into executable commands
 */

function parseCommand(input) {
    if (!input || typeof input !== 'string') {
        return { type: 'error', message: 'Invalid input' };
    }

    const cmd = input.toLowerCase().trim();

    // 🌐 Open URLs
    if (cmd.includes('open youtube') || cmd.includes('youtube')) {
        return {
            type: 'open_url',
            url: 'https://youtube.com',
            label: 'Opening YouTube',
            action: 'open_browser',
            voiceReply: 'Opening YouTube for you'
        };
    }

    if (cmd.includes('open google') || cmd === 'google') {
        return {
            type: 'open_url',
            url: 'https://google.com',
            label: 'Opening Google',
            action: 'open_browser',
            voiceReply: 'Opening Google'
        };
    }

    if (cmd.includes('open stackoverflow') || cmd.includes('stackoverflow')) {
        return {
            type: 'open_url',
            url: 'https://stackoverflow.com',
            label: 'Opening Stack Overflow',
            action: 'open_browser',
            voiceReply: 'Opening Stack Overflow'
        };
    }

    if (cmd.includes('open github') || cmd === 'github') {
        return {
            type: 'open_url',
            url: 'https://github.com',
            label: 'Opening GitHub',
            action: 'open_browser',
            voiceReply: 'Opening GitHub'
        };
    }

    // 🎬 App Control
    if (cmd.includes('open chrome') || cmd.includes('chrome')) {
        return {
            type: 'open_app',
            app: 'chrome',
            label: 'Opening Chrome',
            action: 'launch_app',
            voiceReply: 'Opening Chrome browser'
        };
    }

    if (cmd.includes('open vscode') || cmd.includes('vs code')) {
        return {
            type: 'open_app',
            app: 'vscode',
            label: 'Opening VS Code',
            action: 'launch_app',
            voiceReply: 'Opening Visual Studio Code'
        };
    }

    if (cmd.includes('open calculator') || cmd.includes('calculator')) {
        return {
            type: 'open_app',
            app: 'calculator',
            label: 'Opening Calculator',
            action: 'launch_app',
            voiceReply: 'Opening Calculator'
        };
    }

    if (cmd.includes('open spotify') || cmd.includes('spotify')) {
        return {
            type: 'open_app',
            app: 'spotify',
            label: 'Opening Spotify',
            action: 'launch_app',
            voiceReply: 'Opening Spotify'
        };
    }

    // 📱 More Mac Apps
    if (cmd.includes('open mail') || cmd.includes('mail') || cmd.includes('email')) {
        return {
            type: 'open_app',
            app: 'mail',
            label: 'Opening Mail',
            action: 'launch_app',
            voiceReply: 'Opening Mail application'
        };
    }

    if (cmd.includes('open safari') || cmd.includes('safari')) {
        return {
            type: 'open_app',
            app: 'safari',
            label: 'Opening Safari',
            action: 'launch_app',
            voiceReply: 'Opening Safari browser'
        };
    }

    if (cmd.includes('open finder') || cmd.includes('finder')) {
        return {
            type: 'open_app',
            app: 'finder',
            label: 'Opening Finder',
            action: 'launch_app',
            voiceReply: 'Opening Finder'
        };
    }

    if (cmd.includes('open terminal') || cmd.includes('terminal')) {
        return {
            type: 'open_app',
            app: 'terminal',
            label: 'Opening Terminal',
            action: 'launch_app',
            voiceReply: 'Opening Terminal'
        };
    }

    if (cmd.includes('open slack') || cmd.includes('slack')) {
        return {
            type: 'open_app',
            app: 'slack',
            label: 'Opening Slack',
            action: 'launch_app',
            voiceReply: 'Opening Slack'
        };
    }

    // ⏰ Reminders & Timers
    if (cmd.includes('remind') || cmd.includes('reminder')) {
        const text = cmd.replace(/remind|reminder/g, '').trim();
        return {
            type: 'reminder',
            text: text || 'Task reminder',
            label: 'Creating reminder',
            action: 'set_reminder',
            voiceReply: `Reminder set: ${text || 'Task reminder'}`
        };
    }

    if (cmd.includes('timer') || cmd.includes('set timer')) {
        const match = cmd.match(/(\d+)\s*(?:minute|min|second|sec|hour)/i);
        const duration = match ? match[1] : 5;
        return {
            type: 'timer',
            duration: duration,
            label: `Setting ${duration} minute timer`,
            action: 'start_timer',
            voiceReply: `Setting ${duration} minute timer`
        };
    }

    // 🔍 Web Search
    if (cmd.includes('search') || cmd.includes('find')) {
        const query = cmd.replace(/search|find/g, '').trim();
        return {
            type: 'web_search',
            query: query || 'search query',
            label: `Searching for "${query}"`,
            action: 'web_search',
            voiceReply: `Searching for ${query}`
        };
    }

    // 📝 Notes & Writing
    if (cmd.includes('note') || cmd.includes('write')) {
        const text = cmd.replace(/note|write/g, '').trim();
        return {
            type: 'note',
            text: text || 'Quick note',
            label: 'Creating note',
            action: 'save_note',
            voiceReply: `Note saved: ${text || 'Quick note'}`
        };
    }

    // 💬 Assistant Commands
    if (cmd.includes('hello jarvis') || cmd.includes('hey jarvis') || cmd.includes('hello') || cmd.includes('hi')) {
        return {
            type: 'greeting',
            label: 'Hey! I\'m JARVIS, your AI assistant. What can I do for you?',
            action: 'respond',
            voiceReply: 'Hey! I am JARVIS, your AI assistant. What can I do for you?'
        };
    }

    if (cmd.includes('what time') || cmd.includes('tell me time') || cmd.includes('time') || cmd.includes('what time is it')) {
        const time = new Date().toLocaleTimeString();
        return {
            type: 'time',
            time: time,
            label: `Current time: ${time}`,
            action: 'respond',
            voiceReply: `The current time is ${time}`
        };
    }

    if (cmd.includes('what is today') || cmd.includes('date') || cmd.includes('today')) {
        const date = new Date().toLocaleDateString();
        return {
            type: 'date',
            date: date,
            label: `Today is ${date}`,
            action: 'respond',
            voiceReply: `Today is ${date}`
        };
    }

    if (cmd.includes('how are you') || cmd.includes('how are you doing')) {
        return {
            type: 'status',
            label: '🤖 I\'m running at 100% efficiency! Ready to help you.',
            action: 'respond',
            voiceReply: 'I am running at 100 percent efficiency and ready to help you'
        };
    }

    // 🔐 System Commands
    if (cmd === 'shutdown' || cmd.includes('shut down')) {
        return {
            type: 'system',
            action: 'shutdown',
            label: 'Initiating shutdown sequence',
            warning: true,
            voiceReply: 'Shutting down the system'
        };
    }

    if (cmd === 'sleep' || cmd.includes('sleep mode')) {
        return {
            type: 'system',
            action: 'sleep',
            label: 'Going to sleep mode',
            warning: false,
            voiceReply: 'Going to sleep mode'
        };
    }

    // 🤖 Unknown Command
    return {
        type: 'unknown',
        text: input,
        label: `Cannot recognize: "${input}"`,
        action: 'unknown',
        suggestion: 'Try: open google, remind me, search something, what time is it',
        voiceReply: 'Sorry, I did not understand that command. Please try again.'
    };
}

/**
 * Execute parsed command
 */
function executeCommand(parsed) {
    const results = {
        success: false,
        message: 'Command not executed',
        data: null
    };

    try {
        switch (parsed.action) {
            case 'open_browser':
                results.message = `Opening ${parsed.label}`;
                results.success = true;
                results.data = { url: parsed.url, type: parsed.action };
                break;

            case 'launch_app':
                results.message = `Launching ${parsed.app}`;
                results.success = true;
                results.data = { app: parsed.app, type: parsed.action };
                break;

            case 'set_reminder':
                results.message = `Reminder set: ${parsed.text}`;
                results.success = true;
                results.data = { reminder: parsed.text, timestamp: new Date() };
                break;

            case 'start_timer':
                results.message = `Timer started for ${parsed.duration} minutes`;
                results.success = true;
                results.data = { duration: parsed.duration, type: 'timer' };
                break;

            case 'web_search':
                results.message = `Searching Google for "${parsed.query}"`;
                results.success = true;
                results.data = { query: parsed.query, engine: 'google' };
                break;

            case 'save_note':
                results.message = `Note saved: ${parsed.text}`;
                results.success = true;
                results.data = { note: parsed.text, timestamp: new Date() };
                break;

            case 'respond':
                results.message = parsed.label;
                results.success = true;
                results.data = { type: 'response', content: parsed.label };
                break;

            case 'shutdown':
                results.message = 'System shutdown command received';
                results.success = true;
                results.data = { action: 'shutdown', warning: 'This will shut down the system' };
                break;

            case 'sleep':
                results.message = 'System entering sleep mode';
                results.success = true;
                results.data = { action: 'sleep' };
                break;

            case 'unknown':
                results.message = parsed.label;
                results.success = false;
                results.data = { suggestion: parsed.suggestion };
                break;

            default:
                results.message = 'Unknown action type';
                results.success = false;
        }
    } catch (error) {
        results.message = `Error executing command: ${error.message}`;
        results.success = false;
        results.data = { error: error.message };
    }

    return results;
}

module.exports = {
    parseCommand,
    executeCommand
};
