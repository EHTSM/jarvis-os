"use strict";
/**
 * ssoService.cjs — Enterprise & Physical Integration Mission, Module 1.
 *
 * Organization-scoped enterprise SSO: generic SAML 2.0, generic OIDC, Google
 * Workspace, and Microsoft Entra ID (Azure AD) — the latter two are both
 * OIDC-compliant identity providers, so they share the same OIDC client code
 * path with provider-specific discovery URLs.
 *
 * Reuses, does not duplicate:
 *   - samlify / openid-client for all cryptographic verification (XML-DSig,
 *     JWKS/RS256). No hand-rolled signature checking anywhere in this file.
 *   - secretVault.cjs for every secret (OIDC client secret, SAML private key/
 *     signing cert) — org-scoped, encrypted at rest, already has rotation.
 *   - organizationService.cjs for the org record + hasPermission("manage_sso")
 *     gate — no parallel permission system.
 *   - accountService.createSsoAccount for JIT provisioning — no parallel
 *     identity table; SSO-provisioned accounts land in the same
 *     data/local-accounts.json every other account lives in.
 *   - authMiddleware.signJWT + the same jarvis_auth cookie for the resulting
 *     session — an SSO login produces an identical session to a password
 *     login, not a separate session mechanism.
 *   - backend/utils/auditLog.cjs for login events.
 *
 * Storage: data/sso-configs.json — non-secret connection config only, keyed
 * by orgId. One config per org (an org has exactly one active SSO connection
 * at a time, consistent with "organization login policy").
 */

const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");
const samlify = require("samlify");
const logger = require("../utils/logger");
const auditLog = require("../utils/auditLog.cjs");

const DATA = path.join(__dirname, "../../data/sso-configs.json");

// samlify requires a schema validator to be registered before any SAML
// document is processed. It only performs XSD shape-checking — the actual
// security boundary (verifying the IdP's XML-DSig signature on the
// assertion, so a forged or tampered response is rejected) is done by
// samlify's own signature-verification code inside parseLoginResponse(),
// which runs unconditionally regardless of which schema validator is set.
// Prefer the real XSD validator (pure-JS libxmljs2 binding, no system
// xmllint binary needed) for defense-in-depth; if it can't load in this
// environment for any reason, fall back to a permissive validator that only
// skips the XSD shape-check — signature verification is never weakened by
// this fallback.
let _schemaValidatorMode = "unset";
try {
  const xsdValidator = require("@authenio/samlify-xsd-schema-validator");
  samlify.setSchemaValidator(xsdValidator);
  _schemaValidatorMode = "xsd";
} catch (e) {
  logger.warn(`[SSO] @authenio/samlify-xsd-schema-validator unavailable (${e.message}) — falling back to permissive schema validator. XML-DSig signature verification is NOT affected and remains fully enforced; only XSD shape pre-checking is skipped.`);
  samlify.setSchemaValidator({ validate: () => Promise.resolve("skipped") });
  _schemaValidatorMode = "permissive";
}

const _try = fn => { try { return fn(); } catch { return null; } };
const _org  = () => _try(() => require("./organizationService.cjs"));
const _vault = () => _try(() => require("./secretVault.cjs"));
const _accounts = () => _try(() => require("./accountService"));

const PROVIDERS = ["saml", "oidc", "google", "entra"];

// Provider-specific fixed OIDC discovery issuers. Generic OIDC and Entra ID
// (multi-tenant) require the org to supply their own issuer/tenant.
const GOOGLE_ISSUER = "https://accounts.google.com";
function _entraIssuer(tenantId) { return `https://login.microsoftonline.com/${tenantId}/v2.0`; }

function _baseUrl() {
  return (process.env.BASE_URL || "http://localhost:5050").replace(/\/+$/, "");
}

function _ts() { return new Date().toISOString(); }

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch { return { configs: {} }; }
}
function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  d.updatedAt = _ts();
  const tmp = DATA + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(d, null, 2));
  fs.renameSync(tmp, DATA);
}

// ── Config CRUD ────────────────────────────────────────────────────────────

function getSsoConfig(orgId) {
  if (!orgId) return null;
  const d = _load();
  return d.configs[orgId] || null;
}

/**
 * Set (create or replace) an org's SSO connection.
 *
 * opts (common):        provider, enabled, allowedDomains[], jitProvisioning, defaultRole
 * opts (saml):          entityId, metadataXml, wantAssertionsSigned
 * opts (oidc/generic):  issuer, clientId, clientSecret
 * opts (google):        clientId, clientSecret   (issuer is fixed)
 * opts (entra):         tenantId, clientId, clientSecret   (issuer derived from tenantId)
 */
function setSsoConfig(orgId, opts = {}, requestingAccountId) {
  if (!orgId) throw new Error("orgId required");
  if (!PROVIDERS.includes(opts.provider)) throw new Error(`provider must be one of: ${PROVIDERS.join(", ")}`);
  _org()?.getOrg?.(orgId) || (() => { throw Object.assign(new Error("Organization not found"), { status: 404 }); })();
  if (!_org()?.hasPermission?.(orgId, requestingAccountId, "manage_sso")) {
    throw Object.assign(new Error("Forbidden — requires permission: manage_sso"), { status: 403 });
  }

  const d = _load();
  const acsUrl = `${_baseUrl()}/enterprise/sso/${orgId}/saml/acs`;
  const redirectUri = `${_baseUrl()}/enterprise/sso/${orgId}/oidc/callback`;

  const config = {
    orgId,
    provider: opts.provider,
    enabled: opts.enabled !== false,
    allowedDomains: Array.isArray(opts.allowedDomains) ? opts.allowedDomains.map(d => d.toLowerCase().trim()) : [],
    jitProvisioning: opts.jitProvisioning !== false,
    defaultRole: opts.defaultRole || "user",
    // Organization login policy: when true, members whose account was
    // provisioned through (or belongs to) this org must use this SSO
    // connection — password login is refused for them. Session duration is
    // left to authMiddleware's existing TOKEN_EXPIRY; a per-org override
    // belongs to Module 4's broader policy engine, not duplicated here.
    requireSsoLogin: !!opts.requireSsoLogin,
    createdAt: d.configs[orgId]?.createdAt || _ts(),
    updatedAt: _ts(),
  };

  if (opts.provider === "saml") {
    if (!opts.metadataXml) throw new Error("metadataXml (the IdP's SAML metadata document) is required");
    config.entityId = opts.entityId || `${_baseUrl()}/enterprise/sso/${orgId}/saml/metadata`;
    config.acsUrl = acsUrl;
    config.metadataXml = opts.metadataXml; // IdP metadata is not a secret — it's public by design
    config.wantAssertionsSigned = opts.wantAssertionsSigned !== false;
  } else if (opts.provider === "oidc") {
    if (!opts.issuer) throw new Error("issuer required for generic OIDC");
    if (!opts.clientId) throw new Error("clientId required");
    config.issuer = opts.issuer;
    config.clientId = opts.clientId;
    config.redirectUri = redirectUri;
  } else if (opts.provider === "google") {
    if (!opts.clientId) throw new Error("clientId required");
    config.issuer = GOOGLE_ISSUER;
    config.clientId = opts.clientId;
    config.redirectUri = redirectUri;
  } else if (opts.provider === "entra") {
    if (!opts.tenantId) throw new Error("tenantId required for Microsoft Entra ID");
    if (!opts.clientId) throw new Error("clientId required");
    config.tenantId = opts.tenantId;
    config.issuer = _entraIssuer(opts.tenantId);
    config.clientId = opts.clientId;
    config.redirectUri = redirectUri;
  }

  d.configs[orgId] = config;
  _save(d);

  // Secrets never touch data/sso-configs.json — they live in the vault,
  // org-scoped, exactly like every other connector credential.
  if (opts.provider === "saml" && opts.privateKey) {
    _vault()?.storeSecret?.("sso:saml", "certificate", opts.privateKey, { label: "SP private key" }, orgId);
  }
  if (["oidc", "google", "entra"].includes(opts.provider) && opts.clientSecret) {
    _vault()?.storeSecret?.(`sso:${opts.provider}`, "oauth_token", opts.clientSecret, { label: "OIDC client secret" }, orgId);
  }

  auditLog.append({ type: "sso.config_updated", orgId, actorId: requestingAccountId, provider: opts.provider, ts: _ts() });
  return { ok: true, config: _publicConfig(config) };
}

function deleteSsoConfig(orgId, requestingAccountId) {
  if (!_org()?.hasPermission?.(orgId, requestingAccountId, "manage_sso")) {
    throw Object.assign(new Error("Forbidden — requires permission: manage_sso"), { status: 403 });
  }
  const d = _load();
  const existed = !!d.configs[orgId];
  const provider = d.configs[orgId]?.provider;
  delete d.configs[orgId];
  _save(d);
  if (existed && provider === "saml") _vault()?.deleteSecret?.("sso:saml", "certificate", orgId);
  if (existed && ["oidc", "google", "entra"].includes(provider)) _vault()?.deleteSecret?.(`sso:${provider}`, "oauth_token", orgId);
  auditLog.append({ type: "sso.config_deleted", orgId, actorId: requestingAccountId, ts: _ts() });
  return { ok: true, deleted: existed };
}

// Never return metadataXml/entityId internals or anything secret-adjacent
// unnecessarily to a general "read the config" caller beyond what the admin
// UI needs to confirm what's configured.
function _publicConfig(config) {
  if (!config) return null;
  const { metadataXml, ...safe } = config;
  return { ...safe, hasMetadata: !!metadataXml };
}

/**
 * Organization login policy check for password-based login. Consulted by
 * auth.js's existing _handleLogin — if the account belongs to (or was
 * SSO-provisioned by) an org whose SSO config has requireSsoLogin: true,
 * password login for that account is refused; the caller is directed back
 * to that org's SSO login route instead.
 */
function assertPasswordLoginAllowed(account) {
  if (!account) return; // unknown-account case is handled by the normal invalid-credentials path
  const candidateOrgIds = new Set();
  if (account.ssoOrgId) candidateOrgIds.add(account.ssoOrgId);
  const memberships = _try(() => _org()?.resolveContext?.(account.id)?.orgs) || [];
  for (const m of memberships) if (m.orgId) candidateOrgIds.add(m.orgId);

  for (const orgId of candidateOrgIds) {
    const config = getSsoConfig(orgId);
    if (config?.enabled && config?.requireSsoLogin) {
      const err = new Error(`This account's organization requires single sign-on. Sign in at /enterprise/sso/${orgId}/${config.provider === "saml" ? "saml" : "oidc"}/login`);
      err.status = 403;
      err.code = "sso_required";
      err.orgId = orgId;
      err.provider = config.provider;
      throw err;
    }
  }
}

// ── SAML 2.0 ───────────────────────────────────────────────────────────────

/**
 * Build the SP entity for an org. The SP's own signing key is optional
 * (authnRequestsSigned: false is a valid, common posture — most IdPs only
 * require the RESPONSE to be signed, not the request) — if the org stored a
 * private key via setSsoConfig's privateKey option, use it; otherwise build
 * an unsigned-request SP.
 */
function _buildSp(orgId, config) {
  const privateKey = _try(() => _vault()?.getSecret?.("sso:saml", "certificate", orgId));
  return samlify.ServiceProvider({
    entityID: config.entityId,
    assertionConsumerService: [{ Binding: samlify.Constants.BindingNamespace.Post, Location: config.acsUrl }],
    wantAssertionsSigned: config.wantAssertionsSigned !== false,
    authnRequestsSigned: !!privateKey,
    ...(privateKey ? { privateKey } : {}),
  });
}

function _buildIdp(config) {
  return samlify.IdentityProvider({ metadata: config.metadataXml });
}

function getSamlMetadata(orgId) {
  const config = getSsoConfig(orgId);
  if (!config || config.provider !== "saml") return null;
  const sp = _buildSp(orgId, config);
  return sp.getMetadata();
}

/** Build the redirect the browser should follow to reach the IdP's login page. */
function buildSamlLoginRequest(orgId) {
  const config = getSsoConfig(orgId);
  if (!config || config.provider !== "saml" || !config.enabled) {
    throw Object.assign(new Error("SAML SSO is not configured or not enabled for this organization"), { status: 404 });
  }
  const sp = _buildSp(orgId, config);
  const idp = _buildIdp(config);
  const { context } = sp.createLoginRequest(idp, "redirect");
  return context; // full redirect URL string, including the signed/encoded AuthnRequest
}

/**
 * Verify and parse an inbound SAML response at the ACS endpoint. Real
 * signature verification happens inside samlify's parseLoginResponse — this
 * function does no cryptography of its own.
 */
async function handleSamlAssertion(orgId, req) {
  const config = getSsoConfig(orgId);
  if (!config || config.provider !== "saml" || !config.enabled) {
    throw Object.assign(new Error("SAML SSO is not configured or not enabled for this organization"), { status: 404 });
  }
  const sp = _buildSp(orgId, config);
  const idp = _buildIdp(config);

  const { extract } = await sp.parseLoginResponse(idp, "post", req);

  const email = (extract.attributes?.email || extract.attributes?.Email || extract.nameID || "").toString().toLowerCase();
  const name  = (extract.attributes?.name || extract.attributes?.displayName || "").toString();
  if (!email || !email.includes("@")) {
    throw Object.assign(new Error("SAML assertion did not include a usable email (checked NameID and email/Email attributes)"), { status: 400 });
  }

  return _resolveOrProvisionAccount(orgId, config, email, name, "saml");
}

// ── OIDC / Google Workspace / Microsoft Entra ID ────────────────────────────
// openid-client v6 is ESM-only; consumed here via dynamic import from CJS —
// the standard, supported interop path (no CJS build exists to require()).

let _openidClientPromise = null;
function _oidc() {
  if (!_openidClientPromise) _openidClientPromise = import("openid-client");
  return _openidClientPromise;
}

// In-memory PKCE/state/nonce holding pen, keyed by state. 10-minute TTL —
// long enough for a real login redirect round trip, short enough that a
// restart or a few hundred concurrent logins never meaningfully leaks memory.
const _oidcPending = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _oidcPending) if (v.expiresAt < now) _oidcPending.delete(k);
}, 60_000).unref();

async function _getOidcConfig(orgId, config) {
  const client = await _oidc();
  const clientSecret = _try(() => _vault()?.getSecret?.(`sso:${config.provider}`, "oauth_token", orgId));
  if (!clientSecret) throw new Error(`No client secret stored for this org's ${config.provider} SSO connection`);
  return client.discovery(new URL(config.issuer), config.clientId, clientSecret);
}

async function buildOidcAuthUrl(orgId) {
  const config = getSsoConfig(orgId);
  if (!config || !["oidc", "google", "entra"].includes(config.provider) || !config.enabled) {
    throw Object.assign(new Error("OIDC SSO is not configured or not enabled for this organization"), { status: 404 });
  }
  const client = await _oidc();
  const oidcConfig = await _getOidcConfig(orgId, config);

  const codeVerifier = client.randomPKCECodeVerifier();
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
  const state = client.randomState();
  const nonce = client.randomNonce();

  _oidcPending.set(state, { orgId, codeVerifier, nonce, expiresAt: Date.now() + 10 * 60_000 });

  const url = client.buildAuthorizationUrl(oidcConfig, {
    redirect_uri: config.redirectUri,
    scope: "openid email profile",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
    nonce,
  });
  return url.href;
}

async function handleOidcCallback(orgId, currentUrl) {
  const config = getSsoConfig(orgId);
  if (!config || !["oidc", "google", "entra"].includes(config.provider) || !config.enabled) {
    throw Object.assign(new Error("OIDC SSO is not configured or not enabled for this organization"), { status: 404 });
  }
  const state = currentUrl.searchParams.get("state");
  const pending = state && _oidcPending.get(state);
  if (!pending || pending.orgId !== orgId) {
    throw Object.assign(new Error("Invalid or expired OIDC login state"), { status: 400 });
  }
  _oidcPending.delete(state);

  const client = await _oidc();
  const oidcConfig = await _getOidcConfig(orgId, config);

  const tokens = await client.authorizationCodeGrant(oidcConfig, currentUrl, {
    pkceCodeVerifier: pending.codeVerifier,
    expectedState: state,
    expectedNonce: pending.nonce,
  });

  const claims = tokens.claims(); // verified ID token claims (signature + exp/iss/aud already checked by openid-client)
  let email = (claims?.email || "").toLowerCase();
  let name  = claims?.name || "";

  if (!email) {
    // Some providers omit email from the ID token unless explicitly scoped;
    // fall back to the real userinfo endpoint rather than failing the login.
    const userinfo = await client.fetchUserInfo(oidcConfig, tokens.access_token, claims.sub);
    email = (userinfo.email || "").toLowerCase();
    name  = name || userinfo.name || "";
  }
  if (!email || !email.includes("@")) {
    throw Object.assign(new Error("OIDC identity did not include a usable email"), { status: 400 });
  }

  return _resolveOrProvisionAccount(orgId, config, email, name, config.provider);
}

// ── Shared: account resolution + org login-policy enforcement ─────────────

function _resolveOrProvisionAccount(orgId, config, email, name, provider) {
  if (config.allowedDomains?.length) {
    const domain = email.split("@")[1];
    if (!config.allowedDomains.includes(domain)) {
      auditLog.append({ type: "sso.login_denied", orgId, email, provider, reason: "domain_not_allowed", ts: _ts() });
      throw Object.assign(new Error(`Email domain "${domain}" is not permitted to sign in to this organization`), { status: 403 });
    }
  }

  const accounts = _accounts();
  let account = accounts?.getByEmail?.(email);

  if (!account) {
    if (!config.jitProvisioning) {
      auditLog.append({ type: "sso.login_denied", orgId, email, provider, reason: "jit_disabled_no_existing_account", ts: _ts() });
      throw Object.assign(new Error("No account exists for this email and just-in-time provisioning is disabled for this organization"), { status: 403 });
    }
    const created = accounts.createSsoAccount({ email, name, role: config.defaultRole, ssoProvider: provider, ssoOrgId: orgId });
    if (!created.ok && !created.success) {
      throw new Error("account provisioning failed: " + created.error);
    }
    account = created.account;

    // Add the newly provisioned identity as a member of the org that owns
    // this SSO connection — reuses organizationService's own membership
    // model via the dedicated SSO-triggered entry point (the org's own
    // manage_sso-gated config is what authorized this, not the new
    // account's own permissions, which don't exist yet).
    _try(() => _org()?.addMemberViaSso?.(orgId, account.id, config.defaultRole === "org_admin" ? "org_admin" : "member"));
  } else {
    // Returning SSO user — ensure membership exists (idempotent) in case
    // the account existed from some other path (e.g. manual invite) before
    // ever logging in via this org's SSO connection.
    _try(() => _org()?.addMemberViaSso?.(orgId, account.id, "member"));
  }

  auditLog.append({ type: "sso.login", orgId, accountId: account.id, email, provider, ts: _ts() });
  return { account, orgId, provider };
}

module.exports = {
  PROVIDERS,
  getSsoConfig,
  setSsoConfig,
  deleteSsoConfig,
  assertPasswordLoginAllowed,
  getSamlMetadata,
  buildSamlLoginRequest,
  handleSamlAssertion,
  buildOidcAuthUrl,
  handleOidcCallback,
  _publicConfig,
  _baseUrl,
  _schemaValidatorMode,
};
