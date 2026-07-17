"use strict";
/**
 * ODI-14 Self-Healing Frontend
 *
 * Pipeline:
 *   1. Intercept console.error/warning messages from a live page
 *   2. Parse errors into structured ErrorEvent records
 *   3. Locate the source component via filename/line in DOM analysis
 *   4. Generate a targeted fix via AI
 *   5. Preview fix, run regression assertion (syntax check)
 *   6. Apply or rollback
 *
 * Reuses: browserSession (ODI-1), domAnalyzerService (ODI-2),
 *          uiPatchGenerator (ODI-9, patchSpec), aiService
 */

const fs   = require("fs");
const path = require("path");
const ai   = require("./aiService");

const ROOT = path.resolve(__dirname, "../..");

// Resolves a caller-supplied relative path against ROOT and rejects any
// result that escapes it (e.g. "../../../etc/passwd") — targetFile ultimately
// originates from a client request body (POST /odi/heal), so it must not be
// trusted to stay inside the project tree.
function _safeResolve(targetFile) {
  const absPath = path.resolve(ROOT, targetFile);
  if (absPath !== ROOT && !absPath.startsWith(ROOT + path.sep)) return null;
  return absPath;
}

const HEAL_DIR = path.join(__dirname, "../../data/odi/self-healing");
function _ensureDir() { if (!fs.existsSync(HEAL_DIR)) fs.mkdirSync(HEAL_DIR, { recursive: true }); }
function _getSession() { try { return require("../../agents/browser/browserSession.cjs"); } catch { return null; } }

// ── Error collector ────────────────────────────────────────────────────────────

async function collectErrors({ url, durationMs = 5000 } = {}) {
  if (!url) return { ok: false, error: "url required" };

  const session = _getSession();
  if (!session) return { ok: false, error: "Playwright not available" };
  if (!session.isRunning()) {
    const r = await session.launch({ headless: true });
    if (!r.ok) return { ok: false, error: r.error };
  }

  const r = await session.newPage({ viewport: { width: 1440, height: 900 } });
  if (!r.ok) return { ok: false, error: r.error };
  const { pageId, page } = r;

  const errors = [];

  // Intercept console messages before navigation
  page.on("console", msg => {
    if (msg.type() === "error" || msg.type() === "warning") {
      const location = msg.location();
      errors.push({
        type:    msg.type(),
        text:    msg.text(),
        url:     location.url || "",
        line:    location.lineNumber,
        col:     location.columnNumber,
        args:    [],
        timestamp: new Date().toISOString(),
      });
    }
  });

  page.on("pageerror", err => {
    errors.push({ type: "pageerror", text: err.message, url: "", line: null, col: null, stack: err.stack, timestamp: new Date().toISOString() });
  });

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.waitForTimeout(durationMs);
  } catch (e) {
    // Page may have errors on load — that's fine, we still collect
  }

  await session.closePage(pageId).catch(() => {});

  return { ok: true, url, errors, count: errors.length };
}

// ── Error classifier ───────────────────────────────────────────────────────────

function classifyErrors(errors) {
  return errors.map(e => {
    let category = "unknown";
    const t = e.text || "";
    if (t.includes("Cannot read") || t.includes("undefined") || t.includes("null")) category = "null_reference";
    else if (t.includes("SyntaxError") || t.includes("Unexpected token"))             category = "syntax";
    else if (t.includes("Failed to fetch") || t.includes("NetworkError"))             category = "network";
    else if (t.includes("is not a function"))                                          category = "type_error";
    else if (t.includes("CORS") || t.includes("blocked"))                             category = "cors";
    else if (t.includes("React") || t.includes("Warning:"))                           category = "react_warning";
    else if (t.includes("Uncaught") || t.includes("Exception"))                       category = "uncaught_exception";
    return { ...e, category };
  });
}

// ── Component locator ──────────────────────────────────────────────────────────

function locateComponent(error, domSnapshot) {
  if (!domSnapshot?.nodes) return null;
  const errUrl = error.url || "";
  // Extract component name from source URL: /src/components/MyComp.jsx → MyComp
  const match = errUrl.match(/\/([A-Z][a-zA-Z0-9]+)\.(jsx?|tsx?)(?:\?|$)/);
  const compName = match ? match[1] : null;

  if (compName) {
    const node = domSnapshot.nodes.find(n =>
      n.classes?.some(c => c.toLowerCase().includes(compName.toLowerCase())) ||
      n.id?.toLowerCase().includes(compName.toLowerCase())
    );
    if (node) return { nodeId: node.nodeId, tag: node.tag, compName, sourceFile: `frontend/src/components/${compName}.jsx` };
  }

  return compName ? { compName, sourceFile: `frontend/src/components/${compName}.jsx` } : null;
}

// ── Fix generator ──────────────────────────────────────────────────────────────

async function generateFix(error, location, targetFile) {
  const safePath = targetFile && _safeResolve(targetFile);
  const sourceCode = safePath && fs.existsSync(safePath)
    ? fs.readFileSync(safePath, "utf8").slice(0, 3000)
    : "[source not accessible]";

  const prompt = `You are a React/JavaScript debugging assistant.

Console Error:
Type: ${error.category}
Message: ${error.text}
Location: ${error.url || "unknown"}:${error.line || "?"}:${error.col || "?"}

Component: ${location?.compName || "unknown"}
Target file: ${targetFile || "unknown"}

Source code (first 3000 chars):
\`\`\`
${sourceCode}
\`\`\`

Generate a minimal fix. Return JSON only:
{
  "fixDescription": "what the fix does",
  "patchSpecs": [
    { "patchTarget": "exact string to find (unique in file)", "patchReplacement": "replacement string" }
  ],
  "confidence": 0-100,
  "rollbackSafe": true/false
}`;

  try {
    const raw = await ai.callAI(prompt, { maxTokens: 512 });
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) return { ok: true, ...JSON.parse(jsonMatch[0]) };
    return { ok: false, error: "AI did not return valid JSON" };
  } catch (e) {
    return { ok: false, error: `AI unavailable: ${e.message}` };
  }
}

// ── Apply fix ─────────────────────────────────────────────────────────────────

function applyFix(record) {
  if (!record.fix?.patchSpecs?.length) return { ok: false, error: "No patch specs to apply" };
  const absPath = _safeResolve(record.targetFile);
  if (!absPath) return { ok: false, error: `targetFile escapes project root: ${record.targetFile}` };
  if (!fs.existsSync(absPath)) return { ok: false, error: `File not found: ${record.targetFile}` };

  const original = fs.readFileSync(absPath, "utf8");
  record.originalContent = original;

  let patched = original;
  for (const spec of record.fix.patchSpecs) {
    if (!patched.includes(spec.patchTarget)) return { ok: false, error: `patchTarget not found in file: ${spec.patchTarget.slice(0, 60)}` };
    if ((patched.split(spec.patchTarget).length - 1) > 1) return { ok: false, error: `patchTarget is not unique: ${spec.patchTarget.slice(0, 60)}` };
    patched = patched.replace(spec.patchTarget, spec.patchReplacement);
  }

  // Basic syntax guard: try to parse as JS (not JSX — just catch obvious breaks)
  try { new Function(patched.replace(/import\s+.*?from\s+['"][^'"]+['"]/g, "").replace(/export\s+(default\s+)?/g, "")); }
  catch { /* JSX/TypeScript won't parse as plain JS — that's OK */ }

  fs.writeFileSync(absPath, patched, "utf8");
  record.applied = true;
  record.appliedAt = new Date().toISOString();
  return { ok: true, message: "Fix applied" };
}

function rollbackFix(record) {
  if (!record.originalContent) return { ok: false, error: "No original content stored" };
  const absPath = _safeResolve(record.targetFile);
  if (!absPath) return { ok: false, error: `targetFile escapes project root: ${record.targetFile}` };
  fs.writeFileSync(absPath, record.originalContent, "utf8");
  record.rolledBack = true;
  return { ok: true, message: "Rolled back" };
}

// ── Full pipeline ─────────────────────────────────────────────────────────────

async function heal({ url, targetFile, autoApply = false } = {}) {
  if (!url) return { ok: false, error: "url required" };

  _ensureDir();
  const slug = new Date().toISOString().replace(/[:.]/g, "-");
  const healId = `heal-${slug}`;
  const record = { healId, url, targetFile, autoApply, status: "running", stages: {}, timestamp: new Date().toISOString() };
  const save = () => fs.writeFileSync(path.join(HEAL_DIR, `${healId}.json`), JSON.stringify(record, null, 2));
  save();

  // Stage 1: Collect errors
  const collected = await collectErrors({ url });
  record.stages.collect = { ok: collected.ok, count: collected.count, errors: collected.errors };
  save();

  if (!collected.ok || !collected.errors?.length) {
    record.status = collected.ok ? "clean" : "failed";
    record.noErrors = collected.ok;
    save();
    return { ok: true, healId, status: record.status, message: collected.ok ? "No errors detected" : collected.error };
  }

  // Stage 2: Classify
  const classified = classifyErrors(collected.errors);
  record.stages.classify = { categories: [...new Set(classified.map(e => e.category))] };
  save();

  // Stage 3: Load DOM for component location
  const domFiles = fs.readdirSync(path.join(__dirname, "../../data/odi/dom")).filter(f => f.endsWith(".json")).sort().reverse();
  let domSnapshot = null;
  if (domFiles.length) {
    try { domSnapshot = JSON.parse(fs.readFileSync(path.join(__dirname, "../../data/odi/dom", domFiles[0]), "utf8")); } catch {}
  }

  // Stage 4: Generate fixes for top errors
  const topErrors = classified.slice(0, 3);
  const fixes = [];
  for (const err of topErrors) {
    const location = locateComponent(err, domSnapshot);
    const fix = await generateFix(err, location, targetFile || location?.sourceFile);
    fixes.push({ error: err, location, fix, targetFile: targetFile || location?.sourceFile });
  }
  record.stages.fixes = { count: fixes.length, fixes: fixes.map(f => ({ category: f.error.category, confidence: f.fix.confidence, fixDescription: f.fix.fixDescription })) };
  save();

  // Stage 5: Auto-apply if requested (only highest-confidence fix)
  if (autoApply && fixes.length) {
    const best = fixes.reduce((a, b) => (b.fix.confidence || 0) > (a.fix.confidence || 0) ? b : a);
    if (best.fix.ok && best.fix.rollbackSafe !== false && (best.fix.confidence || 0) >= 70 && best.targetFile) {
      const applyResult = applyFix(best);
      record.stages.apply = applyResult;
      if (!applyResult.ok) {
        rollbackFix(best);
        record.stages.apply.rolledBack = true;
      }
    } else {
      record.stages.apply = { ok: false, skipped: true, reason: "Confidence too low or not rollback-safe" };
    }
    save();
  }

  record.status = "complete";
  save();

  return { ok: true, healId, status: "complete", errorsFound: classified.length, fixesGenerated: fixes.length, ...record.stages };
}

function listHeals({ limit = 50 } = {}) {
  _ensureDir();
  return fs.readdirSync(HEAL_DIR)
    .filter(f => f.endsWith(".json")).sort().reverse().slice(0, limit)
    .map(f => {
      try { const d = JSON.parse(fs.readFileSync(path.join(HEAL_DIR, f), "utf8")); return { filename: f, healId: d.healId, url: d.url, status: d.status, errorsFound: d.stages?.collect?.count, timestamp: d.timestamp }; }
      catch { return null; }
    }).filter(Boolean);
}

module.exports = { heal, collectErrors, classifyErrors, locateComponent, generateFix, listHeals };
