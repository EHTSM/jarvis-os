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
        const orgId     = req.headers["x-org-id"] || req.query.orgId || req.body?.orgId;

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
    if (!req.org)     return res.status(404).json({ error: "Organization not found or not specified" });
    if (!req.orgRole) return res.status(403).json({ error: "Not a member of this organization" });
    next();
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
