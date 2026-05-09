#!/bin/bash
# ════════════════════════════════════════════════════════════════════════
#  JARVIS OS — Production start script
#  Run after setup-vps.sh has been executed and .env has been filled.
#
#  Usage: bash deploy/start-production.sh
# ════════════════════════════════════════════════════════════════════════

set -euo pipefail
cd "$(dirname "$0")/.."   # always run from project root

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log()  { echo -e "${GREEN}[+]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
die()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }

# ── Pre-flight checks ────────────────────────────────────────────────────
[ -f .env ] || die ".env not found. Copy .env.example and fill in your keys."

# Validate required env vars are not placeholder values
source .env 2>/dev/null || true

[ -z "${GROQ_API_KEY:-}" ]   && die "GROQ_API_KEY is not set in .env"
[ -z "${TELEGRAM_TOKEN:-}" ] && die "TELEGRAM_TOKEN is not set in .env"
[ -z "${BASE_URL:-}" ]       && die "BASE_URL is not set in .env (must be https://yourdomain.com)"

[[ "${BASE_URL:-}" == *"localhost"* ]] && die "BASE_URL is still set to localhost — set it to your real domain"
[[ "${BASE_URL:-}" == *"YOUR_DOMAIN"* ]] && die "BASE_URL is still a placeholder — set it to your real domain"

log "Pre-flight checks passed."

# ── Build frontend ───────────────────────────────────────────────────────
if [ "${1:-}" = "--build-frontend" ] || [ ! -d "frontend/build" ]; then
    log "Building frontend (REACT_APP_API_URL=${BASE_URL})..."
    REACT_APP_API_URL="${BASE_URL}" npm run build:frontend
    log "Frontend build complete."
fi

# ── Create required dirs ─────────────────────────────────────────────────
mkdir -p logs data backups

# ── Stop existing PM2 process if running ────────────────────────────────
if pm2 list 2>/dev/null | grep -q "jarvis-os"; then
    warn "Stopping existing jarvis-os process..."
    pm2 stop jarvis-os 2>/dev/null || true
    pm2 delete jarvis-os 2>/dev/null || true
fi

# ── Start with PM2 ──────────────────────────────────────────────────────
log "Starting JARVIS with PM2 (production mode)..."
pm2 start ecosystem.config.cjs --env production

# ── Save PM2 process list ────────────────────────────────────────────────
pm2 save
log "PM2 process list saved."

# ── Wait for startup and verify ──────────────────────────────────────────
log "Waiting for server to be ready..."
sleep 5

PORT="${PORT:-5050}"
if curl -sf "http://localhost:${PORT}/health" >/dev/null 2>&1; then
    log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    log " JARVIS is running on port ${PORT}"
    log " Health: $(curl -s http://localhost:${PORT}/health | python3 -c "import sys,json; d=json.load(sys.stdin); print('ok | uptime:', d.get('uptime_seconds','?'), 's | memory:', d.get('memory',{}).get('heap_used_mb','?'), 'MB')" 2>/dev/null || echo "ok")"
    log ""
    log " Public URL: ${BASE_URL}"
    log " Health URL: ${BASE_URL}/health"
    log " Stats URL:  ${BASE_URL}/stats"
    log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
else
    die "Server did not start on port ${PORT}. Check logs: pm2 logs jarvis-os"
fi
