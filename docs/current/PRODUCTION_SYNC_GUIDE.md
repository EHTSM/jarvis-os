# Production Synchronization & Safety Guide

This document defines the deterministic workflow for ensuring the production Jarvis frontend accurately reflects the stable local state.

## 1. Deterministic Deployment Flow
To prevent stale-build risks, always follow this sequence on the VPS:

1.  **Update Source**: `bash deploy/update.sh`
    - *Action*: Pulls code, installs dependencies, and rebuilds the frontend (if `BASE_URL` is set to a domain).
2.  **Verify Environment**: `cat .env | grep BASE_URL`
    - *Requirement*: Must be `https://yourdomain.com` (not localhost).
3.  **Sync Frontend (If Environment Changed)**:
    - If you just updated `.env` or ran `https-setup.sh`, **force a rebuild**:
      ```bash
      REACT_APP_API_URL="https://yourdomain.com" npm run build:frontend
      ```
4.  **Restart Runtime**: `pm2 restart jarvis-os`

## 2. Preventing Accidental Stale Builds
- **Localhost Guard**: The `deploy/start-production.sh` script will automatically abort if `BASE_URL` is still set to `localhost`.
- **Manual Override**: If you suspect a stale build, use the `--build-frontend` flag:
  ```bash
  bash deploy/start-production.sh --build-frontend
  ```

## 3. Production Hard Requirements
- **HTTPS Enforcement**: The `jarvis_auth` cookie is marked `secure: true` in production. The dashboard **will not work** over plain HTTP.
- **Nginx Root Alignment**: Ensure `/etc/nginx/sites-available/jarvis` points its `root` directive to `/opt/jarvis-os/frontend/build` (the default installation path).

## 4. Verification Checklist
After every deployment, verify synchronization:
1.  **Health Probe**: `curl https://yourdomain.com/health` (Should return `status: ok`).
2.  **Asset Probe**: View source on the login page and verify the `<script>` tag points to the latest hash in `frontend/build/static/js/`.
3.  **Auth Probe**: Ensure login works. If login fails with "Invalid Token" or no cookie is set, verify HTTPS status and `BASE_URL` consistency.
