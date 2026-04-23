# Jarvis Self-Trigger & Scheduler System Upgrade ✅

## Overview
Jarvis now has a complete self-trigger and scheduler system that enables automatic task execution based on time triggers, without requiring continuous user input.

## Components Implemented

### 1. **triggerAgent** (`agents/trigger.js`) ✅
Detects and parses time-based commands from user input.

**Supported Patterns:**
- `"remind me in X [seconds/minutes/hours/days] [action]"`
  - Example: "remind me in 5 minutes to call mom"
  
- `"remind me at HH:MM [am/pm] [action]"`
  - Example: "remind me at 9 am to start meeting"
  
- `"daily at HH:MM [am/pm] [action]"`
  - Example: "daily at 10 am send status update"
  
-  `"schedule [action] for tomorrow at HH:MM [am/pm]"`
  - Example: "schedule review project for tomorrow at 3 pm"

**Parsing Features:**
- Extracts duration with millisecond precision
- Converts 12-hour and 24-hour time formats
- Extracts action from user input text
- Returns structured trigger object

### 2. **Scheduler System** (`scheduler.js`) ✅
Manages scheduled tasks with dual execution modes.

**Key Functions:**
- `scheduleTask()` - Creates and registers a scheduled task
- `scheduleTimeout()` - Uses JavaScript `setTimeout` for short-term delays
- `scheduleCron()` - Uses `node-cron` for recurring/specific time scheduling
- `executeTask()` - Executes task via orchestrator callback
- `getScheduledTasks()` - Retrieves all scheduled tasks
- `cancelTask()` - Cancels a specific task
- `getSchedulerStatus()` - Returns overall scheduler statistics
- `getNextExecution()` - Identifies next task to execute

**Task Structure:**
```javascript
{
  id: "task_1",                          // Unique identifier
  trigger_type: string,                  // "remind_in", "remind_at", "daily_task"
  original_type: string,                 // For tracking
  action: string,                        // Action to execute
  time: string,                          // "HH:MM" for scheduled times
  cron_time: string,                     // Cron format for recurring tasks
  scheduled_at: ISO8601,                 // When task was created
  status: "active|failed|cancelled",     // Current status
  is_recurring: boolean,                 // Whether task repeats
  execution_count: number,               // Times executed
  last_executed: ISO8601|null,           // Last execution time
  next_execution: ISO8601|string         // When task runs next
}
```

### 3. **Integration Points**

**planner.js** ✅
- Updated to check for triggers before standard task parsing
- Uses `triggerAgent()` to detect time-based commands

**executor.js** ✅
- Added handlers for trigger types: `remind_in`, `remind_at`, `daily_task`, `schedule_tomorrow`
- Returns special "trigger" type result with scheduling metadata

**orchestrator.js** ✅
- Imports scheduler system
- Routes trigger results to `scheduleTask()`
- Maintains backward compatibility with non-trigger tasks

**server.js** ✅
- Added new endpoints for scheduler management:
  - `GET /scheduled` - List all scheduled tasks
  - `GET /scheduled/:id` - Get specific task details
  - `DELETE /scheduled/:id` - Cancel a task
  - `DELETE /scheduled` - Clear all tasks
  - `GET /scheduler/status` - Get scheduler statistics

## API Endpoints

### Schedule a Task (via /jarvis)
```bash
POST /jarvis
{"command": "remind me in 5 minutes to check email"}
```

Response:
```json
{
  "success": true,
  "tasks": [
    {
      "type": "remind_in",
      "label": "Reminder (In)",
      "trigger_type": "timeout",
      "delay_ms": 300000,
      "action": "5 to check email"
    }
  ],
  "results": [
    {
      "result": {
        "type": "trigger",
        "scheduled": true,
        "task_id": "task_1",
        "next_execution": "2026-04-06T00:55:00.000Z"
      }
    }
  ]
}
```

### Get All Scheduled Tasks
```bash
GET /scheduled
```

Response:
```json
{
  "success": true,
  "total": 3,
  "tasks": [
    {
      "id": "task_1",
      "action": "check email",
      "type": "trigger",
      "status": "active",
      "next_execution": "2026-04-06T00:55:00.000Z",
      "execution_count": 0,
      "is_recurring": false
    }
  ]
}
```

### Get Scheduler Status
```bash
GET /scheduler/status
```

Response:
```json
{
  "success": true,
  "total_tasks": 3,
  "active_tasks": 2,
  "failed_tasks": 0,
  "cancelled_tasks": 1,
  "total_executed": 5,
  "next_execution": {
    "task_id": "task_2",
    "action": "meeting reminder",
    "when": "2026-04-06T14:00:00.000Z",
    "in_ms": 28500000
  }
}
```

### Cancel a Task
```bash
DELETE /scheduled/task_1
```

## System Flow

```
User Input → Planner → triggerAgent
     ↓
Executor (Trigger Handler)
        ↓
    Orchestrator
        ↓
    Scheduler
        ↓
 setTimeout/Cron
        ↓
Task Triggers → Call Orchestrator (action)
        ↓
   Execute Action
```

## Features

✅ **Short-term Scheduling**
- Uses JavaScript `setTimeout` for delays under 24 hours
- Precise millisecond-level timing

✅ **Long-term & Recurring Scheduling**
- Uses `node-cron` for specific times
- Supports daily, weekly, and custom cron patterns

✅ **Task Management**
- Create, list, cancel, and query tasks
- Track execution history
- Monitor task status

✅ **Safe Execution**
- Tasks stored in memory with tracking
- Graceful error handling
- Status tracking for failed tasks

✅ **Multi-Agent Architecture**
- Trigger detection separate from execution
- Scheduling separate from action execution
- Clean separation of concerns

## Dependencies

- `node-cron` - For cron-based scheduling
- `axios` - For internal API calls
- Existing: express, dotenv

## Usage Examples

### Example 1: 5-Minute Reminder
```bash
curl -X POST http://localhost:3000/jarvis \
  -H "Content-Type: application/json" \
  -d '{"command": "remind me in 5 minutes to call home"}'
```

### Example 2: Daily 9 AM Task
```bash
curl -X POST http://localhost:3000/jarvis \
  -H "Content-Type: application/json" \
  -d '{"command": "daily at 9 am send team standup reminder"}'
```

### Example 3: Specific Time Today
```bash
curl -X POST http://localhost:3000/jarvis \
  -H "Content-Type: application/json" \
  -d '{"command": "remind me at 3:30 pm prepare presentation"}'
```

### Example 4: Monitor Tasks
```bash
curl http://localhost:3000/scheduler/status
```

### Example 5: List Scheduled Tasks
```bash
curl http://localhost:3000/scheduled
```

## Success Criteria Met ✅

1. ✅ Created `triggerAgent` - Detects time-based commands
2. ✅ Parse time expressions - Supports multiple formats (in X time, at HH:MM, daily, etc.)
3. ✅ Created scheduler system - Stores and manages tasks
4. ✅ Execution via orchestrator - Tasks call orchestrator with action
5. ✅ New intents - Added remind, schedule, daily_task types
6. ✅ Logging - "Task scheduled" and "Task triggered" messages
7. ✅ System safety - Graceful error handling, proper state management

## Testing

Test files created:
- `test-trigger-agent.js` - Unit tests for pattern detection
- `test-simple-scheduler.js` - Integration tests for scheduling
- `test-in-process-scheduler.js` - Execution tests
- `test-scheduler.js` - API endpoint tests

## Next Steps (Optional Enhancements)

1. **Persistence** - Save scheduled tasks to database
2. **Webhooks** - Trigger external services on task execution
3. **Task Dependencies** - Chain tasks together
4. **Email Notifications** - Send alerts when tasks trigger
5. **UI Dashboard** - Web interface for task management
6. **Advanced Patterns** - Support for timezone-aware scheduling
