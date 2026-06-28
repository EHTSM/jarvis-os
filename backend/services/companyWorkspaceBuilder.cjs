"use strict";
/**
 * companyWorkspaceBuilder.cjs — POST-Ω Sprint P8 Autonomous Company Factory
 *
 * Prepares the full operational workspace for a new company:
 *   - repository structure
 *   - documentation scaffold
 *   - roadmap artifact
 *   - production bible
 *   - capability map
 *   - AI workforce allocation (via workforceManager)
 *   - initial missions (via missionMemory)
 *
 * Reuses: companyBlueprintEngine, workforceManager, missionMemory,
 *         productionBibleEngine, computerController, continuousLearningEngine.
 *
 * Storage: data/company-workspaces.json
 */

const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "company-workspaces.json");

const _try = fn => { try { return fn(); } catch { return null; } };
const _cbe = () => _try(() => require("./companyBlueprintEngine.cjs"));
const _wm  = () => _try(() => require("./workforceManager.cjs"));
const _mm  = () => _try(() => require("./missionMemory.cjs"));
const _pb  = () => _try(() => require("./productionBibleEngine.cjs"));
const _cle = () => _try(() => require("./continuousLearningEngine.cjs"));
const _eme = () => _try(() => require("./engineeringMemoryEngine.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `ws_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`; }

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch { return { workspaces: [], updatedAt: null }; }
}
function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.workspaces.length > 200) d.workspaces = d.workspaces.slice(-200);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Repository structure ──────────────────────────────────────────────────────

function _buildRepoStructure(blueprint) {
  const name = blueprint.name.toLowerCase().replace(/\s+/g, "-");
  return {
    repositories: [
      { name: `${name}-backend`,   type: "backend",   description: "API server + business logic", stack: blueprint.techStack[0] || "Node.js" },
      { name: `${name}-frontend`,  type: "frontend",  description: "Web application", stack: "React" },
      { name: `${name}-infra`,     type: "infra",     description: "Infrastructure as code, CI/CD", stack: "Terraform/Docker" },
      { name: `${name}-docs`,      type: "docs",      description: "Internal and public documentation" },
    ],
    directories: {
      backend:  ["src/routes", "src/services", "src/models", "src/middleware", "tests", "data", "scripts"],
      frontend: ["src/components", "src/pages", "src/hooks", "src/lib", "src/styles", "public"],
      infra:    ["terraform", "docker", "nginx", ".github/workflows", "scripts"],
      docs:     ["architecture", "api", "runbooks", "decisions", "onboarding"],
    },
    files: {
      backend:  ["package.json", "server.js", "README.md", ".env.example", ".gitignore", "Dockerfile"],
      frontend: ["package.json", "index.html", "vite.config.js", "README.md", ".env.example"],
      infra:    ["docker-compose.yml", "nginx.conf", ".github/workflows/ci.yml", "README.md"],
      docs:     ["ARCHITECTURE.md", "API.md", "RUNBOOK.md", "ONBOARDING.md", "DECISIONS.md"],
    },
  };
}

// ── Documentation scaffold ────────────────────────────────────────────────────

function _buildDocumentation(blueprint) {
  return {
    architecture: {
      title: `${blueprint.name} — Technical Architecture`,
      sections: ["Overview","System Components","Data Flow","Security","Scalability","Deployment"],
      status: "generated",
    },
    api: {
      title: `${blueprint.name} — API Reference`,
      sections: ["Authentication","Endpoints","Request/Response Formats","Error Codes","Rate Limiting","SDKs"],
      status: "generated",
    },
    runbook: {
      title: `${blueprint.name} — Operations Runbook`,
      sections: ["Deployment","Rollback","Incident Response","Monitoring","Backup & Recovery","On-Call"],
      status: "generated",
    },
    onboarding: {
      title: `${blueprint.name} — Developer Onboarding`,
      sections: ["Setup","Architecture Overview","First PR","Testing","Code Standards","Team Process"],
      status: "generated",
    },
    productRoadmap: {
      title:  `${blueprint.name} — Product Roadmap`,
      phases: blueprint.roadmap.map(p => ({ phase: p.phase, weeks: p.estimatedWeeks, milestones: p.milestones })),
      status: "generated",
    },
  };
}

// ── Capability map ────────────────────────────────────────────────────────────

function _buildCapabilityMap(blueprint) {
  return blueprint.capabilities.map(cap => ({
    capability:  cap,
    status:      "planned",
    priority:    blueprint.governance?.approvalRequired?.includes(cap) ? "high" : "medium",
    assignedTeam: null,
    estimatedWeeks: 2,
  }));
}

// ── Workforce allocation ──────────────────────────────────────────────────────

async function _allocateWorkforce(blueprint, workspaceId) {
  const missions = blueprint.missions.slice(0, 4); // allocate first 4 setup missions
  const results  = [];
  for (const m of missions) {
    const r = await _try(() => _wm()?.runMission?.({
      title:          m.title,
      domain:         m.domain,
      priority:       m.priority,
      requiredSkills: blueprint.skills.slice(0, 3),
      dryRun:         true, // dry-run during workspace creation
    }));
    results.push({ mission: m.title, teamType: r?.teamType, agents: r?.teamSize, ok: r?.ok });
  }
  return results;
}

// ── Mission registration ──────────────────────────────────────────────────────

function _registerMissions(blueprint, workspaceId) {
  const registered = [];
  for (const m of blueprint.missions) {
    const r = _try(() => _mm()?.createMission?.({
      title:       m.title,
      description: `Auto-generated mission for ${blueprint.name}`,
      priority:    m.priority,
      tags:        ["company_factory", blueprint.templateId, workspaceId],
      metadata:    { companyName: blueprint.name, domain: m.domain, blueprintId: blueprint.id },
    }));
    if (r?.missionId) registered.push({ missionId: r.missionId, title: m.title });
  }
  return registered;
}

// ── Production bible ──────────────────────────────────────────────────────────

function _buildProductionBible(blueprint) {
  const workflows = blueprint.missions.map((m, i) => ({
    id:       `wf_${blueprint.id}_${i}`,
    name:     m.title,
    class:    "A",
    domain:   m.domain,
    priority: m.priority,
    steps:    ["validate", "execute", "verify", "document"],
  }));
  return { companyId: blueprint.id, companyName: blueprint.name, workflows, generatedAt: _ts() };
}

// ── Core builder ─────────────────────────────────────────────────────────────

async function buildWorkspace(blueprintId) {
  if (!blueprintId) return { ok: false, error: "blueprintId required" };

  const blueprint = _cbe()?.getBlueprint?.(blueprintId);
  if (!blueprint) return { ok: false, error: "blueprint not found: " + blueprintId };

  const wsId      = _id();
  const started   = Date.now();
  const timeline  = [];
  const _step     = (name, data = {}) => timeline.push({ step: name, ts: _ts(), ...data });

  _step("init", { blueprintId, company: blueprint.name });

  // Step 1: Repositories
  const repos = _buildRepoStructure(blueprint);
  _step("repositories", { count: repos.repositories.length });

  // Step 2: Documentation
  const docs = _buildDocumentation(blueprint);
  _step("documentation", { sections: Object.keys(docs).length });

  // Step 3: Capability map
  const capMap = _buildCapabilityMap(blueprint);
  _step("capability_map", { capabilities: capMap.length });

  // Step 4: Workforce allocation (dry run)
  const workforce = await _allocateWorkforce(blueprint, wsId);
  _step("workforce_allocated", { missions: workforce.length, agents: workforce.reduce((s, w) => s + (w.agents || 0), 0) });

  // Step 5: Mission registration
  const missions = _registerMissions(blueprint, wsId);
  _step("missions_registered", { count: missions.length });

  // Step 6: Production bible
  const bible = _buildProductionBible(blueprint);
  _step("production_bible", { workflows: bible.workflows.length });

  // Step 7: Mark blueprint active
  _cbe()?.updateBlueprintStatus?.(blueprintId, "active");
  _step("blueprint_activated");

  const workspace = {
    id:            wsId,
    blueprintId,
    companyName:   blueprint.name,
    templateId:    blueprint.templateId,
    repositories:  repos,
    documentation: docs,
    capabilityMap: capMap,
    workforceAllocation: workforce,
    registeredMissions:  missions,
    productionBible:     bible,
    timeline,
    status:        "ready",
    minutesSaved:  blueprint.minutesSaved,
    readinessScore: _calcReadiness(workforce, missions, blueprint),
    createdAt:     _ts(),
    durationMs:    Date.now() - started,
  };

  const d = _load();
  d.workspaces.push(workspace);
  _save(d);

  // Memory
  _try(() => _cle()?.createLesson?.({
    type: "workspace_built", title: `Workspace: ${blueprint.name}`,
    source: "companyWorkspaceBuilder", confidence: 0.9,
    tags: ["company_factory", blueprint.templateId, "workspace"],
    metadata: { wsId, blueprintId, missions: missions.length, minutesSaved: workspace.minutesSaved },
  }));
  _try(() => _eme()?.remember?.({
    type: "workspace_built", confidence: 0.88,
    content: `Workspace built for "${blueprint.name}" (${blueprint.templateId}). ${repos.repositories.length} repos, ${missions.length} missions registered.`,
    tags: ["company_factory", "workspace", blueprint.templateId],
  }));

  return { ok: true, workspace };
}

function _calcReadiness(workforce, missions, blueprint) {
  const wfScore  = workforce.length > 0 ? Math.min(100, workforce.filter(w => w.ok).length / workforce.length * 100) : 80;
  const mScore   = missions.length >= blueprint.missionCount * 0.5 ? 100 : missions.length / (blueprint.missionCount || 1) * 100;
  return Math.round((wfScore * 0.4 + mScore * 0.6));
}

function getWorkspace(id) {
  return _load().workspaces.find(w => w.id === id) || null;
}

function getWorkspaceForBlueprint(blueprintId) {
  return _load().workspaces.find(w => w.blueprintId === blueprintId) || null;
}

function listWorkspaces({ limit = 50 } = {}) {
  return { ok: true, workspaces: _load().workspaces.slice(-limit) };
}

function getStats() {
  const d = _load();
  return {
    totalWorkspaces: d.workspaces.length,
    avgReadiness: d.workspaces.length > 0
      ? Math.round(d.workspaces.reduce((s, w) => s + (w.readinessScore || 0), 0) / d.workspaces.length) : 0,
    updatedAt: d.updatedAt,
  };
}

module.exports = {
  buildWorkspace,
  getWorkspace,
  getWorkspaceForBlueprint,
  listWorkspaces,
  getStats,
};
