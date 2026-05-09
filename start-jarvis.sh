#!/bin/bash
# JARVIS startup — backend only (production).
# For development with frontend hot-reload: npm run dev

set -e
cd "$(dirname "$0")"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " JARVIS OS — starting backend"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Ensure .env exists
if [ ! -f .env ]; then
  echo "[ERROR] .env not found. Copy .env.example and fill in your keys."
  exit 1
fi

# Create logs dir if needed
mkdir -p logs

# Kill any process holding port 5050
if lsof -ti:5050 >/dev/null 2>&1; then
  echo "[Startup] Killing existing process on port 5050..."
  kill "$(lsof -ti:5050)" 2>/dev/null || true
  sleep 1
fi

echo "[Startup] Launching backend/server.js on port 5050..."
node backend/server.js
