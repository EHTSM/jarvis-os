"use strict";
/**
 * filesystemGuard — path-based filesystem access control.
 *
 * checkPath(filePath, mode)  → { allowed, reason }
 *   mode: "read" | "write" | "delete"
 *
 * addSafeZone(dir)           — always allowed (read priority override)
 * addRestrictedZone(dir)     — always denied for all modes
 * addReadOnlyZone(dir)       — reads allowed, writes/deletes denied
 * reset()                    — restore defaults
 */

const path = require("path");

const DEFAULT_RESTRICTED = [
    ".env", ".env.local", ".env.production", ".env.staging",
    ".ssh", ".gnupg", "secrets",
    "/etc/passwd", "/etc/shadow", "/etc/hosts",
    "id_rsa", "id_ecdsa", "id_ed25519", "private_key",
];

let _restricted  = new Set();
let _safeZones   = new Set();
let _readOnly    = new Set();

function _init() {
    _restricted.clear();
    for (const p of DEFAULT_RESTRICTED) _restricted.add(path.normalize(p));
}
_init();

function checkPath(filePath, mode = "read") {
    if (!filePath) return { allowed: false, reason: "empty_path" };
    const normalized = path.normalize(filePath);
    const lower      = normalized.toLowerCase();

    // Safe zones: reads always pass (writes still checked)
    for (const z of _safeZones) {
        const zn = path.normalize(z);
        if (normalized.startsWith(zn) || normalized === zn) {
            if (mode === "read") return { allowed: true, reason: "safe_zone" };
        }
    }

    // Restricted zones: always denied
    for (const z of _restricted) {
        const zn = path.normalize(z).toLowerCase();
        if (lower.includes(zn) || path.basename(lower) === zn) {
            return { allowed: false, reason: `restricted: ${z}` };
        }
    }

    // Read-only zones: deny writes and deletes
    if (mode === "write" || mode === "delete") {
        for (const z of _readOnly) {
            const zn = path.normalize(z);
            if (normalized.startsWith(zn) || normalized === zn) {
                return { allowed: false, reason: `read_only_zone: ${z}` };
            }
        }
    }

    return { allowed: true, reason: "no_restrictions" };
}

function addSafeZone(dir)       { _safeZones.add(path.normalize(dir)); }
function addRestrictedZone(dir) { _restricted.add(path.normalize(dir)); }
function addReadOnlyZone(dir)   { _readOnly.add(path.normalize(dir)); }

function reset() {
    _safeZones.clear();
    _readOnly.clear();
    _init();
}

module.exports = {
    checkPath,
    addSafeZone, addRestrictedZone, addReadOnlyZone,
    reset,
    DEFAULT_RESTRICTED,
};
