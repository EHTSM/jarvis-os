# Operational Observations - Nginx Configuration (2026-05-16)

- The Nginx config for Jarvis OS is present at `deploy/nginx-jarvis.conf`.
- All essential blocks (HTTP→HTTPS redirect, HTTPS server, upstream, static asset handling, SSE, API routing, and React SPA fallback) are defined.
- Rate limiting is configured via `jarvis_limit` (30 req/s, burst 60) and applied to relevant locations.
- SSL certificate directives are commented out pending execution of `https-setup.sh`; this aligns with the pre‑enable instructions.
- Static file `root` points to `/opt/jarvis-os/frontend/build`, which matches the typical deployment layout.
- SSE endpoint disables buffering and sets a long `proxy_read_timeout` (3600s), ensuring event streams remain alive.
- No misconfigurations or missing required directives were detected.
- **Action required**: After obtaining TLS certificates with `https-setup.sh`, uncomment the SSL lines and reload Nginx.

_No further changes are needed at this time._