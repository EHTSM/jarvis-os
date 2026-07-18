"use strict";
/**
 * scimService.cjs — Enterprise & Physical Integration Mission, Module 2.
 *
 * Organization-scoped SCIM 2.0 (RFC 7643/7644) directory provisioning: user
 * sync, group (→ department) sync, and automatic deprovisioning.
 *
 * Reuses, does not duplicate:
 *   - scimmy / scimmy-routers for the actual SCIM protocol (schema
 *     validation, RFC 7644 filter parsing, PATCH op semantics, ListResponse/
 *     Error message shapes). No hand-rolled SCIM filter grammar anywhere in
 *     this file — scimmy has been tested against Microsoft Entra ID, one of
 *     this mission's named providers.
 *   - accountService.js as the single identity store — SCIM Users map onto
 *     real accounts (createSsoAccount for provisioning, updateAccount for
 *     attribute sync and deactivation, getByEmail/getById for lookups). No
 *     parallel "directory user" table.
 *   - organizationService.cjs for org membership + department mapping (a
 *     SCIM Group maps onto a Department — a flat, IdP-group-like unit
 *     org.departments already models) and hasPermission("manage_scim") for
 *     the admin token-management gate.
 *   - secretVault.cjs for the per-org SCIM bearer token (connector id
 *     scim:directory, credential type webhook_secret — a shared secret the
 *     IdP presents on every request, structurally the same trust model as a
 *     webhook signing secret).
 *   - backend/utils/auditLog.cjs for every provisioning/deprovisioning event.
 *
 * Storage: no new store of its own — the org-scoped SCIM bearer token lives
 * in secretVault, everything else is read/written through accountService and
 * organizationService's existing files.
 */

const SCIMMY = require("scimmy");
const crypto = require("crypto");
const logger = require("../utils/logger");
const auditLog = require("../utils/auditLog.cjs");

const _try = fn => { try { return fn(); } catch { return null; } };
const _org = () => _try(() => require("./organizationService.cjs"));
const _accounts = () => _try(() => require("./accountService"));
const _vault = () => _try(() => require("./secretVault.cjs"));

function _ts() { return new Date().toISOString(); }

// ── SCIM bearer token management (per-org) ─────────────────────────────────

function getScimToken(orgId, requestingAccountId) {
  if (!_org()?.hasPermission?.(orgId, requestingAccountId, "manage_scim")) {
    throw Object.assign(new Error("Forbidden — requires permission: manage_scim"), { status: 403 });
  }
  const rec = _vault()?.getSecret?.("scim:directory", "webhook_secret", orgId);
  return { configured: !!rec, tokenPreview: rec ? `${rec.slice(0, 6)}...${rec.slice(-4)}` : null };
}

/** (Re)generate the org's SCIM bearer token. Returns the raw token exactly
 * once — like every other credential in this system, it is never stored or
 * retrievable in plaintext again after this call. */
function rotateScimToken(orgId, requestingAccountId) {
  if (!_org()?.hasPermission?.(orgId, requestingAccountId, "manage_scim")) {
    throw Object.assign(new Error("Forbidden — requires permission: manage_scim"), { status: 403 });
  }
  const token = `scim_${crypto.randomBytes(32).toString("hex")}`;
  _vault()?.storeSecret?.("scim:directory", "webhook_secret", token, { label: "SCIM bearer token" }, orgId);
  auditLog.append({ type: "scim.token_rotated", orgId, actorId: requestingAccountId, ts: _ts() });
  return { token, scimBaseUrl: `${require("./ssoService.cjs")._baseUrl()}/enterprise/scim/${orgId}/v2` };
}

function deleteScimToken(orgId, requestingAccountId) {
  if (!_org()?.hasPermission?.(orgId, requestingAccountId, "manage_scim")) {
    throw Object.assign(new Error("Forbidden — requires permission: manage_scim"), { status: 403 });
  }
  const deleted = _vault()?.deleteSecret?.("scim:directory", "webhook_secret", orgId);
  auditLog.append({ type: "scim.token_deleted", orgId, actorId: requestingAccountId, ts: _ts() });
  return { ok: true, deleted: !!deleted };
}

/** Bearer-auth handler consumed by SCIMMYRouters — verifies the token
 * belongs to the orgId in the URL, in constant time. */
function verifyScimBearer(orgId, authorizationHeader) {
  const presented = (authorizationHeader || "").replace(/^Bearer\s+/i, "").trim();
  if (!presented) throw new Error("Authorization header with a Bearer token is required");
  const real = _vault()?.getSecret?.("scim:directory", "webhook_secret", orgId);
  if (!real) throw new Error("SCIM is not configured for this organization");
  const a = Buffer.from(presented);
  const b = Buffer.from(real);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error("Invalid SCIM bearer token");
  }
  return true;
}

// ── SCIM User <-> account mapping ──────────────────────────────────────────

function _accountToScimUser(account, orgId) {
  const memberships = _try(() => _org()?.resolveContext?.(account.id)?.orgs) || [];
  const membership = memberships.find(m => m.orgId === orgId);
  return {
    id: account.id,
    userName: account.email,
    name: { givenName: account.name?.split(" ")[0] || account.name || "", familyName: account.name?.split(" ").slice(1).join(" ") || "" },
    emails: [{ value: account.email, primary: true }],
    active: !!account.active,
    ...(membership?.deptId ? { "urn:jarvis:params:scim:schemas:extension:department": membership.deptId } : {}),
  };
}

function egressUsers(orgId, resource) {
  const accounts = _accounts();
  if (resource.id) {
    const account = accounts?.getById?.(resource.id);
    if (!account) throw new SCIMMY.Types.Error(404, null, `User ${resource.id} not found`);
    return _accountToScimUser(account, orgId);
  }
  // List: every account that is a member of this org.
  const { members } = _org()?.listMembers?.(orgId) || { members: [] };
  return members
    .map(m => accounts?.getById?.(m.accountId))
    .filter(Boolean)
    .map(a => _accountToScimUser(a, orgId));
}

function ingressUser(orgId, resource, instance) {
  const accounts = _accounts();
  const email = (instance.userName || instance.emails?.find(e => e.primary)?.value || instance.emails?.[0]?.value || "").toLowerCase();
  if (!email) throw new SCIMMY.Types.Error(400, "invalidValue", "userName or emails is required");

  const name = [instance.name?.givenName, instance.name?.familyName].filter(Boolean).join(" ");
  let account = resource.id ? accounts?.getById?.(resource.id) : accounts?.getByEmail?.(email);

  if (!account) {
    // Create — SCIM push from the IdP is exactly as authoritative as a
    // successful SSO login for JIT provisioning purposes.
    const created = accounts?.createSsoAccount?.({ email, name, role: "user", ssoProvider: "scim", ssoOrgId: orgId });
    if (!created?.success) throw new SCIMMY.Types.Error(409, "uniqueness", created?.error || "account provisioning failed");
    account = created.account;
    _try(() => _org()?.addMemberViaSso?.(orgId, account.id, "member"));
    auditLog.append({ type: "scim.user_provisioned", orgId, accountId: account.id, email, ts: _ts() });
  } else {
    // Update — name and active-state sync. Email/userName changes are
    // intentionally not applied here: email is this system's account
    // identity key, and silently re-keying an account from a directory
    // push is a real identity-confusion risk, not a routine attribute sync.
    const patch = {};
    if (name && name !== account.name) patch.name = name;
    if (typeof instance.active === "boolean" && instance.active !== account.active) patch.active = instance.active;
    if (Object.keys(patch).length) {
      accounts?.updateAccount?.(account.id, patch);
      auditLog.append({ type: "scim.user_updated", orgId, accountId: account.id, patch, ts: _ts() });
    }
    _try(() => _org()?.addMemberViaSso?.(orgId, account.id, "member")); // idempotent — ensures membership if this org didn't provision originally
  }

  const deptExt = instance["urn:jarvis:params:scim:schemas:extension:department"];
  if (deptExt !== undefined) {
    _try(() => _org()?.updateMemberDepartmentViaScim?.(orgId, account.id, deptExt || null));
  }

  return _accountToScimUser(accounts.getById(account.id), orgId);
}

/** Deprovisioning: SCIM DELETE /Users/:id removes org membership and
 * deactivates the account (active: false) — reuses the exact same `active`
 * flag every login check already reads (accountService.loginByEmail filters
 * on a.active); no new "disabled" concept. The account record itself is
 * never destroyed, consistent with every other delete/removal pattern in
 * this codebase (soft-disable, not hard delete of identity history). */
function degressUser(orgId, resource) {
  const accounts = _accounts();
  const account = accounts?.getById?.(resource.id);
  if (!account) throw new SCIMMY.Types.Error(404, null, `User ${resource.id} not found`);
  accounts?.updateAccount?.(account.id, { active: false });
  // Same rationale as _scimSystemActorFor below: a SCIM DELETE has no human
  // requester with manage_members, only the org's own manage_scim-authorized
  // connection — attribute to the org_owner, the one real actor who
  // legitimately holds that permission by construction.
  _try(() => _org()?.removeMember?.(orgId, account.id, _scimSystemActorFor(orgId)));
  auditLog.append({ type: "scim.user_deprovisioned", orgId, accountId: account.id, ts: _ts() });
}

// ── SCIM Group <-> department mapping ──────────────────────────────────────

function _deptToScimGroup(dept, orgId) {
  const { members } = _org()?.listMembers?.(orgId) || { members: [] };
  const groupMembers = members.filter(m => m.deptId === dept.id).map(m => ({ value: m.accountId }));
  return { id: dept.id, displayName: dept.name, members: groupMembers };
}

function egressGroups(orgId, resource) {
  const { departments } = _org()?.listDepartments?.(orgId) || { departments: [] };
  if (resource.id) {
    const dept = departments.find(d => d.id === resource.id);
    if (!dept) throw new SCIMMY.Types.Error(404, null, `Group ${resource.id} not found`);
    return _deptToScimGroup(dept, orgId);
  }
  return departments.map(d => _deptToScimGroup(d, orgId));
}

function ingressGroup(orgId, resource, instance) {
  const org = _org();
  const { departments } = org?.listDepartments?.(orgId) || { departments: [] };
  let dept = resource.id ? departments.find(d => d.id === resource.id) : departments.find(d => d.name === instance.displayName);

  if (!dept) {
    // Group creation via SCIM is itself the pre-authorization, same as user
    // JIT provisioning — bypass manage_departments' user-permission gate the
    // same documented way addMemberViaSso bypasses manage_members.
    dept = _createDepartmentViaScim(orgId, instance.displayName);
  } else if (instance.displayName && instance.displayName !== dept.name) {
    _try(() => org?.updateDepartment?.(orgId, dept.id, { name: instance.displayName }, _scimSystemActorFor(orgId)));
  }

  // Sync membership — SCIM Group PUT/PATCH sends the full desired member
  // list for PUT; scimmy's PatchOp layer resolves add/remove PATCH ops into
  // the same full `instance.members` shape before calling ingress, so this
  // handler only ever needs to reconcile toward one target set.
  if (Array.isArray(instance.members)) {
    const desired = new Set(instance.members.map(m => m.value));
    const current = new Set(
      (org?.listMembers?.(orgId)?.members || []).filter(m => m.deptId === dept.id).map(m => m.accountId)
    );
    for (const accountId of desired) if (!current.has(accountId)) _try(() => org?.updateMemberDepartmentViaScim?.(orgId, accountId, dept.id));
    for (const accountId of current) if (!desired.has(accountId)) _try(() => org?.updateMemberDepartmentViaScim?.(orgId, accountId, null));
  }

  auditLog.append({ type: "scim.group_synced", orgId, deptId: dept.id, displayName: dept.name, ts: _ts() });
  return _deptToScimGroup(dept, orgId);
}

function degressGroup(orgId, resource) {
  const org = _org();
  const { departments } = org?.listDepartments?.(orgId) || { departments: [] };
  const dept = departments.find(d => d.id === resource.id);
  if (!dept) throw new SCIMMY.Types.Error(404, null, `Group ${resource.id} not found`);
  // Clear the department assignment from every member before removing it —
  // deleteDepartment itself doesn't touch member.deptId, so do it explicitly
  // rather than leave dangling references.
  const { members } = org?.listMembers?.(orgId) || { members: [] };
  for (const m of members.filter(m => m.deptId === dept.id)) {
    _try(() => org?.updateMemberDepartmentViaScim?.(orgId, m.accountId, null));
  }
  _try(() => org?.deleteDepartment?.(orgId, dept.id, _scimSystemActorFor(orgId)));
  auditLog.append({ type: "scim.group_deleted", orgId, deptId: dept.id, ts: _ts() });
}

// createDepartment/updateDepartment/deleteDepartment are gated on
// manage_departments against a requestingAccountId — a SCIM push has no
// human requester, only the org's own manage_scim-authorized connection.
// The org_owner who set up SCIM is the closest real, permitted actor to
// attribute these department mutations to (they hold manage_departments by
// construction), so resolve to them rather than adding yet another
// bypass-permission function for a rarer, lower-stakes operation
// (department CRUD, unlike user/membership mutation, isn't security-critical
// enough to warrant its own *ViaScim variant in organizationService.cjs).
function _scimSystemActorFor(orgId) {
  const { members } = _org()?.listMembers?.(orgId) || { members: [] };
  return members.find(m => m.orgRole === "org_owner")?.accountId || null;
}
function _createDepartmentViaScim(orgId, displayName) {
  return _org()?.createDepartment?.(orgId, { name: displayName || "SCIM Group" }, _scimSystemActorFor(orgId));
}

module.exports = {
  getScimToken,
  rotateScimToken,
  deleteScimToken,
  verifyScimBearer,
  egressUsers,
  ingressUser,
  degressUser,
  egressGroups,
  ingressGroup,
  degressGroup,
};
