#!/bin/bash

# 🔥 JARVIS Clean Startup Script
# Ensures proper port assignment and clean startup

echo "🧹 Cleaning up old processes..."
pkill -f "node server.js" 2>/dev/null
pkill -f "react-scripts" 2>/dev/null
pkill -f "electron" 2>/dev/null
sleep 2

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "🚀 JARVIS STARTUP SEQUENCE"
echo "════════════════════════════════════════════════════════════════"
echo ""

# Start Backend
echo "📦 Starting Backend Server (Port 3000)..."
cd /Users/ehtsm
node server.js &
BACKEND_PID=$!
echo "✅ Backend PID: $BACKEND_PID"

sleep 3

# Start Frontend
echo ""
echo "💻 Starting Electron + React (Port 3001)..."
cd /Users/ehtsm/electron
PORT=3001 npm start &
ELECTRON_PID=$!
echo "✅ Electron PID: $ELECTRON_PID"

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "🎯 JARVIS Systems Online!"
echo "════════════════════════════════════════════════════════════════"
echo ""
echo "📊 Status:"
echo "   Backend:   http://localhost:3000"
echo "   Frontend:  Electron Window (should auto-open)"
echo "   React Dev: http://localhost:3001 (internal)"
echo ""
echo "🎤 Ready for voice commands!"
echo ""
echo "To stop, press Ctrl+C"
echo ""

wait $BACKEND_PID $ELECTRON_PID
