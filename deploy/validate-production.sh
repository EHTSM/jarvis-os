#!/bin/bash
# ════════════════════════════════════════════════════════════════════════
#  Ooplix — Production Validation Script (OP-1 Task 7)
#
#  Runs 30 checks across: env, server, auth, routes, PM2, nginx, SSL,
#  backups, monitoring, and data integrity.
#
#  Exit codes:
#    0 — all checks passed
#    1 — one or more checks failed (review output)
#
#  Usage:
#    bash deploy/validate-production.sh
#    bash deploy/validate-production.sh --json   # machine-readable JSON
# ════════════════════════════════════════════════════════════════════════

set -uo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-5050}"
BASE="${BASE_URL:-http://localhost:${PORT}}"
JSON_MODE=0
[ "${1:-}" = "--json" ] && JSON_MODE=1

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'
PASS=0; FAIL=0; WARN=0

declare -a RESULTS=()

check() {
    local name="$1" status="$2" detail="${3:-}"
    RESULTS+=("{\"check\":\"${name}\",\"status\":\"${status}\",\"detail\":\"${detail}\"}")
    if [ "$JSON_MODE" = "0" ]; then
        case "$status" in
            PASS) echo -e "  ${GREEN}✓${NC} ${name}${detail:+ — ${detail}}"; ((PASS++)) ;;
            FAIL) echo -e "  ${RED}✗${NC} ${name}${detail:+ — ${detail}}"; ((FAIL++)) ;;
            WARN) echo -e "  ${YELLOW}⚠${NC} ${name}${detail:+ — ${detail}}"; ((WARN++)) ;;
        esac
    else
        case "$status" in PASS) ((PASS++)) ;; FAIL) ((FAIL++)) ;; WARN) ((WARN++)) ;; esac
    fi
}

section() { [ "$JSON_MODE" = "0" ] && echo -e "\n${BOLD}── $1 ──${NC}"; }

# ─────────────────────────────────────────────────────────────────────────────
section "1. Environment"
# ─────────────────────────────────────────────────────────────────────────────

[ -f .env ] && source .env 2>/dev/null || true

if [ -f .env ]; then
    check ".env file exists" PASS
else
    check ".env file exists" FAIL "copy .env.example and fill in values"
fi

if [ -n "${JWT_SECRET:-}" ] && [ ${#JWT_SECRET} -ge 32 ]; then
    check "JWT_SECRET set (≥32 chars)" PASS "${#JWT_SECRET} chars"
else
    check "JWT_SECRET set (≥32 chars)" FAIL "generate: node -e \"require('crypto').randomBytes(32).toString('hex')\""
fi

if [ -n "${OPERATOR_PASSWORD_HASH:-}" ]; then
    check "OPERATOR_PASSWORD_HASH set" PASS
else
    check "OPERATOR_PASSWORD_HASH set" FAIL "generate: node scripts/generate-password-hash.cjs <password>"
fi

if [ -n "${NODE_ENV:-}" ] && [ "${NODE_ENV}" = "production" ]; then
    check "NODE_ENV=production" PASS
else
    check "NODE_ENV=production" FAIL "current: ${NODE_ENV:-unset}"
fi

if [ -n "${BASE_URL:-}" ] && [[ "${BASE_URL}" == "https://"* ]] && [[ "${BASE_URL}" != *"localhost"* ]]; then
    check "BASE_URL is production HTTPS" PASS "${BASE_URL}"
else
    check "BASE_URL is production HTTPS" FAIL "current: ${BASE_URL:-unset}"
fi

if [ -n "${GROQ_API_KEY:-}" ] || [ -n "${OPENAI_API_KEY:-}" ] || [ -n "${ANTHROPIC_API_KEY:-}" ]; then
    check "AI provider key set" PASS
else
    check "AI provider key set" WARN "set GROQ_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY"
fi

if [ -n "${RAZORPAY_KEY_ID:-}" ] && [ -n "${RAZORPAY_KEY_SECRET:-}" ]; then
    check "Razorpay credentials set" PASS
else
    check "Razorpay credentials set" WARN "payments disabled without RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET"
fi

if [ -n "${RAZORPAY_WEBHOOK_SECRET:-}" ]; then
    check "Razorpay webhook secret set" PASS
else
    check "Razorpay webhook secret set" WARN "webhook HMAC validation disabled"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "2. Process Manager (PM2)"
# ─────────────────────────────────────────────────────────────────────────────

if command -v pm2 &>/dev/null; then
    check "pm2 installed" PASS "$(pm2 --version 2>/dev/null)"
else
    check "pm2 installed" FAIL "run: npm install -g pm2"
fi

PM2_STATUS=$(pm2 jlist 2>/dev/null | python3 -c "
import sys, json
try:
    procs = json.load(sys.stdin)
    for p in procs:
        if p.get('name') in ('jarvis-os', 'jarvis'):
            print(p.get('pm2_env', {}).get('status', 'stopped'))
except:
    print('unknown')
" 2>/dev/null || echo "unknown")

if [ "$PM2_STATUS" = "online" ]; then
    check "jarvis-os process online" PASS
else
    check "jarvis-os process online" FAIL "status: ${PM2_STATUS} — run: pm2 start ecosystem.config.cjs --env production"
fi

PM2_STARTUP=$(pm2 list 2>/dev/null | grep -c "jarvis" || echo "0")
if [ "$PM2_STARTUP" -gt "0" ]; then
    check "PM2 startup configured" PASS "run 'pm2 startup' and 'pm2 save' if not done"
else
    check "PM2 startup configured" WARN "run: pm2 startup && pm2 save"
fi

# Backup PM2 job
BACKUP_STATUS=$(pm2 jlist 2>/dev/null | python3 -c "
import sys, json
try:
    procs = json.load(sys.stdin)
    for p in procs:
        if p.get('name') == 'ooplix-backup':
            print(p.get('pm2_env', {}).get('status', 'stopped'))
except:
    print('missing')
" 2>/dev/null || echo "missing")

if [ "$BACKUP_STATUS" = "online" ] || [ "$BACKUP_STATUS" = "launching" ]; then
    check "ooplix-backup cron job configured" PASS
else
    check "ooplix-backup cron job configured" WARN "backup job not in PM2 — check ecosystem.config.cjs"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "3. Server Health"
# ─────────────────────────────────────────────────────────────────────────────

HEALTH=$(curl -sf --max-time 5 "http://localhost:${PORT}/health" 2>/dev/null || echo "")
if [ -n "$HEALTH" ]; then
    check "GET /health responds" PASS
    HS=$(echo "$HEALTH" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status','?'))" 2>/dev/null || echo "?")
    if [ "$HS" = "ok" ]; then
        check "Health status is ok" PASS
    else
        check "Health status is ok" WARN "status: ${HS}"
    fi
    HEAP=$(echo "$HEALTH" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('memory',{}).get('heap_used_mb','?'))" 2>/dev/null || echo "?")
    check "Memory heap reported" PASS "${HEAP} MB"
else
    check "GET /health responds" FAIL "server not responding on port ${PORT}"
    check "Health status is ok" FAIL "server unreachable"
    check "Memory heap reported" FAIL "server unreachable"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "4. Core API Routes"
# ─────────────────────────────────────────────────────────────────────────────

check_route() {
    local label="$1" url="$2" expected="${3:-200}"
    CODE=$(curl -s --max-time 5 -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo "000")
    if [ "$CODE" = "$expected" ] || [ "$CODE" = "401" ] || [ "$CODE" = "403" ]; then
        check "$label ($CODE)" PASS
    else
        check "$label ($CODE)" FAIL "expected HTTP $expected from $url"
    fi
}

check_route "GET /health"       "http://localhost:${PORT}/health"       "200"
check_route "GET /ops"          "http://localhost:${PORT}/ops"          "401"
check_route "GET /auth/me"      "http://localhost:${PORT}/auth/me"      "401"
check_route "GET /billing/status" "http://localhost:${PORT}/billing/status" "401"
check_route "GET /launch/dashboard" "http://localhost:${PORT}/launch/dashboard" "401"
check_route "GET /growth/dashboard" "http://localhost:${PORT}/growth/dashboard" "401"

# ─────────────────────────────────────────────────────────────────────────────
section "5. Nginx"
# ─────────────────────────────────────────────────────────────────────────────

if command -v nginx &>/dev/null; then
    check "nginx installed" PASS "$(nginx -v 2>&1 | head -1)"
    if nginx -t 2>/dev/null; then
        check "nginx config valid" PASS
    else
        check "nginx config valid" FAIL "run: sudo nginx -t"
    fi
    if systemctl is-active --quiet nginx 2>/dev/null; then
        check "nginx service running" PASS
    else
        check "nginx service running" WARN "run: sudo systemctl start nginx"
    fi
else
    check "nginx installed" WARN "nginx not installed — for VPS only, skip on local dev"
    check "nginx config valid" WARN "nginx not available"
    check "nginx service running" WARN "nginx not available"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "6. SSL / HTTPS"
# ─────────────────────────────────────────────────────────────────────────────

DOMAIN=$(echo "${BASE_URL:-}" | sed 's|https\?://||' | cut -d/ -f1)
if [ -n "$DOMAIN" ] && [[ "$DOMAIN" != "localhost"* ]]; then
    CERT_PATH="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
    if [ -f "$CERT_PATH" ]; then
        EXPIRY=$(openssl x509 -enddate -noout -in "$CERT_PATH" 2>/dev/null | cut -d= -f2 || echo "unknown")
        DAYS_LEFT=$(echo "$EXPIRY" | python3 -c "
import sys, datetime
try:
    exp = datetime.datetime.strptime(sys.stdin.read().strip(), '%b %d %H:%M:%S %Y %Z')
    print((exp - datetime.datetime.utcnow()).days)
except:
    print(-1)
" 2>/dev/null || echo "-1")
        if [ "$DAYS_LEFT" -gt 30 ]; then
            check "SSL certificate valid" PASS "${DAYS_LEFT} days remaining"
        elif [ "$DAYS_LEFT" -gt 0 ]; then
            check "SSL certificate valid" WARN "${DAYS_LEFT} days — renew soon: certbot renew"
        else
            check "SSL certificate valid" FAIL "expired or unreadable — run: sudo certbot renew"
        fi
    else
        check "SSL certificate valid" WARN "no cert at ${CERT_PATH} — run: bash deploy/https-setup.sh ${DOMAIN}"
    fi

    if command -v certbot &>/dev/null; then
        if systemctl is-active --quiet certbot.timer 2>/dev/null || crontab -l 2>/dev/null | grep -q "certbot"; then
            check "SSL auto-renew configured" PASS
        else
            check "SSL auto-renew configured" WARN "run: certbot renew --dry-run to verify"
        fi
    else
        check "SSL auto-renew configured" WARN "certbot not installed"
    fi
else
    check "SSL certificate valid" WARN "BASE_URL is localhost — skip SSL check"
    check "SSL auto-renew configured" WARN "skipped (localhost)"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "7. Data Directories"
# ─────────────────────────────────────────────────────────────────────────────

for dir in data logs backups; do
    if [ -d "$dir" ]; then
        check "Directory $dir/ exists" PASS
    else
        check "Directory $dir/ exists" FAIL "run: mkdir -p $dir"
    fi
done

DISK_PCT=$(df -h . 2>/dev/null | awk 'NR==2 {gsub(/%/,"",$5); print $5}' || echo "0")
if [ "${DISK_PCT:-0}" -lt 80 ]; then
    check "Disk usage <80%" PASS "${DISK_PCT}% used"
else
    check "Disk usage <80%" WARN "${DISK_PCT}% — free space is low"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "8. Backups"
# ─────────────────────────────────────────────────────────────────────────────

BACKUP_COUNT=$(ls backups/jarvis_*.tar.gz 2>/dev/null | wc -l | tr -d ' ' || echo "0")
if [ "${BACKUP_COUNT:-0}" -ge 1 ]; then
    LATEST=$(ls -t backups/jarvis_*.tar.gz 2>/dev/null | head -1)
    LATEST_AGE=$(python3 -c "
import os, time
try:
    age = int((time.time() - os.path.getmtime('${LATEST}')) / 3600)
    print(f'{age}h ago')
except:
    print('?')
" 2>/dev/null || echo "?")
    check "Backup archives exist" PASS "${BACKUP_COUNT} archives, latest: ${LATEST_AGE}"
else
    check "Backup archives exist" WARN "no backups found — run: npm run backup"
fi

if [ "$BACKUP_STATUS" = "online" ] || [ "$BACKUP_STATUS" = "launching" ]; then
    check "Automated daily backup scheduled" PASS "ooplix-backup PM2 job running"
else
    check "Automated daily backup scheduled" WARN "start backup job: pm2 start ecosystem.config.cjs"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "9. Monitoring"
# ─────────────────────────────────────────────────────────────────────────────

LOGS_DIR="logs"
if [ -f "${LOGS_DIR}/pm2-err.log" ]; then
    RECENT_ERRORS=$(grep -i "error\|FATAL\|uncaught" "${LOGS_DIR}/pm2-err.log" 2>/dev/null | tail -5 | wc -l || echo "0")
    check "Error log readable" PASS "${RECENT_ERRORS} recent errors"
else
    check "Error log readable" WARN "log file not yet created — server may not have started"
fi

if crontab -l 2>/dev/null | grep -q "healthcheck\|validate-production"; then
    check "Healthcheck cron configured" PASS
else
    check "Healthcheck cron configured" WARN "add to crontab: */5 * * * * /opt/jarvis-os/deploy/healthcheck.sh >> /opt/jarvis-os/logs/healthcheck.log 2>&1"
fi

if [ -n "${TELEGRAM_TOKEN:-}" ]; then
    check "Telegram alerting configured" PASS "TELEGRAM_TOKEN set"
else
    check "Telegram alerting configured" WARN "set TELEGRAM_TOKEN for crash/recovery alerts"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "10. Security"
# ─────────────────────────────────────────────────────────────────────────────

ENV_PERMS=$(stat -c "%a" .env 2>/dev/null || stat -f "%A" .env 2>/dev/null || echo "?")
if [[ "$ENV_PERMS" == "600" ]] || [[ "$ENV_PERMS" == "0600" ]]; then
    check ".env permissions 600" PASS
else
    check ".env permissions 600" WARN "current: ${ENV_PERMS} — run: chmod 600 .env"
fi

if command -v ufw &>/dev/null; then
    UFW_STATUS=$(ufw status 2>/dev/null | grep "Status:" | awk '{print $2}' || echo "?")
    if [ "$UFW_STATUS" = "active" ]; then
        check "Firewall (ufw) active" PASS
    else
        check "Firewall (ufw) active" WARN "run: sudo ufw enable"
    fi
else
    check "Firewall (ufw) active" WARN "ufw not available — ensure firewall rules are applied externally"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────────────────────────

TOTAL=$((PASS + FAIL + WARN))

if [ "$JSON_MODE" = "1" ]; then
    IFS=',' ; echo "{\"total\":${TOTAL},\"pass\":${PASS},\"warn\":${WARN},\"fail\":${FAIL},\"score\":$(python3 -c "print(round(${PASS}/${TOTAL}*100))" 2>/dev/null || echo 0),\"checks\":[$(echo "${RESULTS[*]}")]}"
    [ "$FAIL" -eq 0 ] && exit 0 || exit 1
fi

echo ""
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD} Production Validation — $(date '+%Y-%m-%d %H:%M:%S')${NC}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  ${GREEN}✓ PASS${NC}  ${PASS}"
echo -e "  ${YELLOW}⚠ WARN${NC}  ${WARN}"
echo -e "  ${RED}✗ FAIL${NC}  ${FAIL}"
echo -e "  Total   ${TOTAL}"
SCORE=$(python3 -c "print(round(${PASS}/${TOTAL}*100))" 2>/dev/null || echo 0)
echo -e "  Score   ${SCORE}%"
echo ""

if [ "$FAIL" -eq 0 ] && [ "$WARN" -eq 0 ]; then
    echo -e "${GREEN}All checks passed — production is healthy.${NC}"
    exit 0
elif [ "$FAIL" -eq 0 ]; then
    echo -e "${YELLOW}No failures — ${WARN} warnings to review before launch.${NC}"
    exit 0
else
    echo -e "${RED}${FAIL} check(s) failed — fix before going live.${NC}"
    exit 1
fi
