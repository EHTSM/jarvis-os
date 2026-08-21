"use strict";
/**
 * orgMiddleware.cjs — Phase M1: Organization-aware request middleware
 *
 * Attaches req.org and req.orgRole from:
 *   1. X-Org-Id header  (preferred for API clients)
 *   2. req.query.orgId  (URL param fallback)
 *   3. req.body.orgId   (body fallback)
 *   4. auto-resolve from req.user.sub (first org membership)
 *
 * Does NOT block requests — use requireOrgMember() for enforcement.
 */

let _orgSvc = null;
function _svc() {
    if (!_orgSvc) _orgSvc = require("../services/organizationService.cjs");
    return _orgSvc;
}

function attachOrg(req, res, next) {
    try {
        const accountId = req.user?.sub;
        // Precedence: an :orgId PATH PARAM wins over the X-Org-Id header.
        //
        // Phase B.7: the header used to win unconditionally, which made every
        // route shaped `/orgs/:orgId/...` (gated by requireOrgPermission, but
        // reading req.params.orgId in the handler) a confused deputy — the
        // permission check ran against the HEADER's org while the handler
        // served the PATH's org. Reproduced 3/3 live: an account that is a
        // member of org A only, requesting
        //     GET /orgs/<orgB>/members   with   X-Org-Id: <orgA>
        // was authorized as org A's owner and received org B's member roster.
        // Without the header the same request correctly returned 403.
        // Confirmed on /members, /departments and /teams.
        //
        // The path param identifies the RESOURCE being addressed, so it is the
        // only correct authorization subject when present; the header remains
        // the tenant selector for routes that carry no :orgId (e.g. /crm/lead).
        // This narrows what the header can do — it can no longer disagree with
        // the addressed resource — and never widens access.
        const orgId     = req.params?.orgId || req.headers["x-org-id"] || req.query.orgId || req.body?.orgId;

        if (orgId) {
            req.org     = _svc().getOrg(orgId) || null;
            req.orgRole = accountId ? _svc().getMemberRole(orgId, accountId) : null;
        } else if (accountId) {
            // Auto-resolve from first org membership
            const ctx   = _svc().resolveContext(accountId);
            req.orgCtx  = ctx;
            if (ctx.primaryOrg) {
                req.org     = _svc().getOrg(ctx.primaryOrg.orgId) || null;
                req.orgRole = ctx.primaryOrg.orgRole;
            }
        }
    } catch {
        req.org     = null;
        req.orgRole = null;
    }
    next();
}

function requireOrgMember(req, res, next) {
    if (!req.org) return res.status(404).json({ error: "Organization not found or not specified" });
    // OOPLIX V1 MASTER AUDIT (2026-08-16, org-deletion lifecycle audit):
    // live-reproduced that an org's owner could still freely read AND write
    // tenant data (real POST /business/leads succeeded) after archiving
    // their own org — "archive" (soft-delete) had no actual access effect,
    // only hiding the org from listOrgs()'s default view. This is the
    // ordinary tenant-data gate (business.js's _requireOrg, and every other
    // route composing requireOrgMember), NOT requireOrgPermission — the
    // org-management routes (archive/restore/purge in organizations.js) use
    // requireOrgPermission and are deliberately untouched here, since
    // restore() and purge() both legitimately need to act on an already-
    // archived org. An archived org is correctly treated as not-found for
    // ordinary tenant-data access — 404, not 403, matching this codebase's
    // established convention of not distinguishing "exists but forbidden"
    // from "doesn't exist" for a caller with no legitimate reason to know.
    if (req.org.status === "archived") return res.status(404).json({ error: "Organization not found or not specified" });
    if (req.orgRole) return next();
    // Not a member — but a cross-org grant or global enterprise_admin role
    // (Module 6) also counts as legitimate access to this org.
    const accountId = req.user?.sub;
    const svc = _svc();
    if (accountId && (svc.isEnterpriseAdmin(accountId) || svc.listGrantsForAccount(accountId).some(g => g.orgId === req.org.id))) {
        return next();
    }
    // OOPLIX V1 MASTER AUDIT (2026-08-16): same audit-trail gap fixed for
    // operatorOnly — a real cross-tenant access attempt against a specific
    // org (not merely "wrong role", but "targeting someone else's real
    // org") left zero forensic trail. Meaningful, low-volume signal (an
    // authenticated account with a resolved org context that still isn't a
    // member), not the high-volume 401/404 "no org at all" cases above.
    try {
        require("../utils/auditLog.cjs").recordAuth({
            action: "org_access_denied", operator: req.user, method: `${req.path}::${req.org.id}`,
        });
    } catch { /* audit logging must never block the actual denial */ }
    return res.status(403).json({ error: "Not a member of this organization" });
}

function requireOrgPermission(action) {
    return (req, res, next) => {
        if (!req.org)                                        return res.status(404).json({ error: "Organization not found" });
        const accountId = req.user?.sub;
        if (!accountId)                                      return res.status(401).json({ error: "Unauthorized" });
        if (!_svc().hasPermission(req.org.id, accountId, action)) {
            try {
                require("../utils/auditLog.cjs").recordAuth({
                    action: "org_permission_denied", operator: req.user, method: `${action}@${req.org.id}`,
                });
            } catch { /* audit logging must never block the actual denial */ }
            return res.status(403).json({ error: `Forbidden — requires permission: ${action}` });
        }
        next();
    };
}

module.exports = { attachOrg, requireOrgMember, requireOrgPermission };
