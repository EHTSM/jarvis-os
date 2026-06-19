"use strict";
/**
 * AI Composer Engine — ACP-7
 *
 * Turns a natural-language engineering request into a full execution plan
 * and drives it through the existing stack end-to-end.
 *
 * Execution flow (all reused systems, no new runtime):
 *   goal
 *     → ACP-1 repo context   (codingAssistant._buildRepoContext)
 *     → ACP-3 smell scan     (engineeringSmellDetector.scan)
 *     → ACP-4 decisions      (engineeringDecisionEngine.computeOpportunities)
 *     → ACP-6 bundle plan    (repositoryEditingEngine.planBundle)
 *     → confidence engine    (engineeringConfidenceEngine.explain)
 *     → knowledge graph      (knowledgeGraph.impactAnalysis)
 *     → unified intelligence (unifiedIntelligenceLayer.reason)
 *     → mission              (missionMemory.createMission)
 *     → [approval]
 *     → ACP-6 bundle apply   (repositoryEditingEngine.applyBundle)
 *     → I7 pipeline          (engineeringPipelineCoordinator.runPipeline)
 *     → learning             (continuousLearningEngine.createLesson)
 *
 * Reuses: ACP-1..6, I4 supervisor, I5 registry, I6 collab, I7 pipeline,
 *         missionMemory, knowledgeGraph, continuousLearningEngine,
 *         unifiedIntelligenceLayer, engineeringConfidenceEngine
 */

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");

const DATA_DIR    = path.join(__dirname, "../../data");
const PLANS_FILE  = path.join(DATA_DIR, "acp7-composer-plans.json");

// ── Lazy service accessors (no new runtime, no new AI service) ────────────────

function _try(fn) { try { return fn(); } catch { return null; } }

function _ai()       { return _try(() => require("./aiService")); }
function _smells()   { return _try(() => require("./engineeringSmellDetector.cjs")); }
function _de()       { return _try(() => require("./engineeringDecisionEngine.cjs")); }
function _re()       { return _try(() => require("./repositoryEditingEngine.cjs")); }
function _pc()       { return _try(() => require("./engineeringPipelineCoordinator.cjs")); }
function _mm()       { return _try(() => require("./missionMemory.cjs")); }
function _kg()       { return _try(() => require("./knowledgeGraph.cjs")); }
function _ce()       { return _try(() => require("./engineeringConfidenceEngine.cjs")); }
function _le()       { return _try(() => require("./continuousLearningEngine.cjs")); }
function _unified()  { return _try(() => require("./unifiedIntelligenceLayer.cjs")); }
function _sup()      { return _try(() => require("./agentRuntimeSupervisor.cjs")); }
function _rr()       { return _try(() => require("./engineeringRuleRegistry.cjs")); }

// ── Persistence ───────────────────────────────────────────────────────────────

function _load() {
    try { return JSON.parse(fs.readFileSync(PLANS_FILE, "utf8")); }
    catch { return { plans: {}, stats: { created: 0, approved: 0, executed: 0, failed: 0, cancelled: 0, avgConfidence: 0 } }; }
}

function _save(data) {
    fs.writeFileSync(PLANS_FILE, JSON.stringify(data, null, 2));
}

function _savePlan(plan) {
    const data = _load();
    data.plans[plan.planId] = plan;
    _save(data);
}

function _updateStats(field) {
    const data = _load();
    data.stats[field] = (data.stats[field] || 0) + 1;
    _save(data);
}

// ── Goal classifier ───────────────────────────────────────────────────────────
// Maps free-text goals to execution categories to tune the pipeline behavior.

const GOAL_PATTERNS = [
    { re: /\b(perf|performance|slow|latency|fast|optim|speed)\b/i, category: 'performance', autoApprove: false },
    { re: /\b(dead.?code|unused|remove|clean.?up|purge)\b/i,       category: 'cleanup',     autoApprove: true  },
    { re: /\b(security|auth|vuln|xss|inject|csrf|token)\b/i,       category: 'security',    autoApprove: false },
    { re: /\b(bundle|webpack|vite|chunk|size|minif)\b/i,           category: 'bundleSize',  autoApprove: true  },
    { re: /\b(valid|sanitiz|schema|input|format)\b/i,              category: 'validation',  autoApprove: true  },
    { re: /\b(log|observ|monitor|trace|metric|alert)\b/i,          category: 'observability',autoApprove: true },
    { re: /\b(test|spec|flaky|coverage|jest|mocha)\b/i,            category: 'tests',       autoApprove: false },
    { re: /\b(refactor|restructur|reorganiz|extract|split)\b/i,    category: 'refactor',    autoApprove: false },
    { re: /\b(deploy|ci|cd|pipeline|release|build)\b/i,            category: 'deployment',  autoApprove: false },
    { re: /\b(api|endpoint|route|request|response|http)\b/i,       category: 'api',         autoApprove: false },
    { re: /\b(crm|lead|customer|contact|deal)\b/i,                 category: 'crm',         autoApprove: false },
    { re: /\b(rename|move|migrate|port|upgrade)\b/i,               category: 'migration',   autoApprove: false },
];

function _classifyGoal(goal) {
    for (const p of GOAL_PATTERNS) {
        if (p.re.test(goal)) return { category: p.category, autoApprove: p.autoApprove };
    }
    return { category: 'general', autoApprove: false };
}

// ── Risk calculator ───────────────────────────────────────────────────────────

function _calcRisk(bundle, smellCount, decisionCount) {
    const filesTouched  = bundle?.metrics?.filesTouched  || 0;
    const invalidPatches = bundle?.metrics?.patchesInvalid || 0;
    const depConf       = bundle?.metrics?.depConfidence  || 0;
    const riskPlanLevel = bundle?.plan?.riskLevel === 'high' ? 3 : bundle?.plan?.riskLevel === 'medium' ? 2 : 1;

    let score = 0;
    score += Math.min(filesTouched * 3, 30);        // 0-30 based on files
    score += Math.min(invalidPatches * 10, 30);     // invalid patches are risky
    score += Math.max(0, 70 - depConf) * 0.3;      // low dep confidence = risk
    score += riskPlanLevel * 5;                     // plan risk level
    score += Math.min(smellCount * 0.5, 15);        // more smells = higher risk

    const riskScore = Math.min(100, Math.round(score));
    const riskLevel = riskScore >= 70 ? 'high' : riskScore >= 40 ? 'medium' : 'low';
    return { riskScore, riskLevel };
}

// ── Estimated duration ────────────────────────────────────────────────────────

function _estimateDuration(bundle, category) {
    const files = bundle?.metrics?.filesTouched || 1;
    const base  = { performance: 45, cleanup: 20, security: 60, bundleSize: 30,
                    validation: 25, observability: 20, tests: 40, refactor: 50,
                    deployment: 35, api: 45, crm: 40, migration: 60, general: 30 };
    const mins = (base[category] || 30) + files * 3;
    return mins < 60 ? `${mins}m` : `${Math.round(mins / 6) / 10}h`;
}

// ── Step 1: gather repo context ───────────────────────────────────────────────

async function _gatherContext(goal, cwd) {
    const root = path.resolve(cwd || process.cwd());

    // ACP-3: scan smells
    let smellScan = { smells: [], summary: { total: 0 } };
    try {
        const sd = _smells();
        if (sd) smellScan = await sd.scan(root);
    } catch {}

    // ACP-4: get existing decisions/opportunities
    let decisions = [];
    try {
        const de = _de();
        if (de) {
            const opps = de.loadOpportunities();
            decisions = (opps.opportunities || []).filter(o => o.status === 'open').slice(0, 10);
        }
    } catch {}

    // Knowledge Graph: system context
    let kgCtx = '';
    try {
        const kg = _kg();
        if (kg) {
            const stats = kg.getStats();
            kgCtx = `KG: ${stats.totalNodes} nodes, ${stats.totalEdges} edges`;
        }
    } catch {}

    // Unified intelligence: executive context
    let execCtx = {};
    try {
        const ui = _unified();
        if (ui) {
            const dash = ui.getExecutiveDashboard?.() || {};
            execCtx = { healthScore: dash.systemHealthScore, riskLevel: dash.riskLevel };
        }
    } catch {}

    // Learning engine: recent lessons
    let lessons = [];
    try {
        const le = _le();
        if (le) {
            const { lessons: ls } = le.getLessons({ limit: 5 });
            lessons = (ls || []).map(l => l.lesson || l.description || '').filter(Boolean);
        }
    } catch {}

    // Rule registry: relevant rules
    let rules = [];
    try {
        const rr = _rr();
        if (rr) {
            const { rules: rs } = rr.listRules({ limit: 6 });
            rules = (rs || []).map(r => r.description || r.name || '').filter(Boolean);
        }
    } catch {}

    return {
        root,
        smellCount:    smellScan.summary?.total || smellScan.smells?.length || 0,
        topSmells:     (smellScan.smells || []).slice(0, 5).map(s => `${s.type} in ${s.file}`),
        decisionCount: decisions.length,
        topDecisions:  decisions.slice(0, 3).map(d => d.title || d.type || ''),
        kgCtx,
        execCtx,
        lessons,
        rules,
    };
}

// ── Step 2: AI compose plan summary ──────────────────────────────────────────

async function _aiComposePlan(goal, ctx, classification) {
    const ai = _ai();
    if (!ai) throw new Error("aiService unavailable");

    const system = `You are a senior engineering architect composing an execution plan.
You have full access to repository intelligence, smell detection, decision analysis, and the engineering pipeline.
Category: ${classification.category} | Auto-approve eligible: ${classification.autoApprove}
${ctx.rules.length ? 'Engineering rules:\n' + ctx.rules.map(r => `- ${r}`).join('\n') : ''}
${ctx.lessons.length ? 'Recent lessons:\n' + ctx.lessons.map(l => `- ${l}`).join('\n') : ''}
${ctx.kgCtx ? 'Knowledge graph: ' + ctx.kgCtx : ''}
${ctx.execCtx?.healthScore ? `System health: ${ctx.execCtx.healthScore}/100` : ''}`;

    const prompt = `Goal: "${goal}"

Repository context:
- Engineering smells found: ${ctx.smellCount} (top: ${ctx.topSmells.slice(0,3).join(', ') || 'none'})
- Open engineering decisions: ${ctx.decisionCount}
- Relevant decisions: ${ctx.topDecisions.join(', ') || 'none'}

Produce a concise COMPOSER PLAN as JSON (no fences):
{
  "summary": "2-3 sentence description of what will be done and why",
  "strategy": "step-by-step approach (1-3 sentences)",
  "requiredApprovals": 1,
  "pipelineStages": ["repo_analysis","smell_scan","decision_compute","bundle_plan","confidence","approval","bundle_apply","pipeline_run","learn"],
  "estimatedFiles": 4,
  "successCriteria": ["criterion 1", "criterion 2", "criterion 3"],
  "rollbackAvailable": true,
  "keyRisks": ["risk 1", "risk 2"],
  "skipApproval": ${classification.autoApprove}
}`;

    const raw = await ai.callAI(prompt, { system });
    const m   = raw.match(/\{[\s\S]+\}/);
    if (!m) throw new Error("AI returned no plan JSON");
    return JSON.parse(m[0]);
}

// ── Step 3: confidence assessment ────────────────────────────────────────────

async function _assessConfidence(plan, ctx, classification) {
    try {
        const ce = _ce();
        if (!ce) return { score: 70, grade: 'B', rationale: 'confidence engine unavailable' };
        // Use confidence engine's explain() with a synthetic error context
        const result = ce.explain(`composer:${classification.category}`, {
            context: plan.summary,
            smellCount: ctx.smellCount,
        });
        return {
            score:     result?.score     || 70,
            grade:     result?.grade     || 'B',
            rationale: result?.rationale || plan.summary,
            breakdown: result?.breakdown || {},
        };
    } catch {
        // Heuristic fallback
        const base = ctx.smellCount < 5 ? 85 : ctx.smellCount < 20 ? 75 : 65;
        const adj  = classification.autoApprove ? 5 : 0;
        const score = Math.min(95, base + adj);
        return { score, grade: score >= 80 ? 'A' : 'B', rationale: 'heuristic confidence' };
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * composeGoal(goal, cwd, opts) → plan
 *
 * Phase 1 of the execution flow. Assembles the full composer plan.
 * Does NOT execute or write files.
 */
async function composeGoal(goal, cwd, opts = {}) {
    if (!goal?.trim()) throw new Error("goal is required");

    const planId = `comp_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

    const plan = {
        planId,
        goal,
        cwd:         cwd || path.join(__dirname, "../../"),
        status:      'composing',
        createdAt:   new Date().toISOString(),
        updatedAt:   new Date().toISOString(),
        classification: null,
        aiPlan:      null,
        smellCount:  0,
        decisionCount: 0,
        bundleId:    null,
        bundle:      null,
        confidence:  null,
        risk:        null,
        missionId:   null,
        pipelineId:  null,
        estimatedDuration: null,
        timeline:    [],
        error:       null,
    };

    _savePlan(plan);
    _updateStats('created');

    function _tick(stage, detail = '') {
        plan.timeline.push({ stage, detail, ts: new Date().toISOString() });
        plan.updatedAt = new Date().toISOString();
        _savePlan(plan);
    }

    try {
        // Step 1: classify goal
        const classification = _classifyGoal(goal);
        plan.classification  = classification;
        _tick('classify', `category=${classification.category} autoApprove=${classification.autoApprove}`);

        // Step 2: gather context (ACP-1, ACP-3, ACP-4, KG, unified, learning)
        const ctx = await _gatherContext(goal, plan.cwd);
        plan.smellCount   = ctx.smellCount;
        plan.decisionCount = ctx.decisionCount;
        plan.root         = ctx.root;
        _tick('context', `smells=${ctx.smellCount} decisions=${ctx.decisionCount}`);

        // Step 3: AI compose plan
        const aiPlan = await _aiComposePlan(goal, ctx, classification);
        plan.aiPlan  = aiPlan;
        _tick('ai_plan', aiPlan.summary?.slice(0, 80));

        // Step 4: ACP-6 bundle plan (repo analysis + dep graph + per-file patches)
        let bundle = null;
        try {
            const re   = _re();
            if (re) {
                bundle       = await re.planBundle(goal, plan.root);
                plan.bundleId = bundle.bundleId;
                plan.bundle   = {
                    bundleId:   bundle.bundleId,
                    status:     bundle.status,
                    plan:       bundle.plan,
                    metrics:    bundle.metrics,
                    files:      (bundle.files || []).map(f => ({
                        path: f.path, role: f.role, valid: f.valid,
                        changeType: f.changeType, confidence: f.confidence,
                    })),
                    applyOrder:  bundle.applyOrder,
                    depGraph:    bundle.depGraph,
                };
            }
        } catch (e) { _tick('bundle_warn', e.message.slice(0, 80)); }
        _tick('bundle_plan', `files=${bundle?.metrics?.filesTouched || 0} valid=${bundle?.metrics?.patchesValid || 0}`);

        // Step 5: confidence assessment
        const confidence  = await _assessConfidence(aiPlan, ctx, classification);
        plan.confidence   = confidence;
        _tick('confidence', `score=${confidence.score} grade=${confidence.grade}`);

        // Step 6: risk calculation
        const risk        = _calcRisk(bundle, ctx.smellCount, ctx.decisionCount);
        plan.risk         = risk;
        plan.estimatedDuration = _estimateDuration(bundle, classification.category);
        _tick('risk', `level=${risk.riskLevel} score=${risk.riskScore}`);

        // Step 7: KG impact analysis for primary changed files
        let kgImpact = null;
        try {
            const kg = _kg();
            if (kg && bundle?.files?.length) {
                const primary = bundle.files.find(f => f.role === 'primary');
                if (primary) kgImpact = kg.impactAnalysis('file', primary.path);
            }
        } catch {}
        plan.kgImpact = kgImpact;
        if (kgImpact) _tick('kg_impact', `affected=${JSON.stringify(kgImpact).slice(0,60)}`);

        // Step 8: create mission for tracking
        let missionId = null;
        try {
            const mm = _mm();
            if (mm) {
                const mission = mm.createMission({
                    objective: `[ACP-7 Composer] ${goal.slice(0, 120)}`,
                    priority:  risk.riskLevel === 'high' ? 'high' : 'medium',
                    subtasks:  [
                        { description: `Repository analysis: ${ctx.smellCount} smells, ${ctx.decisionCount} open decisions` },
                        ...(aiPlan.successCriteria || []).map(c => ({ description: c })),
                        { description: 'Apply patch bundle through Engineering Pipeline (I7)' },
                        { description: 'Record lesson in Continuous Learning Engine' },
                    ],
                    metadata: { source: 'acp7-composer', planId, category: classification.category, bundleId: plan.bundleId },
                });
                missionId      = mission.id;
                plan.missionId = missionId;
            }
        } catch {}
        _tick('mission', missionId ? `id=${missionId}` : 'skipped');

        // Step 9: determine status
        const skipApproval = aiPlan.skipApproval && risk.riskLevel === 'low' && !opts.forceApproval;
        plan.status = skipApproval ? 'auto_approved' : 'pending_approval';
        _tick('composed', `status=${plan.status}`);

    } catch (e) {
        plan.status = 'failed';
        plan.error  = e.message;
        _tick('error', e.message.slice(0, 100));
    }

    plan.updatedAt = new Date().toISOString();
    _savePlan(plan);
    return plan;
}

/**
 * reviewPlan(planId) → plan (refreshes context with latest data)
 */
async function reviewPlan(planId) {
    const data = _load();
    const plan = data.plans[planId];
    if (!plan) throw new Error(`plan ${planId} not found`);
    // Re-fetch live smells and decisions to freshen confidence
    try {
        const sd = _smells();
        if (sd) {
            const scan = await sd.scan(plan.root || process.cwd());
            plan.smellCount = scan.summary?.total || scan.smells?.length || 0;
        }
    } catch {}
    plan.updatedAt = new Date().toISOString();
    _savePlan(plan);
    return plan;
}

/**
 * approvePlan(planId) → plan
 */
function approvePlan(planId) {
    const data = _load();
    const plan = data.plans[planId];
    if (!plan) throw new Error(`plan ${planId} not found`);
    if (!['pending_approval', 'auto_approved', 'rejected'].includes(plan.status)) {
        throw new Error(`plan is ${plan.status}, cannot approve`);
    }
    plan.status    = 'approved';
    plan.approvedAt = new Date().toISOString();
    plan.updatedAt  = plan.approvedAt;
    plan.timeline.push({ stage: 'approved', ts: plan.approvedAt });
    _save(data);
    _updateStats('approved');
    return plan;
}

/**
 * rejectPlan(planId, reason) → plan
 */
function rejectPlan(planId, reason = '') {
    const data = _load();
    const plan = data.plans[planId];
    if (!plan) throw new Error(`plan ${planId} not found`);
    plan.status     = 'rejected';
    plan.rejectedAt = new Date().toISOString();
    plan.updatedAt  = plan.rejectedAt;
    plan.rejectReason = reason;
    plan.timeline.push({ stage: 'rejected', detail: reason, ts: plan.rejectedAt });
    _save(data);
    return plan;
}

/**
 * executePlan(planId) → { ok, bundleResult, pipelineId, missionId }
 *
 * Applies the ACP-6 bundle then runs through I7 Engineering Pipeline.
 */
async function executePlan(planId) {
    const data = _load();
    const plan = data.plans[planId];
    if (!plan) throw new Error(`plan ${planId} not found`);
    if (!['approved', 'auto_approved'].includes(plan.status)) {
        throw new Error(`plan must be approved before execution (current: ${plan.status})`);
    }

    plan.status    = 'executing';
    plan.executedAt = new Date().toISOString();
    plan.updatedAt  = plan.executedAt;
    plan.timeline.push({ stage: 'executing', ts: plan.executedAt });
    _save(data);

    function _tick(stage, detail = '') {
        plan.timeline.push({ stage, detail, ts: new Date().toISOString() });
        plan.updatedAt = new Date().toISOString();
        _save(data);
    }

    let bundleResult = null;
    let pipelineId   = null;

    try {
        // Apply ACP-6 bundle
        if (plan.bundleId) {
            const re     = _re();
            if (!re) throw new Error("repositoryEditingEngine unavailable");
            bundleResult = await re.applyBundle(plan.bundleId, { requireApproval: false });
            pipelineId   = bundleResult.pipelineId;
            plan.pipelineId = pipelineId;
            _tick('bundle_apply', `applied=${bundleResult.applied?.length || 0} files`);
        } else {
            // No bundle (compose failed to plan files) — run pipeline directly with goal
            const pc = _pc();
            if (pc) {
                const run  = await pc.runPipeline(plan.goal, {
                    requireApproval: false,
                    priority: plan.risk?.riskLevel === 'high' ? 'high' : 'medium',
                });
                pipelineId     = run.pipelineId;
                plan.pipelineId = pipelineId;
                _tick('pipeline_direct', `pipelineId=${pipelineId}`);
            }
        }

        // Update mission
        try {
            const mm = _mm();
            if (mm && plan.missionId) {
                mm.updateMission(plan.missionId, { status: 'in_progress' });
            }
        } catch {}

        // Record lesson in continuous learning
        try {
            const le = _le();
            if (le) {
                le.createLesson({
                    lesson: `ACP-7 Composer executed: "${plan.goal.slice(0, 80)}" — category=${plan.classification?.category} confidence=${plan.confidence?.score} risk=${plan.risk?.riskLevel} files=${plan.bundle?.metrics?.filesTouched || 0}`,
                    type:   'composer_execution',
                    source: 'acp7',
                    context: { planId, category: plan.classification?.category, bundleId: plan.bundleId },
                });
            }
        } catch {}

        plan.status    = 'executing'; // pipeline runs async
        plan.bundleResult = bundleResult ? {
            applied:    bundleResult.applied,
            commitMsg:  bundleResult.commitMsg,
            changelog:  bundleResult.changelog,
            pipelineId: bundleResult.pipelineId,
        } : null;

        _tick('execute_ok', `pipelineId=${pipelineId || 'none'}`);
        _updateStats('executed');

    } catch (e) {
        plan.status = 'failed';
        plan.error  = e.message;
        _tick('execute_error', e.message.slice(0, 100));

        // Record failure lesson
        try {
            const le = _le();
            if (le) {
                le.createLesson({
                    lesson: `ACP-7 execution failed: "${plan.goal.slice(0, 60)}" — ${e.message.slice(0, 80)}`,
                    type:  'composer_failure',
                    source: 'acp7',
                });
            }
        } catch {}

        _updateStats('failed');
    }

    plan.updatedAt = new Date().toISOString();
    _save(data);

    return { ok: plan.status !== 'failed', plan, bundleResult, pipelineId };
}

/**
 * cancelPlan(planId) → plan
 */
function cancelPlan(planId) {
    const data = _load();
    const plan = data.plans[planId];
    if (!plan) throw new Error(`plan ${planId} not found`);
    if (['executed', 'failed', 'cancelled'].includes(plan.status)) {
        throw new Error(`plan is already ${plan.status}`);
    }

    // Rollback bundle if it was applied
    if (plan.bundleId && plan.status === 'executing') {
        try {
            const re = _re();
            if (re) re.rollbackBundle(plan.bundleId).catch(() => {});
        } catch {}
    }

    plan.status      = 'cancelled';
    plan.cancelledAt = new Date().toISOString();
    plan.updatedAt   = plan.cancelledAt;
    plan.timeline.push({ stage: 'cancelled', ts: plan.cancelledAt });
    _save(data);
    _updateStats('cancelled');
    return plan;
}

/**
 * getPlan(planId) → plan
 */
function getPlan(planId) {
    const data = _load();
    return data.plans[planId] || null;
}

/**
 * listPlans(opts) → [plan, ...]
 */
function listPlans(opts = {}) {
    const data   = _load();
    const all    = Object.values(data.plans);
    const limit  = opts.limit || 30;
    const status = opts.status;
    return all
        .filter(p => !status || p.status === status)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, limit)
        .map(p => ({
            planId:     p.planId,
            goal:       p.goal,
            status:     p.status,
            createdAt:  p.createdAt,
            updatedAt:  p.updatedAt,
            category:   p.classification?.category,
            confidence: p.confidence?.score,
            riskLevel:  p.risk?.riskLevel,
            filesAffected: p.bundle?.metrics?.filesTouched || 0,
            missionId:  p.missionId,
            pipelineId: p.pipelineId,
            estimatedDuration: p.estimatedDuration,
        }));
}

/**
 * getStats() → aggregate stats
 */
function getStats() {
    const data    = _load();
    const stored  = data.stats || {};
    const plans   = Object.values(data.plans);

    const byStatus = {};
    for (const p of plans) {
        byStatus[p.status] = (byStatus[p.status] || 0) + 1;
    }

    const executed    = plans.filter(p => p.status !== 'failed' && p.status !== 'cancelled' && p.bundleResult);
    const avgConf     = plans.filter(p => p.confidence?.score).length
        ? Math.round(plans.reduce((s, p) => s + (p.confidence?.score || 0), 0) / plans.length)
        : 0;
    const avgFiles    = executed.length
        ? Math.round(executed.reduce((s, p) => s + (p.bundle?.metrics?.filesTouched || 0), 0) / executed.length)
        : 0;

    // Score metrics
    const successRate  = plans.length > 0
        ? Math.round(((stored.executed || 0) / plans.length) * 100)
        : 0;
    const approvalRate = plans.length > 0
        ? Math.round(((stored.approved || 0) / plans.length) * 100)
        : 0;

    // ACP-7 benchmark scores
    const replaceCursorScore = Math.min(100, successRate * 0.5 + avgConf * 0.5);
    const buildOoplixScore   = Math.min(100, (stored.executed || 0) * 8 + avgConf * 0.3);

    return {
        total:           plans.length,
        byStatus,
        avgConfidence:   avgConf,
        avgFilesPerPlan: avgFiles,
        successRate,
        approvalRate,
        replaceCursorScore: Math.round(replaceCursorScore),
        buildOoplixScore:   Math.round(Math.min(100, buildOoplixScore)),
        ...stored,
    };
}

/**
 * getHistory(limit) → [plan summary, ...]
 * For the dashboard history panel — strips large fields.
 */
function getHistory(limit = 20) {
    return listPlans({ limit });
}

/**
 * runBenchmark(scenarios) → benchmark report
 * Validates 10 real scenarios (composeGoal only, no file writes).
 */
async function runBenchmark(scenarios, cwd) {
    const root = path.resolve(cwd || process.cwd());

    if (!scenarios?.length) {
        scenarios = [
            "Fix login performance",
            "Remove dead code",
            "Improve auth security",
            "Reduce bundle size",
            "Add input validation",
            "Improve logging",
            "Fix flaky tests",
            "Refactor CRM module",
            "Improve deployment pipeline",
            "Optimize API endpoints",
        ];
    }

    const results = [];
    for (const scenario of scenarios.slice(0, 10)) {
        const start = Date.now();
        try {
            // composeGoal but with a dry-run flag so we don't persist full bundles
            const classification = _classifyGoal(scenario);
            const ctx = await _gatherContext(scenario, root).catch(() => ({
                smellCount: 0, decisionCount: 0, topSmells: [], topDecisions: [],
                kgCtx: '', execCtx: {}, lessons: [], rules: [], root,
            }));
            const aiPlan = await _aiComposePlan(scenario, ctx, classification).catch(() => null);
            const confScore = aiPlan ? (await _assessConfidence(aiPlan, ctx, classification).catch(() => ({ score: 60 }))).score : 0;
            const elapsed = Date.now() - start;
            results.push({
                scenario,
                ok:           !!aiPlan,
                category:     classification.category,
                confidence:   confScore,
                smellsFound:  ctx.smellCount,
                elapsed,
                plan:         aiPlan ? { summary: aiPlan.summary?.slice(0, 100), riskLevel: aiPlan.skipApproval ? 'low' : 'medium' } : null,
                error:        null,
            });
        } catch (e) {
            results.push({ scenario, ok: false, error: e.message, elapsed: Date.now() - start });
        }
    }

    const passed   = results.filter(r => r.ok).length;
    const avgConf  = results.filter(r => r.confidence).length
        ? Math.round(results.filter(r => r.confidence).reduce((s, r) => s + r.confidence, 0) / results.filter(r => r.confidence).length)
        : 0;
    const avgMs    = Math.round(results.reduce((s, r) => s + r.elapsed, 0) / results.length);

    return {
        total:   results.length,
        passed,
        failed:  results.length - passed,
        passRate: Math.round((passed / results.length) * 100),
        avgConfidence: avgConf,
        avgElapsedMs:  avgMs,
        replaceCursorScore: Math.min(100, Math.round(passed * 10 * 0.7 + avgConf * 0.3)),
        buildOoplixScore:   Math.min(100, Math.round(passed * 8 + avgConf * 0.2 * results.length)),
        scenarios: results,
    };
}

module.exports = {
    composeGoal,
    reviewPlan,
    approvePlan,
    rejectPlan,
    executePlan,
    cancelPlan,
    getPlan,
    listPlans,
    getHistory,
    getStats,
    runBenchmark,
};
