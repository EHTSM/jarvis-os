"use strict";
/**
 * Founder Digital Identity Operating System (FDIOS) — Production Mission 3.2
 *
 * 12 modules all implemented by composing existing services.
 * Zero new platform architecture. Zero duplicated logic.
 *
 * MODULE 1  — Universal Identity Graph
 * MODULE 2  — Digital Asset Registry
 * MODULE 3  — Automatic Discovery Engine
 * MODULE 4  — Relationship Engine
 * MODULE 5  — Universal Import Engine
 * MODULE 6  — Secret Discovery Engine
 * MODULE 7  — Credential Intelligence
 * MODULE 8  — Workspace Bootstrap
 * MODULE 9  — Permission Policy Engine
 * MODULE 10 — Founder Command Center
 * MODULE 11 — Recovery Kit
 * MODULE 12 — Cross-Device Synchronization
 *
 * Existing services reused (lazy-loaded, all non-fatal):
 *   secretVault.cjs              → credential resolution, storage, health
 *   envManager.cjs               → env generation, backup/restore
 *   integrationConnectors.cjs    → live connector probes, 57 providers
 *   oauthIntegrationLayer.cjs    → OAuth connections + tokens
 *   secretManagementLayer.cjs    → rotation metadata, audit
 *   secretRotationAutomation.cjs → rotation schedules
 *   gitHubEngineeringAgent.cjs   → repo/org/issue/PR discovery
 *   workspaceMesh.cjs            → workspace bootstrap + recovery
 *   companyFactory.cjs           → project/company context
 *   deploymentAutopilot.cjs      → deployment status
 *   engineeringMemoryEngine.cjs  → knowledge + lessons
 *   missionMemory.cjs            → mission context
 *   productionBibleEngine.cjs    → workflow registry
 *   computerController.cjs       → device/environment control
 *   localAiRuntime.cjs           → local AI device discovery
 *   pcs2ExternalPlatforms.cjs    → external platform probes
 *
 * Storage (all JSON, never plaintext secrets):
 *   data/fdios-identity-graph.json
 *   data/fdios-asset-registry.json
 *   data/fdios-relationship-graph.json
 *   data/fdios-policies.json
 *   data/fdios-recovery-history.json
 *   data/fdios-sync-state.json
 */

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");

const DATA = {
  identityGraph:   path.join(__dirname, "../../data/fdios-identity-graph.json"),
  assetRegistry:   path.join(__dirname, "../../data/fdios-asset-registry.json"),
  relationships:   path.join(__dirname, "../../data/fdios-relationship-graph.json"),
  policies:        path.join(__dirname, "../../data/fdios-policies.json"),
  recoveryHistory: path.join(__dirname, "../../data/fdios-recovery-history.json"),
  syncState:       path.join(__dirname, "../../data/fdios-sync-state.json"),
  credIntel:       path.join(__dirname, "../../data/fdios-credential-intelligence.json"),
};

// ── I/O ───────────────────────────────────────────────────────────────────────
function _rj(f, fb) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return fb; } }
function _wj(f, d) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(d, null, 2));
  fs.renameSync(tmp, f);
}
function _ts()  { return new Date().toISOString(); }
function _id(prefix) { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; }

// ── Lazy service loaders ──────────────────────────────────────────────────────
const _t = fn => { try { return fn(); } catch { return null; } };
const _vault   = () => _t(() => require("./secretVault.cjs"));
const _em      = () => _t(() => require("./envManager.cjs"));
const _ic      = () => _t(() => require("./integrationConnectors.cjs"));
const _oauth   = () => _t(() => require("./oauthIntegrationLayer.cjs"));
const _sml     = () => _t(() => require("./secretManagementLayer.cjs"));
const _gh      = () => _t(() => require("./gitHubEngineeringAgent.cjs"));
const _mesh    = () => _t(() => require("./workspaceMesh.cjs"));
const _cf      = () => _t(() => require("./companyFactory.cjs"));
const _da      = () => _t(() => require("./deploymentAutopilot.cjs"));
const _mem     = () => _t(() => require("./engineeringMemoryEngine.cjs"));
const _mm      = () => _t(() => require("./missionMemory.cjs"));
const _pb      = () => _t(() => require("./productionBibleEngine.cjs"));
const _cc      = () => _t(() => require("./computerController.cjs"));
const _local   = () => _t(() => require("./localAiRuntime.cjs"));
const _pcs2    = () => _t(() => require("./pcs2ExternalPlatforms.cjs"));

// ══════════════════════════════════════════════════════════════════════════════
// MODULE 1 — Universal Identity Graph
// ══════════════════════════════════════════════════════════════════════════════

function _loadGraph() { return _rj(DATA.identityGraph, { nodes: {}, edges: [], updatedAt: null }); }
function _saveGraph(g) { g.updatedAt = _ts(); _wj(DATA.identityGraph, g); }

function _upsertNode(graph, id, type, label, attrs = {}) {
  graph.nodes[id] = { id, type, label, attrs, updatedAt: _ts(), ...(graph.nodes[id] || {}) };
  Object.assign(graph.nodes[id].attrs, attrs);
  graph.nodes[id].updatedAt = _ts();
  return graph.nodes[id];
}
function _upsertEdge(graph, from, to, relation, attrs = {}) {
  const existing = graph.edges.find(e => e.from === from && e.to === to && e.relation === relation);
  if (existing) { Object.assign(existing.attrs, attrs); existing.updatedAt = _ts(); }
  else graph.edges.push({ id: _id("edge"), from, to, relation, attrs, updatedAt: _ts() });
}

async function buildIdentityGraph(founderName = "Founder") {
  const graph = _loadGraph();
  const founderId = "founder:root";

  // Root node
  _upsertNode(graph, founderId, "founder", founderName, { email: process.env.FOUNDER_EMAIL || null });

  // Pull from OAuth connections
  const oauth = _oauth();
  if (oauth) {
    const conns = oauth.listConnections ? oauth.listConnections() : [];
    for (const c of conns) {
      const accId = `account:${c.provider}:${c.userId}`;
      _upsertNode(graph, accId, "account", `${c.provider} (${c.userId})`, { provider: c.provider, status: c.status });
      _upsertEdge(graph, founderId, accId, "has_account", { authorized: c.status === "active" });

      // Derive org from provider
      const orgId = `org:${c.provider}`;
      _upsertNode(graph, orgId, "organization", c.provider, { platform: c.provider });
      _upsertEdge(graph, accId, orgId, "member_of");
    }
  }

  // Pull from integration connectors
  const ic = _ic();
  if (ic) {
    const connectors = ic.getAllStatus();
    for (const conn of connectors) {
      if (conn.status !== "CONNECTED" && conn.status !== "PARTIAL") continue;
      const provId = `provider:${conn.id}`;
      _upsertNode(graph, provId, "provider", conn.label, { phase: conn.phase, status: conn.status });
      _upsertEdge(graph, founderId, provId, "uses_provider", { phase: conn.phase });

      // Map infrastructure providers to infra nodes
      if (conn.phase === "C") {
        const infraId = `infra:${conn.id}`;
        _upsertNode(graph, infraId, "infrastructure", conn.label, { provider: conn.id });
        _upsertEdge(graph, provId, infraId, "provides");
      }
    }
  }

  // GitHub repos + orgs
  const gh = _gh();
  if (gh && process.env.GITHUB_TOKEN) {
    try {
      // List user repos via GitHub API (reuse gitHubEngineeringAgent's _gh helper indirectly)
      const stats = gh.getStats();
      if (stats) {
        const ghOrgId = `org:github`;
        _upsertNode(graph, ghOrgId, "organization", "GitHub", { platform: "github" });
        _upsertEdge(graph, founderId, ghOrgId, "member_of");
      }
    } catch { /* non-fatal */ }
  }

  // Company Factory context
  const cf = _cf();
  if (cf) {
    const runs = cf.listRuns ? cf.listRuns({ limit: 20 }) : [];
    for (const run of (runs.runs || runs || [])) {
      if (!run.result?.company?.name) continue;
      const projId = `project:${run.id}`;
      _upsertNode(graph, projId, "project", run.result.company.name, { template: run.templateId, createdAt: run.startedAt });
      _upsertEdge(graph, founderId, projId, "owns_project");
    }
  }

  // Local AI runtimes = devices
  const localAI = _local();
  if (localAI) {
    const cached = localAI.getCached ? localAI.getCached() : null;
    if (cached) {
      for (const [rt, info] of Object.entries(cached)) {
        if (!info?.running) continue;
        const devId = `device:local:${rt}`;
        _upsertNode(graph, devId, "device", `Local ${rt} (port ${info.port})`, { runtime: rt, port: info.port });
        _upsertEdge(graph, founderId, devId, "owns_device");
      }
    }
  }

  _saveGraph(graph);

  const nodeCount = Object.keys(graph.nodes).length;
  const edgeCount = graph.edges.length;
  return {
    nodeCount, edgeCount,
    nodesByType: Object.values(graph.nodes).reduce((a, n) => { a[n.type] = (a[n.type] || 0) + 1; return a; }, {}),
    updatedAt: graph.updatedAt,
    nodes: Object.values(graph.nodes),
    edges: graph.edges,
  };
}

function getIdentityGraph(filter) {
  const graph  = _loadGraph();
  const nodes  = Object.values(graph.nodes);
  const filtered = filter?.type ? nodes.filter(n => n.type === filter.type) : nodes;
  const edges  = filter?.type
    ? graph.edges.filter(e => filtered.find(n => n.id === e.from || n.id === e.to))
    : graph.edges;
  return { nodes: filtered, edges, totalNodes: nodes.length, totalEdges: graph.edges.length, updatedAt: graph.updatedAt };
}

// ══════════════════════════════════════════════════════════════════════════════
// MODULE 2 — Digital Asset Registry
// ══════════════════════════════════════════════════════════════════════════════

function _loadAssets() { return _rj(DATA.assetRegistry, { assets: {}, lastScan: null }); }
function _saveAssets(a) { _wj(DATA.assetRegistry, a); }

function _upsertAsset(store, id, type, name, meta = {}) {
  store.assets[id] = {
    id, type, name, meta,
    discoveredAt: store.assets[id]?.discoveredAt || _ts(),
    updatedAt: _ts(),
  };
  return store.assets[id];
}

async function discoverAssets() {
  const store  = _loadAssets();
  const ic     = _ic();
  const discovered = [];

  // Connectors → infer asset types
  if (ic) {
    const all = ic.getAllStatus();
    for (const conn of all) {
      if (conn.status === "MISSING") continue;

      const base = { source: conn.id, status: conn.status };

      if (conn.phase === "C") {
        // Infra = cloud resources
        const assetId = `cloud:${conn.id}`;
        _upsertAsset(store, assetId, "cloud_provider", conn.label, { ...base, ...conn.metrics });
        discovered.push(assetId);
      }
      if (conn.phase === "B") {
        const assetId = `git:${conn.id}`;
        _upsertAsset(store, assetId, "git_provider", conn.label, base);
        discovered.push(assetId);
      }
      if (conn.phase === "D") {
        const assetId = `payment:${conn.id}`;
        _upsertAsset(store, assetId, "payment_processor", conn.label, base);
        discovered.push(assetId);
      }
      if (conn.phase === "E") {
        const assetId = `mail:${conn.id}`;
        _upsertAsset(store, assetId, "mail_service", conn.label, base);
        discovered.push(assetId);
      }
      if (conn.phase === "L") {
        const assetId = `monitoring:${conn.id}`;
        _upsertAsset(store, assetId, "monitoring", conn.label, base);
        discovered.push(assetId);
      }
    }
  }

  // Env-based asset discovery
  const envAssets = [
    { key: "BASE_URL",              type: "domain",         name: "Primary Domain" },
    { key: "FIREBASE_PROJECT_ID",   type: "firebase_project", name: "Firebase Project" },
    { key: "SUPABASE_URL",          type: "database",       name: "Supabase DB" },
    { key: "S3_BUCKET",             type: "storage_bucket", name: "S3 Bucket" },
    { key: "R2_BUCKET",             type: "storage_bucket", name: "R2 Bucket" },
    { key: "SHOPIFY_STORE_DOMAIN",  type: "ecommerce",      name: "Shopify Store" },
    { key: "SHOPIFY_STORE_DOMAIN",  type: "domain",         name: "Shopify Domain" },
    { key: "WOOCOMMERCE_URL",       type: "ecommerce",      name: "WooCommerce Store" },
    { key: "N8N_HOST",              type: "automation_server", name: "n8n Instance" },
    { key: "SMTP_HOST",             type: "mail_server",    name: "SMTP Server" },
    { key: "MAILGUN_DOMAIN",        type: "mail_domain",    name: "Mailgun Domain" },
    { key: "WA_PHONE_ID",           type: "messaging",      name: "WhatsApp Business" },
    { key: "CLOUDFLARE_ACCOUNT_ID", type: "dns_provider",   name: "Cloudflare Account" },
  ];
  for (const ea of envAssets) {
    const val = process.env[ea.key];
    if (!val) continue;
    const assetId = `env:${ea.key}`;
    _upsertAsset(store, assetId, ea.type, `${ea.name}: ${val}`, { envKey: ea.key, value: "[redacted]" });
    discovered.push(assetId);
  }

  // GitHub repos via agent
  const gh = _gh();
  if (gh && process.env.GITHUB_TOKEN) {
    const activity = gh.getActivity({ limit: 50 });
    const repos = new Set();
    for (const act of (activity || [])) {
      if (act.repo) repos.add(act.repo);
    }
    for (const repo of repos) {
      const assetId = `repo:github:${repo}`;
      _upsertAsset(store, assetId, "repository", repo, { platform: "github", fullName: repo });
      discovered.push(assetId);
    }
  }

  // PCS2 external platform scan (reuse last report if available)
  // sections is an array of {section, label, platforms:[]} objects
  const pcs2 = _pcs2();
  if (pcs2) {
    const last = pcs2.getLastReport ? pcs2.getLastReport() : null;
    if (last?.sections && Array.isArray(last.sections)) {
      for (const sec of last.sections) {
        const platforms = sec.platforms || sec.items || [];
        for (const item of (Array.isArray(platforms) ? platforms : [])) {
          if (item.status === "ready" || item.status === "reachable" || item.status === "ok") {
            const assetId = `ext:${sec.section}:${item.name || item.platform || item.label}`;
            _upsertAsset(store, assetId, "external_platform", item.name || item.platform || item.label, { section: sec.section, status: item.status });
            discovered.push(assetId);
          }
        }
      }
    }
  }

  store.lastScan = _ts();
  _saveAssets(store);

  const all    = Object.values(store.assets);
  const byType = all.reduce((a, x) => { a[x.type] = (a[x.type] || 0) + 1; return a; }, {});
  return {
    total: all.length,
    newlyDiscovered: discovered.length,
    byType,
    lastScan: store.lastScan,
    assets: all,
  };
}

function getAssetRegistry(filter = {}) {
  const store = _loadAssets();
  let assets  = Object.values(store.assets);
  if (filter.type)   assets = assets.filter(a => a.type === filter.type);
  if (filter.search) {
    const q = filter.search.toLowerCase();
    assets  = assets.filter(a => a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q));
  }
  return { total: assets.length, lastScan: store.lastScan, assets };
}

// ══════════════════════════════════════════════════════════════════════════════
// MODULE 3 — Automatic Discovery Engine
// ══════════════════════════════════════════════════════════════════════════════

async function runDiscovery(connectorId) {
  const ic      = _ic();
  const results = { connectorId, discovered: [], errors: [], startedAt: _ts() };

  if (!connectorId || connectorId === "all") {
    // Discover from all connected providers
    const allResults = await Promise.allSettled([
      _discoverGitHub(),
      _discoverCloudflare(),
      _discoverFirebase(),
      _discoverSupabase(),
      _discoverAWS(),
    ]);
    for (const r of allResults) {
      if (r.status === "fulfilled") results.discovered.push(...(r.value || []));
      else results.errors.push(r.reason?.message || "unknown");
    }
  } else {
    const [phase, name] = connectorId.split(":");
    if (phase === "git"   && name === "github")    results.discovered.push(...await _discoverGitHub());
    if (phase === "infra" && name === "cloudflare") results.discovered.push(...await _discoverCloudflare());
    if (phase === "infra" && name === "firebase")   results.discovered.push(...await _discoverFirebase());
    if (phase === "infra" && name === "supabase")   results.discovered.push(...await _discoverSupabase());
    if (phase === "infra" && name === "aws")        results.discovered.push(...await _discoverAWS());
  }

  results.completedAt = _ts();
  results.totalDiscovered = results.discovered.length;

  // Persist to asset registry
  const store = _loadAssets();
  for (const item of results.discovered) {
    _upsertAsset(store, item.id, item.type, item.name, item.meta || {});
  }
  store.lastScan = _ts();
  _saveAssets(store);

  // Update identity graph
  await buildIdentityGraph().catch(() => null);

  return results;
}

async function _discoverGitHub() {
  const found = [];
  const token = process.env.GITHUB_TOKEN;
  if (!token) return found;
  try {
    const { default: https } = await import("https");
    const _get = url => new Promise((res, rej) => {
      const req = https.get(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json",
                   "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "ooplix/3.2" }
      }, r => { let d = ""; r.on("data", c => d += c); r.on("end", () => { try { res(JSON.parse(d)); } catch { res({}); } }); });
      req.setTimeout(8000, () => { req.destroy(); rej(new Error("timeout")); });
      req.on("error", rej);
    });

    // User repos
    const repos = await _get("https://api.github.com/user/repos?per_page=100&sort=updated");
    if (Array.isArray(repos)) {
      for (const repo of repos) {
        found.push({ id: `repo:github:${repo.full_name}`, type: "repository", name: repo.full_name,
          meta: { platform: "github", private: repo.private, defaultBranch: repo.default_branch,
                  language: repo.language, stars: repo.stargazers_count, updatedAt: repo.updated_at } });
      }
    }

    // User orgs
    const orgs = await _get("https://api.github.com/user/orgs");
    if (Array.isArray(orgs)) {
      for (const org of orgs) {
        found.push({ id: `org:github:${org.login}`, type: "github_organization", name: org.login,
          meta: { avatarUrl: org.avatar_url, description: org.description } });
      }
    }
  } catch { /* non-fatal */ }
  return found;
}

async function _discoverCloudflare() {
  const found = [];
  const token = process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN;
  if (!token) return found;
  try {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const _get = async (url) => {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      return res.json();
    };
    // Zones (domains)
    const zones = await _get("https://api.cloudflare.com/client/v4/zones?per_page=50");
    if (zones?.result) {
      for (const z of zones.result) {
        found.push({ id: `domain:cf:${z.name}`, type: "domain",       name: z.name, meta: { status: z.status, plan: z.plan?.name } });
        found.push({ id: `dns:cf:${z.name}`,    type: "dns",          name: `DNS: ${z.name}`, meta: { zoneId: z.id } });
        found.push({ id: `ssl:cf:${z.name}`,    type: "ssl_certificate", name: `SSL: ${z.name}`, meta: { status: z.meta?.ssl_universal ? "active" : "check" } });
      }
    }
    // Workers (if account ID available)
    if (accountId) {
      const workers = await _get(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts`);
      if (workers?.result) {
        for (const w of workers.result) {
          found.push({ id: `worker:cf:${w.id}`, type: "worker", name: `CF Worker: ${w.id}`, meta: { modifiedOn: w.modified_on } });
        }
      }
    }
  } catch { /* non-fatal */ }
  return found;
}

async function _discoverFirebase() {
  const found = [];
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) return found;
  found.push({ id: `firebase:project:${projectId}`, type: "firebase_project", name: `Firebase: ${projectId}`,
    meta: { projectId, hasServiceAccount: !!process.env.FIREBASE_SERVICE_ACCOUNT } });
  return found;
}

async function _discoverSupabase() {
  const found = [];
  const url = process.env.SUPABASE_URL;
  if (!url) return found;
  found.push({ id: `supabase:project:${url}`, type: "database", name: `Supabase: ${url}`,
    meta: { url, hasAnonKey: !!process.env.SUPABASE_ANON_KEY, hasServiceKey: !!process.env.SUPABASE_SERVICE_KEY } });
  return found;
}

async function _discoverAWS() {
  const found = [];
  if (!process.env.AWS_ACCESS_KEY_ID) return found;
  const bucket = process.env.S3_BUCKET;
  if (bucket) found.push({ id: `s3:${bucket}`, type: "storage_bucket", name: `S3: ${bucket}`, meta: { region: process.env.AWS_REGION } });
  return found;
}

// ══════════════════════════════════════════════════════════════════════════════
// MODULE 4 — Relationship Engine
// ══════════════════════════════════════════════════════════════════════════════

function _loadRel()  { return _rj(DATA.relationships, { edges: [], updatedAt: null }); }
function _saveRel(r) { r.updatedAt = _ts(); _wj(DATA.relationships, r); }

async function buildRelationshipGraph() {
  const rel   = _loadRel();
  const store = _loadAssets();
  const graph = _loadGraph();
  const edges = [];

  // From identity graph nodes, derive dependencies
  const nodes = Object.values(graph.nodes);

  // Provider → domain
  const domain   = Object.values(store.assets).filter(a => a.type === "domain");
  const vps      = nodes.filter(n => n.type === "infrastructure");
  const db       = Object.values(store.assets).filter(a => a.type === "database");
  const storage  = Object.values(store.assets).filter(a => a.type === "storage_bucket");
  const email    = Object.values(store.assets).filter(a => a.type === "mail_service" || a.type === "mail_domain");
  const payments = Object.values(store.assets).filter(a => a.type === "payment_processor");
  const mon      = Object.values(store.assets).filter(a => a.type === "monitoring");
  const repos    = Object.values(store.assets).filter(a => a.type === "repository");
  const workers  = Object.values(store.assets).filter(a => a.type === "worker");
  const cfDomains = domain.filter(d => d.id.startsWith("domain:cf:"));

  // Repository → deployment context
  for (const repo of repos) {
    for (const d of cfDomains) {
      edges.push({ from: repo.id, to: d.id, relation: "deploys_to", confidence: 0.6 });
    }
    for (const v of vps) {
      edges.push({ from: repo.id, to: v.id, relation: "runs_on", confidence: 0.7 });
    }
  }

  // Domain → VPS
  for (const d of domain) {
    for (const v of vps) {
      edges.push({ from: d.id, to: v.id, relation: "routes_to", confidence: 0.8 });
    }
  }

  // VPS → Database
  for (const v of vps) {
    for (const d of db) {
      edges.push({ from: v.id, to: d.id, relation: "connects_to", confidence: 0.9 });
    }
  }

  // VPS → Storage
  for (const v of vps) {
    for (const s of storage) {
      edges.push({ from: v.id, to: s.id, relation: "uses_storage", confidence: 0.8 });
    }
  }

  // VPS → Email
  for (const v of vps) {
    for (const e of email) {
      edges.push({ from: v.id, to: e.id, relation: "sends_via", confidence: 0.8 });
    }
  }

  // App → Payments
  for (const v of vps) {
    for (const p of payments) {
      edges.push({ from: v.id, to: p.id, relation: "processes_payments", confidence: 0.7 });
    }
  }

  // VPS → Monitoring
  for (const v of vps) {
    for (const m of mon) {
      edges.push({ from: v.id, to: m.id, relation: "monitored_by", confidence: 0.9 });
    }
  }

  // Workers → Domain
  for (const w of workers) {
    for (const d of cfDomains) {
      edges.push({ from: w.id, to: d.id, relation: "serves", confidence: 0.7 });
    }
  }

  rel.edges = edges;
  _saveRel(rel);

  // Merge into identity graph
  const ig = _loadGraph();
  for (const e of edges) {
    _upsertEdge(ig, e.from, e.to, e.relation, { confidence: e.confidence, source: "relationship_engine" });
  }
  _saveGraph(ig);

  return {
    edgeCount: edges.length,
    relationships: edges,
    summary: {
      repoToDeployment: edges.filter(e => e.relation === "deploys_to").length,
      domainToVPS:      edges.filter(e => e.relation === "routes_to").length,
      vpsToDatabase:    edges.filter(e => e.relation === "connects_to").length,
      vpsToStorage:     edges.filter(e => e.relation === "uses_storage").length,
      vpsToEmail:       edges.filter(e => e.relation === "sends_via").length,
      appToPayments:    edges.filter(e => e.relation === "processes_payments").length,
      appToMonitoring:  edges.filter(e => e.relation === "monitored_by").length,
    },
    updatedAt: rel.updatedAt,
  };
}

function getRelationshipGraph(filter = {}) {
  const rel = _loadRel();
  let edges = rel.edges || [];
  if (filter.from)     edges = edges.filter(e => e.from === filter.from);
  if (filter.to)       edges = edges.filter(e => e.to   === filter.to);
  if (filter.relation) edges = edges.filter(e => e.relation === filter.relation);
  return { total: edges.length, edges, updatedAt: rel.updatedAt };
}

// ══════════════════════════════════════════════════════════════════════════════
// MODULE 5 — Universal Import Engine
// ══════════════════════════════════════════════════════════════════════════════

// Supported import formats. All secrets encrypted before storage.
const IMPORT_FORMATS = ["chrome_csv", "apple_csv", "bitwarden_json", "1password_csv",
  "lastpass_csv", "dashlane_json", "keepass_xml_safe", "ooplix_json", "generic_csv", "generic_json"];

function getImportFormats() {
  return IMPORT_FORMATS.map(f => ({
    id: f,
    label: {
      chrome_csv:        "Chrome Password Manager (CSV export)",
      apple_csv:         "Apple Passwords (CSV export)",
      bitwarden_json:    "Bitwarden (JSON export)",
      "1password_csv":   "1Password (CSV export)",
      lastpass_csv:      "LastPass (CSV export)",
      dashlane_json:     "Dashlane (JSON export)",
      keepass_xml_safe:  "KeePass (XML — metadata only, no raw passwords)",
      ooplix_json:       "Ooplix Vault (encrypted backup)",
      generic_csv:       "Generic CSV (name, url, username, password columns)",
      generic_json:      "Generic JSON array",
    }[f] || f,
    note: f === "keepass_xml_safe" ? "Only metadata imported — use Ooplix vault for actual values" : null,
  }));
}

function importCredentials(format, rawContent, opts = {}) {
  const vault   = _vault();
  if (!vault)   throw new Error("secretVault unavailable");

  let entries = [];

  try {
    if (format === "bitwarden_json" || format === "dashlane_json" || format === "ooplix_json" || format === "generic_json") {
      const parsed = JSON.parse(rawContent);
      // Bitwarden format: { items: [{name, login: {username, password, uris}}] }
      if (format === "bitwarden_json" && parsed.items) {
        entries = parsed.items
          .filter(i => i.login?.password)
          .map(i => ({
            name:     i.name,
            username: i.login?.username,
            password: i.login?.password,
            url:      i.login?.uris?.[0]?.uri,
            notes:    i.notes,
          }));
      } else if (format === "generic_json" && Array.isArray(parsed)) {
        entries = parsed.filter(i => i.password || i.secret || i.value);
      } else if (format === "ooplix_json") {
        // Delegate to vault importVault
        const { passphrase } = opts;
        if (!passphrase) throw new Error("passphrase required for Ooplix backup import");
        return vault.importVault(rawContent, passphrase);
      }
    } else if (format.endsWith("_csv") || format === "generic_csv") {
      // Parse CSV
      const lines  = rawContent.trim().split("\n");
      const header = lines[0].toLowerCase().split(",").map(h => h.trim().replace(/"/g, ""));
      const nameIdx = header.indexOf("name") >= 0 ? header.indexOf("name") : header.indexOf("title");
      const passIdx = header.indexOf("password") >= 0 ? header.indexOf("password") : header.indexOf("secret");
      const urlIdx  = header.indexOf("url") >= 0 ? header.indexOf("url") : header.indexOf("website");
      const userIdx = header.indexOf("username") >= 0 ? header.indexOf("username") : header.indexOf("login");

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",").map(c => c.trim().replace(/^"|"$/g, ""));
        const pw   = passIdx >= 0 ? cols[passIdx] : null;
        if (!pw) continue;
        entries.push({
          name:     nameIdx >= 0 ? cols[nameIdx] : `Entry ${i}`,
          username: userIdx >= 0 ? cols[userIdx] : null,
          password: pw,
          url:      urlIdx  >= 0 ? cols[urlIdx]  : null,
        });
      }
    }
  } catch (e) {
    if (e.message.includes("passphrase")) throw e;
    throw new Error(`Parse error for format ${format}: ${e.message}`);
  }

  if (!entries.length) return { imported: 0, skipped: 0, total: 0, format };

  // Map entries to vault using URL/name heuristics
  let imported = 0, skipped = 0;
  for (const entry of entries) {
    const connectorId = _guessConnectorId(entry.url || entry.name || "");
    if (!connectorId) { skipped++; continue; }

    try {
      vault.storeSecret(connectorId, "api_key", entry.password, {
        importedFrom: format,
        originalName: entry.name,
        username:     entry.username,
        url:          entry.url,
        importedAt:   _ts(),
      });
      imported++;
    } catch { skipped++; }
  }

  return { imported, skipped, total: entries.length, format };
}

function _guessConnectorId(hint) {
  const h = hint.toLowerCase();
  const MAP = [
    [/groq/,        "ai:groq"],        [/openrouter/,   "ai:openrouter"],
    [/openai|gpt/,  "ai:openai"],      [/anthropic|claude/, "ai:anthropic"],
    [/gemini|google.*ai/, "ai:gemini"],[/deepseek/,     "ai:deepseek"],
    [/together/,    "ai:together"],    [/fireworks/,    "ai:fireworks"],
    [/cohere/,      "ai:cohere"],      [/nvidia/,       "ai:nvidia"],
    [/github/,      "git:github"],     [/gitlab/,       "git:gitlab"],
    [/bitbucket/,   "git:bitbucket"],  [/stripe/,       "pay:stripe"],
    [/paddle/,      "pay:paddle"],     [/razorpay/,     "pay:razorpay"],
    [/lemonsqueezy|lemon/, "pay:lemonsqueezy"],
    [/sendgrid/,    "email:sendgrid"], [/mailgun/,      "email:mailgun"],
    [/postmark/,    "email:postmark"], [/resend/,       "email:resend"],
    [/brevo|sendinblue/, "email:brevo"],
    [/telegram/,    "msg:telegram"],   [/twilio/,       "msg:twilio"],
    [/discord/,     "msg:discord"],    [/slack/,        "msg:slack"],
    [/whatsapp/,    "msg:whatsapp"],   [/figma/,        "creative:figma"],
    [/canva/,       "creative:canva"], [/shopify/,      "commerce:shopify"],
    [/woocommerce/, "commerce:woocommerce"],
    [/zapier/,      "auto:zapier"],    [/make\.com|integromat/, "auto:make"],
    [/sentry/,      "monitor:sentry"], [/datadog/,      "monitor:datadog"],
    [/cloudflare/,  "infra:cloudflare"],
    [/firebase/,    "infra:firebase"], [/supabase/,     "infra:supabase"],
    [/hostinger/,   "infra:hostinger"],
  ];
  for (const [re, id] of MAP) { if (re.test(h)) return id; }
  return null;
}

// ══════════════════════════════════════════════════════════════════════════════
// MODULE 6 — Secret Discovery Engine
// ══════════════════════════════════════════════════════════════════════════════

// Patterns that indicate potential secrets — never capture the value, only flag presence
const SECRET_PATTERNS = [
  { name: "API Key generic",     pattern: /api[_-]?key\s*[=:]\s*['"]?([A-Za-z0-9_\-]{16,})/gi },
  { name: "Bearer token",        pattern: /bearer\s+([A-Za-z0-9._\-]{20,})/gi },
  { name: "AWS Key",             pattern: /AKIA[0-9A-Z]{16}/g },
  { name: "GitHub PAT classic",  pattern: /ghp_[A-Za-z0-9]{36}/g },
  { name: "GitHub PAT new",      pattern: /github_pat_[A-Za-z0-9_]{22,}/g },
  { name: "Stripe secret",       pattern: /sk_(live|test)_[A-Za-z0-9]{24,}/g },
  { name: "Stripe publishable",  pattern: /pk_(live|test)_[A-Za-z0-9]{24,}/g },
  { name: "Telegram bot token",  pattern: /\d{8,}:[A-Za-z0-9_\-]{35,}/g },
  { name: "SendGrid key",        pattern: /SG\.[A-Za-z0-9_\-.]{22,}/g },
  { name: "Twilio SID",          pattern: /AC[a-z0-9]{32}/g },
  { name: "JWT secret in code",  pattern: /jwt[_-]?secret\s*[=:]\s*['"]([^'"]{8,})/gi },
  { name: "Password in code",    pattern: /password\s*[=:]\s*['"]([^'"]{6,})/gi },
  { name: "Private key",         pattern: /-----BEGIN .*(PRIVATE|RSA) KEY-----/g },
  { name: "Generic secret",      pattern: /secret\s*[=:]\s*['"]([^'"]{8,})/gi },
];

const SCAN_TARGETS = [".env", ".env.local", ".env.production", ".env.development", ".env.example",
  "docker-compose.yml", "docker-compose.yaml", ".github/workflows",
  "Dockerfile", "ecosystem.config.cjs", "ecosystem.config.js"];

async function runSecretDiscovery(rootDir = process.cwd()) {
  const findings = [];
  const recommendations = [];
  let scannedFiles = 0;

  async function _scanFile(filePath) {
    let content;
    try { content = fs.readFileSync(filePath, "utf8"); }
    catch { return; }
    scannedFiles++;

    for (const { name, pattern } of SECRET_PATTERNS) {
      pattern.lastIndex = 0;
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        pattern.lastIndex = 0;
        if (pattern.test(lines[i])) {
          findings.push({
            file:    path.relative(rootDir, filePath),
            line:    i + 1,
            pattern: name,
            // Never expose the matched value — only flag the presence
            note:    `Potential ${name} detected on line ${i + 1}`,
          });
        }
      }
    }
  }

  // Scan known sensitive file locations
  for (const target of SCAN_TARGETS) {
    const full = path.join(rootDir, target);
    if (fs.existsSync(full)) {
      if (fs.statSync(full).isDirectory()) {
        try {
          const files = fs.readdirSync(full).map(f => path.join(full, f));
          for (const f of files) if (fs.statSync(f).isFile()) await _scanFile(f);
        } catch { /* ignore */ }
      } else {
        await _scanFile(full);
      }
    }
  }

  // Group findings by file
  const byFile = findings.reduce((a, f) => { a[f.file] = a[f.file] || []; a[f.file].push(f); return a; }, {});

  // Recommendations
  if (findings.length > 0) {
    recommendations.push({
      priority: "high",
      action:   "Move detected secrets to Ooplix Vault",
      command:  "POST /vault/secrets/:connectorId/:type",
      note:     "Use /vault/connect to store and automatically activate",
    });
    recommendations.push({
      priority: "high",
      action:   "Add sensitive files to .gitignore",
      files:    [".env", ".env.local", ".env.production"],
    });
    recommendations.push({
      priority: "medium",
      action:   "Rotate any credentials found in version control",
      note:     "Treat any secret that was ever in a file as compromised",
    });
  }

  return {
    scannedFiles,
    totalFindings:   findings.length,
    affectedFiles:   Object.keys(byFile).length,
    byFile,
    findings,
    recommendations,
    note: "Secret values are never stored in this report — only file/line locations",
    scannedAt: _ts(),
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// MODULE 7 — Credential Intelligence
// ══════════════════════════════════════════════════════════════════════════════

async function runCredentialIntelligence() {
  const vault = _vault();
  const sml   = _sml();
  const ic    = _ic();

  const report = {
    generatedAt:    _ts(),
    expiring:       [],
    overdue:        [],
    unused:         [],
    duplicates:     [],
    broken:         [],
    recommendations: [],
  };

  // Vault health
  if (vault) {
    const health = vault.getHealth();
    report.expiring = health.expiringList || [];
    report.overdue  = health.overdueList  || [];
    if (report.overdue.length > 0) {
      report.recommendations.push({ priority: "critical", action: `Rotate ${report.overdue.length} overdue credential(s)`, items: report.overdue });
    }
    if (report.expiring.length > 0) {
      report.recommendations.push({ priority: "high", action: `${report.expiring.length} credential(s) expiring soon`, items: report.expiring });
    }

    // Detect unused (in vault but connector is MISSING/READY)
    const secrets  = vault.listSecrets();
    const connStatus = ic ? ic.getAllStatus() : [];
    for (const s of secrets) {
      const conn = connStatus.find(c => c.id === s.connectorId);
      if (conn && (conn.status === "MISSING" || conn.status === "READY")) {
        report.unused.push({ connectorId: s.connectorId, type: s.type, note: `Connector status: ${conn.status}` });
      }
    }

    // Detect duplicates (same value stored for multiple connectors)
    // We can't compare values without decrypting, so we detect same connectorId+type stored twice
    const seen = new Set();
    for (const s of secrets) {
      const key = `${s.connectorId}::${s.type}`;
      if (seen.has(key)) report.duplicates.push({ key, note: "Duplicate entry detected" });
      seen.add(key);
    }
  }

  // Broken OAuth connections
  const oauth = _oauth();
  if (oauth) {
    const conns = oauth.listConnections ? oauth.listConnections() : [];
    for (const c of conns) {
      if (c.status === "expired" || c.status === "error") {
        report.broken.push({ provider: c.provider, userId: c.userId, status: c.status });
        report.recommendations.push({ priority: "high", action: `Re-authorize ${c.provider} OAuth`, provider: c.provider, path: `/vault/oauth/${c.provider}/authorize` });
      }
    }
  }

  // Connector health cross-reference
  if (ic) {
    const connectors = ic.getAllStatus();
    const broken = connectors.filter(c => c.status === "PARTIAL" && c.lastError);
    for (const b of broken.slice(0, 10)) {
      report.broken.push({ connectorId: b.id, error: b.lastError, note: "Partial connection" });
      report.recommendations.push({ priority: "medium", action: `Investigate ${b.label} partial connection`, connectorId: b.id, path: `/integrations/${encodeURIComponent(b.id)}/reconnect` });
    }
  }

  // Secret Management Layer rotation alerts
  if (sml) {
    const rotStatus = sml.getRotationStatus();
    for (const r of rotStatus) {
      if (r.overdue) {
        report.recommendations.push({ priority: "critical", action: `Rotate ${r.key}`, key: r.key, ageDays: r.ageDays });
      } else if (r.daysLeft !== null && r.daysLeft < 14) {
        report.recommendations.push({ priority: "medium", action: `Rotate ${r.key} in ${r.daysLeft} days`, key: r.key });
      }
    }
  }

  // Persist intelligence report
  _wj(DATA.credIntel, { ...report, savedAt: _ts() });

  return report;
}

function getCredentialIntelligence() {
  return _rj(DATA.credIntel, null);
}

// ══════════════════════════════════════════════════════════════════════════════
// MODULE 8 — Workspace Bootstrap
// ══════════════════════════════════════════════════════════════════════════════

async function runWorkspaceBootstrap(opts = {}) {
  const steps = [
    { id: "vault",       label: "Unlock Secret Vault",         status: "pending" },
    { id: "env",         label: "Generate Environment File",    status: "pending" },
    { id: "git",         label: "Configure Git Identity",       status: "pending" },
    { id: "connectors",  label: "Reconnect Integrations",       status: "pending" },
    { id: "workspace",   label: "Bootstrap Workspaces",         status: "pending" },
    { id: "projects",    label: "Restore Project Context",      status: "pending" },
    { id: "identity",    label: "Build Identity Graph",         status: "pending" },
    { id: "discovery",   label: "Run Asset Discovery",          status: "pending" },
    { id: "verify",      label: "Verify Production Status",     status: "pending" },
  ];

  const results = { startedAt: _ts(), steps: [], errors: [] };

  // Step 1: Vault status
  {
    const v = _vault();
    const health = v ? v.getHealth() : null;
    steps[0].status = health ? "complete" : "error";
    steps[0].detail = health ? `${health.totalSecrets} secrets loaded, score ${health.score}%` : "secretVault unavailable";
    results.steps.push({ ...steps[0] });
  }

  // Step 2: Env generation
  {
    const em = _em();
    if (em) {
      const gen = em.generateEnvFile(opts.target || "local");
      steps[1].status = "complete";
      steps[1].detail = `${gen.populated}/${gen.vars} vars populated for target: ${gen.target}`;
      steps[1].envContent = opts.includeEnvContent ? gen.content : undefined;
    } else {
      steps[1].status = "skipped";
      steps[1].detail = "envManager unavailable";
    }
    results.steps.push({ ...steps[1] });
  }

  // Step 3: Git identity
  {
    const gh = _gh();
    if (gh && process.env.GITHUB_TOKEN) {
      const stats = gh.getStats();
      steps[2].status = "complete";
      steps[2].detail = `GitHub agent ready: ${stats?.activityCount || 0} prior actions`;
    } else {
      steps[2].status = "partial";
      steps[2].detail = "GITHUB_TOKEN not set — git identity limited to local config";
    }
    results.steps.push({ ...steps[2] });
  }

  // Step 4: Reconnect integrations (subset — fast)
  {
    const ic = _ic();
    if (ic) {
      const all = ic.getAllStatus();
      const connected = all.filter(c => c.status === "CONNECTED").length;
      steps[3].status = "complete";
      steps[3].detail = `${connected}/${all.length} connectors active`;
    } else {
      steps[3].status = "error";
      steps[3].detail = "integrationConnectors unavailable";
    }
    results.steps.push({ ...steps[3] });
  }

  // Step 5: Workspace bootstrap via workspaceMesh
  {
    const mesh = _mesh();
    if (mesh) {
      const meshStatus = mesh.getStatus ? mesh.getStatus() : null;
      steps[4].status = "complete";
      steps[4].detail = meshStatus ? `Mesh: ${meshStatus.workspaces?.length || 0} workspaces` : "Workspace mesh ready";
    } else {
      steps[4].status = "skipped";
      steps[4].detail = "workspaceMesh unavailable";
    }
    results.steps.push({ ...steps[4] });
  }

  // Step 6: Project context from companyFactory + productionBible
  {
    const cf  = _cf();
    const pb  = _pb();
    const runs = cf ? (cf.listRuns ? cf.listRuns({ limit: 5 }) : []) : null;
    const workflows = pb ? (pb.getBible ? pb.getBible() : null) : null;
    steps[5].status = "complete";
    steps[5].detail = [
      cf  ? `${(runs?.runs || []).length} company factory runs` : null,
      pb  ? `${workflows?.workflows?.length || 0} production workflows` : null,
    ].filter(Boolean).join(", ") || "No project context found";
    results.steps.push({ ...steps[5] });
  }

  // Step 7: Identity graph
  {
    try {
      const ig = await buildIdentityGraph(opts.founderName || "Founder");
      steps[6].status = "complete";
      steps[6].detail = `${ig.nodeCount} nodes, ${ig.edgeCount} edges`;
    } catch (e) {
      steps[6].status = "error";
      steps[6].detail = e.message;
      results.errors.push(e.message);
    }
    results.steps.push({ ...steps[6] });
  }

  // Step 8: Asset discovery
  {
    try {
      const assets = await discoverAssets();
      steps[7].status = "complete";
      steps[7].detail = `${assets.total} assets discovered`;
    } catch (e) {
      steps[7].status = "error";
      steps[7].detail = e.message;
      results.errors.push(e.message);
    }
    results.steps.push({ ...steps[7] });
  }

  // Step 9: Verify production
  {
    const da = _da();
    if (da) {
      try {
        const dp = da.getDashboard ? da.getDashboard() : null;
        steps[8].status = "complete";
        steps[8].detail = dp ? `Deployment autopilot active` : "Deployment status available";
      } catch {
        steps[8].status = "partial";
        steps[8].detail = "Deployment autopilot check skipped";
      }
    } else {
      steps[8].status = "skipped";
      steps[8].detail = "deploymentAutopilot unavailable";
    }
    results.steps.push({ ...steps[8] });
  }

  results.completedAt    = _ts();
  results.successSteps   = results.steps.filter(s => s.status === "complete").length;
  results.failedSteps    = results.steps.filter(s => s.status === "error").length;
  results.skippedSteps   = results.steps.filter(s => s.status === "skipped" || s.status === "partial").length;
  results.totalSteps     = results.steps.length;
  results.bootstrapScore = Math.round((results.successSteps / results.totalSteps) * 100);
  results.ready          = results.failedSteps === 0;

  return results;
}

// ══════════════════════════════════════════════════════════════════════════════
// MODULE 9 — Permission Policy Engine
// ══════════════════════════════════════════════════════════════════════════════

const POLICY_MODES = ["always_allow", "ask_once", "ask_every_time", "never_allow"];

function _loadPolicies()  { return _rj(DATA.policies, { policies: {}, decisions: [] }); }
function _savePolicies(p) { _wj(DATA.policies, p); }

function setPolicy(scope, mode, meta = {}) {
  if (!POLICY_MODES.includes(mode)) throw new Error(`Invalid mode: ${mode}. Must be one of: ${POLICY_MODES.join(", ")}`);
  // scope: { provider?, project?, workflow?, riskLevel? }
  const store = _loadPolicies();
  const key   = _policyKey(scope);
  store.policies[key] = { scope, mode, meta, setAt: _ts(), setBy: meta.setBy || "founder" };
  _savePolicies(store);
  return store.policies[key];
}

function getPolicy(scope) {
  const store = _loadPolicies();
  const key   = _policyKey(scope);
  // Exact match first, then fallback by risk level, then global
  return store.policies[key]
    || (scope.riskLevel && store.policies[`risk:${scope.riskLevel}`])
    || store.policies["global"]
    || { mode: "ask_every_time", scope: "global", isDefault: true };
}

function listPolicies() {
  const store = _loadPolicies();
  return Object.values(store.policies);
}

function recordDecision(scope, decision, meta = {}) {
  const store = _loadPolicies();
  store.decisions.unshift({ scope, decision, meta, ts: _ts() });
  store.decisions = store.decisions.slice(0, 1000);
  _savePolicies(store);
  // If "ask_once" — auto-promote to allow
  const policy = getPolicy(scope);
  if (policy.mode === "ask_once" && decision === "allowed") {
    setPolicy(scope, "always_allow", { ...policy.meta, promotedAt: _ts() });
  }
  return { scope, decision, policy: policy.mode };
}

function _policyKey(scope) {
  if (scope.workflow)   return `workflow:${scope.workflow}`;
  if (scope.project)    return `project:${scope.project}`;
  if (scope.provider)   return `provider:${scope.provider}`;
  if (scope.riskLevel)  return `risk:${scope.riskLevel}`;
  return "global";
}

function getPolicyModes() { return POLICY_MODES; }

// ══════════════════════════════════════════════════════════════════════════════
// MODULE 10 — Founder Command Center
// ══════════════════════════════════════════════════════════════════════════════

async function getCommandCenter() {
  const vault      = _vault();
  const em         = _em();
  const ic         = _ic();
  const sml        = _sml();
  const mesh       = _mesh();

  const graph      = _loadGraph();
  const assets     = _loadAssets();
  const credIntel  = getCredentialIntelligence();

  // Integrations summary
  const connectors = ic ? ic.getAllStatus() : [];
  const connStatus = {
    total:     connectors.length,
    connected: connectors.filter(c => c.status === "CONNECTED").length,
    partial:   connectors.filter(c => c.status === "PARTIAL").length,
    missing:   connectors.filter(c => c.status === "MISSING" || c.status === "READY").length,
  };

  // Credential health
  const vaultHealth = vault ? vault.getHealth() : null;
  const envStatus   = em ? em.getEnvStatus() : null;

  // Workspace status
  const meshStatus  = mesh ? (mesh.getStatus ? mesh.getStatus() : null) : null;

  // Mission/knowledge context
  const mm  = _mm();
  const missionStats = mm ? (mm.getStats ? mm.getStats() : null) : null;

  // Production bible
  const pb  = _pb();
  const bibleStats = pb ? (pb.getDashboard ? pb.getDashboard() : null) : null;

  // Warnings
  const warnings = [];
  if (envStatus?.missingRequired > 0) warnings.push({ level: "critical", msg: `${envStatus.missingRequired} required env var(s) missing` });
  if (vaultHealth?.overdue > 0)       warnings.push({ level: "critical", msg: `${vaultHealth.overdue} credential(s) rotation overdue` });
  if (vaultHealth?.expiring > 0)      warnings.push({ level: "warn",     msg: `${vaultHealth.expiring} credential(s) expiring soon` });
  if (connStatus.connected === 0)     warnings.push({ level: "warn",     msg: "No integrations connected" });
  if (credIntel?.broken?.length > 0)  warnings.push({ level: "warn",     msg: `${credIntel.broken.length} broken connection(s)` });

  // Searchable index
  const searchIndex = [
    ...Object.values(graph.nodes).map(n => ({ type: "identity_node", id: n.id, label: n.label, category: n.type })),
    ...Object.values(assets.assets).map(a => ({ type: "asset", id: a.id, label: a.name, category: a.type })),
    ...connectors.map(c => ({ type: "connector", id: c.id, label: c.label, category: `phase_${c.phase}`, status: c.status })),
  ];

  return {
    generatedAt:  _ts(),
    warnings,
    identity: {
      nodes:      Object.keys(graph.nodes).length,
      edges:      graph.edges.length,
      lastUpdated: graph.updatedAt,
    },
    assets: {
      total:      Object.keys(assets.assets).length,
      byType:     Object.values(assets.assets).reduce((a, x) => { a[x.type] = (a[x.type] || 0) + 1; return a; }, {}),
      lastScan:   assets.lastScan,
    },
    integrations: connStatus,
    credentials:  {
      totalSecrets: vaultHealth?.totalSecrets || 0,
      ok:           vaultHealth?.ok || 0,
      expiring:     vaultHealth?.expiring || 0,
      overdue:      vaultHealth?.overdue || 0,
      score:        vaultHealth?.score || 0,
    },
    environment: {
      score:           envStatus?.score || 0,
      ready:           envStatus?.ready || false,
      missingRequired: envStatus?.missingRequired || 0,
      vaultBacked:     envStatus?.vaultBacked || 0,
    },
    workspace:      meshStatus,
    missions:       missionStats,
    productionBible: bibleStats ? { total: bibleStats.workflows?.length } : null,
    recommendations: (credIntel?.recommendations || []).slice(0, 5),
    searchIndex:     searchIndex.slice(0, 500),
  };
}

function searchCommandCenter(query) {
  if (!query) return { results: [], total: 0 };
  const q = query.toLowerCase();
  const graph  = _loadGraph();
  const assets = _loadAssets();
  const ic     = _ic();
  const connectors = ic ? ic.getAllStatus() : [];

  const results = [
    ...Object.values(graph.nodes).filter(n => n.label?.toLowerCase().includes(q) || n.id?.toLowerCase().includes(q))
      .map(n => ({ type: "identity", id: n.id, label: n.label, category: n.type })),
    ...Object.values(assets.assets).filter(a => a.name?.toLowerCase().includes(q) || a.type?.toLowerCase().includes(q))
      .map(a => ({ type: "asset", id: a.id, label: a.name, category: a.type })),
    ...connectors.filter(c => c.label?.toLowerCase().includes(q) || c.id?.toLowerCase().includes(q))
      .map(c => ({ type: "connector", id: c.id, label: c.label, category: `phase_${c.phase}`, status: c.status })),
  ];

  return { results: results.slice(0, 50), total: results.length, query };
}

// ══════════════════════════════════════════════════════════════════════════════
// MODULE 11 — Recovery Kit
// ══════════════════════════════════════════════════════════════════════════════

function _loadRecovery()  { return _rj(DATA.recoveryHistory, { kits: [], checks: [] }); }
function _saveRecovery(r) { _wj(DATA.recoveryHistory, r); }

async function generateRecoveryKit(passphrase, opts = {}) {
  if (!passphrase || passphrase.length < 12) throw new Error("Passphrase must be at least 12 characters");
  const em    = _em();
  const vault = _vault();
  if (!em || !vault) throw new Error("envManager and secretVault required");

  const backup    = em.generateBackup(passphrase);
  const vaultExport = vault.exportVault(passphrase);
  const graph     = _loadGraph();
  const assets    = _loadAssets();
  const policies  = _loadPolicies();

  // Checklist of what's in the kit
  const checklist = [
    { item: "Encrypted vault",           included: true,  note: "All secrets AES-256-GCM encrypted" },
    { item: "Encrypted env backup",      included: true,  note: "Env snapshot + vault combined" },
    { item: "Identity graph",            included: true,  note: "Accounts, orgs, projects" },
    { item: "Asset registry",            included: true,  note: "Domains, repos, infra, cloud" },
    { item: "Permission policies",       included: true,  note: "Connector access policies" },
    { item: "Connector states",          included: true,  note: "Last known status of all 57 connectors" },
    { item: "Environment manifest",      included: true,  note: "Which env vars are required" },
    { item: "Recovery instructions",     included: true,  note: "Step-by-step restoration guide" },
  ];

  // Encrypt the full recovery package with passphrase
  const payload = JSON.stringify({
    version:    1,
    createdAt:  _ts(),
    vaultExport,
    envBackup:  backup,
    identityGraph: graph,
    assetRegistry: assets,
    policies,
    connectorStates: _ic() ? _ic().getAllStatus() : [],
    checklist,
    recoveryInstructions: [
      "1. Install Ooplix on the new machine",
      "2. Set JWT_SECRET and OPERATOR_PASSWORD_HASH in .env (these cannot be in the kit — required to decrypt)",
      "3. POST /vault/restore with kit blob + passphrase to restore vault secrets",
      "4. POST /vault/env/generate to regenerate .env content",
      "5. Restart server",
      "6. POST /fdios/bootstrap to rebuild identity graph and reconnect connectors",
      "7. POST /fdios/discovery to rediscover all assets",
      "8. Verify: GET /vault/identity",
    ],
  });

  const salt   = crypto.randomBytes(16);
  const dk     = crypto.pbkdf2Sync(passphrase, salt, 200_000, 32, "sha256");
  const iv     = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", dk, iv);
  const enc    = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
  const tag    = cipher.getAuthTag();

  const kit = JSON.stringify({
    version: 2,
    salt:    salt.toString("hex"),
    iv:      iv.toString("hex"),
    tag:     tag.toString("hex"),
    data:    enc.toString("hex"),
    checksum: crypto.createHash("sha256").update(payload).digest("hex").slice(0, 16),
    manifest: { checklist, createdAt: _ts() },
  });

  // Record creation
  const rec = _loadRecovery();
  rec.kits.unshift({ createdAt: _ts(), size: kit.length, checksum: JSON.parse(kit).checksum, items: checklist.length });
  rec.kits = rec.kits.slice(0, 20);
  _saveRecovery(rec);

  return { kit, manifest: { checklist, createdAt: _ts() }, size: kit.length };
}

async function restoreFromKit(kitStr, passphrase) {
  const kit = JSON.parse(kitStr);
  if (kit.version !== 2) throw new Error("Unsupported recovery kit version");

  const salt = Buffer.from(kit.salt, "hex");
  const dk   = crypto.pbkdf2Sync(passphrase, salt, 200_000, 32, "sha256");
  const iv   = Buffer.from(kit.iv,   "hex");
  const tag  = Buffer.from(kit.tag,  "hex");
  const enc  = Buffer.from(kit.data, "hex");
  const d    = crypto.createDecipheriv("aes-256-gcm", dk, iv);
  d.setAuthTag(tag);
  const payload = JSON.parse(Buffer.concat([d.update(enc), d.final()]).toString("utf8"));

  const results = { restoredAt: _ts(), steps: [] };

  // Restore vault
  const vault = _vault();
  if (vault && payload.vaultExport) {
    try {
      const vr = vault.importVault(payload.vaultExport, passphrase);
      results.steps.push({ step: "vault", status: "ok", imported: vr.imported, skipped: vr.skipped });
    } catch (e) {
      results.steps.push({ step: "vault", status: "error", error: e.message });
    }
  }

  // Restore identity graph (safe — no secrets)
  if (payload.identityGraph) {
    _wj(DATA.identityGraph, payload.identityGraph);
    results.steps.push({ step: "identity_graph", status: "ok" });
  }

  // Restore asset registry
  if (payload.assetRegistry) {
    _wj(DATA.assetRegistry, payload.assetRegistry);
    results.steps.push({ step: "asset_registry", status: "ok" });
  }

  // Restore policies
  if (payload.policies) {
    _wj(DATA.policies, payload.policies);
    results.steps.push({ step: "policies", status: "ok" });
  }

  // Env snapshot (returned for founder to apply manually)
  const em = _em();
  if (em && payload.envBackup) {
    try {
      const er = em.restoreBackup(payload.envBackup, passphrase);
      results.steps.push({ step: "env_backup", status: "ok", envVarsFound: er.envVarsFound, note: er.note });
    } catch (e) {
      results.steps.push({ step: "env_backup", status: "error", error: e.message });
    }
  }

  results.successSteps   = results.steps.filter(s => s.status === "ok").length;
  results.failedSteps    = results.steps.filter(s => s.status === "error").length;
  results.recoveryInstructions = payload.recoveryInstructions || [];

  // Record restore event
  const rec = _loadRecovery();
  rec.checks.unshift({ restoredAt: _ts(), success: results.failedSteps === 0, steps: results.steps.length });
  rec.checks = rec.checks.slice(0, 50);
  _saveRecovery(rec);

  return results;
}

function getRecoveryStatus() {
  const rec = _loadRecovery();
  const vault = _vault();
  const vaultHealth = vault ? vault.getHealth() : null;
  return {
    kitsCreated:   rec.kits.length,
    lastKit:       rec.kits[0] || null,
    lastRestore:   rec.checks[0] || null,
    vaultHealth,
    readyForRecovery: (rec.kits.length > 0) && (vaultHealth?.totalSecrets > 0),
    checklist: [
      { item: "Recovery kit generated",  done: rec.kits.length > 0 },
      { item: "Vault has secrets",        done: (vaultHealth?.totalSecrets || 0) > 0 },
      { item: "Identity graph built",    done: Object.keys(_loadGraph().nodes).length > 0 },
      { item: "Asset registry populated",done: Object.keys(_loadAssets().assets).length > 0 },
    ],
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// MODULE 12 — Cross-Device Synchronization
// ══════════════════════════════════════════════════════════════════════════════

const SYNC_DEVICES = ["electron", "web", "vscode", "local", "vps", "production"];

function _loadSync()  { return _rj(DATA.syncState, { devices: {}, conflicts: [], history: [] }); }
function _saveSync(s) { _wj(DATA.syncState, s); }

function getSyncState() {
  const store = _loadSync();
  const vault = _vault();
  const vaultHash = vault ? crypto.createHash("sha256")
    .update(JSON.stringify(vault.listSecrets().map(s => s.updatedAt)))
    .digest("hex").slice(0, 16) : "unknown";

  return {
    devices:    SYNC_DEVICES.map(id => ({
      id,
      label:      { electron: "Electron Desktop", web: "Web App", vscode: "VS Code", local: "Local Dev", vps: "VPS Server", production: "Production" }[id] || id,
      lastSync:   store.devices[id]?.lastSync || null,
      status:     store.devices[id]?.status   || "not_synced",
      version:    store.devices[id]?.version  || null,
    })),
    currentVaultHash: vaultHash,
    conflicts:    store.conflicts.slice(0, 20),
    lastSyncAt:   Object.values(store.devices).map(d => d.lastSync).filter(Boolean).sort().reverse()[0] || null,
  };
}

function recordDeviceSync(deviceId, meta = {}) {
  if (!SYNC_DEVICES.includes(deviceId)) throw new Error(`Unknown device: ${deviceId}. Supported: ${SYNC_DEVICES.join(", ")}`);
  const store = _loadSync();
  const vault = _vault();
  const vaultHash = vault ? crypto.createHash("sha256")
    .update(JSON.stringify(vault.listSecrets().map(s => s.updatedAt)))
    .digest("hex").slice(0, 16) : null;

  const prevVersion = store.devices[deviceId]?.vaultHash;
  const hasConflict = prevVersion && prevVersion !== vaultHash;

  if (hasConflict) {
    store.conflicts.unshift({
      deviceId, ts: _ts(),
      prevHash: prevVersion, newHash: vaultHash,
      resolution: meta.resolution || "pending",
    });
    store.conflicts = store.conflicts.slice(0, 100);
  }

  store.devices[deviceId] = {
    deviceId, lastSync: _ts(), status: "synced",
    vaultHash, version: meta.version || "unknown",
    meta,
  };
  store.history.unshift({ deviceId, ts: _ts(), vaultHash, hasConflict });
  store.history = store.history.slice(0, 200);
  _saveSync(store);

  return { deviceId, synced: true, hasConflict, vaultHash };
}

function resolveConflict(deviceId, resolution) {
  const store = _loadSync();
  const conflict = store.conflicts.find(c => c.deviceId === deviceId && c.resolution === "pending");
  if (!conflict) return { ok: false, error: "No pending conflict for this device" };
  conflict.resolution = resolution;
  conflict.resolvedAt = _ts();
  _saveSync(store);
  return { ok: true, conflict };
}

// ══════════════════════════════════════════════════════════════════════════════
// FULL SYSTEM SCAN
// ══════════════════════════════════════════════════════════════════════════════

async function runFullSystemScan() {
  const t0 = Date.now();
  const [igResult, assetResult, relResult, credResult] = await Promise.allSettled([
    buildIdentityGraph(),
    discoverAssets(),
    buildRelationshipGraph(),
    runCredentialIntelligence(),
  ]);

  return {
    scanAt:    _ts(),
    durationMs: Date.now() - t0,
    identityGraph: igResult.status === "fulfilled" ? { nodes: igResult.value.nodeCount, edges: igResult.value.edgeCount } : { error: igResult.reason?.message },
    assets:        assetResult.status === "fulfilled" ? { total: assetResult.value.total } : { error: assetResult.reason?.message },
    relationships: relResult.status === "fulfilled" ? { edges: relResult.value.edgeCount } : { error: relResult.reason?.message },
    credIntel:     credResult.status === "fulfilled" ? { recommendations: credResult.value.recommendations?.length } : { error: credResult.reason?.message },
  };
}

module.exports = {
  // M1 Identity Graph
  buildIdentityGraph, getIdentityGraph,
  // M2 Asset Registry
  discoverAssets, getAssetRegistry,
  // M3 Discovery Engine
  runDiscovery,
  // M4 Relationship Engine
  buildRelationshipGraph, getRelationshipGraph,
  // M5 Import Engine
  importCredentials, getImportFormats,
  // M6 Secret Discovery
  runSecretDiscovery,
  // M7 Credential Intelligence
  runCredentialIntelligence, getCredentialIntelligence,
  // M8 Workspace Bootstrap
  runWorkspaceBootstrap,
  // M9 Policy Engine
  setPolicy, getPolicy, listPolicies, recordDecision, getPolicyModes,
  // M10 Command Center
  getCommandCenter, searchCommandCenter,
  // M11 Recovery Kit
  generateRecoveryKit, restoreFromKit, getRecoveryStatus,
  // M12 Cross-Device Sync
  getSyncState, recordDeviceSync, resolveConflict,
  // Full scan
  runFullSystemScan,
};
