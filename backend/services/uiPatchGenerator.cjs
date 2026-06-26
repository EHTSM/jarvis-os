"use strict";
/**
 * ODI-9 Auto Patch Generator
 *
 * Converts UI findings (from layout/a11y/screenshot analysis) into:
 *   1. Concrete CSS/HTML/JSX patch specs
 *   2. Git diff preview
 *   3. Preview metadata
 *   4. Apply mechanism (write to file + git add)
 *   5. Commit
 *
 * Uses existing repositoryEditingEngine pattern for patch representation.
 * Uses existing aiService.js for patch generation.
 * Uses child_process spawnSync (already used by repositoryEditingEngine).
 */

const fs   = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const PATCHES_DIR = path.join(__dirname, "../../data/odi/patches");
const ROOT        = path.resolve(__dirname, "../../");

function _ensureDir() {
  if (!fs.existsSync(PATCHES_DIR)) fs.mkdirSync(PATCHES_DIR, { recursive: true });
}

function _getAI() { return require("./aiService.js"); }

// ── Git helpers ───────────────────────────────────────────────────────────────

function _gitDiff(filePath) {
  const r = spawnSync("git", ["diff", "--no-color", filePath], { cwd: ROOT, encoding: "utf8" });
  return r.stdout || "";
}

function _gitAdd(filePath) {
  spawnSync("git", ["add", filePath], { cwd: ROOT, encoding: "utf8" });
}

function _gitCommit(message) {
  const r = spawnSync("git", ["commit", "-m", message, "--no-gpg-sign"], { cwd: ROOT, encoding: "utf8" });
  return { ok: r.status === 0, stdout: r.stdout, stderr: r.stderr };
}

function _gitStatus(filePath) {
  const r = spawnSync("git", ["status", "--short", filePath], { cwd: ROOT, encoding: "utf8" });
  return r.stdout.trim();
}

// ── Patch prompt builder ──────────────────────────────────────────────────────

function _buildPrompt(finding, fileContent, filePath) {
  return `You are a UI engineer. Generate a CSS/HTML/JSX patch for this finding.

FINDING:
  Type:       ${finding.type || finding.category}
  Severity:   ${finding.severity}
  Message:    ${finding.message}
  Location:   ${finding.location || finding.element || "unknown"}
  Suggestion: ${finding.suggestion || ""}

FILE: ${filePath}
\`\`\`
${fileContent.slice(0, 3000)}
\`\`\`

Return ONLY valid JSON:
{
  "patchSpecs": [
    {
      "patchTarget": "exact string from file to replace (must be unique and verbatim)",
      "patchReplacement": "replacement string",
      "explanation": "why this change fixes the finding"
    }
  ],
  "cssOnly": true|false,
  "confidence": 0.0-1.0
}

Rules:
- patchTarget must appear EXACTLY ONCE in the file
- Return empty patchSpecs if you cannot make a safe specific fix
- Never change logic, only visual/accessibility concerns
- Prefer adding CSS classes or style attributes over restructuring markup`;
}

// ── Apply patch specs to a file ───────────────────────────────────────────────

function _applySpecs(filePath, specs) {
  let content = fs.readFileSync(filePath, "utf8");
  const applied = [];
  for (const spec of specs) {
    if (!spec.patchTarget || !content.includes(spec.patchTarget)) {
      applied.push({ ...spec, applied: false, reason: "patchTarget not found in file" });
      continue;
    }
    const count = content.split(spec.patchTarget).length - 1;
    if (count > 1) {
      applied.push({ ...spec, applied: false, reason: `patchTarget appears ${count} times — not unique` });
      continue;
    }
    content = content.replace(spec.patchTarget, spec.patchReplacement);
    applied.push({ ...spec, applied: true });
  }
  fs.writeFileSync(filePath, content, "utf8");
  return applied;
}

// ── Rollback a file to original content ──────────────────────────────────────

function _rollback(filePath, originalContent) {
  fs.writeFileSync(filePath, originalContent, "utf8");
  _gitAdd(filePath);
}

// ── Main: generate patch for a single finding ─────────────────────────────────

async function generatePatch({ finding, targetFile } = {}) {
  if (!finding) return { ok: false, error: "finding required" };
  if (!targetFile) return { ok: false, error: "targetFile required" };

  const absPath = path.resolve(ROOT, targetFile);
  if (!fs.existsSync(absPath)) return { ok: false, error: `File not found: ${targetFile}` };

  const originalContent = fs.readFileSync(absPath, "utf8");
  const ai = _getAI();

  const prompt = _buildPrompt(finding, originalContent, targetFile);
  let raw, parsed;
  try {
    raw = await ai.callAI(prompt, { maxTokens: 1024 });
    const m = raw.match(/\{[\s\S]*\}/);
    parsed = m ? JSON.parse(m[0]) : { patchSpecs: [], confidence: 0 };
  } catch (e) {
    return { ok: false, error: `AI patch generation failed: ${e.message}` };
  }

  const specs = (parsed.patchSpecs || []).filter(s => s.patchTarget && s.patchReplacement);

  _ensureDir();
  const slug = new Date().toISOString().replace(/[:.]/g, "-");
  const patchId = `patch-${slug}`;
  const patchRecord = {
    patchId,
    finding,
    targetFile,
    specs,
    confidence: parsed.confidence || 0,
    cssOnly:    parsed.cssOnly ?? true,
    status:     "generated",
    timestamp:  new Date().toISOString(),
    originalContent,
  };

  fs.writeFileSync(path.join(PATCHES_DIR, `${patchId}.json`), JSON.stringify(patchRecord, null, 2));

  return {
    ok:         true,
    patchId,
    path:       `data/odi/patches/${patchId}.json`,
    specs,
    confidence: patchRecord.confidence,
    cssOnly:    patchRecord.cssOnly,
    preview:    specs.map(s => ({
      target:      s.patchTarget?.slice(0, 80),
      replacement: s.patchReplacement?.slice(0, 80),
      explanation: s.explanation,
    })),
  };
}

// ── Apply a generated patch ───────────────────────────────────────────────────

function applyPatch(patchId) {
  const patchPath = path.join(PATCHES_DIR, `${patchId}.json`);
  if (!fs.existsSync(patchPath)) return { ok: false, error: `Patch ${patchId} not found` };

  const record  = JSON.parse(fs.readFileSync(patchPath, "utf8"));
  const absPath = path.resolve(ROOT, record.targetFile);
  if (!fs.existsSync(absPath)) return { ok: false, error: `Target file missing: ${record.targetFile}` };

  const applied = _applySpecs(absPath, record.specs);
  _gitAdd(absPath);
  const diff = _gitDiff(absPath);

  record.status  = "applied";
  record.applied = applied;
  record.diff    = diff;
  fs.writeFileSync(patchPath, JSON.stringify(record, null, 2));

  return {
    ok:      true,
    patchId,
    applied,
    diff,
    appliedCount: applied.filter(a => a.applied).length,
    failedCount:  applied.filter(a => !a.applied).length,
  };
}

// ── Rollback a patch ──────────────────────────────────────────────────────────

function rollbackPatch(patchId) {
  const patchPath = path.join(PATCHES_DIR, `${patchId}.json`);
  if (!fs.existsSync(patchPath)) return { ok: false, error: `Patch ${patchId} not found` };
  const record = JSON.parse(fs.readFileSync(patchPath, "utf8"));
  if (!record.originalContent) return { ok: false, error: "No original content stored — cannot rollback" };
  const absPath = path.resolve(ROOT, record.targetFile);
  _rollback(absPath, record.originalContent);
  record.status = "rolled_back";
  fs.writeFileSync(patchPath, JSON.stringify(record, null, 2));
  return { ok: true, patchId, message: `Rolled back ${record.targetFile}` };
}

// ── Commit an applied patch ───────────────────────────────────────────────────

function commitPatch(patchId, message) {
  const patchPath = path.join(PATCHES_DIR, `${patchId}.json`);
  if (!fs.existsSync(patchPath)) return { ok: false, error: `Patch ${patchId} not found` };
  const record = JSON.parse(fs.readFileSync(patchPath, "utf8"));
  if (record.status !== "applied") return { ok: false, error: `Patch not applied (status: ${record.status})` };

  const msg = message || `fix(odi): ${record.finding?.message?.slice(0, 60) || patchId}`;
  const result = _gitCommit(msg);
  record.status = result.ok ? "committed" : "commit_failed";
  record.commitMessage = msg;
  fs.writeFileSync(patchPath, JSON.stringify(record, null, 2));

  return { ok: result.ok, patchId, message: msg, stdout: result.stdout, stderr: result.stderr };
}

// ── Diff preview (before apply) ───────────────────────────────────────────────

function previewPatch(patchId) {
  const patchPath = path.join(PATCHES_DIR, `${patchId}.json`);
  if (!fs.existsSync(patchPath)) return { ok: false, error: `Patch ${patchId} not found` };
  const record = JSON.parse(fs.readFileSync(patchPath, "utf8"));

  const previews = (record.specs || []).map(spec => {
    const before = spec.patchTarget || "";
    const after  = spec.patchReplacement || "";
    return {
      targetFile:  record.targetFile,
      before:      before.slice(0, 200),
      after:       after.slice(0, 200),
      explanation: spec.explanation || "",
      diff: `--- a/${record.targetFile}\n+++ b/${record.targetFile}\n-${before.slice(0, 80)}\n+${after.slice(0, 80)}`,
    };
  });

  return { ok: true, patchId, status: record.status, previews, confidence: record.confidence };
}

function listPatches({ limit = 50 } = {}) {
  _ensureDir();
  return fs.readdirSync(PATCHES_DIR)
    .filter(f => f.endsWith(".json")).sort().reverse().slice(0, limit)
    .map(f => {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(PATCHES_DIR, f), "utf8"));
        return {
          patchId:    d.patchId,
          status:     d.status,
          targetFile: d.targetFile,
          finding:    d.finding?.message?.slice(0, 80),
          confidence: d.confidence,
          timestamp:  d.timestamp,
        };
      } catch { return null; }
    }).filter(Boolean);
}

module.exports = { generatePatch, applyPatch, rollbackPatch, commitPatch, previewPatch, listPatches };
