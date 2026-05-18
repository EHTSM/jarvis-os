#!/usr/bin/env bash
# Rotate jarvis-os NDJSON logs that have no built-in rotation.
# Run weekly via cron: 0 2 * * 0 /path/to/jarvis-os/scripts/rotate-logs.sh
#
# Targets:
#   data/logs/operator-audit.ndjson  — appended on every operator request, no internal cap
#   $LOG_FILE (from .env)            — optional general logger output, no internal cap
#
# execution.ndjson is NOT rotated here — it has built-in 10MB rotation + 7-day prune.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
LOG_DIR="$PROJECT_ROOT/data/logs"
MAX_KEEP=4       # keep 4 rotated archives
TIMESTAMP=$(date +%Y%m%d)

rotate_file() {
  local file="$1"
  if [ ! -f "$file" ]; then return; fi

  local size
  size=$(stat -c%s "$file" 2>/dev/null || stat -f%z "$file" 2>/dev/null || echo 0)
  # Only rotate if > 1MB
  if [ "$size" -lt 1048576 ]; then return; fi

  local base="${file%.ndjson}"
  local rotated="${base}.${TIMESTAMP}.ndjson.gz"
  gzip -c "$file" > "$rotated" && truncate -s 0 "$file"
  echo "Rotated $file → $rotated (${size} bytes)"

  # Prune old archives: keep MAX_KEEP most recent
  ls -t "${base}".*.ndjson.gz 2>/dev/null | tail -n +$((MAX_KEEP + 1)) | xargs -r rm --
}

rotate_file "$LOG_DIR/operator-audit.ndjson"

# Rotate optional LOG_FILE if set in .env
ENV_FILE="$PROJECT_ROOT/.env"
if [ -f "$ENV_FILE" ]; then
  LOG_FILE_VAL=$(grep -E '^LOG_FILE=' "$ENV_FILE" | cut -d= -f2- | tr -d '"' | tr -d "'")
  if [ -n "$LOG_FILE_VAL" ]; then
    rotate_file "$LOG_FILE_VAL"
  fi
fi

echo "Log rotation complete: $(date)"
