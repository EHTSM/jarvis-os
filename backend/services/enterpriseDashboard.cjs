"use strict";
/**
 * enterpriseDashboard.cjs — Enterprise & Physical Integration Mission,
 * Module 8: Enterprise Dashboard.
 *
 * Pure aggregation over Modules 1-7 plus pre-existing systems — no new
 * storage, no new computation beyond simple derived scores. Every section
 * below is a thin composition call into a service this mission (or an
 * earlier one) already built and already verified independently:
 *
 *   overview:    organizationService.getOrg + getOrgBillingOverview
 *   compliance:  derived posture score from real Module 1/4 config
 *     (SSO configured? MFA required org-wide? password policy set?) —
 *     not a new compliance database, a read of existing config state.
 *   security:    ssoService.getSsoConfig + policyService.getPolicy +
 *     auditService.getPermissionHistory — "what security controls are
 *     active" read from where each one is actually stored.
 *   users:       organizationService.listMembers + accountService.getById
 *   devices:     per-member MFA enrollment (policyService.isMfaEnrolled)
 *     + last real login method/timestamp (auditService.searchAuditLog).
 *     Deliberately NOT a device/session list — this codebase's auth is
 *     stateless JWT-in-cookie with no session store, so there is no real
 *     "active device" inventory to report; fabricating one would be
 *     dashboard theater over data that doesn't exist. What IS real and
 *     useful here is exactly this: how each member last authenticated.
 *   ai:          enterpriseMonitoring.getAiUsageHealth (Module 7)
 *   billing:     organizationService.getOrgBillingOverview
 *   connectors:  enterpriseMonitoring.getConnectorHealth (Module 7)
 *   analytics:   composed request/error/usage figures already exposed by
 *     /metrics/* (platform-wide) plus the org-scoped figures above —
 *     kept minimal since a full analytics engine already exists
 *     elsewhere in this codebase (analyticsService.cjs) for depth beyond
 *     this dashboard's overview role.
 */

const _try = fn => { try { return fn(); } catch { return null; } };
const _org      = () => _try(() => require("./organizationService.cjs"));
const _sso       = () => _try(() => require("./ssoService.cjs"));
const _policy    = () => _try(() => require("./policyService.cjs"));
const _audit     = () => _try(() => require("./auditService.cjs"));
const _monitoring = () => _try(() => require("./enterpriseMonitoring.cjs"));
const _accounts  = () => _try(() => require("./accountService"));

// ── Overview ──────────────────────────────────────────────────────────────────

function getOverview(orgId, requestingAccountId) {
  const org = _org()?.getOrg?.(orgId);
  if (!org) return { ok: false, error: "Organization not found" };
  let billing = null;
  try { billing = _org()?.getOrgBillingOverview?.(orgId, requestingAccountId); } catch { /* requires manage_billing */ }
  return {
    ok: true, orgId, name: org.name, slug: org.slug, plan: org.plan, status: org.status,
    memberCount: org.memberCount, deptCount: org.deptCount, createdAt: org.createdAt,
    billingSummary: billing ? { byPlan: billing.byPlan, byStatus: billing.byStatus } : null,
  };
}

// ── Compliance posture (derived, not a new database) ────────────────────────

function getCompliance(orgId) {
  const policy = _policy()?.getPolicy?.(orgId) || {};
  const ssoConfig = _try(() => _sso()?.getSsoConfig?.(orgId));
  const checks = [
    { id: "sso_configured", label: "Enterprise SSO configured", pass: !!ssoConfig?.enabled },
    { id: "mfa_required", label: "MFA required org-wide", pass: !!policy.mfa?.required },
    { id: "password_policy_hardened", label: "Password policy exceeds 8-char default", pass: (policy.password?.minLength || 8) > 8 },
    { id: "connector_restrictions_set", label: "Connector allow/deny list configured", pass: !!(policy.connectorRestrictions?.allow?.length || policy.connectorRestrictions?.deny?.length) },
    // B25-01/GG-1 closure (2026-08-16): assertIpAllowed() is now called from
    // the 4 enterprise route files' own membership checks (policy/audit/
    // monitoring/dashboard) — real enforcement, not just storage. A
    // configured allowlist now genuinely restricts access to those routes.
    { id: "ip_allowlist_set", label: "IP allowlist configured", pass: !!policy.ipAllowlist?.length,
      configured: !!policy.ipAllowlist?.length, enforced: true,
      note: "Enforced on /enterprise/policy, /enterprise/audit, /enterprise/monitoring, and /enterprise/dashboard routes." },
  ];
  const passed = checks.filter(c => c.pass).length;
  return { ok: true, orgId, score: Math.round((passed / checks.length) * 100), checks };
}

// ── Security controls (where each is actually stored/enforced) ──────────────

function getSecurity(orgId) {
  const policy = _policy()?.getPolicy?.(orgId) || {};
  const ssoConfig = _try(() => _sso()?.getSsoConfig?.(orgId));
  const permissionHistory = _try(() => _audit()?.getPermissionHistory?.(orgId, { limit: 10 }));
  return {
    ok: true, orgId,
    sso: ssoConfig ? { provider: ssoConfig.provider, enabled: ssoConfig.enabled, allowedDomains: ssoConfig.allowedDomains || [] } : null,
    mfaRequired: !!policy.mfa?.required,
    sessionTimeoutSeconds: policy.sessionTimeoutSeconds || null,
    allowedProviders: policy.allowedProviders || null,
    ipAllowlistSize: policy.ipAllowlist?.length || 0,
    // B25-01/GG-1 closure (2026-08-16): enforced for real on the 4 enterprise
    // route files (policy/audit/monitoring/dashboard). See policyService.cjs's
    // assertIpAllowed().
    ipAllowlistEnforced: true,
    ipAllowlistNote: "IP allowlist is enforced on /enterprise/policy, /enterprise/audit, /enterprise/monitoring, and /enterprise/dashboard routes.",
    recentPermissionEvents: permissionHistory?.entries?.slice(0, 10) || [],
  };
}

// ── Users ─────────────────────────────────────────────────────────────────────

function getUsers(orgId) {
  const result = _try(() => _org()?.listMembers?.(orgId));
  if (!result) return { ok: false, error: "Organization not found" };
  const accounts = _accounts();
  const members = result.members.map(m => {
    const account = accounts?.getById?.(m.accountId);
    return {
      accountId: m.accountId, orgRole: m.orgRole, deptId: m.deptId, teamId: m.teamId, joinedAt: m.joinedAt,
      email: account?.email || null, name: account?.name || null, active: account?.active ?? null,
    };
  });
  return { ok: true, orgId, total: members.length, members };
}

// ── Devices — per-member login method/MFA summary (see file header for why
// this is NOT a device/session inventory) ───────────────────────────────────

function getDevices(orgId) {
  const result = _try(() => _org()?.listMembers?.(orgId));
  if (!result) return { ok: false, error: "Organization not found" };
  const accounts = _accounts();
  const policy = _policy();
  const audit = _audit();
  const members = result.members.map(m => {
    const account = accounts?.getById?.(m.accountId);
    // Both real login event shapes carry the method directly:
    // login.password -> { method: "password" }, sso.login -> { provider: "saml"|"oidc"|"google"|"entra" }.
    // Neither typePrefix "login" nor "sso.login" alone covers both, so this
    // queries both real event types and takes whichever is more recent.
    const passwordLogins = audit?.searchAuditLog?.({ orgId, accountId: m.accountId, type: "login.password", limit: 1 });
    const ssoLogins = audit?.searchAuditLog?.({ orgId, accountId: m.accountId, type: "sso.login", limit: 1 });
    const candidates = [...(passwordLogins?.entries || []), ...(ssoLogins?.entries || [])];
    candidates.sort((a, b) => new Date(b.ts) - new Date(a.ts));
    const lastLogin = candidates[0] || null;
    return {
      accountId: m.accountId, email: account?.email || null,
      mfaEnrolled: !!policy?.isMfaEnrolled?.(m.accountId),
      lastLoginMethod: lastLogin ? (lastLogin.method || lastLogin.provider || null) : null,
      lastLoginAt: lastLogin?.ts || null,
    };
  });
  return { ok: true, orgId, note: "No real device/session inventory exists in this codebase (stateless JWT auth, no session store) — this reports each member's real last-known login method and MFA enrollment instead.", members };
}

// ── AI / Billing / Connectors — direct passthrough to Module 7 + existing billing ─

function getAiSummary(orgId) { return _monitoring()?.getAiUsageHealth?.(orgId) || { ok: false }; }
function getBillingSummary(orgId, requestingAccountId) {
  try { return { ok: true, ..._org()?.getOrgBillingOverview?.(orgId, requestingAccountId) }; }
  catch (e) { return { ok: false, error: e.message, status: e.status }; }
}
function getConnectorsSummary(orgId) { return _monitoring()?.getConnectorHealth?.(orgId) || { ok: false }; }

// ── Analytics (minimal composed overview — analyticsService.cjs owns depth) ──

function getAnalytics(orgId) {
  const ai = getAiSummary(orgId);
  const connectors = getConnectorsSummary(orgId);
  const compliance = getCompliance(orgId);
  return {
    ok: true, orgId,
    aiRequestsSampled: ai.requestsLast1000 || 0,
    aiCostUsdSampled: ai.totalCostUsdSampled || 0,
    connectorScore: connectors.score ?? null,
    complianceScore: compliance.score ?? null,
  };
}

// ── Full dashboard — everything above in one call ────────────────────────────

function getFullDashboard(orgId, requestingAccountId) {
  return {
    ok: true, orgId, generatedAt: new Date().toISOString(),
    overview:   getOverview(orgId, requestingAccountId),
    compliance: getCompliance(orgId),
    security:   getSecurity(orgId),
    users:      getUsers(orgId),
    devices:    getDevices(orgId),
    ai:         getAiSummary(orgId),
    billing:    getBillingSummary(orgId, requestingAccountId),
    connectors: getConnectorsSummary(orgId),
    analytics:  getAnalytics(orgId),
  };
}

module.exports = {
  getOverview, getCompliance, getSecurity, getUsers, getDevices,
  getAiSummary, getBillingSummary, getConnectorsSummary, getAnalytics,
  getFullDashboard,
};
