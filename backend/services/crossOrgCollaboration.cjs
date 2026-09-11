"use strict";
/**
 * crossOrgCollaboration.cjs — V5 Global AI Organization Platform,
 * Module 4: Cross-Organization Collaboration.
 *
 * Secure company-to-company (two REAL, independent organizationService.cjs
 * orgs) collaboration, built entirely on that service's existing real
 * grant mechanism — grantOrgAccess/revokeOrgAccess/listOrgGrants — rather
 * than a new permission system.
 *
 * Explicitly NOT reused: organizationCollaborationEngine.cjs (POST-Ω P20
 * Artificial Organization Network). That file operates on
 * organizationRegistryEngine's SIMULATED platform organizations (the
 * AI-agent-run companies from earlier missions), not real
 * organizationService.cjs orgs with real human accounts/RBAC — building
 * real cross-org data sharing on top of it would violate "no fake data."
 * Confirmed by reading its file header and _reg()/_wf()/_mesh() deps
 * before writing any of this file.
 *
 * grantOrgAccess grants an INDIVIDUAL account access to an org — the
 * primitive it was built for is "a portfolio owner/agency account acting
 * across orgs it doesn't belong to," same-tenant-operator shaped. Two
 * independent companies collaborating is a different shape: it needs
 * MUTUAL CONSENT (both org_owners agree, not one org unilaterally
 * granting), and a SAFE, curated permission subset — collaboration must
 * never imply access to the other org's billing, SSO/SCIM/policy config,
 * audit log, or AI usage; those stay accessible only via the existing
 * grantOrgAccess path for actual same-tenant operators. This file adds
 * that consent workflow on top of the existing grant call, and once
 * accepted, the real org.hasPermission() checks everywhere else in this
 * codebase are what actually enforce the resulting access — no second
 * permission engine.
 *
 * Storage: data/cross-org-collaborations.json — the collaboration
 * proposal/acceptance workflow state only. The resulting real access
 * grant is recorded exactly where every other grant is recorded:
 * data/org-grants.json, via organizationService itself.
 */

const fs   = require("fs");
const path = require("path");

const DATA = path.join(__dirname, "../../data/cross-org-collaborations.json");
const MAX_RECORDS = 2000;

// Deliberately excludes anything admin/billing/security-shaped —
// delete_org, manage_billing, manage_sso/scim/policy, view_audit_log,
// use_ai, manage_members are never shareable across a company boundary
// through this workflow, only through grantOrgAccess directly (for real
// same-tenant operators, which this is not).
const SHAREABLE_PERMISSIONS = ["view_members", "view_departments", "view_teams", "view_missions", "create_mission"];

const _try = fn => { try { return fn(); } catch { return null; } };
const _org = () => _try(() => require("./organizationService.cjs"));

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch { return { collaborations: [] }; }
}
function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.collaborations.length > MAX_RECORDS) d.collaborations = d.collaborations.slice(-MAX_RECORDS);
  const tmp = DATA + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(d, null, 2));
  fs.renameSync(tmp, DATA);
}
function _id() { return `xorg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }
function _ts() { return new Date().toISOString(); }

function _assertOwner(orgId, accountId) {
  // Cross-company sharing is a decision only the org's real owner should
  // make on its behalf — same bar grantOrgAccess itself already enforces
  // (delete_org, org_owner-only), reused here rather than inventing a
  // second ownership check.
  if (!_org()?.hasPermission?.(orgId, accountId, "delete_org")) {
    const e = new Error("Forbidden — only this organization's owner can propose or accept cross-org collaboration");
    e.status = 403;
    throw e;
  }
}

/** Org A's owner proposes sharing a curated permission subset with Org B.
 * Nothing is granted yet — this only creates a pending proposal Org B's
 * owner must explicitly accept. */
function propose(fromOrgId, toOrgId, permissions, requestingAccountId) {
  if (!fromOrgId || !toOrgId) throw new Error("fromOrgId and toOrgId required");
  if (fromOrgId === toOrgId) throw new Error("Cannot propose collaboration with the same organization");
  if (!Array.isArray(permissions) || !permissions.length) throw new Error("permissions must be a non-empty array");
  const unsafe = permissions.filter(p => !SHAREABLE_PERMISSIONS.includes(p));
  if (unsafe.length) throw new Error(`Not shareable via cross-org collaboration: ${unsafe.join(", ")}. Allowed: ${SHAREABLE_PERMISSIONS.join(", ")}`);

  _assertOwner(fromOrgId, requestingAccountId);
  if (!_org()?.getOrg?.(toOrgId)) throw Object.assign(new Error("Target organization not found"), { status: 404 });

  const d = _load();
  const record = {
    id: _id(), fromOrgId, toOrgId, permissions,
    status: "pending", proposedBy: requestingAccountId,
    proposedAt: _ts(), respondedAt: null, respondedBy: null,
  };
  d.collaborations.push(record);
  _save(d);
  return record;
}

/** Org B's owner accepts — this is the one moment a real grant is issued,
 * via organizationService.grantOrgAccess itself (not a copy of its logic).
 * The grantee is Org B's own owner account, so Org B's owner (and by
 * extension Org B's real RBAC — whoever Org B's owner delegates to
 * in-org) is who actually gets access to Org A's shared resources; this
 * file never grants access to individual Org B members directly. */
function accept(collaborationId, requestingAccountId) {
  const d = _load();
  const record = d.collaborations.find(c => c.id === collaborationId);
  if (!record) throw Object.assign(new Error("Collaboration proposal not found"), { status: 404 });
  if (record.status !== "pending") throw Object.assign(new Error(`Cannot accept a collaboration in status "${record.status}"`), { status: 409 });

  _assertOwner(record.toOrgId, requestingAccountId);

  const toOrg = _org()?.getOrg?.(record.toOrgId);
  const toOwner = toOrg?.members?.find(m => m.orgRole === "org_owner");
  if (!toOwner) throw new Error("Target organization has no resolvable owner account");

  _org().grantOrgAccess(record.fromOrgId, toOwner.accountId, record.permissions, record.proposedBy);

  record.status = "accepted";
  record.respondedAt = _ts();
  record.respondedBy = requestingAccountId;
  _save(d);
  return record;
}

function reject(collaborationId, requestingAccountId) {
  const d = _load();
  const record = d.collaborations.find(c => c.id === collaborationId);
  if (!record) throw Object.assign(new Error("Collaboration proposal not found"), { status: 404 });
  if (record.status !== "pending") throw Object.assign(new Error(`Cannot reject a collaboration in status "${record.status}"`), { status: 409 });

  _assertOwner(record.toOrgId, requestingAccountId);
  record.status = "rejected";
  record.respondedAt = _ts();
  record.respondedBy = requestingAccountId;
  _save(d);
  return record;
}

/** Either side's real owner can revoke an already-accepted collaboration —
 * this calls the real revokeOrgAccess, removing the real grant, not just
 * marking this workflow record stale. */
function revoke(collaborationId, requestingAccountId) {
  const d = _load();
  const record = d.collaborations.find(c => c.id === collaborationId);
  if (!record) throw Object.assign(new Error("Collaboration proposal not found"), { status: 404 });
  if (record.status !== "accepted") throw Object.assign(new Error(`Cannot revoke a collaboration in status "${record.status}"`), { status: 409 });

  // Either org's real owner may TRIGGER a revoke — Org A ending a
  // collaboration it granted, or Org B declining to keep receiving
  // access it accepted, are both legitimate — but organizationService.
  // revokeOrgAccess itself only recognizes fromOrgId's real delete_org
  // permission (it was built for "the org that owns the resource revokes
  // access to it," the same shape as grantOrgAccess). Confirmed by
  // testing: Org B's owner calling revokeOrgAccess(fromOrgId, ...)
  // directly fails, since they have no delete_org permission ON Org A.
  // So the underlying real call is always made as fromOrgId's CURRENT
  // real owner (looked up fresh, not record.proposedBy, in case
  // ownership was transferred since the proposal); this file's OWN
  // permission check above is what actually authorizes Org B's owner to
  // trigger it.
  const isFromOwner = _try(() => _org()?.hasPermission?.(record.fromOrgId, requestingAccountId, "delete_org"));
  const isToOwner   = _try(() => _org()?.hasPermission?.(record.toOrgId, requestingAccountId, "delete_org"));
  if (!isFromOwner && !isToOwner) {
    const e = new Error("Forbidden — only one of the two organizations' owners can revoke this collaboration");
    e.status = 403;
    throw e;
  }

  const fromOrg = _org()?.getOrg?.(record.fromOrgId);
  const fromOwner = fromOrg?.members?.find(m => m.orgRole === "org_owner");
  const toOrg = _org()?.getOrg?.(record.toOrgId);
  const toOwner = toOrg?.members?.find(m => m.orgRole === "org_owner");
  if (toOwner && fromOwner) _org().revokeOrgAccess(record.fromOrgId, toOwner.accountId, fromOwner.accountId);

  record.status = "revoked";
  record.respondedAt = _ts();
  record.respondedBy = requestingAccountId;
  _save(d);
  return record;
}

/** Real collaboration state for one org — both proposals it sent and
 * proposals it received, so either side can see the same real record. */
function listForOrg(orgId, requestingAccountId) {
  if (!_org()?.hasPermission?.(orgId, requestingAccountId, "view_members")) {
    const e = new Error("Forbidden — not a member of this organization");
    e.status = 403;
    throw e;
  }
  const d = _load();
  return d.collaborations.filter(c => c.fromOrgId === orgId || c.toOrgId === orgId);
}

module.exports = { SHAREABLE_PERMISSIONS, propose, accept, reject, revoke, listForOrg };
