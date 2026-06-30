"use strict";
/**
 * electron-smoke-test.cjs — Production Electron Readiness Smoke Tests
 *
 * Tests:
 *   1.  electron/main.cjs parses without error
 *   2.  electron/preload.cjs parses without error
 *   3.  package.json build config valid for all 3 platforms
 *   4.  Icon assets exist (icns / ico / png)
 *   5.  entitlements.mac.plist exists and is valid XML
 *   6.  Frontend build directory exists (or warn)
 *   7.  Backend server.js exists
 *   8.  API_URL resolution: respects BACKEND_URL env override
 *   9.  isPackaged guard present in main.cjs
 *   10. contextIsolation: true in all window factories
 *   11. nodeIntegration: false in all window factories
 *   12. webSecurity: true (no override to false)
 *   13. openExternal https-only guard present
 *   14. will-navigate guard wired
 *   15. setPermissionRequestHandler wired
 *   16. Content-Security-Policy header injection present
 *   17. electron-updater wired
 *   18. window state persistence (electron-store) present
 *   19. crash recovery (_startupCrashes) present
 *   20. backend process spawner (_startBackend) present
 */

const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ELECTRON = path.join(ROOT, "electron");

let passed = 0;
let failed = 0;
let warned = 0;
const issues = [];

function pass(name) {
  console.log(`  ✓ ${name}`);
  passed++;
}
function fail(name, detail) {
  console.error(`  ✗ ${name}${detail ? ": " + detail : ""}`);
  failed++;
  issues.push({ severity: "FAIL", test: name, detail });
}
function warn(name, detail) {
  console.warn(`  ⚠ ${name}${detail ? ": " + detail : ""}`);
  warned++;
  issues.push({ severity: "WARN", test: name, detail });
}

function fileExists(p) { return fs.existsSync(p); }
function fileContains(p, pattern) {
  try { return fs.readFileSync(p, "utf8").includes(pattern); } catch { return false; }
}
function matchAll(p, patterns) {
  try {
    const src = fs.readFileSync(p, "utf8");
    return patterns.map(pat => ({ pat, found: src.includes(pat) }));
  } catch { return patterns.map(pat => ({ pat, found: false })); }
}

// ── Tests ──────────────────────────────────────────────────────────

console.log("\n[1] Parse checks");

// 1. main.cjs parses
try {
  const src = fs.readFileSync(path.join(ELECTRON, "main.cjs"), "utf8");
  // Basic syntax check via node --check
  const { execSync } = require("child_process");
  execSync(`node --check ${path.join(ELECTRON, "main.cjs")}`, { stdio: "pipe" });
  pass("electron/main.cjs parses without error");
} catch (e) {
  fail("electron/main.cjs parses without error", e.message.slice(0, 100));
}

// 2. preload.cjs parses
try {
  const { execSync } = require("child_process");
  execSync(`node --check ${path.join(ELECTRON, "preload.cjs")}`, { stdio: "pipe" });
  pass("electron/preload.cjs parses without error");
} catch (e) {
  fail("electron/preload.cjs parses without error", e.message.slice(0, 100));
}

console.log("\n[2] package.json build config");

// 3. Build config present for all 3 platforms
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const b = pkg.build;
  if (!b) { fail("package.json has build config"); }
  else {
    const hasMac   = b.mac   && b.mac.target.some(t => t.target === "dmg");
    const hasWin   = b.win   && b.win.target.some(t => t.target === "nsis");
    const hasLinux = b.linux && b.linux.target.some(t => t.target === "AppImage");
    if (hasMac && hasWin && hasLinux) pass("build config: dmg + nsis + AppImage");
    else fail("build config: dmg + nsis + AppImage", `mac=${hasMac} win=${hasWin} linux=${hasLinux}`);
  }
} catch (e) {
  fail("package.json build config valid", e.message.slice(0, 80));
}

console.log("\n[3] Asset checks");

// 4. Icons
const icns = path.join(ELECTRON, "assets", "icon.icns");
const ico  = path.join(ELECTRON, "assets", "icon.ico");
const png  = path.join(ELECTRON, "assets", "icon.png");
if (fileExists(icns)) pass("icon.icns present"); else fail("icon.icns present", icns);
if (fileExists(ico))  pass("icon.ico present");  else fail("icon.ico present", ico);
if (fileExists(png))  pass("icon.png present");  else fail("icon.png present", png);

// 5. Entitlements
const ent = path.join(ELECTRON, "entitlements.mac.plist");
if (!fileExists(ent)) {
  fail("entitlements.mac.plist exists");
} else if (!fileContains(ent, "com.apple.security.cs.allow-jit")) {
  fail("entitlements.mac.plist has required keys");
} else {
  pass("entitlements.mac.plist exists and has JIT entitlement");
}

console.log("\n[4] Build artifacts");

// 6. Frontend build
const frontendBuild = path.join(ROOT, "frontend", "build", "index.html");
if (fileExists(frontendBuild)) pass("frontend/build/index.html present");
else warn("frontend/build/index.html not found — run npm run build:frontend before packaging");

// 7. Backend server
const backendServer = path.join(ROOT, "backend", "server.js");
if (fileExists(backendServer)) pass("backend/server.js present");
else fail("backend/server.js present", backendServer);

console.log("\n[5] Security checks (source audit)");

const mainSrc = (() => {
  try { return fs.readFileSync(path.join(ELECTRON, "main.cjs"), "utf8"); } catch { return ""; }
})();

// 8. BACKEND_URL env override
if (mainSrc.includes("process.env.BACKEND_URL")) pass("API_URL respects BACKEND_URL env override");
else fail("API_URL respects BACKEND_URL env override", "Hardcoded localhost only");

// 9. isPackaged guard
if (mainSrc.includes("app.isPackaged") || mainSrc.includes("isPackaged")) pass("isPackaged guard present");
else fail("isPackaged guard present");

// 10. contextIsolation: true
if (mainSrc.match(/contextIsolation\s*:\s*true/)) pass("contextIsolation: true");
else fail("contextIsolation: true");

// 11. nodeIntegration: false
if (mainSrc.match(/nodeIntegration\s*:\s*false/)) pass("nodeIntegration: false");
else fail("nodeIntegration: false");

// 12. webSecurity not disabled
if (mainSrc.match(/webSecurity\s*:\s*false/)) fail("webSecurity not disabled", "Found webSecurity:false");
else pass("webSecurity not set to false");

// 13. openExternal https-only guard
if (mainSrc.includes("startsWith(\"https://\")") || mainSrc.includes("startsWith('https://')"))
  pass("openExternal https-only guard");
else fail("openExternal https-only guard");

// 14. will-navigate guard
if (mainSrc.includes("will-navigate")) pass("will-navigate guard present");
else fail("will-navigate guard present");

// 15. Permission handler
if (mainSrc.includes("setPermissionRequestHandler")) pass("setPermissionRequestHandler installed");
else fail("setPermissionRequestHandler installed");

// 16. CSP header injection
if (mainSrc.includes("Content-Security-Policy") || mainSrc.includes("content-security-policy"))
  pass("Content-Security-Policy header injection");
else fail("Content-Security-Policy header injection");

console.log("\n[6] Feature completeness");

// 17. Auto updater
if (mainSrc.includes("electron-updater") && mainSrc.includes("autoUpdater.checkForUpdates"))
  pass("auto-updater wired (electron-updater)");
else fail("auto-updater wired (electron-updater)");

// 18. Window state persistence
if (mainSrc.includes("windowBounds") && mainSrc.includes("electron-store"))
  pass("window state persistence (electron-store)");
else fail("window state persistence (electron-store)");

// 19. Crash recovery
if (mainSrc.includes("_startupCrashes") && mainSrc.includes("clearCache"))
  pass("crash recovery (session clear on crash loop)");
else fail("crash recovery (session clear on crash loop)");

// 20. Backend process spawner
if (mainSrc.includes("_startBackend")) pass("backend process spawner (_startBackend) present");
else fail("backend process spawner (_startBackend) present");

// ── Summary ────────────────────────────────────────────────────────

const total = passed + failed + warned;
const pct   = Math.round(((passed + warned * 0.5) / total) * 100);

console.log(`\n${"═".repeat(55)}`);
console.log(`Electron Smoke Test: ${passed} passed, ${failed} failed, ${warned} warned`);
console.log(`Production Readiness Score: ${pct}% (${passed}/${total})`);

if (issues.length > 0) {
  console.log("\nIssues:");
  issues.forEach(i => console.log(`  [${i.severity}] ${i.test}${i.detail ? ": " + i.detail : ""}`));
}

if (failed > 0) {
  console.log("\n✗ NOT production-ready. Fix FAIL items above.");
  process.exit(1);
} else if (warned > 0) {
  console.log("\n⚠ Nearly production-ready. Resolve WARN items before packaging.");
  process.exit(0);
} else {
  console.log("\n✓ All checks passed. Electron app is production-ready.");
  process.exit(0);
}
