# Nginx Static Serving Audit

## Configuration Overview
- **Config file**: `deploy/nginx-jarvis.conf`
- **Root directive**: `root /opt/jarvis-os/frontend/build;` (updated to match VPS install path).
- **Static assets handling**:
  - `/static/` – expires 1y, `Cache‑Control: public, immutable`.
  - Image/font assets – expires 30d, `Cache‑Control: public`.
- **Gzip** enabled for common text types.
- **SPA fallback**: `try_files $uri $uri/ /index.html;` ensures React router works.

## Risks & Findings
1. **Root path mismatch** (originally `/var/www/jarvis/...`) would have served the wrong directory, potentially exposing the project root and serving outdated assets.
2. **Cache headers** are appropriate for hashed filenames but can cause browsers to keep stale files if the hash does not change (i.e., developers modified assets without changing filename).
3. No additional CDN; any client‑side caching relies solely on these headers.
4. No explicit cache‑busting for `index.html`; browsers may cache the HTML entry point. Consider adding `Cache‑Control: no‑cache, no‑store` for the root location.

## Recommendations
- Keep the `root` set to `/opt/jarvis-os/frontend/build`.
- Ensure the build process generates hashed filenames for all assets (CRA does this by default).
- Add `add_header Cache‑Control "no‑cache, no‑store";` for the `/` location to prevent stale `index.html`.
- Verify after each deployment that the served asset hashes match the local build.
