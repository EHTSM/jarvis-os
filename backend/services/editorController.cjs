"use strict";
/**
 * editorController.cjs — POST-Ω Sprint P5 UCC
 *
 * Editor/IDE control adapter. Provides uniform interface for:
 *   openProject / searchCode / createFile / modifyFile / formatFile
 *   getDiagnostics / saveFile / commitChanges
 *
 * Reuses:
 *   - vsCodeExtensionService  (AI chat, explain, refactor, fix, generate)
 *   - repositoryEditingEngine (planBundle, applyBundle, rollbackBundle)
 *   - largeContextCodeSearch  (search, findRelated)
 *   - engineeringMemoryEngine (remember, recall)
 *   - workspaceService        (workspace tracking)
 *
 * Does NOT re-implement CodeMirror, Monaco, VS Code integration, or git.
 */

const fs   = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT   = path.join(__dirname, "../..");
const DATA   = path.join(ROOT, "data", "editor-controller.json");

const _try  = fn => { try { return fn(); } catch { return null; } };
const _vsce = () => _try(() => require("./vsCodeExtensionService.cjs"));
const _ree  = () => _try(() => require("./repositoryEditingEngine.cjs"));
const _lcs  = () => _try(() => require("./largeContextCodeSearch.cjs"));
const _eme  = () => _try(() => require("./engineeringMemoryEngine.cjs"));
const _ws   = () => _try(() => require("./workspaceService.cjs"));
const _le   = () => _try(() => require("./continuousLearningEngine.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `ec_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`; }

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch { return { openProjects: {}, sessions: {}, history: [], stats: { filesCreated: 0, filesModified: 0, commits: 0, searches: 0 } }; }
}
function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

function _git(cmd, cwd = ROOT) {
  try { return { ok: true, out: execSync(`git ${cmd}`, { cwd, timeout: 10000, stdio: ["ignore","pipe","pipe"] }).toString().trim() }; }
  catch (e) { return { ok: false, out: "", error: e.message?.slice(0, 200) }; }
}

// ── openProject ───────────────────────────────────────────────────────────────

function openProject(projectPath = ROOT) {
  const abs = path.resolve(projectPath);
  const exists = fs.existsSync(abs);
  const d = _load();
  const projectId = `proj_${abs.replace(/[^a-z0-9]/gi, "_").slice(-30)}`;

  if (exists) {
    const pkgPath = path.join(abs, "package.json");
    const pkg = fs.existsSync(pkgPath) ? _try(() => JSON.parse(fs.readFileSync(pkgPath, "utf8"))) : {};
    const gitBranch = _git("rev-parse --abbrev-ref HEAD", abs);
    const gitStatus = _git("status --porcelain", abs);

    d.openProjects[projectId] = {
      projectId, path: abs, name: pkg?.name || path.basename(abs),
      branch: gitBranch.out || "unknown",
      dirty: gitStatus.ok && gitStatus.out.length > 0,
      openedAt: _ts(),
    };
    _save(d);

    // Register with workspaceService
    _ws()?.setActiveWorkspace?.(projectId);

    return { ok: true, projectId, path: abs, name: pkg?.name || path.basename(abs), branch: gitBranch.out || "unknown" };
  }

  return { ok: false, error: `Path not found: ${abs}` };
}

// ── searchCode ───────────────────────────────────────────────────────────────

async function searchCode(query, opts = {}) {
  if (!query) return { ok: false, error: "query required" };
  const lcs = _lcs();
  const d = _load();
  d.stats.searches++;
  d.history.push({ event: "search", query, ts: _ts() });
  if (d.history.length > 200) d.history = d.history.slice(-200);
  _save(d);

  if (lcs) {
    try {
      const results = await lcs.search?.(query, opts);
      return { ok: true, query, results: results?.results || [], total: results?.total || 0 };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // Fallback: grep
  const { execSync } = require("child_process");
  try {
    const out = execSync(
      `grep -rn "${query.replace(/"/g, '\\"')}" "${ROOT}/backend" "${ROOT}/src" 2>/dev/null | head -30`,
      { timeout: 10000, stdio: ["ignore","pipe","pipe"] }
    ).toString().trim();
    const lines = out.split("\n").filter(Boolean).map(l => {
      const [file, line, ...rest] = l.split(":");
      return { file, line: parseInt(line), match: rest.join(":").trim() };
    });
    return { ok: true, query, results: lines, total: lines.length, source: "grep_fallback" };
  } catch {
    return { ok: true, query, results: [], total: 0, source: "grep_fallback" };
  }
}

// ── createFile ───────────────────────────────────────────────────────────────

function createFile(filePath, content = "", opts = {}) {
  if (!filePath) return { ok: false, error: "filePath required" };
  const abs = path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath);
  const dir = path.dirname(abs);

  if (fs.existsSync(abs) && !opts.overwrite) {
    return { ok: false, error: `File already exists: ${abs} (pass overwrite:true to replace)` };
  }

  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
    const d = _load();
    d.stats.filesCreated++;
    d.history.push({ event: "create_file", path: abs, ts: _ts() });
    _save(d);
    return { ok: true, path: abs, sizeBytes: Buffer.byteLength(content) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── modifyFile ───────────────────────────────────────────────────────────────

async function modifyFile(filePath, instruction, opts = {}) {
  if (!filePath || !instruction) return { ok: false, error: "filePath and instruction required" };
  const abs = path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath);
  if (!fs.existsSync(abs)) return { ok: false, error: `File not found: ${abs}` };

  // Try VS Code Extension AI refactor first
  const vsce = _vsce();
  if (vsce) {
    try {
      const current = fs.readFileSync(abs, "utf8");
      const result = await vsce.refactor?.({
        code: current, instruction,
        provider: opts.provider || "claude",
        apiKey:   opts.apiKey,
      });
      if (result?.ok !== false) {
        const d = _load();
        d.stats.filesModified++;
        d.history.push({ event: "modify_file", path: abs, instruction: instruction.slice(0, 100), ts: _ts() });
        _save(d);
        return { ok: true, path: abs, instruction, result };
      }
    } catch {}
  }

  // Fallback: use repositoryEditingEngine bundle
  const ree = _ree();
  if (ree) {
    try {
      const bundle = await ree.planBundle?.({ description: instruction, files: [abs] });
      if (bundle?.bundleId) {
        const applied = await ree.applyBundle?.(bundle.bundleId);
        const d = _load();
        d.stats.filesModified++;
        _save(d);
        return { ok: true, path: abs, bundleId: bundle.bundleId, applied };
      }
    } catch {}
  }

  return { ok: false, error: "No editor service available to modify file" };
}

// ── formatFile ───────────────────────────────────────────────────────────────

function formatFile(filePath) {
  const abs = path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath);
  // Try prettier
  const { execSync } = require("child_process");
  const r1 = (() => {
    try { execSync(`npx prettier --write "${abs}" --ignore-unknown`, { cwd: ROOT, timeout: 15000, stdio: "ignore" }); return { ok: true }; }
    catch { return null; }
  })();
  if (r1?.ok) return { ok: true, path: abs, formatter: "prettier" };

  // Try eslint --fix
  const r2 = (() => {
    try { execSync(`npx eslint --fix "${abs}"`, { cwd: ROOT, timeout: 15000, stdio: "ignore" }); return { ok: true }; }
    catch { return null; }
  })();
  if (r2?.ok) return { ok: true, path: abs, formatter: "eslint" };

  return { ok: false, path: abs, error: "No formatter available (prettier/eslint)" };
}

// ── getDiagnostics ────────────────────────────────────────────────────────────

function getDiagnostics(filePath) {
  const abs = filePath ? (path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath)) : ROOT;
  const { execSync } = require("child_process");
  const issues = [];

  // eslint
  try {
    const out = execSync(`npx eslint "${abs}" --format json 2>/dev/null`, { cwd: ROOT, timeout: 20000, stdio: ["ignore","pipe","pipe"] }).toString();
    const parsed = JSON.parse(out);
    for (const f of parsed) {
      for (const m of f.messages) {
        issues.push({ file: f.filePath, line: m.line, col: m.column, severity: m.severity === 2 ? "error" : "warn", message: m.message, rule: m.ruleId });
      }
    }
  } catch {}

  return { ok: true, path: abs, issues, errorCount: issues.filter(i => i.severity === "error").length, warnCount: issues.filter(i => i.severity === "warn").length };
}

// ── saveFile ─────────────────────────────────────────────────────────────────

function saveFile(filePath, content) {
  const abs = path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath);
  try {
    fs.writeFileSync(abs, content, "utf8");
    const d = _load();
    d.history.push({ event: "save_file", path: abs, ts: _ts() });
    _save(d);
    return { ok: true, path: abs, sizeBytes: Buffer.byteLength(content) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── commitChanges ────────────────────────────────────────────────────────────

function commitChanges({ message, files = [], addAll = false } = {}) {
  if (!message) return { ok: false, error: "commit message required" };
  try {
    if (addAll) {
      execSync("git add -A", { cwd: ROOT, timeout: 10000, stdio: "ignore" });
    } else if (files.length > 0) {
      execSync(`git add ${files.map(f => `"${f}"`).join(" ")}`, { cwd: ROOT, timeout: 10000, stdio: "ignore" });
    }
    const result = execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd: ROOT, timeout: 15000, stdio: ["ignore","pipe","pipe"] }).toString().trim();
    const d = _load();
    d.stats.commits++;
    d.history.push({ event: "commit", message, ts: _ts() });
    _save(d);
    const commit = _git("rev-parse --short HEAD");
    _le()?.createLesson?.({ type: "git_commit", title: `Commit: ${message.slice(0, 60)}`, source: "editorController", confidence: 0.9, tags: ["git", "commit"] });
    return { ok: true, message, commit: commit.out, output: result };
  } catch (e) {
    return { ok: false, error: e.message?.slice(0, 300) };
  }
}

// ── AI operations (delegates to vsCodeExtensionService) ───────────────────────

async function aiExplain(code, opts = {}) {
  const vsce = _vsce();
  if (!vsce) return { ok: false, error: "vsCodeExtensionService unavailable" };
  return vsce.explain?.({ code, ...opts });
}

async function aiGenerate(instruction, opts = {}) {
  const vsce = _vsce();
  if (!vsce) return { ok: false, error: "vsCodeExtensionService unavailable" };
  return vsce.generate?.({ instruction, ...opts });
}

async function aiFix(code, error, opts = {}) {
  const vsce = _vsce();
  if (!vsce) return { ok: false, error: "vsCodeExtensionService unavailable" };
  return vsce.fix?.({ code, error, ...opts });
}

// ── stats ────────────────────────────────────────────────────────────────────

function getStats() {
  const d = _load();
  return {
    ...d.stats,
    openProjects: Object.values(d.openProjects),
    recentHistory: d.history.slice(-10),
  };
}

module.exports = {
  openProject, searchCode, createFile, modifyFile,
  formatFile, getDiagnostics, saveFile, commitChanges,
  aiExplain, aiGenerate, aiFix, getStats,
};
