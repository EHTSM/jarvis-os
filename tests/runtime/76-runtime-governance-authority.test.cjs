"use strict";
const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const authority  = require("../../agents/runtime/governance/runtimeAuthorityManager.cjs");
const perms      = require("../../agents/runtime/governance/executionPermissionEngine.cjs");
const trust      = require("../../agents/runtime/governance/trustBoundaryController.cjs");
const decisions  = require("../../agents/runtime/governance/governanceDecisionEngine.cjs");
const risk       = require("../../agents/runtime/governance/runtimeRiskClassifier.cjs");
const privilege  = require("../../agents/runtime/governance/privilegeIsolationManager.cjs");
const approval   = require("../../agents/runtime/governance/actionApprovalCoordinator.cjs");

// ── runtimeAuthorityManager ───────────────────────────────────────────
describe("runtimeAuthorityManager", () => {
    beforeEach(() => authority.reset());

    it("registers authority and returns authorityId", () => {
        const r = authority.registerAuthority({ principalId: "svc-1", level: "operator" });
        assert.equal(r.registered, true);
        assert.ok(r.authorityId.startsWith("auth-"));
        assert.equal(r.level, "operator");
    });

    it("rejects registration without principalId", () => {
        const r = authority.registerAuthority({ level: "operator" });
        assert.equal(r.registered, false);
        assert.equal(r.reason, "principalId_required");
    });

    it("rejects registration without level", () => {
        const r = authority.registerAuthority({ principalId: "svc-1" });
        assert.equal(r.registered, false);
        assert.equal(r.reason, "level_required");
    });

    it("rejects invalid authority level", () => {
        const r = authority.registerAuthority({ principalId: "svc-1", level: "superuser" });
        assert.equal(r.registered, false);
        assert.ok(r.reason.startsWith("invalid_level"));
    });

    it("prevents root-runtime without explicit allow", () => {
        const r = authority.registerAuthority({ principalId: "svc-1", level: "root-runtime" });
        assert.equal(r.registered, false);
        assert.equal(r.reason, "root_runtime_requires_explicit_allow");
    });

    it("grants root-runtime with explicit allow", () => {
        const r = authority.registerAuthority({ principalId: "svc-root", level: "root-runtime", allowRootRuntime: true });
        assert.equal(r.registered, true);
        assert.equal(r.level, "root-runtime");
    });

    it("prevents duplicate authority registration for same principal", () => {
        authority.registerAuthority({ principalId: "svc-1", level: "operator" });
        const r = authority.registerAuthority({ principalId: "svc-1", level: "controller" });
        assert.equal(r.registered, false);
        assert.equal(r.reason, "principal_already_has_authority");
    });

    it("validateAuthority returns canPerform=true when level sufficient", () => {
        authority.registerAuthority({ principalId: "svc-1", level: "controller" });
        const r = authority.validateAuthority({ principalId: "svc-1", requiredLevel: "operator" });
        assert.equal(r.valid, true);
        assert.equal(r.canPerform, true);
    });

    it("validateAuthority returns canPerform=false when level insufficient", () => {
        authority.registerAuthority({ principalId: "svc-1", level: "operator" });
        const r = authority.validateAuthority({ principalId: "svc-1", requiredLevel: "governor" });
        assert.equal(r.canPerform, false);
    });

    it("validateAuthority returns valid=false for unknown principal", () => {
        const r = authority.validateAuthority({ principalId: "ghost", requiredLevel: "observer" });
        assert.equal(r.valid, false);
        assert.equal(r.canPerform, false);
    });

    it("revokeAuthority deactivates the authority", () => {
        const reg = authority.registerAuthority({ principalId: "svc-1", level: "operator" });
        const rev = authority.revokeAuthority({ authorityId: reg.authorityId });
        assert.equal(rev.revoked, true);
        const v = authority.validateAuthority({ principalId: "svc-1", requiredLevel: "observer" });
        assert.equal(v.canPerform, false);
    });

    it("refuses to revoke already-revoked authority", () => {
        const reg = authority.registerAuthority({ principalId: "svc-1", level: "operator" });
        authority.revokeAuthority({ authorityId: reg.authorityId });
        const r = authority.revokeAuthority({ authorityId: reg.authorityId });
        assert.equal(r.revoked, false);
        assert.equal(r.reason, "authority_already_revoked");
    });

    it("AUTHORITY_LEVELS exports all 5 levels in order", () => {
        assert.equal(authority.AUTHORITY_LEVELS.length, 5);
        assert.equal(authority.AUTHORITY_LEVELS[0], "observer");
        assert.equal(authority.AUTHORITY_LEVELS[4], "root-runtime");
    });

    it("AUTHORITY_RANK assigns higher numbers to higher levels", () => {
        assert.ok(authority.AUTHORITY_RANK["root-runtime"] > authority.AUTHORITY_RANK["observer"]);
        assert.ok(authority.AUTHORITY_RANK["governor"]     > authority.AUTHORITY_RANK["controller"]);
    });

    it("getAuthorityMetrics tracks rootCount", () => {
        authority.registerAuthority({ principalId: "root", level: "root-runtime", allowRootRuntime: true });
        authority.registerAuthority({ principalId: "op",   level: "operator" });
        const m = authority.getAuthorityMetrics();
        assert.equal(m.rootCount, 1);
        assert.equal(m.activeCount, 2);
    });
});

// ── executionPermissionEngine ─────────────────────────────────────────
describe("executionPermissionEngine", () => {
    beforeEach(() => perms.reset());

    it("grants a permission and returns permId", () => {
        const r = perms.grantPermission({ principalId: "svc-1", action: "execute" });
        assert.equal(r.granted, true);
        assert.ok(r.permId.startsWith("perm-"));
    });

    it("rejects grant without principalId", () => {
        const r = perms.grantPermission({ action: "execute" });
        assert.equal(r.granted, false);
        assert.equal(r.reason, "principalId_required");
    });

    it("rejects grant without action", () => {
        const r = perms.grantPermission({ principalId: "svc-1" });
        assert.equal(r.granted, false);
        assert.equal(r.reason, "action_required");
    });

    it("rejects invalid action", () => {
        const r = perms.grantPermission({ principalId: "svc-1", action: "nuke" });
        assert.equal(r.granted, false);
        assert.ok(r.reason.startsWith("invalid_action"));
    });

    it("rejects root_access without root-runtime grantingAuthority", () => {
        const r = perms.grantPermission({ principalId: "svc-1", action: "root_access", grantingAuthority: "governor" });
        assert.equal(r.granted, false);
        assert.equal(r.reason, "root_access_requires_root_runtime_authority");
    });

    it("grants root_access with root-runtime grantingAuthority", () => {
        const r = perms.grantPermission({ principalId: "svc-root", action: "root_access", grantingAuthority: "root-runtime" });
        assert.equal(r.granted, true);
    });

    it("checkPermission denies by default with no grant", () => {
        const r = perms.checkPermission({ principalId: "svc-ghost", action: "execute" });
        assert.equal(r.allowed, false);
        assert.equal(r.reason, "no_permission_grant");
    });

    it("checkPermission allows after explicit grant", () => {
        perms.grantPermission({ principalId: "svc-1", action: "observe" });
        const r = perms.checkPermission({ principalId: "svc-1", action: "observe" });
        assert.equal(r.allowed, true);
    });

    it("checkPermission denies after revocation", () => {
        const g = perms.grantPermission({ principalId: "svc-1", action: "schedule" });
        perms.revokePermission({ permId: g.permId });
        const r = perms.checkPermission({ principalId: "svc-1", action: "schedule" });
        assert.equal(r.allowed, false);
        assert.equal(r.reason, "no_permission_grant");
    });

    it("deny-by-default: no permission for any action without grant", () => {
        for (const action of ["observe", "execute", "govern", "quarantine"]) {
            const r = perms.checkPermission({ principalId: "no-grants", action });
            assert.equal(r.allowed, false, `expected deny for ${action}`);
        }
    });

    it("prevents duplicate grant for same principal+action", () => {
        perms.grantPermission({ principalId: "svc-1", action: "execute" });
        const r = perms.grantPermission({ principalId: "svc-1", action: "execute" });
        assert.equal(r.granted, false);
        assert.equal(r.reason, "permission_already_granted");
    });

    it("revokePermission requires permId", () => {
        const r = perms.revokePermission({});
        assert.equal(r.revoked, false);
        assert.equal(r.reason, "permId_required");
    });

    it("listPermissions returns only active grants for principal", () => {
        perms.grantPermission({ principalId: "svc-1", action: "observe" });
        perms.grantPermission({ principalId: "svc-1", action: "execute" });
        perms.grantPermission({ principalId: "svc-2", action: "observe" });
        const list = perms.listPermissions("svc-1");
        assert.equal(list.length, 2);
        assert.ok(list.every(p => p.principalId === "svc-1"));
    });

    it("getPermissionMetrics tracks sensitiveGrants", () => {
        perms.grantPermission({ principalId: "svc-1", action: "quarantine" });
        perms.grantPermission({ principalId: "svc-1", action: "observe" });
        const m = perms.getPermissionMetrics();
        assert.equal(m.sensitiveGrants, 1);
    });

    it("PERMITTED_ACTIONS exports 10 actions", () => {
        assert.equal(perms.PERMITTED_ACTIONS.length, 10);
    });
});

// ── trustBoundaryController ───────────────────────────────────────────
describe("trustBoundaryController", () => {
    beforeEach(() => trust.reset());

    it("defines a trust boundary and returns boundaryId", () => {
        const r = trust.defineTrustBoundary({ domain: "zone-a", trustLevel: "high" });
        assert.equal(r.defined, true);
        assert.ok(r.boundaryId.startsWith("boundary-"));
        assert.equal(r.domain, "zone-a");
    });

    it("rejects boundary without domain", () => {
        const r = trust.defineTrustBoundary({ trustLevel: "high" });
        assert.equal(r.defined, false);
        assert.equal(r.reason, "domain_required");
    });

    it("rejects invalid trust level", () => {
        const r = trust.defineTrustBoundary({ domain: "zone-a", trustLevel: "mega" });
        assert.equal(r.defined, false);
        assert.ok(r.reason.startsWith("invalid_trust_level"));
    });

    it("validates same-domain access as allowed", () => {
        trust.defineTrustBoundary({ domain: "zone-a", trustLevel: "medium" });
        const r = trust.validateCrossDomainAccess({ sourceDomain: "zone-a", targetDomain: "zone-a", sourceTrustLevel: "low" });
        assert.equal(r.allowed, true);
        assert.equal(r.reason, "same_domain");
    });

    it("allows access when source trust level is sufficient", () => {
        trust.defineTrustBoundary({ domain: "zone-secure", trustLevel: "high" });
        const r = trust.validateCrossDomainAccess({ sourceDomain: "zone-a", targetDomain: "zone-secure", sourceTrustLevel: "high" });
        assert.equal(r.allowed, true);
    });

    it("blocks access when source trust level is insufficient", () => {
        trust.defineTrustBoundary({ domain: "zone-secure", trustLevel: "high" });
        const r = trust.validateCrossDomainAccess({ sourceDomain: "zone-low", targetDomain: "zone-secure", sourceTrustLevel: "low" });
        assert.equal(r.allowed, false);
        assert.equal(r.reason, "insufficient_trust_level");
    });

    it("blocks access from explicitly denied source", () => {
        trust.defineTrustBoundary({ domain: "zone-a", trustLevel: "low", deniedSources: ["zone-bad"] });
        const r = trust.validateCrossDomainAccess({ sourceDomain: "zone-bad", targetDomain: "zone-a", sourceTrustLevel: "system" });
        assert.equal(r.allowed, false);
        assert.equal(r.reason, "source_explicitly_denied");
    });

    it("blocks access not in allowedSources whitelist", () => {
        trust.defineTrustBoundary({ domain: "zone-strict", trustLevel: "medium", allowedSources: ["zone-trusted"] });
        const r = trust.validateCrossDomainAccess({ sourceDomain: "zone-other", targetDomain: "zone-strict", sourceTrustLevel: "system" });
        assert.equal(r.allowed, false);
        assert.equal(r.reason, "source_not_in_allowlist");
    });

    it("allows access from allowedSources whitelist", () => {
        trust.defineTrustBoundary({ domain: "zone-strict", trustLevel: "medium", allowedSources: ["zone-trusted"] });
        const r = trust.validateCrossDomainAccess({ sourceDomain: "zone-trusted", targetDomain: "zone-strict", sourceTrustLevel: "system" });
        assert.equal(r.allowed, true);
    });

    it("returns no_boundary_defined_for_target when no boundary exists", () => {
        const r = trust.validateCrossDomainAccess({ sourceDomain: "zone-a", targetDomain: "zone-unknown", sourceTrustLevel: "system" });
        assert.equal(r.allowed, false);
        assert.equal(r.reason, "no_boundary_defined_for_target");
    });

    it("recordBoundaryViolation stores violation and returns violationId", () => {
        const r = trust.recordBoundaryViolation({ sourceDomain: "zone-bad", targetDomain: "zone-a", reason: "unauthorized_access" });
        assert.equal(r.recorded, true);
        assert.ok(r.violationId.startsWith("viol-"));
    });

    it("getTrustMetrics tracks violations and uniqueViolators", () => {
        trust.defineTrustBoundary({ domain: "zone-a", trustLevel: "high" });
        trust.validateCrossDomainAccess({ sourceDomain: "zone-x", targetDomain: "zone-a", sourceTrustLevel: "low" });
        trust.validateCrossDomainAccess({ sourceDomain: "zone-x", targetDomain: "zone-a", sourceTrustLevel: "low" });
        const m = trust.getTrustMetrics();
        assert.equal(m.totalViolations, 2);
        assert.equal(m.uniqueViolators, 1);
    });

    it("TRUST_LEVELS exports 5 levels in order", () => {
        assert.equal(trust.TRUST_LEVELS.length, 5);
        assert.equal(trust.TRUST_LEVELS[0], "untrusted");
        assert.equal(trust.TRUST_LEVELS[4], "system");
    });
});

// ── governanceDecisionEngine ──────────────────────────────────────────
describe("governanceDecisionEngine", () => {
    beforeEach(() => decisions.reset());

    it("submits a decision request and returns requestId", () => {
        const r = decisions.submitDecisionRequest({ principalId: "svc-1", action: "execute", riskClass: "safe" });
        assert.equal(r.submitted, true);
        assert.ok(r.requestId.startsWith("req-"));
    });

    it("rejects request without principalId", () => {
        const r = decisions.submitDecisionRequest({ action: "execute" });
        assert.equal(r.submitted, false);
        assert.equal(r.reason, "principalId_required");
    });

    it("approves safe action without approval", () => {
        const r = decisions.submitDecisionRequest({ principalId: "svc-1", action: "observe", riskClass: "safe", hasApproval: false });
        assert.equal(r.decision, "approved");
        assert.equal(r.blockedBy.length, 0);
    });

    it("blocks critical action without approval", () => {
        const r = decisions.submitDecisionRequest({ principalId: "svc-1", action: "quarantine", riskClass: "critical", hasApproval: false });
        assert.equal(r.decision, "blocked");
        assert.ok(r.blockedBy.includes("deny_unsafe_without_approval"));
    });

    it("approves critical action with approval", () => {
        const r = decisions.submitDecisionRequest({ principalId: "svc-1", action: "quarantine", riskClass: "critical", hasApproval: true });
        assert.equal(r.decision, "approved");
    });

    it("blocks cross-domain access without trust clearance", () => {
        const r = decisions.submitDecisionRequest({ principalId: "svc-1", action: "execute", crossDomain: true, hasTrustClearance: false });
        assert.equal(r.decision, "blocked");
        assert.ok(r.blockedBy.includes("no_cross_boundary_without_trust"));
    });

    it("approves cross-domain access with trust clearance", () => {
        const r = decisions.submitDecisionRequest({ principalId: "svc-1", action: "execute", crossDomain: true, hasTrustClearance: true });
        assert.equal(r.decision, "approved");
    });

    it("blocks root-runtime auto-grant", () => {
        const r = decisions.submitDecisionRequest({ principalId: "svc-1", action: "govern", riskClass: "restricted", hasApproval: true, targetLevel: "root-runtime", explicitRootGrant: false });
        assert.equal(r.decision, "blocked");
        assert.ok(r.blockedBy.includes("no_root_auto_grant"));
    });

    it("allows root-runtime with explicit grant flag", () => {
        const r = decisions.submitDecisionRequest({ principalId: "svc-1", action: "govern", riskClass: "restricted", hasApproval: true, targetLevel: "root-runtime", explicitRootGrant: true });
        assert.equal(r.decision, "approved");
    });

    it("evaluateGovernancePolicy returns compliant when all conditions met", () => {
        const r = decisions.evaluateGovernancePolicy({
            policy:           { name: "test", requiredAuthority: "operator", maxRiskClass: "elevated", requiresApproval: false },
            currentAuthority: "controller",
            riskClass:        "guarded",
        });
        assert.equal(r.compliant, true);
        assert.equal(r.violations.length, 0);
    });

    it("evaluateGovernancePolicy detects insufficient authority", () => {
        const r = decisions.evaluateGovernancePolicy({
            policy:           { requiredAuthority: "governor", maxRiskClass: "restricted" },
            currentAuthority: "operator",
            riskClass:        "safe",
        });
        assert.ok(r.violations.some(v => v.type === "insufficient_authority"));
    });

    it("evaluateGovernancePolicy detects risk class exceeded", () => {
        const r = decisions.evaluateGovernancePolicy({
            policy:           { requiredAuthority: "observer", maxRiskClass: "guarded" },
            currentAuthority: "governor",
            riskClass:        "critical",
        });
        assert.ok(r.violations.some(v => v.type === "risk_class_exceeded"));
    });

    it("applyConstitutionalRule blocks when violated", () => {
        const r = decisions.applyConstitutionalRule({
            ruleName: "deny_unsafe_without_approval",
            context:  { riskClass: "critical", hasApproval: false },
        });
        assert.equal(r.applied, true);
        assert.equal(r.blocked, true);
        assert.ok(r.reason != null);
    });

    it("applyConstitutionalRule passes when rule is satisfied", () => {
        const r = decisions.applyConstitutionalRule({
            ruleName: "deny_unsafe_without_approval",
            context:  { riskClass: "critical", hasApproval: true },
        });
        assert.equal(r.blocked, false);
    });

    it("applyConstitutionalRule rejects unknown rule", () => {
        const r = decisions.applyConstitutionalRule({ ruleName: "fly_to_moon", context: {} });
        assert.equal(r.applied, false);
        assert.ok(r.reason.startsWith("unknown_rule"));
    });

    it("getDecisionMetrics computes blockRate", () => {
        decisions.submitDecisionRequest({ principalId: "a", action: "observe", riskClass: "safe" });
        decisions.submitDecisionRequest({ principalId: "b", action: "quarantine", riskClass: "critical", hasApproval: false });
        const m = decisions.getDecisionMetrics();
        assert.equal(m.totalDecisions, 2);
        assert.equal(m.blockRate, 0.5);
    });

    it("CONSTITUTIONAL_RULES exports 4 rules", () => {
        assert.equal(Object.keys(decisions.CONSTITUTIONAL_RULES).length, 4);
    });
});

// ── runtimeRiskClassifier ─────────────────────────────────────────────
describe("runtimeRiskClassifier", () => {
    beforeEach(() => risk.reset());

    it("classifies observe action as safe", () => {
        const r = risk.classifyAction({ action: "observe" });
        assert.equal(r.classified, true);
        assert.equal(r.riskClass, "safe");
    });

    it("classifies execute as guarded", () => {
        const r = risk.classifyAction({ action: "execute" });
        assert.equal(r.riskClass, "guarded");
    });

    it("classifies isolate as elevated", () => {
        const r = risk.classifyAction({ action: "isolate" });
        assert.equal(r.riskClass, "elevated");
    });

    it("classifies quarantine as critical", () => {
        const r = risk.classifyAction({ action: "quarantine" });
        assert.equal(r.riskClass, "critical");
    });

    it("classifies root_access as restricted", () => {
        const r = risk.classifyAction({ action: "root_access" });
        assert.equal(r.riskClass, "restricted");
    });

    it("classifyAction returns classified=false for unknown action", () => {
        const r = risk.classifyAction({ action: "teleport" });
        assert.equal(r.classified, false);
    });

    it("classifyWorkflow returns safe for healthy workflow", () => {
        const r = risk.classifyWorkflow({ workflowId: "wf-ok" });
        assert.equal(r.riskClass, "safe");
    });

    it("classifyWorkflow elevates for recoveryMode", () => {
        const r = risk.classifyWorkflow({ workflowId: "wf-rec", recoveryMode: true });
        assert.equal(r.riskClass, "elevated");
        assert.ok(r.factors.includes("recovery_mode"));
    });

    it("classifyWorkflow elevates for high errorRate", () => {
        const r = risk.classifyWorkflow({ workflowId: "wf-err", errorRate: 0.6 });
        assert.equal(r.riskClass, "critical");
    });

    it("classifyWorkflow elevates for deep cascade", () => {
        const r = risk.classifyWorkflow({ workflowId: "wf-cas", cascadeDepth: 4 });
        assert.equal(r.riskClass, "critical");
    });

    it("classifyWorkflow returns guarded for high priority", () => {
        const r = risk.classifyWorkflow({ workflowId: "wf-pri", priority: 9 });
        assert.equal(r.riskClass, "guarded");
    });

    it("classifyWorkflow picks worst-case factor", () => {
        const r = risk.classifyWorkflow({ workflowId: "wf-multi", recoveryMode: true, errorRate: 0.6 });
        assert.equal(r.riskClass, "critical");
    });

    it("overrideRiskClass changes classification", () => {
        const c = risk.classifyAction({ action: "observe" });
        const o = risk.overrideRiskClass({ classId: c.classId, newClass: "elevated" });
        assert.equal(o.overridden, true);
        assert.equal(o.oldClass, "safe");
        assert.equal(o.newClass, "elevated");
    });

    it("overrideRiskClass rejects invalid risk class", () => {
        const c = risk.classifyAction({ action: "observe" });
        const o = risk.overrideRiskClass({ classId: c.classId, newClass: "mega" });
        assert.equal(o.overridden, false);
    });

    it("getRiskProfile finds action classification", () => {
        risk.classifyAction({ action: "failover" });
        const p = risk.getRiskProfile("failover");
        assert.equal(p.found, true);
        assert.equal(p.riskClass, "critical");
    });

    it("getRiskProfile finds workflow classification", () => {
        risk.classifyWorkflow({ workflowId: "wf-1" });
        const p = risk.getRiskProfile("wf-1");
        assert.equal(p.found, true);
    });

    it("getRiskMetrics counts byClass correctly", () => {
        risk.classifyAction({ action: "observe" });
        risk.classifyAction({ action: "quarantine" });
        risk.classifyWorkflow({ workflowId: "wf-1" });
        const m = risk.getRiskMetrics();
        assert.equal(m.totalClassifications, 3);
        assert.equal(m.byClass.safe, 2);
        assert.equal(m.byClass.critical, 1);
    });

    it("RISK_CLASSES exports 5 classes in order", () => {
        assert.equal(risk.RISK_CLASSES.length, 5);
        assert.equal(risk.RISK_CLASSES[0], "safe");
        assert.equal(risk.RISK_CLASSES[4], "restricted");
    });
});

// ── privilegeIsolationManager ─────────────────────────────────────────
describe("privilegeIsolationManager", () => {
    beforeEach(() => privilege.reset());

    it("creates an isolation domain", () => {
        const r = privilege.createIsolationDomain({ name: "sandbox", maxAuthority: "operator" });
        assert.equal(r.created, true);
        assert.ok(r.domainId.startsWith("privdomain-"));
        assert.equal(r.maxAuthority, "operator");
    });

    it("rejects domain without name", () => {
        const r = privilege.createIsolationDomain({ maxAuthority: "operator" });
        assert.equal(r.created, false);
        assert.equal(r.reason, "name_required");
    });

    it("rejects domain with invalid maxAuthority", () => {
        const r = privilege.createIsolationDomain({ name: "test", maxAuthority: "superuser" });
        assert.equal(r.created, false);
        assert.ok(r.reason.startsWith("invalid_maxAuthority"));
    });

    it("prevents child domain from exceeding parent maxAuthority", () => {
        privilege.createIsolationDomain({ name: "parent", maxAuthority: "operator" });
        const r = privilege.createIsolationDomain({ name: "child", maxAuthority: "governor", parentDomain: "parent" });
        assert.equal(r.created, false);
        assert.equal(r.reason, "child_cannot_exceed_parent_maxAuthority");
    });

    it("allows child domain with equal or lower maxAuthority", () => {
        privilege.createIsolationDomain({ name: "parent", maxAuthority: "controller" });
        const r = privilege.createIsolationDomain({ name: "child", maxAuthority: "operator", parentDomain: "parent" });
        assert.equal(r.created, true);
    });

    it("assigns principal to domain", () => {
        const d = privilege.createIsolationDomain({ name: "sandbox", maxAuthority: "controller" });
        const r = privilege.assignToDomain({ principalId: "svc-1", domainId: d.domainId, currentAuthority: "operator" });
        assert.equal(r.assigned, true);
    });

    it("blocks assignment when principal authority exceeds domain max", () => {
        const d = privilege.createIsolationDomain({ name: "sandbox", maxAuthority: "operator" });
        const r = privilege.assignToDomain({ principalId: "svc-high", domainId: d.domainId, currentAuthority: "governor" });
        assert.equal(r.assigned, false);
        assert.equal(r.reason, "authority_exceeds_domain_max");
    });

    it("enforcePrivilegeBoundary blocks action exceeding domain cap", () => {
        const d = privilege.createIsolationDomain({ name: "sandbox", maxAuthority: "operator" });
        privilege.assignToDomain({ principalId: "svc-1", domainId: d.domainId, currentAuthority: "operator" });
        const r = privilege.enforcePrivilegeBoundary({ principalId: "svc-1", requestedAction: "quarantine", callerAuthority: "governor" });
        assert.equal(r.enforced, true);
        assert.equal(r.blocked, true);
        assert.equal(r.reason, "action_exceeds_domain_authority_cap");
    });

    it("enforcePrivilegeBoundary blocks insufficient caller authority", () => {
        const d = privilege.createIsolationDomain({ name: "sandbox", maxAuthority: "governor" });
        privilege.assignToDomain({ principalId: "svc-1", domainId: d.domainId, currentAuthority: "operator" });
        const r = privilege.enforcePrivilegeBoundary({ principalId: "svc-1", requestedAction: "failover", callerAuthority: "operator" });
        assert.equal(r.blocked, true);
        assert.equal(r.reason, "insufficient_caller_authority");
    });

    it("enforcePrivilegeBoundary allows when authority is sufficient", () => {
        const d = privilege.createIsolationDomain({ name: "control", maxAuthority: "governor" });
        privilege.assignToDomain({ principalId: "svc-ctrl", domainId: d.domainId, currentAuthority: "controller" });
        const r = privilege.enforcePrivilegeBoundary({ principalId: "svc-ctrl", requestedAction: "execute", callerAuthority: "operator" });
        assert.equal(r.blocked, false);
    });

    it("validatePrivilegeInheritance detects child exceeding parent", () => {
        privilege.createIsolationDomain({ name: "parent", maxAuthority: "operator" });
        privilege.createIsolationDomain({ name: "child",  maxAuthority: "governor" });
        const r = privilege.validatePrivilegeInheritance({ parentDomainName: "parent", childDomainName: "child" });
        assert.equal(r.valid, false);
        assert.ok(r.violations.some(v => v.type === "child_exceeds_parent_max_authority"));
    });

    it("validatePrivilegeInheritance passes when child <= parent", () => {
        privilege.createIsolationDomain({ name: "parent", maxAuthority: "governor" });
        privilege.createIsolationDomain({ name: "child",  maxAuthority: "controller" });
        const r = privilege.validatePrivilegeInheritance({ parentDomainName: "parent", childDomainName: "child" });
        assert.equal(r.valid, true);
    });

    it("getIsolationDomainState reflects assignment counts", () => {
        const d = privilege.createIsolationDomain({ name: "sandbox", maxAuthority: "controller" });
        privilege.assignToDomain({ principalId: "svc-1", domainId: d.domainId, currentAuthority: "operator" });
        privilege.assignToDomain({ principalId: "svc-2", domainId: d.domainId, currentAuthority: "operator" });
        const s = privilege.getIsolationDomainState();
        assert.equal(s.totalAssignments, 2);
        assert.equal(s.domains[0].memberCount, 2);
    });
});

// ── actionApprovalCoordinator ─────────────────────────────────────────
describe("actionApprovalCoordinator", () => {
    beforeEach(() => approval.reset());

    it("requests approval and returns approvalId", () => {
        const r = approval.requestApproval({ principalId: "svc-1", action: "isolate", riskClass: "elevated" });
        assert.equal(r.requested, true);
        assert.ok(r.approvalId.startsWith("approval-"));
        assert.equal(r.requiredApprovers, 1);
    });

    it("rejects approval request without principalId", () => {
        const r = approval.requestApproval({ action: "isolate", riskClass: "elevated" });
        assert.equal(r.requested, false);
        assert.equal(r.reason, "principalId_required");
    });

    it("rejects approval request for non-approval-required risk class", () => {
        const r = approval.requestApproval({ principalId: "svc-1", action: "observe", riskClass: "safe" });
        assert.equal(r.requested, false);
        assert.ok(r.reason.startsWith("approval_not_required_for"));
    });

    it("elevated requires 1 approver with operator authority", () => {
        const r = approval.requestApproval({ principalId: "svc-1", action: "degrade", riskClass: "elevated" });
        assert.equal(r.requiredApprovers, 1);
        assert.equal(r.minApproverLevel, "operator");
    });

    it("critical requires 2 approvers with controller authority", () => {
        const r = approval.requestApproval({ principalId: "svc-1", action: "quarantine", riskClass: "critical" });
        assert.equal(r.requiredApprovers, 2);
        assert.equal(r.minApproverLevel, "controller");
    });

    it("restricted requires 3 approvers with governor authority", () => {
        const r = approval.requestApproval({ principalId: "svc-1", action: "govern", riskClass: "restricted" });
        assert.equal(r.requiredApprovers, 3);
        assert.equal(r.minApproverLevel, "governor");
    });

    it("grantApproval approves elevated after 1 grant", () => {
        const req = approval.requestApproval({ principalId: "svc-1", action: "degrade", riskClass: "elevated" });
        const g   = approval.grantApproval({ approvalId: req.approvalId, approverId: "mgr-1", approverAuthority: "operator" });
        assert.equal(g.granted, true);
        assert.equal(g.status, "approved");
    });

    it("grantApproval reaches approved only after quorum for critical", () => {
        const req = approval.requestApproval({ principalId: "svc-1", action: "quarantine", riskClass: "critical" });
        const g1  = approval.grantApproval({ approvalId: req.approvalId, approverId: "ctrl-1", approverAuthority: "controller" });
        assert.equal(g1.status, "pending"); // still needs one more
        const g2  = approval.grantApproval({ approvalId: req.approvalId, approverId: "ctrl-2", approverAuthority: "controller" });
        assert.equal(g2.status, "approved");
    });

    it("grantApproval blocks insufficient approver authority", () => {
        const req = approval.requestApproval({ principalId: "svc-1", action: "quarantine", riskClass: "critical" });
        const g   = approval.grantApproval({ approvalId: req.approvalId, approverId: "op-1", approverAuthority: "operator" });
        assert.equal(g.granted, false);
        assert.equal(g.reason, "approver_authority_insufficient");
    });

    it("grantApproval prevents duplicate approver", () => {
        const req = approval.requestApproval({ principalId: "svc-1", action: "degrade", riskClass: "elevated" });
        approval.grantApproval({ approvalId: req.approvalId, approverId: "mgr-1", approverAuthority: "operator" });
        const g2 = approval.grantApproval({ approvalId: req.approvalId, approverId: "mgr-1", approverAuthority: "operator" });
        assert.equal(g2.granted, false);
        assert.equal(g2.reason, "duplicate_approval");
    });

    it("root-runtime shortcut approves restricted with single grant", () => {
        const req = approval.requestApproval({ principalId: "svc-1", action: "govern", riskClass: "restricted" });
        const g   = approval.grantApproval({ approvalId: req.approvalId, approverId: "root-1", approverAuthority: "root-runtime" });
        assert.equal(g.status, "approved");
    });

    it("denyApproval immediately blocks the approval", () => {
        const req = approval.requestApproval({ principalId: "svc-1", action: "quarantine", riskClass: "critical" });
        const d   = approval.denyApproval({ approvalId: req.approvalId, approverId: "ctrl-1", reason: "policy_violation" });
        assert.equal(d.denied, true);
        const s = approval.checkApprovalStatus({ approvalId: req.approvalId });
        assert.equal(s.status, "denied");
        assert.equal(s.approved, false);
    });

    it("cannot grant after denial", () => {
        const req = approval.requestApproval({ principalId: "svc-1", action: "degrade", riskClass: "elevated" });
        approval.denyApproval({ approvalId: req.approvalId, approverId: "mgr-1" });
        const g = approval.grantApproval({ approvalId: req.approvalId, approverId: "mgr-2", approverAuthority: "operator" });
        assert.equal(g.granted, false);
        assert.ok(g.reason.startsWith("approval_not_pending"));
    });

    it("checkApprovalStatus returns full status", () => {
        const req = approval.requestApproval({ principalId: "svc-1", action: "degrade", riskClass: "elevated" });
        const s   = approval.checkApprovalStatus({ approvalId: req.approvalId });
        assert.equal(s.found, true);
        assert.equal(s.status, "pending");
        assert.equal(s.approved, false);
    });

    it("getApprovalMetrics tracks approvalRate", () => {
        const r1 = approval.requestApproval({ principalId: "svc-1", action: "degrade", riskClass: "elevated" });
        const r2 = approval.requestApproval({ principalId: "svc-2", action: "degrade", riskClass: "elevated" });
        approval.grantApproval({ approvalId: r1.approvalId, approverId: "mgr-1", approverAuthority: "operator" });
        approval.denyApproval({ approvalId: r2.approvalId, approverId: "mgr-2" });
        const m = approval.getApprovalMetrics();
        assert.equal(m.approvalRate, 0.5);
        assert.equal(m.totalRequests, 2);
    });
});

// ── end-to-end governance simulation ─────────────────────────────────
describe("end-to-end governance simulation", () => {
    beforeEach(() => {
        authority.reset(); perms.reset(); trust.reset();
        decisions.reset(); risk.reset(); privilege.reset(); approval.reset();
    });

    it("full authority → permission → decision lifecycle", () => {
        // Register authority
        const auth = authority.registerAuthority({ principalId: "svc-ctrl", level: "controller" });
        assert.equal(auth.registered, true);

        // Grant permission
        perms.grantPermission({ principalId: "svc-ctrl", action: "execute" });
        const check = perms.checkPermission({ principalId: "svc-ctrl", action: "execute" });
        assert.equal(check.allowed, true);

        // Submit governance decision
        const dec = decisions.submitDecisionRequest({ principalId: "svc-ctrl", action: "execute", riskClass: "guarded", authorityLevel: "controller" });
        assert.equal(dec.decision, "approved");
    });

    it("deny-by-default blocks execution without explicit grant", () => {
        authority.registerAuthority({ principalId: "svc-op", level: "operator" });
        const check = perms.checkPermission({ principalId: "svc-op", action: "execute" });
        assert.equal(check.allowed, false);
        assert.equal(check.reason, "no_permission_grant");
    });

    it("risk classification gates approval requirement", () => {
        const c = risk.classifyAction({ action: "quarantine" });
        assert.equal(c.riskClass, "critical");
        // critical requires approval
        const dec = decisions.submitDecisionRequest({ principalId: "svc-1", action: "quarantine", riskClass: "critical", hasApproval: false });
        assert.equal(dec.decision, "blocked");
        // with approval, passes
        const decOk = decisions.submitDecisionRequest({ principalId: "svc-1", action: "quarantine", riskClass: "critical", hasApproval: true });
        assert.equal(decOk.decision, "approved");
    });

    it("trust boundary blocks cross-domain access from untrusted source", () => {
        trust.defineTrustBoundary({ domain: "secure-zone", trustLevel: "high" });
        const access = trust.validateCrossDomainAccess({ sourceDomain: "external", targetDomain: "secure-zone", sourceTrustLevel: "low" });
        assert.equal(access.allowed, false);
        // Governance decision reflects the cross-domain block
        const dec = decisions.submitDecisionRequest({ principalId: "svc-ext", action: "execute", crossDomain: true, hasTrustClearance: false });
        assert.equal(dec.decision, "blocked");
    });

    it("privilege domain caps prevent authority leakage", () => {
        const domain = privilege.createIsolationDomain({ name: "sandbox", maxAuthority: "operator" });
        privilege.assignToDomain({ principalId: "svc-sandboxed", domainId: domain.domainId, currentAuthority: "operator" });
        const r = privilege.enforcePrivilegeBoundary({ principalId: "svc-sandboxed", requestedAction: "govern", callerAuthority: "governor" });
        assert.equal(r.blocked, true);
        assert.equal(r.reason, "action_exceeds_domain_authority_cap");
    });

    it("multi-approver quorum for critical action", () => {
        const req = approval.requestApproval({ principalId: "svc-1", action: "quarantine", riskClass: "critical" });
        approval.grantApproval({ approvalId: req.approvalId, approverId: "c1", approverAuthority: "controller" });
        let status = approval.checkApprovalStatus({ approvalId: req.approvalId });
        assert.equal(status.status, "pending");
        approval.grantApproval({ approvalId: req.approvalId, approverId: "c2", approverAuthority: "controller" });
        status = approval.checkApprovalStatus({ approvalId: req.approvalId });
        assert.equal(status.status, "approved");
        // Now the governance decision can pass
        const dec = decisions.submitDecisionRequest({ principalId: "svc-1", action: "quarantine", riskClass: "critical", hasApproval: true });
        assert.equal(dec.decision, "approved");
    });

    it("constitutional rule no_privilege_escalation fires on escalation attempt", () => {
        const r = decisions.applyConstitutionalRule({ ruleName: "no_privilege_escalation", context: { isEscalation: true } });
        assert.equal(r.blocked, true);
    });

    it("workflow risk classification drives appropriate approval threshold", () => {
        const wfRisk = risk.classifyWorkflow({ workflowId: "wf-bad", errorRate: 0.6, cascadeDepth: 4 });
        assert.equal(wfRisk.riskClass, "critical");
        const req = approval.requestApproval({ principalId: "svc-1", action: "isolate", riskClass: "critical" });
        assert.equal(req.requiredApprovers, 2);
    });
});
