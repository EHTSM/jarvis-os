"use strict";
/**
 * Browser Memory — persistent memory for browser automation.
 *
 * Remembers: logins, selectors, successful flows, failed flows, cookies, patterns.
 *
 * Storage: data/browser-memory.json
 * Schema: {
 *   logins:     { [domain]: LoginRecord }
 *   selectors:  { [domain]: SelectorRecord[] }
 *   flows:      { [flowKey]: FlowRecord[] }
 *   cookies:    { [domain]: CookieEntry[] }
 *   patterns:   PatternRecord[]
 * }
 */

const fs   = require("fs");
const path = require("path");

const MEMORY_FILE = path.join(__dirname, "../../data/browser-memory.json");

function _load() {
  try { return JSON.parse(fs.readFileSync(MEMORY_FILE, "utf8")); }
  catch { return { logins: {}, selectors: {}, flows: {}, cookies: {}, patterns: [] }; }
}

function _save(d) {
  try {
    fs.mkdirSync(path.dirname(MEMORY_FILE), { recursive: true });
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(d, null, 2));
  } catch { /* non-fatal */ }
}

// ── Logins ────────────────────────────────────────────────────────

/**
 * Remember that a login succeeded (never store plaintext passwords).
 */
function rememberLogin(domain, opts = {}) {
  const mem = _load();
  mem.logins[domain] = {
    domain,
    username:     opts.username || null,
    usernameSelector: opts.usernameSelector || null,
    passwordSelector: opts.passwordSelector || null,
    submitSelector:   opts.submitSelector   || null,
    loginUrl:         opts.loginUrl         || null,
    successIndicator: opts.successIndicator || null,
    lastSuccess:  new Date().toISOString(),
    failCount:    0,
    notes:        opts.notes || "",
  };
  _save(mem);
}

function getLogin(domain) { return _load().logins[domain] || null; }
function getAllLogins()    { return Object.values(_load().logins); }

// ── Selectors ─────────────────────────────────────────────────────

/**
 * Remember a selector that worked for a given action on a domain.
 */
function rememberSelector(domain, selector, opts = {}) {
  const mem = _load();
  if (!mem.selectors[domain]) mem.selectors[domain] = [];
  const existing = mem.selectors[domain].find(s => s.selector === selector && s.action === opts.action);
  if (existing) {
    existing.successCount = (existing.successCount || 0) + 1;
    existing.lastSeen     = new Date().toISOString();
    if (opts.label) existing.label = opts.label;
  } else {
    mem.selectors[domain].push({
      selector,
      action:       opts.action  || "click",
      label:        opts.label   || "",
      successCount: 1,
      failCount:    0,
      lastSeen:     new Date().toISOString(),
    });
  }
  // Keep top 50 per domain
  mem.selectors[domain] = mem.selectors[domain].sort((a,b) => b.successCount - a.successCount).slice(0, 50);
  _save(mem);
}

function failSelector(domain, selector) {
  const mem = _load();
  const list = mem.selectors[domain];
  if (!list) return;
  const s = list.find(s => s.selector === selector);
  if (s) { s.failCount = (s.failCount || 0) + 1; _save(mem); }
}

function getSelectors(domain) { return (_load().selectors[domain] || []).slice(0, 20); }

// ── Flows ─────────────────────────────────────────────────────────

function rememberFlow(flowKey, steps, opts = {}) {
  const mem = _load();
  if (!mem.flows[flowKey]) mem.flows[flowKey] = [];
  mem.flows[flowKey].unshift({
    steps,
    success:    opts.success !== false,
    errorStep:  opts.errorStep  || null,
    errorMsg:   opts.errorMsg   || null,
    durationMs: opts.durationMs || null,
    ts:         new Date().toISOString(),
    tags:       opts.tags || [],
  });
  mem.flows[flowKey] = mem.flows[flowKey].slice(0, 20);
  _save(mem);
}

function getBestFlow(flowKey) {
  const flows = (_load().flows[flowKey] || []).filter(f => f.success);
  return flows[0] || null;
}

function getFlowHistory(flowKey, limit = 10) {
  return (_load().flows[flowKey] || []).slice(0, limit);
}

function listFlows() {
  const mem = _load();
  return Object.entries(mem.flows).map(([key, runs]) => ({
    key,
    successCount: runs.filter(r => r.success).length,
    failCount:    runs.filter(r => !r.success).length,
    lastRun:      runs[0]?.ts,
  }));
}

// ── Cookies ───────────────────────────────────────────────────────

function saveCookies(domain, cookies) {
  const mem = _load();
  mem.cookies[domain] = { cookies, savedAt: new Date().toISOString() };
  _save(mem);
}

function getCookies(domain) { return _load().cookies[domain] || null; }
function getAllCookieDomains() { return Object.keys(_load().cookies); }

// ── Patterns ──────────────────────────────────────────────────────

function rememberPattern(pattern) {
  const mem = _load();
  mem.patterns = mem.patterns || [];
  mem.patterns.unshift({ ...pattern, ts: new Date().toISOString() });
  mem.patterns = mem.patterns.slice(0, 200);
  _save(mem);
}

function getPatterns(opts = {}) {
  const mem = _load();
  let list  = mem.patterns || [];
  if (opts.domain) list = list.filter(p => p.domain === opts.domain);
  if (opts.success !== undefined) list = list.filter(p => p.success === opts.success);
  return list.slice(0, opts.limit || 50);
}

// ── Full snapshot ─────────────────────────────────────────────────

function getSnapshot() {
  const mem = _load();
  return {
    loginCount:    Object.keys(mem.logins || {}).length,
    selectorDomains: Object.keys(mem.selectors || {}).length,
    flowKeys:      Object.keys(mem.flows || {}).length,
    cookieDomains: Object.keys(mem.cookies || {}).length,
    patternCount:  (mem.patterns || []).length,
    logins:        Object.keys(mem.logins || {}),
    flows:         listFlows(),
    cookieDomains: Object.keys(mem.cookies || {}),
  };
}

module.exports = {
  rememberLogin, getLogin, getAllLogins,
  rememberSelector, failSelector, getSelectors,
  rememberFlow, getBestFlow, getFlowHistory, listFlows,
  saveCookies, getCookies, getAllCookieDomains,
  rememberPattern, getPatterns,
  getSnapshot,
};
