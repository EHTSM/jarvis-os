#!/bin/bash
# ════════════════════════════════════════════════════════════════════════
#  JARVIS OS — Health monitoring script
#  Run manually or via cron every 5 minutes to auto-recover crashed server.
#
#  Cron setup (runs every 5 min, auto-restarts if down):
#    crontab -e
#    */5 * * * * /opt/jarvis-os/deploy/healthcheck.sh >> /opt/jarvis-os/logs/healthcheck.log 2>&1
# ════════════════════════════════════════════════════════════════════════

cd "$(dirname "$0")/.."
PORT="${PORT:-5050}"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

if curl -sf "http://localhost:${PORT}/health" >/dev/null 2>&1; then
    # Get key metrics
    HEALTH=$(curl -s "http://localhost:${PORT}/health" 2>/dev/null)
    UPTIME=$(echo "$HEALTH" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('uptime_seconds','?'))" 2>/dev/null || echo "?")
    MEMORY=$(echo "$HEALTH" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('memory',{}).get('heap_used_mb','?'))" 2>/dev/null || echo "?")
    echo "[${TIMESTAMP}] OK — uptime=${UPTIME}s memory=${MEMORY}MB"
else
    echo "[${TIMESTAMP}] UNHEALTHY — attempting restart..."
    pm2 restart jarvis-os 2>/dev/null || pm2 start ecosystem.config.cjs --env production 2>/dev/null
    sleep 5
    if curl -sf "http://localhost:${PORT}/health" >/dev/null 2>&1; then
        echo "[${TIMESTAMP}] RECOVERED — server restarted successfully"
    else
        echo "[${TIMESTAMP}] FAILED — server did not recover, check: pm2 logs jarvis-os"
    fi
fi
