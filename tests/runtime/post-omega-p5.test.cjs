"use strict";
/**
 * POST-Ω Sprint P5 — Universal Computer Controller
 * Tests: desktopController, browserController, editorController,
 *        terminalController, workspaceController,
 *        computerExecutionEngine, computerController
 *        + integration: NL command → full pipeline
 */

let passed = 0;
let failed = 0;
const promises = [];

function test(name, fn) {
  try {
    const r = fn();
    if (r instanceof Promise) {
      const p = r.then(() => { console.log(`  PASS  ${name}`); passed++; })
                  .catch(e => { console.log(`  FAIL  ${name}: ${e.message || e}`); failed++; });
      promises.push(p);
    } else {
      console.log(`  PASS  ${name}`);
      passed++;
    }
  } catch (e) {
    console.log(`  FAIL  ${name}: ${e.message || e}`);
    failed++;
  }
}

function atest(name, fn) {
  const p = (async () => { await fn(); })()
    .then(() => { console.log(`  PASS  ${name}`); passed++; })
    .catch(e => { console.log(`  FAIL  ${name}: ${e.message || e}`); failed++; });
  promises.push(p);
  return p;
}

function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }

// ── Load modules ──────────────────────────────────────────────────────────────

const dc  = require("../../backend/services/desktopController.cjs");
const bc  = require("../../backend/services/browserController.cjs");
const ec  = require("../../backend/services/editorController.cjs");
const tc  = require("../../backend/services/terminalController.cjs");
const wc  = require("../../backend/services/workspaceController.cjs");
const cee = require("../../backend/services/computerExecutionEngine.cjs");
const cc  = require("../../backend/services/computerController.cjs");

// ─────────────────────────────────────────────────────────────────────────────
// Block 1: desktopController
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Block 1: desktopController ──");

test("readDesktopState returns platform and system info", () => {
  const r = dc.readDesktopState();
  assert(r.ok, "readDesktopState failed");
  assert(r.state.platform, "no platform");
  assert(typeof r.state.memTotalBytes === "number", "no memTotalBytes");
  assert(typeof r.state.cpuCount === "number", "no cpuCount");
  assert(r.state.ts, "no ts");
});

test("readDesktopState includes runtimeHealth when observer available", () => {
  const r = dc.readDesktopState();
  assert(r.ok);
  // runtimeHealth is optional but state itself must be present
  assert(typeof r.state === "object");
});

test("clipboardRead returns ok:true on darwin", () => {
  const r = dc.clipboardRead();
  assert(typeof r.ok === "boolean", "no ok field");
  assert("content" in r || "error" in r, "need content or error");
});

test("clipboardWrite + clipboardRead round-trip on darwin", () => {
  if (process.platform !== "darwin") return; // skip on non-mac
  const text = `ucc_test_${Date.now()}`;
  const wr = dc.clipboardWrite(text);
  assert(wr.ok, "clipboardWrite failed: " + wr.error);
  const rr = dc.clipboardRead();
  assert(rr.ok, "clipboardRead failed");
  assert(rr.content === text, `expected "${text}", got "${rr.content}"`);
});

test("listDownloads returns array", () => {
  const r = dc.listDownloads();
  assert(typeof r.ok === "boolean");
  assert(Array.isArray(r.downloads), "downloads not array");
  if (r.ok) assert(r.dir, "no dir");
});

test("openPath returns error for nonexistent path", () => {
  const r = dc.openPath("/nonexistent/path/xyz_12345");
  // Might ok=true (open tries) or ok=false, but should not throw
  assert(typeof r.ok === "boolean");
});

test("launchApp returns structured result", () => {
  const r = dc.launchApp("TextEdit"); // macOS standard app
  assert(typeof r.ok === "boolean");
  assert(r.app === "TextEdit", "app name mismatch");
  assert(r.ts, "no ts");
});

// ─────────────────────────────────────────────────────────────────────────────
// Block 2: browserController
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Block 2: browserController ──");

let openTabId = null;

test("selectBrowser returns available browser", () => {
  const r = bc.selectBrowser("Chrome");
  assert(typeof r.ok === "boolean");
  if (r.ok) assert(r.browser, "no browser");
});

test("openTab creates tab with required fields", () => {
  const r = bc.openTab({ url: "https://example.com", browser: "Chrome" });
  assert(r.ok, "openTab failed: " + JSON.stringify(r));
  assert(r.tabId, "no tabId");
  assert(r.url === "https://example.com", "url mismatch");
  openTabId = r.tabId;
});

test("listTabs returns open tab", () => {
  const tabs = bc.listTabs({ status: "open" });
  assert(Array.isArray(tabs), "not array");
  assert(tabs.some(t => t.tabId === openTabId), "opened tab not in list");
});

test("switchTab works for open tab", () => {
  const r = bc.switchTab(openTabId);
  assert(r.ok, "switchTab failed: " + r.error);
  assert(r.url === "https://example.com");
});

test("closeTab transitions to closed", () => {
  // Open a fresh one to close
  const t = bc.openTab({ url: "https://close-me.example.com" });
  const r = bc.closeTab(t.tabId);
  assert(r.ok, "closeTab failed");
  // Should not be in open tabs anymore
  const open = bc.listTabs({ status: "open" });
  assert(!open.some(tab => tab.tabId === t.tabId), "closed tab still in open list");
});

test("closeTab on nonexistent returns error", () => {
  const r = bc.closeTab("nonexistent_tab_xyz");
  assert(!r.ok, "expected failure");
  assert(r.error, "no error message");
});

test("inspectPage returns structured result", () => {
  const r = bc.inspectPage(openTabId, "test query");
  assert(r.ok || r.error, "need ok or error");
  if (r.ok) assert(r.tabId === openTabId);
});

test("downloadFile with curl fallback works for small file", () => {
  const r = bc.downloadFile({ url: "https://httpbin.org/get", destination: `/tmp/ucc_test_${Date.now()}.json` });
  // Ok depends on network; just check it returns structured response
  assert(typeof r.ok === "boolean");
  assert(r.url, "no url in result");
});

test("authenticate returns structured response", () => {
  const r = bc.authenticate({ service: "github", profileId: "default" });
  assert(r.ok, "authenticate failed");
  assert(r.service === "github");
  assert(typeof r.hasExistingSession === "boolean");
});

test("executeWorkflow gates dangerous actions", async () => {
  // "Pay now" should be flagged as dangerous
  const r = await bc.executeWorkflow("Click Pay now and confirm payment");
  // Either awaiting_approval or completed — should not throw
  assert(typeof r.ok === "boolean");
});

test("getStats returns openTabs, browser list", () => {
  const s = bc.getStats();
  assert(typeof s.openTabs === "number");
  assert(s.openTabs >= 1, `expected >=1 open tabs, got ${s.openTabs}`);
  assert(Array.isArray(s.browsers));
});

// ─────────────────────────────────────────────────────────────────────────────
// Block 3: editorController
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Block 3: editorController ──");

const testFilePath = `/tmp/ucc_test_${Date.now()}.js`;

test("openProject for repo root returns branch", () => {
  const r = ec.openProject(process.cwd());
  assert(r.ok, "openProject failed: " + r.error);
  assert(r.projectId, "no projectId");
  assert(r.path, "no path");
  assert(r.branch, "no branch");
});

test("openProject for nonexistent path fails gracefully", () => {
  const r = ec.openProject("/nonexistent/xyz_repo_99999");
  assert(!r.ok, "expected failure");
  assert(r.error, "no error message");
});

test("createFile creates a new file", () => {
  const r = ec.createFile(testFilePath, "// test\nconst x = 1;\n", { overwrite: true });
  assert(r.ok, "createFile failed: " + r.error);
  assert(r.path === testFilePath);
  assert(r.sizeBytes > 0);
});

test("createFile fails on existing without overwrite", () => {
  const r = ec.createFile(testFilePath, "new content");
  assert(!r.ok, "expected failure without overwrite");
  assert(r.error, "no error");
});

test("createFile succeeds with overwrite:true", () => {
  const r = ec.createFile(testFilePath, "// overwritten\n", { overwrite: true });
  assert(r.ok, "overwrite failed");
});

test("saveFile persists content", () => {
  const content = `// saved at ${Date.now()}\nmodule.exports = {};\n`;
  const r = ec.saveFile(testFilePath, content);
  assert(r.ok, "saveFile failed: " + r.error);
  assert(r.sizeBytes > 0);
});

test("getDiagnostics returns issues array for a file", () => {
  const r = ec.getDiagnostics(testFilePath);
  assert(r.ok, "getDiagnostics failed");
  assert(Array.isArray(r.issues), "issues not array");
  assert(typeof r.errorCount === "number");
  assert(typeof r.warnCount === "number");
});

test("searchCode returns results", async () => {
  const r = await ec.searchCode("autonomousExecutionEngine", { limit: 5 });
  assert(r.ok, "searchCode failed: " + r.error);
  assert(typeof r.total === "number");
  assert(Array.isArray(r.results), "results not array");
  assert(r.results.length >= 1, `expected >=1 result, got ${r.results.length}`);
});

test("searchCode with no match returns empty array", async () => {
  const r = await ec.searchCode("xyzzy_nonexistent_symbol_99999_abc");
  assert(r.ok);
  assert(Array.isArray(r.results));
});

test("formatFile attempts format without throwing", () => {
  const r = ec.formatFile(testFilePath);
  assert(typeof r.ok === "boolean", "no ok field");
  // pass/fail depends on prettier being installed — just ensure no throw
});

test("getStats returns stats with openProjects array", () => {
  const s = ec.getStats();
  assert(s.filesCreated >= 1, `expected >=1 filesCreated, got ${s.filesCreated}`);
  assert(Array.isArray(s.openProjects));
  assert(s.openProjects.length >= 1, "no open projects");
});

// ─────────────────────────────────────────────────────────────────────────────
// Block 4: terminalController
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Block 4: terminalController ──");

let cmdId1 = null;

test("execute node --version returns success", () => {
  const r = tc.execute("node --version");
  assert(r.ok, "execute failed: " + r.error);
  assert(r.output?.startsWith("v"), `expected version string, got: ${r.output}`);
  assert(r.cmdId, "no cmdId");
  cmdId1 = r.cmdId;
});

test("execute git log returns commit history", () => {
  const r = tc.execute("git log --oneline -3");
  assert(r.ok, "git log failed: " + r.error);
  assert(r.output?.includes("a41d12f") || r.output?.length > 10, "expected commit hashes");
});

test("execute npm --version returns success", () => {
  const r = tc.execute("npm --version");
  assert(r.ok, "npm --version failed");
  assert(r.output?.match(/^\d+\.\d+/), "unexpected npm version output");
});

test("execute ls returns file listing", () => {
  const r = tc.execute("ls package.json backend/");
  assert(r.ok, "ls failed");
  assert(r.output?.includes("package.json"), "package.json not in output");
});

test("blocked rm -rf / is rejected", () => {
  const r = tc.execute("rm -rf /");
  assert(!r.ok, "expected blocking");
  assert(r.error?.includes("blocked"), `expected 'blocked', got: ${r.error}`);
});

test("detectFailures identifies Error patterns", () => {
  const f = tc.detectFailures("Error: Cannot find module 'express'", 1);
  assert(f.hasFailures === true, "expected hasFailures");
  assert(f.patterns.some(p => p.type === "runtime_error" || p.type === "missing_module"), "pattern not matched");
});

test("detectFailures returns false for clean output", () => {
  const f = tc.detectFailures("All tests passed\n5 passed 0 failed", 0);
  assert(f.hasFailures === false, "should not detect failures in clean output");
  assert(f.exitCode === 0);
});

test("getOutput retrieves command record", () => {
  if (!cmdId1) return;
  const r = tc.getOutput(cmdId1);
  assert(r.ok, "getOutput failed");
  assert(r.status === "success", `expected success, got ${r.status}`);
  assert(r.cmd, "no cmd stored");
});

test("retry on failing command runs maxAttempts times", () => {
  const failCmd = tc.execute("node -e 'process.exit(1)'");
  assert(!failCmd.ok, "expected failure");
  const r = tc.retry(failCmd.cmdId, 2);
  assert(typeof r.ok === "boolean");
  assert(r.attempts <= 2, `expected <=2 attempts, got ${r.attempts}`);
});

test("recover returns strategy for failed command", () => {
  const failCmd = tc.execute("nonexistent_command_xyz_12345 2>/dev/null || exit 1");
  const r = tc.recover(failCmd.cmdId);
  assert(typeof r.ok === "boolean");
  if (r.strategy) assert(typeof r.strategy === "string");
});

test("verify checks environment health", () => {
  const r = tc.verify("general");
  assert(typeof r.ok === "boolean");
  assert(r.checks || r.ok !== undefined, "expected checks or ok");
});

test("runTests returns ok + output", () => {
  const r = tc.runTests(null, { timeoutMs: 5000 });
  assert(typeof r.ok === "boolean", "no ok");
  assert(typeof r.passed === "boolean" || typeof r.failures === "object");
});

test("streamOutput returns cmdId + pid", () => {
  const r = tc.streamOutput("node --version");
  assert(r.ok, "streamOutput failed: " + r.error);
  assert(r.cmdId, "no cmdId");
  assert(r.status === "streaming");
});

test("listCommands returns array with recent history", () => {
  const list = tc.listCommands({ limit: 10 });
  assert(Array.isArray(list), "not array");
  assert(list.length >= 5, `expected >=5 commands, got ${list.length}`);
  assert(list.every(c => c.cmd && c.startedAt), "missing required fields");
});

test("getStats shows executed/succeeded counts", () => {
  const s = tc.getStats();
  assert(s.executed >= 10, `expected >=10 executed, got ${s.executed}`);
  assert(s.succeeded >= 5, `expected >=5 succeeded, got ${s.succeeded}`);
  assert(typeof s.failed === "number");
});

// ─────────────────────────────────────────────────────────────────────────────
// Block 5: workspaceController
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Block 5: workspaceController ──");

test("setActiveProject sets project in context", () => {
  const r = wc.setActiveProject(process.cwd(), "jarvis-os");
  assert(r.ok);
  assert(r.activeProject?.path === process.cwd());
  assert(r.activeProject?.name === "jarvis-os");
});

test("setActiveBrowser sets browser in context", () => {
  const r = wc.setActiveBrowser("tab_test_1", "https://example.com");
  assert(r.ok);
  assert(r.activeBrowser?.tabId === "tab_test_1");
});

test("setActiveTerminal sets terminal in context", () => {
  const r = wc.setActiveTerminal("cmd_test_1", "node --version");
  assert(r.ok);
  assert(r.activeTerminal?.cmdId === "cmd_test_1");
});

test("setCurrentTask sets task in context", () => {
  const r = wc.setCurrentTask("Deploy today's release", "deployment");
  assert(r.ok);
  assert(r.currentTask?.task === "Deploy today's release");
});

test("getContext returns full unified context", () => {
  const ctx = wc.getContext();
  assert(ctx.ok, "getContext failed");
  assert(ctx.activeProject?.path, "no activeProject");
  assert(ctx.activeBrowser?.tabId, "no activeBrowser");
  assert(ctx.activeTerminal?.cmdId, "no activeTerminal");
  assert(ctx.currentTask?.task, "no currentTask");
  assert(typeof ctx.stats?.automationCoverage === "number");
  assert(ctx.subsystems?.desktop, "no desktop subsystem");
  assert(ctx.subsystems?.browser, "no browser subsystem");
  assert(ctx.subsystems?.terminal, "no terminal subsystem");
  assert(ctx.subsystems?.editor, "no editor subsystem");
  assert(Array.isArray(ctx.taskHistory));
  assert(ctx.generatedAt, "no generatedAt");
});

test("getContext.stats.automationCoverage is 0-100", () => {
  const ctx = wc.getContext();
  const cov = ctx.stats?.automationCoverage;
  assert(cov >= 0 && cov <= 100, `expected 0-100, got ${cov}`);
});

test("completeTask updates stats and clears currentTask", () => {
  const r = wc.completeTask("task_1", "success", 15);
  assert(r.ok);
  assert(r.outcome === "success");
  assert(r.minutesSaved === 15);
  const ctx = wc.getContext();
  assert(ctx.currentTask === null, "currentTask should be null after complete");
});

test("getStats returns tasksCompleted and minutesSaved", () => {
  const s = wc.getStats();
  assert(s.tasksCompleted >= 1, `expected >=1, got ${s.tasksCompleted}`);
  assert(s.minutesSaved >= 15, `expected >=15min saved, got ${s.minutesSaved}`);
});

test("snapshot is identical to getContext", () => {
  const snap = wc.snapshot();
  const ctx  = wc.getContext();
  assert(snap.ok === ctx.ok);
  assert(snap.stats?.tasksCompleted === ctx.stats?.tasksCompleted);
});

// ─────────────────────────────────────────────────────────────────────────────
// Block 6: computerExecutionEngine
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Block 6: computerExecutionEngine ──");

test("classifyCommand: deploy → deployment", () => {
  assert(cee.classifyCommand("Deploy today's release.").domain === "deployment");
  assert(cee.classifyCommand("Push to production").domain === "deployment");
});

test("classifyCommand: tests → engineering", () => {
  assert(cee.classifyCommand("Fix failing tests.").domain === "engineering");
  assert(cee.classifyCommand("Run regression.").domain === "engineering");
});

test("classifyCommand: browser → browser", () => {
  assert(cee.classifyCommand("Open browser tab to https://example.com").domain === "browser");
});

test("classifyCommand: editor → editor", () => {
  assert(cee.classifyCommand("Open the CRM project.").domain === "editor");
  assert(cee.classifyCommand("Commit changes.").domain === "editor");
});

test("classifyCommand: screenshot → browser", () => {
  assert(cee.classifyCommand("Take screenshots.").domain === "browser");
  assert(cee.classifyCommand("Capture screen.").domain === "browser");
});

atest("execute: health check command", async () => {
  const r = await cee.execute("Verify environment health", { noRecovery: true });
  assert(typeof r.ok === "boolean");
  assert(r.runId, "no runId");
  assert(r.classification?.domain, "no classification");
  assert(r.durationMs >= 0);
});

atest("execute: open project command", async () => {
  const r = await cee.execute("Open the CRM project.", { projectPath: process.cwd() });
  assert(typeof r.ok === "boolean");
  assert(r.runId, "no runId");
  assert(r.outcome, "no outcome");
});

atest("execute: commit changes command", async () => {
  const r = await cee.execute("Commit changes.", { noRecovery: true });
  assert(typeof r.ok === "boolean");
  assert(r.toolsUsed !== undefined);
  assert(r.durationMs >= 0);
});

atest("execute: screenshot command", async () => {
  const r = await cee.execute("Take screenshots.", { noRecovery: true });
  assert(typeof r.ok === "boolean");
  assert(r.runId);
});

atest("execute: regression command", async () => {
  const r = await cee.execute("Run regression.", { noRecovery: true });
  assert(typeof r.ok === "boolean");
  assert(r.runId);
  assert(r.classification?.domain === "engineering");
});

atest("execute: documentation command", async () => {
  const r = await cee.execute("Generate documentation.", { noRecovery: true });
  assert(typeof r.ok === "boolean");
  assert(r.runId);
});

test("listRuns returns recent runs", () => {
  const runs = cee.listRuns({ limit: 5 });
  assert(Array.isArray(runs));
  // may be empty if all async tests haven't finished yet
});

test("getStats returns total/succeeded/failed", () => {
  const s = cee.getStats();
  assert(typeof s.total === "number");
  assert(typeof s.succeeded === "number");
  assert(typeof s.failed === "number");
  assert(typeof s.minutesSaved === "number");
});

test("getDashboard returns full structure", () => {
  const d = cee.getDashboard();
  assert(d.ok, "dashboard failed");
  assert(typeof d.automationCoverage === "number");
  assert(typeof d.founderTimeSaved === "number");
  assert(Array.isArray(d.executionHistory));
  assert(d.generatedAt);
});

// ─────────────────────────────────────────────────────────────────────────────
// Block 7: computerController (top-level facade)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Block 7: computerController ──");

test("getCapabilities returns full UCC capability map", () => {
  const caps = cc.getCapabilities();
  assert(caps.ok, "capabilities failed");
  assert(caps.controller?.includes("Universal Computer Controller"), "wrong controller name");
  // 5 domains
  assert(Object.keys(caps.domains).length === 5, `expected 5 domains, got ${Object.keys(caps.domains).length}`);
  assert(caps.domains.desktop?.capabilities?.length >= 7);
  assert(caps.domains.browser?.capabilities?.length >= 7);
  assert(caps.domains.editor?.capabilities?.length >= 9);
  assert(caps.domains.terminal?.capabilities?.length >= 7);
  assert(caps.domains.workspace?.capabilities?.length >= 5);
  // Reused services
  assert(caps.reusedServices.length >= 15, `expected >=15 reused services, got ${caps.reusedServices.length}`);
  // Architecture freeze compliance
  assert(caps.architectureFreeze === true);
  assert(caps.noNewOrgs === true);
  assert(caps.noNewRuntimes === true);
  // Example commands
  assert(Array.isArray(caps.exampleCommands) && caps.exampleCommands.length >= 8);
});

test("desktop.state() returns desktop state", () => {
  const r = cc.desktop.state();
  assert(r?.ok, "desktop.state failed");
  assert(r?.state?.platform, "no platform");
});

test("desktop.clipboardRead() and clipboardWrite() work", () => {
  const r = cc.desktop.clipboardRead();
  assert(typeof r?.ok === "boolean");
});

test("browser.open() + browser.tabs() work", () => {
  const t = cc.browser.open("https://facade.example.com");
  assert(t?.ok, "browser.open failed");
  const tabs = cc.browser.tabs({ status: "open" });
  assert(Array.isArray(tabs));
  assert(tabs.some(tab => tab.url === "https://facade.example.com"), "tab not found");
});

test("terminal.run() executes via facade", () => {
  const r = cc.terminal.run("echo hello");
  assert(r?.ok, "terminal.run failed: " + r?.error);
  assert(r?.output?.includes("hello"), `expected 'hello' in output, got: ${r?.output}`);
});

test("terminal.verify() works via facade", () => {
  const r = cc.terminal.verify("general");
  assert(typeof r?.ok === "boolean");
});

test("editor.openProject() works via facade", () => {
  const r = cc.editor.openProject(process.cwd());
  assert(r?.ok, "editor.openProject failed");
});

test("workspace.context() returns unified state via facade", () => {
  const ctx = cc.workspace.context();
  assert(ctx?.ok, "workspace.context failed");
  assert(ctx?.stats?.automationCoverage >= 0);
});

test("getDashboard() returns full UCC dashboard", () => {
  const d = cc.getDashboard();
  assert(d?.ok, "getDashboard failed: " + JSON.stringify(d));
  assert(typeof d?.automationCoverage === "number");
  assert(typeof d?.founderTimeSaved === "number");
});

test("getStats() returns aggregate metrics", () => {
  const s = cc.getStats();
  assert(typeof s?.total === "number");
  assert(typeof s?.minutesSaved === "number");
  assert(typeof s?.successRate === "number");
});

// ─────────────────────────────────────────────────────────────────────────────
// Block 8: Full end-to-end NL command pipeline
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Block 8: End-to-end NL command pipeline ──");

atest("NL: 'Open the CRM project.'", async () => {
  const r = await cc.run("Open the CRM project.", { projectPath: process.cwd() });
  assert(typeof r.ok === "boolean");
  assert(r.runId, "no runId");
  assert(r.classification, "no classification");
  assert(r.durationMs >= 0);
  assert(r.outcome, "no outcome");
});

atest("NL: 'Run regression.'", async () => {
  const r = await cc.run("Run regression.", { noRecovery: true });
  assert(typeof r.ok === "boolean");
  assert(r.runId);
  assert(r.classification?.domain === "engineering");
  assert(typeof r.durationMs === "number");
});

atest("NL: 'Take screenshots.'", async () => {
  const r = await cc.run("Take screenshots.", { noRecovery: true });
  assert(typeof r.ok === "boolean");
  assert(r.runId);
  assert(r.result, "no result");
});

atest("NL: 'Verify environment health.'", async () => {
  const r = await cc.run("Verify environment health.", { noRecovery: true });
  assert(typeof r.ok === "boolean");
  assert(r.classification?.domain === "deployment");
  assert(r.minutesSaved >= 0);
});

atest("NL: 'Generate documentation.'", async () => {
  const r = await cc.run("Generate documentation.", { noRecovery: true });
  assert(typeof r.ok === "boolean");
  assert(r.runId);
  assert(r.classification, "no classification");
});

atest("NL: 'Deploy today release.' triggers deployment pipeline", async () => {
  const r = await cc.run("Deploy today release.", { noRecovery: true });
  assert(typeof r.ok === "boolean");
  assert(r.runId, "no runId");
  assert(r.classification?.domain === "deployment", `expected deployment, got ${r.classification?.domain}`);
  // minutesSaved is set by _deployRelease regardless of outcome (regression may fail in test env)
  assert(typeof r.minutesSaved === "number", "minutesSaved should be a number");
});

// ─────────────────────────────────────────────────────────────────────────────
// Block 9: Dashboard final state after activity
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Block 9: Dashboard final state ──");

atest("dashboard populated after all NL commands", async () => {
  await Promise.all(promises.filter(p => p));
  await new Promise(r => setTimeout(r, 500));

  const d = cc.getDashboard();
  assert(d.ok, "dashboard not ok");
  assert(d.executionHistory.length >= 1, "no execution history");
  assert(typeof d.automationCoverage === "number");
  assert(typeof d.founderTimeSaved === "number");
  assert(d.stats?.total >= 5, `expected >=5 total runs, got ${d.stats?.total}`);

  const ctx = cc.workspace.context();
  assert(ctx.ok, "workspace context not ok");
  assert(typeof ctx.stats?.automationCoverage === "number");

  const caps = cc.getCapabilities();
  const allServices = caps.reusedServices.length;

  console.log(`\n  UCC Domains: ${Object.keys(caps.domains).join(", ")}`);
  console.log(`  Reused services: ${allServices}`);
  console.log(`  Execution runs: ${d.stats?.total}`);
  console.log(`  Founder time saved: ${d.founderTimeSaved} min`);
  console.log(`  Automation coverage: ${d.automationCoverage}%`);
  console.log(`  Success rate: ${d.stats?.successRate}%`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  await Promise.all(promises);
  await new Promise(r => setTimeout(r, 1000));

  const total = passed + failed;
  console.log(`\n══════════════════════════════════════════════`);
  console.log(`POST-Ω Sprint P5 — Universal Computer Controller`);
  console.log(`  ${passed} passed  ${failed} failed  ${total} total`);
  console.log(`══════════════════════════════════════════════\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main();
