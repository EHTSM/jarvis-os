"use strict";
/**
 * browserRunner — executes browser automation workflows with full operator control.
 *
 * Reliability:
 *   - Per-step retry with exponential backoff
 *   - Hard timeout per workflow (default 5 min)
 *   - Page-alive check before first step; auto-relaunch if dead
 *   - Workflow-level cancellation via cancel token
 *
 * Operator control:
 *   - cancel(workflowId)     — cancel a running workflow between steps
 *   - emergencyStop()        — immediately cancel ALL running workflows
 *   - listRunning()          — see all active workflows
 *   - getWorkflowResult(id)  — retrieve completed workflow result
 *
 * Events emitted to runtimeEventBus:
 *   browser:workflow:start   { workflowId, label, steps }
 *   browser:step             { workflowId, stepIndex, totalSteps, action, label, status, attempt, result?, error? }
 *   browser:workflow:done    { workflowId, label, ok, steps, failedAt, currentUrl, currentTitle }
 *   browser:workflow:cancel  { workflowId, stoppedAt }
 *   browser:emergency:stop   { cancelled: string[] }
 *
 * Public API:
 *   run(steps, opts)             → workflow result
 *   runSingleAction(step, opts)  → single-step shorthand
 *   cancel(workflowId)           → cancel by id
 *   emergencyStop()              → cancel all
 *   listRunning()                → [{ workflowId, label, startedAt, steps }]
 *   getWorkflowResult(id)        → last result for id (cleared after 5 min)
 */

const session = require("./browserSession.cjs");
const engine  = require("./actionEngine.cjs");

let _bus = null;
function _getBus() {
  if (_bus) return _bus;
  try { _bus = require("../runtime/runtimeEventBus.cjs"); } catch { _bus = null; }
  return _bus;
}
function _emit(type, data) {
  const bus = _getBus();
  if (bus?.emit) bus.emit(type, { ...data, _source: "browser" });
}

// ── Running workflow registry ─────────────────────────────────────────────────
const _running = new Map();    // workflowId → { label, startedAt, steps, _cancel, stepIndex }
const _results = new Map();    // workflowId → result (kept 5 min then auto-cleared)
const RESULT_TTL_MS = 5 * 60_000;

const WORKFLOW_TIMEOUT_MS  = 5 * 60_000;   // 5 min hard cap per workflow
const STUCK_CHECK_INTERVAL = 30_000;        // warn after 30s on same step
const DEFAULT_RETRIES      = 1;
const RETRY_BASE_MS        = 600;

// ── Stuck-workflow watchdog ───────────────────────────────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of _running) {
    const elapsed    = now - entry.lastStepStarted;
    const stepLabel  = entry.currentStepLabel || "unknown";
    if (elapsed > STUCK_CHECK_INTERVAL) {
      _emit("browser:workflow:stuck", {
        workflowId:  id,
        label:       entry.label,
        stepIndex:   entry.stepIndex,
        stepLabel,
        elapsedSec:  Math.round(elapsed / 1000),
        message:     `Step "${stepLabel}" has been running for ${Math.round(elapsed/1000)}s`,
      });
    }
  }
}, STUCK_CHECK_INTERVAL).unref();  // .unref() so the interval doesn't keep the process alive

// ── Cancel token ─────────────────────────────────────────────────────────────
function _makeCancelToken() {
  let _cancelled = false;
  let _reason    = "";
  return {
    get cancelled() { return _cancelled; },
    get reason()    { return _reason;    },
    cancel(reason = "Cancelled by operator") { _cancelled = true; _reason = reason; },
  };
}

// ── run ───────────────────────────────────────────────────────────────────────
async function run(steps, opts = {}) {
  if (!Array.isArray(steps) || steps.length === 0) {
    return { ok: false, error: "No steps provided" };
  }
  if (steps.length > 50) {
    return { ok: false, error: "Maximum 50 steps per workflow" };
  }

  const {
    reusePageId          = null,
    headless             = true,
    takeScreenshotOnDone = false,
    takeScreenshotOnFail = true,
    stopOnFailure        = true,
    label                = "Browser workflow",
    workflowId           = `wf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    defaultRetries       = DEFAULT_RETRIES,
    timeoutMs            = WORKFLOW_TIMEOUT_MS,
  } = opts;

  const token = _makeCancelToken();
  const startedAt = new Date().toISOString();

  _running.set(workflowId, {
    workflowId, label, startedAt,
    steps:            steps.length,
    stepIndex:        0,
    currentStepLabel: "",
    lastStepStarted:  Date.now(),
    _cancel:          token,
  });
  _emit("browser:workflow:start", { workflowId, label, steps: steps.length, startedAt });

  // ── Hard workflow timeout ───────────────────────────────────────────────────
  const _timeoutHandle = setTimeout(() => {
    token.cancel(`Workflow timeout after ${timeoutMs / 1000}s`);
  }, timeoutMs);

  let pageId, page;

  try {
    // ── Page setup ────────────────────────────────────────────────────────────
    if (reusePageId) {
      const alive = await session.isPageAlive(reusePageId);
      if (!alive) {
        _running.delete(workflowId);
        clearTimeout(_timeoutHandle);
        return { ok: false, workflowId, error: `Page ${reusePageId} is stale or closed` };
      }
      page   = session.getPage(reusePageId);
      pageId = reusePageId;
    } else {
      const r = await session.newPage({ userAgent: opts.userAgent });
      if (!r.ok) {
        _running.delete(workflowId);
        clearTimeout(_timeoutHandle);
        return { ok: false, workflowId, error: r.error };
      }
      pageId = r.pageId;
      page   = r.page;
    }

    // ── Execute steps ─────────────────────────────────────────────────────────
    const stepResults = [];
    let   failed      = false;
    let   failedAt    = null;

    for (let i = 0; i < steps.length; i++) {
      if (token.cancelled) {
        _emit("browser:workflow:cancel", { workflowId, label, stoppedAt: i, reason: token.reason });
        _running.delete(workflowId);
        clearTimeout(_timeoutHandle);
        const result = _finalize({ ok: false, workflowId, pageId, page, label,
          steps: stepResults, failed: true, failedAt: i, cancelled: true,
          error: token.reason, screenshotOnFail: false });
        _storeResult(workflowId, result);
        return result;
      }

      // Update running registry with current step info for watchdog
      const entry = _running.get(workflowId);
      if (entry) {
        entry.stepIndex        = i;
        entry.currentStepLabel = steps[i].label || steps[i].action;
        entry.lastStepStarted  = Date.now();
      }

      let stepResult = await _runStep(page, steps[i], i, steps.length, {
        defaultRetries,
        workflowId,
        totalSteps: steps.length,
      });

      // ── Reload recovery ───────────────────────────────────────────────────
      // If a navigate or waitForElement fails with a timeout, try one page reload
      // before giving up — catches flaky page loads and redirect races.
      if (!stepResult.ok && _isReloadRecoverable(steps[i], stepResult)) {
        _emit("browser:step", {
          workflowId,
          stepIndex:   i,
          totalSteps:  steps.length,
          action:      steps[i].action,
          label:       steps[i].label || steps[i].action,
          status:      "recovering",
          message:     "Attempting reload recovery…",
        });
        const reloaded = await engine.reloadPage(page);
        if (reloaded.ok) {
          await _sleep(800);
          stepResult = await _runStep(page, steps[i], i, steps.length, {
            defaultRetries: 0,
            workflowId,
            totalSteps: steps.length,
          });
          if (stepResult.ok) stepResult = { ...stepResult, recoveredViaReload: true };
        }
      }

      stepResults.push(stepResult);

      if (!stepResult.ok) {
        failed   = true;
        failedAt = i;
        if (stopOnFailure) break;
      }
    }

    // ── Screenshot ────────────────────────────────────────────────────────────
    let screenshotData = null;
    if (!token.cancelled) {
      if ((takeScreenshotOnDone && !failed) || (takeScreenshotOnFail && failed)) {
        const ss = await engine.screenshot(page).catch(() => null);
        if (ss?.ok) screenshotData = ss.dataUrl;
      }
    }

    const currentUrl   = page.url();
    const currentTitle = await page.title().catch(() => "");
    const summary      = _buildSummary(steps, stepResults, label);

    _emit("browser:workflow:done", {
      workflowId, label,
      ok: !failed, steps: steps.length, failedAt,
      currentUrl, currentTitle,
    });

    clearTimeout(_timeoutHandle);
    _running.delete(workflowId);

    const result = {
      ok:             !failed,
      workflowId,
      pageId,
      currentUrl,
      currentTitle,
      steps:          stepResults,
      summary,
      screenshot:     screenshotData,
      failedAt,
      label,
      startedAt,
      completedAt:    new Date().toISOString(),
      _originalSteps: steps,   // kept for replay; stripped before JSON response
    };
    _storeResult(workflowId, result);
    return result;

  } catch (err) {
    clearTimeout(_timeoutHandle);
    _running.delete(workflowId);
    const result = { ok: false, workflowId, error: err.message, label };
    _storeResult(workflowId, result);
    return result;
  }
}

// ── Step execution with retry ─────────────────────────────────────────────────
async function _runStep(page, step, stepIndex, totalSteps, opts = {}) {
  const maxRetries   = step.retries ?? opts.defaultRetries ?? DEFAULT_RETRIES;
  const progressPct  = totalSteps > 0 ? Math.round((stepIndex / totalSteps) * 100) : 0;
  let   lastError    = null;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    _emit("browser:step", {
      workflowId:  opts.workflowId,
      stepIndex,   totalSteps,
      progressPct,
      action:      step.action,
      label:       step.label || step.action,
      status:      "running",
      attempt,
      maxRetries,
    });

    let result;
    try {
      result = await _dispatchAction(page, step);
    } catch (err) {
      result = { ok: false, action: step.action, error: err.message };
    }

    if (result.ok) {
      _emit("browser:step", {
        workflowId:  opts.workflowId,
        stepIndex,   totalSteps,
        progressPct: Math.round(((stepIndex + 1) / totalSteps) * 100),
        action:      step.action,
        label:       step.label || step.action,
        status:      "done",
        attempt,
        result,
      });
      return { ...result, attempts: attempt };
    }

    lastError = result.error;

    if (attempt <= maxRetries) {
      _emit("browser:step", {
        workflowId:  opts.workflowId,
        stepIndex,   totalSteps,
        progressPct,
        action:      step.action,
        label:       step.label || step.action,
        status:      "retrying",
        attempt,
        maxRetries,
        error:       lastError,
        hint:        _retryHint(lastError),
      });
      await _sleep(RETRY_BASE_MS * attempt);
    }
  }

  _emit("browser:step", {
    workflowId:  opts.workflowId,
    stepIndex,   totalSteps,
    progressPct,
    action:      step.action,
    label:       step.label || step.action,
    status:      "failed",
    error:       lastError,
    explanation: _explainFailure(step.action, lastError),
  });

  return { ok: false, action: step.action, error: lastError, attempts: maxRetries + 1 };
}

// ── Action dispatcher ─────────────────────────────────────────────────────────
async function _dispatchAction(page, step) {
  const { action, selector, url, text, value, key, script, pixels, waitUntil, fullPage, timeout, attr } = step;
  const opts = { timeout, waitUntil, fullPage };

  switch (action) {
    case "navigate":          return engine.navigate(page, url, opts);
    case "reload":
    case "reloadPage":        return engine.reloadPage(page, opts);
    case "waitForContent":    return engine.waitForContent(page, opts);
    case "click":             return engine.click(page, selector, opts);
    case "type":
    case "typeText":          return engine.typeText(page, selector, text, opts);
    case "fill":
    case "fillForm":          return engine.fillForm(page, selector, text ?? value, opts);
    case "waitForElement":    return engine.waitForElement(page, selector, opts);
    case "screenshot":        return engine.screenshot(page, opts);
    case "getText":           return engine.getText(page, selector);
    case "getTitle":          return engine.getTitle(page);
    case "getUrl":            return engine.getUrl(page);
    case "scrollDown":        return engine.scrollDown(page, pixels ?? 500);
    case "pressKey":          return engine.pressKey(page, key ?? "Enter");
    case "selectOption":      return engine.selectOption(page, selector, value, opts);
    case "waitForNavigation": return engine.waitForNavigation(page, opts);
    case "evaluate":          return engine.evaluate(page, script, opts);
    case "hover":
    case "hoverElement":      return engine.hoverElement(page, selector, opts);
    case "getAttribute":      return engine.getAttribute(page, selector, attr);
    case "checkElement":      return engine.checkElement(page, selector);
    case "checkCaptcha":      return engine.checkCaptcha(page);
    case "dismissModals":     return engine.dismissModals(page, opts);
    case "wait":
    case "sleep": {
      await _sleep(Math.min(step.ms ?? 1000, 30_000));
      return { ok: true, action: "wait", ms: step.ms ?? 1000, ts: new Date().toISOString() };
    }
    default:
      return { ok: false, action, error: `Unknown action: ${action}` };
  }
}

// ── Operator control ──────────────────────────────────────────────────────────
function cancel(workflowId, reason = "Cancelled by operator") {
  const entry = _running.get(workflowId);
  if (!entry) return { ok: false, error: "Workflow not found or already complete" };
  entry._cancel.cancel(reason);
  return { ok: true, workflowId, reason };
}

function emergencyStop(reason = "Emergency stop") {
  const cancelled = [];
  for (const [id, entry] of _running) {
    entry._cancel.cancel(reason);
    cancelled.push(id);
  }
  _emit("browser:emergency:stop", { cancelled, reason });
  return { ok: true, cancelled, count: cancelled.length };
}

function listRunning() {
  return Array.from(_running.values()).map(e => ({
    workflowId: e.workflowId,
    label:      e.label,
    startedAt:  e.startedAt,
    steps:      e.steps,
  }));
}

function getWorkflowResult(workflowId) {
  return _results.get(workflowId) ?? null;
}

// ── Result storage ─────────────────────────────────────────────────────────────
function _storeResult(workflowId, result) {
  _results.set(workflowId, result);
  setTimeout(() => _results.delete(workflowId), RESULT_TTL_MS);
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function _finalize({ ok, workflowId, pageId, page, label, steps, failed, failedAt, cancelled, error, screenshotOnFail }) {
  return {
    ok,
    workflowId,
    pageId,
    currentUrl:   page ? page.url() : "",
    steps,
    summary:      _buildSummary([], steps, label),
    failedAt,
    cancelled:    !!cancelled,
    error,
    label,
    completedAt:  new Date().toISOString(),
  };
}

function _buildSummary(steps, results, label) {
  const done    = results.filter(r => r.ok).length;
  const total   = results.length;
  const failed  = results.filter(r => !r.ok);
  const lines   = [`${label} — ${done}/${total} steps completed`];

  if (failed.length === 0) {
    lines.push("All steps completed successfully.");
  } else {
    const first = failed[0];
    lines.push(`Stopped at: [${first.action}] — ${first.error || "unknown error"}`);
    const explanation = _explainFailure(first.action, first.error);
    if (explanation) lines.push(`Why: ${explanation}`);
  }
  return lines.join("\n");
}

// ── Failure explanation system ────────────────────────────────────────────────
function _explainFailure(action, error = "") {
  const e = error.toLowerCase();

  if (e.includes("timeout") || e.includes("exceeded")) {
    if (action === "navigate") return "Page took too long to load — the site may be slow or unreachable.";
    if (action === "waitForElement") return "Element did not appear within the timeout — it may not exist on this page, or the page may still be loading.";
    if (action === "waitForNavigation") return "No navigation occurred — the form submit or click may not have caused a page change.";
    return "Step timed out — the page or element took longer than expected to respond.";
  }

  if (e.includes("could not find") || e.includes("element not found") || e.includes("not found")) {
    if (action === "click")    return "The button or link could not be located — the selector may be outdated or the element may be hidden.";
    if (action === "fillForm") return "The input field was not found — check the selector or try a different field identifier.";
    if (action === "getText")  return "The target element was not found on the page.";
    return "Element not found — the page structure may have changed.";
  }

  if (e.includes("stale") || e.includes("detached")) {
    return "Element disappeared mid-interaction — the page may have re-rendered during automation.";
  }

  if (e.includes("net::err") || e.includes("failed to load")) {
    return "Network error — could not reach the URL. Check that the site is online and accessible.";
  }

  if (e.includes("captcha") || e.includes("robot") || e.includes("unusual traffic")) {
    return "CAPTCHA / bot detection triggered — this site is blocking automated access.";
  }

  if (e.includes("unsafe pattern")) {
    return "The evaluate script was rejected for safety reasons — it contained patterns that could escape the browser context.";
  }

  return null;
}

// ── Retry hint system ─────────────────────────────────────────────────────────
function _retryHint(error = "") {
  const e = error.toLowerCase();
  if (e.includes("timeout"))  return "Retrying with the same timeout — element may still be loading.";
  if (e.includes("stale"))    return "Element was stale — re-querying the selector.";
  if (e.includes("not found")) return "Element not yet visible — retrying after brief wait.";
  return "Retrying step.";
}

function _sleep(ms) {
  return new Promise(r => setTimeout(r, Math.min(ms, 30_000)));
}

// ── Reload recovery heuristic ──────────────────────────────────────────────────
// Returns true if a failed step is a good candidate for reload-recovery:
// navigate or waitForElement that timed out (not a selector logic error).
function _isReloadRecoverable(step, result) {
  if (!result || result.ok) return false;
  const action = step.action || "";
  const error  = (result.error || "").toLowerCase();
  const isTimedOut   = error.includes("timeout") || error.includes("exceeded");
  const isNetworkErr = error.includes("net::err") || error.includes("failed to load");
  const isRecoverableAction = ["navigate", "waitForElement", "waitForContent"].includes(action);
  return isRecoverableAction && (isTimedOut || isNetworkErr);
}

// ── runSingleAction ───────────────────────────────────────────────────────────
async function runSingleAction(step, opts = {}) {
  return run([step], { stopOnFailure: true, takeScreenshotOnDone: false, ...opts });
}

module.exports = {
  run, runSingleAction,
  cancel, emergencyStop,
  listRunning, getWorkflowResult,
};
