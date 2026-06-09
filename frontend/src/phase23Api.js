/**
 * Phase 23 API client — Engineering Automation
 * /p23/github/*    — GitHubEngineeringAgent
 * /p23/review/*    — CodeReviewEngine
 * /p23/release/*   — ReleaseEngine
 * /p23/autopilot/* — EngineeringAutopilot
 */
import { _fetch } from "./_client";

// ── 23A GitHub Engineering Agent ──────────────────────────────────────
export async function getGitHubActivity(params = {}) {
  const q = new URLSearchParams(params).toString();
  return _fetch(`/p23/github/activity${q ? "?" + q : ""}`);
}
export async function getGitHubStats() {
  return _fetch("/p23/github/stats");
}
export async function listRepoIssues(owner, repo, params = {}) {
  const q = new URLSearchParams(params).toString();
  return _fetch(`/p23/github/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues${q ? "?" + q : ""}`);
}
export async function analyzeRepoIssues(owner, repo) {
  return _fetch(`/p23/github/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/analyze`, {
    method: "POST",
  });
}
export async function getChangelog(owner, repo, params = {}) {
  const q = new URLSearchParams(params).toString();
  return _fetch(`/p23/github/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/changelog${q ? "?" + q : ""}`);
}
export async function createIssue(owner, repo, issue) {
  return _fetch(`/p23/github/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`, {
    method: "POST", body: JSON.stringify(issue),
  });
}
export async function createPR(owner, repo, pr) {
  return _fetch(`/p23/github/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`, {
    method: "POST", body: JSON.stringify(pr),
  });
}

// ── 23B Code Review Engine ────────────────────────────────────────────
export async function reviewCode(payload) {
  return _fetch("/p23/review", {
    method: "POST", body: JSON.stringify(payload),
  });
}
export async function listReviews(params = {}) {
  const q = new URLSearchParams(params).toString();
  return _fetch(`/p23/review${q ? "?" + q : ""}`);
}
export async function getReview(reviewId) {
  return _fetch(`/p23/review/${reviewId}`);
}
// ── 24 alias — code reviews are in p23 but DeveloperCopilotCenter imports from phase24Api ──

// ── 23C Release Engine ────────────────────────────────────────────────
export async function listReleases(params = {}) {
  const q = new URLSearchParams(params).toString();
  return _fetch(`/p23/release${q ? "?" + q : ""}`);
}
export async function getRelease(releaseId) {
  return _fetch(`/p23/release/${releaseId}`);
}
export async function createRelease(spec) {
  return _fetch("/p23/release", {
    method: "POST", body: JSON.stringify(spec),
  });
}

// ── 23D Engineering Autopilot ─────────────────────────────────────────
export async function listMissions(params = {}) {
  const q = new URLSearchParams(params).toString();
  return _fetch(`/p23/autopilot/missions${q ? "?" + q : ""}`);
}
export async function getMission(missionId) {
  return _fetch(`/p23/autopilot/missions/${missionId}`);
}
export async function runMission(goal, opts = {}) {
  return _fetch("/p23/autopilot/missions", {
    method: "POST", body: JSON.stringify({ goal, ...opts }),
  });
}
export async function cancelMission(missionId) {
  return _fetch(`/p23/autopilot/missions/${missionId}`, { method: "DELETE" });
}
export async function getAutopilotStats() {
  return _fetch("/p23/autopilot/stats");
}
export async function getExecutionChain(missionId) {
  return _fetch(`/p23/autopilot/missions/${missionId}/chain`);
}
