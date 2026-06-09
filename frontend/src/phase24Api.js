/**
 * Phase 24 API client — Repo Intelligence & Refactoring
 * /p24/vscode/*    — VSCodeExtensionService
 * /p24/repo/*      — RepoIntelligenceEngine
 * /p24/refactor/*  — AutonomousRefactorEngine
 * /p24/multirepo/* — MultiRepoEngineeringEngine
 * Also re-exports listReviews from phase23Api (code reviews live there).
 */
import { _fetch } from "./_client";
export { listReviews, getReview, reviewCode } from "./phase23Api";

// ── 24A VS Code Extension Service ─────────────────────────────────────
export async function vsCodeChat(message, context = {}) {
  return _fetch("/p24/vscode/chat", {
    method: "POST", body: JSON.stringify({ message, context }),
  });
}
export async function vsCodeExplain(code, language = "") {
  return _fetch("/p24/vscode/explain", {
    method: "POST", body: JSON.stringify({ code, language }),
  });
}
export async function vsCodeGenerate(prompt, context = {}) {
  return _fetch("/p24/vscode/generate", {
    method: "POST", body: JSON.stringify({ prompt, context }),
  });
}
export async function vsCodeRefactor(code, instruction, language = "") {
  return _fetch("/p24/vscode/refactor", {
    method: "POST", body: JSON.stringify({ code, instruction, language }),
  });
}

// ── 24B Repo Intelligence Engine ──────────────────────────────────────
export async function listIndexedRepos() {
  return _fetch("/p24/repo");
}
export async function indexRepo(repoPath, opts = {}) {
  return _fetch("/p24/repo/index", {
    method: "POST", body: JSON.stringify({ workspacePath: repoPath, ...opts }),
  });
}
export async function getRepoStatus(repoId) {
  return _fetch(`/p24/repo/${encodeURIComponent(repoId)}/status`);
}
export async function findSymbol(repoId, symbol, params = {}) {
  const q = new URLSearchParams({ symbol, ...params }).toString();
  return _fetch(`/p24/repo/${encodeURIComponent(repoId)}/symbol?${q}`);
}
export async function semanticSearch(repoId, query, params = {}) {
  const q = new URLSearchParams({ query, ...params }).toString();
  return _fetch(`/p24/repo/${encodeURIComponent(repoId)}/search?${q}`);
}
export async function getRepoDependencies(repoId, file) {
  const q = file ? `?file=${encodeURIComponent(file)}` : "";
  return _fetch(`/p24/repo/${encodeURIComponent(repoId)}/dependencies${q}`);
}

// ── 24C Autonomous Refactor Engine ────────────────────────────────────
export async function listRefactorPlans(params = {}) {
  const q = new URLSearchParams(params).toString();
  return _fetch(`/p24/refactor/plans${q ? "?" + q : ""}`);
}
export async function getRefactorPlan(planId) {
  return _fetch(`/p24/refactor/plans/${planId}`);
}
export async function detectDuplication(repoPath) {
  return _fetch("/p24/refactor/detect/dup", {
    method: "POST", body: JSON.stringify({ repoPath }),
  });
}
export async function detectOversizedFiles(repoPath) {
  return _fetch("/p24/refactor/detect/oversized", {
    method: "POST", body: JSON.stringify({ repoPath }),
  });
}
export async function detectArchSmells(repoPath) {
  return _fetch("/p24/refactor/detect/smells", {
    method: "POST", body: JSON.stringify({ repoPath }),
  });
}
export async function generateRefactorPlan(findings, opts = {}) {
  return _fetch("/p24/refactor/plan", {
    method: "POST", body: JSON.stringify({ findings, ...opts }),
  });
}
export async function applyRefactor(planId, opts = {}) {
  return _fetch(`/p24/refactor/plans/${planId}/apply`, {
    method: "POST", body: JSON.stringify(opts),
  });
}
export async function listAppliedRefactors(params = {}) {
  const q = new URLSearchParams(params).toString();
  return _fetch(`/p24/refactor/applied${q ? "?" + q : ""}`);
}

// ── 24D Multi-Repo Engineering Engine ─────────────────────────────────
export async function listMultiRepos() {
  return _fetch("/p24/multirepo/repos");
}
export async function registerMultiRepo(spec) {
  return _fetch("/p24/multirepo/repos", {
    method: "POST", body: JSON.stringify(spec),
  });
}
export async function unregisterMultiRepo(repoId) {
  return _fetch(`/p24/multirepo/repos/${encodeURIComponent(repoId)}`, { method: "DELETE" });
}
export async function getMultiRepoDependencyGraph() {
  return _fetch("/p24/multirepo/graph");
}
export async function listMultiRepoTasks(params = {}) {
  const q = new URLSearchParams(params).toString();
  return _fetch(`/p24/multirepo/tasks${q ? "?" + q : ""}`);
}
export async function createSharedTask(task) {
  return _fetch("/p24/multirepo/tasks", {
    method: "POST", body: JSON.stringify(task),
  });
}
export async function listMultiRepoReleases() {
  return _fetch("/p24/multirepo/releases");
}
export async function planRelease(spec) {
  return _fetch("/p24/multirepo/releases", {
    method: "POST", body: JSON.stringify(spec),
  });
}
