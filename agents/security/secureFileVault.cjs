"use strict";
const crypto  = require("crypto");
const path    = require("path");
const fs      = require("fs");
const { load, flush, uid, NOW, securityLog, ok, fail, blocked } = require("./_securityStore.cjs");
const AGENT   = "secureFileVault";

const VAULT_DIR        = path.join(__dirname, "../../data/security/vault");
const MAX_FILE_BYTES   = 50 * 1024 * 1024; // 50MB per file
const ALLOWED_EXT      = new Set([".pdf",".txt",".docx",".xlsx",".csv",".json",".png",".jpg",".jpeg",".mp4",".zip"]);
const DANGEROUS_EXT    = new Set([".exe",".bat",".sh",".cmd",".vbs",".ps1",".dll",".scr"]);

function _ensureVaultDir() {
    if (!fs.existsSync(VAULT_DIR)) fs.mkdirSync(VAULT_DIR, { recursive: true });
}

function _encrypt(content, key) {
    const iv         = crypto.randomBytes(12);
    const keyBuf     = Buffer.from(key, "hex");
    const cipher     = crypto.createCipheriv("aes-256-gcm", keyBuf, iv);
    const encrypted  = Buffer.concat([cipher.update(content), cipher.final()]);
    const authTag    = cipher.getAuthTag();
    return { iv: iv.toString("hex"), encrypted: encrypted.toString("hex"), authTag: authTag.toString("hex") };
}

function _decrypt(ivHex, encryptedHex, authTagHex, key) {
    const keyBuf    = Buffer.from(key, "hex");
    const iv        = Buffer.from(ivHex, "hex");
    const encrypted = Buffer.from(encryptedHex, "hex");
    const authTag   = Buffer.from(authTagHex, "hex");
    const decipher  = crypto.createDecipheriv("aes-256-gcm", keyBuf, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

function storeFile({ userId, fileName, fileContent, encryptionKey, tags = [], accessList = [] }) {
    if (!userId || !fileName || !fileContent || !encryptionKey) {
        return fail(AGENT, "userId, fileName, fileContent, and encryptionKey required");
    }
    if (encryptionKey.length !== 64) return fail(AGENT, "encryptionKey must be 64-character hex (AES-256)");

    const ext = path.extname(fileName).toLowerCase();
    if (DANGEROUS_EXT.has(ext)) return blocked(AGENT, `File type "${ext}" is not permitted in the vault`, "HIGH");

    const contentBuf = Buffer.isBuffer(fileContent) ? fileContent : Buffer.from(fileContent);
    if (contentBuf.length > MAX_FILE_BYTES) return blocked(AGENT, `File exceeds maximum size of ${MAX_FILE_BYTES / 1024 / 1024}MB`, "MEDIUM");

    const fileId      = uid("vf");
    const { iv, encrypted, authTag } = _encrypt(contentBuf, encryptionKey);
    const hash        = crypto.createHash("sha256").update(contentBuf).digest("hex");

    _ensureVaultDir();
    const vaultPath = path.join(VAULT_DIR, `${fileId}.enc`);
    fs.writeFileSync(vaultPath, JSON.stringify({ iv, encrypted, authTag }), "utf8");

    const index = load(userId, "vault_index", []);
    const meta  = {
        id: fileId, fileName, ext,
        hash, sizeBytes: contentBuf.length,
        tags, accessList: [userId, ...accessList],
        storedAt: NOW(), lastAccessed: null,
        vaultPath: `${fileId}.enc`
    };
    index.push(meta);
    flush(userId, "vault_index", index);

    securityLog(AGENT, userId, "file_stored", { fileId, fileName, sizeBytes: contentBuf.length, hash }, "INFO");
    return ok(AGENT, { fileId, fileName, hash, sizeBytes: contentBuf.length, encrypted: true, storedAt: meta.storedAt });
}

function retrieveFile({ userId, fileId, encryptionKey }) {
    if (!userId || !fileId || !encryptionKey) return fail(AGENT, "userId, fileId, and encryptionKey required");
    if (encryptionKey.length !== 64) return fail(AGENT, "encryptionKey must be 64-character hex (AES-256)");

    const index = load(userId, "vault_index", []);
    const meta  = index.find(f => f.id === fileId);
    if (!meta) return fail(AGENT, `File ${fileId} not found in vault`);

    if (!meta.accessList.includes(userId)) {
        securityLog(AGENT, userId, "unauthorized_vault_access", { fileId, fileName: meta.fileName }, "CRITICAL");
        return blocked(AGENT, `Access denied to file ${fileId}`, "CRITICAL");
    }

    _ensureVaultDir();
    const vaultPath = path.join(VAULT_DIR, meta.vaultPath);
    if (!fs.existsSync(vaultPath)) return fail(AGENT, `Vault file not found on disk for ${fileId}`);

    let decrypted;
    try {
        const { iv, encrypted, authTag } = JSON.parse(fs.readFileSync(vaultPath, "utf8"));
        decrypted = _decrypt(iv, encrypted, authTag, encryptionKey);
    } catch {
        securityLog(AGENT, userId, "decryption_failed", { fileId }, "HIGH");
        return blocked(AGENT, "Decryption failed — wrong key or tampered file", "HIGH");
    }

    meta.lastAccessed = NOW();
    flush(userId, "vault_index", index);
    securityLog(AGENT, userId, "file_retrieved", { fileId, fileName: meta.fileName }, "INFO");

    return ok(AGENT, { fileId, fileName: meta.fileName, content: decrypted.toString("utf8"), sizeBytes: decrypted.length, retrievedAt: NOW() });
}

function deleteFile({ userId, fileId, confirm }) {
    if (!userId || !fileId) return fail(AGENT, "userId and fileId required");
    if (!confirm) return fail(AGENT, "Pass confirm:true to permanently delete a vault file");

    const index = load(userId, "vault_index", []);
    const idx   = index.findIndex(f => f.id === fileId);
    if (idx === -1) return fail(AGENT, `File ${fileId} not found`);
    if (!index[idx].accessList.includes(userId)) {
        return blocked(AGENT, "You do not have permission to delete this file", "HIGH");
    }

    const meta      = index.splice(idx, 1)[0];
    const vaultPath = path.join(VAULT_DIR, meta.vaultPath);
    if (fs.existsSync(vaultPath)) fs.unlinkSync(vaultPath);

    flush(userId, "vault_index", index);
    securityLog(AGENT, userId, "file_deleted", { fileId, fileName: meta.fileName }, "HIGH");
    return ok(AGENT, { deleted: true, fileId, fileName: meta.fileName });
}

function listVaultFiles({ userId }) {
    if (!userId) return fail(AGENT, "userId required");
    const index = load(userId, "vault_index", []);
    const files = index.map(f => ({ id: f.id, fileName: f.fileName, sizeBytes: f.sizeBytes, tags: f.tags, storedAt: f.storedAt, lastAccessed: f.lastAccessed }));
    return ok(AGENT, { total: files.length, files });
}

function shareFileAccess({ userId, fileId, shareWithUserId }) {
    if (!userId || !fileId || !shareWithUserId) return fail(AGENT, "userId, fileId, shareWithUserId required");

    const index = load(userId, "vault_index", []);
    const meta  = index.find(f => f.id === fileId);
    if (!meta) return fail(AGENT, `File ${fileId} not found`);
    if (!meta.accessList.includes(userId)) return blocked(AGENT, "Cannot share a file you don't own", "HIGH");

    if (!meta.accessList.includes(shareWithUserId)) meta.accessList.push(shareWithUserId);
    flush(userId, "vault_index", index);

    securityLog(AGENT, userId, "file_access_shared", { fileId, sharedWith: shareWithUserId }, "HIGH");
    return ok(AGENT, { fileId, sharedWith: shareWithUserId, accessList: meta.accessList });
}

module.exports = { storeFile, retrieveFile, deleteFile, listVaultFiles, shareFileAccess };
