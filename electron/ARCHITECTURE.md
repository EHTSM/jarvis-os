# 🏗️ JARVIS Desktop App - Architecture Reference

## Project Structure

```
/Users/ehtsm/electron/
├── main.js                          # Electron main process (IPC hub)
├── preload.js                       # Security context bridge
├── package.json                     # Dependencies & build config
├── public/
│   └── index.html                   # HTML template for React
├── src/
│   ├── index.jsx                    # React entry point
│   ├── index.css                    # Global styles
│   ├── App.jsx                      # Root component & state mgmt
│   ├── App.css                      # Global theme & animations
│   └── components/
│       ├── ChatPanel.jsx            # Chat UI & voice input
│       ├── ChatPanel.css            # Chat styling
│       ├── SuggestionsPanel.jsx     # Suggestions display & approval
│       ├── SuggestionsPanel.css     # Suggestions styling
│       ├── LogsPanel.jsx            # Task history display
│       ├── LogsPanel.css            # Logs styling
│       ├── StatusBar.jsx            # Bottom status bar
│       ├── StatusBar.css            # Status bar styling
│       ├── EvolutionScore.jsx       # Score ring indicator
│       └── EvolutionScore.css       # Score styling
├── docs/
│   ├── SETUP_GUIDE.md               # Installation & troubleshooting
│   ├── COMPLETE_SETUP.md            # Backend + app integration
│   ├── README.md                    # Project overview
│   └── USER_GUIDE.md                # User manual (this file above)
└── ARCHITECTURE.md                  # This file
```

## Data Flow Architecture

### Command Execution Flow

```
User Types Command
    ↓
[ChatPanel Input]
    ↓
handleSendCommand() (App.jsx)
    ├─ Create log entry (pending)
    ├─ Add message: "user"
    └─ Call window.electronAPI.sendCommand()
         ↓
    [IPC: send-command]
         ↓
    main.js: ipcMain.handle()
         ├─ axios POST /jarvis
         ├─ Parse response
         └─ Return { tasks, results, suggestions? }
         ↓
    [IPC Response]
         ↓
    App.jsx processes response
    ├─ Add system message
    ├─ Show results
    ├─ Update log entry (success)
    └─ Auto-fetch suggestions (next 3s)
         ↓
[Chat Panel Updates]
[Logs Panel Updates]
[Suggestions Panel Updates if new]
```

### Evolution Score Update Flow

```
App.jsx useEffect (3-second interval)
    ↓
fetchEvolutionScore()
    ↓
window.electronAPI.getEvolutionScore()
    ↓
[IPC: get-evolution-score]
    ↓
main.js: ipcMain.handle()
    └─ axios GET /evolution/score
         ↓
    [IPC Response] { score, status }
         ↓
App.jsx updates state
    └─ setEvolutionScore(score)
         ↓
[All consumer components re-render]
├─ EvolutionScore.jsx (ring updates)
└─ App.jsx header display
```

### Suggestions Approval Flow

```
User clicks "✓ Approve" on suggestion
    ↓
SuggestionsPanel: handleApproveSuggestion()
    ↓
window.electronAPI.approveSuggestion(suggestionId)
    ↓
[IPC: approve-suggestion]
    ↓
main.js: ipcMain.handle()
    └─ axios POST /evolution/approve/:id
         ↓
    [IPC Response] { success, agent_created }
         ↓
App.jsx processes approval
    ├─ Remove from suggestions array
    ├─ Add log entry: "Suggestion approved"
    ├─ Re-fetch suggestions
    └─ Show confirmation message
         ↓
Real-time UI Updates
├─ Suggestions count decreases
├─ Logs panel shows new entry
└─ Evolution score may increase
```

## Component Hierarchy

```
App.jsx (Root State Manager)
├── Header
│   ├── Logo/Title
│   └── EvolutionScore.jsx (Ring visualization)
├── TabButtons
│   ├── "💬 Chat" button
│   ├── "💡 Suggestions" button (with count badge)
│   └── "📋 Logs" button (with count badge)
├── MainPanel (Tab content - one visible at a time)
│   ├── ChatPanel.jsx (when tab = "chat")
│   │   ├── MessageList (auto-scroll)
│   │   ├── InputBox (textarea)
│   │   ├── VoiceButton (SpeechRecognition)
│   │   ├── SendButton
│   │   └── ClearButton
│   ├── SuggestionsPanel.jsx (when tab = "suggestions")
│   │   └── SuggestionCard[] (expandable)
│   │       ├── ConfidenceBadge
│   │       ├── DetailsSection
│   │       ├── ApproveButton
│   │       └── DismissButton
│   └── LogsPanel.jsx (when tab = "logs")
│       └── LogEntry[] (reverse chronological)
│           ├── StatusIcon
│           ├── Command text
│           ├── Timestamp
│           └── ExpandableDetails
└── StatusBar.jsx (Footer)
    ├── ServerHealthDot (pulsing)
    ├── StatusText
    ├── FloatingWindowButton
    └── SettingsButton

Legend:
[] = Can have multiple instances
() = Visible based on condition
```

## State Management (App.jsx)

```javascript
State Variables:

messages[]              Array of { role, content, timestamp }
                       role: "user" | "system" | "success" | "error"

suggestions[]          Array of {
                         id, title, category, confidence,
                         based_on, action, status, details
                       }

logs[]                 Array of {
                         id, command, timestamp, status,
                         tasks, results, error, details
                       }

evolutionScore         Number (0-100)
activeTab              String: "chat" | "suggestions" | "logs"
serverHealthy          Boolean (connected to backend?)
lastServerCheck        Timestamp of last health check

Refs:
messagesEndRef         For auto-scroll to newest message
```

## IPC Communication (Electron IPC Bridge)

### Preload.js Exposed API

```javascript
window.electronAPI = {
  // Send command to backend
  sendCommand(command) -> { tasks, results, suggestions? }
  
  // Get current evolution score
  getEvolutionScore() -> { score, status }
  
  // Get all suggestions
  getSuggestions() -> Array of suggestions
  
  // Approve a suggestion
  approveSuggestion(id) -> { success, agent_created }
  
  // Check backend health
  getServerHealth() -> { healthy, timestamp }
  
  // Server status listener
  onServerStatus(callback) -> void
}
```

### Main.js IPC Handlers

#### The 5 IPC Handlers:

```javascript
ipcMain.handle('send-command', async (event, command) => {
  // POST /jarvis with { command }
  // Return response from backend
})

ipcMain.handle('get-evolution-score', async (event) => {
  // GET /evolution/score
  // Return { score, status }
})

ipcMain.handle('get-suggestions', async (event) => {
  // GET /evolution/suggestions
  // Return array of suggestions
})

ipcMain.handle('approve-suggestion', async (event, suggestionId) => {
  // POST /evolution/approve/:suggestionId
  // Return { success, agent_created }
})

ipcMain.handle('get-server-health', async (event) => {
  // GET http://localhost:3000/health
  // Return { healthy, timestamp }
})
```

## HTTP API Integration

### Backend Endpoints Used

```
POST /jarvis
├─ Request:  { command: "string" }
├─ Response: {
│    tasks: [{ name, status, result }],
│    results: string,
│    suggestions?: [{ id, title, ... }],
│    execution_time: number
│  }
└─ Error:    { error: "string", details: "string" }

GET /evolution/score
├─ Response: { score: 0-100, status: "string" }
└─ Error:    { error: "string" }

GET /evolution/suggestions
├─ Response: [
│    {
│      id: string,
│      title: string,
│      category: string,
│      confidence: 0-100,
│      based_on: string,
│      action: string,
│      status: "pending" | "approved" | "dismissed",
│      details?: object
│    }
│  ]
└─ Error:    { error: "string" }

POST /evolution/approve/:suggestionId
├─ Response: { success: boolean, agent_created: string }
└─ Error:    { error: "string" }
```

## CSS Architecture

### Global Variables (App.css)

```css
:root {
  --color-primary:        #00d4ff  (Cyan - main accent)
  --color-secondary:      #ff006e  (Magenta - highlights)
  --color-success:        #00ff88  (Green - success)
  --color-error:          #ff4444  (Red - errors)
  --color-warning:        #ffaa00  (Orange - warnings)
  
  --surface-bg:           #0a0e27  (Deep blue - background)
  --surface-card:         #16213e  (Dark blue - cards)
  --surface-light:        #2a3d5c  (Lighter blue - hover)
  
  --text-primary:         #ffffff (White - main text)
  --text-secondary:       #a0a0ff (Light blue - secondary)
}
```

### Animation Library

```css
@keyframes pulse       Opacity fade in/out (1s loop)
@keyframes glow        Box-shadow expansion (1.5s loop)
@keyframes slideIn     Transform X movement (0.3s once)
@keyframes fadeIn      Opacity fade (0.5s once)
@keyframes scan        SVG stroke animation (2s loop)
@keyframes spin        360° rotation (1s loop)
@keyframes dots        Staggered dot animation (0.6s per dot)
```

### Component Style Organization

```
App.css
├─ Global CSS variables
├─ app-container (main layout)
├─ app-header (top bar)
├─ main-panel (content area)
├─ tab-buttons (tab switching)
└─ @keyframes (all animations)

ChatPanel.css
├─ message-container (scrollable)
├─ message-user (cyan, right)
├─ message-system (blue, left)
├─ message-success (green)
├─ message-error (red)
├─ input-area
├─ voice-button
└─ loading-dots (animated)

SuggestionsPanel.css
├─ suggestion-card (expandable)
├─ suggestion-header
├─ confidence-badge (color-coded)
├─ details-section
├─ approve/dismiss buttons
└─ transitions (smooth expand)

LogsPanel.css
├─ log-entry (color-coded by status)
├─ log-header (icon + action + time)
├─ log-details (expandable)
├─ status-icon (✅❌⏳)
└─ progress-bar (for pending)

StatusBar.css
├─ status-bar-container
├─ health-dot (animated pulse)
├─ status-text
└─ action-buttons

EvolutionScore.css
├─ score-ring (SVG)
├─ score-percentage (text)
└─ status-label
```

## Lifecycle Management

### App Initialization (useEffect in App.jsx)

```javascript
useEffect on mount:
1. Check server health immediately
2. Set up 5-second server health polling
3. Set up 3-second suggestions + score polling
4. Log: "App initialized"

useEffect on unmount:
1. Clear all intervals
2. Log: "App closing"
```

### Tab Switching

```
User clicks tab
    ↓
Tab button updates activeTab state
    ↓
All components re-render (React)
    ↓
Visible component mounts/unmounts
    └─ ChatPanel useEffect: Set up voice recognition
    └─ SuggestionsPanel: useEffect fetches fresh data
    └─ LogsPanel: useEffect scrolls to bottom
```

### Message Auto-scroll

```javascript
useEffect(() => {
  if (messagesEndRef.current) {
    messagesEndRef.current.scrollIntoView({ 
      behavior: 'smooth' 
    })
  }
}, [messages])  // Re-run when messages change
```

## Voice Recognition Implementation

### SpeechRecognition Flow (ChatPanel.jsx)

```javascript
const recognition = new window.webkitSpeechRecognition()

// Configuration
recognition.continuous = false
recognition.interimResults = true
recognition.language = 'en-US'

// Event listeners
recognition.onstart    → Show "Listening..." UI
recognition.onresult   → Build transcript from results
recognition.onend      → Hide listening UI
recognition.onerror    → Show error message

// Usage
handleVoiceInput():
  if listening:
    recognition.stop()  // Stop listening
  else:
    recognition.start() // Start listening
    setListening(true)

// On final result:
transcript built → Insert into input box
User can review → Click send to submit
```

## Error Handling Strategy

### Message Error Handling

```
sendCommand() in main.js catches:
├─ Network error → { error: "Network error", details }
├─ Invalid response → { error: "Invalid response" }
├─ Backend error → { error: data.error }
└─ Unknown error → { error: "Unknown error" }

App.jsx processes error:
├─ Log to console
├─ Add error message in chat
├─ Show error in appropriate color (red)
└─ User can retry
```

### Server Disconnection

```
Health check detects offline:
1. Set serverHealthy = false
2. Update status bar: 🔴 Red
3. Show warning in chat
4. Continue polling every 5 seconds
5. Auto-reconnect when server comes back
```

## Performance Considerations

### Re-render Optimization

```
Total re-renders per second:
- Health check: 0.2/s (every 5s)
- Score fetch: 0.33/s (every 3s)
- Suggestions fetch: 0.33/s (every 3s)
= ~1 re-render per second average

Mitigation:
- useCallback for stable function refs
- Separate state for each concern
- Only child components that need it re-render
```

### Memory Management

```
Messages stored in state:
- Keep last 50 messages only
- Delete older messages from array
- Reduces render time for large histories

Logs stored in state:
- Keep last 100 logs only
- Paginate if more
- Reduces DOM nodes

Suggestions:
- Keep current batch only
- Clear dismissed suggestions
- Moderate garbage collection
```

## Security Considerations

### Context Isolation

```
Preload.js uses contextBridge:
- No direct Node.js access from React
- Only specific APIs exposed
- Cannot access file system
- Cannot execute arbitrary code
```

### API Communication

```
main.js handles HTTP:
- React never makes direct API calls
- All HTTP goes through main process
- No CORS issues
- Credentials can be managed safely
```

### Data Validation

```
All incoming data validated:
- Evolution score: 0-100 range check
- Suggestions: Schema validation
- Logs: Object structure check
- Error messages: String sanitization
```

## Extension Points

### Adding New IPC Handler

```javascript
// In main.js
ipcMain.handle('new-feature', async (event, args) => {
  try {
    const response = await axios.get('/endpoint/' + args)
    return response.data
  } catch (error) {
    return { error: error.message }
  }
})

// In preload.js
new_feature: (args) => ipcMain.invoke('new-feature', args)

// In App.jsx
const result = await window.electronAPI.new_feature(args)
```

### Adding New Component

```
1. Create src/components/NewPanel.jsx
2. Create src/components/NewPanel.css
3. Import in App.jsx
4. Add to tab system
5. Add CSS for tab appearance
6. Add state management if needed
```

### Adding New Animation

```
1. Define @keyframes in App.css or component.css
2. Apply with animation property
3. Use CSS variables for timing
4. Test performance on older machines
```

## Debugging Workflow

### DevTools Access

```
Cmd+Option+I opens:
├─ Console: See console.log() calls
├─ Network: See HTTP requests to backend
├─ Elements: Inspect React components
├─ Sources: Debug JavaScript code
└─ Performance: Profile render performance
```

### Common Issues & Debug Steps

```
Command not sending:
1. Check Network tab for HTTP call
2. Check Console for JS errors
3. Verify backend running (localhost:3000)
4. Check IPC messages in Console

Suggestions not updating:
1. Check if server healthy (green dot)
2. Verify suggestions endpoint responding
3. Check Console for fetch errors
4. Verify commands executed (check logs)

Score not updating:
1. Check if server healthy
2. Verify score endpoint responding
3. Confirm execution progress (more commands = faster updates)
4. Check Network tab request/response
```

## Build & Distribution

### Package.json Scripts

```bash
npm start           # Dev: React + Electron concurrent
npm run build-app   # Production: Build + package

Platform builds:
npm run build-app-mac      # Create macOS .dmg
npm run build-app-linux    # Create Linux AppImage/deb
npm run build-app-win      # Create Windows exe
```

### Electron-Builder Configuration

```
Targets:
  macOS:  DMG (disk image) + app bundle
  Linux:  AppImage (portable) + deb (installer)
  Windows: NSIS (installer) + portable exe

Outputs created in:
  dist/            (built app packages)
```

---

## Quick Reference

### To add a feature:
1. Add state if needed (App.jsx)
2. Create component if UI (components/)
3. Add CSS styling (*.css)
4. Add IPC handler if backend call (main.js)
5. Expose in preload.js if needed
6. Update documentation

### To troubleshoot:
1. Open DevTools (Cmd+Option+I)
2. Check Console tab for errors
3. Check Network tab for API calls
4. Inspect Elements for layout issues
5. Restart if nothing works

### Performance checklist:
- ✅ Use React.memo for expensive components
- ✅ Avoid new object creation on render
- ✅ Batch state updates
- ✅ Remove old messages/logs
- ✅ Profile with Performance tab

---

**This architecture enables**:
- ✅ Secure IPC communication
- ✅ Responsive real-time UI
- ✅ Clean component separation
- ✅ Easy feature additions
- ✅ Professional appearance
- ✅ Extensible design

**Go to** [User Guide](./USER_GUIDE.md) **for usage instructions.**
