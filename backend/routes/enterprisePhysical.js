"use strict";
/**
 * Enterprise & Physical Integration Mission — Module 6: Physical Infrastructure
 * Prefix: /enterprise/physical/*
 *
 * Backend half of the Electron-side hardware/local-file features (printer,
 * scanner hand-off, webcam/mic, local folder sync) added in electron/main.cjs
 * + electron/preload.cjs. Printer/scanner/webcam/mic are entirely local to
 * the Electron process (no backend call needed — the OS grants/denies
 * hardware access directly) except for one thing that DOES need a server
 * endpoint: folder sync uploads local files into the org's existing cloud
 * storage, so this file exists to receive those uploads.
 *
 * Reuses storageService.cjs (already used by Company Factory's asset
 * upload route, companyFactory.js:337-370) with the identical
 * org/${orgId}/... key-scoping convention — no new storage path invented.
 * Any org member may sync their own local files in (requireOrgMember,
 * not an owner-only action — this is "upload my files," not "change org
 * config").
 */

const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const { attachOrg, requireOrgMember } = require("../middleware/orgMiddleware.cjs");
const rateLimiter = require("../middleware/rateLimiter");

// Real storageService.cjs upload (S3/R2 PUT) triggered by base64 payload —
// zero rate limit meant an authenticated org member could flood external
// storage with repeated large uploads (cost + concurrency exhaustion).
const _uploadRL = rateLimiter(20, 60_000, "enterprise-physical-folder-sync-upload");

const _try = fn => { try { return fn(); } catch { return null; } };
const _store = () => _try(() => require("../services/storageService.cjs"));

const MAX_SYNC_FILE_BYTES = 25 * 1024 * 1024; // 25MB per file, matches typical single-doc/image sync use

router.use("/enterprise/physical", requireAuth, attachOrg, requireOrgMember);

// POST /enterprise/physical/folder-sync/upload
// Body: { relativePath, base64, contentType }
// relativePath is the file's path relative to the user's chosen local sync
// root (assigned client-side by the Electron folder-sync watcher) — used
// only as the object-storage key suffix, never resolved against a real
// filesystem path server-side.
router.post("/enterprise/physical/folder-sync/upload", _uploadRL, async (req, res) => {
  const { relativePath, base64, contentType } = req.body || {};
  if (!relativePath || typeof relativePath !== "string") return res.status(400).json({ ok: false, error: "relativePath required" });
  if (!base64 || typeof base64 !== "string") return res.status(400).json({ ok: false, error: "base64 required" });
  // Reject path traversal / absolute paths in the key suffix — this is a
  // storage key, not a filesystem path, but keeping it relative-looking
  // prevents surprising key collisions across orgs via "../other-org/x".
  if (relativePath.includes("..") || relativePath.startsWith("/")) {
    return res.status(400).json({ ok: false, error: "relativePath must not contain '..' or start with '/'" });
  }

  const orgId = req.org.id;
  try {
    const provider = _store()?.detectProvider?.();
    if (!provider?.configured) {
      return res.status(503).json({ ok: false, error: "No storage provider configured — set S3_*/R2_* env vars to enable folder sync" });
    }
    const buffer = Buffer.from(base64, "base64");
    if (buffer.length > MAX_SYNC_FILE_BYTES) {
      return res.status(413).json({ ok: false, error: `File exceeds the ${MAX_SYNC_FILE_BYTES / 1024 / 1024}MB folder-sync limit` });
    }
    const scopedKey = `org/${orgId}/folder-sync/${relativePath}`;
    const result = await _store().upload(scopedKey, buffer, contentType || "application/octet-stream");
    if (!result?.ok) return res.status(502).json({ ok: false, error: "upload failed: " + result?.error });
    res.json({ ok: true, orgId, key: scopedKey, url: result.url, bytes: buffer.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /enterprise/physical/folder-sync/status — whether a storage provider
// is even configured, so the Electron client can show a real "not
// configured" state instead of silently failing every upload.
router.get("/enterprise/physical/folder-sync/status", (req, res) => {
  const provider = _store()?.detectProvider?.();
  res.json({ ok: true, orgId: req.org.id, storageConfigured: !!provider?.configured, provider: provider?.provider || null });
});

module.exports = router;
