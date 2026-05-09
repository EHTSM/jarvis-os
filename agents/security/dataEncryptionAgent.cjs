"use strict";
const crypto = require("crypto");
const { uid, NOW, securityLog, ok, fail } = require("./_securityStore.cjs");
const AGENT = "dataEncryptionAgent";

const ALGORITHMS = {
    aes256gcm:  { name:"AES-256-GCM",  keyBits:256, ivBytes:12, tagBytes:16, recommended:true,  use:"General purpose, authenticated encryption" },
    aes256cbc:  { name:"AES-256-CBC",  keyBits:256, ivBytes:16, tagBytes:0,  recommended:false, use:"Legacy systems — prefer GCM" },
    chacha20:   { name:"ChaCha20-Poly1305", keyBits:256, recommended:true,   use:"Mobile/embedded, software encryption" }
};

const HASH_ALGORITHMS = {
    sha256:    { bits:256, recommended:true,  use:"File integrity, checksums" },
    sha512:    { bits:512, recommended:true,  use:"Password hashing (with PBKDF2)" },
    sha1:      { bits:160, recommended:false, use:"Legacy — do not use for new systems" },
    md5:       { bits:128, recommended:false, use:"BROKEN — never use for security" },
    bcrypt:    { bits:"variable", recommended:true, use:"Password hashing (preferred)" }
};

function encryptData({ userId, plaintext, purpose = "general" }) {
    if (!userId || !plaintext) return fail(AGENT, "userId and plaintext required");
    if (plaintext.length > 100000) return fail(AGENT, "Payload too large for in-memory encryption (>100KB)");

    securityLog(AGENT, userId, "data_encrypted", { purpose, size: plaintext.length }, "INFO");

    const key    = crypto.randomBytes(32);
    const iv     = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const enc    = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag    = cipher.getAuthTag();

    return ok(AGENT, {
        id:          uid("enc"),
        algorithm:   "AES-256-GCM",
        encrypted:   enc.toString("base64"),
        iv:          iv.toString("base64"),
        authTag:     tag.toString("base64"),
        keyHint:     "KEY NOT STORED — store securely in KMS (AWS KMS / GCP KMS / HashiCorp Vault)",
        keyBase64:   key.toString("base64"),
        purpose,
        warning:     "Store the key securely — loss of key means permanent data loss. Use a KMS in production.",
        createdAt:   NOW()
    });
}

function decryptData({ userId, encryptedBase64, ivBase64, authTagBase64, keyBase64 }) {
    if (!userId || !encryptedBase64 || !ivBase64 || !authTagBase64 || !keyBase64) {
        return fail(AGENT, "userId, encryptedBase64, ivBase64, authTagBase64, keyBase64 required");
    }

    securityLog(AGENT, userId, "data_decrypted", {}, "INFO");

    try {
        const key     = Buffer.from(keyBase64, "base64");
        const iv      = Buffer.from(ivBase64, "base64");
        const authTag = Buffer.from(authTagBase64, "base64");
        const enc     = Buffer.from(encryptedBase64, "base64");

        const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAuthTag(authTag);
        const plain    = decipher.update(enc) + decipher.final("utf8");

        return ok(AGENT, { decrypted: plain });
    } catch (e) {
        securityLog(AGENT, userId, "decryption_failed", { error: e.message }, "HIGH");
        return fail(AGENT, "Decryption failed — incorrect key, IV, or data tampered", 400);
    }
}

function hashData({ userId, data, algorithm = "sha256", salt }) {
    if (!userId || !data) return fail(AGENT, "userId and data required");
    const alg = algorithm.toLowerCase();
    if (alg === "md5") return fail(AGENT, "MD5 is broken and insecure — use SHA-256 or bcrypt");

    let hash;
    if (alg === "sha256" || alg === "sha512") {
        const salted = salt ? `${salt}:${data}` : data;
        hash = crypto.createHash(alg).update(salted).digest("hex");
    } else {
        hash = crypto.createHash("sha256").update(data).digest("hex");
    }

    return ok(AGENT, { hash, algorithm: alg, salted: !!salt });
}

function generateKey({ userId, type = "aes256", purpose }) {
    if (!userId) return fail(AGENT, "userId required");
    securityLog(AGENT, userId, "key_generated", { type, purpose }, "INFO");

    if (type === "aes256")   return ok(AGENT, { key: crypto.randomBytes(32).toString("base64"), type:"AES-256", bits:256, purpose, warning:"Store in KMS — never in code or env files" });
    if (type === "rsa2048")  return ok(AGENT, { ...crypto.generateKeyPairSync("rsa", { modulusLength:2048, publicKeyEncoding:{type:"spki",format:"pem"}, privateKeyEncoding:{type:"pkcs8",format:"pem"} }), purpose });
    if (type === "ecdsa256") return ok(AGENT, { ...crypto.generateKeyPairSync("ec",  { namedCurve:"P-256",  publicKeyEncoding:{type:"spki",format:"pem"}, privateKeyEncoding:{type:"pkcs8",format:"pem"} }), purpose });

    return fail(AGENT, `Unknown type. Options: aes256, rsa2048, ecdsa256`);
}

function getAlgorithmGuide() { return ok(AGENT, { encryption: ALGORITHMS, hashing: HASH_ALGORITHMS }); }

module.exports = { encryptData, decryptData, hashData, generateKey, getAlgorithmGuide };
