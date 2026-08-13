#!/bin/bash
# ════════════════════════════════════════════════════════════════════════
#  JARVIS OS — Update script (brief-interruption reload)
#  Pulls latest code, installs deps, rebuilds frontend, reloads PM2.
#
#  Usage: bash deploy/update.sh
#
#  NOTE ON DOWNTIME (measured, Phase B.8): this is NOT zero-downtime.
#  `pm2 reload` only achieves overlap in CLUSTER mode, where PM2 starts a new
#  worker before retiring the old one. This app runs instances:1 / exec_mode
#  "fork" — deliberately, because taskQueue/learningSystem/contextEngine are
#  in-process singletons and are not cluster-safe — so PM2 must stop the
#  process before starting it again. Measured by polling /health every 100 ms
#  across a real reload: 56 of 200 requests failed, a ~5.6 s window matching
#  the 5 s graceful drain in _gracefulShutdown() plus startup. nginx has a
#  single upstream (127.0.0.1:5050) with no failover, so that window surfaces
#  to users as 502.
#
#  Deploy during a low-traffic window, or drain at the load balancer first.
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
#
# Phase B.8: `pm2 reload jarvis-os || pm2 restart jarvis-os` reported success
# when PM2 managed NOTHING. Both commands exit 1 with
# "Process or Namespace jarvis-os not found", but `||` makes the compound
# succeed, so `set -e` never fires. The health poll below then passes against
# whatever was already listening on the port — typically a bare
# `node backend/server.js` started by hand (reproduced live: PM2 daemon up,
# 0 managed processes, port 5050 held by a bare node PID). The deploy printed
# "Update complete. JARVIS is running." having reloaded no code at all.
#
# Fix: fall back to starting from the ecosystem file (the same recovery
# deploy/rollback.sh already uses at lines 88/125), and verify PM2 actually
# owns the process afterwards. Reuses the existing PM2 deployment — no new
# tooling, no change to the ecosystem config.
log "Reloading JARVIS (PM2 graceful reload — expect a ~6s 502 window; see header)..."
if pm2 reload jarvis-os 2>/dev/null; then
    log "Reloaded existing PM2 process."
elif pm2 restart jarvis-os 2>/dev/null; then
    log "Restarted existing PM2 process."
else
    warn "No PM2-managed 'jarvis-os' process found — starting from ecosystem.config.cjs."
    # A hand-started bare process would hold port 5050 and silently block PM2
    # (see the warning at the top of ecosystem.config.cjs), so clear it first.
    if pgrep -f "node backend/server.js" >/dev/null 2>&1; then
        warn "Stopping unmanaged 'node backend/server.js' holding the port..."
        pkill -f "node backend/server.js" || true
        sleep 2
    fi
    pm2 start ecosystem.config.cjs --env production || die "PM2 failed to start jarvis-os."
    pm2 save || warn "pm2 save failed — process list will not survive a reboot."
fi

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

# A healthy port is not proof of a successful deploy — it may be a stale
# unmanaged process (the exact failure above). Require PM2 ownership too.
if ! pm2 jlist 2>/dev/null | grep -q '"name":"jarvis-os"'; then
    die "Health check passed but PM2 does not manage 'jarvis-os' — refusing to report success. Run: pm2 start ecosystem.config.cjs --env production"
fi

if [ "$READY" = "1" ]; then
    log "Update complete. JARVIS is running under PM2."
    pm2 status jarvis-os
else
    warn "Server may not be healthy after 40s. Checking logs..."
    pm2 logs jarvis-os --lines 30 --nostream
    die "Update may have failed. Check logs above."
fi
