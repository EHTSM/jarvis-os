#!/bin/bash
# ════════════════════════════════════════════════════════════════════════
#  JARVIS OS — Rollback script
#
#  Usage:
#    bash deploy/rollback.sh                   # restore latest data backup
#    bash deploy/rollback.sh --list             # list available data backups
#    bash deploy/rollback.sh FILE.tar.gz        # restore specific data backup
#    bash deploy/rollback.sh --code <commit>    # rollback code to a git commit
#    bash deploy/rollback.sh --code HEAD~1      # rollback code one commit
# ════════════════════════════════════════════════════════════════════════

set -euo pipefail
cd "$(dirname "$0")/.."

BACKUP_DIR="backups"
PORT="${PORT:-5050}"
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()  { echo -e "${GREEN}[+]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
die()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }

# ── List mode ─────────────────────────────────────────────────────────────
if [ "${1:-}" = "--list" ]; then
    echo "Available data backups:"
    ls -lh "${BACKUP_DIR}"/jarvis_*.tar.gz 2>/dev/null || echo "  No backups found."
    echo ""
    echo "Recent git commits (for --code rollback):"
    git log --oneline -10 2>/dev/null || echo "  Not a git repository."
    exit 0
fi

# ── Code rollback mode ────────────────────────────────────────────────────
if [ "${1:-}" = "--code" ]; then
    TARGET_COMMIT="${2:-}"
    [ -z "$TARGET_COMMIT" ] && die "Usage: bash deploy/rollback.sh --code <commit-hash or HEAD~1>"

    # Verify it's a valid git ref
    git rev-parse --verify "$TARGET_COMMIT" >/dev/null 2>&1 \
        || die "Invalid git ref: $TARGET_COMMIT"

    CURRENT=$(git rev-parse --short HEAD)
    TARGET=$(git rev-parse --short "$TARGET_COMMIT")

    warn "Code rollback: ${CURRENT} → ${TARGET}"
    warn "This will checkout code at ${TARGET_COMMIT} and restart the server."
    warn "Your .env and data/ will NOT be affected."
    warn "Press Ctrl+C within 5 seconds to cancel..."
    sleep 5

    # ── Backup .env before any code change ──────────────────────────────
    _backup_env

    # ── Stop server ──────────────────────────────────────────────────────
    log "Stopping JARVIS..."
    pm2 stop jarvis-os 2>/dev/null || true

    # ── Git checkout ─────────────────────────────────────────────────────
    log "Checking out code at ${TARGET_COMMIT}..."
    git checkout "$TARGET_COMMIT" -- backend/ agents/ orchestrator.cjs package.json \
        2>/dev/null || git checkout "$TARGET_COMMIT" 2>/dev/null

    # ── Reinstall deps if package.json changed ───────────────────────────
    log "Installing dependencies..."
    npm install --omit=dev --ignore-scripts 2>&1 | grep -v "^npm warn" | tail -5 || true

    # ── Restart and verify ───────────────────────────────────────────────
    _restart_and_verify "$TARGET"
    exit 0
fi

# ── Data rollback mode (default) ─────────────────────────────────────────

# Helper: backup .env to a timestamped file outside the data/ archive
_backup_env() {
    if [ -f ".env" ]; then
        ENV_BACKUP="${BACKUP_DIR}/.env.bak.$(date +%Y%m%d_%H%M%S)"
        cp ".env" "${ENV_BACKUP}"
        chmod 600 "${ENV_BACKUP}"
        log ".env backed up to ${ENV_BACKUP} (permissions: 600)"
    fi
}

# Helper: restart PM2 and verify health
_restart_and_verify() {
    local label="${1:-}"
    log "Restarting JARVIS..."
    pm2 start jarvis-os 2>/dev/null || pm2 start ecosystem.config.cjs --env production

    # Wait up to 15s for the server to become healthy
    local i=0
    while [ $i -lt 5 ]; do
        sleep 3
        if curl -sf "http://localhost:${PORT}/health" >/dev/null 2>&1; then
            local health
            health=$(curl -s "http://localhost:${PORT}/health" 2>/dev/null \
                | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','?'))" 2>/dev/null || echo "ok")
            log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            log " Rollback complete${label:+ (${label})}."
            log " JARVIS is running — health: ${health}"
            log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            return 0
        fi
        i=$((i + 1))
        warn "Waiting for server... (attempt ${i}/5)"
    done
    die "Server did not start cleanly after rollback. Check: pm2 logs jarvis-os"
}

# Re-export helpers so code rollback section (above) can call _backup_env
# Bash doesn't have forward refs — redefine here:
_backup_env() {
    if [ -f ".env" ]; then
        mkdir -p "${BACKUP_DIR}"
        ENV_BACKUP="${BACKUP_DIR}/.env.bak.$(date +%Y%m%d_%H%M%S)"
        cp ".env" "${ENV_BACKUP}"
        chmod 600 "${ENV_BACKUP}"
        log ".env backed up to ${ENV_BACKUP} (permissions: 600)"
    fi
}

_restart_and_verify() {
    local label="${1:-}"
    log "Restarting JARVIS..."
    pm2 start jarvis-os 2>/dev/null || pm2 start ecosystem.config.cjs --env production

    local i=0
    while [ $i -lt 5 ]; do
        sleep 3
        if curl -sf "http://localhost:${PORT}/health" >/dev/null 2>&1; then
            local health
            health=$(curl -s "http://localhost:${PORT}/health" 2>/dev/null \
                | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','?'))" 2>/dev/null || echo "ok")
            log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            log " Rollback complete${label:+ (${label})}."
            log " JARVIS is running — health: ${health}"
            log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            return 0
        fi
        i=$((i + 1))
        warn "Waiting for server... (attempt ${i}/5)"
    done
    die "Server did not start cleanly after rollback. Check: pm2 logs jarvis-os"
}

# ── Select backup file ────────────────────────────────────────────────────
if [ -n "${1:-}" ] && [ "${1}" != "--list" ] && [ "${1}" != "--code" ]; then
    BACKUP_FILE="${BACKUP_DIR}/${1}"
else
    BACKUP_FILE=$(ls -t "${BACKUP_DIR}"/jarvis_*.tar.gz 2>/dev/null | head -1)
fi

[ -f "${BACKUP_FILE:-}" ] || die "No backup found. Run 'npm run backup' first or specify a file."

warn "This will overwrite the data/ directory with: ${BACKUP_FILE}"
warn "Press Ctrl+C within 5 seconds to cancel..."
sleep 5

# ── Backup .env ───────────────────────────────────────────────────────────
_backup_env

# ── Stop server ───────────────────────────────────────────────────────────
log "Stopping JARVIS..."
pm2 stop jarvis-os 2>/dev/null || true

# ── Save current data as safety net ──────────────────────────────────────
SAFETY="${BACKUP_DIR}/pre-rollback-$(date +%Y%m%d_%H%M%S).tar.gz"
log "Saving current data/ to ${SAFETY} (safety net)..."
tar -czf "${SAFETY}" data/ 2>/dev/null || true

# ── Restore data ──────────────────────────────────────────────────────────
# Two backup layouts exist in backups/ and this script's own glob
# (jarvis_*.tar.gz) matches BOTH:
#   backup.sh          -> archive rooted at  data/           (extracts in place)
#   safe-backup.cjs    -> archive rooted at  snapshot_<ts>/  (does NOT)
# Extracting the snapshot_* layout with a bare `tar -xzf` created a stray
# snapshot_<ts>/ directory and left data/ completely untouched — the restore
# silently no-opped while still reporting "Rollback complete", because
# _restart_and_verify only checks that /health returns 200 (which it does,
# still serving the OLD data). Since safe-backup.cjs runs nightly, its
# archive is almost always the newest match, so the default no-argument
# `bash deploy/rollback.sh` hit this path. Detect the layout and copy the
# snapshot's files into data/ explicitly. Verified by drill: Phase B.5.
log "Restoring from ${BACKUP_FILE}..."
_ARCHIVE_ROOT=$(tar -tzf "${BACKUP_FILE}" 2>/dev/null | head -1)
case "${_ARCHIVE_ROOT}" in
    data/*)
        tar -xzf "${BACKUP_FILE}" 2>/dev/null
        log "Restored (data/-rooted archive) into data/"
        ;;
    snapshot_*)
        _RTMP=$(mktemp -d)
        tar -xzf "${BACKUP_FILE}" -C "${_RTMP}" 2>/dev/null
        _SNAP="${_RTMP}/$(ls "${_RTMP}" | head -1)"
        mkdir -p data
        # Only the snapshot's own files are restored; anything in data/ that
        # the snapshot does not contain is left as-is (the safety-net archive
        # above is the way back to the pre-restore state).
        _RCOUNT=0
        for _f in "${_SNAP}"/*; do
            [ -f "${_f}" ] || continue
            case "$(basename "${_f}")" in
                env-config-nonsecret.txt) continue ;;  # reference only — never overwrite .env
            esac
            cp "${_f}" "data/$(basename "${_f}")" && _RCOUNT=$((_RCOUNT + 1))
        done
        rm -rf "${_RTMP}"
        log "Restored ${_RCOUNT} file(s) from snapshot archive into data/"
        [ "${_RCOUNT}" -gt 0 ] || die "Restore copied 0 files — refusing to report success. Safety net: ${SAFETY}"
        ;;
    *)
        die "Unrecognized backup layout (root='${_ARCHIVE_ROOT}'). Refusing to restore. Safety net: ${SAFETY}"
        ;;
esac

# ── Restart and verify ────────────────────────────────────────────────────
_restart_and_verify "$(basename "${BACKUP_FILE}")"
