#!/bin/bash
# JARVIS data backup — call via cron or manually.
# Backs up: data/ (leads, task queue, memory, learning)

set -e
cd "$(dirname "$0")"

BACKUP_DIR="backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
DEST="${BACKUP_DIR}/jarvis_${TIMESTAMP}.tar.gz"

mkdir -p "$BACKUP_DIR"
tar -czf "$DEST" data/ --exclude="data/autonomous" --exclude="data/futureTech" 2>/dev/null || true

echo "[Backup] Created: $DEST"

# Keep last 14 backups
ls -t "${BACKUP_DIR}"/jarvis_*.tar.gz 2>/dev/null | tail -n +15 | xargs rm -f 2>/dev/null || true
echo "[Backup] Done. $(ls "${BACKUP_DIR}"/jarvis_*.tar.gz 2>/dev/null | wc -l | tr -d ' ') backup(s) retained."
