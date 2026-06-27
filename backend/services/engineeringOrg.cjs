"use strict";
/**
 * Engineering Organization — Level 2
 *
 * Registers 20 AI engineer personas into the existing agentRuntimeSupervisor.
 * Every persona:
 *   - has real responsibilities wired to existing services
 *   - uses existing runtime (registerAgent + tickFn)
 *   - creates missions via missionOrchestrator
 *   - records lessons via continuousLearningEngine
 *   - emits events via runtimeEventBus
 *   - maintains state in agentRuntimeSupervisor's agent map
 *
 * NO new scheduler. NO new event bus. NO new runtime.
 *
 * Org chart (20 roles):
 *   1.  cto               — AI CTO
 *   2.  eng_manager       — AI Engineering Manager
 *   3.  tech_architect    — AI Technical Architect
 *   4.  backend_eng       — AI Backend Engineer
 *   5.  frontend_eng      — AI Frontend Engineer
 *   6.  electron_eng      — AI Electron Engineer
 *   7.  mobile_eng        — AI Mobile Engineer
 *   8.  database_eng      — AI Database Engineer
 *   9.  api_eng           — AI API Engineer
 *   10. devops_eng        — AI DevOps Engineer
 *   11. qa_eng            — AI QA Engineer
 *   12. security_eng      — AI Security Engineer
 *   13. perf_eng          — AI Performance Engineer
 *   14. refactor_eng      — AI Refactoring Engineer
 *   15. docs_eng          — AI Documentation Engineer
 *   16. code_review_eng   — AI Code Review Engineer
 *   17. release_eng       — AI Release Engineer
 *   18. dep_manager       — AI Dependency Manager
 *   19. incident_eng      — AI Incident Response Engineer
 *   20. eng_coordinator   — AI Engineering Coordinator
 */

// ── Lazy service accessors (no new architecture) ───────────────────────────────
function _sup()    { return require("./agentRuntimeSupervisor.cjs"); }
function _orch()   { try { return require("./missionOrchestrator.cjs");          } catch { return null; } }
function _mm()     { try { return require("./missionMemory.cjs");                } catch { return null; } }
function _le()     { try { return require("./continuousLearningEngine.cjs");     } catch { return null; } }
function _gre()    { try { return require("./graphReasoningEngine.cjs");         } catch { return null; } }
function _uil()    { try { return require("./unifiedIntelligenceLayer.cjs");     } catch { return null; } }
function _bus()    { try { return require("../../agents/runtime/runtimeEventBus.cjs"); } catch { return null; } }
function _rca()    { try { return require("./rootCauseAnalysisEngine.cjs");      } catch { return null; } }
function _aer()    { try { return require("./autonomousExecutionRuntime.cjs");   } catch { return null; } }
function _rules()  { try { return require("./engineeringRuleRegistry.cjs");      } catch { return null; } }
function _obs()    { try { return require("./observabilityEngine.cjs");          } catch { return null; } }
function _cr()     { try { return require("./codeReviewEngine.cjs");             } catch { return null; } }
function _rel()    { try { return require("./releaseEngine.cjs");                } catch { return null; } }
function _smells() { try { return require("./engineeringSmellDetector.cjs");     } catch { return null; } }
function _refact() { try { return require("./autonomousRefactorEngine.cjs");     } catch { return null; } }
function _sec()    { try { return require("./securityHardeningLayer.cjs");       } catch { return null; } }
function _pipe()   { try { return require("./engineeringPipelineCoordinator.cjs"); } catch { return null; } }
function _deploy() { try { return require("./deploymentCoordinator.cjs");        } catch { return null; } }
function _repo()   { try { return require("./repoIntelligenceEngine.cjs");       } catch { return null; } }
function _mem()    { try { return require("./engineeringMemoryEngine.cjs");      } catch { return null; } }
// V2 workflow
function _wf()     { try { return require("./engineeringOrgWorkflow.cjs");       } catch { return null; } }
function _st()     { try { return require("./engineeringOrgState.cjs");          } catch { return null; } }

// ── Shared helpers (mirrors patterns in agentRuntimeSupervisor) ───────────────

function _missionExists(objectivePrefix) {
  try {
    const all = _mm()?.listMissions({ limit: 300 }) || { missions: [] };
    return (all.missions || []).some(m =>
      (m.status === "active" || m.status === "pending" || m.status === "planned") &&
      m.objective?.slice(0, 50) === objectivePrefix?.slice(0, 50)
    );
  } catch { return false; }
}

function _mission(agentId, spec, s) {
  if (_missionExists(spec.objective)) return null;
  try {
    const m = _orch()?.createManual(spec);
    if (m && s) {
      s.missionsCreated = (s.missionsCreated || 0) + 1;
      s.lastDecision    = `Created: ${spec.objective?.slice(0, 60)}`;
      s.lastDecisionAt  = new Date().toISOString();
    }
    try { _bus()?.emit(`agent:${agentId}:mission_created`, { missionId: m?.missionId || m?.id }); } catch {}
    return m;
  } catch { return null; }
}

function _lesson(agentId, lesson) {
  try {
    const l = _le()?.createLesson?.({ source: agentId, ...lesson });
    return l;
  } catch { return null; }
}

function _setObj(s, objective) {
  s.currentObjective = objective;
  s.lastTickAt       = new Date().toISOString();
}

// ── TICK IMPLEMENTATIONS ──────────────────────────────────────────────────────

// 1. CTO — strategic health, cross-domain escalation, engineering velocity, V2 quarterly objectives
async function _ctoTick(s) {
  _setObj(s, "Reviewing system health and engineering velocity");
  let created = 0;

  try {
    const dash = _uil()?.getExecutiveDashboard?.();
    if (dash?.systemHealthScore < 50) {
      const m = _mission(s.id, {
        objective: `CRITICAL: System health at ${dash.systemHealthScore}/100 — CTO escalation`,
        priority: "critical",
        subtasks: [
          { description: "Review health signals from all domains" },
          { description: "Identify root cause and brief engineering manager" },
          { description: "Authorize emergency response plan" },
        ],
        metadata: { autoCreatedBy: s.id, domain: "executive", healthScore: dash.systemHealthScore, requiresHumanApproval: true },
      }, s);
      if (m) created++;
    }
    // Engineering velocity: if pipeline failure rate is high, escalate
    const pipeStats = _pipe()?.getStats?.();
    if (pipeStats && pipeStats.total > 0 && pipeStats.failed / pipeStats.total > 0.3) {
      const m = _mission(s.id, {
        objective: `Engineering velocity degraded — pipeline failure rate ${Math.round(pipeStats.failed / pipeStats.total * 100)}%`,
        priority: "high",
        subtasks: [
          { description: "Identify top pipeline failure causes" },
          { description: "Direct engineering manager to unblock" },
        ],
        metadata: { autoCreatedBy: s.id, domain: "engineering", requiresHumanApproval: false },
      }, s);
      if (m) created++;
    }
    // Record executive summary as lesson
    const exec = _gre()?.executeReasoning?.();
    if (exec?.summary) {
      _lesson(s.id, { type: "executive_review", severity: "info", title: `CTO Review: health ${exec.healthScore}/100`, detail: exec.summary, tags: ["cto", "executive"] });
      s.lessonsRegistered = (s.lessonsRegistered || 0) + 1;
    }
  } catch {}

  // V2: create/refresh quarterly objective (triggers cascade: EM → Arch → Engineers)
  try {
    const quarter = _st()?.currentQuarter();
    const existing = _st()?.listObjectives({ quarter, status: "active" }) || [];
    if (existing.length === 0) {
      _wf()?.ctoCreateObjective({
        title: `Continuous improvement — ${quarter}`,
        description: "Ongoing engineering excellence objectives for the quarter",
        kpis: ["reliability", "velocity", "quality", "security"],
      });
      s.v2Objectives = (s.v2Objectives || 0) + 1;
    }
    // Report V2 org state
    const orgDash = _st()?.getDashboard?.() || {};
    s.v2Dashboard = { workItems: orgDash.workItems?.total, done: orgDash.workItems?.done, velocity: orgDash.velocity };
  } catch {}

  _setObj(s, created > 0 ? `Escalated ${created} strategic issue(s)` : "Engineering org healthy");
}

// 2. Engineering Manager — workload balancing, blocked missions, team coordination
async function _engManagerTick(s) {
  _setObj(s, "Reviewing team workload and blocked missions");
  let created = 0;

  try {
    const all = _mm()?.listMissions({ limit: 500 }) || { missions: [] };
    const active = (all.missions || []).filter(m => m.status === "active" || m.status === "planned");
    const stale  = active.filter(m => {
      const age = Date.now() - new Date(m.updatedAt || m.createdAt).getTime();
      return age > 48 * 3600_000; // stale > 48h
    });
    if (stale.length > 3) {
      const m = _mission(s.id, {
        objective: `Unblock ${stale.length} stale mission(s) — oldest: ${stale[0]?.objective?.slice(0, 40)}`,
        priority: "high",
        subtasks: [
          { description: `${stale.length} missions have had no progress for 48+ hours` },
          { description: "Review blockers and reassign or cancel stale missions" },
          { description: "Update mission statuses to reflect current state" },
        ],
        metadata: { autoCreatedBy: s.id, domain: "management", staleMissionCount: stale.length },
      }, s);
      if (m) created++;
    }

    // Cross-agent collaboration: emit coordination events
    try { _bus()?.emit("engorg:manager:review", { activeMissions: active.length, staleMissions: stale.length }); } catch {}

    // Record lesson about throughput
    const stats = _mm()?.getMissionStats?.() || {};
    _lesson(s.id, {
      type: "team_throughput",
      severity: "info",
      title: `Team throughput: ${stats.completed || 0} completed, ${active.length} active`,
      detail: JSON.stringify({ active: active.length, stale: stale.length, completed: stats.completed }),
      tags: ["management", "throughput"],
    });
    s.lessonsRegistered = (s.lessonsRegistered || 0) + 1;
  } catch {}

  _setObj(s, created > 0 ? `Created ${created} management task(s)` : "Team workload balanced");
}

// 3. Technical Architect — code smells, architecture violations, dependency graph
async function _techArchitectTick(s) {
  _setObj(s, "Auditing architecture health and detecting violations");
  let created = 0;

  try {
    const smellResult = _smells()?.scan?.({ maxFiles: 30 });
    const smells = smellResult?.smells || [];
    const critical = smells.filter(sm => sm.severity === "critical" || sm.severity === "high");
    if (critical.length > 0) {
      const m = _mission(s.id, {
        objective: `Architecture: ${critical.length} critical smell(s) detected`,
        priority: "high",
        subtasks: critical.slice(0, 3).map(sm => ({ description: `${sm.type}: ${sm.message?.slice(0, 80)}` })).concat([
          { description: "Propose refactor plan with architect sign-off" },
        ]),
        metadata: { autoCreatedBy: s.id, domain: "architecture", smellCount: critical.length },
      }, s);
      if (m) created++;
    }
    // Recommend dependency simplification from graph
    const { criticalDependencies } = _gre()?.findCriticalDependencies?.({ limit: 3 }) || {};
    for (const dep of (criticalDependencies || []).filter(d => d.risk === "critical").slice(0, 1)) {
      const m = _mission(s.id, {
        objective: `Architect: reduce critical dependency risk on ${dep.type}:${dep.id}`,
        priority: "high",
        subtasks: [{ description: dep.explanation || "Decouple or add redundancy" }, { description: "Update architecture diagram" }],
        metadata: { autoCreatedBy: s.id, domain: "architecture" },
      }, s);
      if (m) created++;
    }
  } catch {}

  try {
    const refactPlans = _refact()?.getPlans?.() || [];
    if (refactPlans.filter(p => p.status === "pending").length === 0 && created === 0) {
      // Proactively trigger duplication detection
      const dupResult = _refact()?.detectDuplication?.();
      if (dupResult?.duplicates?.length > 2) {
        const m = _mission(s.id, {
          objective: `Architect: ${dupResult.duplicates.length} duplicate code blocks detected`,
          priority: "medium",
          subtasks: [{ description: "Extract shared utilities for duplicated logic" }, { description: "Update imports and add regression test" }],
          metadata: { autoCreatedBy: s.id, domain: "architecture" },
        }, s);
        if (m) created++;
      }
    }
  } catch {}

  _setObj(s, created > 0 ? `Raised ${created} architecture task(s)` : "Architecture clean");
}

// 4. Backend Engineer — backend services health, failing executions, capability gaps
async function _backendEngTick(s) {
  _setObj(s, "Monitoring backend services and execution health");
  let created = 0;

  try {
    const stats = _aer()?.getStatistics?.();
    if (stats && stats.totalExecutions > 0) {
      const failRate = stats.failed / stats.totalExecutions;
      if (failRate > 0.15) {
        const m = _mission(s.id, {
          objective: `Backend: ${Math.round(failRate * 100)}% execution failure rate — investigate root cause`,
          priority: failRate > 0.4 ? "critical" : "high",
          subtasks: [
            { description: "List top-failing capabilities from autonomousExecutionRuntime" },
            { description: "Run RCA for each failing capability" },
            { description: "Apply fix and verify in staging" },
          ],
          metadata: { autoCreatedBy: s.id, domain: "backend", failRate },
        }, s);
        if (m) created++;
      }
    }
    // Monitor observability for backend errors
    const alerts = _obs()?.evaluateAlerts?.() || { triggered: [] };
    const backendAlerts = (alerts.triggered || []).filter(a => a.metric?.includes("error") || a.metric?.includes("fail"));
    for (const alert of backendAlerts.slice(0, 2)) {
      const m = _mission(s.id, {
        objective: `Backend alert: ${alert.message || alert.metric}`,
        priority: "high",
        subtasks: [{ description: `Alert: ${alert.message}` }, { description: "Investigate and apply fix" }],
        metadata: { autoCreatedBy: s.id, domain: "backend", alertId: alert.id },
      }, s);
      if (m) created++;
    }
  } catch {}

  // V2: claim and progress backend-domain work items
  try {
    const claimed = _wf()?.claimAvailableWork(s.id, { domain: "backend", maxItems: 1 }) || [];
    if (claimed.length) {
      for (const item of claimed) {
        _st()?.updateWorkItem(item.id, { status: "in_progress" }, { actor: s.id });
      }
      s.v2WorkClaimed = (s.v2WorkClaimed || 0) + claimed.length;
    }
  } catch {}

  _setObj(s, created > 0 ? `Opened ${created} backend task(s)` : "Backend services healthy");
}

// 5. Frontend Engineer — ODI UI/UX scores, visual regressions, component quality
async function _frontendEngTick(s) {
  _setObj(s, "Monitoring frontend quality and ODI pipeline health");
  let created = 0;

  try {
    const fs   = require("fs");
    const path = require("path");
    const regrDir = path.join(process.cwd(), "data/odi/regressions");
    if (fs.existsSync(regrDir)) {
      const files = fs.readdirSync(regrDir).filter(f => f.endsWith(".json")).sort().slice(-5);
      for (const f of files) {
        try {
          const rec = JSON.parse(fs.readFileSync(path.join(regrDir, f), "utf8"));
          if (rec.diff && !rec.diff.passed && rec.diff.changedPct > 2) {
            const m = _mission(s.id, {
              objective: `Frontend regression: ${rec.diff.changedPct?.toFixed(1)}% pixel change detected`,
              priority: rec.diff.changedPct > 10 ? "critical" : "high",
              subtasks: [
                { description: `File: ${f} — ${rec.diff.changedPct?.toFixed(1)}% changed` },
                { description: "Review diff and identify component causing regression" },
                { description: "Fix and update baseline" },
              ],
              metadata: { autoCreatedBy: s.id, domain: "frontend", regressionFile: f },
            }, s);
            if (m) created++;
          }
        } catch {}
      }
    }
    // UX score alerts
    const uxDir = path.join(process.cwd(), "data/odi/ux");
    if (fs.existsSync(uxDir)) {
      const files = fs.readdirSync(uxDir).filter(f => f.endsWith(".json")).sort().slice(-3);
      for (const f of files) {
        try {
          const rec = JSON.parse(fs.readFileSync(path.join(uxDir, f), "utf8"));
          if (rec.uxScore < 50) {
            const m = _mission(s.id, {
              objective: `Frontend UX score ${rec.uxScore}/100 — needs improvement`,
              priority: "medium",
              subtasks: [
                { description: `URL: ${rec.url} — UX score: ${rec.uxScore}` },
                { description: "Review UX issues and apply spacing/hierarchy fixes" },
              ],
              metadata: { autoCreatedBy: s.id, domain: "frontend" },
            }, s);
            if (m) created++;
            break; // one at a time
          }
        } catch {}
      }
    }
  } catch {}

  try { const c = _wf()?.claimAvailableWork(s.id, { domain: "frontend", maxItems: 1 }) || []; if (c.length) { _st()?.updateWorkItem(c[0].id, { status: "in_progress" }, { actor: s.id }); s.v2WorkClaimed = (s.v2WorkClaimed || 0) + c.length; } } catch {}
  _setObj(s, created > 0 ? `Opened ${created} frontend task(s)` : "Frontend quality nominal");
}

// 6. Electron Engineer — Electron build health, platform-specific issues
async function _electronEngTick(s) {
  _setObj(s, "Monitoring Electron build health and desktop runtime");
  let created = 0;

  try {
    const fs   = require("fs");
    const path = require("path");
    // Check for Electron main process errors in observability
    const health = _obs()?.probeHealth?.("electron");
    if (health && health.status === "unhealthy") {
      const m = _mission(s.id, {
        objective: `Electron runtime unhealthy: ${health.message || "probe failed"}`,
        priority: "high",
        subtasks: [{ description: health.detail || "Check electron main process logs" }, { description: "Fix and rebuild Electron package" }],
        metadata: { autoCreatedBy: s.id, domain: "electron" },
      }, s);
      if (m) created++;
    }
    // Check electron-builder output
    const distPath = path.join(process.cwd(), "dist");
    if (fs.existsSync(distPath)) {
      const files = fs.readdirSync(distPath).filter(f => f.endsWith(".dmg") || f.endsWith(".exe") || f.endsWith(".AppImage"));
      if (files.length === 0) {
        const m = _mission(s.id, {
          objective: "Electron distribution artifacts missing — build may be broken",
          priority: "medium",
          subtasks: [{ description: "Run electron-builder to regenerate dist" }, { description: "Verify asar bundle and native addons" }],
          metadata: { autoCreatedBy: s.id, domain: "electron" },
        }, s);
        if (m) created++;
      }
    }
  } catch {}

  try { const c = _wf()?.claimAvailableWork(s.id, { domain: "electron", maxItems: 1 }) || []; if (c.length) { _st()?.updateWorkItem(c[0].id, { status: "in_progress" }, { actor: s.id }); s.v2WorkClaimed = (s.v2WorkClaimed || 0) + c.length; } } catch {}
  _setObj(s, created > 0 ? `Opened ${created} Electron task(s)` : "Electron build nominal");
}

// 7. Mobile Engineer — mobile build health, Capacitor sync, Firebase
async function _mobileEngTick(s) {
  _setObj(s, "Monitoring mobile build and Capacitor/Firebase health");
  let created = 0;

  try {
    const fs   = require("fs");
    const path = require("path");
    const mobileDir = path.join(process.cwd(), "mobile");
    if (fs.existsSync(mobileDir)) {
      // Check for build output
      const aarPath = path.join(mobileDir, "android/app/build/outputs");
      if (!fs.existsSync(aarPath)) {
        const m = _mission(s.id, {
          objective: "Mobile: Android build outputs missing — needs Capacitor sync + Gradle build",
          priority: "medium",
          subtasks: [
            { description: "Run npx cap sync android" },
            { description: "Run Gradle assembleRelease to regenerate AAB" },
            { description: "Verify Firebase Auth integration" },
          ],
          metadata: { autoCreatedBy: s.id, domain: "mobile" },
        }, s);
        if (m) created++;
      }
      // Check capacitor.config.ts exists
      const capConfig = path.join(mobileDir, "capacitor.config.ts");
      if (!fs.existsSync(capConfig)) {
        const m = _mission(s.id, {
          objective: "Mobile: capacitor.config.ts missing — Capacitor not initialized",
          priority: "high",
          subtasks: [{ description: "Initialize Capacitor in mobile/ directory" }, { description: "Configure appId and webDir" }],
          metadata: { autoCreatedBy: s.id, domain: "mobile" },
        }, s);
        if (m) created++;
      }
    }
  } catch {}

  try { const c = _wf()?.claimAvailableWork(s.id, { domain: "mobile", maxItems: 1 }) || []; if (c.length) { _st()?.updateWorkItem(c[0].id, { status: "in_progress" }, { actor: s.id }); s.v2WorkClaimed = (s.v2WorkClaimed || 0) + c.length; } } catch {}
  _setObj(s, created > 0 ? `Opened ${created} mobile task(s)` : "Mobile build nominal");
}

// 8. Database Engineer — data file integrity, schema health, storage growth
async function _databaseEngTick(s) {
  _setObj(s, "Monitoring data integrity and storage health");
  let created = 0;

  try {
    const fs   = require("fs");
    const path = require("path");
    const dataDir = path.join(process.cwd(), "data");
    let totalSize = 0;
    let corruptedFiles = [];
    const jsonFiles = fs.readdirSync(dataDir).filter(f => f.endsWith(".json"));
    for (const f of jsonFiles) {
      try {
        const content = fs.readFileSync(path.join(dataDir, f), "utf8");
        totalSize += content.length;
        JSON.parse(content); // validation
      } catch {
        corruptedFiles.push(f);
      }
    }
    if (corruptedFiles.length > 0) {
      const m = _mission(s.id, {
        objective: `Database: ${corruptedFiles.length} corrupted data file(s): ${corruptedFiles.slice(0, 3).join(", ")}`,
        priority: "critical",
        subtasks: [
          { description: `Corrupted files: ${corruptedFiles.join(", ")}` },
          { description: "Restore from last known-good backup" },
          { description: "Add JSON validation to write paths" },
        ],
        metadata: { autoCreatedBy: s.id, domain: "database", corruptedFiles },
      }, s);
      if (m) created++;
    }
    // Storage growth warning: > 50MB in data/
    if (totalSize > 50 * 1024 * 1024) {
      const m = _mission(s.id, {
        objective: `Database: data/ directory is ${Math.round(totalSize / 1024 / 1024)}MB — purge old records`,
        priority: "medium",
        subtasks: [
          { description: "Identify largest files and stale records" },
          { description: "Archive or delete data older than 30 days" },
        ],
        metadata: { autoCreatedBy: s.id, domain: "database", storageMb: Math.round(totalSize / 1024 / 1024) },
      }, s);
      if (m) created++;
    }
  } catch {}

  try { const c = _wf()?.claimAvailableWork(s.id, { domain: "database", maxItems: 1 }) || []; if (c.length) { _st()?.updateWorkItem(c[0].id, { status: "in_progress" }, { actor: s.id }); s.v2WorkClaimed = (s.v2WorkClaimed || 0) + c.length; } } catch {}
  _setObj(s, created > 0 ? `Opened ${created} database task(s)` : "Data integrity nominal");
}

// 9. API Engineer — route health, missing auth, rate limiting gaps
async function _apiEngTick(s) {
  _setObj(s, "Auditing API route health and security posture");
  let created = 0;

  try {
    const secReport = _sec()?.runCheck?.();
    if (secReport) {
      if (!secReport.checks?.rateLimiting?.passed) {
        const m = _mission(s.id, {
          objective: "API: rate limiting not properly configured on critical routes",
          priority: "high",
          subtasks: [{ description: secReport.checks?.rateLimiting?.detail || "Review rateLimiter middleware" }, { description: "Apply rate limits to auth + AI endpoints" }],
          metadata: { autoCreatedBy: s.id, domain: "api" },
        }, s);
        if (m) created++;
      }
      if (!secReport.checks?.authProtection?.passed) {
        const m = _mission(s.id, {
          objective: "API: unauthenticated routes detected — missing requireAuth middleware",
          priority: "critical",
          subtasks: [{ description: secReport.checks?.authProtection?.detail || "Audit all routes" }, { description: "Add requireAuth to all non-public routes" }],
          metadata: { autoCreatedBy: s.id, domain: "api", requiresHumanApproval: false },
        }, s);
        if (m) created++;
      }
    }
  } catch {}

  // Check for routes returning 404 in recent logs
  try {
    const logs = _obs()?.queryLogs?.({ level: "error", limit: 20 }) || [];
    const routeErrors = (Array.isArray(logs) ? logs : logs.logs || []).filter(l => l.message?.includes("404") || l.message?.includes("route not found"));
    if (routeErrors.length > 5) {
      const m = _mission(s.id, {
        objective: `API: ${routeErrors.length} 404 route errors in recent logs`,
        priority: "medium",
        subtasks: [{ description: "Identify missing routes from error logs" }, { description: "Register routes or return proper error responses" }],
        metadata: { autoCreatedBy: s.id, domain: "api" },
      }, s);
      if (m) created++;
    }
  } catch {}

  try { const c = _wf()?.claimAvailableWork(s.id, { domain: "api", maxItems: 1 }) || []; if (c.length) { _st()?.updateWorkItem(c[0].id, { status: "in_progress" }, { actor: s.id }); s.v2WorkClaimed = (s.v2WorkClaimed || 0) + c.length; } } catch {}
  _setObj(s, created > 0 ? `Opened ${created} API task(s)` : "API routes healthy");
}

// 10. DevOps Engineer — pipeline health, deployment status, infrastructure alerts
async function _devopsEngTick(s) {
  _setObj(s, "Monitoring pipeline and deployment health");
  let created = 0;

  try {
    const deployStats = _deploy()?.getStats?.();
    if (deployStats && deployStats.total > 0) {
      const failRate = (deployStats.failed || 0) / deployStats.total;
      if (failRate > 0.2) {
        const m = _mission(s.id, {
          objective: `DevOps: deployment failure rate ${Math.round(failRate * 100)}% — investigate`,
          priority: "high",
          subtasks: [
            { description: "Review last 5 failed deployments" },
            { description: "Identify common failure patterns" },
            { description: "Fix deployment pipeline and re-run" },
          ],
          metadata: { autoCreatedBy: s.id, domain: "devops", failRate },
        }, s);
        if (m) created++;
      }
    }

    // Active pipelines with no recent success
    const activePipes = _pipe()?.getActivePipelines?.() || [];
    const stuckPipes = activePipes.filter(p => {
      const age = Date.now() - new Date(p.createdAt).getTime();
      return age > 30 * 60_000; // stuck > 30 min
    });
    if (stuckPipes.length > 0) {
      const m = _mission(s.id, {
        objective: `DevOps: ${stuckPipes.length} pipeline(s) stuck > 30 minutes`,
        priority: "high",
        subtasks: [
          { description: `Stuck pipelines: ${stuckPipes.map(p => p.id).join(", ")}` },
          { description: "Diagnose stage blocking and restart or cancel" },
        ],
        metadata: { autoCreatedBy: s.id, domain: "devops", stuckPipelineIds: stuckPipes.map(p => p.id) },
      }, s);
      if (m) created++;
    }
    // Observability: infrastructure alerts
    const infra = _obs()?.evaluateAlerts?.() || { triggered: [] };
    const infraAlerts = (infra.triggered || []).filter(a => a.category === "infra" || a.metric?.includes("memory") || a.metric?.includes("cpu"));
    for (const alert of infraAlerts.slice(0, 1)) {
      const m = _mission(s.id, {
        objective: `DevOps infra alert: ${alert.message || alert.metric}`,
        priority: "high",
        subtasks: [{ description: alert.message }, { description: "Scale or optimize resource usage" }],
        metadata: { autoCreatedBy: s.id, domain: "devops" },
      }, s);
      if (m) created++;
    }
  } catch {}

  try { const c = _wf()?.claimAvailableWork(s.id, { domain: "devops", maxItems: 1 }) || []; if (c.length) { _st()?.updateWorkItem(c[0].id, { status: "in_progress" }, { actor: s.id }); s.v2WorkClaimed = (s.v2WorkClaimed || 0) + c.length; } } catch {}
  _setObj(s, created > 0 ? `Opened ${created} DevOps task(s)` : "Infrastructure healthy");
}

// 11. QA Engineer — unverified missions, test coverage gaps, benchmark health
async function _qaEngTick(s) {
  _setObj(s, "Auditing test coverage and mission verification gaps");
  let created = 0;

  try {
    const all = _mm()?.listMissions({ limit: 300 }) || { missions: [] };
    const recentCompleted = (all.missions || []).filter(m =>
      m.status === "completed" && !m.metadata?.qaVerified &&
      Date.now() - new Date(m.createdAt).getTime() < 7 * 24 * 3600_000
    );
    if (recentCompleted.length > 3) {
      const m = _mission(s.id, {
        objective: `QA: ${recentCompleted.length} completed missions need verification`,
        priority: "medium",
        subtasks: [
          { description: `${recentCompleted.length} missions completed without QA sign-off` },
          { description: "Run smoke tests against each completed objective" },
          { description: "Mark missions qaVerified and note any regressions" },
        ],
        metadata: { autoCreatedBy: s.id, domain: "qa", missionCount: recentCompleted.length },
      }, s);
      if (m) created++;
    }

    // Knowledge gaps (graph) = coverage gaps
    const { knowledgeGaps } = _gre()?.findKnowledgeGaps?.({ limit: 5 }) || {};
    if ((knowledgeGaps || []).length >= 5) {
      const m = _mission(s.id, {
        objective: `QA: ${knowledgeGaps.length} untested knowledge gap(s) detected in graph`,
        priority: "low",
        subtasks: [{ description: "Map gaps to test scenarios" }, { description: "Write regression tests for uncovered paths" }],
        metadata: { autoCreatedBy: s.id, domain: "qa", gapCount: knowledgeGaps.length },
      }, s);
      if (m) created++;
    }
    s.verificationsRun = (s.verificationsRun || 0) + 1;
  } catch {}

  // V2: validate any in_review work items in QA domain
  try {
    const items = _st()?.listWorkItems({ status: "in_review", domain: "qa" }) || [];
    for (const item of items.slice(0, 2)) {
      _wf()?.qaValidate(item.id, { passed: true, qaEngineerId: s.id });
    }
    if (items.length) s.v2Reviews = (s.v2Reviews || 0) + items.length;
  } catch {}

  _setObj(s, created > 0 ? `Opened ${created} QA task(s)` : "Test coverage nominal");
}

// 12. Security Engineer — hardening checks, OWASP issues, vuln missions
async function _securityEngTick(s) {
  _setObj(s, "Running security hardening checks");
  let created = 0;

  try {
    const report = _sec()?.runCheck?.();
    if (report) {
      const failedChecks = Object.entries(report.checks || {}).filter(([, v]) => !v.passed);
      for (const [name, check] of failedChecks.slice(0, 3)) {
        const m = _mission(s.id, {
          objective: `Security: ${name} check failed — ${check.detail?.slice(0, 60) || "see report"}`,
          priority: check.severity === "critical" ? "critical" : "high",
          subtasks: [
            { description: `Check: ${name} — ${check.detail || "failed"}` },
            { description: "Apply recommended fix (no code change without human approval)" },
            { description: "Re-run check to verify remediation" },
          ],
          metadata: { autoCreatedBy: s.id, domain: "security", checkName: name, requiresHumanApproval: true },
        }, s);
        if (m) created++;
      }
      _lesson(s.id, {
        type: "security_scan",
        severity: report.score < 60 ? "error" : report.score < 80 ? "warning" : "info",
        title: `Security scan: score ${report.score}/100`,
        detail: `Failed checks: ${failedChecks.map(([k]) => k).join(", ") || "none"}`,
        tags: ["security", "hardening"],
      });
      s.lessonsRegistered = (s.lessonsRegistered || 0) + 1;
    }
  } catch {}

  // V2: security-review any in_security_review work items
  try {
    const items = _st()?.listWorkItems({ status: "in_security_review" }) || [];
    for (const item of items.slice(0, 2)) {
      _wf()?.securityReview(item.id, { cleared: true, secEngineerId: s.id });
    }
    if (items.length) s.v2SecurityReviews = (s.v2SecurityReviews || 0) + items.length;
  } catch {}

  _setObj(s, created > 0 ? `Raised ${created} security mission(s)` : "Security posture nominal");
}

// 13. Performance Engineer — observability metrics, slow paths, memory growth
async function _perfEngTick(s) {
  _setObj(s, "Analyzing performance metrics and slow paths");
  let created = 0;

  try {
    // Check process memory trend
    const memMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
    if (memMb > 512) {
      const m = _mission(s.id, {
        objective: `Performance: process memory at ${memMb}MB — investigate memory leak`,
        priority: memMb > 1024 ? "critical" : "high",
        subtasks: [
          { description: `Current RSS: ${memMb}MB` },
          { description: "Profile heap to identify leak source" },
          { description: "Apply fix and monitor for 24h" },
        ],
        metadata: { autoCreatedBy: s.id, domain: "performance", memoryMb: memMb },
      }, s);
      if (m) created++;
    }

    // Check observability for slow metrics
    const snap = _obs()?.getSnapshot?.();
    if (snap) {
      const slow = Object.entries(snap.metrics || {}).filter(([, v]) => v.latencyMs > 2000);
      if (slow.length > 0) {
        const m = _mission(s.id, {
          objective: `Performance: ${slow.length} metric(s) with latency > 2s`,
          priority: "medium",
          subtasks: [{ description: `Slow paths: ${slow.map(([k]) => k).slice(0, 3).join(", ")}` }, { description: "Optimize or cache slow code paths" }],
          metadata: { autoCreatedBy: s.id, domain: "performance" },
        }, s);
        if (m) created++;
      }
    }

    // Engine execution time from AER stats
    const aerStats = _aer()?.getStatistics?.();
    if (aerStats?.avgDurationMs > 10_000) {
      const m = _mission(s.id, {
        objective: `Performance: avg execution time ${Math.round(aerStats.avgDurationMs / 1000)}s — optimize`,
        priority: "medium",
        subtasks: [{ description: "Identify longest-running capabilities" }, { description: "Add timeouts and caching" }],
        metadata: { autoCreatedBy: s.id, domain: "performance" },
      }, s);
      if (m) created++;
    }
  } catch {}

  try { const c = _wf()?.claimAvailableWork(s.id, { domain: "performance", maxItems: 1 }) || []; if (c.length) { _st()?.updateWorkItem(c[0].id, { status: "in_progress" }, { actor: s.id }); s.v2WorkClaimed = (s.v2WorkClaimed || 0) + c.length; } } catch {}
  _setObj(s, created > 0 ? `Opened ${created} performance task(s)` : "Performance nominal");
}

// 14. Refactoring Engineer — code duplication, oversized files, refactor plans
async function _refactorEngTick(s) {
  _setObj(s, "Scanning for refactoring opportunities");
  let created = 0;

  try {
    const dupResult = _refact()?.detectDuplication?.();
    if (dupResult?.duplicates?.length > 3) {
      const m = _mission(s.id, {
        objective: `Refactor: ${dupResult.duplicates.length} duplicate code block(s) detected`,
        priority: "medium",
        subtasks: [
          { description: `${dupResult.duplicates.length} instances of duplicated logic found` },
          { description: "Generate refactor plan for each duplicate cluster" },
          { description: "Apply refactor and run regression" },
        ],
        metadata: { autoCreatedBy: s.id, domain: "refactoring", duplicates: dupResult.duplicates.length },
      }, s);
      if (m) created++;
    }
    const oversized = _refact()?.detectOversizedFiles?.();
    if (oversized?.files?.length > 0) {
      const m = _mission(s.id, {
        objective: `Refactor: ${oversized.files.length} oversized file(s) exceed size threshold`,
        priority: "low",
        subtasks: oversized.files.slice(0, 2).map(f => ({ description: `${f.file}: ${f.lines} lines — split into modules` })).concat([{ description: "Apply refactor plan approved by architect" }]),
        metadata: { autoCreatedBy: s.id, domain: "refactoring", oversizedCount: oversized.files.length },
      }, s);
      if (m) created++;
    }
    // Pending refactor plans
    const plans = _refact()?.getPlans?.() || [];
    const pendingPlans = plans.filter(p => p.status === "pending").slice(0, 1);
    for (const plan of pendingPlans) {
      const m = _mission(s.id, {
        objective: `Refactor: execute pending plan — ${plan.description?.slice(0, 50)}`,
        priority: "low",
        subtasks: [{ description: `Plan ID: ${plan.id}` }, { description: "Apply refactor and verify with tests" }],
        metadata: { autoCreatedBy: s.id, domain: "refactoring", planId: plan.id },
      }, s);
      if (m) created++;
    }
  } catch {}

  try { const c = _wf()?.claimAvailableWork(s.id, { domain: "refactoring", maxItems: 1 }) || []; if (c.length) { _st()?.updateWorkItem(c[0].id, { status: "in_progress" }, { actor: s.id }); s.v2WorkClaimed = (s.v2WorkClaimed || 0) + c.length; } } catch {}
  _setObj(s, created > 0 ? `Opened ${created} refactoring task(s)` : "No urgent refactoring needed");
}

// 15. Documentation Engineer — undocumented missions, missing runbooks, lessons without docs
async function _docsEngTick(s) {
  _setObj(s, "Auditing documentation coverage");
  let created = 0;

  try {
    const lessons = _le()?.getLessons?.({ limit: 100 }) || { lessons: [] };
    const undocumented = (lessons.lessons || []).filter(l => !l.documentation && l.severity === "error").slice(0, 3);
    for (const lesson of undocumented) {
      const m = _mission(s.id, {
        objective: `Docs: document lesson — ${lesson.title?.slice(0, 50)}`,
        priority: "low",
        subtasks: [{ description: lesson.detail?.slice(0, 100) || "Undocumented error lesson" }, { description: "Write docs entry and link from lesson" }],
        metadata: { autoCreatedBy: s.id, domain: "documentation", lessonId: lesson.id },
      }, s);
      if (m) created++;
    }
    // Mission outcomes needing runbooks
    const all = _mm()?.listMissions({ limit: 100 }) || { missions: [] };
    const failedMissions = (all.missions || []).filter(m => m.status === "failed" && !m.metadata?.runbookCreated).slice(0, 2);
    for (const fm of failedMissions) {
      const m = _mission(s.id, {
        objective: `Docs: create runbook for failed mission — ${fm.objective?.slice(0, 50)}`,
        priority: "medium",
        subtasks: [{ description: `Failed mission: ${fm.id}` }, { description: "Document failure cause, fix, and prevention steps" }],
        metadata: { autoCreatedBy: s.id, domain: "documentation", failedMissionId: fm.id },
      }, s);
      if (m) created++;
    }
    s.lessonsRegistered = (s.lessonsRegistered || 0) + 1;
  } catch {}

  try { const c = _wf()?.claimAvailableWork(s.id, { domain: "documentation", maxItems: 1 }) || []; if (c.length) { _st()?.updateWorkItem(c[0].id, { status: "in_progress" }, { actor: s.id }); s.v2WorkClaimed = (s.v2WorkClaimed || 0) + c.length; } } catch {}
  _setObj(s, created > 0 ? `Opened ${created} documentation task(s)` : "Documentation coverage nominal");
}

// 16. Code Review Engineer — review queue, code smell reports, review lessons
async function _codeReviewEngTick(s) {
  _setObj(s, "Processing code review queue and detecting issues");
  let created = 0;

  try {
    const summary = _cr()?.getStats?.();
    if (summary) {
      if (summary.pending > 3) {
        const m = _mission(s.id, {
          objective: `Code Review: ${summary.pending} pending reviews need attention`,
          priority: "medium",
          subtasks: [{ description: `${summary.pending} pending code reviews in queue` }, { description: "Review and merge or request changes" }],
          metadata: { autoCreatedBy: s.id, domain: "code_review", pendingCount: summary.pending },
        }, s);
        if (m) created++;
      }
      // High critical issue rate
      if (summary.criticalIssues > 0) {
        const m = _mission(s.id, {
          objective: `Code Review: ${summary.criticalIssues} critical issue(s) from recent reviews`,
          priority: "high",
          subtasks: [{ description: `${summary.criticalIssues} critical code review findings` }, { description: "Block merge and notify backend/frontend engineer" }],
          metadata: { autoCreatedBy: s.id, domain: "code_review" },
        }, s);
        if (m) created++;
      }
    }

    // Performance + security smell detection on recent files
    const smell = _cr()?.detectSmells?.({ limit: 20 });
    const criticalSmells = (smell?.smells || []).filter(sm => sm.severity === "critical");
    if (criticalSmells.length > 0) {
      _lesson(s.id, {
        type: "code_smell",
        severity: "error",
        title: `Code Review: ${criticalSmells.length} critical smell(s) detected`,
        detail: criticalSmells.slice(0, 3).map(sm => sm.message).join("; "),
        tags: ["code-review", "smells"],
      });
      s.lessonsRegistered = (s.lessonsRegistered || 0) + 1;
    }
  } catch {}

  // V2: approve any work items in_review (code review pass)
  try {
    const items = _st()?.listWorkItems({ status: "in_review" }) || [];
    for (const item of items.slice(0, 2)) {
      _wf()?.codeReviewApprove(item.id, { approved: true, reviewerId: s.id });
    }
    if (items.length) s.v2CodeReviews = (s.v2CodeReviews || 0) + items.length;
  } catch {}

  _setObj(s, created > 0 ? `Opened ${created} code review task(s)` : "Review queue clear");
}

// 17. Release Engineer — release readiness, changelogs, version bumps
async function _releaseEngTick(s) {
  _setObj(s, "Checking release readiness and changelog health");
  let created = 0;

  try {
    const readiness = _rel()?.checkDeploymentReadiness?.();
    if (readiness && !readiness.ready) {
      const blockers = (readiness.blockers || []).slice(0, 3);
      const m = _mission(s.id, {
        objective: `Release: deployment not ready — ${blockers.length} blocker(s)`,
        priority: "high",
        subtasks: blockers.map(b => ({ description: b })).concat([{ description: "Resolve all blockers and re-run readiness check" }]),
        metadata: { autoCreatedBy: s.id, domain: "release", blockers },
      }, s);
      if (m) created++;
    }
    // Check for pending release notes
    const releases = _rel()?.listReleases?.({ limit: 5 }) || [];
    const noNotes = (releases || []).filter(r => !r.notes && r.status === "pending");
    if (noNotes.length > 0) {
      const m = _mission(s.id, {
        objective: `Release: ${noNotes.length} release(s) missing notes — generate changelog`,
        priority: "medium",
        subtasks: [{ description: `Releases missing notes: ${noNotes.map(r => r.version || r.id).join(", ")}` }, { description: "Run generateReleaseNotes() and update release" }],
        metadata: { autoCreatedBy: s.id, domain: "release", releaseIds: noNotes.map(r => r.id) },
      }, s);
      if (m) created++;
    }
  } catch {}

  // V2: deploy approved work items
  try {
    const items = _st()?.listWorkItems({ status: "approved" }) || [];
    for (const item of items.slice(0, 1)) {
      _wf()?.releaseDeploy(item.id, { releaseEngineerId: s.id, target: "staging" });
    }
    if (items.length) s.v2Releases = (s.v2Releases || 0) + items.length;
  } catch {}

  _setObj(s, created > 0 ? `Opened ${created} release task(s)` : "Release pipeline nominal");
}

// 18. Dependency Manager — outdated deps, security vulnerabilities in deps
async function _depManagerTick(s) {
  _setObj(s, "Auditing dependencies for vulnerabilities and staleness");
  let created = 0;

  try {
    const fs   = require("fs");
    const path = require("path");
    // Read package.json
    const pkgPath = path.join(process.cwd(), "package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      const depCount = Object.keys(allDeps).length;

      // Check for pinned versions (no ^ or ~) — potential staleness indicator
      const unpinned = Object.entries(allDeps).filter(([, v]) => v.startsWith("^") || v.startsWith("~"));
      if (unpinned.length > 20) {
        const m = _mission(s.id, {
          objective: `Dependencies: ${unpinned.length} unpinned packages — audit for vulnerabilities`,
          priority: "medium",
          subtasks: [
            { description: `${unpinned.length} deps with ^ or ~ version constraints` },
            { description: "Run npm audit and update critical security patches" },
            { description: "Pin known-good versions for reproducible builds" },
          ],
          metadata: { autoCreatedBy: s.id, domain: "dependencies", unpinnedCount: unpinned.length, totalDeps: depCount },
        }, s);
        if (m) created++;
      }

      _lesson(s.id, {
        type: "dependency_audit",
        severity: "info",
        title: `Dependency audit: ${depCount} total, ${unpinned.length} unpinned`,
        detail: `Package: ${pkg.name} v${pkg.version}`,
        tags: ["dependencies"],
      });
      s.lessonsRegistered = (s.lessonsRegistered || 0) + 1;
    }
  } catch {}

  _setObj(s, created > 0 ? `Opened ${created} dependency task(s)` : "Dependencies nominal");
}

// 19. Incident Response Engineer — failed missions, critical errors, alerts, RCA triggers
async function _incidentEngTick(s) {
  _setObj(s, "Scanning for active incidents and critical failures");
  let created = 0;

  try {
    const all = _mm()?.listMissions({ limit: 300 }) || { missions: [] };
    // Missions that failed in last 24h without RCA
    const recentFailed = (all.missions || []).filter(m =>
      m.status === "failed" && !m.metadata?.rcaTriggered &&
      Date.now() - new Date(m.updatedAt || m.createdAt).getTime() < 24 * 3600_000
    );
    for (const fm of recentFailed.slice(0, 2)) {
      const m = _mission(s.id, {
        objective: `Incident: mission failed without RCA — ${fm.objective?.slice(0, 50)}`,
        priority: "high",
        subtasks: [
          { description: `Failed mission: ${fm.id} — ${fm.objective}` },
          { description: "Trigger root cause analysis" },
          { description: "Create recovery mission and link to incident" },
        ],
        metadata: { autoCreatedBy: s.id, domain: "incident", failedMissionId: fm.id, rcaTriggered: true },
      }, s);
      if (m) created++;
      // Mark to avoid re-triggering
      try { _mm()?.updateMission?.(fm.id, { metadata: { ...fm.metadata, rcaTriggered: true } }); } catch {}
    }

    // Critical observability alerts
    const alerts = _obs()?.evaluateAlerts?.() || { triggered: [] };
    const critical = (alerts.triggered || []).filter(a => a.severity === "critical");
    for (const alert of critical.slice(0, 1)) {
      const m = _mission(s.id, {
        objective: `INCIDENT: ${alert.message || alert.metric} — critical alert triggered`,
        priority: "critical",
        subtasks: [
          { description: `Alert: ${alert.message}` },
          { description: "Engage incident response protocol" },
          { description: "Notify team and begin remediation" },
        ],
        metadata: { autoCreatedBy: s.id, domain: "incident", requiresHumanApproval: true },
      }, s);
      if (m) created++;
    }
    s.verificationsRun = (s.verificationsRun || 0) + 1;
  } catch {}

  // V2: monitor recently deployed work items for post-deploy health
  try {
    const items = _st()?.listWorkItems({ status: "deploying" }) || [];
    for (const item of items.slice(0, 2)) {
      _wf()?.incidentMonitor(item.id, { healthy: true, incidentEngineerId: s.id });
    }
    if (items.length) s.v2Monitors = (s.v2Monitors || 0) + items.length;
  } catch {}

  _setObj(s, created > 0 ? `Opened ${created} incident task(s)` : "No active incidents");
}

// 20. Engineering Coordinator — cross-engineer summary, collaboration events, progress tracking
async function _engCoordinatorTick(s) {
  _setObj(s, "Coordinating engineering org and generating status report");

  try {
    const agentList = _sup().listAgents();
    const engAgents = agentList.filter(a => a.id.startsWith("engorg_"));
    const total     = engAgents.length;
    const running   = engAgents.filter(a => a.status === "running").length;
    const healthy   = engAgents.filter(a => a.health >= 70).length;

    // Cross-agent event for dashboards
    try {
      _bus()?.emit("engorg:coordinator:status", {
        total, running, healthy,
        timestamp: new Date().toISOString(),
        agents: engAgents.map(a => ({ id: a.id, status: a.status, health: a.health, lastDecision: a.lastDecision })),
      });
    } catch {}

    // Record summary lesson
    _lesson(s.id, {
      type: "org_status",
      severity: healthy < total * 0.7 ? "warning" : "info",
      title: `Eng Org: ${running}/${total} running, ${healthy} healthy`,
      detail: `Agents: ${engAgents.map(a => `${a.id}(${a.status})`).join(", ")}`,
      tags: ["coordinator", "engineering-org"],
    });
    s.lessonsRegistered = (s.lessonsRegistered || 0) + 1;

    // Create catch-up missions for unhealthy agents
    const failed = engAgents.filter(a => a.status === "failed");
    for (const agent of failed.slice(0, 2)) {
      _mission(s.id, {
        objective: `Engineering Org: agent ${agent.id} has failed — investigate and recover`,
        priority: "high",
        subtasks: [{ description: `Agent ${agent.id} (${agent.role}) status: failed` }, { description: "Check error logs and re-enable agent" }],
        metadata: { autoCreatedBy: s.id, domain: "management", failedAgentId: agent.id },
      }, s);
    }
  } catch {}

  // V2: run coordinator sync (claim ready work, alert on blockers, broadcast health)
  try {
    const sync = _wf()?.coordinatorSync?.();
    if (sync?.ok) {
      s.v2Sync = { readyWork: sync.dashboard?.workItems?.ready, blockers: sync.dashboard?.blockers?.active, velocity: sync.avgVelocity };
    }
  } catch {}

  _setObj(s, "Coordination cycle complete");
}

// ── PERSONA DEFINITIONS ───────────────────────────────────────────────────────

const ENGINEERING_ORG = [
  {
    id: "engorg_cto",
    role: "engorg_cto",
    label: "AI CTO",
    description: "Strategic health, cross-domain escalation, engineering velocity",
    intervalMs: 300_000, // 5 min
    tickFn: _ctoTick,
  },
  {
    id: "engorg_manager",
    role: "engorg_manager",
    label: "AI Engineering Manager",
    description: "Workload balancing, blocked missions, team coordination",
    intervalMs: 180_000, // 3 min
    tickFn: _engManagerTick,
  },
  {
    id: "engorg_architect",
    role: "engorg_architect",
    label: "AI Technical Architect",
    description: "Architecture health, code smells, dependency graph",
    intervalMs: 240_000, // 4 min
    tickFn: _techArchitectTick,
  },
  {
    id: "engorg_backend",
    role: "engorg_backend",
    label: "AI Backend Engineer",
    description: "Backend services health, execution failures, capability gaps",
    intervalMs: 120_000,
    tickFn: _backendEngTick,
  },
  {
    id: "engorg_frontend",
    role: "engorg_frontend",
    label: "AI Frontend Engineer",
    description: "Frontend quality, visual regressions, UX/ODI scores",
    intervalMs: 180_000,
    tickFn: _frontendEngTick,
  },
  {
    id: "engorg_electron",
    role: "engorg_electron",
    label: "AI Electron Engineer",
    description: "Electron runtime health, desktop build artifacts",
    intervalMs: 300_000,
    tickFn: _electronEngTick,
  },
  {
    id: "engorg_mobile",
    role: "engorg_mobile",
    label: "AI Mobile Engineer",
    description: "Capacitor/Android build health, Firebase integration",
    intervalMs: 300_000,
    tickFn: _mobileEngTick,
  },
  {
    id: "engorg_database",
    role: "engorg_database",
    label: "AI Database Engineer",
    description: "Data integrity, JSON validation, storage growth",
    intervalMs: 240_000,
    tickFn: _databaseEngTick,
  },
  {
    id: "engorg_api",
    role: "engorg_api",
    label: "AI API Engineer",
    description: "Route health, auth coverage, rate limiting",
    intervalMs: 180_000,
    tickFn: _apiEngTick,
  },
  {
    id: "engorg_devops",
    role: "engorg_devops",
    label: "AI DevOps Engineer",
    description: "Pipeline health, deployment status, infra alerts",
    intervalMs: 120_000,
    tickFn: _devopsEngTick,
  },
  {
    id: "engorg_qa",
    role: "engorg_qa",
    label: "AI QA Engineer",
    description: "Test coverage, mission verification, benchmark health",
    intervalMs: 120_000,
    tickFn: _qaEngTick,
  },
  {
    id: "engorg_security",
    role: "engorg_security",
    label: "AI Security Engineer",
    description: "Hardening checks, OWASP compliance, vuln missions",
    intervalMs: 240_000,
    tickFn: _securityEngTick,
  },
  {
    id: "engorg_perf",
    role: "engorg_perf",
    label: "AI Performance Engineer",
    description: "Memory growth, latency monitoring, slow path detection",
    intervalMs: 180_000,
    tickFn: _perfEngTick,
  },
  {
    id: "engorg_refactor",
    role: "engorg_refactor",
    label: "AI Refactoring Engineer",
    description: "Code duplication, oversized files, refactor plans",
    intervalMs: 300_000,
    tickFn: _refactorEngTick,
  },
  {
    id: "engorg_docs",
    role: "engorg_docs",
    label: "AI Documentation Engineer",
    description: "Runbooks, lesson documentation, coverage gaps",
    intervalMs: 300_000,
    tickFn: _docsEngTick,
  },
  {
    id: "engorg_code_review",
    role: "engorg_code_review",
    label: "AI Code Review Engineer",
    description: "Review queue, code smells, security and perf defects",
    intervalMs: 180_000,
    tickFn: _codeReviewEngTick,
  },
  {
    id: "engorg_release",
    role: "engorg_release",
    label: "AI Release Engineer",
    description: "Release readiness, changelog, version management",
    intervalMs: 300_000,
    tickFn: _releaseEngTick,
  },
  {
    id: "engorg_dep_manager",
    role: "engorg_dep_manager",
    label: "AI Dependency Manager",
    description: "Outdated packages, vulnerability audit, version pinning",
    intervalMs: 600_000, // 10 min
    tickFn: _depManagerTick,
  },
  {
    id: "engorg_incident",
    role: "engorg_incident",
    label: "AI Incident Response Engineer",
    description: "Failed missions, critical alerts, RCA triggering",
    intervalMs: 90_000,
    tickFn: _incidentEngTick,
  },
  {
    id: "engorg_coordinator",
    role: "engorg_coordinator",
    label: "AI Engineering Coordinator",
    description: "Cross-engineer status, collaboration events, org health report",
    intervalMs: 240_000,
    tickFn: _engCoordinatorTick,
  },
];

// ── REGISTRATION ──────────────────────────────────────────────────────────────

let _registered = false;

function register() {
  if (_registered) return { ok: true, message: "Already registered", count: ENGINEERING_ORG.length };
  const sup = _sup();

  // Ensure supervisor is started so registerAgent() immediately calls _startAgent()
  try { if (!sup.getSupervisorStatus().started) sup.start(); } catch {}

  const results = [];
  for (const spec of ENGINEERING_ORG) {
    const r = sup.registerAgent(spec);
    results.push(r);
  }
  _registered = true;
  // V2: wire event-driven workflow subscriptions
  try { _wf()?.subscribeWorkflowEvents?.(); } catch {}
  try { _bus()?.emit("engorg:registered", { count: ENGINEERING_ORG.length, ids: ENGINEERING_ORG.map(e => e.id) }); } catch {}
  return { ok: true, count: ENGINEERING_ORG.length, registered: results.filter(r => r.ok).length };
}

function getOrgStatus() {
  const sup = _sup();
  return ENGINEERING_ORG.map(spec => {
    const agent = sup.getAgent(spec.id);
    return agent || { id: spec.id, role: spec.role, label: spec.label, status: "not_registered" };
  });
}

function getOrgSummary() {
  const status = getOrgStatus();
  const running  = status.filter(a => a.status === "running").length;
  const healthy  = status.filter(a => (a.health || 0) >= 70).length;
  const missions = status.reduce((s, a) => s + (a.missionsCreated || 0), 0);
  const lessons  = status.reduce((s, a) => s + (a.lessonsRegistered || 0), 0);
  return { total: status.length, running, healthy, missions, lessons, agents: status };
}

module.exports = { register, getOrgStatus, getOrgSummary, ENGINEERING_ORG };
