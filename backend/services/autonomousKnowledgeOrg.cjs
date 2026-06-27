"use strict";
/**
 * Autonomous Knowledge Organization — Agent Layer (LEVEL 4)
 *
 * Registers 20 knowledge department agents into agentRuntimeSupervisor.
 * Each department has a real tickFn that:
 *   - uses existing knowledge services (semanticMemorySearch, knowledgeGraph, etc.)
 *   - reads from engineeringOrg + businessOrg state
 *   - captures, validates, indexes, recalls knowledge
 *   - creates missions for gaps and high-priority findings
 *   - records lessons
 *   - updates organizational memory
 *
 * Departments:
 *  1.  ako_cko          — Chief Knowledge Officer
 *  2.  ako_research     — Research Department
 *  3.  ako_docs         — Documentation Department
 *  4.  ako_learning     — Learning Department
 *  5.  ako_memory       — Memory Department
 *  6.  ako_graph        — Knowledge Graph Department
 *  7.  ako_retrieval    — Retrieval Department
 *  8.  ako_prompt       — Prompt Intelligence
 *  9.  ako_ai_model     — AI Model Intelligence
 * 10.  ako_api          — API Knowledge
 * 11.  ako_product      — Product Knowledge
 * 12.  ako_customer     — Customer Knowledge
 * 13.  ako_engineering  — Engineering Knowledge
 * 14.  ako_business     — Business Knowledge
 * 15.  ako_market       — Market Intelligence
 * 16.  ako_competitive  — Competitive Intelligence
 * 17.  ako_decision     — Decision Intelligence
 * 18.  ako_policy       — Policy & Compliance Knowledge
 * 19.  ako_qa           — Knowledge Quality Assurance
 * 20.  ako_coordinator  — Knowledge Coordinator
 */

// ── Lazy accessors ────────────────────────────────────────────────────────────
function _sup()  { return require("./agentRuntimeSupervisor.cjs"); }
function _bus()  { try { return require("../../agents/runtime/runtimeEventBus.cjs"); } catch { return null; } }
function _orch() { try { return require("./missionOrchestrator.cjs");          } catch { return null; } }
function _mm()   { try { return require("./missionMemory.cjs");                } catch { return null; } }
function _le()   { try { return require("./continuousLearningEngine.cjs");     } catch { return null; } }
function _em()   { try { return require("./engineeringMemoryEngine.cjs");       } catch { return null; } }
function _sm()   { try { return require("./semanticMemorySearch.cjs");         } catch { return null; } }
function _kg()   { try { return require("./knowledgeGraph.cjs");               } catch { return null; } }
function _gr()   { try { return require("./graphReasoningEngine.cjs");         } catch { return null; } }
function _mi()   { try { return require("./memoryIntelligenceEngine.cjs");      } catch { return null; } }
function _mpl()  { try { return require("./memoryPersistenceLayer.cjs");        } catch { return null; } }
function _lcs()  { try { return require("./largeContextCodeSearch.cjs");        } catch { return null; } }
function _err()  { try { return require("./engineeringRuleRegistry.cjs");       } catch { return null; } }
function _ai()   { try { return require("./aiRegistry.cjs");                   } catch { return null; } }
function _bi()   { try { return require("./businessIntelligenceEngine.cjs");   } catch { return null; } }
function _ab()   { try { return require("./aiBenchmarkLab.cjs");               } catch { return null; } }
function _bm()   { try { return require("./modelMarketplace.cjs");             } catch { return null; } }
function _cseo() { try { return require("./contentSEOEngine.cjs");             } catch { return null; } }
function _bizSt(){ try { return require("./businessOrgState.cjs");             } catch { return null; } }
function _engSt(){ try { return require("./engineeringOrgState.cjs");          } catch { return null; } }
function _st()   { return require("./akoState.cjs"); }
function _wf()   { return require("./akoWorkflow.cjs"); }

// ── Shared helpers ────────────────────────────────────────────────────────────
function _missionExists(prefix) {
  try {
    const all = _mm()?.listMissions({ limit: 300 }) || { missions: [] };
    return (all.missions || []).some(m =>
      ["active","pending","planned"].includes(m.status) &&
      m.objective?.slice(0,50) === prefix?.slice(0,50)
    );
  } catch { return false; }
}

function _mission(agentId, spec, s) {
  if (_missionExists(spec.objective)) return null;
  try {
    const m = _orch()?.createManual({ ...spec, metadata: { ...spec.metadata, autoCreatedBy: agentId } });
    if (m && s) { s.missionsCreated = (s.missionsCreated||0)+1; s.lastDecision = spec.objective?.slice(0,60); }
    try { _bus()?.emit(`agent:${agentId}:mission_created`, { missionId: m?.missionId||m?.id }); } catch {}
    return m;
  } catch { return null; }
}

function _lesson(agentId, lesson) {
  try { return _le()?.createLesson?.({ source: agentId, ...lesson }); } catch { return null; }
}

function _mem(deptId, type, title, detail) {
  try { _st().addMemory({ deptId, type, title, detail }); } catch {}
}

function _setObj(s, label) {
  s.currentObjective = label;
  s.lastTickAt = new Date().toISOString();
}

// ═══════════════════════════════════════════════════════════════════════════════
// TICK IMPLEMENTATIONS
// ═══════════════════════════════════════════════════════════════════════════════

// 1. Chief Knowledge Officer — sets quarterly objectives, monitors overall knowledge health
async function _ckoTick(s) {
  _setObj(s, "Setting quarterly knowledge objectives and monitoring knowledge health");
  try {
    const q = _st().currentQuarter();
    const existing = _st().listObjectives({ quarter: q, status: "active" });
    if (existing.length === 0) {
      _wf().ckoCreateObjective({
        title: `Organizational Knowledge Growth — ${q}`,
        description: "Capture, validate, connect and apply knowledge from all departments",
        kpis: ["items_captured","playbooks","lessons","graph_edges"],
      });
      s.v4Objectives = (s.v4Objectives || 0) + 1;
    }
    const dash = _st().getDashboard();
    s.v4Dashboard = { items: dash.knowledge.total, validated: dash.knowledge.validated, playbooks: dash.playbooks.total };
    // Mission for knowledge health if low validated ratio
    const ratio = dash.knowledge.total > 0 ? dash.knowledge.validated / dash.knowledge.total : 1;
    if (dash.knowledge.total > 20 && ratio < 0.5) {
      _mission(s.id, {
        objective: `CKO: Only ${Math.round(ratio*100)}% knowledge validated — run validation sprint`,
        priority: "high",
        subtasks: [{ description: "Run auto-validation on pending items" }, { description: "Review rejection reasons" }],
        metadata: { domain: "knowledge" },
      }, s);
    }
  } catch {}
  _setObj(s, s.v4Objectives > 0 ? `${s.v4Objectives} objective(s) set` : "Knowledge strategy nominal");
}

// 2. Research Department — observes all org events and captures knowledge
async function _researchTick(s) {
  _setObj(s, "Capturing knowledge from all organizational sources");
  try {
    const obj = _st().listObjectives({ status: "active" })[0];
    const objId = obj?.id;
    const pre = _st().getDashboard().knowledge.total;
    // Pull from all org sources each tick
    _wf().captureEngineeringKnowledge(objId);
    _wf().captureBusinessKnowledge(objId);
    _wf().captureAIKnowledge(objId);
    // Pull recent lessons from continuousLearningEngine
    _wf().syncEngineeringLessons(objId);
    const post = _st().getDashboard().knowledge.total;
    s.v4Captured = (s.v4Captured || 0) + (post - pre);
    _lesson(s.id, { type: "research", severity: "info", title: `Research: +${post - pre} items captured this tick`, detail: `Total: ${post}`, tags: ["research","capture"] });
  } catch {}
  _setObj(s, `${s.v4Captured || 0} items captured total`);
}

// 3. Documentation Department — ingests content, articles, SEO
async function _docsTick(s) {
  _setObj(s, "Ingesting documentation and content artifacts");
  try {
    const obj = _st().listObjectives({ status: "active" })[0];
    // Pull articles from contentSEOEngine
    const articles = _cseo()?.listArticles?.({ limit: 5 }) || [];
    for (const art of articles) {
      _wf().researchCapture({
        title: `Doc: ${art.title}`,
        content: `${art.type}: ${art.content || art.description || art.title}`,
        type: "document", source: "contentSEOEngine", confidence: 80,
        tags: ["documentation", art.type || "article"], objectiveId: obj?.id,
      });
    }
    s.v4Docs = articles.length;
    _lesson(s.id, { type: "documentation", severity: "info", title: `Docs: ingested ${articles.length} articles`, detail: "", tags: ["docs"] });
  } catch {}
  _setObj(s, `${s.v4Docs || 0} docs ingested`);
}

// 4. Learning Department — converts knowledge items into lessons and playbooks
async function _learningTick(s) {
  _setObj(s, "Converting validated knowledge into lessons and playbooks");
  try {
    // Auto-create playbooks for engineering type knowledge
    const engItems = _st().listItems({ type: "engineering", status: "validated" }).slice(0, 3);
    for (const item of engItems) {
      _wf().generatePlaybook({ problem: item.title, type: "engineering" });
    }
    // Record lesson from top validated items
    const top = _st().listItems({ status: "validated" }).slice(0, 2);
    for (const item of top) {
      _wf().recordLesson({ title: item.title, detail: item.content?.slice(0,200), type: item.type, tags: item.tags || [] });
    }
    const dash = _st().getDashboard();
    s.v4Learning = { playbooks: dash.playbooks.total, lessons: _st().getKpi(s.id)?.lessonsRecorded || 0 };
    _lesson(s.id, { type: "learning", severity: "info", title: `Learning: ${dash.playbooks.total} playbooks, ${dash.knowledge.validated} validated items`, detail: "", tags: ["learning"] });
  } catch {}
  _setObj(s, "Lessons and playbooks updated");
}

// 5. Memory Department — maintains organizational memory, runs maintenance
async function _memoryTick(s) {
  _setObj(s, "Maintaining organizational memory and running memory intelligence");
  try {
    // Run memoryIntelligenceEngine maintenance
    const maintenance = _st().runMemoryMaintenance();
    // Sync recent missions into memory
    const missions = _mm()?.listMissions({ limit: 10 }) || { missions: [] };
    let synced = 0;
    for (const m of (missions.missions || []).filter(m => m.status === "completed").slice(0, 3)) {
      _wf().researchCapture({
        title: `Mission: ${m.objective?.slice(0,80)}`,
        content: `Objective: ${m.objective}. Status: ${m.status}`,
        type: "decision", source: "missionMemory", confidence: 75,
        tags: ["mission","decision"],
      });
      synced++;
    }
    s.v4Memory = { synced, maintenance };
    _lesson(s.id, { type: "memory", severity: "info", title: `Memory: synced ${synced} missions`, detail: "", tags: ["memory","maintenance"] });
  } catch {}
  _setObj(s, "Memory maintained");
}

// 6. Knowledge Graph Department — indexes validated items, runs reasoning
async function _graphTick(s) {
  _setObj(s, "Indexing knowledge into graph and running graph reasoning");
  try {
    // Index any validated items not yet in graph
    const validated = _st().listItems({ status: "validated" }).slice(0, 5);
    let edgesAdded = 0;
    for (const item of validated) {
      if (!item.graphNodeId) {
        const r = _wf().indexKnowledgeGraph(item.id);
        edgesAdded += r.edgesAdded || 0;
      }
    }
    // Run graph reasoning
    const analysis = _wf().analyzeKnowledgeGraph();
    s.v4Graph = { edgesAdded, health: analysis.health, kgEdges: analysis.gaps?.totalEdges };
    _lesson(s.id, { type: "graph", severity: "info", title: `Graph: +${edgesAdded} edges, health=${analysis.health || "N/A"}`, detail: `KG edges: ${analysis.gaps?.totalEdges || 0}`, tags: ["graph","knowledge"] });
  } catch {}
  _setObj(s, "Knowledge graph updated");
}

// 7. Retrieval Department — runs semantic search queries, confirms coverage
async function _retrievalTick(s) {
  _setObj(s, "Running retrieval checks and confirming knowledge searchability");
  try {
    // Confirm recently validated items are searchable
    const validated = _st().listItems({ status: "validated" }).slice(0, 3);
    let found = 0;
    for (const item of validated) {
      const r = _wf().confirmSearchable(item.id);
      if (r.found) found++;
    }
    // Serve a test search to verify semantic engine is working
    const testResults = _wf().retrieveKnowledge("engineering engineering", { limit: 5 });
    s.v4Retrieval = { checked: validated.length, found, searchResults: testResults.length };
    _lesson(s.id, { type: "retrieval", severity: "info", title: `Retrieval: ${found}/${validated.length} items searchable, ${testResults.length} results for test query`, detail: "", tags: ["retrieval","search"] });
  } catch {}
  _setObj(s, "Retrieval coverage verified");
}

// 8. Prompt Intelligence — captures and indexes prompt patterns
async function _promptTick(s) {
  _setObj(s, "Analyzing and capturing prompt intelligence patterns");
  try {
    // Index prompt patterns from AI composer engine
    const plans = [];
    try {
      const ai = require("./aiComposerEngine.cjs");
      const listed = ai.listPlans?.({ limit: 5 }) || [];
      for (const plan of listed) {
        _wf().researchCapture({
          title: `Prompt Pattern: ${plan.goal?.slice(0,80)}`,
          content: `Goal: ${plan.goal}. Steps: ${plan.steps?.length || 0}`,
          type: "prompt", source: "aiComposerEngine", confidence: 80,
          tags: ["prompt","ai","pattern"],
        });
        plans.push(plan.id);
      }
    } catch {}
    s.v4Prompts = plans.length;
    _lesson(s.id, { type: "prompt", severity: "info", title: `Prompt Intelligence: ${plans.length} patterns captured`, detail: "", tags: ["prompt","intelligence"] });
  } catch {}
  _setObj(s, "Prompt patterns indexed");
}

// 9. AI Model Intelligence — tracks model capabilities, benchmark results
async function _aiModelTick(s) {
  _setObj(s, "Tracking AI model capabilities and benchmark performance");
  try {
    const providers = _ai()?.getAll?.() || [];
    const obj = _st().listObjectives({ status: "active" })[0];
    for (const p of providers.slice(0, 2)) {
      _wf().researchCapture({
        title: `AI Provider: ${p.id} — ${(p.capabilities||[]).join(",")}`,
        content: JSON.stringify({ id: p.id, type: p.type, capabilities: p.capabilities, tier: p.tier }),
        type: "model", source: "aiRegistry", confidence: 92,
        tags: ["ai","model","provider"], objectiveId: obj?.id,
      });
    }
    // Benchmark lab
    const leaderboard = _ab()?.getCachedLeaderboard?.() || [];
    if (leaderboard.length > 0) {
      _wf().researchCapture({
        title: `AI Benchmark: top=${leaderboard[0]?.model} score=${leaderboard[0]?.score}`,
        content: JSON.stringify(leaderboard.slice(0,3)),
        type: "benchmark", source: "aiBenchmarkLab", confidence: 88,
        tags: ["ai","benchmark","performance"],
      });
    }
    s.v4AIModels = providers.length;
    _lesson(s.id, { type: "model", severity: "info", title: `AI Models: ${providers.length} providers tracked`, detail: `Benchmark top: ${leaderboard[0]?.model || "N/A"}`, tags: ["ai","model"] });
  } catch {}
  _setObj(s, "AI model intelligence updated");
}

// 10. API Knowledge — captures route/service patterns
async function _apiTick(s) {
  _setObj(s, "Cataloging API routes and service contracts");
  try {
    // Pull repo stats to extract API patterns
    const stats = _lcs()?.repoStats?.() || {};
    _wf().researchCapture({
      title: `API Knowledge: ${stats.totalFiles || 0} files, ${stats.totalLines || 0} lines in repo`,
      content: JSON.stringify({ files: stats.totalFiles, lines: stats.totalLines, byExt: stats.byExtension }),
      type: "api", source: "largeContextCodeSearch", confidence: 85,
      tags: ["api","codebase","routes"],
    });
    s.v4API = { files: stats.totalFiles, lines: stats.totalLines };
    _lesson(s.id, { type: "api", severity: "info", title: `API Knowledge: repo has ${stats.totalFiles || 0} files`, detail: "", tags: ["api","codebase"] });
  } catch {}
  _setObj(s, "API knowledge current");
}

// 11. Product Knowledge — aggregates product features, UX insights from ODI
async function _productTick(s) {
  _setObj(s, "Capturing product knowledge and UX insights");
  try {
    // Pull design system intelligence from existing services
    const obj = _st().listObjectives({ status: "active" })[0];
    try {
      const designMem = require("./designMemory.cjs");
      const patterns = designMem.listPatterns?.({ limit: 5 }) || [];
      for (const p of patterns) {
        _wf().researchCapture({
          title: `Design Pattern: ${p.name || p.id}`,
          content: p.description || p.name || "Design pattern captured from ODI",
          type: "product", source: "designMemory", confidence: 80,
          tags: ["product","design","odi"], objectiveId: obj?.id,
        });
      }
      s.v4Product = patterns.length;
    } catch { s.v4Product = 0; }
    _lesson(s.id, { type: "product", severity: "info", title: `Product Knowledge: ${s.v4Product} design patterns`, detail: "", tags: ["product","design"] });
  } catch {}
  _setObj(s, "Product knowledge current");
}

// 12. Customer Knowledge — tracks customer health, onboarding patterns, success factors
async function _customerTick(s) {
  _setObj(s, "Capturing customer health data and success patterns");
  try {
    const bizDash = _bizSt()?.getDashboard?.() || {};
    const won = bizDash.pipeline?.byStage?.closed_won?.count || 0;
    const mrr = bizDash.revenue?.mrr || 0;
    _wf().researchCapture({
      title: `Customer Knowledge: ${won} customers, MRR=$${mrr}`,
      content: `Won deals: ${won}, MRR: $${mrr}, ARR: $${mrr*12}, Win rate: ${Math.round((bizDash.pipeline?.winRate||0)*100)}%`,
      type: "customer", source: "businessOrg", confidence: 88,
      tags: ["customer","retention","revenue"],
    });
    s.v4Customer = { won, mrr };
    _lesson(s.id, { type: "customer", severity: "info", title: `Customer: ${won} accounts, MRR=$${mrr}`, detail: "", tags: ["customer","knowledge"] });
  } catch {}
  _setObj(s, "Customer knowledge current");
}

// 13. Engineering Knowledge — deep index of engineering memory, rules, RCAs
async function _engineeringTick(s) {
  _setObj(s, "Deepening engineering knowledge base from memory and rules");
  try {
    _wf().captureRuleKnowledge(_st().listObjectives({ status: "active" })[0]?.id);
    const emStats = _em()?.getStatistics?.() || {};
    const growth  = emStats.growth || {};
    _wf().researchCapture({
      title: `Engineering Memory: ${growth.totalKnowledgeItems || 0} items, ${growth.lessonsThisWeek || 0} this week`,
      content: JSON.stringify({ ...emStats.memorySources, health: emStats.engineHealth }),
      type: "engineering", source: "engineeringMemoryEngine", confidence: 90,
      tags: ["engineering","memory","health"],
    });
    s.v4Engineering = { total: growth.totalKnowledgeItems, lessonsThisWeek: growth.lessonsThisWeek };
    _lesson(s.id, { type: "engineering", severity: "info", title: `Engineering: ${growth.totalKnowledgeItems || 0} knowledge items`, detail: `This week: ${growth.lessonsThisWeek || 0}`, tags: ["engineering","knowledge"] });
  } catch {}
  _setObj(s, "Engineering knowledge deepened");
}

// 14. Business Knowledge — tracks business intelligence signals
async function _businessTick(s) {
  _setObj(s, "Capturing business intelligence and market signals");
  try {
    const bi = _bi()?.scan?.() || {};
    const recs = _bi()?.getRecommendations?.() || { recommendations: [] };
    const recList = recs.recommendations || recs || [];
    _wf().researchCapture({
      title: `Business Intelligence: ${bi.totalSignals || 0} signals detected`,
      content: JSON.stringify({ signals: bi.totalSignals, recommendations: recList.length, timestamp: new Date().toISOString() }),
      type: "business", source: "businessIntelligenceEngine", confidence: 85,
      tags: ["business","intelligence","signals"],
    });
    s.v4Business = { signals: bi.totalSignals, recs: recList.length };
    _lesson(s.id, { type: "business", severity: "info", title: `Business: ${bi.totalSignals || 0} signals, ${recList.length} recs`, detail: "", tags: ["business","knowledge"] });
  } catch {}
  _setObj(s, "Business knowledge updated");
}

// 15. Market Intelligence — aggregates market and growth data
async function _marketTick(s) {
  _setObj(s, "Analyzing market trends and competitive landscape data");
  try {
    const obj = _st().listObjectives({ status: "active" })[0];
    // Pull from growth OS data
    const gos = require("./growthOS.cjs");
    const seqList = gos.listSequences?.({ limit: 5 }) || [];
    if (seqList.length > 0) {
      _wf().researchCapture({
        title: `Market Intelligence: ${seqList.length} growth sequences active`,
        content: JSON.stringify(seqList.map(s => ({ id: s.id, name: s.name, type: s.type }))),
        type: "market", source: "growthOS", confidence: 75,
        tags: ["market","growth","sequences"], objectiveId: obj?.id,
      });
    }
    s.v4Market = seqList.length;
    _lesson(s.id, { type: "market", severity: "info", title: `Market: ${seqList.length} growth sequences tracked`, detail: "", tags: ["market","growth"] });
  } catch {}
  _setObj(s, "Market intelligence current");
}

// 16. Competitive Intelligence — competitor signal detection
async function _competitiveTick(s) {
  _setObj(s, "Monitoring competitive landscape and capturing competitor signals");
  try {
    // Derive from business context: won deal patterns suggest competitive wins
    const bizDash = _bizSt()?.getDashboard?.() || {};
    const winRate = bizDash.pipeline?.winRate || 0;
    _wf().researchCapture({
      title: `Competitive: Win rate ${Math.round(winRate*100)}% — ${winRate > 0.5 ? "above" : "below"} target`,
      content: `Win rate: ${Math.round(winRate*100)}%. Deals won: ${bizDash.pipeline?.byStage?.closed_won?.count || 0}. Total pipeline: ${bizDash.pipeline?.total || 0}`,
      type: "competitive", source: "businessOrg", confidence: 72,
      tags: ["competitive","win-rate","market-position"],
    });
    s.v4Competitive = { winRate: Math.round(winRate*100) };
    _lesson(s.id, { type: "competitive", severity: winRate < 0.3 ? "warning" : "info", title: `Competitive: ${Math.round(winRate*100)}% win rate`, detail: "", tags: ["competitive"] });
  } catch {}
  _setObj(s, "Competitive intelligence current");
}

// 17. Decision Intelligence — tracks decisions, outcomes, creates playbooks
async function _decisionTick(s) {
  _setObj(s, "Analyzing decisions and outcomes to generate decision playbooks");
  try {
    const decisions = _st().listItems({ type: "decision", status: "validated" }).slice(0, 3);
    let playbooks = 0;
    for (const d of decisions) {
      const pb = _wf().generatePlaybook({ problem: d.title, type: "decision" });
      if (pb) playbooks++;
    }
    const mDash = _st().getDashboard();
    s.v4Decision = { decisions: decisions.length, playbooks };
    _lesson(s.id, { type: "decision", severity: "info", title: `Decision: ${decisions.length} decisions analyzed, ${playbooks} new playbooks`, detail: `Total playbooks: ${mDash.playbooks.total}`, tags: ["decision","playbook"] });
  } catch {}
  _setObj(s, "Decision intelligence updated");
}

// 18. Policy & Compliance — captures policy rules and compliance patterns
async function _policyTick(s) {
  _setObj(s, "Capturing and validating policy and compliance knowledge");
  try {
    // Capture from engineering rule registry as policy-adjacent items
    const rules = _err()?.listRules?.() || [];
    const securityRules = rules.filter(r => (r.severity === "critical" || r.tags?.includes?.("security")));
    for (const rule of securityRules.slice(0, 2)) {
      _wf().researchCapture({
        title: `Policy/Security Rule: ${rule.name || rule.id}`,
        content: `Rule: ${rule.name}. Pattern: ${rule.pattern || "N/A"}. Severity: ${rule.severity}`,
        type: "policy", source: "engineeringRuleRegistry", confidence: 95,
        tags: ["policy","security","compliance","rule"],
      });
    }
    s.v4Policy = securityRules.length;
    _lesson(s.id, { type: "policy", severity: "info", title: `Policy: ${securityRules.length} security/compliance rules tracked`, detail: "", tags: ["policy","compliance"] });
  } catch {}
  _setObj(s, "Policy knowledge current");
}

// 19. Knowledge Quality Assurance — validates, rejects, detects contradictions
async function _qaTick(s) {
  _setObj(s, "Running quality assurance on all knowledge items");
  try {
    // Auto-validate pending items
    const result = _wf().autoValidatePending(65);
    // Find contradictions in recently added items
    const recentItems = _st().listItems({ status: "validated" }).slice(0, 10);
    let contradictions = 0;
    for (const item of recentItems) {
      const found = _st().detectContradictions(item.id);
      contradictions += found.length;
    }
    // Run memory maintenance
    const maintenance = _st().runMemoryMaintenance();
    s.v4QA = { validated: result.validated, rejected: result.rejected, contradictions, maintenance };
    _lesson(s.id, { type: "qa", severity: contradictions > 0 ? "warning" : "info", title: `QA: +${result.validated} validated, ${result.rejected} rejected, ${contradictions} contradictions`, detail: "", tags: ["qa","quality","knowledge"] });
    if (contradictions > 3) {
      _mission(s.id, {
        objective: `KA QA: ${contradictions} knowledge contradictions found — resolve`,
        priority: "medium",
        subtasks: [{ description: "Review contradiction list" }, { description: "Resolve or mark as acceptable variance" }],
        metadata: { domain: "knowledge-qa" },
      }, s);
    }
  } catch {}
  _setObj(s, "Knowledge quality enforced");
}

// 20. Knowledge Coordinator — syncs all depts, runs coordinator report
async function _coordinatorTick(s) {
  _setObj(s, "Synchronizing all knowledge departments and generating executive summary");
  try {
    const sync   = _wf().coordinatorSync();
    const dash   = _st().getDashboard();
    const kpis   = _st().getAllKpis();
    const total  = kpis.reduce((sum, k) => sum + (k.itemsCapured||0), 0);
    const lessons= kpis.reduce((sum, k) => sum + (k.lessonsRecorded||0), 0);
    _bus()?.emit("ako:coordinator:status", {
      timestamp: new Date().toISOString(),
      dashboard: dash,
      kpiSummary: { totalItems: total, lessonsRecorded: lessons, playbooks: dash.playbooks.total, validated: dash.knowledge.validated },
    });
    _lesson(s.id, { type: "coordinator", severity: "info", title: `Coordinator: ${total} items, ${lessons} lessons, ${dash.playbooks.total} playbooks`, detail: `Platform eng items: ${dash.platformKnowledge.engineeringItems}`, tags: ["coordinator","knowledge"] });
    s.v4Coord = { items: total, lessons, playbooks: dash.playbooks.total };
  } catch {}
  _setObj(s, "Knowledge organization synced");
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEPARTMENT DEFINITIONS (20)
// ═══════════════════════════════════════════════════════════════════════════════

const AKO_ORG = [
  { id: "ako_cko",         role: "ako_cko",         label: "Chief Knowledge Officer", description: "Quarterly objectives, knowledge health monitoring, org strategy",                 intervalMs: 300_000, tickFn: _ckoTick         },
  { id: "ako_research",    role: "ako_research",    label: "Research Department",     description: "Observations, engineering/business/AI knowledge capture",                        intervalMs: 120_000, tickFn: _researchTick    },
  { id: "ako_docs",        role: "ako_docs",        label: "Documentation Dept",      description: "Document ingestion, content indexing, SEO article knowledge",                   intervalMs: 360_000, tickFn: _docsTick        },
  { id: "ako_learning",    role: "ako_learning",    label: "Learning Department",     description: "Convert knowledge to lessons and reusable playbooks",                           intervalMs: 240_000, tickFn: _learningTick    },
  { id: "ako_memory",      role: "ako_memory",      label: "Memory Department",       description: "Organizational memory maintenance, mission sync, intelligence",                  intervalMs: 300_000, tickFn: _memoryTick      },
  { id: "ako_graph",       role: "ako_graph",       label: "Knowledge Graph Dept",    description: "Index knowledge into graph, run reasoning, map relationships",                  intervalMs: 360_000, tickFn: _graphTick       },
  { id: "ako_retrieval",   role: "ako_retrieval",   label: "Retrieval Department",    description: "Semantic search coverage, confirm searchability, serve queries",                intervalMs: 180_000, tickFn: _retrievalTick   },
  { id: "ako_prompt",      role: "ako_prompt",      label: "Prompt Intelligence",     description: "Capture prompt patterns, AI composer plans, prompt quality",                    intervalMs: 480_000, tickFn: _promptTick      },
  { id: "ako_ai_model",    role: "ako_ai_model",    label: "AI Model Intelligence",   description: "Model capabilities, benchmark tracking, model selection guidance",              intervalMs: 600_000, tickFn: _aiModelTick     },
  { id: "ako_api",         role: "ako_api",         label: "API Knowledge",           description: "API route cataloging, service contracts, codebase patterns",                   intervalMs: 600_000, tickFn: _apiTick         },
  { id: "ako_product",     role: "ako_product",     label: "Product Knowledge",       description: "Design patterns, UX insights, ODI learnings, feature knowledge",               intervalMs: 480_000, tickFn: _productTick     },
  { id: "ako_customer",    role: "ako_customer",    label: "Customer Knowledge",      description: "Customer health, onboarding patterns, success factors",                        intervalMs: 300_000, tickFn: _customerTick    },
  { id: "ako_engineering", role: "ako_engineering", label: "Engineering Knowledge",   description: "Engineering memory, rules, RCAs, patches, architectural patterns",             intervalMs: 240_000, tickFn: _engineeringTick },
  { id: "ako_business",    role: "ako_business",    label: "Business Knowledge",      description: "BI signals, revenue patterns, campaign intelligence, market data",              intervalMs: 300_000, tickFn: _businessTick    },
  { id: "ako_market",      role: "ako_market",      label: "Market Intelligence",     description: "Market trends, growth sequences, acquisition patterns",                        intervalMs: 480_000, tickFn: _marketTick      },
  { id: "ako_competitive", role: "ako_competitive", label: "Competitive Intelligence",description: "Win rate, competitive signals, market position analysis",                       intervalMs: 600_000, tickFn: _competitiveTick },
  { id: "ako_decision",    role: "ako_decision",    label: "Decision Intelligence",   description: "Decision history, outcome tracking, decision playbook generation",              intervalMs: 360_000, tickFn: _decisionTick    },
  { id: "ako_policy",      role: "ako_policy",      label: "Policy & Compliance",     description: "Security rules, compliance patterns, policy knowledge base",                   intervalMs: 600_000, tickFn: _policyTick      },
  { id: "ako_qa",          role: "ako_qa",          label: "Knowledge QA",            description: "Validation, rejection, contradiction detection, quality scores",               intervalMs: 180_000, tickFn: _qaTick          },
  { id: "ako_coordinator", role: "ako_coordinator", label: "Knowledge Coordinator",   description: "Cross-dept sync, KPI aggregation, executive knowledge report",                 intervalMs: 240_000, tickFn: _coordinatorTick },
];

// ═══════════════════════════════════════════════════════════════════════════════
// REGISTRATION
// ═══════════════════════════════════════════════════════════════════════════════

let _registered = false;

function register() {
  if (_registered) return { ok: true, message: "Already registered", count: AKO_ORG.length };
  const sup = _sup();
  try { if (!sup.getSupervisorStatus().started) sup.start(); } catch {}
  const results = [];
  for (const spec of AKO_ORG) {
    const r = sup.registerAgent(spec);
    results.push(r);
  }
  _registered = true;
  // Wire event-driven workflow
  try { _wf().subscribeWorkflowEvents?.(); } catch {}
  try { _bus()?.emit("ako:registered", { count: AKO_ORG.length, ids: AKO_ORG.map(d => d.id) }); } catch {}
  return { ok: true, count: AKO_ORG.length, registered: results.filter(r => r.ok).length };
}

function getOrgStatus() {
  const sup = _sup();
  return AKO_ORG.map(spec => {
    const agent = sup.getAgent(spec.id);
    return agent || { id: spec.id, role: spec.role, label: spec.label, status: "not_registered" };
  });
}

function getOrgSummary() {
  const status   = getOrgStatus();
  const running  = status.filter(a => a.status === "running").length;
  const healthy  = status.filter(a => (a.health || 0) >= 70).length;
  const missions = status.reduce((s, a) => s + (a.missionsCreated || 0), 0);
  const dash     = _st().getDashboard();
  return { total: status.length, running, healthy, missions, dashboard: dash, departments: status };
}

module.exports = { register, getOrgStatus, getOrgSummary, AKO_ORG };
