/**
 * triggerAgent: Detects and parses time-based trigger commands
 * Patterns:
 * - "remind me in X minutes/hours/seconds"
 * - "remind me at HH:MM (am/pm)"
 * - "daily at HH:MM do X"
 * - "schedule X for tomorrow at HH:MM"
 */

function parseDuration(text) {
    const durationRegex = /in\s+(\d+)\s+(second|minute|hour|day)s?/i;
    const match = text.match(durationRegex);

    if (!match) return null;

    const amount = parseInt(match[1]);
    const unit = match[2].toLowerCase();

    const multipliers = {
        second: 1000,
        minute: 60 * 1000,
        hour: 60 * 60 * 1000,
        day: 24 * 60 * 60 * 1000
    };

    return amount * (multipliers[unit] || 60000);
}

function parseTime(text) {
    // Match patterns like "9 pm", "9pm", "9:30 pm", "09:30", "21:30"
    const timeRegex = /(\d{1,2}):?(\d{2})?\s*(am|pm)?/i;
    const match = text.match(timeRegex);

    if (!match) return null;

    let hours = parseInt(match[1]);
    const minutes = parseInt(match[2]) || 0;
    const meridiem = match[3]?.toLowerCase();

    // Convert 12-hour to 24-hour format if meridiem is present
    if (meridiem) {
        if (meridiem === 'pm' && hours !== 12) hours += 12;
        if (meridiem === 'am' && hours === 12) hours = 0;
    }

    return { hours, minutes };
}

function extractAction(text) {
    // Remove trigger-related words to get the action
    let action = text
        .replace(/^(remind me|remind|schedule|daily|every day)\s*(in|at|for)?\s*/i, "")
        .replace(/\s*(am|pm|minutes?|hours?|seconds?|days?)(\s|$)/gi, " ")
        .trim();

    return action || "default reminder";
}

function triggerAgent(input) {
  return { success: true, input };
}

module.exports = { triggerAgent };

function triggerAgent(input) {
    const lowerInput = input.toLowerCase().trim();

    // Pattern 1: "remind me in X time"
    if (lowerInput.includes("remind me in")) {
        const duration = parseDuration(lowerInput);
        if (duration) {
            return {
                type: "remind_in",
                label: "Reminder (In)",
                trigger_type: "timeout",
                delay_ms: duration,
                action: extractAction(lowerInput),
                payload: {
                    query: extractAction(lowerInput)
                }
            };
        }
    }

    // Pattern 2: "remind me at X time"
    if (lowerInput.includes("remind me at") || lowerInput.includes("remind at")) {
        const timeObj = parseTime(lowerInput);
        if (timeObj) {
            return {
                type: "remind_at",
                label: "Reminder (At)",
                trigger_type: "cron",
                cron_time: `${timeObj.minutes} ${timeObj.hours} * * *`, // cron format
                time: `${String(timeObj.hours).padStart(2, '0')}:${String(timeObj.minutes).padStart(2, '0')}`,
                action: extractAction(lowerInput),
                payload: {
                    query: extractAction(lowerInput)
                }
            };
        }
    }

    // Pattern 3: "daily at X time do Y"
    if (lowerInput.includes("daily at") || lowerInput.includes("every day at")) {
        const timeObj = parseTime(lowerInput);
        if (timeObj) {
            return {
                type: "daily_task",
                label: "Daily Task",
                trigger_type: "cron",
                cron_time: `${timeObj.minutes} ${timeObj.hours} * * *`, // cron format
                time: `${String(timeObj.hours).padStart(2, '0')}:${String(timeObj.minutes).padStart(2, '0')}`,
                action: extractAction(lowerInput),
                is_recurring: true,
                payload: {
                    query: extractAction(lowerInput)
                }
            };
        }
    }

    // Pattern 4: "schedule X for tomorrow at HH:MM"
    if (lowerInput.includes("schedule") && lowerInput.includes("for tomorrow")) {
        const timeObj = parseTime(lowerInput);
        if (timeObj) {
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(timeObj.hours, timeObj.minutes, 0, 0);

            return {
                type: "schedule_tomorrow",
                label: "Schedule Tomorrow",
                trigger_type: "timeout",
                scheduled_for: tomorrow.toISOString(),
                delay_ms: tomorrow.getTime() - Date.now(),
                action: extractAction(lowerInput),
                payload: {
                    query: extractAction(lowerInput)
                }
            };
        }
    }

    // Not a trigger command
    return null;
}

module.exports = {
    triggerAgent,
    parseDuration,
    parseTime,
    extractAction
};
