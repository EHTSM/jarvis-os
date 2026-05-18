# 🧠 Jarvis Learning System - Quick Reference Guide

## 🚀 Quick Start

### 1. Start Server
```bash
cd /Users/ehtsm
node server.js
```

### 2. Check Learning Stats
```bash
curl http://localhost:3000/learning/stats
```

### 3. See User Habits
```bash
curl http://localhost:3000/learning/habits
```

### 4. Get Task Frequency
```bash
curl http://localhost:3000/learning/frequency
```

### 5. Get Smart Suggestions
```bash
curl http://localhost:3000/learning/suggestions?prefix=open
```

---

## 📊 System Architecture

```
┌─────────────────────────────────────────────┐
│              USER INPUT                      │
└──────────────────────┬──────────────────────┘
                       │
                       ↓
        ┌──────────────────────────────┐
        │   CONTEXT ENGINE             │
        │  (stores history & patterns) │
        └──────────────────────────────┘
                       │
                       ↓
        ┌──────────────────────────────┐
        │   PLANNER AGENT              │
        │  (uses context hints)        │
        └──────────────────────────────┘
                       │
                       ↓
        ┌──────────────────────────────┐
        │   EXECUTOR AGENT             │
        │  (executes tasks)            │
        └──────────────────────────────┘
                       │
                       ↓
        ┌──────────────────────────────┐
        │   LEARNING SYSTEM            │
        │  (analyzes & learns)         │
        └──────────────────────────────┘
                       │
                       ↓
        ┌──────────────────────────────┐
        │   PERSISTENT STORAGE         │
        │  (data/learning.json)        │
        └──────────────────────────────┘
                       │
                       ↓
          ┌────────────────────────┐
          │    RESPONSE TO USER    │
          └────────────────────────┘
```

---

## 🗂️ Key Files

| File | Purpose | Key Methods |
|------|---------|------------|
| `orchestrator.js` | Central hub | orchestrator(input) |
| `agents/learningSystem.js` | Learn from behavior | analyzeCommand(), getPatterns() |
| `agents/contextEngine.js` | Track history | addConversation(), findSimilar() |
| `agents/planner.js` | Parse input | plannerAgent(input, context) |
| `server.js` | HTTP interface | 8 learning + 2 context endpoints |
| `data/learning.json` | Persistent storage | Auto-loaded on startup |

---

## 🧠 Learning System API

### Analyze a Command
```javascript
learningSystem.analyzeCommand(
  input,           // "open google and search for weather"
  tasks,           // [task1, task2]
  results,         // [result1, result2]
  metadata         // {success: true, duration: 1234}
);
```

### Get What User Does Most
```javascript
const frequency = learningSystem.getFrequency();
// Returns: [{type: "open_google", count: 4, percentage: "44%"}, ...]
```

### Get Learned Patterns
```javascript
const patterns = learningSystem.getPatterns(limit=10);
// Returns: [{signature: "open_google+time", count: 3, examples: [...]}]
```

### Get Suggestions
```javascript
const suggestions = learningSystem.getSuggestions("open");
// Returns: suggestions for commands starting with "open"
```

### Get User Profile
```javascript
const habits = learningSystem.getUserHabits();
// Returns: {most_frequent_tasks, learned_patterns, usage_level, ...}
```

### Get Success Rate
```javascript
const rates = learningSystem.getSuccessRate();
// Returns: [{type: "open_google", success_rate: "100%", ...}]
```

---

## 📝 Context Engine API

### Store Conversation
```javascript
contextEngine.addConversation(
  input,        // User input
  tasks,        // Tasks executed
  results,      // Results generated
  metadata      // {processedBy, duration}
);
```

### Get History
```javascript
const history = contextEngine.getHistory();
// Returns: last 10 conversations
```

### Find Similar Queries
```javascript
const similar = contextEngine.findSimilar("open google");
// Returns: past queries similar to input (word-based)
```

### Get Context Summary
```javascript
const summary = contextEngine.getContextSummary();
// Returns: {frequent_commands, patterns, tasks_by_type}
```

### Get User Patterns
```javascript
const patterns = contextEngine.getUserPatterns();
// Returns: {most_common_tasks, behavior_summary, ...}
```

---

## 🔌 Server Endpoints

### Learning Endpoints

| Method | Endpoint | Returns |
|--------|----------|---------|
| GET | `/learning/stats` | Total commands, patterns, unique tasks |
| GET | `/learning/habits` | Frequent tasks, usage level, behavior |
| GET | `/learning/frequency` | Task type frequency breakdown |
| GET | `/learning/success-rates` | Success % for each task |
| GET | `/learning/patterns?limit=10` | Learned multi-task patterns |
| GET | `/learning/suggestions?prefix=X` | Smart command suggestions |
| GET | `/learning/optimizations` | Recommended improvements |
| DELETE | `/learning` | Clear all learning data |

### Context Endpoints

| Method | Endpoint | Returns |
|--------|----------|---------|
| GET | `/context/history?limit=10` | Last N conversations (max 10 stored) |
| GET | `/context/session` | Current session statistics |

### Example Requests

```bash
# Get learning stats
curl http://localhost:3000/learning/stats

# Get user habits
curl http://localhost:3000/learning/habits

# Get task frequency
curl http://localhost:3000/learning/frequency

# Get smart suggestions
curl http://localhost:3000/learning/suggestions?prefix=open

# Get learned patterns
curl http://localhost:3000/learning/patterns?limit=5

# Get success rates
curl http://localhost:3000/learning/success-rates

# Get optimization suggestions
curl http://localhost:3000/learning/optimizations

# Get conversation history
curl http://localhost:3000/context/history?limit=10

# Get session stats
curl http://localhost:3000/context/session

# Clear all learning
curl -X DELETE http://localhost:3000/learning
```

---

## 📊 Data Model

### Learning Data Structure
```json
{
  "frequency": {
    "open_google": 4,
    "search": 2,
    "time": 3
  },
  "patterns": [
    {
      "signature": "open_google",
      "count": 3,
      "examples": ["open google", ...],
      "first_seen": "2024-XX-XX",
      "learned": true
    }
  ],
  "commandHistory": [
    {
      "timestamp": "2024-XX-XX",
      "input": "open google",
      "tasks": ["open_google"],
      "success": true,
      "duration": 123
    }
  ],
  "successRate": {
    "open_google": {"success": 4, "total": 4},
    "search": {"success": 2, "total": 2}
  }
}
```

### Context History Structure
```json
{
  "conversationHistory": [
    {
      "timestamp": "2024-XX-XX",
      "input": "open google",
      "taskCount": 1,
      "taskTypes": ["open_google"],
      "resultCount": 1,
      "executedBy": "Executor",
      "duration": 50
    }
  ],
  "maxHistorySize": 10
}
```

---

## 🎯 Usage Patterns

### Pattern Learning Threshold
- **Learned**: After 3+ executions
- **Frequent**: 5+ times = optimization candidate
- **Expert**: 200+ total commands

### Suggestion Ranking
1. **History** (Exact past commands matching prefix)
2. **Pattern** (Frequently combined tasks)
3. **Frequent** (Top tasks by popularity)

### Success Calculation
```
success_rate = (successful_executions / total_executions) * 100
```

---

## 🧪 Running Tests

```bash
# Full learning system test suite
cd /Users/ehtsm
node test-learning-system.js

# Expected: 20/20 tests passing
```

---

## 💾 Persistence

### File Location
```
/Users/ehtsm/data/learning.json
```

### What's Saved
- ✅ Task frequency counts
- ✅ All patterns (including learned status)
- ✅ Last 1000 commands
- ✅ Success rates by task type
- ✅ Habits data

### Auto-Save
Triggered after every command via `learningSystem.analyzeCommand()`

### Load on Startup
Automatically loaded when `LearningSystem` is instantiated

---

## 🔄 Integration Flow

### Step-by-Step Execution

```
1. User sends: "open google and tell me time"
   ↓
2. Orchestrator gets context from history
   ↓
3. Planner parses (detects 2 tasks, checks if frequent)
   ↓
4. Executor runs both tasks
   ↓
5. Learning system analyzes:
   - Frequency: open_google++, time++
   - Pattern: Check if "open_google+time" is familiar
   - Success: Both tasks succeeded ✓
   - Store in command history
   ↓
6. Context engine updates:
   - Add to conversation history (max 10)
   - Update session stats
   ↓
7. If pattern seen 3+ times → mark as "learned"
   ↓
8. Save all to data/learning.json
   ↓
9. Return response with stats
```

---

## ⚠️ Troubleshooting

### Learning Not Working?
```bash
# Check if learning file exists
ls -la /Users/ehtsm/data/learning.json

# Check learning stats
curl http://localhost:3000/learning/stats

# Clear and rebuild
curl -X DELETE http://localhost:3000/learning
```

### Suggestions Not Appearing?
- Need at least 3 similar commands to generate suggestions
- Try repeating: "open google", "open google", "open google"
- Then check: `/learning/suggestions?prefix=open`

### Server Not Starting?
```bash
# Kill existing process
lsof -i :3000 | tail -1 | awk '{print $2}' | xargs kill -9

# Restart
node server.js
```

### No Context Available?
- First 3-5 commands may have limited context
- System learns over time
- Context grows as more commands are executed

---

## 📈 Metrics Summary

After 9 test commands:
```
✅ Total Commands Learned: 9
✅ Unique Task Types: 3
✅ Patterns Learned: 1
✅ Success Rate: 100%
✅ Usage Level: Beginner
✅ Unique Commands: 6
✅ Context History: 8 conversations
✅ Most Frequent: open_google (44%)
```

---

## 🚀 Next Steps

### To Maximize Learning:
1. Execute diverse commands (10-20+)
2. Repeat similar commands to build patterns
3. Check `/learning/habits` to see profile
4. Use `/learning/suggestions` for autocomplete
5. Review `/learning/optimizations` for improvements

### For Integration:
1. Pass context to external services
2. Use learned data for ML models
3. Export learning for analysis
4. Create user profiles based on habits

---

## 📚 Documentation

- **Full Details**: [LEARNING_UPGRADE.md](LEARNING_UPGRADE.md)
- **Scheduler**: [SCHEDULER_UPGRADE.md](SCHEDULER_UPGRADE.md)
- **Test Suite**: `test-learning-system.js`

---

## 🎓 Learning Levels

```
Usage Level Detection:
  Beginner:      < 10 commands
  Intermediate:  10-50 commands
  Advanced:      50-200 commands
  Expert:        200+ commands
```

---

**Last Updated**: Current Session  
**Status**: ✅ Production Ready
**Test Coverage**: 20/20 Passing

