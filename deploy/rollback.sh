#!/bin/bash
# ════════════════════════════════════════════════════════════════════════
#  JARVIS OS — Rollback script
#  Restores data from the most recent backup and restarts the server.
#
#  Usage:
#    bash deploy/rollback.sh              # restore latest backup
#    bash deploy/rollback.sh --list       # list available backups
#    bash deploy/rollback.sh FILE.tar.gz  # restore specific backup
# ════════════════════════════════════════════════════════════════════════

set -euo pipefail
cd "$(dirname "$0")/.."

BACKUP_DIR="backups"
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()  { echo -e "${GREEN}[+]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
die()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }

if [ "${1:-}" = "--list" ]; then
    echo "Available backups:"
    ls -lh "${BACKUP_DIR}"/jarvis_*.tar.gz 2>/dev/null || echo "No backups found."
    exit 0
fi

if [ -n "${1:-}" ]; then
    BACKUP_FILE="${BACKUP_DIR}/${1}"
else
    BACKUP_FILE=$(ls -t "${BACKUP_DIR}"/jarvis_*.tar.gz 2>/dev/null | head -1)
fi

[ -f "${BACKUP_FILE}" ] || die "No backup found. Run 'npm run backup' first or specify a file."

warn "This will overwrite the data/ directory with: ${BACKUP_FILE}"
warn "Press Ctrl+C within 5 seconds to cancel..."
sleep 5

# ── Stop server ──────────────────────────────────────────────────────────
log "Stopping JARVIS..."
pm2 stop jarvis-os 2>/dev/null || true

# ── Backup current state first (safety net) ──────────────────────────────
SAFETY="${BACKUP_DIR}/pre-rollback-$(date +%Y%m%d_%H%M%S).tar.gz"
log "Saving current state to ${SAFETY}..."
tar -czf "${SAFETY}" data/ 2>/dev/null || true

# ── Restore ──────────────────────────────────────────────────────────────
log "Restoring from ${BACKUP_FILE}..."
tar -xzf "${BACKUP_FILE}" 2>/dev/null

# ── Restart ──────────────────────────────────────────────────────────────
log "Restarting JARVIS..."
pm2 start jarvis-os 2>/dev/null || pm2 start ecosystem.config.cjs --env production

sleep 3
if curl -sf "http://localhost:${PORT:-5050}/health" >/dev/null 2>&1; then
    log "Rollback complete. JARVIS is running."
else
    die "Server did not restart cleanly. Check: pm2 logs jarvis-os"
fi
