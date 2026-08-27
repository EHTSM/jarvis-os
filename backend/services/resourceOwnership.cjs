"use strict";
/**
 * resourceOwnership.cjs — Mission 51: shared IDOR ownership check.
 *
 * Reused by mission.js, collaboration.js, pipeline.js, autonomousAgent.js —
 * four separate route files that each need the identical "does this caller
 * own this resource" check against a bare-ID-keyed record (missionMemory
 * missions, pipeline runs, autonomous-agent missions). Not a duplicate of
 * orgMiddleware.cjs's attachOrg/requireOrgMember (those resolve org context
 * from a :orgId path param/header before a resource is even loaded); this
 * checks a resource *instance* already fetched by its own bare ID.
 *
 * Core rule (per MISSION-PLAN-BACKEND-TENANT-ISOLATION-FIX.md and
 * missionMemory.cjs's own header comment — orgId is OPTIONAL by design):
 *   - resource has no orgId  → allow (shared/operator resource, unchanged
 *     behavior — this is the majority of existing production data).
 *   - resource has an orgId  → caller must be a member of that org, OR hold
 *     a cross-org grant for it, OR be a global enterprise_admin — the exact
 *     same three-way exception list requireOrgMember() already uses
 *     (backend/middleware/orgMiddleware.cjs).
 *
 * Never trusts a client-supplied orgId/workspaceId/role header as proof of
 * ownership — caller org membership is always resolved server-side from
 * organizationService.resolveContext(req.user.sub).
 */

let _orgSvc = null;
function _svc() {
    if (!_orgSvc) _orgSvc = require("./organizationService.cjs");
    return _orgSvc;
}

/**
 * Extract a resource's owning orgId. Real mission records in production
 * data store this under metadata.orgId (organizationService.createMissionForOrg's
 * shape); missionMemory.cjs's own _buildMission also supports a top-level
 * data.orgId for direct callers. Check both so neither shape is missed.
 */
function _resourceOrgId(resource) {
    return resource?.orgId || resource?.metadata?.orgId || null;
}

/**
 * isOwnable(req, resource) → boolean
 * Does NOT throw or respond — callers decide how to signal denial (this
 * codebase's convention is 404, not 403, for cross-tenant access, so the
 * caller should typically throw/return the same "not found" shape used for
 * a genuinely missing resource — see orgMiddleware.cjs's own comment on not
 * distinguishing "exists but forbidden" from "doesn't exist").
 */
function isOwnable(req, resource) {
    if (!resource) return true; // let the caller's own 404 logic handle a missing resource
    const orgId = _resourceOrgId(resource);
    if (!orgId) return true; // shared/operator resource — unchanged, intentional behavior

    const accountId = req.user?.sub;
    if (!accountId) return false;

    const svc = _svc();
    const ctx = svc.resolveContext(accountId);
    if ((ctx.orgs || []).some(o => o.orgId === orgId)) return true;
    if (svc.isEnterpriseAdmin(accountId)) return true;
    if (svc.listGrantsForAccount(accountId).some(g => g.orgId === orgId)) return true;

    return false;
}

/**
 * assertOwnable(req, resource, notFoundMessage)
 * Throws an Error whose message matches this codebase's existing
 * `err.message.includes("not found")` status-mapping convention (see
 * mission.js's _send/_sendAsync, pipeline.js's _err, etc.) so callers can
 * route ownership denial through their existing 404 handling with zero new
 * error-handling code.
 */
function assertOwnable(req, resource, notFoundMessage = "Resource not found") {
    if (!isOwnable(req, resource)) {
        throw new Error(notFoundMessage);
    }
    return resource;
}

module.exports = { isOwnable, assertOwnable };
