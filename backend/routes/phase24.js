"use strict";
/**
 * Phase 24 routes — VS Code Extension, Repo Intelligence, Refactor Engine, Multi-Repo
 *
 * 24A  VS Code Extension Service
 *      POST   /p24/vscode/chat              multi-provider AI chat
 *      POST   /p24/vscode/explain           explain selected code
 *      POST   /p24/vscode/generate          generate code from prompt
 *      POST   /p24/vscode/refactor          refactor code
 *      POST   /p24/vscode/fix               fix diagnostics errors
 *      POST   /p24/vscode/task              create task from VS Code
 *      GET    /p24/vscode/providers         list supported providers
 *
 * 24B  RepoIntelligenceEngine
 *      POST   /p24/repo/index               index a repository
 *      GET    /p24/repo/status              index status
 *      GET    /p24/repo/symbol/:name        find symbol across repo
 *      POST   /p24/repo/search              semantic code search
 *      GET    /p24/repo/deps                dependency graph for a file
 *      GET    /p24/repo/xrefs/:symbol       cross-file references
 *
 * 24C  AutonomousRefactorEngine
 *      POST   /p24/refactor/plan            generate full refactor plan
 *      POST   /p24/refactor/detect/dup      detect duplication only
 *      POST   /p24/refactor/detect/oversized detect oversized files only
 *      POST   /p24/refactor/detect/smells   detect architecture smells only
 *      POST   /p24/refactor/apply           apply a safe automated refactor
 *      GET    /p24/refactor/plans           list plans
 *      GET    /p24/refactor/plans/:planId   get plan
 *      GET    /p24/refactor/applied         applied refactor log
 *
 * 24D  MultiRepoEngineeringEngine
 *      POST   /p24/multirepo/repos          register repo
 *      DELETE /p24/multirepo/repos/:repoId  unregister repo
 *      GET    /p24/multirepo/repos/:repoId  get repo
 *      GET    /p24/multirepo/repos          list repos
 *      POST   /p24/multirepo/tasks          create shared task
 *      PATCH  /p24/multirepo/tasks/:taskId  update task status
 *      GET    /p24/multirepo/tasks/:taskId  get task
 *      GET    /p24/multirepo/tasks          list tasks
 *      POST   /p24/multirepo/deps           add dependency
 *      DELETE /p24/multirepo/deps/:depId    remove dependency
 *      GET    /p24/multirepo/deps           dependency graph
 *      GET    /p24/multirepo/deps/:repoId/dependents  who depends on repo
 *      POST   /p24/multirepo/releases       plan release
 *      PATCH  /p24/multirepo/releases/:id   update release
 *      GET    /p24/multirepo/releases/:id   get release
 *      GET    /p24/multirepo/releases       list releases
 */

const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const vsc  = require("../services/vsCodeExtensionService.cjs");
const rie  = require("../services/repoIntelligenceEngine.cjs");
const are  = require("../services/autonomousRefactorEngine.cjs");
const mre  = require("../services/multiRepoEngineeringEngine.cjs");

router.use(requireAuth);

// ── 24A VS Code Extension ─────────────────────────────────────────────────────

router.post("/p24/vscode/chat", async (req, res) => {
    try { res.json({ success: true, ...(await vsc.chat(req.body)) }); }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post("/p24/vscode/explain", async (req, res) => {
    try { res.json({ success: true, ...(await vsc.explain(req.body)) }); }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post("/p24/vscode/generate", async (req, res) => {
    try { res.json({ success: true, ...(await vsc.generate(req.body)) }); }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post("/p24/vscode/refactor", async (req, res) => {
    try { res.json({ success: true, ...(await vsc.refactor(req.body)) }); }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post("/p24/vscode/fix", async (req, res) => {
    try { res.json({ success: true, ...(await vsc.fix(req.body)) }); }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post("/p24/vscode/task", (req, res) => {
    try { res.json({ success: true, ...vsc.createTask(req.body.title) }); }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get("/p24/vscode/providers", (_req, res) => {
    res.json({
        success:   true,
        providers: [
            { id: "openrouter", label: "OpenRouter",  models: ["anthropic/claude-3-5-sonnet", "openai/gpt-4o", "meta-llama/llama-3.1-70b-instruct"] },
            { id: "claude",     label: "Anthropic",   models: ["claude-3-5-sonnet-20241022", "claude-3-opus-20240229"] },
            { id: "openai",     label: "OpenAI",      models: ["gpt-4o", "gpt-4o-mini", "o1-preview"] },
            { id: "ollama",     label: "Ollama (local)", models: ["llama3.2", "codellama", "deepseek-coder"] },
        ],
    });
});

// ── 24B Repo Intelligence ─────────────────────────────────────────────────────

router.post("/p24/repo/index", (req, res) => {
    try {
        const { workspacePath } = req.body;
        if (!workspacePath) return res.status(400).json({ success: false, error: "workspacePath required" });
        const result = rie.indexRepo(workspacePath);
        res.json({ success: true, ...result });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get("/p24/repo/status", (_req, res) => {
    try { res.json({ success: true, ...rie.getStatus() }); }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get("/p24/repo/symbol/:name", (req, res) => {
    try {
        const { repoPath } = req.query;
        res.json({ success: true, ...rie.findSymbol(req.params.name, repoPath) });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post("/p24/repo/search", (req, res) => {
    try {
        const { query, repoPath, limit, fileFilter, mode } = req.body;
        if (!query) return res.status(400).json({ success: false, error: "query required" });
        res.json({ success: true, ...rie.semanticSearch(query, repoPath, { limit, fileFilter, mode }) });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get("/p24/repo/deps", (req, res) => {
    try {
        const { file, repoPath } = req.query;
        if (!file) return res.status(400).json({ success: false, error: "file required" });
        res.json({ success: true, ...rie.getDependencies(file, repoPath) });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get("/p24/repo/xrefs/:symbol", (req, res) => {
    try {
        const { repoPath } = req.query;
        res.json({ success: true, ...rie.getCrossFileRefs(req.params.symbol, repoPath) });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── 24C Autonomous Refactor ───────────────────────────────────────────────────

router.post("/p24/refactor/plan", (req, res) => {
    try {
        const { repoPath } = req.body;
        if (!repoPath) return res.status(400).json({ success: false, error: "repoPath required" });
        res.json({ success: true, ...are.generateRefactorPlan(repoPath) });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post("/p24/refactor/detect/dup", (req, res) => {
    try {
        const { repoPath } = req.body;
        if (!repoPath) return res.status(400).json({ success: false, error: "repoPath required" });
        res.json({ success: true, ...are.detectDuplication(repoPath) });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post("/p24/refactor/detect/oversized", (req, res) => {
    try {
        const { repoPath } = req.body;
        if (!repoPath) return res.status(400).json({ success: false, error: "repoPath required" });
        res.json({ success: true, ...are.detectOversizedFiles(repoPath) });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post("/p24/refactor/detect/smells", (req, res) => {
    try {
        const { repoPath } = req.body;
        if (!repoPath) return res.status(400).json({ success: false, error: "repoPath required" });
        res.json({ success: true, ...are.detectArchSmells(repoPath) });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post("/p24/refactor/apply", (req, res) => {
    try {
        const { planId, stepIndex, dryRun } = req.body;
        if (planId === undefined || stepIndex === undefined)
            return res.status(400).json({ success: false, error: "planId and stepIndex required" });
        res.json({ success: true, ...are.applyRefactor(planId, stepIndex, { dryRun }) });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get("/p24/refactor/plans", (req, res) => {
    try { res.json({ success: true, plans: are.getPlans(req.query.repoPath) }); }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get("/p24/refactor/plans/:planId", (req, res) => {
    try {
        const plan = are.getPlan(req.params.planId);
        if (!plan) return res.status(404).json({ success: false, error: "Plan not found" });
        res.json({ success: true, plan });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get("/p24/refactor/applied", (_req, res) => {
    try { res.json({ success: true, applied: are.getAppliedRefactors() }); }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── 24D Multi-Repo ────────────────────────────────────────────────────────────

router.post("/p24/multirepo/repos", (req, res) => {
    try {
        const { repoId, localPath, ...meta } = req.body;
        if (!repoId || !localPath) return res.status(400).json({ success: false, error: "repoId and localPath required" });
        res.json({ success: true, repo: mre.registerRepo(repoId, localPath, meta) });
    } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.delete("/p24/multirepo/repos/:repoId", (req, res) => {
    try { res.json({ success: true, ...mre.unregisterRepo(req.params.repoId) }); }
    catch (e) { res.status(404).json({ success: false, error: e.message }); }
});

router.get("/p24/multirepo/repos/:repoId", (req, res) => {
    try { res.json({ success: true, repo: mre.getRepo(req.params.repoId) }); }
    catch (e) { res.status(404).json({ success: false, error: e.message }); }
});

router.get("/p24/multirepo/repos", (_req, res) => {
    try { res.json({ success: true, repos: mre.listRepos() }); }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post("/p24/multirepo/tasks", (req, res) => {
    try {
        const { title, repoIds, ...opts } = req.body;
        if (!title || !repoIds?.length) return res.status(400).json({ success: false, error: "title and repoIds required" });
        res.json({ success: true, task: mre.createSharedTask(title, repoIds, opts) });
    } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.patch("/p24/multirepo/tasks/:taskId", (req, res) => {
    try {
        const { repoId, status, note } = req.body;
        res.json({ success: true, task: mre.updateTaskStatus(req.params.taskId, repoId, status, note) });
    } catch (e) { res.status(404).json({ success: false, error: e.message }); }
});

router.get("/p24/multirepo/tasks/:taskId", (req, res) => {
    try { res.json({ success: true, task: mre.getTask(req.params.taskId) }); }
    catch (e) { res.status(404).json({ success: false, error: e.message }); }
});

router.get("/p24/multirepo/tasks", (req, res) => {
    try { res.json({ success: true, tasks: mre.listTasks(req.query.repoId) }); }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post("/p24/multirepo/deps", (req, res) => {
    try {
        const { fromRepoId, toRepoId, ...opts } = req.body;
        if (!fromRepoId || !toRepoId) return res.status(400).json({ success: false, error: "fromRepoId and toRepoId required" });
        res.json({ success: true, dep: mre.addDependency(fromRepoId, toRepoId, opts) });
    } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.delete("/p24/multirepo/deps/:depId", (req, res) => {
    try { res.json({ success: true, ...mre.removeDependency(req.params.depId) }); }
    catch (e) { res.status(404).json({ success: false, error: e.message }); }
});

router.get("/p24/multirepo/deps", (_req, res) => {
    try { res.json({ success: true, ...mre.getDependencyGraph() }); }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get("/p24/multirepo/deps/:repoId/dependents", (req, res) => {
    try { res.json({ success: true, dependents: mre.getDependents(req.params.repoId) }); }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post("/p24/multirepo/releases", (req, res) => {
    try {
        const { releaseId, repoIds, ...opts } = req.body;
        if (!releaseId || !repoIds?.length) return res.status(400).json({ success: false, error: "releaseId and repoIds required" });
        res.json({ success: true, release: mre.planRelease(releaseId, repoIds, opts) });
    } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.patch("/p24/multirepo/releases/:id", (req, res) => {
    try { res.json({ success: true, release: mre.updateRelease(req.params.id, req.body) }); }
    catch (e) { res.status(404).json({ success: false, error: e.message }); }
});

router.get("/p24/multirepo/releases/:id", (req, res) => {
    try { res.json({ success: true, release: mre.getRelease(req.params.id) }); }
    catch (e) { res.status(404).json({ success: false, error: e.message }); }
});

router.get("/p24/multirepo/releases", (_req, res) => {
    try { res.json({ success: true, releases: mre.listReleases() }); }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
