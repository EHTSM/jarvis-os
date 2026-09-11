"use strict";
/**
 * Vault Security Hardening — Mandatory Proof 10: Electron/IPC vault
 * exposure boundary.
 *
 * Cannot spin up a real Electron renderer/main process pair in this test
 * runtime, so this verifies the REAL source of electron/main.cjs,
 * electron/preload.cjs, and frontend/src/_client.js structurally — the
 * same files that would be loaded by a real `electron .` run — proving
 * the exact boundary claims rather than asserting behavior no code
 * backs. Does not redesign Electron (per this mission's explicit
 * constraint) — documents and confirms the existing boundary.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const MAIN_SRC    = fs.readFileSync(path.join(__dirname, "../../electron/main.cjs"), "utf8");
const PRELOAD_SRC  = fs.readFileSync(path.join(__dirname, "../../electron/preload.cjs"), "utf8");
const CLIENT_SRC   = fs.readFileSync(path.join(__dirname, "../../frontend/src/_client.js"), "utf8");

describe("MANDATORY PROOF 10 — Electron/IPC vault exposure boundary", () => {
    it("no IPC handler in electron/main.cjs touches secretVault.cjs or exposes a raw credential", () => {
        assert.ok(!MAIN_SRC.includes("secretVault"), "electron/main.cjs must never require secretVault.cjs directly");
        const ipcHandleNames = [...MAIN_SRC.matchAll(/ipcMain\.handle\("([^"]+)"/g)].map(m => m[1]);
        assert.ok(ipcHandleNames.length > 20, "sanity check — main.cjs genuinely registers many IPC handlers");
        const vaultLikeHandlers = ipcHandleNames.filter(n => /vault|secret|credential/i.test(n));
        assert.equal(vaultLikeHandlers.length, 0, `no IPC channel name may resemble a direct vault/secret/credential accessor (found: ${JSON.stringify(vaultLikeHandlers)})`);
    });

    it("preload.cjs never exposes process.env or JWT_SECRET to the renderer", () => {
        assert.ok(!PRELOAD_SRC.includes("process.env"), "preload.cjs must never bridge process.env into window.electronAPI — the renderer must never see JWT_SECRET or any server-side secret");
        assert.ok(!PRELOAD_SRC.toUpperCase().includes("JWT_SECRET"), "preload.cjs must never reference JWT_SECRET");
    });

    it("the generic api-request IPC proxy never forwards renderer cookies/credentials (withCredentials:false) — it cannot be used to smuggle authenticated vault calls", () => {
        const apiRequestMatch = MAIN_SRC.match(/ipcMain\.handle\("api-request"[\s\S]*?\n\}\);/);
        assert.ok(apiRequestMatch, "api-request handler must exist");
        assert.ok(apiRequestMatch[0].includes("withCredentials: false"), "the generic api-request IPC proxy must never forward credentials — the renderer's real authenticated calls go through its own fetch(), not this proxy");
    });

    it("the frontend's real API client (_client.js) uses the renderer's own fetch() with credentials:'include', NOT the IPC proxy — vault routes are reached the same authenticated way in Electron as in a browser", () => {
        const fetchMatch = CLIENT_SRC.match(/export async function _fetch[\s\S]*?\n\}/);
        assert.ok(fetchMatch, "_fetch must exist");
        assert.ok(fetchMatch[0].includes('credentials: "include"'), "_fetch must use real cookie-based credentials, matching browser auth — not routed through an unauthenticated IPC bridge");
        assert.ok(!fetchMatch[0].includes("electronAPI"), "_fetch's core request path must not special-case Electron to bypass authentication");
    });

    it("fs-read-file/fs-write-file IPC handlers are path-restricted (not arbitrary filesystem access) — defense-in-depth note: allow-roots include the user's home directory, which in a dev checkout also contains this project's data/ folder (AES-256-GCM ciphertext only, never plaintext, since JWT_SECRET is never bridged to the renderer per the prior test)", () => {
        const isSafePathMatch = MAIN_SRC.match(/function _isSafePath[\s\S]*?\n\}/);
        assert.ok(isSafePathMatch, "_isSafePath must exist as a real path-restriction function, not an unrestricted fs bridge");
        assert.ok(MAIN_SRC.includes("_FS_ALLOW_ROOTS"), "fs IPC handlers must consult a real allow-list, not accept arbitrary absolute paths");
    });
});
