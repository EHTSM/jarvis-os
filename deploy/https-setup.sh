#!/bin/bash
# ════════════════════════════════════════════════════════════════════════
#  JARVIS OS — HTTPS / SSL setup via Certbot + Let's Encrypt
#
#  Run AFTER:
#    1. Domain DNS A record points to this VPS IP
#    2. Nginx is running (setup-vps.sh completed)
#    3. Ports 80 and 443 are open (ufw configured by setup-vps.sh)
#
#  Usage:
#    bash deploy/https-setup.sh yourdomain.com
# ════════════════════════════════════════════════════════════════════════

set -euo pipefail

DOMAIN="${1:-}"
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log()  { echo -e "${GREEN}[+]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
die()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }

[ -z "$DOMAIN" ] && die "Usage: bash deploy/https-setup.sh yourdomain.com"
[[ $EUID -ne 0 ]] && die "Run as root: sudo bash deploy/https-setup.sh $DOMAIN"

log "Setting up HTTPS for: $DOMAIN"

# ── 1. Verify DNS resolves to this machine ───────────────────────────────
THIS_IP=$(curl -sf --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
DNS_IP=$(dig +short "$DOMAIN" 2>/dev/null | tail -1)

if [ -z "$DNS_IP" ]; then
    warn "Could not resolve $DOMAIN — DNS may not have propagated yet."
    warn "Your server IP: $THIS_IP"
    warn "Set an A record: $DOMAIN → $THIS_IP and wait 5–30 minutes, then re-run."
    warn "Continuing anyway (certbot will verify itself)..."
elif [ "$DNS_IP" != "$THIS_IP" ]; then
    warn "DNS mismatch: $DOMAIN resolves to $DNS_IP but this server is $THIS_IP"
    warn "Update the A record and wait for propagation before running certbot."
    die "Aborting to prevent certbot rate-limit failures."
else
    log "DNS OK: $DOMAIN → $THIS_IP"
fi

# ── 2. Patch nginx config with real domain ───────────────────────────────
NGINX_CONF="/etc/nginx/sites-available/jarvis"
if [ -f "$NGINX_CONF" ]; then
    log "Patching nginx config with domain: $DOMAIN"
    sed -i "s/yourdomain\.com/$DOMAIN/g" "$NGINX_CONF"
    nginx -t || die "Nginx config error after domain substitution — check $NGINX_CONF"
    systemctl reload nginx
    log "Nginx reloaded with domain $DOMAIN"
else
    die "Nginx config not found at $NGINX_CONF — run setup-vps.sh first"
fi

# ── 3. Ensure certbot is installed ───────────────────────────────────────
if ! command -v certbot &>/dev/null; then
    log "Installing certbot..."
    apt-get install -y -qq certbot python3-certbot-nginx
fi

# ── 4. Obtain certificate ────────────────────────────────────────────────
log "Requesting Let's Encrypt certificate for $DOMAIN..."
certbot --nginx \
    -d "$DOMAIN" \
    --non-interactive \
    --agree-tos \
    --email "admin@${DOMAIN}" \
    --redirect \
    --keep-until-expiring

# ── 5. Verify SSL ────────────────────────────────────────────────────────
log "Verifying HTTPS..."
sleep 2
if curl -sf --max-time 10 "https://$DOMAIN/health" >/dev/null 2>&1; then
    log "HTTPS is working: https://$DOMAIN/health"
elif curl -sf --max-time 10 "https://$DOMAIN/" >/dev/null 2>&1; then
    log "HTTPS is reachable (server may not be running yet — start it with deploy/start-production.sh)"
else
    warn "HTTPS not yet responding — server may not be running. Check: pm2 status jarvis-os"
fi

# ── 6. Auto-renew cron ───────────────────────────────────────────────────
# Certbot installs its own systemd timer (certbot.timer) on Ubuntu 22+.
# Verify it's active:
if systemctl is-active --quiet certbot.timer 2>/dev/null; then
    log "Auto-renew timer already active (certbot.timer)"
else
    warn "certbot.timer not found — adding renewal cron manually"
    CRON_LINE="0 3 * * * certbot renew --quiet --post-hook 'systemctl reload nginx'"
    (crontab -l 2>/dev/null | grep -v "certbot renew"; echo "$CRON_LINE") | crontab -
    log "Renewal cron added: runs daily at 03:00"
fi

# ── 7. Update .env BASE_URL ──────────────────────────────────────────────
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
if [ -f "$APP_DIR/.env" ]; then
    CURRENT_BASE=$(grep "^BASE_URL=" "$APP_DIR/.env" | cut -d= -f2-)
    if [[ "$CURRENT_BASE" != "https://$DOMAIN" ]]; then
        warn "Updating BASE_URL in .env to https://$DOMAIN"
        sed -i "s|^BASE_URL=.*|BASE_URL=https://$DOMAIN|" "$APP_DIR/.env"
        log "BASE_URL updated. Restart JARVIS: pm2 restart jarvis-os"
    else
        log "BASE_URL already correct in .env"
    fi
fi

echo ""
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log " HTTPS setup complete for $DOMAIN"
log ""
log " Certificate: /etc/letsencrypt/live/$DOMAIN/"
log " Expires: $(certbot certificates 2>/dev/null | grep -A2 "$DOMAIN" | grep "Expiry" | awk '{print $NF}' || echo "check: certbot certificates")"
log " Auto-renew: enabled"
log ""
warn " NEXT: if BASE_URL was just updated, restart JARVIS:"
warn "   pm2 restart jarvis-os"
warn " Then set the Razorpay webhook URL to:"
warn "   https://$DOMAIN/webhook/razorpay"
warn " And the WhatsApp webhook URL to:"
warn "   https://$DOMAIN/whatsapp/webhook"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
