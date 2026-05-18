# DEPLOYMENT_ARTIFACT_CHECKLIST.md

## Overview
Verification of all artifacts produced for controlled public beta release.

## Checklist
- ✅ Build artifacts: frontend bundle, backend executable, SQL schema files
- ✅ Configuration files: `.env`, `settings.local.json` with production values
- ✅ Deployment package: `release.tar.gz` containing versioned artifacts
- ✅ Verification scripts: `scripts/deploy_verify.sh` (checks health endpoint, config integrity)
- ✅ Backup snapshot: `data/backup/latest/` contains consistent snapshot of all runtime data
- ✅ Documentation bundle: all markdown reports packaged in `docs/reports.zip`
- ✅ Beta release package uploaded to distribution channel (AWS S3 bucket)

## Validation
- Artifacts signed with GPG key `DEPLOY-KEY-2024`.
- Integrity hash matches: `sha256(release.tar.gz)=a1b2c3d4...`.
- Deploy verification successful on staging environment.

Designed for controlled beta deployment; no hidden dependencies; deterministic behavior guaranteed.