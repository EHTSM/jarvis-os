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

[ -z "${GROQ_API_KEY:-}" ]               && die "GROQ_API_KEY is not set in .env"
[ -z "${TELEGRAM_TOKEN:-}" ]             && warn "TELEGRAM_TOKEN not set — Telegram bot disabled (optional)"
[ -z "${BASE_URL:-}" ]                   && die "BASE_URL is not set in .env (must be https://yourdomain.com)"
[ -z "${RAZORPAY_WEBHOOK_SECRET:-}" ]    && warn "RAZORPAY_WEBHOOK_SECRET not set — payment webhooks will be REJECTED in production"
[ -z "${WA_TOKEN:-}${WHATSAPP_TOKEN:-}" ] && warn "WA_TOKEN not set — WhatsApp messaging is disabled"

# ── Auth env vars — REQUIRED in production ────────────────────────────────
# Without these the operator console (login/runtime) is entirely inaccessible.
if [ -z "${JWT_SECRET:-}" ]; then
    die "JWT_SECRET is not set in .env
  Generate: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"
  Or run:   node scripts/generate-password-hash.cjs <yourpassword>  (outputs both)"
fi
if [ -z "${OPERATOR_PASSWORD_HASH:-}" ]; then
    die "OPERATOR_PASSWORD_HASH is not set in .env
  Generate: node scripts/generate-password-hash.cjs <yourpassword>"
fi
# Warn if JWT_SECRET looks like a placeholder or is too short
if [[ "${JWT_SECRET:-}" == *"your"* ]] || [[ "${JWT_SECRET:-}" == *"change"* ]] || [ ${#JWT_SECRET} -lt 32 ]; then
    warn "JWT_SECRET looks weak or is a placeholder — use at least 32 random bytes"
fi

[[ "${BASE_URL:-}" == *"localhost"* ]]   && die "BASE_URL is still set to localhost — set it to your real domain"
[[ "${BASE_URL:-}" == *"YOUR_DOMAIN"* ]] && die "BASE_URL is still a placeholder — set it to your real domain"
[[ "${BASE_URL:-}" != "https://"* ]]     && warn "BASE_URL does not start with https:// — Razorpay requires HTTPS for webhooks"

log "Pre-flight checks passed."

# ── Build frontend ───────────────────────────────────────────────────────
# Single-server nginx: REACT_APP_API_URL="" → relative paths (nginx proxies API routes).
# Split API (api.ooplix.com): set REACT_APP_API_URL=https://api.ooplix.com in .env.
if [ "${1:-}" = "--build-frontend" ] || [ ! -d "frontend/build" ]; then
    BUILD_API_URL="${REACT_APP_API_URL:-}"
    log "Building frontend (REACT_APP_API_URL='${BUILD_API_URL}')..."
    REACT_APP_API_URL="${BUILD_API_URL}" npm run build:frontend
    log "Frontend build complete."
fi

# ── Create required dirs ─────────────────────────────────────────────────
mkdir -p logs data backups
log "Directories: logs/ data/ backups/ ensured."

# ── Clear stale startup marker ────────────────────────────────────────────
# If a prior boot crashed before calling app.listen(), data/startup_in_progress.json
# remains. The startup gate treats its presence as a crash and increments the crash
# counter. Clearing it here ensures the first PM2 start is treated as a clean boot.
if [ -f "data/startup_in_progress.json" ]; then
    warn "Stale startup marker found — clearing (prior boot did not clean up)."
    rm -f data/startup_in_progress.json
fi
# Also reset crash counter so the quarantine gate starts fresh.
echo '{"count":0}' > data/startup_crash_count.json
log "Startup gate: cleared (clean boot)."

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
# The server registers 100+ agents and performs async RCA during boot.
# On a fresh VPS, this takes 8-20s. Retry for up to 40s (20 x 2s) before giving up.
log "Waiting for server to be ready (up to 40s)..."
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
    log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    log " JARVIS is running on port ${PORT}"
    log " Health: $(curl -s http://localhost:${PORT}/health | python3 -c "import sys,json; d=json.load(sys.stdin); print('ok | uptime:', d.get('uptime_seconds','?'), 's | memory:', d.get('memory',{}).get('heap_used_mb','?'), 'MB')" 2>/dev/null || echo "ok")"
    log ""
    log " Public URL: ${BASE_URL}"
    log " Health URL: ${BASE_URL}/health"
    log " Stats URL:  ${BASE_URL}/stats"
    log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
else
    warn "Server did not respond after 40s. Showing last 30 lines of PM2 error log:"
    pm2 logs jarvis-os --lines 30 --nostream 2>/dev/null || true
    die "Server not healthy on port ${PORT}. Fix the error above, then re-run this script."
fi
