"use strict";
/**
 * capabilityRouting.cjs — Phase 1 (Capability Coverage), Missions 113-116.
 *
 * Routes a skillRegistry.cjs capability to its eligible execution path:
 *   capability -> eligible agent(s) -> eligible connector(s) -> approval/
 *   risk gate -> execution readiness.
 *
 * Does NOT execute anything and does NOT introduce a new dispatch
 * mechanism. It composes three already-real, already-live registries:
 *   - skillRegistry.cjs            (the capability itself + riskLevel)
 *   - agents/runtime/agentRegistry.cjs (real agents; a skill's own
 *     `executionHandler` field, for source:"agentRegistry" skills, IS
 *     the exact capability tag agentRegistry.findForCapability() expects
 *     — verified directly against the seed data, e.g. { id:"crm",
 *     executionHandler:"crm" }. No new mapping table was invented.)
 *   - backend/services/integrationConnectors.cjs (connector-level
 *     capability/scope metadata, where declared — most connectors have
 *     none yet, honestly reported as [] rather than fabricated)
 *
 * Permission/approval logic is NOT reimplemented here — this module only
 * reports what capabilityContract.cjs / approvalEngine.cjs / skillRegistry
 * already say (riskLevel, healthStatus, isComposableNow), so a caller can
 * make an authorization decision elsewhere without this module becoming a
 * second source of truth for "is this allowed".
 */

const skillRegistry = require("./skillRegistry.cjs");

function _agentRegistry() { try { return require("../../agents/runtime/agentRegistry.cjs"); } catch { return null; } }
function _connectors()    { try { return require("./integrationConnectors.cjs"); } catch { return null; } }

/**
 * routeCapability(capabilityId, opts) ->
 *   {
 *     ok, capabilityId, riskLevel, healthStatus, composable,
 *     eligibleAgents: [{ agentId, load, available }],
 *     eligibleConnectors: [{ connectorId, capabilities, scopes }],
 *     approvalRequired, blockedReasons: [...]
 *   }
 *
 * opts.requireApprovalAbove — riskLevel at/above which approvalRequired is
 *   forced true even if the skill itself is "active" (default: "high").
 */
function routeCapability(capabilityId, opts = {}) {
    const skill = skillRegistry.getSkill(capabilityId);
    if (!skill) {
        return {
            ok: false, capabilityId, blockedReasons: ["unknown_capability"],
            eligibleAgents: [], eligibleConnectors: [], approvalRequired: null,
        };
    }

    const { composable, reason: composableReason } = skillRegistry.isComposableNow(capabilityId);
    const blockedReasons = [];
    if (!composable) blockedReasons.push(composableReason);

    // Agent eligibility — reuses agentRegistry's own findForCapability()
    // load-balancing logic (does not reimplement it), then also lists all
    // agents that declare the capability (not just the single "best" one)
    // so a caller can see the full eligible set, not one hidden choice.
    const agentReg = _agentRegistry();
    let eligibleAgents = [];
    if (agentReg) {
        const best = agentReg.findForCapability(skill.executionHandler);
        eligibleAgents = agentReg.listAll()
            .filter(a => a.capabilities.includes(skill.executionHandler))
            .map(a => ({
                agentId: a.id,
                available: a.lifecycleState ? a.lifecycleState === "active" : true,
                isPreferred: best ? a.id === best.id : false,
            }));
    }
    if (eligibleAgents.length === 0) blockedReasons.push("no_eligible_agent");

    // Connector eligibility — only meaningful for skills whose category
    // implies an external system; honestly returns [] when no connector
    // declares this capability rather than guessing one.
    const connectors = _connectors();
    let eligibleConnectors = [];
    if (connectors && typeof connectors.getAllCompositionStatus === "function") {
        eligibleConnectors = connectors.getAllCompositionStatus()
            .filter(c => (c.capabilities || []).includes(skill.executionHandler))
            .map(c => ({ connectorId: c.connectorId, status: c.status, capabilities: c.capabilities }));
    }

    const riskOrder = { low: 0, medium: 1, high: 2 };
    const threshold = opts.requireApprovalAbove || "high";
    const approvalRequired = (riskOrder[skill.riskLevel] ?? 0) >= (riskOrder[threshold] ?? 2);

    return {
        ok: blockedReasons.length === 0,
        capabilityId,
        riskLevel: skill.riskLevel,
        healthStatus: skill.healthStatus,
        composable,
        eligibleAgents,
        eligibleConnectors,
        approvalRequired,
        blockedReasons,
    };
}

/**
 * routeIntent(intentText, opts) — convenience wrapper chaining
 * capabilityDiscovery.discover() -> routeCapability() for the top match.
 * Kept separate from capabilityDiscovery.cjs so discovery stays a pure
 * "what could satisfy this" function with no routing/authorization
 * concerns mixed in (per the mission's explicit discovery/routing split).
 */
function routeIntent(intentText, opts = {}) {
    const discovery = require("./capabilityDiscovery.cjs");
    const { matches } = discovery.discover(intentText, opts);
    if (matches.length === 0) {
        return { ok: false, intentText, blockedReasons: ["no_capability_match"], matches: [] };
    }
    const top = matches[0];
    const routed = routeCapability(top.skillId, opts);
    return { ...routed, intentText, matchedVia: top.reason, alternatives: matches.slice(1) };
}

module.exports = { routeCapability, routeIntent };
