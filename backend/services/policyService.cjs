"use strict";
/**
 * policyService.cjs — Enterprise & Physical Integration Mission, Module 4.
 *
 * Organization-scoped enterprise policy: password requirements, MFA
 * enforcement, session timeout, allowed login providers, connector
 * restrictions, and IP allowlists. Every check point here composes
 * existing enforcement machinery — no new permission system, no new
 * session mechanism:
 *
 *   - organizationService.hasPermission("manage_policy") gates all writes
 *     (org_owner only, same bar as manage_sso/manage_scim from Modules 1/2).
 *   - MFA secrets stored via the existing secretVault.cjs (connector id
 *     mfa:totp, credential type jwt_secret — a per-account shared secret,
 *     structurally the same trust model as any other vault credential),
 *     scoped by accountId-as-orgId-slot (see _mfaSecretKey) since a TOTP
 *     secret belongs to the account, not the org.
 *   - otpauth for real RFC 4226/6238 TOTP generation/verification — no
 *     hand-rolled HMAC time-step math.
 *   - Session timeout is enforced by ssoService/auth.js passing a
 *     policy-derived `exp` into the existing signJWT()/jarvis_auth cookie —
 *     no second session store, no new cookie.
 *   - Allowed-providers policy extends ssoService.assertPasswordLoginAllowed
 *     and a new assertProviderAllowed() both password.js and ssoService.cjs
 *     consult, not a parallel login gate.
 *   - Connector restrictions checked against integrationConnectors.cjs's
 *     existing phase-prefixed connectorId scheme (e.g. "msg:slack",
 *     "git:github") — no new connector taxonomy.
 *   - IP allowlist is a standalone opt-in middleware (requireIpAllowed),
 *     composed after requireAuth on specific routers exactly like
 *     operatorOnly already is — requireAuth itself, used on hundreds of
 *     routes platform-wide, is intentionally left untouched.
 *
 * Storage: data/org-policies.json — non-secret policy config, keyed by
 * orgId. One policy document per org (all fields optional/defaulted).
 */

const fs   = require("fs");
const path = require("path");
const otpauth = require("otpauth");
const logger = require("../utils/logger");
const auditLog = require("../utils/auditLog.cjs");

const DATA = path.join(__dirname, "../../data/org-policies.json");

const _try = fn => { try { return fn(); } catch { return null; } };
const _org = () => _try(() => require("./organizationService.cjs"));
const _vault = () => _try(() => require("./secretVault.cjs"));

function _ts() { return new Date().toISOString(); }

const DEFAULT_POLICY = {
  password: { minLength: 8, requireUppercase: false, requireNumber: false, requireSymbol: false },
  mfa: { required: false },
  sessionTimeoutSeconds: null,       // null = use authMiddleware's default TOKEN_EXPIRY
  allowedProviders: null,            // null = all providers allowed; array restricts to specific ones ("password","saml","oidc","google","entra")
  connectorRestrictions: { allow: null, deny: [] }, // allow: null = all allowed except deny[]; allow: [...] = allowlist only
  ipAllowlist: [],                   // empty = no IP restriction
  updatedAt: null,
};

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch { return { policies: {} }; }
}
function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  const tmp = DATA + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(d, null, 2));
  fs.renameSync(tmp, DATA);
}

function getPolicy(orgId) {
  if (!orgId) return { ...DEFAULT_POLICY };
  const d = _load();
  const stored = d.policies[orgId] || {};
  return {
    password: { ...DEFAULT_POLICY.password, ...stored.password },
    mfa: { ...DEFAULT_POLICY.mfa, ...stored.mfa },
    sessionTimeoutSeconds: stored.sessionTimeoutSeconds ?? DEFAULT_POLICY.sessionTimeoutSeconds,
    allowedProviders: stored.allowedProviders ?? DEFAULT_POLICY.allowedProviders,
    connectorRestrictions: { ...DEFAULT_POLICY.connectorRestrictions, ...stored.connectorRestrictions },
    ipAllowlist: stored.ipAllowlist || DEFAULT_POLICY.ipAllowlist,
    updatedAt: stored.updatedAt || null,
  };
}

function setPolicy(orgId, patch = {}, requestingAccountId) {
  if (!orgId) throw new Error("orgId required");
  if (!_org()?.hasPermission?.(orgId, requestingAccountId, "manage_policy")) {
    throw Object.assign(new Error("Forbidden — requires permission: manage_policy"), { status: 403 });
  }
  const d = _load();
  const current = getPolicy(orgId);
  const merged = {
    password: { ...current.password, ...patch.password },
    mfa: { ...current.mfa, ...patch.mfa },
    sessionTimeoutSeconds: patch.sessionTimeoutSeconds !== undefined ? patch.sessionTimeoutSeconds : current.sessionTimeoutSeconds,
    allowedProviders: patch.allowedProviders !== undefined ? patch.allowedProviders : current.allowedProviders,
    connectorRestrictions: { ...current.connectorRestrictions, ...patch.connectorRestrictions },
    ipAllowlist: patch.ipAllowlist !== undefined ? patch.ipAllowlist : current.ipAllowlist,
    updatedAt: _ts(),
  };
  d.policies[orgId] = merged;
  _save(d);
  auditLog.append({ type: "policy.updated", orgId, actorId: requestingAccountId, patch: Object.keys(patch) });
  return { ok: true, policy: merged };
}

// ── Password policy ─────────────────────────────────────────────────────────

/** Throws with a human-readable message on the first unmet requirement. */
function assertPasswordMeetsPolicy(orgId, password) {
  const { password: rules } = getPolicy(orgId);
  if (!password || password.length < rules.minLength) {
    throw new Error(`Password must be at least ${rules.minLength} characters`);
  }
  if (rules.requireUppercase && !/[A-Z]/.test(password)) throw new Error("Password must include an uppercase letter");
  if (rules.requireNumber && !/[0-9]/.test(password)) throw new Error("Password must include a number");
  if (rules.requireSymbol && !/[^A-Za-z0-9]/.test(password)) throw new Error("Password must include a symbol");
  return true;
}

// ── MFA (TOTP) ───────────────────────────────────────────────────────────────
// Secret is per-account (an account can belong to multiple orgs, but has one
// TOTP enrollment), stored via secretVault under a fixed pseudo-org key so it
// reuses the vault's existing encryption/rotation machinery rather than a new
// credential store. mfa:totp is a new connector id in the same family as
// sso:*/scim:directory from Modules 1/2.

function _mfaVaultOrgId(accountId) { return `account:${accountId}`; }

function enrollMfa(accountId) {
  const secret = new otpauth.Secret({ size: 20 });
  const totp = new otpauth.TOTP({ issuer: "Ooplix", label: accountId, secret });
  _vault()?.storeSecret?.("mfa:totp", "jwt_secret", secret.base32, { label: "TOTP secret" }, _mfaVaultOrgId(accountId));
  auditLog.append({ type: "policy.mfa_enrolled", accountId, ts: _ts() });
  return { secret: secret.base32, uri: totp.toString() };
}

function verifyMfaEnrollment(accountId, token) {
  const stored = _vault()?.getSecret?.("mfa:totp", "jwt_secret", _mfaVaultOrgId(accountId));
  if (!stored) throw Object.assign(new Error("No MFA enrollment in progress for this account"), { status: 404 });
  const totp = new otpauth.TOTP({ issuer: "Ooplix", label: accountId, secret: otpauth.Secret.fromBase32(stored) });
  const delta = totp.validate({ token, window: 1 });
  if (delta === null) throw Object.assign(new Error("Invalid verification code"), { status: 400 });
  auditLog.append({ type: "policy.mfa_verified", accountId, ts: _ts() });
  return { ok: true };
}

function isMfaEnrolled(accountId) {
  return !!_vault()?.getSecret?.("mfa:totp", "jwt_secret", _mfaVaultOrgId(accountId));
}

function disableMfa(accountId, requestingAccountId) {
  if (accountId !== requestingAccountId) throw Object.assign(new Error("Can only disable your own MFA enrollment"), { status: 403 });
  const deleted = _vault()?.deleteSecret?.("mfa:totp", "jwt_secret", _mfaVaultOrgId(accountId));
  auditLog.append({ type: "policy.mfa_disabled", accountId, ts: _ts() });
  return { ok: true, deleted: !!deleted };
}

/** Verify a login-time TOTP code against the account's enrolled secret. */
function verifyMfaCode(accountId, token) {
  const stored = _vault()?.getSecret?.("mfa:totp", "jwt_secret", _mfaVaultOrgId(accountId));
  if (!stored) return false;
  const totp = new otpauth.TOTP({ issuer: "Ooplix", label: accountId, secret: otpauth.Secret.fromBase32(stored) });
  return totp.validate({ token, window: 1 }) !== null;
}

/** Throws sso_mfa_required-style errors mirroring ssoService's error shape,
 * consulted by auth.js's login handler after real password verification. */
function assertMfaSatisfied(orgId, account, providedToken) {
  const { mfa } = getPolicy(orgId);
  if (!mfa.required) return;
  if (!isMfaEnrolled(account.id)) {
    const err = new Error("This organization requires multi-factor authentication. Enroll MFA before signing in.");
    err.status = 403; err.code = "mfa_enrollment_required";
    throw err;
  }
  if (!providedToken) {
    const err = new Error("Multi-factor authentication code required");
    err.status = 401; err.code = "mfa_code_required";
    throw err;
  }
  if (!verifyMfaCode(account.id, providedToken)) {
    const err = new Error("Invalid multi-factor authentication code");
    err.status = 401; err.code = "mfa_code_invalid";
    throw err;
  }
}

// ── Session timeout ──────────────────────────────────────────────────────────

/** Returns the effective session length for this org, or the authMiddleware
 * default if the org hasn't set an override. */
function getSessionTimeoutSeconds(orgId, defaultSeconds) {
  const { sessionTimeoutSeconds } = getPolicy(orgId);
  return sessionTimeoutSeconds || defaultSeconds;
}

// ── Allowed login providers ──────────────────────────────────────────────────

function assertProviderAllowed(orgId, provider) {
  const { allowedProviders } = getPolicy(orgId);
  if (!allowedProviders || !allowedProviders.length) return; // no restriction configured
  if (!allowedProviders.includes(provider)) {
    const err = new Error(`This organization only permits sign-in via: ${allowedProviders.join(", ")}`);
    err.status = 403; err.code = "provider_not_allowed";
    throw err;
  }
}

// ── Connector restrictions ───────────────────────────────────────────────────
// connectorId follows integrationConnectors.cjs's existing "<phase>:<slug>"
// scheme (e.g. "msg:slack", "git:github") — no new taxonomy.

function assertConnectorAllowed(orgId, connectorId) {
  const { connectorRestrictions } = getPolicy(orgId);
  if (connectorRestrictions.deny?.includes(connectorId)) {
    throw Object.assign(new Error(`Connector "${connectorId}" is restricted by organization policy`), { status: 403 });
  }
  if (connectorRestrictions.allow?.length && !connectorRestrictions.allow.includes(connectorId)) {
    throw Object.assign(new Error(`Connector "${connectorId}" is not in this organization's allowed connector list`), { status: 403 });
  }
}

// ── IP allowlist ──────────────────────────────────────────────────────────────

function isIpAllowed(orgId, ip) {
  const { ipAllowlist } = getPolicy(orgId);
  if (!ipAllowlist?.length) return true; // no restriction configured
  return ipAllowlist.includes(ip);
}

/** Express middleware factory — compose after requireAuth + attachOrg on any
 * router that wants IP enforcement, exactly like operatorOnly composes after
 * requireAuth. Never applied globally. */
function requireIpAllowed(req, res, next) {
  const orgId = req.org?.id || req.params?.orgId;
  if (!orgId) return next(); // no org context resolved — nothing to enforce against
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || req.ip;
  if (!isIpAllowed(orgId, ip)) {
    auditLog.append({ type: "policy.ip_denied", orgId, ip, actorId: req.user?.sub });
    return res.status(403).json({ ok: false, error: "Access denied — your IP address is not on this organization's allowlist" });
  }
  next();
}

module.exports = {
  DEFAULT_POLICY,
  getPolicy,
  setPolicy,
  assertPasswordMeetsPolicy,
  enrollMfa,
  verifyMfaEnrollment,
  isMfaEnrolled,
  disableMfa,
  verifyMfaCode,
  assertMfaSatisfied,
  getSessionTimeoutSeconds,
  assertProviderAllowed,
  assertConnectorAllowed,
  isIpAllowed,
  requireIpAllowed,
};
