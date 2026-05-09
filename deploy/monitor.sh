#!/bin/bash
# ════════════════════════════════════════════════════════════════════════
#  JARVIS OS — Runtime monitoring dashboard
#  Shows: PM2 status, memory, errors, automation stats, CRM, webhooks
#
#  Usage:
#    bash deploy/monitor.sh          — full snapshot
#    bash deploy/monitor.sh --live   — watch mode (refresh every 10s)
#    bash deploy/monitor.sh --errors — error logs only
#    bash deploy/monitor.sh --crm    — lead pipeline only
# ════════════════════════════════════════════════════════════════════════

cd "$(dirname "$0")/.."
PORT="${PORT:-5050}"
BASE="${BASE_URL:-http://localhost:${PORT}}"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
err()  { echo -e "  ${RED}✗${NC} $1"; }
hdr()  { echo -e "\n${BOLD}${CYAN}── $1 ──${NC}"; }

# ── Live / watch mode ─────────────────────────────────────────────────────
if [ "${1:-}" = "--live" ]; then
    while true; do
        clear
        bash "$0"
        echo ""
        echo "(refreshing in 10s — Ctrl+C to stop)"
        sleep 10
    done
    exit 0
fi

# ── Error logs only ───────────────────────────────────────────────────────
if [ "${1:-}" = "--errors" ]; then
    echo -e "${BOLD}Recent errors (last 50 lines):${NC}"
    pm2 logs jarvis-os --lines 50 --nostream --err 2>/dev/null || cat logs/pm2-err.log 2>/dev/null | tail -50
    exit 0
fi

echo -e "${BOLD}JARVIS OS — Runtime Monitor — $(date '+%Y-%m-%d %H:%M:%S')${NC}"

# ── 1. PM2 process status ─────────────────────────────────────────────────
hdr "PM2 Process"
pm2 jlist 2>/dev/null | python3 -c "
import sys, json
try:
    procs = json.load(sys.stdin)
    for p in procs:
        if p.get('name') == 'jarvis-os':
            status  = p.get('pm2_env',{}).get('status','?')
            restart = p.get('pm2_env',{}).get('restart_time',0)
            uptime  = p.get('pm2_env',{}).get('pm_uptime',0)
            cpu     = p.get('monit',{}).get('cpu',0)
            mem     = round(p.get('monit',{}).get('memory',0) / 1_048_576)
            import time
            up_secs = int((time.time()*1000 - uptime)/1000) if uptime else 0
            up_str  = f'{up_secs//3600}h {(up_secs%3600)//60}m'
            color   = '\033[0;32m' if status == 'online' else '\033[0;31m'
            print(f'  {color}status   :{chr(27)}[0m {status}')
            print(f'  uptime   : {up_str}')
            print(f'  restarts : {restart}')
            print(f'  cpu      : {cpu}%')
            print(f'  memory   : {mem} MB')
except: print('  (could not parse PM2 status)')
" 2>/dev/null || pm2 status jarvis-os 2>/dev/null

# ── 2. Health endpoint ────────────────────────────────────────────────────
hdr "Health Check"
HEALTH=$(curl -sf --max-time 5 "http://localhost:${PORT}/health" 2>/dev/null)
if [ -z "$HEALTH" ]; then
    err "Server not responding on port ${PORT}"
else
    echo "$HEALTH" | python3 -c "
import sys, json
d = json.load(sys.stdin)
status = d.get('status','?')
color = '\033[0;32m' if status == 'ok' else '\033[1;33m'
print(f'  {color}status   :{chr(27)}[0m {status}')
print(f'  uptime   : {d.get(\"uptime_seconds\",\"?\")}s')
svcs = d.get('services',{})
for k,v in svcs.items():
    sym = '\033[0;32m✓\033[0m' if v else '\033[0;31m✗\033[0m'
    print(f'  {sym} {k}')
warns = d.get('warnings',[])
for w in warns:
    print(f'  \033[1;33m⚠\033[0m {w}')
mem = d.get('memory',{}).get('current',{})
if mem:
    heap = mem.get('heap_mb','?')
    print(f'  heap     : {heap} MB')
" 2>/dev/null
fi

# ── 3. Operational stats (/ops) ───────────────────────────────────────────
hdr "Operational Stats"
OPS=$(curl -sf --max-time 5 "http://localhost:${PORT}/ops" 2>/dev/null)
if [ -n "$OPS" ]; then
    echo "$OPS" | python3 -c "
import sys, json
d = json.load(sys.stdin)

# CRM
crm = d.get('crm',{}) or {}
if crm:
    print(f'  leads    : {crm.get(\"total\",0)} total | {crm.get(\"new\",0)} new | {crm.get(\"hot\",0)} hot | {crm.get(\"paid\",0)} paid')
    print(f'  revenue  : INR {crm.get(\"revenue\",0):,}  ({crm.get(\"conversionRate\",\"0%\")} conv)')

# Automation
auto = d.get('automation',{}) or {}
if auto:
    total_sent = sum(v.get('sent',0) for v in auto.values())
    total_fail = sum(v.get('failed',0) for v in auto.values())
    print(f'  auto     : {total_sent} sent | {total_fail} failed')
    for k,v in auto.items():
        rate = v.get('success_rate')
        last = v.get('lastRun','never')
        rate_str = f'{rate}%' if rate is not None else '—'
        print(f'    {k:10s}: sent={v.get(\"sent\",0)} rate={rate_str}')

# Errors
errs = d.get('errors',{}) or {}
if errs:
    per_hr = errs.get('errors_per_hour',0)
    color = '\033[0;31m' if per_hr > 5 else '\033[0;32m'
    print(f'  {color}errors/hr: {per_hr}\033[0m')

# Warnings
warns = d.get('warnings',[])
for w in warns:
    print(f'  \033[1;33m⚠\033[0m {w.get(\"code\",\"?\")} — {w.get(\"detail\",\"\")}')

# Queue
q = d.get('queue',{}) or {}
if q:
    counts = q.get('counts',{})
    print(f'  queue    : {counts.get(\"pending\",0)} pending | {counts.get(\"completed\",0)} done | {counts.get(\"failed\",0)} failed')
    if q.get('oldestPendingMins',0) > 30:
        print(f'  \033[1;33m⚠\033[0m oldest pending: {q[\"oldestPendingMins\"]}m')
" 2>/dev/null
else
    warn "Could not reach /ops endpoint"
fi

# ── 4. Recent error log lines ─────────────────────────────────────────────
hdr "Recent Errors (last 10)"
LOG_FILE="logs/pm2-err.log"
if [ -f "$LOG_FILE" ]; then
    ERRS=$(grep -i "error\|FATAL\|warn" "$LOG_FILE" 2>/dev/null | tail -10)
    if [ -z "$ERRS" ]; then
        ok "No errors in log"
    else
        echo "$ERRS" | while IFS= read -r line; do
            echo "  $line"
        done
    fi
else
    warn "Log file not found: ${LOG_FILE}"
    pm2 logs jarvis-os --lines 10 --nostream --err 2>/dev/null | tail -10
fi

# ── 5. Disk space ─────────────────────────────────────────────────────────
hdr "Disk Space"
df -h . 2>/dev/null | awk 'NR==2 { printf "  used: %s / %s (%s)\n", $3, $2, $5 }'
LEADS_SIZE=$(du -sh data/leads.json 2>/dev/null | cut -f1)
echo "  leads.json: ${LEADS_SIZE:-?}"
BACKUP_COUNT=$(ls backups/jarvis_*.tar.gz 2>/dev/null | wc -l | tr -d ' ')
echo "  backups: ${BACKUP_COUNT} stored"

# ── 6. Payment verification ───────────────────────────────────────────────
hdr "Payment Verification"
# Check if any leads are stuck in pending_verification
STUCK=$(python3 -c "
import json, time
try:
    leads = json.load(open('data/leads.json'))
    cutoff = time.time() - 3600  # > 1 hour
    stuck = [l for l in leads if l.get('status') == 'pending_verification'
             and l.get('updatedAt','') < __import__('datetime').datetime.utcfromtimestamp(cutoff).isoformat()]
    for l in stuck:
        print(f\"  stuck: {l.get('name','?')} ({l.get('phone','?')}) — {l.get('updatedAt','?')}\")
    if not stuck:
        print('  no leads stuck in pending_verification')
except Exception as e:
    print(f'  (could not read leads: {e})')
" 2>/dev/null)
echo "$STUCK"

# Check recent paid leads
python3 -c "
import json
try:
    leads = json.load(open('data/leads.json'))
    paid = [l for l in leads if l.get('status') in ('paid','onboarded') and l.get('paidAt')]
    paid.sort(key=lambda l: l.get('paidAt',''), reverse=True)
    for l in paid[:3]:
        print(f\"  paid: {l.get('name','?')} — {l.get('paidAt','?')[:16]}\")
    if not paid:
        print('  no paid leads yet')
except: pass
" 2>/dev/null

# ── 7. WhatsApp health ────────────────────────────────────────────────────
hdr "WhatsApp"
if [ -n "${WA_TOKEN:-}" ] || grep -q "^WA_TOKEN=" .env 2>/dev/null; then
    ok "WA_TOKEN is set"
    WA_PHONE=$(grep "^WA_PHONE_ID\|^PHONE_NUMBER_ID" .env 2>/dev/null | head -1)
    [ -n "$WA_PHONE" ] && ok "$WA_PHONE" || warn "WA_PHONE_ID not found in .env"
else
    err "WA_TOKEN is NOT set — WhatsApp disabled"
fi

echo ""
echo -e "${BOLD}Run 'bash deploy/monitor.sh --live' for auto-refresh${NC}"
echo -e "${BOLD}Run 'bash deploy/monitor.sh --errors' for full error log${NC}"
echo -e "${BOLD}Run 'bash deploy/rollback.sh --list' to see available backups${NC}"
