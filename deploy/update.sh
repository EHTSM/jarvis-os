#!/bin/bash
# ════════════════════════════════════════════════════════════════════════
#  JARVIS OS — Zero-downtime update script
#  Pulls latest code, installs deps, rebuilds frontend, hot-reloads PM2.
#
#  Usage: bash deploy/update.sh
# ════════════════════════════════════════════════════════════════════════

set -euo pipefail
cd "$(dirname "$0")/.."

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log()  { echo -e "${GREEN}[+]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
die()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }

[ -f .env ] || die ".env not found."
source .env 2>/dev/null || true

# ── Backup data before any update ───────────────────────────────────────
log "Backing up data..."
npm run backup

# ── Pull latest code ─────────────────────────────────────────────────────
log "Pulling latest code..."
git pull origin main

# ── Install any new deps ─────────────────────────────────────────────────
log "Installing dependencies..."
npm install --omit=dev --ignore-scripts 2>&1 | grep -v "^npm warn" || true

# ── Rebuild frontend ─────────────────────────────────────────────────────
# Single-server nginx: REACT_APP_API_URL="" → relative paths (nginx handles routing).
# Split API (api.ooplix.com): set REACT_APP_API_URL in .env to https://api.ooplix.com.
if [ -n "${BASE_URL:-}" ] && [[ "${BASE_URL}" != *"localhost"* ]]; then
    BUILD_API_URL="${REACT_APP_API_URL:-}"
    log "Rebuilding frontend (REACT_APP_API_URL='${BUILD_API_URL}')..."
    REACT_APP_API_URL="${BUILD_API_URL}" npm run build:frontend
else
    warn "Skipping frontend rebuild (BASE_URL is localhost or unset)."
    warn "If this is a production VPS, set BASE_URL in .env and run 'npm run build:frontend' manually."
fi

# ── Ensure required dirs exist ────────────────────────────────────────────
mkdir -p logs data backups

# ── Clear stale startup marker before reload ──────────────────────────────
rm -f data/startup_in_progress.json
echo '{"count":0}' > data/startup_crash_count.json

# ── Reload PM2 (zero-downtime) ───────────────────────────────────────────
log "Reloading JARVIS (PM2 graceful reload)..."
pm2 reload jarvis-os 2>/dev/null || pm2 restart jarvis-os

# Wait up to 40s for server to be ready after reload
PORT="${PORT:-5050}"
READY=0
for i in $(seq 1 20); do
    sleep 2
    if curl -sf "http://localhost:${PORT}/health" >/dev/null 2>&1; then
        READY=1
        log "Server ready after $((i * 2))s."
        break
    fi
done

if [ "$READY" = "1" ]; then
    log "Update complete. JARVIS is running."
    pm2 status jarvis-os
else
    warn "Server may not be healthy after 40s. Checking logs..."
    pm2 logs jarvis-os --lines 30 --nostream
    die "Update may have failed. Check logs above."
fi
