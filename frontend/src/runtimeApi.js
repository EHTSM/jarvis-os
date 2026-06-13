import { _fetch, _getExecutionId, _trackExecution, _updateExecutionStatus, _recordExecutionError, _cleanupExecution, _logExecution, _isTransientError } from "./_client";

async function _executeWithRetry(action, maxRetries = 2) {
  const executionId = _getExecutionId();
  const dupCheck = _trackExecution(executionId, action.input || JSON.stringify(action).slice(0, 100));

  // Reject duplicate executions
  if (dupCheck.duplicate) {
    _logExecution({
      executionId,
      action: "dispatch",
      status: "failed",
      error: `Duplicate execution detected (${dupCheck.previousId})`
    });
    return { success: false, error: dupCheck.reason, previousId: dupCheck.previousId };
  }

  let lastError = null;
  let backoffTimer = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      _updateExecutionStatus(executionId, "running");
      const result = await action.exec(executionId, attempt);
      _updateExecutionStatus(executionId, "success");
      _cleanupExecution(executionId);
      _logExecution({
        executionId,
        action: action.name,
        status: "success",
        retryCount: attempt
      });
      return result;
    } catch (err) {
      lastError = err;
      _recordExecutionError(executionId, err);

      const isTransient = _isTransientError(err);
      if (!isTransient || attempt === maxRetries) {
        _updateExecutionStatus(executionId, err.name === "AbortError" ? "cancelled" : "failed");
        _logExecution({
          executionId,
          action: action.name,
          status: "failed",
          error: err.message,
          retryCount: attempt
        });
        break;
      }

      // Cancellable exponential backoff: 200ms → 400ms → 800ms, capped at 2s
      const delay = Math.min(200 * Math.pow(2, attempt), 2000) + Math.random() * 100;
      await new Promise(resolve => {
        backoffTimer = setTimeout(() => { backoffTimer = null; resolve(); }, delay);
      });
    }
  }

  if (backoffTimer) { clearTimeout(backoffTimer); backoffTimer = null; }
  _cleanupExecution(executionId);
  return { success: false, error: lastError?.message || "Execution failed" };
}

export async function emergencyStop(reason = "operator_initiated") {
  try { return await _fetch("/runtime/emergency/stop", { method: "POST", body: JSON.stringify({ reason }) }); }
  catch (err) { return { success: false, error: err.message }; }
}

export async function emergencyResume() {
  try { return await _fetch("/runtime/emergency/resume", { method: "POST", body: "{}" }); }
  catch (err) { return { success: false, error: err.message }; }
}

export async function getRuntimeStatus() {
  try { return await _fetch("/runtime/status"); }
  catch { return null; }
}

export async function getRuntimeHistory(n = 40) {
  try { return await _fetch(`/runtime/history?n=${n}`); }
  catch { return null; }
}

export async function getTasks() {
  try { return await _fetch("/tasks"); }
  catch { return null; }
}

export async function dispatchTask(input, timeoutMs = 30000) {
  try {
    return await _executeWithRetry({
      name: "dispatchTask",
      input,
      exec: async (executionId, attempt) => {
        // Let errors propagate so _executeWithRetry can apply transient-retry logic.
        // Only catch non-transient terminal errors to return structured response.
        return await _fetch("/runtime/dispatch", {
          method: "POST",
          body: JSON.stringify({ input, timeoutMs, executionId, attempt }),
          _executionId: executionId,
          _timeoutMs: timeoutMs
        });
      }
    }, 2);
  } catch (err) {
    _logExecution({
      executionId: "unknown",
      action: "dispatchTask",
      status: "failed",
      error: err.message
    });
    return { success: false, error: err.message };
  }
}

export async function queueTask(input, priority = 1) {
  try {
    return await _executeWithRetry({
      name: "queueTask",
      input,
      exec: async (executionId, attempt) => {
        return await _fetch("/runtime/queue", {
          method: "POST",
          body: JSON.stringify({ input, priority, executionId, attempt }),
          _executionId: executionId,
          _timeoutMs: 10000
        });
      }
    }, 1);
  } catch (err) {
    _logExecution({
      executionId: "unknown",
      action: "queueTask",
      status: "failed",
      error: err.message
    });
    return { success: false, error: err.message };
  }
}

export async function addTask(input, type = "auto") {
  try {
    return await _fetch("/tasks", {
      method: "POST",
      body: JSON.stringify({ input, type })
    });
  } catch (err) { return { success: false, error: err.message }; }
}

// ── Engineering pipeline APIs (Phase B2) ─────────────────────────────

export async function runPipeline(request, opts = {}) {
  try {
    return await _fetch("/runtime/pipeline/run", {
      method: "POST",
      body: JSON.stringify({ request, ...opts })
    });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function runProject(goal, opts = {}) {
  try {
    return await _fetch("/runtime/project/run", {
      method: "POST",
      body: JSON.stringify({ goal, opts })
    });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function generateBlueprint(idea, opts = {}) {
  try {
    return await _fetch("/runtime/blueprint/generate", {
      method: "POST",
      body: JSON.stringify({ idea, opts })
    });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function symbolSearch(name) {
  try {
    return await _fetch(`/runtime/symbol-search?name=${encodeURIComponent(name)}`);
  } catch (err) { return { success: false, error: err.message }; }
}

export async function listPatches(status) {
  try {
    const q = status ? `?status=${status}` : "";
    return await _fetch(`/runtime/patches${q}`);
  } catch (err) { return { success: false, error: err.message }; }
}

export async function getDLQ(limit = 20) {
  try {
    return await _fetch(`/runtime/dead-letter?limit=${limit}`);
  } catch (err) { return { success: false, error: err.message }; }
}

export async function recoverDLQ() {
  try {
    return await _fetch("/runtime/recover/dlq", { method: "POST" });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function removeDLQEntry(taskId) {
  try {
    return await _fetch(`/runtime/dead-letter/${encodeURIComponent(taskId)}`, { method: "DELETE" });
  } catch (err) { return { success: false, error: err.message }; }
}

// ── B4 Autonomous Engineering Loop APIs ──────────────────────────────

export async function runAutoPipeline(patchId, opts = {}) {
  try {
    return await _fetch(`/runtime/patches/${encodeURIComponent(patchId)}/auto-pipeline`, {
      method: "POST",
      body: JSON.stringify({ autoRollback: true, ...opts }),
    });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function learnFromPatch(patchId, outcome = {}) {
  try {
    return await _fetch(`/runtime/patches/${encodeURIComponent(patchId)}/learn`, {
      method: "POST",
      body: JSON.stringify(outcome),
    });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function getPatchLearningSummary() {
  try { return await _fetch("/runtime/patches/learning/summary"); }
  catch (err) { return { success: false, error: err.message }; }
}

export async function runIncidentAutoFix(incidentId, opts = {}) {
  try {
    return await _fetch(`/runtime/incidents/${encodeURIComponent(incidentId)}/auto-fix`, {
      method: "POST",
      body: JSON.stringify({ queueApproval: true, ...opts }),
    });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function getIncidentAutoFixStatus(incidentId) {
  try { return await _fetch(`/runtime/incidents/${encodeURIComponent(incidentId)}/auto-fix/status`); }
  catch (err) { return { success: false, error: err.message }; }
}

// ── B5 Intelligence / Learning → Recommendation APIs ─────────────────

export async function getSimilarFixes(q = "", limit = 10) {
  try { return await _fetch(`/runtime/intel/similar-fixes?q=${encodeURIComponent(q)}&limit=${limit}`); }
  catch (err) { return { success: false, error: err.message }; }
}

export async function getPatternRanking(type = "both") {
  try { return await _fetch(`/runtime/intel/pattern-ranking?type=${type}`); }
  catch (err) { return { success: false, error: err.message }; }
}

export async function recommendPatch(description = "", filePath = "", limit = 8) {
  try {
    return await _fetch("/runtime/intel/recommend-patch", {
      method: "POST",
      body: JSON.stringify({ description, filePath, limit }),
    });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function getIncidentKB(q = "", opts = {}) {
  try {
    const params = new URLSearchParams({ q, ...opts }).toString();
    return await _fetch(`/runtime/intel/incident-kb?${params}`);
  } catch (err) { return { success: false, error: err.message }; }
}

export async function engineeringSearch(q, scope = "all", limit = 20) {
  try { return await _fetch(`/runtime/intel/search?q=${encodeURIComponent(q)}&scope=${scope}&limit=${limit}`); }
  catch (err) { return { success: false, error: err.message }; }
}

export async function correlateExecution(executionId, input, limit = 10) {
  try {
    const qs = executionId
      ? `executionId=${encodeURIComponent(executionId)}`
      : `input=${encodeURIComponent(input || "")}`;
    return await _fetch(`/runtime/intel/correlate?${qs}&limit=${limit}`);
  } catch (err) { return { success: false, error: err.message }; }
}

export async function getIntelSummary() {
  try { return await _fetch("/runtime/intel/summary"); }
  catch (err) { return { success: false, error: err.message }; }
}

// ── B6 Prediction APIs ────────────────────────────────────────────────

export async function predictFailureRisk(request = "", filePath = "", pipelineName = "standard-deploy") {
  try {
    return await _fetch("/runtime/predict/failure-risk", {
      method: "POST",
      body: JSON.stringify({ request, filePath, pipelineName }),
    });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function predictDeployRisk(pipelineName = "standard-deploy", request = "", filePaths = []) {
  try {
    return await _fetch("/runtime/predict/deploy-risk", {
      method: "POST",
      body: JSON.stringify({ pipelineName, request, filePaths }),
    });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function getCrossProjectKnowledge(q = "", limit = 20) {
  try { return await _fetch(`/runtime/predict/cross-project?q=${encodeURIComponent(q)}&limit=${limit}`); }
  catch (err) { return { success: false, error: err.message }; }
}

export async function getPrePatchAdvice(filePath = "", description = "") {
  try {
    return await _fetch("/runtime/predict/pre-patch-advice", {
      method: "POST",
      body: JSON.stringify({ filePath, description }),
    });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function explainRisk(subject = "", subjectType = "patch", filePath = "", riskScore = null) {
  try {
    return await _fetch("/runtime/predict/explain", {
      method: "POST",
      body: JSON.stringify({ subject, subjectType, filePath, riskScore }),
    });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function getReadinessScore() {
  try { return await _fetch("/runtime/predict/readiness-score"); }
  catch (err) { return { success: false, error: err.message }; }
}

// ── B7 Guardrail APIs ─────────────────────────────────────────────────

export async function preDeployGuard(pipelineName = "standard-deploy", filePaths = [], request = "", threshold = 70, operatorOverride = false) {
  try {
    return await _fetch("/runtime/guard/pre-deploy", {
      method: "POST",
      body: JSON.stringify({ pipelineName, filePaths, request, threshold, operatorOverride }),
    });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function getPatchSafetyScore(patchId) {
  try { return await _fetch(`/runtime/guard/patch-safety/${encodeURIComponent(patchId)}`); }
  catch (err) { return { success: false, error: err.message }; }
}

export async function getPatchSafetyBatch(patchIds = []) {
  try {
    return await _fetch("/runtime/guard/patch-safety-batch", {
      method: "POST",
      body: JSON.stringify({ patchIds }),
    });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function checkIncidentPrevention(task = "", filePath = "") {
  try {
    return await _fetch("/runtime/guard/incident-check", {
      method: "POST",
      body: JSON.stringify({ task, filePath }),
    });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function checkRegression(filePath = "", description = "", patchId = "") {
  try {
    return await _fetch("/runtime/guard/regression-check", {
      method: "POST",
      body: JSON.stringify({ filePath, description, patchId }),
    });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function getGuardrailsDashboard() {
  try { return await _fetch("/runtime/guard/dashboard"); }
  catch (err) { return { success: false, error: err.message }; }
}

export async function preActionWarning(action = "apply", patchId = "", filePath = "", task = "", pipelineName = "standard-deploy") {
  try {
    return await _fetch("/runtime/guard/pre-action-warning", {
      method: "POST",
      body: JSON.stringify({ action, patchId, filePath, task, pipelineName }),
    });
  } catch (err) { return { success: false, error: err.message }; }
}

// ── B8 Recommendation & Approval APIs ────────────────────────────────

export async function getIncidentRecommendations(incidentId, limit = 3) {
  try {
    return await _fetch("/runtime/recommend/incident-fixes", {
      method: "POST",
      body: JSON.stringify({ incidentId, limit }),
    });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function getAllIncidentRecommendations() {
  try { return await _fetch("/runtime/recommend/all-incidents"); }
  catch (err) { return { success: false, error: err.message }; }
}

export async function getApprovalQueue() {
  try { return await _fetch("/runtime/approval-queue"); }
  catch (err) { return { success: false, error: err.message }; }
}

export async function decideApprovalItem(id, decision, queueType, recommendation = "", reason = "") {
  try {
    return await _fetch(`/runtime/approval-queue/${encodeURIComponent(id)}/decide`, {
      method: "POST",
      body: JSON.stringify({ decision, queueType, recommendation, reason }),
    });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function getAutomationCandidates() {
  try { return await _fetch("/runtime/recommend/automation-candidates"); }
  catch (err) { return { success: false, error: err.message }; }
}

export async function getDecisionLog(opts = {}) {
  try {
    const qs = new URLSearchParams(opts).toString();
    return await _fetch(`/runtime/decisions?${qs}`);
  } catch (err) { return { success: false, error: err.message }; }
}

export async function recordDecision(itemId, decision, queueType, recommendation = "", reason = "", outcome = "") {
  try {
    return await _fetch("/runtime/decisions", {
      method: "POST",
      body: JSON.stringify({ itemId, decision, queueType, recommendation, reason, outcome }),
    });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function getRecommendedDeploys() {
  try { return await _fetch("/runtime/recommend/deploys"); }
  catch (err) { return { success: false, error: err.message }; }
}

export async function getAutonomousReadiness() {
  try { return await _fetch("/runtime/recommend/autonomous-readiness"); }
  catch (err) { return { success: false, error: err.message }; }
}

// ── B9 Execution Center APIs ──────────────────────────────────────────

export async function getUnifiedQueue() {
  try { return await _fetch("/runtime/exec/unified-queue"); }
  catch (err) { return { success: false, error: err.message }; }
}

export async function executeItem(id, type = "patch_apply", opts = {}) {
  try {
    return await _fetch(`/runtime/exec/execute/${encodeURIComponent(id)}`, {
      method: "POST",
      body: JSON.stringify({ type, operatorId: "operator", ...opts }),
    });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function getExecAnalytics() {
  try { return await _fetch("/runtime/exec/analytics"); }
  catch (err) { return { success: false, error: err.message }; }
}

export async function getConfidenceCalibration() {
  try { return await _fetch("/runtime/exec/confidence-calibration"); }
  catch (err) { return { success: false, error: err.message }; }
}

export async function getRankedCandidates() {
  try { return await _fetch("/runtime/exec/ranked-candidates"); }
  catch (err) { return { success: false, error: err.message }; }
}

export async function getExecReadinessDashboard() {
  try { return await _fetch("/runtime/exec/readiness-dashboard"); }
  catch (err) { return { success: false, error: err.message }; }
}

// ── B10 Production Reliability APIs ──────────────────────────────────

export async function getExecSuccessDashboard() {
  try { return await _fetch("/runtime/reliability/exec-success"); }
  catch (err) { return { success: false, error: err.message }; }
}

export async function getAccuracyDashboard() {
  try { return await _fetch("/runtime/reliability/accuracy"); }
  catch (err) { return { success: false, error: err.message }; }
}

export async function getAutonomousScorecard() {
  try { return await _fetch("/runtime/reliability/scorecard"); }
  catch (err) { return { success: false, error: err.message }; }
}

export async function getReliabilityTrends() {
  try { return await _fetch("/runtime/reliability/trends"); }
  catch (err) { return { success: false, error: err.message }; }
}

export async function getOperatorTrustScore() {
  try { return await _fetch("/runtime/reliability/trust-score"); }
  catch (err) { return { success: false, error: err.message }; }
}

export async function getSystemHealthReport() {
  try { return await _fetch("/runtime/reliability/health-report"); }
  catch (err) { return { success: false, error: err.message }; }
}
