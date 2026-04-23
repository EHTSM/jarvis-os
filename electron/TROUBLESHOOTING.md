# 🔧 JARVIS Desktop App - Quick Troubleshooting & FAQ

## Status: Quick Diagnostic

**Before troubleshooting**, check this first:

```bash
# Terminal 1: Is backend running?
lsof -i :3000
# You should see a Java or Node process running

# Terminal 2: Is npm installed?
npm --version
# Version should be 6+

# Terminal 3: Is Electron running?
ps aux | grep -i electron
# You should see electron process
```

---

## ❌ Common Problems & Solutions

### 🔴 "Server Offline" Status Bar

**What it means:**  
Backend not running or not responding on localhost:3000

**Quick Fix:**
```bash
cd /Users/ehtsm
npm start
# Wait for "Server running on port 3000"
```

**If still offline:**
- Check backend console for errors
- Verify port 3000 is free: `lsof -i :3000`
- Kill other process if needed: `kill -9 <PID>`
- Restart: `npm start`

**Verify connection:**
- App should show 🟢 Green status
- Chat input becomes enabled
- Can send commands

---

### 💬 Commands Don't Send

**Symptom:** Click ➤ button but nothing happens

**Cause checklist:**
- [ ] Server offline? (check red status)
- [ ] Input box empty?
- [ ] Network connection?

**Solution:**
1. **Verify server**: See "Server Offline" section above
2. **Type something**: `open chrome`
3. **Press Enter** or click ➤
4. **Check Console** for errors: Cmd+Option+I → Console tab

**If still stuck:**
```bash
# Restart everything
# Terminal 1
pkill -f electron
npm start

# Terminal 2 (different terminal)
cd /Users/ehtsm/electron
npm start
```

---

### 🎤 Voice Input Not Working

**Symptom:** Click 🎤 button, nothing happens or errors appear

**Cause checklist:**
- [ ] Microphone plugged in?
- [ ] Granted permission to microphone?
- [ ] Browser supports web audio?
- [ ] Already gave permission to different browser?

**Quick Fix:**
1. **Grant permission**:
   - Click 🎤 button
   - Browser asks "Allow microphone access?"
   - Click "Allow"
   - Try again

2. **Check microphone**:
   - System Preferences → Sound → Input
   - Select correct microphone
   - Check "Input level" moves when you speak

3. **Reset browser permission**:
   - Cmd+Q to quit Jarvis
   - Open System Preferences → Security & Privacy → Camera/Microphone
   - Find "Electron Helper" or "Jarvis"
   - Click the 🔒 icon and remove permission
   - Restart Jarvis
   - Click 🎤 and allow again

**Workaround:** Type instead of using voice

---

### 💡 No Suggestions Appearing

**Symptom:** Suggestions panel is empty

**What to expect:**
- Need 3+ commands of same type to generate suggestion
- Or same sequence 2+ times
- Takes ~5 seconds after pattern detected

**Solution:**
1. **Execute more commands**:
   ```
   open chrome
   open chrome
   open chrome
   (Suggestion appears after 3rd time)
   ```

2. **Try different command types**:
   ```
   open chrome
   open calculator  (different app)
   open files       (different again)
   (More patterns = more suggestions)
   ```

3. **Wait a few seconds**:
   - After executing command
   - Suggestions update every 3 seconds
   - Keep Suggestions tab open to see

**If still no suggestions:**
- Check score increasing (top-right)
- Try admin/privileged command
- Check backend logs for errors: `brew log jarvis` (if using Homebrew)

---

### 📊 Evolution Score Not Updating

**Symptom:** Score stuck at same number

**Cause:**
- System needs commands to learn
- Score updates slowly initially
- Need variety in commands

**Solution:**
1. **Send more commands**:
   ```
   open chrome
   type hello
   press enter
   click button
   (5+ commands minimum)
   ```

2. **Verify score endpoint working**:
   - Open DevTools: Cmd+Option+I
   - Click Network tab
   - Click Suggestions tab in app
   - Should see API calls
   - Look for `/evolution/score` request
   - Status should be 200 (not 404/500)

3. **Reset if needed**:
   - Delete score database
   - Restart both services
   - Score will reset to 0

---

### 🔴 App Crashes on Launch

**Symptom:** Electron window doesn't open or closes immediately

**Quick Fix:**
```bash
# Kill any hanging processes
pkill -f electron
pkill -f node

# Clear app cache
rm -rf ~/Library/Application\ Support/JARVIS

# Restart from clean state
cd /Users/ehtsm/electron
npm start
```

**If still crashing:**
1. Check system requirements:
   ```bash
   npm --version    # Should be 6+
   node --version   # Should be 14+
   ```

2. Reinstall dependencies:
   ```bash
   rm -rf node_modules package-lock.json
   npm install
   npm start
   ```

3. Check console output:
   - Look for error messages before exit
   - Search error message below

---

### ❌ "Cannot find module 'electron'"

**Cause:** Dependencies not installed

**Fix:**
```bash
cd /Users/ehtsm/electron
npm install
```

**If npm install fails:**
```bash
# Clean cache and retry
npm cache clean --force
rm package-lock.json
npm install
```

---

### 🌐 Network/Connection Errors

**Symptom:** 
- "Cannot reach server" error
- "Network timeout" message
- Commands fail with connection errors

**Verify connection:**
```bash
# Check if localhost:3000 responds
curl http://localhost:3000/health

# Should return: {"status": "ok"} or similar
```

**If fails:**
1. Backend not running (see Server Offline section)
2. Port blocked by firewall:
   ```bash
   # Check firewall
   sudo lsof -i -P -n | grep LISTEN
   
   # Temporarily disable firewall for testing
   # System Preferences → Security & Privacy → Firewall → Turn Off
   ```
3. Proxy/VPN interfering:
   - Disable VPN temporarily
   - Try disabling proxy

---

### 🔒 Microphone Permission Errors

**Symptom:**  
- "Permission denied" when clicking 🎤
- App doesn't ask for permission

**Solution:**
1. **Reset permissions**:
   ```bash
   # Quit Jarvis first
   Cmd+Q
   
   # Remove from Security & Privacy
   System Preferences → Security & Privacy → Camera
   Find and remove "Electron Helper" entry
   Restart Jarvis
   ```

2. **Grant permission when prompted**:
   - Click 🎤
   - Browser asks for permission
   - Click "Allow"
   - Speak into microphone

3. **Verify in preferences**:
   - System Preferences → Security & Privacy → Microphone
   - Check "Electron Helper" is in the list
   - Make sure it's NOT blocked (no icon next to it)

---

### 🖥️ "Port 3000 Already in Use"

**Symptom:**  
Error message when starting backend: "Port 3000 already in use"

**Find what's using it:**
```bash
lsof -i :3000
# Shows process ID (PID)
```

**Kill the process:**
```bash
# Replace 12345 with actual PID
kill -9 12345

# Or search and kill by name
pkill -f "node.*3000"
```

**Or use different port:**
```bash
# Start on port 3001 instead
PORT=3001 npm start

# Then in Jarvis, update connection:
# Edit: /Users/ehtsm/electron/main.js
# Change: http://localhost:3000 → http://localhost:3001
```

---

### 📝 "Invalid Command" Errors

**Symptom:**  
Command executes but returns: "❌ Command not recognized"

**What's supported:**
- App launching: `open chrome`, `open calculator`
- Typing: `type hello`, `type world`
- Keyboard: `press enter`, `click button`
- Combinations: `open chrome and type hello and press enter`

**What's NOT supported:**
- System-level: `restart`, `shutdown`
- Password-protected: `sudo` commands
- Interactive: Commands requiring input

**Solution:**
1. Check [USER_GUIDE.md](./USER_GUIDE.md) for supported commands
2. Try simpler commands first
3. Break into smaller commands
4. Check backend logs for actual error

---

### 🔄 "App Frozen" / Not Responding

**Symptom:**  
UI becomes stuck, buttons don't respond

**Quick Fix:**
1. **Force quit**:
   ```bash
   Cmd+Q
   ```

2. **Restart**:
   ```bash
   cd /Users/ehtsm/electron
   npm start
   ```

**If frequently freezing:**
1. Clear cache:
   ```bash
   rm -rf ~/Library/Caches/*/JARVIS
   ```

2. Check system resources:
   - Open Activity Monitor
   - Check CPU usage (should be <20% idle)
   - Check memory (should be <500MB)
   - Close other apps if high

3. Restart both services:
   ```bash
   pkill -f electron
   pkill -f node
   sleep 2
   npm start  # In terminal 1
   cd ../electron && npm start  # In terminal 2
   ```

---

### 🎯 Logging Not Working

**Symptom:**  
Logs panel empty or not updating

**Check:**
1. Are commands executing? (Check chat for responses)
2. Is suggestions panel updating? (If so, system working)
3. Check Backend:
   - Open DevTools: Cmd+Option+I
   - Console tab
   - Look for errors related to logs
   - Check Network tab for `/logs` or similar

**Solution:**
1. Increase polling interval in App.jsx:
   ```javascript
   // Change from 3000 to 5000 milliseconds
   setInterval(fetchSuggestions, 5000)
   ```

2. Verify backend storing logs:
   ```bash
   # Check backend database
   # Exact method depends on your backend
   # Usually: database logs, files, or in-memory
   ```

---

## ❓ Frequently Asked Questions

### Q: Can I run without the backend?

**A:** No. The app requires:
- Localhost:3000 running the JARVIS backend
- Backend provides /jarvis, /evolution/* endpoints
- Cannot function as standalone

### Q: How do I change the port?

**A:** Edit `/Users/ehtsm/electron/main.js`:
```javascript
// Change all instances of
axios.get('http://localhost:3000/...')
// To your new port
axios.get('http://localhost:3001/...')
```

Then restart: `npm start`

### Q: Can I use voice input on Linux?

**A:** Not with `webkitSpeechRecognition` (requires microphone specific setup).

**Workaround:** Use keyboard input instead

### Q: How do I deploy to production?

**A:** Follow [COMPLETE_SETUP.md](./COMPLETE_SETUP.md) → "Building for Production" section.

Quick version:
```bash
cd /Users/ehtsm/electron
npm run build-app
# Creates installer in dist/
```

### Q: Where are settings stored?

**A:** Currently not persisting settings. Future versions will store:
- User preferences: `~/.jarvis/config.json`
- Command history: `~/.jarvis/history.json`
- Logs database: `~/.jarvis/logs.db`

### Q: Can I use with multiple monitors?

**A:** Yes. Window will appear on primary monitor. Resize/move as needed.

### Q: How do I update the app?

**A:** Pull latest code and reinstall:
```bash
cd /Users/ehtsm/electron
git pull origin main  # If using Git
npm install           # Install updated dependencies
npm start             # Restart
```

### Q: Is my data secure?

**A:** Yes:
- All data stays local
- No internet transmission (unless configured)
- No telemetry
- Runs on your machine only

### Q: Can I customize the UI?

**A:** Yes, edit CSS files:
- Colors: `src/App.css` (CSS variables section)
- Components: Edit respective `.jsx` files
- Styling: Edit respective `.css` files

Changes take effect after restart.

### Q: What if I find a bug?

**A:** See [README.md](./README.md) → "Troubleshooting" section or create issue with:
- Steps to reproduce
- Expected vs actual behavior
- Console error messages
- System info (macOS version, electron version, node version)

---

## 🆘 Still Having Issues?

### Debug Information to Gather

Before asking for help, collect:

```bash
# System info
uname -a
node --version
npm --version
lsof -i :3000

# App info (if available)
Cmd+Option+I → Console tab → Copy all errors

# Backend logs (if available)
Check terminal where backend running
Copy any error messages
```

### Where to Get Help

1. **Check files in order**:
   - This file (FAQ)
   - [USER_GUIDE.md](./USER_GUIDE.md)
   - [SETUP_GUIDE.md](./SETUP_GUIDE.md)
   - [COMPLETE_SETUP.md](./COMPLETE_SETUP.md)
   - [README.md](./README.md)

2. **Check backend documentation**:
   - Backend has its own README
   - Check `/Users/ehtsm/docs/` directory
   - Review error messages carefully

3. **Search your error**:
   - Google: `"error message" jarvis desktop electron`
   - Look for common issues

4. **Debug systematically**:
   - Open DevTools: Cmd+Option+I
   - Watch Network tab (for API errors)
   - Watch Console tab (for JavaScript errors)
   - Identify which component/stage fails

5. **Try isolation**:
   - Can you send commands? → Backend OK
   - Can you see score? → API OK
   - Voice and suggestions might be secondary features
   - Start with core functionality

---

## 📋 Troubleshooting Checklist

Use this when everything breaks:

- [ ] Is backend running? `npm start` in main directory
- [ ] Is port 3000 free? `lsof -i :3000`
- [ ] Is Electron window open? `ps aux | grep electron`
- [ ] Is DevTools console showing errors? `Cmd+Option+I`
- [ ] Are there permission errors? Check Console
- [ ] Did I restart after installing? `npm install && npm start`
- [ ] Did I clear cache? `rm -rf node_modules && npm install`
- [ ] Is network working? `curl http://localhost:3000`
- [ ] Is microphone plugged in? Check System Preferences
- [ ] Did I try other browser? (Voice might need different browser)
- [ ] Did I restart macOS? (Last resort)

---

## 🔄 When to Restart

**Restart app** if:
- Settings changed
- Preferences updated
- Want to clear state
- Memory usage high

```bash
Cmd+Q  # Quit
npm start  # Restart
```

**Restart both services** if:
- Backend changes made
- Want complete reset
- Both hanging/frozen
- Port conflicts

```bash
pkill -f electron
pkill -f node
sleep 2

# Terminal 1
npm start

# Terminal 2
cd /Users/ehtsm/electron && npm start
```

**Restart macOS** if:
- Nothing else works
- Multiple crashes
- System unstable
- Last resort

---

## ⚡ Performance Tips

If app is slow:

1. **Close other apps**: Reduces resource competition
2. **Clear logs**: Too many logs = slower rendering
3. **Use SSD**: Faster I/O
4. **Close DevTools**: Reduces overhead
5. **Reduce polling**: Fewer API calls = faster response
6. **Use cache**: Consider enabling response cache

---

## 📞 Support Resources

| Issue | Resource |
|-------|----------|
| How to use | USER_GUIDE.md |
| Setup problem | SETUP_GUIDE.md |
| Integration issue | COMPLETE_SETUP.md |
| Technical details | ARCHITECTURE.md |
| Overview | README.md |
| Errors | This file (FAQ) |

---

**Last updated:** Based on Electron v27 + React 18

*Start with the Quick Diagnostic section above. Most issues resolve in 2-3 steps.*

🆘 **If you're still stuck**: Save the output of these commands:
```bash
npm --version
node --version
cat ~/Library/Application\ Support/JARVIS/logs.txt
ps aux | grep -E "(node|electron)"
```

Then review [SETUP_GUIDE.md](./SETUP_GUIDE.md) troubleshooting section.
