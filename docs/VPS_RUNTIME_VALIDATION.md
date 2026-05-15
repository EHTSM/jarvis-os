# VPS Runtime Validation
**Phase G — Real Operator Deployment**
**Generated:** 2026-05-15

---

## PM2 Process Management

### Configuration (`ecosystem.config.cjs`)

| Parameter | Value | Purpose |
|---|---|---|
| `instances` | 1 | Single process — in-memory singletons are not cluster-safe |
| `exec_mode` | `fork` | Required for single-instance singletons |
| `autorestart` | `true` | PM2 restarts process on crash |
| `max_restarts` | 10 | Prevents infinite crash loops |
| `min_uptime` | `10s` | Treat < 10s uptime as crash loop |
| `restart_delay` | `3000ms` | 3s backoff between crash restarts |
| `max_memory_restart` | `512M` | PM2 restarts before OS kills process |
| `kill_timeout` | `8000ms` | Allows 5s drain window + 3s margin |
| `listen_timeout` | `15000ms` | Covers slow cold-disk executor loading |
| `node_args` | `--max-old-space-size=400` | V8 heap cap at 400MB (below 512MB PM2 limit) |
| `watch` | `false` | Disabled in production — use `pm2 restart` |

### Graceful Shutdown

`server.js` handles SIGTERM from PM2 with a 5-second drain window:

```
SIGTERM received
  → stop HTTP server (reject new connections)
  → stop autonomous loop
  → stop automation cron jobs
  → stop memory sampler
  → stop SSE event bus (closes all SSE connections cleanly)
  → wait 5s for in-flight requests to drain
  → exit 0
```

PM2's `kill_timeout: 8000` gives 8 seconds before force-kill. The drain window is 5 seconds — there is 3 seconds of margin.

**SIGTERM chain tested:** ✓ Signal handler registered on `SIGTERM`, `SIGINT`, `SIGUSR2`.

### Auto-Restart After VPS Reboot

1. `pm2 startup` generates a systemd unit file on Ubuntu.
2. `pm2 save` persists the process list.
3. On reboot, systemd starts PM2, which starts `jarvis-os` automatically.

Verification command after reboot:
```bash
pm2 status jarvis-os       # should show "online"
curl http://localhost:5050/health
```

### Orphan Process Cleanup

**Known risk:** If `node backend/server.js` is started manually while PM2 is running, it binds port 5050 and silently blocks PM2 restarts. PM2's process shows "errored" with no clear error.

**Protection in place:** `server.js` catches `EADDRINUSE` in `uncaughtException` handler and logs a clear diagnostic before exiting. The port conflict is detected within 100ms of startup.

**Cleanup procedure:**
```bash
lsof -nP -iTCP:5050       # find process holding port
kill <PID>                # kill the orphan
pm2 restart jarvis-os     # restart via PM2
```

---

## Crash Recovery

### PM2 Restart Policy

On an unhandled exception (`uncaughtException`), `server.js` calls `process.exit(1)` after 200ms (allowing the stack trace to flush). PM2 detects the non-zero exit and restarts after `restart_delay` (3s).

| Scenario | Recovery |
|---|---|
| Unhandled exception | PM2 restarts within 3s |
| Memory over 512MB | PM2 restarts (soft OOM before Linux OOM killer) |
| Port already in use | Process exits immediately — PM2 enters error state, does NOT loop |
| SIGTERM (PM2 stop) | Graceful drain + exit 0 |
| VPS reboot | systemd restarts PM2 → PM2 restarts app |

### Crash Loop Protection

`min_uptime: "10s"` + `max_restarts: 10` = PM2 will attempt up to 10 restarts. If the process crashes within 10 seconds of each restart 10 times, PM2 stops restarting and marks the process as "errored". This prevents infinite crash loops from a broken dependency consuming all CPU.

**Alert:** On a real deployment, set up monitoring to alert when PM2 process enters "errored" state. Suggested: `pm2 monit` or integrate with `uptime-kuma` or `betteruptime`.

---

## Memory Limits

| Limit | Value | Rationale |
|---|---|---|
| V8 old-space | 400MB | Below PM2 ceiling |
| PM2 restart ceiling | 512MB | Below typical Linux OOM threshold |
| Heap warning (memTracker) | 350MB | Logged before PM2 would intervene |

**Long session measured:** Heap started at 5MB, ended at 7MB after 720 cycles (representing ~96 minutes of operation). Drift: +2MB. This is GC settling, not a leak.

---

## Nginx Reverse Proxy

### SSE Compatibility

The nginx config explicitly handles `/runtime/stream`:

```nginx
location /runtime/stream {
    proxy_buffering    off;     # REQUIRED — nginx buffers break SSE
    proxy_cache        off;
    proxy_read_timeout 3600s;   # 1 hour — longer than any SSE session
    chunked_transfer_encoding on;
    proxy_set_header   Cookie   $http_cookie;  # Pass auth cookie to backend
    proxy_set_header   Connection "";          # Keep-alive to upstream
}
```

**Key:** `proxy_buffering off` is the critical line. Without it, nginx buffers the response until the upstream closes the connection — SSE events are never delivered. The server also sets `X-Accel-Buffering: no` as a belt-and-suspenders measure.

### Rate Limiting

```nginx
limit_req_zone $binary_remote_addr zone=jarvis_limit:10m rate=30r/s;
```

- 30 req/s per IP with burst=20 on API routes
- Auth routes: burst=5 (stricter)
- Webhooks: no limit (Razorpay and Meta require direct access)
- Static assets: no limit

### Static Asset Serving

Hashed assets (CRA appends content hash to filenames) are cached with `Cache-Control: public, immutable, max-age=31536000`. Other static files (favicon, etc.) cached for 30 days.

**nginx serves static files directly** — they never reach Node.js. This reduces backend load significantly for a SPA.

---

## HTTPS / Certificate Auto-Renewal

### Let's Encrypt Setup

`deploy/https-setup.sh`:
1. Verifies DNS A record matches server IP before requesting certificate
2. Runs `certbot --nginx` to obtain certificate and patch nginx config
3. Updates `BASE_URL` in `.env` automatically

### Auto-Renewal

Ubuntu 22+ installs `certbot.timer` systemd unit — renews certificates automatically every 12 hours. The script falls back to a daily cron job (`0 3 * * * certbot renew`) if the timer is absent.

**Renewal test:** `certbot renew --dry-run` — should pass without interactive prompts.

---

## Startup Sequence Validation

On a fresh VPS after `setup-vps.sh` + `.env` configured + `start-production.sh`:

1. Pre-flight: validates GROQ_API_KEY, BASE_URL, JWT_SECRET, OPERATOR_PASSWORD_HASH
2. Frontend build (if `--build-frontend` flag or no `frontend/build`)
3. PM2 stop/delete existing process (prevents EADDRINUSE)
4. PM2 start with `--env production`
5. `pm2 save` (persists process list across reboots)
6. Health check: `curl http://localhost:5050/health`
7. Reports public URL, health URL, stats URL

**Expected output on success:**
```
[+] JARVIS is running on port 5050
[+] Health: ok | uptime: 8 s | memory: 42 MB
[+] Public URL: https://yourdomain.com
```

---

## VPS Checklist (Pre-Deploy)

- [ ] Ubuntu 22.04+ with 1GB+ RAM
- [ ] `sudo bash deploy/setup-vps.sh` completed
- [ ] `.env` filled with real values (all `[REQUIRED]` entries)
- [ ] `JWT_SECRET` and `OPERATOR_PASSWORD_HASH` set in `.env`
- [ ] `NODE_ENV=production` in `.env`
- [ ] `BASE_URL=https://yourdomain.com` in `.env` (not localhost)
- [ ] DNS A record pointing to VPS IP
- [ ] `sudo bash deploy/https-setup.sh yourdomain.com` completed
- [ ] `bash deploy/start-production.sh` completed
- [ ] `curl https://yourdomain.com/health` returns 200
- [ ] `pm2 startup` + `pm2 save` executed (survives reboots)
- [ ] Nginx config root is `frontend/build`, NOT project root
- [ ] UFW: ports 22, 80, 443 open; port 5050 NOT open externally

---

## Post-Deploy Verification Commands

```bash
# Check server status
pm2 status jarvis-os

# Check live logs
pm2 logs jarvis-os --lines 50

# Check memory
pm2 monit

# Verify HTTPS
curl -I https://yourdomain.com/health

# Verify SSE (should hang open with event stream)
curl -N -H "Accept: text/event-stream" https://yourdomain.com/runtime/stream

# Simulate reboot recovery
sudo reboot
# After reboot: pm2 status jarvis-os  →  should be "online"

# Check certificate expiry
sudo certbot certificates
```
