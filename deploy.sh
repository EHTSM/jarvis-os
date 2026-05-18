#!/bin/bash
# ════════════════════════════════════════════════════════════════════════
#  JARVIS OS — Master deploy script
#
#  Usage:
#    bash deploy.sh              # full deploy (build frontend + restart PM2)
#    bash deploy.sh --no-build   # restart only, skip frontend build
#    bash deploy.sh --setup      # first-time VPS setup
# ════════════════════════════════════════════════════════════════════════

set -euo pipefail
cd "$(dirname "$0")"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log()  { echo -e "${GREEN}[+]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
die()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }

# ── Parse args ───────────────────────────────────────────────────────────
NO_BUILD=0
SETUP_MODE=0
for arg in "$@"; do
  case "$arg" in
    --no-build) NO_BUILD=1 ;;
    --setup)    SETUP_MODE=1 ;;
  esac
done

# ── First-time setup ─────────────────────────────────────────────────────
if [ "$SETUP_MODE" = "1" ]; then
  log "Running first-time VPS setup..."
  bash deploy/setup-vps.sh
  exit 0
fi

# ── Pre-flight ───────────────────────────────────────────────────────────
[ -f .env ] || die ".env not found. Copy .env.example and fill in your values."

source .env 2>/dev/null || true

[ -z "${GROQ_API_KEY:-}" ] && die "GROQ_API_KEY is not set in .env"
[ -z "${BASE_URL:-}" ]     && die "BASE_URL is not set in .env"
[ -z "${JWT_SECRET:-}" ]   && warn "JWT_SECRET not set — operator auth disabled in production"
[ -z "${OPERATOR_PASSWORD_HASH:-}" ] && warn "OPERATOR_PASSWORD_HASH not set — all users can access runtime panel"

[[ "${BASE_URL:-}" == *"localhost"* ]]   && die "BASE_URL is still localhost — set your real domain"
[[ "${BASE_URL:-}" == *"YOUR_DOMAIN"* ]] && die "BASE_URL is still a placeholder — set your real domain"

# ── Install dependencies ─────────────────────────────────────────────────
if [ ! -d "node_modules" ]; then
  log "Installing backend dependencies..."
  npm ci --omit=dev
fi

if [ ! -d "frontend/node_modules" ]; then
  log "Installing frontend dependencies..."
  npm ci --prefix frontend
fi

# ── Build frontend ───────────────────────────────────────────────────────
if [ "$NO_BUILD" = "0" ]; then
  log "Building frontend (REACT_APP_API_URL=${BASE_URL})..."
  REACT_APP_API_URL="${BASE_URL}" npm run build:frontend
  log "Frontend build complete."
fi

# ── Create required dirs ─────────────────────────────────────────────────
mkdir -p logs data backups

# ── Restart with PM2 ────────────────────────────────────────────────────
if pm2 list 2>/dev/null | grep -q "jarvis-os"; then
  log "Reloading jarvis-os (zero-downtime)..."
  pm2 reload jarvis-os --update-env
else
  log "Starting jarvis-os with PM2..."
  pm2 start ecosystem.config.cjs --env production
fi

pm2 save
log "PM2 process list saved."

# ── Health check ─────────────────────────────────────────────────────────
log "Waiting for server to be ready..."
sleep 4

PORT="${PORT:-5050}"
for i in 1 2 3; do
  if curl -sf "http://localhost:${PORT}/health" >/dev/null 2>&1; then break; fi
  sleep 3
done

if curl -sf "http://localhost:${PORT}/health" >/dev/null 2>&1; then
  log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  log " JARVIS is running on port ${PORT}"
  log " Public URL: ${BASE_URL}"
  log " Health:     ${BASE_URL}/health"
  log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
else
  die "Server did not start. Check logs: pm2 logs jarvis-os"
fi
