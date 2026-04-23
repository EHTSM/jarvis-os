# 🚀 JARVIS Desktop App - Setup Guide

## Overview

The JARVIS Desktop App is an Electron + React application that provides a professional AI assistant interface for the JARVIS self-evolving automation system running on localhost:3000.

## Prerequisites

- Node.js 14+ and npm
- JARVIS backend running on http://localhost:3000
- macOS, Linux, or Windows

## Installation

### 1. Navigate to Electron Directory
```bash
cd /Users/ehtsm/electron
```

### 2. Install Dependencies
```bash
npm install
```

This installs:
- React + React DOM
- Electron
- Axios (for API calls)
- Build tools

## Running the App

### Development Mode (Recommended)

```bash
npm start
```

This will:
1. Start the React dev server on http://localhost:3001
2. Wait for the dev server to be ready
3. Launch the Electron app

The app will auto-reload when you make code changes.

### Production Build

```bash
npm run build-app
```

Platform-specific builds:
```bash
npm run build-app-mac    # macOS
npm run build-app-linux  # Linux
npm run build-app-win    # Windows
```

## File Structure

```
electron/
├── main.js                 # Electron main process
├── preload.js             # IPC bridge to renderer
├── package.json           # Dependencies & scripts
├── public/
│   └── index.html         # HTML template
├── src/
│   ├── App.jsx            # Main React component
│   ├── App.css            # App styling
│   ├── index.jsx          # ReactDOM entry
│   ├── index.css          # Global styles
│   └── components/
│       ├── ChatPanel.jsx       # Chat interface
│       ├── ChatPanel.css
│       ├── SuggestionsPanel.jsx # Suggestions display
│       ├── SuggestionsPanel.css
│       ├── LogsPanel.jsx        # Task logs
│       ├── LogsPanel.css
│       ├── StatusBar.jsx        # Bottom status bar
│       ├── StatusBar.css
│       ├── EvolutionScore.jsx   # Score display
│       └── EvolutionScore.css
└── assets/
    ├── icon.png          # App icon
    ├── icon.icns         # macOS icon
    └── icon.ico          # Windows icon
```

## API Integration

The app connects to the JARVIS backend at `http://localhost:3000`.

### Main API Endpoints Used

```
POST   /jarvis                      - Send command
GET    /evolution/score             - Get optimization score
GET    /evolution/suggestions       - Get suggestions
POST   /evolution/approve/:id       - Approve suggestion
```

### Server Health Check

The app monitors server status and displays:
- ✓ Green indicator: Server connected
- ✗ Red indicator: Server offline

Connection auto-reconnects every 5 seconds.

## Features

### Chat Interface
- Type commands or use voice input
- Real-time message streaming
- Support for multi-line input
- Auto-scroll to latest message
- "Thinking" animation while processing

### Suggestions Panel
- Display AI-generated optimization suggestions
- Shows confidence levels (0-100%)
- Expandable cards for details
- Approve/Dismiss buttons
- Real-time updates

### Logs Panel
- Complete task history
- Status indicators (✅ Success, ❌ Error, ⏳ Pending)
- Timestamps
- Expandable details
- Most recent first

### Evolution Score
- Real-time optimization measurement (0-100)
- Visual ring progress indicator
- Status messages:
  - 0-20: Learning Phase
  - 20-40: Building Patterns
  - 40-60: Pattern Recognition
  - 60-80: Optimal
  - 80+: Highly Optimized

### Voice Input
- Click 🎤 button to toggle voice recognition
- Works with Chrome/Chromium browsers
- Real-time transcription
- Auto-sends when recognized

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Enter` | Send command |
| `Shift+Enter` | New line |
| `Cmd+Shift+F` | Toggle floating window |
| `Cmd+Q` | Quit app |
| `Cmd+R` | Reload page |

## Styling & Theme

### Dark Mode (Jarvis Theme)
- Primary: Cyan (#00d4ff)
- Secondary: Magenta (#ff006e)
- Background: Deep blue (#0a0e27)
- Success: Green (#00ff88)
- Error: Red (#ff3333)

### Animations
- Smooth transitions on all interactions
- Pulse animation for active elements
- Glow effects on hover
- Slide-in for new messages
- Responsive design

## Troubleshooting

### App won't start
```bash
# Clear npm cache
npm cache clean --force

# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install

# Try again
npm start
```

### Server not connecting
1. Verify JARVIS backend is running: `npm start` (from root)
2. Check if http://localhost:3000 is accessible
3. Look for error messages in app logs
4. Check Electron DevTools (Cmd+Option+I)

### Voice input not working
1. Allow microphone access in browser permissions
2. Use Chrome/Chromium browser (built-in on Electron)
3. Check browser console for errors

### Performance issues
1. Reduce number of logs kept in memory
2. Monitor using DevTools
3. Check main process CPU usage
4. Clear electron cache: `rm -rf /Users/ehtsm/electron/.cache`

## Development

### Hot Reload
Changes to React code auto-reload in real-time.

### DevTools
Press `Cmd+Option+I` to open Electron DevTools during development.

### Adding New Components
1. Create `.jsx` file in `src/components/`
2. Create corresponding `.css` file
3. Import in parent component
4. Follow existing patterns

### Building Custom Features
1. Update React component
2. Add API calls if needed (via `window.electronAPI`)
3. Test in dev mode
4. Build and test packaged app

## Production Deployment

### Building for Distribution
```bash
# Create optimized build
npm run build-app

# Output files in dist/ directory
```

### Installers Created
- **macOS**: `JARVIS-1.0.0.dmg`
- **Linux**: `JARVIS-1.0.0.AppImage` or `.deb`
- **Windows**: `JARVIS Setup 1.0.0.exe`

### Code Signing (for production)
Update `main.js` and `package.json` with:
- Certificate details
- Team ID
- Notarization settings

## Configuration

### Server URL
Edit in `main.js`:
```javascript
const API_URL = 'http://localhost:3000';  // Change here
```

### App Window Size
Edit in `main.js` `createWindow()`:
```javascript
mainWindow = new BrowserWindow({
  width: 1400,    // Change width
  height: 900,    // Change height
  // ...
});
```

## Performance Tips

1. **Voice Input**: Works in background, non-blocking
2. **API Calls**: Debounced to prevent excessive requests
3. **Rendering**: React optimizes re-renders
4. **Memory**: Automatically managed by Electron

## Known Limitations

1. Voice input requires microphone permissions
2. Works offline for UI, needs server for commands
3. Floating window always on top
4. Desktop notifications require OS permissions

## Support & Debugging

### Enable Debug Mode
```bash
# In main.js, uncomment:
mainWindow.webContents.openDevTools();
```

### Check Logs
- Console output in DevTools
- Electron logs in `~/.config/JARVIS/` (Linux/Windows)
- Console.log in renderer process

### Common Issues

**"Server disconnected"**
- Restart JARVIS backend
- Check network connectivity

**"Command not sent"**
- Verify server is healthy
- Check network tab in DevTools
- Verify API endpoint in main.js

**"Voice not working"**
- Check microphone permissions
- Grant microphone access
- Try using keyboard instead

## Future Enhancements

- [ ] System tray integration
- [ ] Push notifications
- [ ] Offline command queue
- [ ] Custom themes
- [ ] Command history search
- [ ] Themes customization
- [ ] Plugin system
- [ ] Mobile companion app

## Contributing

To add features or fix bugs:
1. Create feature branch
2. Make changes
3. Test thoroughly
4. Create pull request
5. Include screenshots/videos

## License

MIT License - See LICENSE file

---

## Quick Start

```bash
# 1. Start JARVIS backend (separate terminal)
cd /Users/ehtsm
npm start

# 2. Start desktop app
cd /Users/ehtsm/electron
npm install
npm start

# ✅ App launches automatically!
```

## Next Steps

1. **First Run**: App connects to http://localhost:3000
2. **Execute Command**: Type a command and press Enter
3. **Check Score**: See optimization score in header
4. **Build Patterns**: Execute commands to generate suggestions
5. **Approve Suggestions**: Click to create specialized agents

---

**🤖 Enjoy using JARVIS Desktop App!**

For issues or questions, check the Electron/React documentation or JARVIS project README.
