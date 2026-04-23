# ⚡ JARVIS Desktop - Quick Reference Card

*Print this page and keep it by your desk!*

---

## 🚀 Starting the App

### First Time
```bash
cd /Users/ehtsm/electron
npm install           # Install dependencies (1st time only)
npm start            # Launches backend + app
```

### Every Other Time
```bash
npm start            # From app directory
```

### Start Backend Only
```bash
cd /Users/ehtsm
npm start
```

---

## 🎮 Main Controls

| Action | Method |
|--------|--------|
| Send Command | Type + **Enter** or ➤ button |
| Voice Input | Click **🎤** button → Speak |
| Clear Chat | Click **🗑️** button |
| Switch Tabs | Click **💬** / **💡** / **📋** buttons |
| Approve Suggestion | Click **✓** button on card |
| Dismiss Suggestion | Click **✕** button on card |
| Open DevTools | **Cmd+Option+I** |
| Quit App | **Cmd+Q** |
| Refresh App | **Cmd+R** |

---

## 💬 Example Commands

```bash
# Simple
open chrome
type hello
press enter

# With actions
open chrome and type google

# Sequences
open chrome, type hello, press enter
```

---

## 🎯 UI Quick Tour

```
┌─ HEADER ────────────────────────────┐
│ 🤖 JARVIS    Score: 75 (Optimal)   │
├─ TABS ──────────────────────────────┤
│ 💬 Chat │ 💡 Suggestions (2) │ 📋 Logs (5) │
├─ CONTENT ──────────────────────────┤
│ [Messages/Suggestions/Logs Display]  │
├─ INPUT ────────────────────────────┤
│ [Type here] 🎤  ➤  🗑️             │
├─ STATUS BAR ──────────────────────┤
│ 🟢 Connected     Ready             │
└────────────────────────────────────┘
```

---

## 📊 Status Indicators

| Indicator | Meaning |
|-----------|---------|
| 🟢 Green | Server connected ✓ |
| 🔴 Red | Server offline ✗ |
| ✅ | Command succeeded |
| ❌ | Command failed |
| ⏳ | Command pending |
| 🎤 Listening | Voice input active |

---

## 💡 Suggestions Confidence

| Badge | Level | Reliability |
|-------|-------|-------------|
| 🔴 92% | High | Very reliable |
| 🟡 76% | Medium | Probably OK |
| 🟢 54% | Low | Uncertain |

**Higher % = Better suggestion to approve**

---

## 📋 Logs Status Legend

```
✅ Task completed successfully
❌ Task failed with error
⏳ Task still running
```

**Newest entries appear at top**

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| **Enter** | Send command |
| **Shift+Enter** | New line (in input) |
| **Cmd+Q** | Quit app |
| **Cmd+R** | Reload |
| **Cmd+Option+I** | Developer tools |
| **Cmd+Shift+F** | Toggle floating window |

---

## 🎤 Voice Input Flow

```
1. Click 🎤 button
2. Browser asks for permission
3. Click "Allow" (first time only)
4. Button shows "Listening..."
5. Speak your command
6. Stop speaking
7. Text appears in input box
8. Press Enter or click ➤ to send
```

---

## 💭 Evolution Score Meaning

| Score | Status | Meaning |
|-------|--------|---------|
| 0-20 | 🟠 Learning | Initial phase |
| 20-40 | 🔵 Building | Learning patterns |
| 40-60 | 🟢 Pattern Rec | Recognizing behaviors |
| 60-80 | 🟢 Optimal | Good optimization |
| 80-100 | 🟢 Expert | Highly optimized |

**Increases with more command usage**

---

## 🔧 Troubleshooting Quick Fixes

### ❌ Server Offline
```bash
cd /Users/ehtsm
npm start
# Wait for "Server running on port 3000"
```

### ❌ Commands Not Sending
1. Check green status indicator
2. Make sure input box has text
3. Press Enter or click ➤

### ❌ No Suggestions
1. Execute 3+ commands of same type
2. Wait 5 seconds
3. Refresh app: Cmd+R

### ❌ Voice Not Working
1. Allow microphone when asked
2. Check microphone in System Preferences
3. Try typing instead

### ❌ App Frozen
```bash
Cmd+Q  # Quit
npm start  # Restart
```

---

## 📂 Important Paths

```
/Users/ehtsm/                    # Backend root
/Users/ehtsm/electron/           # App root
/Users/ehtsm/electron/src/       # React source
/Users/ehtsm/electron/main.js    # Main process
```

---

## 🔌 Ports Used

| Port | Service |
|------|---------|
| 3000 | Backend API |
| 3001 | React dev server |

**If port in use:**
```bash
lsof -i :3000
kill -9 <PID>
npm start
```

---

## 📚 Documentation Files

| File | Purpose | Time |
|------|---------|------|
| README.md | Overview | 10m |
| SETUP_GUIDE.md | Installation | 15m |
| USER_GUIDE.md | Features | 15m |
| TROUBLESHOOTING.md | Fixes | 5m |
| ARCHITECTURE.md | Technical | 20m |
| COMPLETE_SETUP.md | Backend+App | 10m |
| DOCUMENTATION_INDEX.md | Navigation | 5m |

---

## 🔄 Common Workflows

### Send Command
```
1. Chat tab (active)
2. Type: open chrome
3. Press Enter
4. Wait for response
```

### Approve Suggestion
```
1. Click 💡 Suggestions tab
2. Read suggestion card
3. Click ✓ Approve
4. Confirmation appears
```

### Check History
```
1. Click 📋 Logs tab
2. See all executed tasks
3. Click entry to see details
4. Scroll to see older tasks
```

### Monitor Progress
```
1. Watch Evolution Score (top-right)
2. See it increase over time
3. Higher score = more optimization
4. Check Logs tab for execution history
```

---

## 🆘 Emergency Reset

**If everything breaks:**
```bash
# Quit everything
Cmd+Q

# Clear app cache
rm -rf ~/Library/Application\ Support/JARVIS

# Kill any hanging processes
pkill -f electron
pkill -f node

# Start fresh
cd /Users/ehtsm/electron
npm start
```

---

## 📊 Performance Tips

- ✅ Keep app updated
- ✅ Close unused tabs
- ✅ Clear old logs periodically
- ✅ Restart after 100+ commands
- ✅ Keep backend responsive
- ✅ Don't run too many apps

---

## 🎓 Learning Path (30 min)

```
1. Read: README.md (5 min)
2. Install: SETUP_GUIDE.md (5 min)
3. Start: npm start (2 min)
4. Learn: USER_GUIDE.md (15 min)
5. Explore: Try all features (3 min)
```

---

## 📞 When Stuck

| Issue | Solution |
|-------|----------|
| Error message | Search TROUBLESHOOTING.md |
| How to X? | Check USER_GUIDE.md |
| Installation problem | See SETUP_GUIDE.md |
| Integration issue | Read COMPLETE_SETUP.md |
| Technical details | Check ARCHITECTURE.md |

---

## ✨ Tips & Tricks

- **Voice faster than typing** → Use 🎤 button
- **Patterns = Suggestions** → Repeat commands
- **Suggestions = Agents** → Approve to create
- **Score = Optimization** → Increases with use
- **Logs = History** → Review for learning

---

## 🎯 Success Checklist

- ✓ Backend running (npm start in main dir)
- ✓ App running (npm start in electron dir)
- ✓ Status shows green 🟢
- ✓ Can type in chat
- ✓ Can send command
- ✓ See response in chat
- ✓ Score visible (top-right)

**All checked?** → App is working perfectly! 🎉

---

## 🔗 Quick Links

| Item | Location |
|------|----------|
| Documentation Index | DOCUMENTATION_INDEX.md |
| User Manual | USER_GUIDE.md |
| Installation | SETUP_GUIDE.md |
| Troubleshooting | TROUBLESHOOTING.md |
| Architecture | ARCHITECTURE.md |
| Backend + App | COMPLETE_SETUP.md |
| Project README | README.md |

---

## 📱 Mobile-Friendly Tips

**Can't use microphone?**
→ Just type instead

**Need larger text?**
→ Edit App.css, increase font-size

**Want dark mode even darker?**
→ Edit CSS variables in App.css

**Need different colors?**
→ Change --color-primary and --color-secondary

---

## 🚀 Build & Deploy

### For Testing
```bash
npm start  # Dev mode
```

### For Distribution
```bash
npm run build-app      # All platforms
npm run build-app-mac  # macOS only
npm run build-app-linux  # Linux only
npm run build-app-win  # Windows only
```

**Result:** Installers in `dist/` folder

---

## 💾 File Locations

```
Config files:        main.js, package.json
Source code:         src/App.jsx, src/components/*.jsx
Styling:             src/*.css, src/components/*.css
Documentation:       *.md files
Built app:           dist/
```

---

## 🎤 Voice Tips

- **Speak naturally** - Like talking to a person
- **Pause between words** - So system understands
- **Use clear commands** - "open chrome", not "run thing"
- **Quiet room** - Better recognition
- **Microphone closer** - Better audio capture

---

## 🔐 Security Notes

- ✅ No data sent to internet
- ✅ All processing local
- ✅ Can work offline (except backend)
- ✅ No telemetry
- ✅ No login required

---

## ⚡ Speed Optimization

**Make it faster:**
1. Reduce polling interval (developer only)
2. Clear old logs regularly
3. Close DevTools (Cmd+Option+I)
4. Reduce animation effects (CSS)
5. Keep system resources free

---

## 📝 Adding Notes to Chat

**Currently not supported**, but you can:
1. Save important outputs
2. Take screenshots
3. Export logs (future feature)
4. Use Notes app for reference

---

## 🎨 Customization

**Colors:** Edit `/Users/ehtsm/electron/src/App.css`
- `--color-primary` (cyan)
- `--color-secondary` (magenta)
- `--surface-bg` (background)

**Fonts:** Edit component `.css` files
- `font-size`
- `font-family`
- `line-height`

**Layout:** Edit component `.jsx` files
- Remove/hide sections
- Rearrange panels
- Change sizes

---

## 📊 Monitoring Checklists

### Daily
- ✓ Server indicator green
- ✓ Commands responding
- ✓ Score visible

### Weekly
- ✓ Clear old logs
- ✓ Review suggestions
- ✓ Check evolution progress

### Monthly
- ✓ Update app
- ✓ Review created agents
- ✓ Full system restart

---

## 🎁 Useful Commands to Try

```
# App launching
open chrome
open calculator
open notepad

# Keyboard actions
type "hello"
press enter
click button

# Combinations
open chrome and type google and press enter

# Multiple steps
type hello, press space, type world
```

---

**Print This Page** 📄

Use this as your desk reference for quick lookups!

---

**Version 1.0**  
*Keep this handy while using JARVIS*

Questions? Check [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) or [USER_GUIDE.md](./USER_GUIDE.md)

🤖 **Happy Automating!**
