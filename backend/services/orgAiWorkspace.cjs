"use strict";
/**
 * orgAiWorkspace.cjs — V5 Global AI Organization Platform, Module 5:
 * Global AI Workspace.
 *
 * Pure composition over Modules 1-4 plus the automation layer — no new
 * data, no new storage, same pattern as the Enterprise & Physical
 * Integration mission's enterpriseDashboard.cjs (which this file's
 * getFullWorkspace mirrors structurally).
 *
 *   chat:       orgAiBrain.getHistory/getUsage — Module 1's real,
 *     org-scoped conversation history and AI cost accounting.
 *   memory:     orgKnowledgeGraph.getOrgGraph — Module 2's real, org-
 *     scoped knowledge graph (CRM/connectors/workflows/AI-context edges).
 *   agents:     orgAgents.listAgents/getHistory — Module 3's real agent
 *     catalog and org-attributed execution history.
 *   workflows:  automationService.getRules/getStatistics(orgId) — the
 *     real, pre-existing K5 Enterprise Automation Service, keyed by
 *     workspaceId; orgId is used directly as that key (same convention
 *     Module 2's indexWorkflows already established).
 *   collaboration: crossOrgCollaboration.listForOrg — Module 4's real
 *     mutual-consent cross-org sharing state.
 *
 * Every section requires real organizationService.hasPermission — same
 * pattern as every other V5 module.
 */

const _try = fn => { try { return fn(); } catch { return null; } };
const _org       = () => _try(() => require("./organizationService.cjs"));
const _brain     = () => _try(() => require("./orgAiBrain.cjs"));
const _graph     = () => _try(() => require("./orgKnowledgeGraph.cjs"));
const _agents    = () => _try(() => require("./orgAgents.cjs"));
const _automation = () => _try(() => require("./automationService.cjs"));
const _collab    = () => _try(() => require("./crossOrgCollaboration.cjs"));

function _assertMember(orgId, accountId) {
  if (!_org()?.hasPermission?.(orgId, accountId, "view_members")) {
    const e = new Error("Forbidden — not a member of this organization");
    e.status = 403;
    throw e;
  }
}

function getChatSummary(orgId, accountId) {
  _assertMember(orgId, accountId);
  const history = _try(() => _brain().getHistory(orgId, accountId, { limit: 10 })) || [];
  const usage = _try(() => _brain().getUsage(orgId, accountId)) || {};
  return { recentConversations: history, usage };
}

function getMemorySummary(orgId, accountId) {
  _assertMember(orgId, accountId);
  return _try(() => _graph().getOrgGraph(orgId, accountId)) || { byType: {} };
}

function getAgentsSummary(orgId, accountId) {
  _assertMember(orgId, accountId);
  const agents = _try(() => _agents().listAgents(orgId, accountId)) || [];
  const history = _try(() => _agents().getHistory(orgId, accountId, { limit: 10 })) || { runs: [], total: 0, stats: {} };
  return { agents, recentRuns: history.runs, stats: history.stats };
}

function getWorkflowsSummary(orgId, accountId) {
  _assertMember(orgId, accountId);
  const automation = _automation();
  const rules = automation?.getRules?.(orgId) || [];
  const stats = _try(() => automation?.getStatistics?.(orgId)) || null;
  return { rules, stats };
}

function getCollaborationSummary(orgId, accountId) {
  _assertMember(orgId, accountId);
  return { collaborations: _try(() => _collab().listForOrg(orgId, accountId)) || [] };
}

/** Everything above, in one call — the actual "Global AI Workspace"
 * dashboard payload. */
function getFullWorkspace(orgId, accountId) {
  _assertMember(orgId, accountId);
  return {
    ok: true, orgId, generatedAt: new Date().toISOString(),
    chat: getChatSummary(orgId, accountId),
    memory: getMemorySummary(orgId, accountId),
    agents: getAgentsSummary(orgId, accountId),
    workflows: getWorkflowsSummary(orgId, accountId),
    collaboration: getCollaborationSummary(orgId, accountId),
  };
}

module.exports = {
  getChatSummary, getMemorySummary, getAgentsSummary, getWorkflowsSummary,
  getCollaborationSummary, getFullWorkspace,
};
