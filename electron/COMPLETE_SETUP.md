# 🚀 JARVIS Complete Setup - Backend + Desktop App

This guide shows how to run both the JARVIS backend and the desktop application together.

## 📋 Prerequisites

- Node.js 14+ installed
- npm or yarn
- macOS, Linux, or Windows
- ~500MB disk space

## ⚡ Quick Start (5 Minutes)

### Step 1: Start Backend (Terminal 1)

```bash
# Navigate to project root
cd /Users/ehtsm

# Install dependencies (first time only)
npm install

# Start the backend server
npm start
```

Expected output:
```
✅ JARVIS running on http://localhost:3000
✅ Evolution Engine initialized
✅ Database ready
```

### Step 2: Start Desktop App (Terminal 2)

```bash
# Navigate to electron directory
cd /Users/ehtsm/electron

# Install dependencies (first time only)
npm install

# Start the desktop application
npm start
```

Expected output:
```
Compiled successfully!
...
Electron app launching...
```

The Electron app will:
1. Start React dev server on http://localhost:3001
2. Wait for server to load
3. Auto-launch Electron window
4. Connect to backend at http://localhost:3000

### Step 3: Use the App! 🎉

Once both are running:
1. **Type a command**: "open chrome", "search google"
2. **Press Enter** to execute
3. **Check suggestions**: Click the 💡 Suggestions tab
4. **View logs**: Click the 📋 Logs tab
5. **Monitor score**: Watch it increase in top-right

## 📐 Complete Architecture

```
┌──────────────────────────────────┐
│   JARVIS Desktop App             │
│   (Electron + React)             │
│   http://localhost:3001 (dev)    │
├──────────────────────────────────┤
│                                  │
│  Renderer Process:               │
│  ├─ ChatPanel (💬)              │
│  ├─ SuggestionsPanel (💡)       │
│  ├─ LogsPanel (📋)              │
│  ├─ StatusBar (🔗)              │
│  └─ EvolutionScore (📊)         │
│                                  │
│  Main Process:                   │
│  ├─ IPC Communication            │
│  ├─ HTTP API Calls               │
│  └─ Server Health Monitor        │
│                                  │
└──────────────────────────────────┘
           ↓ (HTTP)
┌──────────────────────────────────┐
│   JARVIS Backend                 │
│   (Node.js)                      │
│   http://localhost:3000          │
├──────────────────────────────────┤
│                                  │
│  ├─ Orchestrator                │
│  ├─ Evolution Engine             │
│  ├─ Learning System              │
│  └─ Database (SQLite)            │
│                                  │
└──────────────────────────────────┘
```

## 🔄 Data Flow

### User Sends Command
```
Desktop App
  ↓ (user types "open chrome")
ChatPanel component
  ↓
window.electronAPI.sendCommand()
  ↓ (IPC)
Main Process
  ↓
axios.post('http://localhost:3000/jarvis')
  ↓
Backend Orchestrator
  ↓ (analyze, execute, learn, optimize)
Response
  ↓ (back up the chain)
ChatPanel displays results + suggestions
```

## 🎯 Typical Workflow

### 1. Initialize (First Run)
```bash
# Terminal 1: Backend
cd /Users/ehtsm
npm install
npm start
# Wait for "JARVIS running" message

# Terminal 2: App
cd /Users/ehtsm/electron
npm install
npm start
# Wait for Electron window
```

### 2. Execute Commands
- Type: "open google"
- Press Enter
- See results in chat
- Check execution logs

### 3. Build Patterns
- Execute same command 3+ times
- System detects pattern
- Evolution score increases

### 4. Review Suggestions
- Click 💡 Suggestions tab
- See AI recommendations
- Each shows confidence level
- Click "✓ Approve" to create agent

### 5. Use Generated Agents
- New agents available immediately
- Faster execution of optimized workflows
- Evolution score increases
- Learning cycle continues

## 📊 Monitoring System Health

### Backend Health
Check in terminal running backend:
```
✅ Commands executed: 15
✅ Patterns detected: 3
✅ Suggestions generated: 2
```

### Desktop App Health
Watch the status bar at bottom:
- 🟢 Green dot = "[color]Server Connected"
- 🔴 Red dot = "Server Offline"

### Evolution Score
Top-right shows current score (0-100):
- 0-20: Learning Phase
- 20-40: Building Patterns
- 40-60: Pattern Recognition
- 60-80: Optimal
- 80+: Highly Optimized

## 🛠️ Troubleshooting

### Issue: Backend won't start

**Error**: `address already in use :::3000`

**Solution**:
```bash
# Find process using port 3000
lsof -i :3000

# Kill the process
kill -9 <PID>

# Try again
npm start
```

---

### Issue: Desktop app can't connect

**Error**: "Server disconnected" in app

**Solution**:
1. Verify backend is running: `curl http://localhost:3000`
2. Check server logs for errors
3. Restart backend
4. Restart desktop app

---

### Issue: React dev server won't start

**Error**: `port 3001 already in use`

**Solution**:
```bash
# Kill the process
lsof -i :3001
kill -9 <PID>

# Or use different port
PORT=3002 npm start
```

---

### Issue: Voice input not working

**Error**: Microphone button doesn't respond

**Solution**:
1. Grant microphone permissions (browser will ask)
2. Allow microphone in system settings
3. Try again
4. Check: Cmd+Option+I → Console for errors

---

### Issue: Changes not showing in desktop app

**Error**: File changes not auto-reloading

**Solution**:
1. Save file (Auto-reload should trigger)
2. If not, manual reload: Cmd+R
3. Restart dev server if issues persist

---

## 📦 Deployment

### Build for Production

```bash
# From electron directory
cd /Users/ehtsm/electron

# Build optimized version
npm run build-app

# Creates installer in dist/:
# - macOS: JARVIS-1.0.0.dmg
# - Linux: JARVIS-1.0.0.AppImage
# - Windows: JARVIS Setup 1.0.0.exe
```

###Distribute App

1. **Share Installer**
   - Double-click to install
   - App runs independently
   - Still needs backend server

2. **Bundle Everything**
   - Create Docker container
   - Include backend + app
   - Full solution in one package

## 🔐 Security Notes

### API Communication
- Backend validates all requests
- Desktop app uses IPC (safe)
- Preload script sandboxes API
- Context isolation enabled

### Data Storage
- No sensitive data on disk
- Learning data stored locally only
- User has full control

### Development Mode
- DevTools available with Cmd+Option+I
- Debug both main and renderer
- Network tab shows all requests

## ⚙️ Configuration

### Change Backend URL
Edit `/Users/ehtsm/electron/main.js`:
```javascript
const API_URL = 'http://localhost:3000';  // Change here
```

### Change Desktop App Port
Edit start command:
```bash
PORT=3002 npm start  # Uses port 3002 instead
```

### Change Desktop Window Size
Edit `/Users/ehtsm/electron/main.js`:
```javascript
mainWindow = new BrowserWindow({
  width: 1400,   // Change this
  height: 900,   // And this
});
```

## 🎓 Learning Resources

### Backend Documentation
- [Evolution System Docs](../EVOLUTION_SYSTEM_DOCS.md)
- [Phase 7 Summary](../PHASE_7_SUMMARY.md)
- [Complete Evolution](../JARVIS_COMPLETE_EVOLUTION.md)

### Desktop App Documentation
- [App README](./README.md)
- [Setup Guide](./SETUP_GUIDE.md)

### External Resources
- [Electron Docs](https://www.electronjs.org/docs)
- [React Docs](https://react.dev)
- [Node.js Docs](https://nodejs.org/docs)

## 🚀 Advanced Tips

### Enable Debug Logging
Edit `main.js`:
```javascript
// Uncomment to see all IPC communication
console.log('IPC:', channel, args);
```

### Monitor API Calls
1. Open DevTools: Cmd+Option+I
2. Click "Network" tab
3. Execute commands
4. See all HTTP requests

### Profile Performance
1. Use React DevTools: `npm install -D @react-devtools`
2. Built-in Electron profiler
3. Check main process CPU usage

## 📋 Daily Workflow

### Morning Setup
```bash
# Terminal 1: Backend
cd /Users/ehtsm && npm start

# Terminal 2: Desktop
cd /Users/ehtsm/electron && npm start
```

### During Day
- Use app normally
- Execute commands
- Monitor evolution score
- Approve suggestions

### Evening
- Review task logs
- Check optimization progress
- Export reports if needed
- Stop servers: Ctrl+C in both terminals

## 🔄 Update Process

### Update Backend
```bash
cd /Users/ehtsm
git pull origin main
npm install
npm start
```

### Update Desktop App
```bash
cd /Users/ehtsm/electron
git pull origin main
npm install
npm start
```

Both use hot-reload during development.

## 📞 Support

### If Something Breaks
1. Read error message carefully
2. Check Troubleshooting section above
3. Review DevTools console
4. Restart both services
5. Check network connectivity
6. Verify ports are available

### Getting Help
- Check README files in each directory
- Look at component source code
- Review API documentation
- Check JARVIS project docs

## ✅ Success Checklist

- [ ] Backend running on :3000
- [ ] Desktop app running on :3001
- [ ] Green status indicator in app
- [ ] Can type and send commands
- [ ] Results show in chat
- [ ] Server health shows ✅
- [ ] Evolution score displays
- [ ] Suggestions appear after repetition
- [ ] Can approve suggestions
- [ ] Task logs show executed commands

Once all checked, you're ready to use JARVIS! 🎉

---

## 🎉 You're All Set!

You now have:
- ✅ JARVIS backend running
- ✅ Desktop app connected
- ✅ Chat interface ready
- ✅ Evolution system active
- ✅ Suggestions enabled
- ✅ Logging working

**Start typing commands and watch JARVIS evolve!**

---

**Quick Reference**
```bash
# Start everything (in 2 terminals)
Terminal 1: cd /Users/ehtsm && npm start
Terminal 2: cd /Users/ehtsm/electron && npm start
```

---

*Enjoy JARVIS: Your Self-Evolving AI Assistant*
