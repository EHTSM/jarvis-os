# VPS Frontend Status

## Current Build Directory
- Expected path on VPS (as configured in `setup-vps.sh`): `/opt/jarvis-os/frontend/build`
- Nginx `root` now points to this directory.

## Deployment Flow
1. **Local Build**: `npm run build:frontend` creates `frontend/build`.
2. **VPS Sync**: `deploy/update.sh` runs on the VPS, pulls the latest repo, installs deps, and runs the build step (`REACT_APP_API_URL="${BASE_URL}" npm run build:frontend`).
3. **PM2 Reload**: After building, the script reloads the `jarvis-os` process (`pm2 reload jarvis-os`). The Express server serves static files from `../frontend/build`.

## Observed Issue
- The live site is serving a different JS/CSS bundle (`main.d844130e.js`, `main.b715d0c1.css`), indicating the VPS has not run the latest build.
- Likely cause: `deploy/update.sh` has not been executed after recent code changes, or the VPS copy of the repo is out‑of‑date.

## Next Steps
- SSH into the VPS (`ssh jarvis@<vps-ip>`).
- Navigate to `/opt/jarvis-os` and run `bash deploy/update.sh` (or `bash deploy/start-production.sh --build-frontend`).
- Verify the timestamps of files in `/opt/jarvis-os/frontend/build/static/js/` and compare the hash with the local build.
- Check PM2 status (`pm2 status jarvis-os`) and ensure the process restarted without errors.
