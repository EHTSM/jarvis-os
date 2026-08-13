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
    if (req.orgRole) return next();
    // Not a member — but a cross-org grant or global enterprise_admin role
    // (Module 6) also counts as legitimate access to this org.
    const accountId = req.user?.sub;
    const svc = _svc();
    if (accountId && (svc.isEnterpriseAdmin(accountId) || svc.listGrantsForAccount(accountId).some(g => g.orgId === req.org.id))) {
        return next();
    }
    return res.status(403).json({ error: "Not a member of this organization" });
}

function requireOrgPermission(action) {
    return (req, res, next) => {
        if (!req.org)                                        return res.status(404).json({ error: "Organization not found" });
        const accountId = req.user?.sub;
        if (!accountId)                                      return res.status(401).json({ error: "Unauthorized" });
        if (!_svc().hasPermission(req.org.id, accountId, action)) {
            return res.status(403).json({ error: `Forbidden — requires permission: ${action}` });
        }
        next();
    };
}

module.exports = { attachOrg, requireOrgMember, requireOrgPermission };
