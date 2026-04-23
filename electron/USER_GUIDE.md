# 🤖 JARVIS Desktop App - Complete User Guide

## Overview

The JARVIS Desktop Application is a professional AI assistant interface that connects to the JARVIS self-evolving automation system. It provides real-time chat, AI suggestions, task monitoring, and voice control.

## Starting the App

### Prerequisites
- JARVIS backend running on http://localhost:3000
- Node.js 14+

### Launching
```bash
cd /Users/ehtsm/electron
npm start
```

The app will:
1. Start React on port 3001
2. Launch Electron window
3. Connect to backend
4. Show green status indicator if successful

## UI Sections

### 1. Header (Top)

```
┌────────────────────────────────────────────────────────────┐
│ 🤖 JARVIS          Evolution Score: 75 (Optimal)         │
├────────────────────────────────────────────────────────────┤
```

**Elements:**
- **Logo**: Pulsing cyan "JARVIS" text
- **Title**: "Self-Evolving AI Assistant"
- **Evolution Score**: 0-100 ring indicator
  - Shows current optimization level
  - Updates in real-time
  - Color-coded status

### 2. Tabs (Below Header)

```
┌──────────────────────────────────────┐
│ 💬 Chat │ 💡 Suggestions (2) │ 📋 Logs (15) │
└──────────────────────────────────────┘
```

**Tabs:**
- **💬 Chat** - Main command interface
- **💡 Suggestions** - AI optimization suggestions
- **📋 Logs** - Complete task history

Click to switch between panels.

### 3. Chat Panel

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│  🤖 Welcome to JARVIS - Your AI Assistant               │
│  👤 open chrome                                         │
│  🤖 Tasks: open_browser, load_homepage                 │
│     Results: Browser opened successfully                │
│     💡 Suggestions: Create quick-launch?               │
│                                                          │
│  👤 search google                                       │
│  🤖 (typing animation...)                              │
│                                                          │
├──────────────────────────────────────────────────────────┤
│  [input box]                    🎤 ➤  🗑️              │
└──────────────────────────────────────────────────────────┘
```

**Features:**
- **Message Display**: Scrollable history
- **User Messages**: Right-aligned, cyan background
- **System Messages**: Left-aligned, blue background
- **Loading Animation**: Dots pulse while processing
- **Input Box**: Type commands here
- **Buttons**:
  - 🎤 Voice input
  - ➤ Send command
  - 🗑️ Clear chat

### 4. Suggestions Panel

```
┌──────────────────────────────────────────────────────────┐
│  💡 Optimize Google Search Workflow                      │
│  Category: workflow_automation    Confidence: 87% 🟡    │
│  ▶ (click to expand)                                    │
│                                                          │
├─ Details (expanded):                                    │
│  Category: workflow_automation                          │
│  Based on: Pattern appeared 4 times in past week       │
│  Action: create_agent                                   │
│  Status: pending                                        │
│                                                          │
│  [✓ Approve] [✕ Dismiss]                              │
│                                                          │
│  📱 Frequently open Chrome                              │
│  Category: repetitive_app        Confidence: 92% 🔴    │
│  ▶ (click to expand)                                    │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

**Card Elements:**
- **Icon**: Visual indicator (📱, ⚙️, ⚡, 🚀, 📚)
- **Title**: Suggestion text
- **Type**: Category of suggestion
- **Confidence**: Percentage with color badge
  - 🔴 High confidence (80%+) Red circle
  - 🟡 Medium confidence (60-80%) Orange circle
  - 🟢 Low confidence (<60%) Green circle
- **Details**: Shown when expanded
- **Actions**: Approve or Dismiss

### 5. Logs Panel

```
┌──────────────────────────────────────────────────────────┐
│  ✅ 10:45:23 - Command: open chrome                     │
│     Tasks: 1 executed                                   │
│     └─ Details: Browser opened successfully             │
│                                                          │
│  ⏳ 10:43:15 - Command: search google                   │
│     (pending - animated progress bar)                   │
│                                                          │
│  ❌ 10:42:08 - Command: invalid_command                │
│     Error: Command not recognized                       │
│                                                          │
│  ✅ 10:40:45 - Command: type hello                      │
│     Tasks: 1 executed                                   │
│     └─ Details: Text entered successfully               │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

**Status Indicators:**
- ✅ Success (green)
- ❌ Error (red)
- ⏳ Pending (orange with animation)

**Expandable Details**:
Click any log entry to see:
- Full command text
- Task breakdown
- Execution time
- Error messages if any

### 6. Status Bar (Bottom)

```
┌──────────────────────────────────────────────────────────┐
│ 🟢 Server Connected    Ready    [◆] [⚙️] │
└──────────────────────────────────────────────────────────┘
```

**Elements:**
- **Status Dot**: 
  - 🟢 Green = Connected (pulsing)
  - 🔴 Red = Offline
- **Status Text**: "Server Connected" or "Server Offline"
- **Ready Indicator**: Shows app readiness
- **Action Buttons**:
  - ◆ Floating window (optional)
  - ⚙️ Settings (coming soon)

## Using the Chat

### Typing Commands

1. **Click input box**
   ```
   [Type a command or press 🎤 to speak...]
   ```

2. **Type your command**
   ```
   open chrome and type hello
   ```

3. **Press Enter or click ➤**
   - Command sends to backend
   - "Thinking" animation shows
   - Results appear in chat

4. **View results**
   - Tasks executed
   - Results shown
   - Suggestions displayed if any

### Supported Commands

**Basic:**
```
open chrome
start calculator
launch notepad
```

**With actions:**
```
open chrome and type google
click button and press enter
```

**Complex sequences:**
```
open chrome, type search, and press enter
```

### Voice Input

1. **Click 🎤 button** (or list if not already granted)
   
2. **Allow microphone** (browser will ask first time)
   
3. **Speak your command**
   - Button shows "🎤 Listening..."
   - Animated red effect
   - Microphone records audio
   
4. **Stop speaking**
   - Speech recognition processes
   - Auto-inserts command text
   - Button returns to normal
   
5. **Review & Send**
   - Command appears in input box
   - Click ➤ to send
   - Or press Enter

**Tip**: Speak naturally, like you would to a person.

## Reading Updates

### Evolution Score Indicator

**Ring in top-right shows:**
```
Score    Status              Color
0-20     Learning Phase      Orange
20-40    Building Patterns   Cyan
40-60    Pattern Recognition Green
60-80    Optimal             Green
80-100   Highly Optimized    Green
```

**What it means:**
- Score increases as system learns
- Higher = more optimizations available
- Improves with more command execution
- Resets after major changes

### Message Types

**User Message** (cyan, right-aligned)
```
👤 user message text
```

**System Message** (blue, left-aligned)
```
🤖 system response text
```

**Success Message**
```
✅ Results: Task completed successfully
```

**Error Message**
```
❌ Error: Something went wrong
```

## Approving Suggestions

### Process

1. **Click 💡 Suggestions tab**
   - See all pending suggestions
   - Or click specific suggestion

2. **Review suggestion card**
   - Read title
   - Check confidence level
   - Click to expand for details

3. **Examine details**
   ```
   Category: workflow_automation
   Based on: Pattern appeared 4 times
   Action: create_agent
   Status: pending
   ```

4. **Approve or Dismiss**
   - ✓ Approve: Creates specialized agent
   - ✕ Dismiss: Removes suggestion
   - Can dismiss and re-approve later

5. **After approval**
   - System creates agent
   - Agent appears in available commands
   - Use immediately or later
   - Score increases

### Confidence Levels

| Badge | Level | What it means |
|-------|-------|---------------|
| 🔴 92% | High | Very likely to work |
| 🟡 76% | Medium | Probably good |
| 🟢 54% | Low | Uncertain |

High confidence (80%+) = More reliable suggestions

## Reviewing Logs

### Accessing Logs

1. **Click 📋 Logs tab**

2. **See all executed tasks**
   - Newest at top
   - Oldest at bottom
   - Paginated if many entries

3. **Understand status**
   - ✅ Completed successfully
   - ❌ Failed with error
   - ⏳ Still processing

4. ****Expand for details**
   - Click any log entry
   - See full command text
   - View task breakdown
   - Read error messages

### Log Information

**Typical successful log:**
```
✅ 10:45:23 - Command: open chrome
   Tasks: 1 executed
   └─ Details: Browser opened successfully
```

**Typical error log:**
```
❌ 10:40:15 - Command: invalid_syntax
   Error: Command not recognized
```

**Typical pending log:**
```
⏳ 10:48:30 - Command: processing...
   (animated progress bar)
```

## Understanding Suggestions

### Suggestion Categories

**📱 Repetitive App Launch**
- Pattern: Open same app 3+ times
- Suggestion: "Create shortcut for [app]"
- Benefit: Faster launching

**⚙️ Workflow Automation**
- Pattern: Same sequence 2+ times
- Suggestion: "Automate [workflow]"
- Benefit: Single command for multi-step task

**⚡ Command Optimization**
- Pattern: Long command used repeatedly
- Suggestion: "Shorten to [alias]"
- Benefit: Faster typing

**🚀 Performance Enhancement**
- Pattern: Slow execution detected
- Suggestion: "Parallelize [task]"
- Benefit: Faster execution

**📚 Learning Gap**
- Pattern: New command pattern
- Suggestion: "Save for future analysis"
- Benefit: System improves

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Enter` | Send command |
| `Shift+Enter` | New line in input |
| `Cmd+Shift+F` | Toggle floating window |
| `Cmd+Option+I` | Developer tools |
| `Cmd+R` | Reload app |
| `Cmd+Q` | Quit app |

## Monitoring System Health

### Server Status

**Connected (Green):**
```
🟢 Server Connected
```
- Backend is running
- Commands can execute
- All features available

**Disconnected (Red):**
```
🔴 Server Offline
```
- Backend is down
- Commands won't work
- Will auto-reconnect every 5 seconds

If disconnected → Start backend: `npm start`

### Evolution Score Trend

**Increasing** = System learning and optimizing
**Stable** = Building patterns
**Sudden drops** = Major change or reset

### Task Success Rate

Check logs to see:
- How many ✅ successes
- How many ❌ failures
- Percentage of successful tasks

## Troubleshooting User Issues

### I can't send commands

**Check:**
1. Server connected? (green status)
2. Input box has text?
3. Clicked ➤ or pressed Enter?
4. No errors in chat?

**Solution:**
- Start backend: `npm start`
- Refresh app: Cmd+R
- Restart both services

### Voice input isn't working

**Check:**
1. Granted microphone permission?
2. Microphone working on system?
3. Browser supports voice?

**Solution:**
- Grant microphone permission
- Check system preferences
- Use keyboard instead
- Refresh and try again

### Suggestions not appearing

**Check:**
1. Score is low? (need more patterns)
2. Same command 3+ times?
3. Enough variety?

**Solution:**
- Execute more commands
- Repeat some commands
- Wait a few seconds
- Suggestions auto-load

### App crashes or freezes

**Solution:**
1. Force quit: Cmd+Q
2. Restart both services
3. Check for errors in logs
4. Clear cache: `rm -rf ~/Library/Application\ Support/JARVIS`

## Advanced Usage

### Custom Commands

After suggestions, you can use generated agents:
```
jarvis chrome-launcher    # Fast Chrome launch
jarvis quick-search "term"  # Quick search agent
```

### Chaining Commands

Send multiple commands in sequence:
```
open chrome and type google and press enter
```

### Monitoring Performance

Use DevTools to monitor:
1. Open DevTools: Cmd+Option+I
2. Click "Console" to see logs
3. Click "Network" to see API calls
4. Click "Performance" to profile

## Tips & Tricks

### Speed Up Commands
1. Execute frequently used commands repeatedly
2. Check suggestions
3. Approve suggestions
4. Use generated agents

### Build Patterns Faster
- Execute similar tasks in sequence
- System detects patterns quicker
- Suggestions generated sooner

### Monitor Progress
- Keep Evolution Score visible
- Check it increases over time
- Higher score = better optimization

### Save Favorites
- Copy commands you use often
- Paste quickly
- Or approve as agents

### Customize Interface
- Resize window
- Rearrange panels (future)
- Change theme (future)

## Data Privacy

**What's stored:**
- Chat history (session only)
- Task logs (for review)
- Suggestions (until approved/dismissed)
- Evolution score (real-time)

**What's NOT shared:**
- No personal data collected
- No internet transmission
- All local processing
- Database stored locally

## Performance Tips

1. **Clear older logs**
   - Large logs slow down UI
   - Delete old entries periodically

2. **Restart periodically**
   - Every 100+ commands
   - Clears memory
   - Resets scores

3. **Monitor resource usage**
   - Check Activity Monitor
   - App should use <300MB RAM
   - <5% CPU when idle

4. **Keep backend responsive**
   - Avoid other heavy tasks
   - Check network connection
   - Ensure port 3000 is available

## Getting Help

**If you're stuck:**
1. Check this guide
2. Read error messages carefully
3. Open DevTools: Cmd+Option+I
4. Check system logs
5. Restart both services
6. Review README files

**Common issues addressed in:**
- SETUP_GUIDE.md
- COMPLETE_SETUP.md
- README.md

---

## Quick Reference Card

```
┌─────────────────────────────────────────────────┐
│          JARVIS Desktop Usage Guide              │
├─────────────────────────────────────────────────┤
│                                                 │
│  SEND COMMAND:      Type + Press Enter          │
│                                                 │
│  VOICE INPUT:        Click 🎤 button            │
│                                                 │
│  VIEW SUGGESTIONS:   Click 💡 Suggestions       │
│                                                 │
│  APPROVE SUGGESTION: Click ✓ Approve           │
│                                                 │
│  CHECK HISTORY:      Click 📋 Logs             │
│                                                 │
│  MONITOR SCORE:      See top-right header      │
│                                                 │
│  CHECK STATUS:       Green/Red dot at bottom   │
│                                                 │
│  OPEN DEV TOOLS:     Cmd+Option+I              │
│                                                 │
│  REFRESH APP:        Cmd+R                      │
│                                                 │
└─────────────────────────────────────────────────┘
```

---

**🤖 You're ready to use JARVIS!**

*Start with simple commands, watch suggestions appear, approve them to create agents, and watch your Evolution Score climb!*

**Next:** Follow the [Setup Guide](./SETUP_GUIDE.md) to get started.
