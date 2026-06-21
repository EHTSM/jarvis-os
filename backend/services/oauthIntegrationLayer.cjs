"use strict";
/**
 * OAuthIntegrationLayer — production-ready OAuth 2.0 connectors for
 * Google, GitHub, Slack and Notion.
 *
 * Security model:
 *   - State parameter: cryptographically random, bound to a short-lived
 *     server-side nonce (5-minute TTL) to prevent CSRF.
 *   - Token storage: tokens are AES-256-GCM encrypted at rest in
 *     data/oauth-tokens.json.  The encryption key is derived from
 *     JWT_SECRET (required) so tokens are useless without the server secret.
 *   - Refresh: access tokens are refreshed automatically before expiry.
 *   - Revocation: tokens can be revoked locally and via provider endpoint.
 *
 * Public API:
 *   getAuthUrl(provider, userId, scopes?)  → { url, state }
 *   handleCallback(provider, code, state)  → { userId, tokenId }
 *   getToken(provider, userId)             → TokenRecord (decrypted)
 *   refreshToken(provider, userId)         → TokenRecord
 *   revokeToken(provider, userId)          → { revoked: true }
 *   listConnections(userId?)               → ConnectionRecord[]
 *   getProviderStatus()                    → { [provider]: status }
 *
 * Providers: google | github | slack | notion
 *
 * Required env vars per provider:
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI
 *   GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GITHUB_REDIRECT_URI
 *   SLACK_CLIENT_ID,  SLACK_CLIENT_SECRET,  SLACK_REDIRECT_URI
 *   NOTION_CLIENT_ID, NOTION_CLIENT_SECRET, NOTION_REDIRECT_URI
 */

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");
const https  = require("https");
const http   = require("http");
const logger = require("../utils/logger");
const auditLog = require("../utils/auditLog.cjs");

const TOKENS_FILE  = path.join(__dirname, "../../data/oauth-tokens.json");
const NONCES_FILE  = path.join(__dirname, "../../data/oauth-nonces.json");
const NONCE_TTL_MS = 5 * 60_000;   // 5 minutes

// ── Encryption ──────────────────────────────────────────────────────────
function _encKey() {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error("JWT_SECRET required for OAuth token encryption");
    return crypto.createHash("sha256").update(secret).digest();    // 32-byte AES key
}

function _encrypt(plaintext) {
    const key = _encKey();
    const iv  = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const enc  = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag  = cipher.getAuthTag();
    return iv.toString("hex") + ":" + tag.toString("hex") + ":" + enc.toString("hex");
}

function _decrypt(ciphertext) {
    const key  = _encKey();
    const [ivHex, tagHex, encHex] = ciphertext.split(":");
    const iv   = Buffer.from(ivHex,  "hex");
    const tag  = Buffer.from(tagHex, "hex");
    const enc  = Buffer.from(encHex, "hex");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(enc) + decipher.final("utf8");
}

// ── I/O ─────────────────────────────────────────────────────────────────
function _rj(f, fb) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return fb; } }
function _wj(f, d) {
    const dir = path.dirname(f);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = f + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(d, null, 2));
    fs.renameSync(tmp, f);
}

let _nonces = _rj(NONCES_FILE, {});   // state → { userId, provider, expiresAt }
let _store  = _rj(TOKENS_FILE, {});   // `${provider}:${userId}` → { encrypted }

function _saveNonces() { try { _wj(NONCES_FILE, _nonces); } catch { /* non-fatal */ } }
function _saveStore()  { try { _wj(TOKENS_FILE,  _store);  } catch { /* non-fatal */ } }

// Prune expired nonces periodically
setInterval(() => {
    const now = Date.now();
    let changed = false;
    for (const [k, v] of Object.entries(_nonces)) {
        if (v.expiresAt < now) { delete _nonces[k]; changed = true; }
    }
    if (changed) _saveNonces();
}, 60_000).unref();

// ── Provider config ──────────────────────────────────────────────────────
function _cfg(provider) {
    const E = process.env;
    const configs = {
        google: {
            authUrl:    "https://accounts.google.com/o/oauth2/v2/auth",
            tokenUrl:   "https://oauth2.googleapis.com/token",
            revokeUrl:  "https://oauth2.googleapis.com/revoke",
            userUrl:    "https://www.googleapis.com/oauth2/v3/userinfo",
            clientId:   E.GOOGLE_CLIENT_ID,
            clientSecret: E.GOOGLE_CLIENT_SECRET,
            redirectUri:  E.GOOGLE_REDIRECT_URI || `${E.APP_URL || "http://localhost:5050"}/oauth/google/callback`,
            defaultScopes: ["openid","email","profile","https://www.googleapis.com/auth/gmail.readonly","https://www.googleapis.com/auth/drive.readonly"],
        },
        github: {
            authUrl:    "https://github.com/login/oauth/authorize",
            tokenUrl:   "https://github.com/login/oauth/access_token",
            revokeUrl:  null,   // GitHub: delete installation via API
            userUrl:    "https://api.github.com/user",
            clientId:   E.GITHUB_CLIENT_ID,
            clientSecret: E.GITHUB_CLIENT_SECRET,
            redirectUri:  E.GITHUB_REDIRECT_URI || `${E.APP_URL || "http://localhost:5050"}/oauth/github/callback`,
            defaultScopes: ["read:user","repo","read:org"],
        },
        slack: {
            authUrl:    "https://slack.com/oauth/v2/authorize",
            tokenUrl:   "https://slack.com/api/oauth.v2.access",
            revokeUrl:  "https://slack.com/api/auth.revoke",
            userUrl:    "https://slack.com/api/auth.test",
            clientId:   E.SLACK_CLIENT_ID,
            clientSecret: E.SLACK_CLIENT_SECRET,
            redirectUri:  E.SLACK_REDIRECT_URI || `${E.APP_URL || "http://localhost:5050"}/oauth/slack/callback`,
            defaultScopes: ["channels:read","chat:write","files:write","users:read"],
        },
        notion: {
            authUrl:    "https://api.notion.com/v1/oauth/authorize",
            tokenUrl:   "https://api.notion.com/v1/oauth/token",
            revokeUrl:  null,
            userUrl:    "https://api.notion.com/v1/users/me",
            clientId:   E.NOTION_CLIENT_ID,
            clientSecret: E.NOTION_CLIENT_SECRET,
            redirectUri:  E.NOTION_REDIRECT_URI || `${E.APP_URL || "http://localhost:5050"}/oauth/notion/callback`,
            defaultScopes: ["read_content","update_content","insert_content"],
        },
        microsoft: {
            authUrl:    "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
            tokenUrl:   "https://login.microsoftonline.com/common/oauth2/v2.0/token",
            revokeUrl:  null,
            userUrl:    "https://graph.microsoft.com/v1.0/me",
            clientId:   E.MICROSOFT_CLIENT_ID,
            clientSecret: E.MICROSOFT_CLIENT_SECRET,
            redirectUri:  E.MICROSOFT_REDIRECT_URI || `${E.APP_URL || E.BASE_URL || "http://localhost:5050"}/oauth/microsoft/callback`,
            defaultScopes: ["openid","email","profile","User.Read","offline_access"],
        },
        linkedin: {
            authUrl:    "https://www.linkedin.com/oauth/v2/authorization",
            tokenUrl:   "https://www.linkedin.com/oauth/v2/accessToken",
            revokeUrl:  null,
            userUrl:    "https://api.linkedin.com/v2/userinfo",
            clientId:   E.LINKEDIN_CLIENT_ID,
            clientSecret: E.LINKEDIN_CLIENT_SECRET,
            redirectUri:  E.LINKEDIN_REDIRECT_URL || E.LINKEDIN_REDIRECT_URI || `${E.APP_URL || E.BASE_URL || "http://localhost:5050"}/oauth/linkedin/callback`,
            defaultScopes: ["openid","email","profile"],
        },
    };
    if (!configs[provider]) throw new Error(`Unknown OAuth provider: ${provider}`);
    return configs[provider];
}

// ── HTTP helper ───────────────────────────────────────────────────────────
function _post(url, headers, body) {
    return new Promise((resolve, reject) => {
        const u   = new URL(url);
        const mod = u.protocol === "https:" ? https : http;
        const data = Buffer.from(body);
        const req  = mod.request({
            hostname: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80),
            path: u.pathname + u.search, method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": data.length, Accept: "application/json", ...headers },
        }, res => {
            let raw = "";
            res.on("data", d => raw += d);
            res.on("end", () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
                catch { resolve({ status: res.statusCode, body: raw }); }
            });
        });
        req.on("error", reject);
        req.write(data);
        req.end();
    });
}

function _get(url, headers) {
    return new Promise((resolve, reject) => {
        const u   = new URL(url);
        const mod = u.protocol === "https:" ? https : http;
        const req = mod.request({
            hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: "GET",
            headers: { Accept: "application/json", "User-Agent": "jarvis-os/1.0", ...headers },
        }, res => {
            let raw = "";
            res.on("data", d => raw += d);
            res.on("end", () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
                catch { resolve({ status: res.statusCode, body: raw }); }
            });
        });
        req.on("error", reject);
        req.end();
    });
}

function _urlEncode(obj) {
    return Object.entries(obj).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
}

// ── Token store helpers ──────────────────────────────────────────────────
function _storeKey(provider, userId) { return `${provider}:${userId}`; }

function _saveToken(provider, userId, tokenData) {
    const key      = _storeKey(provider, userId);
    const plain    = JSON.stringify({ ...tokenData, savedAt: new Date().toISOString() });
    _store[key]    = { encrypted: _encrypt(plain), provider, userId, savedAt: new Date().toISOString() };
    _saveStore();
}

function _loadToken(provider, userId) {
    const key  = _storeKey(provider, userId);
    const rec  = _store[key];
    if (!rec) return null;
    try {
        const plain = _decrypt(rec.encrypted);
        return JSON.parse(plain);
    } catch (e) {
        logger.warn(`[OAuth] Token decrypt failed for ${key}: ${e.message}`);
        return null;
    }
}

// ── Public API ────────────────────────────────────────────────────────────

/** Build the provider authorization URL and register a CSRF state nonce. */
function getAuthUrl(provider, userId, scopes) {
    const cfg   = _cfg(provider);
    if (!cfg.clientId) throw new Error(`${provider.toUpperCase()}_CLIENT_ID not set`);
    const state = crypto.randomBytes(24).toString("hex");
    _nonces[state] = { userId, provider, expiresAt: Date.now() + NONCE_TTL_MS };
    _saveNonces();

    const scopeStr = (scopes || cfg.defaultScopes).join(" ");
    const params   = new URLSearchParams({
        client_id:    cfg.clientId,
        redirect_uri: cfg.redirectUri,
        response_type:"code",
        state,
        scope: scopeStr,
        ...(provider === "google"  ? { access_type: "offline", prompt: "consent" } : {}),
        ...(provider === "notion"  ? { owner: "user" } : {}),
    });
    const url = `${cfg.authUrl}?${params.toString()}`;
    auditLog.append({ type: "oauth_url_generated", provider, userId });
    return { url, state };
}

/** Exchange authorization code for tokens. Called by the redirect callback route. */
async function handleCallback(provider, code, state) {
    const nonce = _nonces[state];
    if (!nonce)                     throw new Error("Invalid or expired OAuth state — possible CSRF");
    if (nonce.provider !== provider) throw new Error("State provider mismatch");
    if (Date.now() > nonce.expiresAt) { delete _nonces[state]; _saveNonces(); throw new Error("OAuth state expired"); }
    delete _nonces[state]; _saveNonces();

    const { userId }  = nonce;
    const cfg         = _cfg(provider);
    let tokenData;

    if (provider === "notion") {
        // Notion uses Basic auth for token exchange
        const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");
        const r = await _post(cfg.tokenUrl,
            { Authorization: `Basic ${basic}`, "Content-Type": "application/json" },
            JSON.stringify({ grant_type: "authorization_code", code, redirect_uri: cfg.redirectUri })
        );
        if (!r.body?.access_token) throw new Error(`Notion token exchange failed: ${JSON.stringify(r.body)}`);
        tokenData = r.body;
    } else {
        const r = await _post(cfg.tokenUrl, {},
            _urlEncode({ client_id: cfg.clientId, client_secret: cfg.clientSecret, code, redirect_uri: cfg.redirectUri, grant_type: "authorization_code" })
        );
        const body = typeof r.body === "string" ? Object.fromEntries(new URLSearchParams(r.body)) : r.body;
        if (!body.access_token) throw new Error(`${provider} token exchange failed: ${JSON.stringify(body)}`);
        tokenData = body;
    }

    // Compute absolute expiry timestamp
    if (tokenData.expires_in) {
        tokenData.expires_at = Date.now() + parseInt(tokenData.expires_in) * 1000;
    }

    // Fetch user identity
    try {
        const headers = provider === "github"
            ? { Authorization: `token ${tokenData.access_token}`, "User-Agent": "jarvis-os" }
            : { Authorization: `Bearer ${tokenData.access_token}` };
        const ur = await _get(cfg.userUrl, headers);
        tokenData.userInfo = ur.body;
    } catch { /* non-critical */ }

    _saveToken(provider, userId, tokenData);
    auditLog.append({ type: "oauth_connected", provider, userId });
    logger.info(`[OAuth] ${provider} connected for user ${userId}`);
    return { userId, provider, connected: true };
}

/** Get decrypted token for a user. Auto-refreshes if expired. */
async function getToken(provider, userId) {
    const token = _loadToken(provider, userId);
    if (!token) return null;
    // Auto-refresh if within 5 minutes of expiry
    if (token.expires_at && token.refresh_token && Date.now() >= token.expires_at - 300_000) {
        try { return await refreshToken(provider, userId); } catch { /* return stale token */ }
    }
    return token;
}

/** Refresh an access token using the stored refresh_token. */
async function refreshToken(provider, userId) {
    const existing = _loadToken(provider, userId);
    if (!existing?.refresh_token) throw new Error(`No refresh token for ${provider}:${userId}`);
    const cfg = _cfg(provider);
    const r   = await _post(cfg.tokenUrl, {}, _urlEncode({
        client_id: cfg.clientId, client_secret: cfg.clientSecret,
        refresh_token: existing.refresh_token, grant_type: "refresh_token",
    }));
    const body = typeof r.body === "string" ? Object.fromEntries(new URLSearchParams(r.body)) : r.body;
    if (!body.access_token) throw new Error(`Token refresh failed: ${JSON.stringify(body)}`);
    const merged = { ...existing, ...body, expires_at: body.expires_in ? Date.now() + parseInt(body.expires_in) * 1000 : existing.expires_at };
    _saveToken(provider, userId, merged);
    auditLog.append({ type: "oauth_refreshed", provider, userId });
    return merged;
}

/** Revoke a token locally and at the provider. */
async function revokeToken(provider, userId) {
    const token = _loadToken(provider, userId);
    if (!token) throw new Error(`No token for ${provider}:${userId}`);
    const cfg = _cfg(provider);
    try {
        if (cfg.revokeUrl && token.access_token) {
            if (provider === "google") {
                await _post(`${cfg.revokeUrl}?token=${encodeURIComponent(token.access_token)}`, {}, "");
            } else if (provider === "slack") {
                await _post(cfg.revokeUrl, { Authorization: `Bearer ${token.access_token}` }, "");
            }
        }
    } catch (e) { logger.warn(`[OAuth] Remote revoke failed for ${provider}: ${e.message}`); }
    delete _store[_storeKey(provider, userId)];
    _saveStore();
    auditLog.append({ type: "oauth_revoked", provider, userId });
    return { revoked: true, provider, userId };
}

function listConnections(userId) {
    return Object.entries(_store)
        .filter(([k]) => !userId || k.startsWith(`${userId}:`))
        .map(([k, v]) => {
            const token = (() => { try { return JSON.parse(_decrypt(v.encrypted)); } catch { return {}; } })();
            return {
                key: k, provider: v.provider, userId: v.userId, savedAt: v.savedAt,
                hasRefreshToken: !!token.refresh_token,
                expiresAt:       token.expires_at ? new Date(token.expires_at).toISOString() : null,
                userEmail:       token.userInfo?.email || token.userInfo?.login || null,
            };
        });
}

function getProviderStatus() {
    const E = process.env;
    return {
        google:    { configured: !!(E.GOOGLE_CLIENT_ID    && E.GOOGLE_CLIENT_SECRET),    clientId: E.GOOGLE_CLIENT_ID    ? "set" : "missing" },
        github:    { configured: !!(E.GITHUB_CLIENT_ID    && E.GITHUB_CLIENT_SECRET),    clientId: E.GITHUB_CLIENT_ID    ? "set" : "missing" },
        slack:     { configured: !!(E.SLACK_CLIENT_ID     && E.SLACK_CLIENT_SECRET),     clientId: E.SLACK_CLIENT_ID     ? "set" : "missing" },
        notion:    { configured: !!(E.NOTION_CLIENT_ID    && E.NOTION_CLIENT_SECRET),    clientId: E.NOTION_CLIENT_ID    ? "set" : "missing" },
        microsoft: { configured: !!(E.MICROSOFT_CLIENT_ID && E.MICROSOFT_CLIENT_SECRET), clientId: E.MICROSOFT_CLIENT_ID ? "set" : "missing" },
        linkedin:  { configured: !!(E.LINKEDIN_CLIENT_ID  && E.LINKEDIN_CLIENT_SECRET),  clientId: E.LINKEDIN_CLIENT_ID  ? "set" : "missing" },
    };
}

module.exports = { getAuthUrl, handleCallback, getToken, refreshToken, revokeToken, listConnections, getProviderStatus };
