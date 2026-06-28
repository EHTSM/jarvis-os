"use strict";
/**
 * computerController.cjs — POST-Ω Sprint P5 UCC
 *
 * Top-level facade for the Universal Computer Controller.
 * Single entry point for all UCC operations — routes to the appropriate
 * sub-controller or the computerExecutionEngine.
 *
 * Reuses all existing integrations. Does NOT implement any new runtime.
 *
 * API:
 *   run(command, opts)              — NL command → full pipeline
 *   desktop.*                       — desktopController facade
 *   browser.*                       — browserController facade
 *   editor.*                        — editorController facade
 *   terminal.*                      — terminalController facade
 *   workspace.*                     — workspaceController facade
 *   getDashboard()                  — full UCC dashboard
 *   getCapabilities()               — what the UCC can do
 */

const _try  = fn => { try { return fn(); } catch { return null; } };
const _cee  = () => _try(() => require("./computerExecutionEngine.cjs"));
const _dc   = () => _try(() => require("./desktopController.cjs"));
const _bc   = () => _try(() => require("./browserController.cjs"));
const _ec   = () => _try(() => require("./editorController.cjs"));
const _tc   = () => _try(() => require("./terminalController.cjs"));
const _wc   = () => _try(() => require("./workspaceController.cjs"));

// ── Main NL command entry point ───────────────────────────────────────────────

async function run(command, opts = {}) {
  const cee = _cee();
  if (!cee) return { ok: false, error: "computerExecutionEngine unavailable" };
  return cee.execute?.(command, opts);
}

// ── Desktop facade ────────────────────────────────────────────────────────────

const desktop = {
  launch:          (app, opts)  => _dc()?.launchApp?.(app, opts),
  focus:           (app)        => _dc()?.focusWindow?.(app),
  openPath:        (p)          => _dc()?.openPath?.(p),
  switchWorkspace: (dir)        => _dc()?.switchWorkspace?.(dir),
  state:           ()           => _dc()?.readDesktopState?.(),
  downloads:       ()           => _dc()?.listDownloads?.(),
  clipboardRead:   ()           => _dc()?.clipboardRead?.(),
  clipboardWrite:  (text)       => _dc()?.clipboardWrite?.(text),
  screenshot:      (opts)       => _dc()?.captureScreenshot?.(opts),
};

// ── Browser facade ────────────────────────────────────────────────────────────

const browser = {
  open:      (url, opts)        => _bc()?.openTab?.({ url, ...opts }),
  close:     (tabId)            => _bc()?.closeTab?.(tabId),
  switch:    (tabId)            => _bc()?.switchTab?.(tabId),
  tabs:      (opts)             => _bc()?.listTabs?.(opts),
  inspect:   (tabId, q)         => _bc()?.inspectPage?.(tabId, q),
  screenshot:(tabId, opts)      => _bc()?.captureScreenshot?.(tabId, opts),
  workflow:  (intent, opts)     => _bc()?.executeWorkflow?.(intent, opts),
  download:  (opts)             => _bc()?.downloadFile?.(opts),
  auth:      (opts)             => _bc()?.authenticate?.(opts),
  stats:     ()                 => _bc()?.getStats?.(),
};

// ── Editor facade ─────────────────────────────────────────────────────────────

const editor = {
  openProject:   (p)            => _ec()?.openProject?.(p),
  search:        (q, opts)      => _ec()?.searchCode?.(q, opts),
  createFile:    (p, c, opts)   => _ec()?.createFile?.(p, c, opts),
  modifyFile:    (p, inst, opts)=> _ec()?.modifyFile?.(p, inst, opts),
  format:        (p)            => _ec()?.formatFile?.(p),
  diagnostics:   (p)            => _ec()?.getDiagnostics?.(p),
  save:          (p, c)         => _ec()?.saveFile?.(p, c),
  commit:        (opts)         => _ec()?.commitChanges?.(opts),
  aiExplain:     (code, opts)   => _ec()?.aiExplain?.(code, opts),
  aiGenerate:    (inst, opts)   => _ec()?.aiGenerate?.(inst, opts),
  aiFix:         (code, err, opts) => _ec()?.aiFix?.(code, err, opts),
  stats:         ()             => _ec()?.getStats?.(),
};

// ── Terminal facade ───────────────────────────────────────────────────────────

const terminal = {
  run:       (cmd, opts)        => _tc()?.execute?.(cmd, opts),
  stream:    (cmd, opts)        => _tc()?.streamOutput?.(cmd, opts),
  output:    (cmdId)            => _tc()?.getOutput?.(cmdId),
  failures:  (out, code)        => _tc()?.detectFailures?.(out, code),
  retry:     (cmdId, n)         => _tc()?.retry?.(cmdId, n),
  recover:   (cmdId, opts)      => _tc()?.recover?.(cmdId, opts),
  verify:    (ctx)              => _tc()?.verify?.(ctx),
  test:      (file, opts)       => _tc()?.runTests?.(file, opts),
  stats:     ()                 => _tc()?.getStats?.(),
  list:      (opts)             => _tc()?.listCommands?.(opts),
};

// ── Workspace facade ──────────────────────────────────────────────────────────

const workspace = {
  setProject:   (p, n)          => _wc()?.setActiveProject?.(p, n),
  setBrowser:   (tabId, url)    => _wc()?.setActiveBrowser?.(tabId, url),
  setTerminal:  (cmdId, cmd)    => _wc()?.setActiveTerminal?.(cmdId, cmd),
  setTask:      (task, wf)      => _wc()?.setCurrentTask?.(task, wf),
  completeTask: (id, out, min)  => _wc()?.completeTask?.(id, out, min),
  context:      ()              => _wc()?.getContext?.(),
  snapshot:     ()              => _wc()?.snapshot?.(),
  reset:        ()              => _wc()?.reset?.(),
  stats:        ()              => _wc()?.getStats?.(),
};

// ── Dashboard ─────────────────────────────────────────────────────────────────

function getDashboard() {
  return _cee()?.getDashboard?.() || { ok: false, error: "computerExecutionEngine unavailable" };
}

// ── Capabilities ──────────────────────────────────────────────────────────────

function getCapabilities() {
  return {
    ok: true,
    controller: "Universal Computer Controller (UCC) v1",
    domains: {
      desktop: {
        description: "Desktop OS control",
        capabilities: ["launch_app","focus_window","open_path","switch_workspace","read_state","clipboard_read","clipboard_write","list_downloads","capture_screenshot"],
        platform:     process.platform,
      },
      browser: {
        description: "Multi-browser control",
        capabilities: ["open_tab","close_tab","switch_tab","inspect_page","capture_screenshot","execute_workflow","download_file","upload_file","authenticate"],
        browsers:     ["Chrome","Edge","Brave","Safari"],
      },
      editor: {
        description: "Code editor / IDE control",
        capabilities: ["open_project","search_code","create_file","modify_file","format","diagnostics","save","commit","ai_explain","ai_generate","ai_fix"],
        integrations: ["vsCodeExtensionService","repositoryEditingEngine","largeContextCodeSearch"],
      },
      terminal: {
        description: "Shell / terminal control",
        capabilities: ["execute","stream_output","detect_failures","retry","recover","verify","run_tests"],
        integrations: ["runtimeActionEngine","executionRecovery","deploymentValidator"],
      },
      workspace: {
        description: "Cross-domain workspace state",
        capabilities: ["track_active_project","track_active_browser","track_active_terminal","track_current_task","automation_coverage","founder_time_saved"],
      },
    },
    exampleCommands: [
      "Deploy today's release.",
      "Open the CRM project.",
      "Fix failing tests.",
      "Review UI.",
      "Take screenshots.",
      "Generate documentation.",
      "Run regression.",
      "Commit changes.",
    ],
    reusedServices: [
      "nlBrowser","browserRegistry","browserSessionManager","visualCaptureService",
      "vsCodeExtensionService","repositoryEditingEngine","largeContextCodeSearch",
      "runtimeActionEngine","executionRecovery","deploymentValidator",
      "autonomousEngineeringPlatform","executionEvidence","continuousLearningEngine",
      "engineeringMemoryEngine","approvalEngine","founderWorkRegistry","humanInTheLoop",
    ],
    architectureFreeze: true,
    noNewOrgs: true,
    noNewRuntimes: true,
  };
}

// ── Stats ─────────────────────────────────────────────────────────────────────

function getStats() {
  return _cee()?.getStats?.() || { ok: false };
}

function listRuns(opts) {
  return _cee()?.listRuns?.(opts) || [];
}

function getRun(runId) {
  return _cee()?.getRun?.(runId) || null;
}

module.exports = {
  run,
  desktop, browser, editor, terminal, workspace,
  getDashboard, getCapabilities, getStats, listRuns, getRun,
};
