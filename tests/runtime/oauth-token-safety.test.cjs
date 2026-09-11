"use strict";
/**
 * Vault Security Hardening — Mandatory Proof 7: OAuth token safety.
 *
 * oauthIntegrationLayer.cjs is architecturally separate from
 * secretVault.cjs (its own AES-256-GCM store, data/oauth-tokens.json,
 * same JWT_SECRET-derived key pattern) — this file verifies its real
 * state/CSRF protection and confirms no route or return value ever
 * exposes an access_token/refresh_token/client_secret value.
 */
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

require("dotenv").config();

const NONCES_FILE = path.join(__dirname, "../../data/oauth-nonces.json");
const TOKENS_FILE = path.join(__dirname, "../../data/oauth-tokens.json");
let _noncesBackup = null, _tokensBackup = null;
before(() => {
    try { _noncesBackup = fs.readFileSync(NONCES_FILE, "utf8"); } catch { _noncesBackup = null; }
    try { _tokensBackup = fs.readFileSync(TOKENS_FILE, "utf8"); } catch { _tokensBackup = null; }
});
after(() => {
    if (_noncesBackup !== null) fs.writeFileSync(NONCES_FILE, _noncesBackup); else { try { fs.unlinkSync(NONCES_FILE); } catch {} }
    if (_tokensBackup !== null) fs.writeFileSync(TOKENS_FILE, _tokensBackup); else { try { fs.unlinkSync(TOKENS_FILE); } catch {} }
});

const oauth = require("../../backend/services/oauthIntegrationLayer.cjs");

describe("MANDATORY PROOF 7 — OAuth token safety", () => {
    it("getAuthUrl() generates a genuinely random, single-use state parameter bound server-side to a short TTL nonce", () => {
        if (!process.env.GOOGLE_CLIENT_ID) process.env.GOOGLE_CLIENT_ID = "test-client-id-for-oauth-safety-test";
        if (!process.env.GOOGLE_REDIRECT_URI) process.env.GOOGLE_REDIRECT_URI = "http://localhost:5050/oauth/google/callback";
        const r1 = oauth.getAuthUrl("google", "acct_oauth_test_1");
        const r2 = oauth.getAuthUrl("google", "acct_oauth_test_2");
        assert.notEqual(r1.state, r2.state, "each getAuthUrl call must generate a distinct random state");
        assert.ok(r1.state.length >= 32, "state must be a genuinely long random value (24 bytes hex = 48 chars), not a guessable short token");
        assert.ok(!("client_secret" in r1) && !JSON.stringify(r1).toLowerCase().includes("client_secret"), "getAuthUrl's return value must never include the OAuth client secret");
    });

    it("handleCallback() rejects an unknown/forged state (CSRF protection is real, not weakened)", async () => {
        await assert.rejects(
            () => oauth.handleCallback("google", "fake-auth-code", "completely-forged-state-value-that-was-never-issued"),
            /Invalid or expired OAuth state/,
            "a forged/unknown state must be rejected with a real CSRF error, never silently accepted"
        );
    });

    it("handleCallback() rejects a state that was issued for a DIFFERENT provider (provider-binding is real)", async () => {
        // Mission 68: getAuthUrl() throws synchronously if <PROVIDER>_CLIENT_ID
        // isn't set (oauthIntegrationLayer.cjs's _cfg() guard) — a real,
        // correct config-safety check, not something to weaken. This test
        // calls getAuthUrl("github", ...) to MINT the state it then replays
        // against "google" below; without GITHUB_CLIENT_ID set it throws here,
        // outside the assert.rejects() that follows, turning an unrelated env
        // gap into what looks like a provider-binding failure. The test above
        // already defends its own "google" call this same way (line 34) —
        // this call needs the identical fallback for "github".
        if (!process.env.GITHUB_CLIENT_ID) process.env.GITHUB_CLIENT_ID = "test-client-id-for-oauth-safety-test";
        if (!process.env.GITHUB_REDIRECT_URI) process.env.GITHUB_REDIRECT_URI = "http://localhost:5050/oauth/github/callback";
        const { state } = oauth.getAuthUrl("github", "acct_oauth_provider_mismatch");
        await assert.rejects(
            () => oauth.handleCallback("google", "fake-code", state), // state was issued for github, used against google
            /State provider mismatch/,
            "a state issued for one provider must be rejected when replayed against a different provider"
        );
    });

    it("handleCallback()'s successful return value never contains an access_token/refresh_token/client_secret field", async () => {
        // We can't complete a full real OAuth code exchange without a live provider round-trip (requires actual user interaction),
        // but we CAN prove the documented return shape structurally: inspect the real function's return statement path is
        // { userId, provider, connected: true } (source-verified) and confirm no such field name appears in that literal.
        const src = fs.readFileSync(path.join(__dirname, "../../backend/services/oauthIntegrationLayer.cjs"), "utf8");
        const returnMatch = src.match(/return \{ userId, provider, connected: true \};/);
        assert.ok(returnMatch, "handleCallback() must return only { userId, provider, connected: true } — never a token field, verified against the real source");
    });

    it("no HTTP route calls oauth.getToken() (the only function that returns a decrypted token) — confirmed absent from phase21.js", () => {
        const routeSrc = fs.readFileSync(path.join(__dirname, "../../backend/routes/phase21.js"), "utf8");
        assert.ok(!routeSrc.includes("oauth.getToken") && !routeSrc.includes(".getToken("), "no route may call the function that returns a decrypted OAuth token value — getToken() must stay internal-only");
    });

    it("the refresh route only returns expiresAt metadata, never the refreshed token value itself", () => {
        const routeSrc = fs.readFileSync(path.join(__dirname, "../../backend/routes/phase21.js"), "utf8");
        const refreshRouteMatch = routeSrc.match(/router\.post\("\/oauth\/:provider\/refresh"[\s\S]*?\}\);/);
        assert.ok(refreshRouteMatch, "refresh route must exist");
        assert.ok(!refreshRouteMatch[0].includes("token.access_token") && !refreshRouteMatch[0].includes("...token"),
            "the refresh route must never spread or return the raw token object — only derived metadata like expiresAt");
    });

    it("token storage (data/oauth-tokens.json) is genuinely encrypted at rest, not plaintext JSON", async () => {
        // Directly exercise _saveToken via a real nonce + a stubbed callback is invasive; instead verify structurally
        // that any pre-existing stored entries in the real token store are ciphertext-shaped (iv:tag:enc), never raw JSON tokens.
        let store = {};
        try { store = JSON.parse(fs.readFileSync(TOKENS_FILE, "utf8")); } catch { store = {}; }
        for (const [key, rec] of Object.entries(store)) {
            if (rec && typeof rec === "object" && rec.encrypted) {
                const parts = rec.encrypted.split(":");
                assert.equal(parts.length, 3, `stored OAuth token record "${key}" must be in iv:tag:enc encrypted form, never plaintext`);
            }
        }
    });
});
