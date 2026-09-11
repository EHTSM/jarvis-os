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
 *     secret belongs to the account, not the org. secretVault encrypts
 *     every value AES-256-GCM at rest (key = SHA-256(JWT_SECRET)) before it
 *     ever touches disk — TOTP secrets and recovery-code hashes get that
 *     encryption for free, no separate crypto path added here.
 *   - otpauth for real RFC 4226/6238 TOTP generation/verification (otpauth
 *     internally uses crypto.timingSafeEqual for its digit comparison, so
 *     TOTP verification is already constant-time) — no hand-rolled HMAC
 *     time-step math. Standard otpauth:// URI output means any RFC-6238
 *     authenticator app can enroll: Google Authenticator, Microsoft
 *     Authenticator, Authy, 1Password, Bitwarden all consume the same URI
 *     format — there is no app-specific integration surface to build.
 *   - Recovery codes: 10 single-use codes generated at enrollment, only
 *     their SHA-256 hashes are ever persisted (via secretVault, so also
 *     AES-256-GCM encrypted at rest), compared with crypto.timingSafeEqual.
 *   - Replay protection: the TOTP time-step consumed by the last accepted
 *     code is recorded per account (data/mfa-replay-state.json) and a
 *     repeat of that same step is rejected even though otpauth's ±1-step
 *     drift window would otherwise still consider it valid — this is the
 *     standard RFC 6238 "reject reuse within the same/adjacent step"
 *     mitigation, not a new session or auth mechanism.
 *   - Rate limiting reuses the existing per-IP rateLimiter middleware
 *     (backend/middleware/rateLimiter.js) on the MFA enroll/verify routes
 *     and the mfaToken-bearing login path — no second limiter implemented.
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
 * data/mfa-replay-state.json — last-consumed TOTP step per account, purely
 * a replay guard, holds no secret material.
 */

const fs   = require("fs");
const path = require("path");
const crypto  = require("crypto");
const otpauth = require("otpauth");
const logger = require("../utils/logger");
const auditLog = require("../utils/auditLog.cjs");

const DATA = path.join(__dirname, "../../data/org-policies.json");
const REPLAY_DATA = path.join(__dirname, "../../data/mfa-replay-state.json");

const TOTP_PERIOD_SECONDS = 30;   // RFC 6238 standard step size
const TOTP_DRIFT_WINDOW   = 1;    // ±1 step (±30s) — configurable via policy.mfa.clockDriftSteps
const RECOVERY_CODE_COUNT = 10;

const _try = fn => { try { return fn(); } catch { return null; } };
const _org = () => _try(() => require("./organizationService.cjs"));
const _vault = () => _try(() => require("./secretVault.cjs"));

function _ts() { return new Date().toISOString(); }

const DEFAULT_POLICY = {
  password: { minLength: 8, requireUppercase: false, requireNumber: false, requireSymbol: false },
  mfa: { required: false, clockDriftSteps: TOTP_DRIFT_WINDOW },
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

// ── MFA (TOTP + recovery codes + replay protection) ──────────────────────────
// Secret is per-account (an account can belong to multiple orgs, but has one
// TOTP enrollment), stored via secretVault under a fixed pseudo-org key so it
// reuses the vault's existing AES-256-GCM encryption/rotation machinery
// rather than a new credential store. mfa:totp / mfa:recovery are new
// connector ids in the same family as sso:*/scim:directory from Modules 1/2.

function _mfaVaultOrgId(accountId) { return `account:${accountId}`; }

function _sha256Hex(value) { return crypto.createHash("sha256").update(value, "utf8").digest("hex"); }

/** Constant-time compare of two hex strings of potentially different length
 * (timingSafeEqual throws on length mismatch, which itself leaks length —
 * hashes here are always fixed 64-hex-char SHA-256 digests, but a caller
 * passing a malformed/truncated candidate must not get a fast-path reject). */
function _constantTimeEqual(a, b) {
  const bufA = Buffer.from(String(a), "utf8");
  const bufB = Buffer.from(String(b), "utf8");
  if (bufA.length !== bufB.length) {
    // Compare against a same-length dummy so the false branch still does a
    // full timingSafeEqual — avoids a length-dependent early return.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function _totpFor(accountId, base32Secret) {
  return new otpauth.TOTP({
    issuer: "Ooplix", label: accountId, secret: otpauth.Secret.fromBase32(base32Secret),
    period: TOTP_PERIOD_SECONDS,
  });
}

// ── Replay-protection state: last accepted TOTP time-step per account ───────

function _loadReplayState() {
  try { return JSON.parse(fs.readFileSync(REPLAY_DATA, "utf8")); }
  catch { return { lastStep: {} }; }
}
function _saveReplayState(d) {
  fs.mkdirSync(path.dirname(REPLAY_DATA), { recursive: true });
  const tmp = REPLAY_DATA + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(d, null, 2));
  fs.renameSync(tmp, REPLAY_DATA);
}

/** RFC 6238 replay mitigation: a code is only valid for the time-step(s) it
 * was generated for; once any step has been accepted, presenting a code
 * that resolves to that same step again (or any step <= it) is rejected,
 * even though it would otherwise still fall inside the drift window. */
function _checkAndConsumeStep(accountId, step) {
  const d = _loadReplayState();
  const last = d.lastStep[accountId];
  if (last !== undefined && step <= last) return false;
  d.lastStep[accountId] = step;
  _saveReplayState(d);
  return true;
}

function _currentStep() { return Math.floor(Date.now() / 1000 / TOTP_PERIOD_SECONDS); }

// ── Recovery codes ────────────────────────────────────────────────────────────

function _generateRecoveryCodes() {
  const codes = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    // 5 bytes -> 10 hex chars, formatted xxxxx-xxxxx for readability.
    const raw = crypto.randomBytes(5).toString("hex");
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5, 10)}`);
  }
  return codes;
}

function _storeRecoveryCodes(accountId, codes) {
  const records = codes.map(c => ({ hash: _sha256Hex(c), usedAt: null }));
  _vault()?.storeSecret?.("mfa:recovery", "jwt_secret", JSON.stringify(records), { label: "MFA recovery codes" }, _mfaVaultOrgId(accountId));
}

function _loadRecoveryCodes(accountId) {
  const stored = _vault()?.getSecret?.("mfa:recovery", "jwt_secret", _mfaVaultOrgId(accountId));
  if (!stored) return [];
  try { return JSON.parse(stored); } catch { return []; }
}

/** Consumes one recovery code if it matches an unused stored hash.
 * Constant-time compare against every stored hash (not short-circuited on
 * first match position) so response timing doesn't leak which slot matched. */
function _consumeRecoveryCode(accountId, code) {
  const records = _loadRecoveryCodes(accountId);
  if (!records.length) return false;
  const candidateHash = _sha256Hex(String(code).trim().toLowerCase());
  let matchedIdx = -1;
  for (let i = 0; i < records.length; i++) {
    if (records[i].usedAt) continue;
    if (_constantTimeEqual(candidateHash, records[i].hash)) matchedIdx = i;
  }
  if (matchedIdx === -1) return false;
  records[matchedIdx].usedAt = _ts();
  _vault()?.storeSecret?.("mfa:recovery", "jwt_secret", JSON.stringify(records), { label: "MFA recovery codes" }, _mfaVaultOrgId(accountId));
  return true;
}

function getRecoveryCodeStatus(accountId) {
  const records = _loadRecoveryCodes(accountId);
  return { total: records.length, remaining: records.filter(r => !r.usedAt).length };
}

function regenerateRecoveryCodes(accountId, requestingAccountId) {
  if (accountId !== requestingAccountId) throw Object.assign(new Error("Can only regenerate your own recovery codes"), { status: 403 });
  if (!isMfaEnrolled(accountId)) throw Object.assign(new Error("MFA is not enrolled for this account"), { status: 400 });
  const codes = _generateRecoveryCodes();
  _storeRecoveryCodes(accountId, codes);
  auditLog.append({ type: "policy.mfa_recovery_codes_regenerated", accountId, ts: _ts() });
  return { codes }; // returned once, in cleartext, at generation time only — never again
}

// ── Enrollment ────────────────────────────────────────────────────────────────

function enrollMfa(accountId) {
  const secret = new otpauth.Secret({ size: 20 });
  const totp = new otpauth.TOTP({ issuer: "Ooplix", label: accountId, secret, period: TOTP_PERIOD_SECONDS });
  _vault()?.storeSecret?.("mfa:totp", "jwt_secret", secret.base32, { label: "TOTP secret" }, _mfaVaultOrgId(accountId));
  auditLog.append({ type: "policy.mfa_enrolled", accountId, ts: _ts() });
  return { secret: secret.base32, uri: totp.toString() };
}

/** Completes enrollment: verifies the first real code from the app, then
 * (and only then) issues recovery codes — issuing codes before a verified
 * enrollment would hand out recovery codes for a secret the user may not
 * have actually scanned correctly. */
function verifyMfaEnrollment(accountId, token) {
  const stored = _vault()?.getSecret?.("mfa:totp", "jwt_secret", _mfaVaultOrgId(accountId));
  if (!stored) throw Object.assign(new Error("No MFA enrollment in progress for this account"), { status: 404 });
  const totp = _totpFor(accountId, stored);
  const delta = totp.validate({ token, window: TOTP_DRIFT_WINDOW });
  if (delta === null) throw Object.assign(new Error("Invalid verification code"), { status: 400 });

  // Record this step as consumed immediately so the same enrollment code
  // can't also be replayed as the first login-time code.
  _checkAndConsumeStep(accountId, _currentStep() + delta);

  const codes = _generateRecoveryCodes();
  _storeRecoveryCodes(accountId, codes);
  auditLog.append({ type: "policy.mfa_verified", accountId, ts: _ts() });
  return { ok: true, recoveryCodes: codes }; // cleartext once, at enrollment only
}

function isMfaEnrolled(accountId) {
  return !!_vault()?.getSecret?.("mfa:totp", "jwt_secret", _mfaVaultOrgId(accountId));
}

function disableMfa(accountId, requestingAccountId) {
  if (accountId !== requestingAccountId) throw Object.assign(new Error("Can only disable your own MFA enrollment"), { status: 403 });
  const deleted = _vault()?.deleteSecret?.("mfa:totp", "jwt_secret", _mfaVaultOrgId(accountId));
  _vault()?.deleteSecret?.("mfa:recovery", "jwt_secret", _mfaVaultOrgId(accountId));
  const d = _loadReplayState();
  delete d.lastStep[accountId];
  _saveReplayState(d);
  auditLog.append({ type: "policy.mfa_disabled", accountId, ts: _ts() });
  return { ok: true, deleted: !!deleted };
}

/** Verify a login-time TOTP code against the account's enrolled secret,
 * with replay protection (the resolved time-step is rejected if already
 * consumed) and a recovery-code fallback path. driftSteps is read from the
 * org's policy (default ±1 step / ±30s) so it's configurable, not fixed. */
function verifyMfaCode(accountId, token, driftSteps = TOTP_DRIFT_WINDOW) {
  const stored = _vault()?.getSecret?.("mfa:totp", "jwt_secret", _mfaVaultOrgId(accountId));
  if (!stored) return false;

  const totp = _totpFor(accountId, stored);
  const delta = totp.validate({ token, window: driftSteps });
  if (delta !== null) {
    const step = _currentStep() + delta;
    return _checkAndConsumeStep(accountId, step);
  }

  // Not a valid/fresh TOTP code — try it as a one-time recovery code.
  return _consumeRecoveryCode(accountId, token);
}

/** Throws mfa_*-coded errors, consulted by auth.js's login handler after
 * real password verification (never before — same ordering rationale as
 * the SSO login-policy check it sits alongside). */
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
  if (!verifyMfaCode(account.id, providedToken, mfa.clockDriftSteps)) {
    const err = new Error("Invalid or already-used multi-factor authentication code");
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
//
// OOPLIX V1 MASTER AUDIT — B25-01/GG-1 closure (2026-08-16): this middleware
// was written correctly in the original Enterprise & Physical Integration
// pass but was never actually mounted anywhere — B25 disclosed this honestly
// (ipAllowlistEnforced:false everywhere) rather than fake-enforcing it.
// Live inspection this pass found 8 real org policy records already carry a
// populated allowlist (test IP 203.0.113.9) from that same B24/B25 testing —
// meaning a careless global mount would have retroactively locked out real
// access for those orgs. Fixed narrowly instead: assertIpAllowed() is called
// from the 4 enterprise route files' own existing per-route membership-check
// helpers (enterprisePolicy.js, enterpriseAudit.js, enterpriseMonitoring.js,
// enterpriseDashboard.js), AFTER real org-membership is confirmed — never
// before, so an unrelated caller cannot learn an org has IP restrictions
// from the check itself. This matches the module's own original design
// intent ("compose after requireAuth on specific routers... never applied
// globally") and scopes enforcement to exactly the enterprise-tier surface
// the feature was built for, leaving the rest of the platform (hundreds of
// other routes) untouched.

function _requestIp(req) {
  return req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || req.ip;
}

function isIpAllowed(orgId, ip) {
  const { ipAllowlist } = getPolicy(orgId);
  if (!ipAllowlist?.length) return true; // no restriction configured
  return ipAllowlist.includes(ip);
}

/** Throwing variant, matching assertProviderAllowed/assertConnectorAllowed's
 * own shape — call from an existing per-route permission check, after real
 * org membership has already been confirmed. */
function assertIpAllowed(orgId, req) {
  const ip = _requestIp(req);
  if (!isIpAllowed(orgId, ip)) {
    auditLog.append({ type: "policy.ip_denied", orgId, ip, actorId: req.user?.sub });
    const err = new Error("Access denied — your IP address is not on this organization's allowlist");
    err.status = 403; err.code = "ip_not_allowed";
    throw err;
  }
}

/** Express middleware factory — compose after requireAuth + attachOrg on any
 * router that wants IP enforcement, exactly like operatorOnly composes after
 * requireAuth. Never applied globally. Kept for routers that resolve orgId
 * via attachOrg rather than a real per-route membership-check helper. */
function requireIpAllowed(req, res, next) {
  const orgId = req.org?.id || req.params?.orgId;
  if (!orgId) return next(); // no org context resolved — nothing to enforce against
  try {
    assertIpAllowed(orgId, req);
  } catch (e) {
    return res.status(e.status || 403).json({ ok: false, error: e.message });
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
  getRecoveryCodeStatus,
  regenerateRecoveryCodes,
  getSessionTimeoutSeconds,
  assertProviderAllowed,
  assertConnectorAllowed,
  isIpAllowed,
  assertIpAllowed,
  requireIpAllowed,
};
