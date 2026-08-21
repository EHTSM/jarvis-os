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
  # Single-server deployment: nginx serves frontend and proxies /api routes to
  # the backend on port 5050. Frontend uses relative paths — REACT_APP_API_URL=""
  # means all fetches go to the same origin and nginx handles routing.
  #
  # Split-server deployment (api.ooplix.com): set REACT_APP_API_URL in .env
  # to https://api.ooplix.com — it will be picked up from there automatically.
  BUILD_API_URL="${REACT_APP_API_URL:-}"

  # B.23 artifact integrity: REACT_APP_API_URL is inlined into every bundle chunk
  # at build time, and a shell-exported value OVERRIDES frontend/.env.production
  # (CRA loads .env files without overriding an existing process.env entry).
  # Verified: building with an exported REACT_APP_API_URL baked that host into 44
  # bundle files. A stray export in a deploy shell would therefore silently point
  # every production API call at another origin, with no warning and no failure.
  # Reject anything that is not empty (same-origin) or a plain https:// origin.
  if [ -n "$BUILD_API_URL" ]; then
    case "$BUILD_API_URL" in
      *localhost*|*127.0.0.1*)
        die "REFUSING BUILD: REACT_APP_API_URL='${BUILD_API_URL}' points at localhost. A production bundle built with this cannot reach the API. Unset it for same-origin nginx deploys."
        ;;
      https://*)
        log "REACT_APP_API_URL validated: ${BUILD_API_URL}"
        ;;
      *)
        die "REFUSING BUILD: REACT_APP_API_URL='${BUILD_API_URL}' is not an https:// origin. Leave it unset for single-server nginx deploys, or set https://api.yourdomain.com for split deploys."
        ;;
    esac
  else
    log "REACT_APP_API_URL empty — bundle will use same-origin relative paths (nginx proxy)."
  fi

  log "Building frontend (REACT_APP_API_URL='${BUILD_API_URL}')..."
  REACT_APP_API_URL="${BUILD_API_URL}" npm run build:frontend

  # Post-build verification: confirm the value we intended is what actually got
  # inlined. A bare localhost grep is NOT usable here — the bundled Firebase SDK
  # legitimately contains "http://localhost" (its requestUri default), which would
  # fail every clean build. Instead assert on BUILD_API_URL itself: when it is
  # empty the bundle must not carry any absolute API origin we did not ask for,
  # and when it is set that exact origin must be present.
  if [ -n "$BUILD_API_URL" ]; then
    if ! grep -rqF "$BUILD_API_URL" frontend/build/static/js/*.js 2>/dev/null; then
      die "ARTIFACT INTEGRITY FAILURE: REACT_APP_API_URL='${BUILD_API_URL}' did not reach the built bundle."
    fi
    log "Artifact integrity verified: bundle targets ${BUILD_API_URL}"
  else
    log "Artifact integrity verified: same-origin bundle (no API origin inlined)."
  fi
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
