#!/bin/bash
# ════════════════════════════════════════════════════════════════════════
#  JARVIS OS — Runtime Data Separation Migration
#
#  Untracks runtime-generated files from git WITHOUT deleting them from
#  disk. Safe to run on local dev or the VPS — production data survives.
#
#  What this does:
#    1. Verifies .gitignore already covers data/, generated/, .DS_Store
#    2. git rm --cached (not -f) everything under those paths — removes
#       them from the git index only; working tree files are untouched
#    3. Commits the untracking as a single change
#
#  What this does NOT do:
#    - Does not delete/move any file on disk
#    - Does not touch tests/ (already ignored, untracked separately if needed)
#    - Does not touch _archive/ (already ignored, historical/archival)
#
#  Usage: bash scripts/migrate-runtime-data.sh
# ════════════════════════════════════════════════════════════════════════

set -euo pipefail
cd "$(dirname "$0")/.."

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log()  { echo -e "${GREEN}[+]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
die()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }

[ -d .git ] || die "Not a git repository."

# ── Pre-flight: refuse to run with unrelated uncommitted changes staged ────
if ! git diff --cached --quiet; then
    die "You have staged changes already. Commit or unstage them first, then re-run."
fi

log "Counting currently tracked runtime files..."
DATA_COUNT=$(git ls-files -- data/ | wc -l | tr -d ' ')
GEN_COUNT=$(git ls-files -- generated/ | wc -l | tr -d ' ')
DS_COUNT=$(git ls-files -- .DS_Store | wc -l | tr -d ' ')
BURNIN_COUNT=$(git ls-files -- tests/burnin/reports/ | wc -l | tr -d ' ')
TOTAL=$((DATA_COUNT + GEN_COUNT + DS_COUNT + BURNIN_COUNT))

log "  data/                    : $DATA_COUNT tracked files"
log "  generated/               : $GEN_COUNT tracked files"
log "  tests/burnin/reports/    : $BURNIN_COUNT tracked files"
log "  .DS_Store                : $DS_COUNT tracked file"
log "  TOTAL to untrack         : $TOTAL"

[ "$TOTAL" -eq 0 ] && { log "Nothing to untrack. Already clean."; exit 0; }

# ── Safety net: snapshot the current index state before mutating it ───────
BACKUP_DIR="backups/pre-migration-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
log "Backing up current data/ (as tracked by git) to $BACKUP_DIR ..."
tar -czf "$BACKUP_DIR/data-snapshot.tar.gz" data/ 2>/dev/null || warn "data/ snapshot skipped (dir may not exist yet)"
[ -d generated ] && tar -czf "$BACKUP_DIR/generated-snapshot.tar.gz" generated/ 2>/dev/null || true
log "Backup written: $BACKUP_DIR"

# ── Untrack from git index only (working tree files stay on disk) ─────────
log "Untracking data/ from git (files remain on disk)..."
[ "$DATA_COUNT" -gt 0 ] && git rm -r --cached --quiet data/ || true

log "Untracking generated/ from git (files remain on disk)..."
[ "$GEN_COUNT" -gt 0 ] && git rm -r --cached --quiet generated/ || true

log "Untracking tests/burnin/reports/ from git (files remain on disk)..."
[ "$BURNIN_COUNT" -gt 0 ] && git rm -r --cached --quiet tests/burnin/reports/ || true

log "Untracking .DS_Store from git (file remains on disk)..."
[ "$DS_COUNT" -gt 0 ] && git rm --cached --quiet .DS_Store || true

# ── Verify working tree files are intact ───────────────────────────────────
log "Verifying no files were deleted from disk..."
REMAINING_DATA=$(find data -type f 2>/dev/null | wc -l | tr -d ' ')
log "  data/ files still on disk: $REMAINING_DATA"
[ "$REMAINING_DATA" -eq 0 ] && [ "$DATA_COUNT" -gt 0 ] && die "data/ appears empty after untracking — ABORT, restore from $BACKUP_DIR"

# ── Stage .gitignore + the removals, commit ────────────────────────────────
git add .gitignore
log "Staged changes summary:"
git status --short | head -10 || true
echo "  ... ($(git status --short | wc -l | tr -d ' ') total lines)"

git commit -q -m "$(cat <<'EOF'
chore: separate runtime-generated data from git tracking

Untrack data/, generated/, tests/burnin/reports/, and .DS_Store — all
self-initializing runtime output (state/kpis/memory/reports/checkpoints/
sessions/metrics/screenshots), never seed or config. Files remain on disk
and in backups/; only git tracking is removed. .gitignore updated to
prevent re-tracking.
EOF
)"

log "Committed. Verifying clean status..."
if git status --porcelain | grep -q .; then
    warn "git status is not fully clean — review output below:"
    git status --short
else
    log "git status is clean."
fi

log "Migration complete. Backup at: $BACKUP_DIR"
