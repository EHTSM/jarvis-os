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

# ── Rebuild frontend if BASE_URL is set ──────────────────────────────────
if [ -n "${BASE_URL:-}" ] && [[ "${BASE_URL}" != *"localhost"* ]]; then
    log "Rebuilding frontend for ${BASE_URL}..."
    REACT_APP_API_URL="${BASE_URL}" npm run build:frontend
fi

# ── Reload PM2 (zero-downtime) ───────────────────────────────────────────
log "Reloading JARVIS (PM2 graceful reload)..."
pm2 reload jarvis-os 2>/dev/null || pm2 restart jarvis-os

sleep 3
if curl -sf "http://localhost:${PORT:-5050}/health" >/dev/null 2>&1; then
    log "Update complete. JARVIS is running."
    pm2 status jarvis-os
else
    warn "Server may not be healthy. Checking logs..."
    pm2 logs jarvis-os --lines 20 --nostream
    die "Update may have failed. Check logs above."
fi
