# 🚀 JARVIS Desktop App - Startup Guide

## Architecture Overview
```
Port 3000: Node.js Backend (server.js)
  └─ Express API with command parsing & orchestration
  
Port 3001: React Frontend (electron/src)
  └─ Web UI - runs via `npm start` in /electron folder
  
Browser/Electron: Displays React on :3001
  └─ Calls backend at :3000 via HTTP
```

## ⚡ Quick Start (3 Steps)

### Step 1: Start Backend Server
```bash
cd /Users/ehtsm
node server.js
```
**Expected Output:**
```
🚀 Jarvis Server running on http://localhost:3000
📋 Features: Multi-Agent Orchestrator | Planner | Executor | Scheduler...
🧠 Enhanced: Context Awareness | Learning System...
✨ Every request flows through: planner → executor → memory
```

### Step 2: Start React Frontend (New Terminal)
```bash
cd /Users/ehtsm/electron
npm start
```
**Expected Output:**
```
webpack compiled successfully
Compiled successfully!
You can now view JARVIS Desktop App in the browser.
  Local: http://localhost:3001
```

### Step 3: Open UI
- **Browser**: Open http://localhost:3001 in Chrome/Safari
- **Or Electron**: The app should auto-launch in Electron window

**Your UI should show:**
- JARVIS logo at top
- Chat area (empty or with "No messages yet")
- Input box with "Type a command..."
- Voice button (🎤), Send button (➤), Clear button (🗑️)
- Status bar showing "✓ Server Connected Ready"

---

## 🧪 Test the Voice Command Parser

### Test 1: Verify Backend is Running
```bash
curl http://localhost:3000/
```
**Expected:** JSON response with "Jarvis Server is Running"

### Test 2: Test Smart Command Parser
```bash
curl -X POST http://localhost:3000/parse-command \
  -H "Content-Type: application/json" \
  -d '{"command": "open google"}'
```
**Expected Response:**
```json
{
  "success": true,
  "input": "open google",
  "parsed": {
    "type": "open_url",
    "url": "https://google.com",
    "label": "Opening Google",
    "action": "open_browser"
  },
  "result": {
    "success": true,
    "message": "Opening Opening Google",
    "action": "open_browser"
  }
}
```

### Test 3: Test Voice Commands in UI
In the React UI on port 3001:

**Command 1: Open URL**
- Input: `open youtube`
- Send
- Expected: 
  - Chat shows: "👤 open youtube"
  - Then: "🧠 Understood: Opening YouTube"
  - Then: "✅ Opening Opening YouTube"

**Command 2: Timer**
- Input: `set timer 5 minutes`
- Send
- Expected: Shows timer parsing + result

**Command 3: Greeting**
- Input: `hello jarvis`
- Send
- Expected: Shows greeting response

---

## 🔍 Supported Commands

### URLs (Open in Browser)
- `open google` → google.com
- `open youtube` → youtube.com
- `open github` → github.com
- `open stackoverflow` → stackoverflow.com

### Applications
- `open chrome` → Launches Chrome
- `open vscode` → Launches VS Code
- `open calculator` → Launches Calculator
- `open spotify` → Launches Spotify

### Time & Date
- `what time is it` → Shows current time
- `what is today` → Shows current date
- `date` → Shows current date

### AI Interaction
- `hello jarvis` → Greeting response
- `hey jarvis` → Greeting response
- `how are you` → Status response

### Notes & Search
- `note take a break` → Creates note ("take a break")
- `search what is AI` → Web search for "what is AI"
- `find python tutorial` → Web search for "python tutorial"

### Timers & Reminders
- `set timer 5 minutes` → 5-minute timer
- `remind me to call mom` → Creates reminder
- `set reminder meeting` → Creates reminder

---

## 🛠️ Troubleshooting

### Issue: "Port 3000 already in use"
**Solution:**
```bash
# Kill process on port 3000
lsof -ti :3000 | xargs kill -9

# Then start fresh
node server.js
```

### Issue: "Port 3001 already in use"
**Solution:**
```bash
# Kill process on port 3001
lsof -ti :3001 | xargs kill -9

# Then start React
cd /Users/ehtsm/electron
npm start
```

### Issue: UI shows "❌ Server is disconnected"
**Solution:**
- Make sure backend is running on port 3000
- Check if backend crashed: look at Terminal 1 for errors
- Restart: Kill backend (Ctrl+C) and run `node server.js` again

### Issue: Button click shows no response
**Solution:**
1. Check browser console (F12 → Console tab)
2. Look for errors like "Failed to fetch"
3. Verify backend is running: `curl http://localhost:3000/`
4. Check if command is spelled correctly

### Issue: Commands not recognized
**Solution:**
- Most commands are fuzzy-matched (case-insensitive)
- Try exact phrases from "Supported Commands" list above
- Examples:
  - ✅ "open youtube" or "youtube" (both work)
  - ❌ "go to youtube" (not supported - use "open")

---

## 📊 Clean Startup Script

Instead of managing two terminals, use the auto-start script:

```bash
bash /Users/ehtsm/start-jarvis.sh
```

This will:
1. Kill any existing processes
2. Start backend on port 3000
3. Start React on port 3001
4. Display status of both

---

## 🎯 Complete End-to-End Flow

```
1. User types: "open google"
2. Clicks ➤ or presses Enter

3. ChatPanel.jsx:
   - Sends HTTP POST to http://localhost:3000/parse-command
   - Payload: { command: "open google" }

4. Backend (server.js):
   - Receives request on /parse-command endpoint
   - Calls parseCommand("open google")
   - Gets: { type: "open_url", url: "https://google.com", ... }
   - Calls executeCommand(parsed)
   - Gets: { success: true, message: "Opening Google", ... }
   - Returns JSON response

5. ChatPanel.jsx:
   - Receives response
   - Shows: "🧠 Understood: Opening Google"
   - Then shows: "✅ Opening Opening Google"

6. UI Updated:
   - Messages displaying command flow
   - Ready for next command
```

---

## 📝 Log File Locations

**Backend logs:** Console terminal (where you ran `node server.js`)
- Look for: "🎤 Voice input:", "🧠 Parsed command:", "✅ Execution result:"

**Frontend logs:** Browser DevTools Console (F12)
- Look for: Console.logs from ChatPanel.jsx or App.jsx

---

## ✅ Success Criteria

After startup, verify:
1. ✅ Backend shows "🚀 Jarvis Server running on http://localhost:3000"
2. ✅ React shows "Compiled successfully!" and displays at http://localhost:3001
3. ✅ UI shows "✓ Server Connected Ready" in status
4. ✅ Typing a command and clicking send works
5. ✅ Chat shows command parsing flow (🧠 Understood + ✅ Result)
6. ✅ No error messages in DevTools console

Once all these pass, everything is working! 🎉
