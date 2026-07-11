"use strict";
/**
 * Autonomous Evolution Organization — Agent Layer (LEVEL 5)
 *
 * 20 evolution department agents registered into agentRuntimeSupervisor.
 * Each tick detects weaknesses, proposes/validates/applies improvements,
 * measures impact and feeds back into AKO + existing learning engines.
 * Zero new runtimes, schedulers, memory systems, or event buses.
 */

function _sup()  { return require("./agentRuntimeSupervisor.cjs"); }
function _bus()  { try { return require("../../agents/runtime/runtimeEventBus.cjs"); } catch { return null; } }
function _orch() { try { return require("./missionOrchestrator.cjs");          } catch { return null; } }
function _mm()   { try { return require("./missionMemory.cjs");                } catch { return null; } }
function _le()   { try { return require("./continuousLearningEngine.cjs");     } catch { return null; } }
function _em()   { try { return require("./engineeringMemoryEngine.cjs");      } catch { return null; } }
function _shr()  { try { return require("./selfHealingRuntime.cjs");           } catch { return null; } }
function _sie()  { try { return require("./selfImprovementEngine.cjs");        } catch { return null; } }
function _ile()  { try { return require("./improvementLoopEngine.cjs");        } catch { return null; } }
function _obs()  { try { return require("./observabilityEngine.cjs");          } catch { return null; } }
function _ent()  { try { return require("./enterpriseObservability.cjs");      } catch { return null; } }
function _esd()  { try { return require("./engineeringSmellDetector.cjs");     } catch { return null; } }
function _ece()  { try { return require("./engineeringConfidenceEngine.cjs");  } catch { return null; } }
function _ca()   { try { return require("./costAnalytics.cjs");                } catch { return null; } }
function _il()   { try { return require("./improvementLoop.cjs");              } catch { return null; } }
function _ux()   { try { return require("./uxOptimizerService.cjs");           } catch { return null; } }
function _depa() { try { return require("./deploymentAutopilot.cjs");          } catch { return null; } }
function _bm()   { try { return require("./modelMarketplace.cjs");             } catch { return null; } }
function _ai()   { try { return require("./aiRegistry.cjs");                   } catch { return null; } }
function _akost(){ try { return require("./akoState.cjs");                     } catch { return null; } }
function _akowf(){ try { return require("./akoWorkflow.cjs");                  } catch { return null; } }
function _bizSt(){ try { return require("./businessOrgState.cjs");             } catch { return null; } }
function _engSt(){ try { return require("./engineeringOrgState.cjs");          } catch { return null; } }
function _st()   { return require("./aeoState.cjs"); }
function _wf()   { return require("./aeoWorkflow.cjs"); }

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
  if (!spec.objective?.trim()) return null;
  if (_missionExists(spec.objective)) return null;
  try {
    const m = _orch()?.createManual({ ...spec, goal: spec.objective, metadata: { ...spec.metadata, autoCreatedBy: agentId } });
    if (m && s) { s.missionsCreated = (s.missionsCreated||0)+1; }
    return m;
  } catch { return null; }
}

function _lesson(agentId, lesson) {
  try { return _le()?.createLesson?.({ source: agentId, ...lesson }); } catch { return null; }
}

function _mem(deptId, type, title, detail) {
  try { _st().addMemory({ deptId, type, title, detail }); } catch {}
}

function _setObj(s, label) { s.currentObjective = label; s.lastTickAt = new Date().toISOString(); }

function _activeObj() { return _st().listObjectives({ status: "active" })[0]; }

// ═══════════════════════════════════════════════════════════════════════════════
// TICK IMPLEMENTATIONS (20 departments)
// ═══════════════════════════════════════════════════════════════════════════════

// 1. Chief Evolution Officer — quarterly objective + orchestrate pipeline
async function _ceoTick(s) {
  _setObj(s, "Setting evolution objectives and orchestrating improvement pipeline");
  try {
    const q = _st().currentQuarter();
    if (!_st().listObjectives({ quarter: q, status: "active" }).length) {
      _wf().ceoCreateObjective({
        title: `Continuous OS Evolution — ${q}`,
        description: "Detect weaknesses, propose and apply improvements across all 4 org levels",
        kpis: ["evolutions_kept","impact_score","weaknesses_resolved"],
      });
      s.v5Objectives = (s.v5Objectives || 0) + 1;
    }
    // Auto-approve validated evolutions
    const approved = _wf().approveEvolutions({ minConfidence: 70 });
    s.v5Approved = approved.approved?.length || 0;
    const dash = _st().getDashboard();
    s.v5Dashboard = { evolutions: dash.evolutions.total, kept: dash.evolutions.kept };
  } catch {}
  _setObj(s, `${s.v5Objectives || 0} obj, ${s.v5Dashboard?.kept || 0} evolutions kept`);
}

// 2. Capability Evolution — identifies and improves system capabilities
async function _capabilityTick(s) {
  _setObj(s, "Evolving system capabilities based on usage patterns");
  try {
    const obj = _activeObj();
    const patterns = _wf().analyzePatterns();
    for (const p of patterns.slice(0,2)) {
      _st().proposeEvolution({
        title: `Capability: ${p.title || p.type}`,
        description: p.description || String(p),
        type: "capability", target: "runtime", deptId: s.id,
        confidence: 70, impact: 65, objectiveId: obj?.id, tags: ["capability","pattern"],
      });
    }
    s.v5Proposals = (s.v5Proposals || 0) + patterns.length;
    _lesson(s.id, { type: "capability", severity: "info", title: `Capability: ${patterns.length} patterns analyzed`, tags: ["capability"] });
  } catch {}
  _setObj(s, `${s.v5Proposals || 0} proposals total`);
}

// 3. Architecture Evolution — detects structural issues and proposes refactors
async function _architectureTick(s) {
  _setObj(s, "Analyzing system architecture and proposing structural improvements");
  try {
    const obj = _activeObj();
    const changes = _sie()?.recommendArchitectureChanges?.() || [];
    for (const c of (Array.isArray(changes) ? changes : []).slice(0,2)) {
      const title = typeof c === "string" ? c : (c.title || c.name || "Architecture change");
      _st().proposeEvolution({
        title: `Architecture: ${title.slice(0,80)}`,
        description: typeof c === "string" ? c : (c.description || c.detail || title),
        type: "architecture", target: "engineering", deptId: s.id,
        confidence: 75, impact: 72, objectiveId: obj?.id, tags: ["architecture","refactor"],
      });
    }
    // Confidence engine stats
    const stats = _ece()?.getStats?.() || {};
    _lesson(s.id, { type: "architecture", severity: "info", title: `Architecture: ${changes.length} changes recommended`, detail: `Confidence engine: ${JSON.stringify(stats).slice(0,80)}`, tags: ["architecture"] });
    s.v5Arch = changes.length;
  } catch {}
  _setObj(s, "Architecture review complete");
}

// 4. Workflow Evolution — improves event chains and pipeline throughput
async function _workflowTick(s) {
  _setObj(s, "Analyzing workflows and proposing pipeline improvements");
  try {
    const obj = _activeObj();
    const bus = _bus();
    const recent = bus?.getRecent?.(50) || [];
    // Check for event type imbalance (many proposals, few completions)
    const proposalEvents = recent.filter(e => e.type?.includes(":proposed")).length;
    const keptEvents     = recent.filter(e => e.type?.includes(":kept")).length;
    if (proposalEvents > 5 && keptEvents === 0) {
      _st().proposeEvolution({
        title: "Workflow: proposal→keep conversion rate low",
        description: `${proposalEvents} proposals but 0 kept in recent 50 events. Review validation thresholds.`,
        type: "workflow", target: "runtime", deptId: s.id,
        confidence: 78, impact: 70, objectiveId: obj?.id, tags: ["workflow","conversion"],
      });
    }
    _lesson(s.id, { type: "workflow", severity: "info", title: `Workflow: ${recent.length} recent events, ${proposalEvents} proposals, ${keptEvents} kept`, tags: ["workflow"] });
    s.v5Workflow = { recent: recent.length, proposals: proposalEvents, kept: keptEvents };
  } catch {}
  _setObj(s, "Workflow analysis complete");
}

// 5. Agent Evolution — improves agent collaboration, tick intervals, health
async function _agentTick(s) {
  _setObj(s, "Analyzing agent health and proposing agent improvements");
  try {
    const obj = _activeObj();
    const supStatus = _sup().getSupervisorStatus?.() || {};
    const agents = _sup().listAgents?.() || [];
    const unhealthy = (agents || []).filter(a => (a.health || 100) < 50);
    if (unhealthy.length > 0) {
      _st().proposeEvolution({
        title: `Agent health: ${unhealthy.length} agents below 50% health`,
        description: `Agents: ${unhealthy.map(a => a.id).join(",")}. Review tick failures and error patterns.`,
        type: "agent", target: "runtime", deptId: s.id,
        confidence: 82, impact: 75, objectiveId: obj?.id, tags: ["agent","health"],
      });
    }
    s.v5Agents = { total: (agents || []).length, unhealthy: unhealthy.length };
    _lesson(s.id, { type: "agent", severity: unhealthy.length > 0 ? "warning" : "info", title: `Agent: ${(agents||[]).length} total, ${unhealthy.length} unhealthy`, tags: ["agent","health"] });
  } catch {}
  _setObj(s, "Agent evolution reviewed");
}

// 6. Prompt Evolution — tracks prompt patterns, suggests improvements
async function _promptTick(s) {
  _setObj(s, "Evolving prompt strategies and AI composition patterns");
  try {
    const obj = _activeObj();
    // Pull any prompt-type knowledge from AKO
    const promptItems = _akost()?.listItems?.({ type: "prompt", status: "validated" }) || [];
    if (promptItems.length > 0) {
      _st().proposeEvolution({
        title: `Prompt Evolution: ${promptItems.length} validated prompt patterns available`,
        description: `Promote top ${Math.min(3, promptItems.length)} prompt patterns to system defaults`,
        type: "prompt", target: "runtime", deptId: s.id,
        confidence: 72, impact: 60, objectiveId: obj?.id, tags: ["prompt","ai","evolution"],
      });
    }
    s.v5Prompts = promptItems.length;
    _lesson(s.id, { type: "prompt", severity: "info", title: `Prompt: ${promptItems.length} validated patterns`, tags: ["prompt"] });
  } catch {}
  _setObj(s, "Prompt evolution updated");
}

// 7. Model Strategy — optimizes AI model selection and routing
async function _modelStrategyTick(s) {
  _setObj(s, "Optimizing AI model strategy and provider selection");
  try {
    const obj = _activeObj();
    const catalogue = _bm()?.getCatalogue?.() || [];
    const stats     = _bm()?.getStats?.()     || {};
    if (catalogue.length > 0) {
      _st().proposeEvolution({
        title: `Model Strategy: ${catalogue.length} models available — optimize routing`,
        description: `Review model selection. Override: ${stats.overrides || 0}. Favourites: ${stats.favourites || 0}`,
        type: "model", target: "runtime", deptId: s.id,
        confidence: 80, impact: 70, objectiveId: obj?.id, tags: ["model","ai","routing"],
      });
    }
    s.v5Models = catalogue.length;
    _lesson(s.id, { type: "model", severity: "info", title: `Model Strategy: ${catalogue.length} models evaluated`, detail: JSON.stringify(stats).slice(0,80), tags: ["model","ai"] });
  } catch {}
  _setObj(s, "Model strategy reviewed");
}

// 8. Runtime Optimization — monitors runtime health, triggers self-healing
async function _runtimeTick(s) {
  _setObj(s, "Monitoring runtime health and triggering optimizations");
  try {
    const obj = _activeObj();
    const status = _shr()?.getStatus?.() || {};
    const healRate = status.healedTotal / Math.max(1, (status.healedTotal || 0) + (status.failedTotal || 1));
    if (healRate < 0.1 && status.failedTotal > 10) {
      _st().proposeEvolution({
        title: `Runtime: heal rate ${Math.round(healRate*100)}% is critically low`,
        description: `Healed: ${status.healedTotal}, Failed: ${status.failedTotal}. Improve self-healing strategies.`,
        type: "runtime", target: "runtime", deptId: s.id,
        confidence: 85, impact: 80, objectiveId: obj?.id, tags: ["runtime","heal","reliability"],
      });
    }
    // Trigger a probe cycle
    try { _shr()?.probe?.(); } catch {}
    s.v5Runtime = { healed: status.healedTotal, failed: status.failedTotal, healRate: Math.round(healRate*100) };
    _lesson(s.id, { type: "runtime", severity: healRate < 0.1 ? "warning" : "info", title: `Runtime: ${Math.round(healRate*100)}% heal rate, ${status.healedTotal} healed`, tags: ["runtime"] });
  } catch {}
  _setObj(s, "Runtime optimization active");
}

// 9. Performance Evolution — tracks system performance, proposes optimizations
async function _performanceTick(s) {
  _setObj(s, "Measuring system performance and proposing optimizations");
  try {
    const obj = _activeObj();
    const ileStats = _ile()?.getStats?.() || {};
    // Track improvement trial performance
    const keepRate = (ileStats.kept || 0) / Math.max(1, ileStats.total || 1);
    _ent()?.recordMetric?.("aeo.keep_rate", keepRate, { dept: s.id });
    _wf().proposePerformanceEvolution(obj?.id);
    s.v5Perf = { trials: ileStats.total, kept: ileStats.kept, keepRate: Math.round(keepRate*100) };
    _lesson(s.id, { type: "performance", severity: "info", title: `Performance: ${Math.round(keepRate*100)}% trial keep rate`, detail: `${ileStats.total} total trials`, tags: ["performance"] });
  } catch {}
  _setObj(s, "Performance evolution tracked");
}

// 10. Cost Optimization — monitors costs and proposes reductions
async function _costTick(s) {
  _setObj(s, "Analyzing system costs and proposing optimizations");
  try {
    const obj = _activeObj();
    _wf().proposeCostEvolution(obj?.id);
    const summary = _ca()?.profitSummary?.() || {};
    s.v5Cost = { totalCost: summary.totalCost, totalRevenue: summary.totalRevenue };
    _lesson(s.id, { type: "cost", severity: "info", title: `Cost: $${summary.totalCost || 0} cost, $${summary.totalRevenue || 0} revenue`, tags: ["cost","optimization"] });
  } catch {}
  _setObj(s, "Cost evolution tracked");
}

// 11. Reliability Evolution — ensures system uptime and circuit-breaker health
async function _reliabilityTick(s) {
  _setObj(s, "Ensuring system reliability and monitoring circuit breakers");
  try {
    const obj = _activeObj();
    const obs  = _obs()?.getAlerts?.() || {};
    const active = (obs.active || []).length;
    if (active > 0) {
      _st().proposeEvolution({
        title: `Reliability: ${active} active observability alerts`,
        description: `${active} alerts firing. Review and resolve before they impact customers.`,
        type: "reliability", target: "runtime", deptId: s.id,
        confidence: 88, impact: 82, objectiveId: obj?.id, tags: ["reliability","alert"],
      });
    }
    // Record system metrics
    const sysMetrics = _ent()?.getSystemMetrics?.() || {};
    s.v5Reliability = { alerts: active, sysMetrics };
    _lesson(s.id, { type: "reliability", severity: active > 0 ? "warning" : "info", title: `Reliability: ${active} active alerts`, tags: ["reliability"] });
  } catch {}
  _setObj(s, "Reliability evolution active");
}

// 12. Quality Evolution — improves code/knowledge/data quality
async function _qualityTick(s) {
  _setObj(s, "Improving quality across engineering, knowledge and business");
  try {
    const obj = _activeObj();
    // Engineering quality: smell detection
    const smells = _esd()?.scan?.() || { smells: [] };
    const smellList = Array.isArray(smells) ? smells : (smells.smells || []);
    if (smellList.length > 3) {
      _st().proposeEvolution({
        title: `Quality: ${smellList.length} code smells detected`,
        description: `Top smell: ${smellList[0]?.title || smellList[0]?.type || "unknown"}. Run cleanup.`,
        type: "quality", target: "engineering", deptId: s.id,
        confidence: 80, impact: 68, objectiveId: obj?.id, tags: ["quality","smell","code"],
      });
    }
    // Knowledge quality: AKO validated ratio
    const akoDash = _akost()?.getDashboard?.() || {};
    const ratio = akoDash.knowledge?.total > 0 ? (akoDash.knowledge?.validated || 0) / akoDash.knowledge?.total : 1;
    s.v5Quality = { smells: smellList.length, knowledgeRatio: Math.round(ratio*100) };
    _lesson(s.id, { type: "quality", severity: smellList.length > 5 ? "warning" : "info", title: `Quality: ${smellList.length} smells, ${Math.round(ratio*100)}% knowledge validated`, tags: ["quality"] });
  } catch {}
  _setObj(s, "Quality evolution active");
}

// 13. Security Evolution — monitors security posture and compliance
async function _securityTick(s) {
  _setObj(s, "Monitoring security posture and proposing security improvements");
  try {
    const obj = _activeObj();
    // Pull security/policy knowledge from AKO
    const secItems = _akost()?.listItems?.({ type: "policy", status: "validated" }) || [];
    const ruleKnowledge = _akost()?.extractRuleKnowledge?.() || [];
    const secRules = ruleKnowledge.filter(r => r.severity === "critical");
    if (secRules.length > 0) {
      _st().proposeEvolution({
        title: `Security: ${secRules.length} critical rules require enforcement`,
        description: `Critical rules: ${secRules.map(r => r.name||r.id).join(", ")}`,
        type: "security", target: "engineering", deptId: s.id,
        confidence: 90, impact: 88, objectiveId: obj?.id, tags: ["security","critical","compliance"],
      });
    }
    s.v5Security = { policies: secItems.length, criticalRules: secRules.length };
    _lesson(s.id, { type: "security", severity: secRules.length > 0 ? "warning" : "info", title: `Security: ${secRules.length} critical rules, ${secItems.length} policies`, tags: ["security"] });
  } catch {}
  _setObj(s, "Security evolution active");
}

// 14. UX Evolution — improves interface quality using ODI + UX optimizer
async function _uxTick(s) {
  _setObj(s, "Evolving UX quality using design intelligence and user data");
  try {
    const obj = _activeObj();
    const uxReport = _ux()?.listUXReports?.() || [];
    const latest   = uxReport[uxReport.length - 1];
    if (latest && (latest.score || 100) < 70) {
      _st().proposeEvolution({
        title: `UX Evolution: score ${latest.score}/100 below threshold`,
        description: `Latest UX report score: ${latest.score}. Trigger ODI patch cycle.`,
        type: "ux", target: "odi", deptId: s.id,
        confidence: 82, impact: 75, objectiveId: obj?.id, tags: ["ux","design","odi"],
      });
    }
    s.v5UX = { reports: uxReport.length, latestScore: latest?.score };
    _lesson(s.id, { type: "ux", severity: (latest?.score || 100) < 70 ? "warning" : "info", title: `UX: score=${latest?.score || "N/A"}, ${uxReport.length} reports`, tags: ["ux","design"] });
  } catch {}
  _setObj(s, "UX evolution reviewed");
}

// 15. Business Evolution — improves business processes and revenue outcomes
async function _businessEvolutionTick(s) {
  _setObj(s, "Evolving business processes and revenue generation patterns");
  try {
    const obj   = _activeObj();
    const bizDash = _bizSt()?.getDashboard?.() || {};
    const winRate = bizDash.pipeline?.winRate || 0;
    if (winRate < 0.4) {
      _st().proposeEvolution({
        title: `Business Evolution: win rate ${Math.round(winRate*100)}% — improve sales process`,
        description: `Win rate ${Math.round(winRate*100)}% is below 40% target. Review qualification criteria and sales motion.`,
        type: "business", target: "business", deptId: s.id,
        confidence: 78, impact: 82, objectiveId: obj?.id, tags: ["business","sales","win-rate"],
      });
    }
    s.v5Business = { mrr: bizDash.revenue?.mrr, winRate: Math.round(winRate*100) };
    _lesson(s.id, { type: "business", severity: winRate < 0.3 ? "warning" : "info", title: `Business: MRR=$${bizDash.revenue?.mrr || 0}, win=${Math.round(winRate*100)}%`, tags: ["business"] });
  } catch {}
  _setObj(s, "Business evolution tracked");
}

// 16. Knowledge Evolution — improves AKO knowledge quality and coverage
async function _knowledgeEvolutionTick(s) {
  _setObj(s, "Evolving organizational knowledge quality and coverage");
  try {
    const obj   = _activeObj();
    const akoDash = _akost()?.getDashboard?.() || {};
    const validated = akoDash.knowledge?.validated || 0;
    const total     = akoDash.knowledge?.total || 0;
    if (total > 10 && validated / total < 0.6) {
      _st().proposeEvolution({
        title: `Knowledge Evolution: only ${Math.round((validated/total)*100)}% of items validated`,
        description: `${total - validated} items pending validation. Run AKO validation sprint.`,
        type: "knowledge", target: "knowledge", deptId: s.id,
        confidence: 80, impact: 65, objectiveId: obj?.id, tags: ["knowledge","validation"],
      });
    }
    // Run AKO auto-validation as direct improvement action
    try { _akowf()?.autoValidatePending?.(65); } catch {}
    s.v5Knowledge = { validated, total, playbooks: akoDash.playbooks?.total };
    _lesson(s.id, { type: "knowledge", severity: "info", title: `Knowledge: ${validated}/${total} validated, ${akoDash.playbooks?.total} playbooks`, tags: ["knowledge"] });
  } catch {}
  _setObj(s, "Knowledge evolution active");
}

// 17. Experimentation — runs A/B trials via improvementLoopEngine
async function _experimentationTick(s) {
  _setObj(s, "Running controlled improvement experiments");
  try {
    // Pick top validated evolution without experiment and run trial
    const validated = _st().listEvolutions({ status: "validated" }).slice(0, 2);
    for (const evo of validated) {
      const r = _wf().simulateEvolution(evo.id);
      if (r.ok) s.v5Experiments = (s.v5Experiments || 0) + 1;
    }
    const ileStats = _ile()?.getStats?.() || {};
    _lesson(s.id, { type: "experiment", severity: "info", title: `Experiments: ${ileStats.total || 0} trials (${ileStats.kept || 0} kept)`, tags: ["experiment","trial"] });
    s.v5ILE = ileStats;
  } catch {}
  _setObj(s, `${s.v5Experiments || 0} experiments run`);
}

// 18. Continuous Learning — ensures lesson pipeline keeps flowing
async function _learningTick(s) {
  _setObj(s, "Maintaining continuous learning pipeline across all orgs");
  try {
    // Run full learning engine analysis
    const result = _le()?.runFullAnalysis?.() || {};
    // Sync top lessons to AKO
    const lessons = _le()?.getLessons?.({ limit: 5 }) || [];
    for (const lesson of lessons.filter(l => l.source !== "aeo_learning").slice(0,3)) {
      _akowf()?.researchCapture?.({ title: `Lesson: ${lesson.title}`, content: lesson.detail || lesson.title, type: "lesson", source: lesson.source || "learningEngine", confidence: 80, tags: ["lesson","learning"] });
    }
    s.v5Learning = { lessons: lessons.length, newLessons: result.newLessons, recs: result.openRecommendations };
    _lesson(s.id, { type: "learning", severity: "info", title: `Learning: ${lessons.length} lessons, ${result.newLessons || 0} new`, tags: ["learning"] });
  } catch {}
  _setObj(s, "Continuous learning maintained");
}

// 19. Self-Assessment — benchmarks own evolution effectiveness
async function _selfAssessmentTick(s) {
  _setObj(s, "Benchmarking evolution effectiveness and system self-awareness");
  try {
    const obj = _activeObj();
    const weaknesses = _wf().observeWeaknesses(obj?.id);
    const dash = _st().getDashboard();
    const effectiveness = dash.evolutions.total > 0
      ? Math.round((dash.evolutions.kept / Math.max(1, dash.evolutions.total)) * 100)
      : 0;
    // Record self-assessment to observability
    _obs()?.recordMetric?.("aeo.effectiveness", effectiveness, { dept: s.id });
    _obs()?.recordMetric?.("aeo.weaknesses", weaknesses.length, { dept: s.id });
    s.v5Assessment = { effectiveness, weaknesses: weaknesses.length, evolutions: dash.evolutions };
    // Create improvement loop weekly report
    try { _il()?.generateWeeklyReport?.(); } catch {}
    _lesson(s.id, { type: "self_assessment", severity: effectiveness < 30 ? "warning" : "info", title: `Self-Assessment: ${effectiveness}% effectiveness, ${weaknesses.length} weaknesses`, tags: ["self-assessment","benchmark"] });
    if (weaknesses.length > 5) {
      _mission(s.id, {
        objective: `AEO Self-Assessment: ${weaknesses.length} system weaknesses detected — prioritize resolution`,
        priority: "high",
        subtasks: weaknesses.slice(0,3).map(w => ({ description: `${w.source}: ${w.title}` })),
        metadata: { domain: "evolution" },
      }, s);
    }
  } catch {}
  _setObj(s, "Self-assessment complete");
}

// 20. Evolution Coordinator — syncs all depts, generates report
async function _coordinatorTick(s) {
  _setObj(s, "Synchronizing all evolution departments and running full pipeline");
  try {
    // Run auto-validate on proposed
    const vr = _wf().autoValidateProposed({ minConfidence: 65, minImpact: 50 });
    // Apply approved evolutions
    const approved = _st().listEvolutions({ status: "approved" }).slice(0, 3);
    for (const evo of approved) {
      try { _wf().applyEvolution(evo.id); } catch {}
    }
    // Measure applied evolutions
    const applied = _st().listEvolutions({ status: "applied" }).slice(0, 3);
    for (const evo of applied) {
      try { _wf().measureEvolution(evo.id); } catch {}
    }
    // Coordinator sync + report
    const sync = _wf().coordinatorSync();
    const dash = _st().getDashboard();
    _bus()?.emit("aeo:coordinator:status", {
      ts: new Date().toISOString(),
      dashboard: dash,
      kpiSummary: { evolutions: dash.evolutions.total, kept: dash.evolutions.kept, avgImpact: dash.evolutions.avgImpact },
    });
    _lesson(s.id, { type: "coordinator", severity: "info", title: `Coordinator: ${dash.evolutions.total} evolutions, ${dash.evolutions.kept} kept, impact=${dash.evolutions.avgImpact}%`, tags: ["coordinator","evolution"] });
    s.v5Coord = { evolutions: dash.evolutions.total, kept: dash.evolutions.kept };
  } catch {}
  _setObj(s, "Evolution organization synced");
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEPARTMENT DEFINITIONS (20)
// ═══════════════════════════════════════════════════════════════════════════════

const AEO_ORG = [
  { id: "aeo_ceo",           role: "aeo_ceo",           label: "Chief Evolution Officer",  description: "Sets quarterly objectives, orchestrates improvement pipeline",                  intervalMs: 300_000, tickFn: _ceoTick              },
  { id: "aeo_capability",    role: "aeo_capability",    label: "Capability Evolution",     description: "Identifies and improves system capabilities from pattern analysis",             intervalMs: 360_000, tickFn: _capabilityTick       },
  { id: "aeo_architecture",  role: "aeo_architecture",  label: "Architecture Evolution",   description: "Detects structural issues, proposes refactors via selfImprovementEngine",      intervalMs: 600_000, tickFn: _architectureTick     },
  { id: "aeo_workflow",      role: "aeo_workflow",      label: "Workflow Evolution",        description: "Improves event chains, pipeline throughput, workflow conversion rates",        intervalMs: 300_000, tickFn: _workflowTick         },
  { id: "aeo_agent",         role: "aeo_agent",         label: "Agent Evolution",          description: "Monitors agent health, proposes tick and collaboration improvements",           intervalMs: 240_000, tickFn: _agentTick            },
  { id: "aeo_prompt",        role: "aeo_prompt",        label: "Prompt Evolution",         description: "Evolves prompt strategies, promotes validated patterns to system defaults",     intervalMs: 480_000, tickFn: _promptTick           },
  { id: "aeo_model",         role: "aeo_model",         label: "Model Strategy",           description: "Optimizes AI model selection, routing and provider performance",               intervalMs: 600_000, tickFn: _modelStrategyTick    },
  { id: "aeo_runtime",       role: "aeo_runtime",       label: "Runtime Optimization",     description: "Monitors runtime health via selfHealingRuntime, triggers probes",              intervalMs: 180_000, tickFn: _runtimeTick          },
  { id: "aeo_performance",   role: "aeo_performance",   label: "Performance Evolution",    description: "Tracks improvement trial keep rates, proposes performance optimizations",      intervalMs: 300_000, tickFn: _performanceTick      },
  { id: "aeo_cost",          role: "aeo_cost",          label: "Cost Optimization",        description: "Monitors cost/revenue ratio, proposes cost reduction evolutions",              intervalMs: 600_000, tickFn: _costTick             },
  { id: "aeo_reliability",   role: "aeo_reliability",   label: "Reliability Evolution",    description: "Ensures uptime, monitors circuit breakers, resolves observability alerts",    intervalMs: 180_000, tickFn: _reliabilityTick      },
  { id: "aeo_quality",       role: "aeo_quality",       label: "Quality Evolution",        description: "Improves code quality via smell detection and knowledge validation",           intervalMs: 300_000, tickFn: _qualityTick          },
  { id: "aeo_security",      role: "aeo_security",      label: "Security Evolution",       description: "Monitors security posture, enforces critical engineering rules",               intervalMs: 600_000, tickFn: _securityTick         },
  { id: "aeo_ux",            role: "aeo_ux",            label: "UX Evolution",             description: "Evolves interface quality using ODI patches and UX optimizer reports",         intervalMs: 480_000, tickFn: _uxTick               },
  { id: "aeo_business",      role: "aeo_business",      label: "Business Evolution",       description: "Evolves business processes, sales motion, revenue and conversion patterns",    intervalMs: 300_000, tickFn: _businessEvolutionTick},
  { id: "aeo_knowledge",     role: "aeo_knowledge",     label: "Knowledge Evolution",      description: "Improves AKO knowledge quality, validation ratio, and playbook coverage",     intervalMs: 300_000, tickFn: _knowledgeEvolutionTick},
  { id: "aeo_experimentation",role:"aeo_experimentation",label:"Experimentation",          description: "Runs A/B trials via improvementLoopEngine, promotes successful changes",       intervalMs: 360_000, tickFn: _experimentationTick  },
  { id: "aeo_learning",      role: "aeo_learning",      label: "Continuous Learning",      description: "Maintains lesson pipeline, syncs to AKO, promotes patterns to rules",         intervalMs: 240_000, tickFn: _learningTick         },
  { id: "aeo_self_assessment",role:"aeo_self_assessment",label:"Self-Assessment",          description: "Benchmarks evolution effectiveness, generates weekly improvement report",       intervalMs: 360_000, tickFn: _selfAssessmentTick   },
  { id: "aeo_coordinator",   role: "aeo_coordinator",   label: "Evolution Coordinator",    description: "Syncs all depts, runs apply/measure pipeline, emits coordinator status",       intervalMs: 240_000, tickFn: _coordinatorTick      },
];

// ═══════════════════════════════════════════════════════════════════════════════
// REGISTRATION
// ═══════════════════════════════════════════════════════════════════════════════

let _registered = false;

function register() {
  if (_registered) return { ok: true, message: "Already registered", count: AEO_ORG.length };
  const sup = _sup();
  try { if (!sup.getSupervisorStatus().started) sup.start(); } catch {}
  const results = [];
  for (const spec of AEO_ORG) {
    const r = sup.registerAgent(spec);
    results.push(r);
  }
  _registered = true;
  try { _wf().subscribeWorkflowEvents?.(); } catch {}
  try { _bus()?.emit("aeo:registered", { count: AEO_ORG.length, ids: AEO_ORG.map(d => d.id) }); } catch {}
  return { ok: true, count: AEO_ORG.length, registered: results.filter(r => r.ok).length };
}

function getOrgStatus() {
  const sup = _sup();
  return AEO_ORG.map(spec => sup.getAgent(spec.id) || { id: spec.id, role: spec.role, label: spec.label, status: "not_registered" });
}

function getOrgSummary() {
  const status  = getOrgStatus();
  const running = status.filter(a => a.status === "running").length;
  const healthy = status.filter(a => (a.health || 0) >= 70).length;
  const missions= status.reduce((s,a) => s+(a.missionsCreated||0), 0);
  const dash    = _st().getDashboard();
  return { total: status.length, running, healthy, missions, dashboard: dash, departments: status };
}

module.exports = { register, getOrgStatus, getOrgSummary, AEO_ORG };
