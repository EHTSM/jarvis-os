# 🚀 JARVIS PHASE 7 - QUICK START GUIDE

## Prerequisites

- Node.js 14+ installed
- npm or yarn
- SQLite3
- macOS/Linux/Windows (tested on all platforms)

---

## ⚡ 5-Minute Quick Start

### Step 1: Clone/Setup Project
```bash
# Navigate to your project directory
cd ~/jarvis-project

# Install dependencies
npm install
```

### Step 2: Initialize Database
```bash
# Create database tables
npm run setup-db

# Or manually:
sqlite3 jarvis.db < database/schema.sql
```

### Step 3: Start Server
```bash
npm start

# Output should show:
# ✅ JARVIS running on http://localhost:3000
# ✅ Evolution Engine initialized
# ✅ Learning Module connected
# ✅ Database ready
```

### Step 4: Test Basic Command
```bash
# In another terminal:
curl -X POST http://localhost:3000/jarvis \
  -H "Content-Type: application/json" \
  -d '{"command":"open chrome"}'

# Response includes suggestions!
```

### Step 5: Check Evolution Score
```bash
curl http://localhost:3000/evolution/score

# Shows optimization score (0-100)
```

---

## 🧪 Running Tests

```bash
# Run comprehensive test suite (15 tests)
node test-evolution-system.js

# Output: ✅ ALL TESTS PASSED - Evolution Engine fully operational
```

---

## First-Time Usage Scenario

### 1. Execute Your First Command
```bash
curl -X POST http://localhost:3000/jarvis \
  -H "Content-Type: application/json" \
  -d '{"command":"open google"}'
```

**Response**:
```json
{
  "success": true,
  "command": "open google",
  "results": ["Browser opened with Google"],
  "suggestions": [],
  "evolution_analysis": {
    "patterns_detected": 0,
    "optimization_opportunities": 0
  }
}
```

### 2. Execute Same Command 3 Times
```bash
# Execute 3 times to trigger pattern detection
for i in 1 2 3; do
  curl -X POST http://localhost:3000/jarvis \
    -H "Content-Type: application/json" \
    -d '{"command":"open google"}'
  sleep 1
done
```

### 3. Get Suggestions
```bash
curl http://localhost:3000/evolution/suggestions
```

**Response**:
```json
{
  "success": true,
  "suggestions": [
    {
      "id": "sug_001",
      "type": "repetitive_app",
      "suggestion": "You frequently open Google",
      "confidence": 0.92,
      "approval_status": "pending"
    }
  ]
}
```

### 4. Check Optimization Score
```bash
curl http://localhost:3000/evolution/score
```

**Response**:
```json
{
  "success": true,
  "optimization_score": 45.5,
  "analysis": {
    "total_commands": 3,
    "patterns_found": 1,
    "suggestions_pending": 1,
    "learning_score": 50
  }
}
```

### 5. Approve Suggestion
```bash
curl -X POST http://localhost:3000/evolution/approve/sug_001
```

**Response**:
```json
{
  "success": true,
  "message": "Suggestion approved",
  "action_taken": "Agent created successfully",
  "agent_name": "google-launcher"
}
```

### 6. Use New Agent
```bash
curl -X POST http://localhost:3000/jarvis \
  -H "Content-Type: application/json" \
  -d '{"command":"google-launcher"}'

# Result: Fast launch of Google!
```

---

## 📊 API Quick Reference

### Evolution Endpoints

| Method | Endpoint | Purpose | Example |
|--------|----------|---------|---------|
| GET | `/evolution/score` | Get optimization score | `curl http://localhost:3000/evolution/score` |
| GET | `/evolution/suggestions` | Get all suggestions | `curl http://localhost:3000/evolution/suggestions` |
| GET | `/evolution/approvals` | Get pending approvals | `curl http://localhost:3000/evolution/approvals` |
| POST | `/evolution/approve/:id` | Approve suggestion | `curl -X POST http://localhost:3000/evolution/approve/sug_001` |
| POST | `/evolution/reject/:id` | Reject suggestion | `curl -X POST http://localhost:3000/evolution/reject/sug_001` |

### Orchestrator Endpoint

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/jarvis` | Execute command with evolution analysis |

---

## 🎯 Common Tasks

### Create a New Optimization (as Admin)
```bash
# Approval workflow - requires user confirmation
curl -X POST http://localhost:3000/evolution/approve/sug_001

# Auto-creates optimization agent
```

### Monitor System Performance
```bash
# Check score regularly
curl http://localhost:3000/evolution/score \
  | jq '.optimization_score'

# Track patterns
curl http://localhost:3000/evolution/score \
  | jq '.analysis.patterns_found'
```

### Get Active Suggestions
```bash
# See what optimizations are pending
curl http://localhost:3000/evolution/suggestions \
  | jq '.suggestions[] | {id, suggestion, confidence}'
```

### Build Custom Commands
```bash
# After approval, new agents are automatically available
curl -X POST http://localhost:3000/jarvis \
  -H "Content-Type: application/json" \
  -d '{"command":"your-custom-agent-name"}'
```

---

## 🔧 Configuration

### Quick Config Changes

**File**: `evolution-config.json`

```json
{
  "pattern_detection": {
    "min_frequency": 3,              // Require 3+ executions to detect
    "confidence_threshold": 0.70,    // Only suggest if 70%+ confident
    "analysis_interval_ms": 5000     // Analyze every 5 seconds
  },
  "suggestions": {
    "auto_create_agents": true,      // Create agents automatically
    "max_pending": 10,               // Max 10 pending suggestions
    "expiration_days": 7             // Suggestions expire after 7 days
  }
}
```

### Increase Detection Sensitivity
```json
{
  "pattern_detection": {
    "min_frequency": 2,              // Detect patterns with only 2 executions
    "confidence_threshold": 0.60     // Suggest at 60% confidence
  }
}
```

---

## 📈 Monitoring

### Check System Health
```bash
# Server status
curl http://localhost:3000/

# Evolution score
curl http://localhost:3000/evolution/score

# Pending items
curl http://localhost:3000/evolution/approvals
```

### View Evolution Metrics
```bash
# Get detailed analysis
curl http://localhost:3000/evolution/score | jq '.analysis'

# Output:
# {
#   "total_commands": 45,
#   "patterns_found": 8,
#   "suggestions_pending": 3,
#   "agents_created": 2
# }
```

---

## 🐛 Troubleshooting

### Server Won't Start
```bash
# Check if port 3000 is in use
lsof -i :3000

# Kill process if needed
kill -9 <PID>

# Try different port
PORT=3001 npm start
```

### Database Issues
```bash
# Reset database
rm jarvis.db

# Reinitialize
npm run setup-db

# Start fresh
npm start
```

### No Suggestions Generated
```bash
# Ensure pattern detection is enabled
grep min_frequency evolution-config.json

# Lower threshold if needed
# Execute command 3+ times
# Check suggestions
curl http://localhost:3000/evolution/suggestions
```

### Tests Failing
```bash
# Restart server first
npm start

# In new terminal, run tests
node test-evolution-system.js

# If still failing, check logs
tail -f server.log
```

---

## 🚀 Advanced Usage

### Bulk Command Execution
```bash
# Create script to test patterns
cat << 'EOF' > test-pattern.sh
#!/bin/bash
for i in {1..5}; do
  curl -X POST http://localhost:3000/jarvis \
    -H "Content-Type: application/json" \
    -d '{"command":"open chrome"}' \
    -s | jq .
  sleep 1
done

# Check suggestions
curl http://localhost:3000/evolution/suggestions | jq .
EOF

chmod +x test-pattern.sh
./test-pattern.sh
```

### Monitor Evolution in Real-Time
```bash
# Watch optimization score update
watch -n 2 'curl -s http://localhost:3000/evolution/score | jq ".optimization_score"'
```

### Export Suggestions to CSV
```bash
curl http://localhost:3000/evolution/suggestions | jq -r '.suggestions[] | [.id, .suggestion, .confidence] | @csv' > suggestions.csv
```

---

## 📚 Documentation Files

| File | Purpose |
|------|---------|
| `EVOLUTION_SYSTEM_DOCS.md` | Complete technical documentation |
| `PHASE_7_SUMMARY.md` | Phase 7 implementation summary |
| `JARVIS_COMPLETE_EVOLUTION.md` | All phases overview (1-7) |
| `QUICK_START.md` | This file! |
| `evolution-engine.js` | Core evolution engine |
| `test-evolution-system.js` | Test suite |

---

## 🎓 Learning Resources

### Understanding the System

1. **Start with**: `PHASE_7_SUMMARY.md`
   - Get overview of what's included
   - See success metrics

2. **Deep dive**: `EVOLUTION_SYSTEM_DOCS.md`
   - Understand pattern recognition
   - Learn about suggestion generation
   - Study auto-agent creation

3. **Full context**: `JARVIS_COMPLETE_EVOLUTION.md`
   - See how Phase 7 builds on 1-6
   - Understand architectural evolution
   - Grasp the complete journey

### Key Concepts

- **Optimization Score**: 0-100 rating of system efficiency
- **Pattern**: Repeated command sequence (3+ times)
- **Suggestion**: AI recommendation for optimization
- **Confidence**: 0-1 probability the suggestion is good
- **Approval**: User must approve before optimization applies
- **Agent**: Specialized automation for a specific workflow

---

## 🎯 Success Indicators

### You Know It's Working When:

✅ Server starts without errors
✅ `/evolution/score` returns a number 0-100
✅ Execute command 3+ times, get suggestions
✅ Approve suggestion, agent is created
✅ All 15 tests pass
✅ Evolution score increases over time

### Expected Behavior:

- First run: Score ~0-20 (no patterns yet)
- After 10 commands: Score ~30-40 (some patterns)
- After 50 commands: Score ~50-70 (good patterns)
- After frequent use: Score ~80+ (optimized system)

---

## 🔄 Typical Workflow

```
1. Start Server
   ↓
2. Execute Commands
   ↓
3. System Learns Patterns
   ↓
4. Generate Suggestions
   ↓
5. Review Suggestions
   ↓
6. Approve Optimization
   ↓
7. Agent Created
   ↓
8. Use Optimized Command
   ↓
9. System Improves Score
   ↓
10. Repeat! 🔁
```

---

## 📞 Need Help?

### Check These First:
1. Run tests: `node test-evolution-system.js`
2. Check score: `curl http://localhost:3000/evolution/score`
3. View suggestions: `curl http://localhost:3000/evolution/suggestions`
4. Check server logs

### Try These:
- Stop and restart server
- Reset database
- Lower confidence threshold
- Execute more commands
- Check port availability

---

## 🎉 You're Ready!

You now have:
✅ JARVIS Phase 7 running
✅ Evolution engine active
✅ Pattern recognition working
✅ Auto-optimization enabled
✅ All systems operational

**Start executing commands and watch JARVIS evolve! 🚀**

---

## Next Steps

1. **Run the test suite** - Verify everything works
2. **Execute test commands** - Build up patterns
3. **Review suggestions** - See AI recommendations
4. **Approve optimizations** - Create specialized agents
5. **Monitor score** - Watch system improve
6. **Explore documentation** - Deep dive into concepts

---

**🌟 Welcome to JARVIS Phase 7 - Self-Evolution!**

*Questions? Check the documentation files or review the test suite.*
