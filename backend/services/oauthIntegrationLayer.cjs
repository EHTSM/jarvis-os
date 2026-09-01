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
        // Mission 60 (Batch A / TikTok): TikTok's Content Posting API OAuth
        // uses "client_key" instead of "client_id" as its query/body param
        // name (a genuine TikTok-specific deviation, not a typo) — handled
        // generically below via cfg.paramKey rather than a provider==="tiktok"
        // special-case, so a future provider with the same quirk doesn't
        // need its own branch either.
        //
        // KNOWN EXTERNAL BLOCKER: video.publish is only grantable to an app
        // in TikTok's "Audited" review status. An unaudited (sandbox) app
        // can authorize and even call the API, but posted videos are forced
        // private/self-view and visible only to a short allow-list of test
        // users added in the TikTok Developer Portal — not a real production
        // publish path until audit is granted. Same category of external,
        // non-code gate as Facebook's App Review and YouTube's OAuth
        // verification above.
        tiktok: {
            authUrl:    "https://www.tiktok.com/v2/auth/authorize",
            tokenUrl:   "https://open.tiktokapis.com/v2/oauth/token/",
            revokeUrl:  "https://open.tiktokapis.com/v2/oauth/revoke/",
            userUrl:    "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name",
            clientId:   E.TIKTOK_CLIENT_KEY,
            clientSecret: E.TIKTOK_CLIENT_SECRET,
            redirectUri:  E.TIKTOK_REDIRECT_URI || `${E.APP_URL || "http://localhost:5050"}/oauth/tiktok/callback`,
            defaultScopes: ["user.info.basic","video.publish","video.upload"],
            paramKey: "client_key",
            envKeyName: "TIKTOK_CLIENT_KEY",
        },
        // Mission 60 (Batch A / YouTube): a SEPARATE provider entry from
        // "google" above, even though both use Google's OAuth endpoints —
        // reusing the shared "google" entry's scopes would force every
        // existing Gmail/Drive connection to silently gain YouTube upload
        // access (or force an unwanted re-consent), and conflates two
        // unrelated product integrations under one connection record. This
        // mirrors the Facebook-vs-WhatsApp split already established in
        // this file/integrationConnectors.cjs (same vendor, separate entries).
        youtube: {
            authUrl:    "https://accounts.google.com/o/oauth2/v2/auth",
            tokenUrl:   "https://oauth2.googleapis.com/token",
            revokeUrl:  "https://oauth2.googleapis.com/revoke",
            userUrl:    "https://www.googleapis.com/oauth2/v3/userinfo",
            clientId:   E.YOUTUBE_CLIENT_ID || E.GOOGLE_CLIENT_ID,
            clientSecret: E.YOUTUBE_CLIENT_SECRET || E.GOOGLE_CLIENT_SECRET,
            redirectUri:  E.YOUTUBE_REDIRECT_URI || `${E.APP_URL || "http://localhost:5050"}/oauth/youtube/callback`,
            defaultScopes: ["openid","email","https://www.googleapis.com/auth/youtube.upload","https://www.googleapis.com/auth/youtube.readonly"],
        },
        // Mission 60-C (Batch C / Google Business Profile, final social
        // platform): same "separate entry, same Google endpoints" pattern
        // as YouTube above — a dedicated business.manage scope should not
        // silently ride the shared "google" Gmail/Drive connection.
        gbp: {
            authUrl:    "https://accounts.google.com/o/oauth2/v2/auth",
            tokenUrl:   "https://oauth2.googleapis.com/token",
            revokeUrl:  "https://oauth2.googleapis.com/revoke",
            userUrl:    "https://www.googleapis.com/oauth2/v3/userinfo",
            clientId:   E.GBP_CLIENT_ID || E.GOOGLE_CLIENT_ID,
            clientSecret: E.GBP_CLIENT_SECRET || E.GOOGLE_CLIENT_SECRET,
            redirectUri:  E.GBP_REDIRECT_URI || `${E.APP_URL || "http://localhost:5050"}/oauth/gbp/callback`,
            envKeyName: "GBP_CLIENT_ID",
            defaultScopes: ["openid","email","https://www.googleapis.com/auth/business.manage"],
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
            tokenAuthMode: "basic",
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
        // Mission 60-B (Batch B / Reddit): standard OAuth2 ("web app" type,
        // not a "script" app — script apps get a permanent token without a
        // refresh flow, but this repo's model is a real user-facing OAuth
        // connect, so "web app" is the correct type). Reddit's token
        // exchange also uses Basic auth, same tokenAuthMode reused from
        // Pinterest/Notion above — no new special-case needed.
        reddit: {
            authUrl:    "https://www.reddit.com/api/v1/authorize",
            tokenUrl:   "https://www.reddit.com/api/v1/access_token",
            revokeUrl:  "https://www.reddit.com/api/v1/revoke_token",
            userUrl:    "https://oauth.reddit.com/api/v1/me",
            clientId:   E.REDDIT_CLIENT_ID,
            clientSecret: E.REDDIT_CLIENT_SECRET,
            redirectUri:  E.REDDIT_REDIRECT_URI || `${E.APP_URL || "http://localhost:5050"}/oauth/reddit/callback`,
            envKeyName: "REDDIT_CLIENT_ID",
            defaultScopes: ["identity","submit","read"],
            tokenAuthMode: "basic",
        },
        // Mission 60-B (Batch B / Pinterest): standard OAuth2, own developer
        // app (developers.pinterest.com). Pinterest's token exchange uses
        // HTTP Basic auth (client_id:client_secret), same pattern Notion
        // already uses above — handled via cfg.tokenAuthMode below rather
        // than a provider==="pinterest" special-case in handleCallback.
        pinterest: {
            authUrl:    "https://www.pinterest.com/oauth/",
            tokenUrl:   "https://api.pinterest.com/v5/oauth/token",
            revokeUrl:  null,
            userUrl:    "https://api.pinterest.com/v5/user_account",
            clientId:   E.PINTEREST_APP_ID,
            clientSecret: E.PINTEREST_APP_SECRET,
            redirectUri:  E.PINTEREST_REDIRECT_URI || `${E.APP_URL || "http://localhost:5050"}/oauth/pinterest/callback`,
            envKeyName: "PINTEREST_APP_ID",
            defaultScopes: ["boards:read","pins:read","pins:write"],
            tokenAuthMode: "basic",
        },
        // Mission 60-B (Batch B / Threads): Threads has its OWN developer
        // app type and OAuth flow (threads.net) — genuinely distinct from
        // Facebook Login/Instagram Graph API despite being a Meta product,
        // unlike Instagram which deliberately reuses the "facebook" entry
        // above. Real Threads API, not the Instagram/Facebook Graph API.
        threads: {
            authUrl:    "https://threads.net/oauth/authorize",
            tokenUrl:   "https://graph.threads.net/oauth/access_token",
            revokeUrl:  null,
            userUrl:    "https://graph.threads.net/v1.0/me?fields=id,username",
            clientId:   E.THREADS_CLIENT_ID,
            clientSecret: E.THREADS_CLIENT_SECRET,
            redirectUri:  E.THREADS_REDIRECT_URI || `${E.APP_URL || "http://localhost:5050"}/oauth/threads/callback`,
            envKeyName: "THREADS_CLIENT_ID",
            defaultScopes: ["threads_basic","threads_content_publish"],
        },
        // Mission 60 (Batch A / Facebook): Facebook Login OAuth. Note this
        // grants a USER access token only — publishing to a Page requires a
        // second step (GET /me/accounts to list the user's Pages and their
        // own Page access tokens), done in facebookPostingService.cjs, not
        // here, so this config stays a plain OAuth2 provider entry like
        // every other one in this file.
        facebook: {
            authUrl:    "https://www.facebook.com/v19.0/dialog/oauth",
            tokenUrl:   "https://graph.facebook.com/v19.0/oauth/access_token",
            revokeUrl:  null,
            userUrl:    "https://graph.facebook.com/v19.0/me?fields=id,name",
            clientId:   E.FACEBOOK_APP_ID,
            clientSecret: E.FACEBOOK_APP_SECRET,
            redirectUri:  E.FACEBOOK_REDIRECT_URI || `${E.APP_URL || E.BASE_URL || "http://localhost:5050"}/oauth/facebook/callback`,
            envKeyName: "FACEBOOK_APP_ID",
            // pages_manage_posts/pages_read_engagement are Advanced Access
            // permissions — Meta requires App Review (business verification
            // + a screencast demo) before any non-admin/tester account can
            // grant them. Standard Access alone (no review needed) issues a
            // token but Page publishing calls will fail with a permissions
            // error until Review is granted — a real, external, non-code gate.
            //
            // instagram_basic/instagram_content_publish added here (Mission
            // 60, Batch A / Instagram) rather than as a separate OAuth
            // provider entry: Instagram Business/Creator publishing rides
            // the SAME Facebook Login connection and the SAME Page-linked
            // access token as facebookPostingService.cjs already resolves
            // (Meta's real account model — an Instagram Business account
            // must be linked to a Facebook Page, there is no independent
            // Instagram developer app for this). instagramPostingService.cjs
            // reuses this one "facebook" connection rather than asking a
            // founder to connect Meta twice for one login.
            defaultScopes: ["public_profile","pages_show_list","pages_manage_posts","pages_read_engagement","instagram_basic","instagram_content_publish"],
        },
        linkedin: {
            authUrl:    "https://www.linkedin.com/oauth/v2/authorization",
            tokenUrl:   "https://www.linkedin.com/oauth/v2/accessToken",
            revokeUrl:  null,
            userUrl:    "https://api.linkedin.com/v2/userinfo",
            clientId:   E.LINKEDIN_CLIENT_ID,
            clientSecret: E.LINKEDIN_CLIENT_SECRET,
            redirectUri:  E.LINKEDIN_REDIRECT_URL || E.LINKEDIN_REDIRECT_URI || `${E.APP_URL || E.BASE_URL || "http://localhost:5050"}/oauth/linkedin/callback`,
            // M60: "w_member_social" added — the scope LinkedIn's Share/UGC
            // Post API actually requires. The pre-existing openid/email/profile
            // trio (M59 finding) only supported identity/reachability, never
            // publishing. Existing connections stay unaffected — a user who
            // authorized before this change simply lacks post permission until
            // they re-authorize (LinkedIn does not silently upgrade scope).
            defaultScopes: ["openid","email","profile","w_member_social"],
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
    if (!cfg.clientId) throw new Error(`${cfg.envKeyName || `${provider.toUpperCase()}_CLIENT_ID`} not set`);
    const state = crypto.randomBytes(24).toString("hex");
    _nonces[state] = { userId, provider, expiresAt: Date.now() + NONCE_TTL_MS };
    _saveNonces();

    const scopeStr = (scopes || cfg.defaultScopes).join(" ");
    const params   = new URLSearchParams({
        [cfg.paramKey || "client_id"]: cfg.clientId,
        redirect_uri: cfg.redirectUri,
        response_type:"code",
        state,
        scope: scopeStr,
        ...(provider === "google"  ? { access_type: "offline", prompt: "consent" } : {}),
        ...(provider === "notion"  ? { owner: "user" } : {}),
        ...(provider === "reddit"  ? { duration: "permanent" } : {}), // without this, Reddit issues a 1h token with no refresh_token at all
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

    if (cfg.tokenAuthMode === "basic") {
        // Basic-auth token exchange (client_id:client_secret in the
        // Authorization header instead of the request body) — used by
        // Notion (Mission-prior) and Pinterest (Mission 60-B). Notion's
        // real API additionally wants a JSON body; every other Basic-auth
        // provider added since (Pinterest) wants the same form-encoded
        // body as every non-Basic provider, just with credentials moved
        // to the header — handled generically via provider==="notion" as
        // the one documented JSON-body exception, not a growing special-case list.
        const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");
        const r = provider === "notion"
            ? await _post(cfg.tokenUrl,
                { Authorization: `Basic ${basic}`, "Content-Type": "application/json" },
                JSON.stringify({ grant_type: "authorization_code", code, redirect_uri: cfg.redirectUri })
              )
            : await _post(cfg.tokenUrl,
                { Authorization: `Basic ${basic}` },
                _urlEncode({ grant_type: "authorization_code", code, redirect_uri: cfg.redirectUri })
              );
        if (!r.body?.access_token) throw new Error(`${provider} token exchange failed: ${JSON.stringify(r.body)}`);
        tokenData = r.body;
    } else {
        const r = await _post(cfg.tokenUrl, {},
            _urlEncode({ [cfg.paramKey || "client_id"]: cfg.clientId, client_secret: cfg.clientSecret, code, redirect_uri: cfg.redirectUri, grant_type: "authorization_code" })
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
            : { Authorization: `Bearer ${tokenData.access_token}`, "User-Agent": "jarvis-os" };
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
        [cfg.paramKey || "client_id"]: cfg.clientId, client_secret: cfg.clientSecret,
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
                await _post(cfg.revokeUrl, { Authorization: `Bearer ${token.access_token}` }, `token=${encodeURIComponent(token.access_token)}`);
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
    const scopesOf = provider => { try { return _cfg(provider).defaultScopes; } catch { return []; } };
    return {
        facebook:  { configured: !!(E.FACEBOOK_APP_ID     && E.FACEBOOK_APP_SECRET),     clientId: E.FACEBOOK_APP_ID     ? "set" : "missing", scopes: scopesOf("facebook") },
        threads:   { configured: !!(E.THREADS_CLIENT_ID   && E.THREADS_CLIENT_SECRET),   clientId: E.THREADS_CLIENT_ID   ? "set" : "missing", scopes: scopesOf("threads") },
        pinterest: { configured: !!(E.PINTEREST_APP_ID    && E.PINTEREST_APP_SECRET),    clientId: E.PINTEREST_APP_ID    ? "set" : "missing", scopes: scopesOf("pinterest") },
        reddit:    { configured: !!(E.REDDIT_CLIENT_ID    && E.REDDIT_CLIENT_SECRET),    clientId: E.REDDIT_CLIENT_ID    ? "set" : "missing", scopes: scopesOf("reddit") },
        tiktok:    { configured: !!(E.TIKTOK_CLIENT_KEY   && E.TIKTOK_CLIENT_SECRET),    clientId: E.TIKTOK_CLIENT_KEY   ? "set" : "missing", scopes: scopesOf("tiktok") },
        youtube:   { configured: !!((E.YOUTUBE_CLIENT_ID || E.GOOGLE_CLIENT_ID) && (E.YOUTUBE_CLIENT_SECRET || E.GOOGLE_CLIENT_SECRET)), clientId: (E.YOUTUBE_CLIENT_ID || E.GOOGLE_CLIENT_ID) ? "set" : "missing", scopes: scopesOf("youtube") },
        gbp:       { configured: !!((E.GBP_CLIENT_ID || E.GOOGLE_CLIENT_ID) && (E.GBP_CLIENT_SECRET || E.GOOGLE_CLIENT_SECRET)), clientId: (E.GBP_CLIENT_ID || E.GOOGLE_CLIENT_ID) ? "set" : "missing", scopes: scopesOf("gbp") },
        google:    { configured: !!(E.GOOGLE_CLIENT_ID    && E.GOOGLE_CLIENT_SECRET),    clientId: E.GOOGLE_CLIENT_ID    ? "set" : "missing", scopes: scopesOf("google") },
        github:    { configured: !!(E.GITHUB_CLIENT_ID    && E.GITHUB_CLIENT_SECRET),    clientId: E.GITHUB_CLIENT_ID    ? "set" : "missing", scopes: scopesOf("github") },
        slack:     { configured: !!(E.SLACK_CLIENT_ID     && E.SLACK_CLIENT_SECRET),     clientId: E.SLACK_CLIENT_ID     ? "set" : "missing", scopes: scopesOf("slack") },
        notion:    { configured: !!(E.NOTION_CLIENT_ID    && E.NOTION_CLIENT_SECRET),    clientId: E.NOTION_CLIENT_ID    ? "set" : "missing", scopes: scopesOf("notion") },
        microsoft: { configured: !!(E.MICROSOFT_CLIENT_ID && E.MICROSOFT_CLIENT_SECRET), clientId: E.MICROSOFT_CLIENT_ID ? "set" : "missing", scopes: scopesOf("microsoft") },
        linkedin:  { configured: !!(E.LINKEDIN_CLIENT_ID  && E.LINKEDIN_CLIENT_SECRET),  clientId: E.LINKEDIN_CLIENT_ID  ? "set" : "missing", scopes: scopesOf("linkedin") },
    };
}

module.exports = { getAuthUrl, handleCallback, getToken, refreshToken, revokeToken, listConnections, getProviderStatus };
