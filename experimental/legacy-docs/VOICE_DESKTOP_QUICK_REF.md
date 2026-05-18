# 🎤🖥️ Voice & Desktop Control - Quick Reference

## 🚀 30-Second Start

```bash
# 1. Install robotjs
npm install robotjs

# 2. Start server
node server.js

# 3. Run tests
node test-voice-desktop.js
```

---

## 🎤 Voice Commands

### Speak Text
```bash
# In Jarvis command
"speak hello world"

# Or via API
curl -X POST http://localhost:3000/voice/speak \
  -H "Content-Type: application/json" \
  -d '{"text":"Hello World","rate":1.0,"voice":"Samantha"}'
```

### Voice Status
```bash
curl http://localhost:3000/voice/status
```

---

## 🖥️ Desktop Commands

### Open Application
```bash
# In Jarvis command
"open chrome"
"open VS Code"
"open calculator"

# Or via API
curl -X POST http://localhost:3000/desktop/open-app \
  -H "Content-Type: application/json" \
  -d '{"app":"Chrome"}'
```

### Type Text
```bash
# In Jarvis command
"type hello world"

# Or via API
curl -X POST http://localhost:3000/desktop/type \
  -H "Content-Type: application/json" \
  -d '{"text":"hello world","speed":50}'
```

### Press Keys
```bash
# In Jarvis command
"press enter"
"press space"
"press escape"

# Or via API
curl -X POST http://localhost:3000/desktop/press-key \
  -H "Content-Type: application/json" \
  -d '{"key":"enter"}'
```

### Press Key Combinations
```bash
# Cmd+C (Copy)
curl -X POST http://localhost:3000/desktop/press-combo \
  -H "Content-Type: application/json" \
  -d '{"modifiers":["cmd"],"key":"c"}'

# Ctrl+Z (Undo)
curl -X POST http://localhost:3000/desktop/press-combo \
  -H "Content-Type: application/json" \
  -d '{"modifiers":["control"],"key":"z"}'
```

### Mouse Control
```bash
# Move mouse
curl -X POST http://localhost:3000/desktop/move-mouse \
  -H "Content-Type: application/json" \
  -d '{"x":100,"y":200}'

# Click
curl -X POST http://localhost:3000/desktop/click \
  -H "Content-Type: application/json" \
  -d '{"button":"left"}'

# Double-click
curl -X POST http://localhost:3000/desktop/double-click \
  -H "Content-Type: application/json" \
  -d '{"button":"left"}'
```

### Desktop Status
```bash
curl http://localhost:3000/desktop/status
```

---

## 🔄 Multi-Task Examples

### Web Search
```bash
curl -X POST http://localhost:3000/jarvis \
  -H "Content-Type: application/json" \
  -d '{"command":"open chrome and type youtube and press enter"}'

# Results in 3 sequential tasks:
# 1. Opened Chrome
# 2. Typed "youtube"
# 3. Pressed Enter
```

### App with Voice Confirmation
```bash
curl -X POST http://localhost:3000/jarvis \
  -H "Content-Type: application/json" \
  -d '{"command":"open calculator and speak ready"}'

# Results in 2 tasks:
# 1. Opened Calculator
# 2. Jarvis says "ready"
```

### Complex Workflow
```bash
curl -X POST http://localhost:3000/jarvis \
  -H "Content-Type: application/json" \
  -d '{
    "command":"open chrome and type github.com and press enter and speak github loaded"
  }'

# Results in 4 tasks:
# 1. Opens Chrome
# 2. Types "github.com"
# 3. Presses Enter
# 4. Speaks "github loaded"
```

---

## 📊 Supported Key Names

| Key | Alternative |
|-----|-------------|
| enter | return |
| space | - |
| tab | - |
| escape | esc |
| delete | - |
| backspace | - |
| cmd | command |
| ctrl | control |
| alt | option |
| shift | - |
| up | - |
| down | - |
| left | - |
| right | - |

---

## 🎭 Available Voices (macOS)

- Samantha (default)
- Victoria
- Alex
- Fred
- Albert
- Bad News
- Bahama
- Bells
- Bernice
- Boing
- Bruce
- Bubbles
- Cellos
- Deranged
- Fred
- Grandma
- Jester
- Kathy
- Organ
- Princess
- Rockit
- Supermodel
- Trinoids
- Whisper
- Zarvox

---

## 📈 API Endpoints Summary

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | /voice/status | Check voice availability |
| POST | /voice/speak | Speak text |
| GET | /desktop/status | Check automation availability |
| POST | /desktop/open-app | Open application |
| POST | /desktop/type | Type text |
| POST | /desktop/press-key | Press single key |
| POST | /desktop/press-combo | Press key combination |
| POST | /desktop/move-mouse | Move mouse cursor |
| POST | /desktop/click | Click mouse button |
| POST | /desktop/double-click | Double-click |

---

## 🧠 Integration with Learning System

### Automatic Tracking
```bash
# Every voice/desktop command is learned

# Check what you use most
curl http://localhost:3000/learning/frequency

# Example output:
{
  "frequency": [
    {"type": "open_app", "count": 5, "percentage": "50%"},
    {"type": "type_text", "count": 3, "percentage": "30%"},
    {"type": "press_key", "count": 2, "percentage": "20%"}
  ]
}
```

### Learned Patterns
```bash
curl http://localhost:3000/learning/patterns

# Example:
{
  "patterns": [
    {
      "signature": "open_app+type_text+press_key",
      "count": 5,
      "examples": ["open chrome and type youtube and press enter"]
    }
  ]
}
```

### Smart Suggestions
```bash
# Get suggestions for "open" commands
curl http://localhost:3000/learning/suggestions?prefix=open

# Returns your most-used "open" commands
```

---

## ✅ Troubleshooting

### Desktop Automation Not Working
```bash
# Check if robotjs is installed
npm list robotjs

# If missing:
npm install robotjs

# Check status
curl http://localhost:3000/desktop/status
```

### Voice Not Speaking
```bash
# Check voice status
curl http://localhost:3000/voice/status

# Test speak endpoint
curl -X POST http://localhost:3000/voice/speak \
  -H "Content-Type: application/json" \
  -d '{"text":"test"}'

# On macOS, check system volume is not muted
```

### Commands Not Parsing
```bash
# Make sure command is recognized by planner
# Valid patterns:
"speak <text>"
"open <app>"
"type <text>"
"press <key>"

# Multi-task with "and", ",", or "then":
"open chrome and type youtube and press enter"
```

---

## 🔧 Configuration

### Voice Settings
```javascript
// In JavaScript code
voiceAgent.setVoicePreference("Victoria", 1.5);
voiceAgent.setVoiceEnabled(true);
```

### Desktop Settings
```javascript
// In JavaScript code
desktopAgent.setAutomationEnabled(true);

// Get status
const status = desktopAgent.getStatus();
```

---

## 🎯 Common Workflows

### GitHub Clone
```
"open chrome and type github.com/username/repo and press enter"
```

### Code Editing
```
"open VS Code and type const x = 5 and press enter"
```

### Calculator Math
```
"open calculator and type 5 and press plus and type 3 and press enter"
```

### Document Writing
```
"open notes and type hello world and press enter and speak document created"
```

---

## 📱 Request/Response Format

### Command Request
```json
{
  "command": "open chrome and speak ready"
}
```

### Direct Voice Request
```json
{
  "text": "Hello World",
  "rate": 1.0,
  "voice": "Samantha"
}
```

### Direct Desktop Request
```json
{
  "app": "Chrome"
}
```

### Response Format
```json
{
  "success": true,
  "tasks": [...],
  "results": [...],
  "memory_status": {...},
  "logs": [...]
}
```

---

## 🚨 Limitations & Warnings

### Voice (macOS only)
- Text limited to 500 characters
- Some special characters may not speak
- Voice depends on system language
- Background apps may affect audio

### Desktop Automation
- App must be installed to launch
- Typing works on active window only
- Mouse coordinates based on screen resolution
- May require accessibility permissions
- Not available on Windows/Linux yet

### Performance
- Large texts take time to speak
- Rapid typing may miss keystrokes
- Mouse operations need focus on target
- Network latency affects API speed

---

## 🎓 Best Practices

1. **Add delays** between rapid commands
   ```bash
   "open chrome" → wait 1s → "type search" → wait 0.5s → "press enter"
   ```

2. **Use shorter texts** for voice output
   ```bash
   "speak ready" ✅
   "speak here is a very long message with lots of details" ❌
   ```

3. **Target real apps** only
   ```bash
   "open chrome" ✅
   "open fake-app" ❌
   ```

4. **Be specific with keys**
   ```bash
   "press enter" ✅
   "press return" ✅
   "press key" ❌
   ```

5. **Use multi-task carefully**
   ```bash
   "open and type and press" ✅ (3 commands)
   "open and type and press and speak and click" ❌ (too complex)
   ```

---

## 📚 Full Documentation

For complete details, see [VOICE_DESKTOP_UPGRADE.md](VOICE_DESKTOP_UPGRADE.md)

---

**Last Updated**: Current Session  
**Status**: Production Ready ✅  
**Version**: 5.0

