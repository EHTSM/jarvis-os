#!/bin/bash
# ════════════════════════════════════════════════════════════════════════
#  JARVIS OS — VPS Setup Script
#  Run once on a fresh Ubuntu 22.04 / 24.04 VPS as root or sudo user.
#
#  Usage:
#    curl -sL https://raw.githubusercontent.com/EHTSM/jarvis-os/main/deploy/setup-vps.sh | bash
#    OR:
#    chmod +x deploy/setup-vps.sh && sudo bash deploy/setup-vps.sh
# ════════════════════════════════════════════════════════════════════════

set -euo pipefail

REPO_URL="https://github.com/EHTSM/jarvis-os.git"
APP_DIR="/opt/jarvis-os"
APP_USER="jarvis"
NODE_VERSION="20"    # LTS — stable, widely supported

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()  { echo -e "${GREEN}[+]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
die()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }

[[ $EUID -ne 0 ]] && die "Run as root: sudo bash deploy/setup-vps.sh"

log "Starting JARVIS VPS setup..."
log "Ubuntu $(lsb_release -rs) | $(uname -m)"

# ── 1. System update ─────────────────────────────────────────────────────
log "Updating system packages..."
apt-get update -qq && apt-get upgrade -y -qq

# ── 2. Install dependencies ──────────────────────────────────────────────
log "Installing build tools, git, nginx, ufw..."
apt-get install -y -qq git curl wget build-essential nginx ufw certbot python3-certbot-nginx

# ── 3. Node.js via NodeSource ────────────────────────────────────────────
log "Installing Node.js $NODE_VERSION LTS..."
if ! command -v node &>/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
    apt-get install -y nodejs
fi
node --version
npm --version

# ── 4. PM2 ──────────────────────────────────────────────────────────────
log "Installing PM2..."
npm install -g pm2

# ── 5. Create app user ───────────────────────────────────────────────────
log "Creating app user '$APP_USER'..."
if ! id "$APP_USER" &>/dev/null; then
    useradd -m -s /bin/bash "$APP_USER"
fi

# ── 6. Clone / update repo ───────────────────────────────────────────────
log "Setting up app directory at $APP_DIR..."
if [ -d "$APP_DIR/.git" ]; then
    log "Repo exists — pulling latest..."
    git -C "$APP_DIR" pull
else
    git clone "$REPO_URL" "$APP_DIR"
fi
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# ── 7. Install Node deps ─────────────────────────────────────────────────
log "Installing Node dependencies (production only)..."
cd "$APP_DIR"
# Install without electron/robotjs (server doesn't need them)
sudo -u "$APP_USER" npm install --omit=dev --ignore-scripts 2>&1 | grep -v "^npm warn" || true

# ── 8. Create required directories ──────────────────────────────────────
log "Creating logs and data directories..."
sudo -u "$APP_USER" mkdir -p "$APP_DIR/logs" "$APP_DIR/data" "$APP_DIR/backups"

# ── 9. .env setup ────────────────────────────────────────────────────────
if [ ! -f "$APP_DIR/.env" ]; then
    warn ".env not found — copying template. EDIT IT BEFORE STARTING."
    sudo -u "$APP_USER" cp "$APP_DIR/.env.example" "$APP_DIR/.env"
    warn ">>> Edit $APP_DIR/.env now and re-run: bash $APP_DIR/deploy/start-production.sh"
fi

# ── 10. Firewall ─────────────────────────────────────────────────────────
log "Configuring UFW firewall..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp    comment "SSH"
ufw allow 80/tcp    comment "HTTP (certbot + redirect)"
ufw allow 443/tcp   comment "HTTPS"
# Port 5050 is NOT opened — nginx proxies it internally
ufw --force enable
ufw status

# ── 11. Nginx config ─────────────────────────────────────────────────────
log "Installing nginx config (domain placeholder — https-setup.sh will substitute it)..."
cp "$APP_DIR/deploy/nginx-jarvis.conf" /etc/nginx/sites-available/jarvis
ln -sf /etc/nginx/sites-available/jarvis /etc/nginx/sites-enabled/jarvis
rm -f /etc/nginx/sites-enabled/default  # remove nginx default page
nginx -t && systemctl reload nginx || warn "Nginx reload failed — run 'nginx -t' to debug"

# ── 12. PM2 startup ──────────────────────────────────────────────────────
log "Configuring PM2 startup on reboot..."
env PATH="$PATH:/usr/bin" pm2 startup systemd -u "$APP_USER" --hp "/home/$APP_USER" | tail -1 | bash || true

# ── Done ─────────────────────────────────────────────────────────────────
echo ""
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log " VPS setup complete."
log ""
warn " NEXT STEPS:"
warn " 1. Edit $APP_DIR/.env — add your API keys and set BASE_URL"
warn " 2. Edit /etc/nginx/sites-available/jarvis — set your domain"
warn " 3. Run: sudo certbot --nginx -d yourdomain.com"
warn " 4. Run: bash $APP_DIR/deploy/start-production.sh"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
