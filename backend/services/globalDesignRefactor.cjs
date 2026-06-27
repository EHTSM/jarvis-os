"use strict";
/**
 * ODI-23 Global Design Refactor
 *
 * Scans the frontend source tree for design inconsistencies:
 *   - Inconsistent spacing values (non-Tailwind px values, mixed em/rem/px)
 *   - Duplicated layout patterns (repeated div structures with similar classes)
 *   - Duplicated card, button, table, and form components
 *   - Inconsistent color classes (hardcoded bg-[#xxx] vs token-based)
 *
 * Generates a unified refactor report with concrete patchSpecs per file.
 * Uses file system scanning (no browser needed).
 *
 * Storage: data/odi/refactor/
 */

const fs   = require("fs");
const path = require("path");
const ai   = require("./aiService");

const REFACTOR_DIR  = path.join(__dirname, "../../data/odi/refactor");
const FRONTEND_SRC  = path.join(process.cwd(), "frontend/src");
function _ensureDir() { if (!fs.existsSync(REFACTOR_DIR)) fs.mkdirSync(REFACTOR_DIR, { recursive: true }); }

// ── File scanner ──────────────────────────────────────────────────────────────

function _scanSourceFiles(dir, exts = [".jsx", ".tsx", ".js", ".ts"], maxFiles = 60) {
  const results = [];
  function walk(d) {
    if (!fs.existsSync(d)) return;
    for (const entry of fs.readdirSync(d)) {
      if (results.length >= maxFiles) break;
      const full = path.join(d, entry);
      const stat = fs.statSync(full);
      if (stat.isDirectory() && !["node_modules", ".git", "dist", "build", "__pycache__"].includes(entry)) {
        walk(full);
      } else if (stat.isFile() && exts.some(e => entry.endsWith(e))) {
        results.push(full);
      }
    }
  }
  walk(dir);
  return results;
}

// ── Pattern detectors (pure file analysis) ───────────────────────────────────

function _detectSpacingIssues(filepath, content) {
  const issues = [];
  // Hardcoded px spacing not on Tailwind scale
  const pxMatches = [...content.matchAll(/style\s*=\s*\{[^}]*(?:padding|margin)\s*:\s*["']?(\d+)px["']?/g)];
  for (const m of pxMatches) {
    const px = parseInt(m[1]);
    const tailwindScale = [0,1,2,4,6,8,10,12,14,16,20,24,28,32,36,40,44,48,56,64,72,80,96];
    if (!tailwindScale.includes(px)) {
      issues.push({ type: "hardcoded_spacing", file: filepath, value: `${px}px`, line: content.slice(0, m.index).split("\n").length, suggestion: `Use Tailwind spacing utility instead of inline ${px}px` });
    }
  }
  // Hardcoded color values
  const colorMatches = [...content.matchAll(/bg-\[#([0-9a-fA-F]{3,6})\]|text-\[#([0-9a-fA-F]{3,6})\]/g)];
  for (const m of colorMatches) {
    issues.push({ type: "hardcoded_color", file: filepath, value: m[0], line: content.slice(0, m.index).split("\n").length, suggestion: `Replace ${m[0]} with design token color class` });
  }
  return issues;
}

function _detectDuplicatePatterns(files) {
  const signatures = new Map();
  const duplicates = [];

  for (const filepath of files) {
    let content;
    try { content = fs.readFileSync(filepath, "utf8"); } catch { continue; }

    // Extract JSX className patterns (simplified signature)
    const classMatches = [...content.matchAll(/className\s*=\s*["'`]([^"'`]+)["'`]/g)];
    for (const m of classMatches) {
      const sig = m[1].split(" ").filter(c => c.includes("rounded") || c.includes("shadow") || c.includes("border") || c.includes("flex") || c.includes("grid")).sort().join("|");
      if (sig.length < 10) continue;
      if (!signatures.has(sig)) signatures.set(sig, []);
      signatures.get(sig).push({ file: filepath, line: content.slice(0, m.index).split("\n").length, className: m[1] });
    }
  }

  for (const [sig, occurrences] of signatures) {
    if (occurrences.length >= 3) {
      const files = [...new Set(occurrences.map(o => o.file))];
      if (files.length >= 2) {
        duplicates.push({ type: "duplicate_layout_pattern", signature: sig, occurrences: occurrences.length, files: files.slice(0, 5), suggestion: "Extract to shared component" });
      }
    }
  }

  return duplicates;
}

function _detectDuplicateComponents(files) {
  const patterns = {
    card:   /className\s*=\s*["'`][^"'`]*(?:card|shadow|rounded)[^"'`]*["'`]/gi,
    button: /className\s*=\s*["'`][^"'`]*(?:btn|button|px-\d+\s+py-\d+)[^"'`]*["'`]/gi,
    table:  /<table|<thead|<tbody|<tr\b/gi,
    form:   /<form\b|<input\b|<select\b|<textarea\b/gi,
  };

  const counts = {};
  const byFile = {};

  for (const filepath of files) {
    let content;
    try { content = fs.readFileSync(filepath, "utf8"); } catch { continue; }

    for (const [type, pattern] of Object.entries(patterns)) {
      const matches = [...content.matchAll(pattern)];
      if (matches.length > 0) {
        counts[type] = (counts[type] || 0) + matches.length;
        if (!byFile[type]) byFile[type] = [];
        byFile[type].push({ file: filepath.replace(process.cwd(), ""), count: matches.length });
      }
    }
  }

  const duplicates = [];
  for (const [type, total] of Object.entries(counts)) {
    if (total >= 3) {
      duplicates.push({ type: `duplicate_${type}`, totalOccurrences: total, files: byFile[type], suggestion: `Consolidate into a single reusable ${type.charAt(0).toUpperCase() + type.slice(1)} component` });
    }
  }
  return duplicates;
}

// ── AI-enhanced patch generation ──────────────────────────────────────────────

async function _generateRefactorPatch(issue, content, filepath) {
  if (!content || content.length > 5000) return null;

  const prompt = `Generate a concrete refactor patch for this code issue.

Issue type: ${issue.type}
File: ${filepath}
Value to fix: ${issue.value || issue.type}

File content (relevant section):
\`\`\`
${content.slice(0, 1500)}
\`\`\`

Return JSON:
{ "patchTarget": "exact string to find (unique)", "patchReplacement": "replacement" }

If you cannot generate a safe, unique patch, return: { "skip": true }`;

  try {
    const raw = await ai.callAI(prompt, { maxTokens: 300 });
    const m   = raw.match(/\{[^}]+\}/);
    if (!m) return null;
    const p = JSON.parse(m[0]);
    if (p.skip || !p.patchTarget) return null;
    return p;
  } catch { return null; }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function runGlobalRefactor({ generatePatches = false } = {}) {
  _ensureDir();
  const files = _scanSourceFiles(FRONTEND_SRC);

  if (!files.length) {
    // No frontend source — scan backend as fallback for demo
    const backendFiles = _scanSourceFiles(path.join(process.cwd(), "backend"), [".js", ".cjs"], 30);
    files.push(...backendFiles);
  }

  const spacingIssues   = [];
  const contentCache    = new Map();

  for (const f of files) {
    try {
      const content = fs.readFileSync(f, "utf8");
      contentCache.set(f, content);
      spacingIssues.push(..._detectSpacingIssues(f, content));
    } catch {}
  }

  const duplicatePatterns   = _detectDuplicatePatterns(files);
  const duplicateComponents = _detectDuplicateComponents(files);

  // Generate patches for top spacing issues if requested
  const patches = [];
  if (generatePatches) {
    for (const issue of spacingIssues.slice(0, 5)) {
      const content = contentCache.get(issue.file);
      if (content) {
        const patch = await _generateRefactorPatch(issue, content, issue.file);
        if (patch) patches.push({ ...patch, file: issue.file, issueType: issue.type });
      }
    }
  }

  const allIssues   = [...spacingIssues, ...duplicatePatterns, ...duplicateComponents];
  const refactorId  = `refactor-${Date.now()}`;
  const errorCount  = allIssues.filter(i => i.type.includes("color") || i.type.includes("spacing")).length;
  const dupCount    = allIssues.filter(i => i.type.includes("duplicate")).length;

  const record = {
    refactorId,
    scannedFiles:  files.length,
    allIssues,
    patches,
    summary: { total: allIssues.length, spacingAndColor: errorCount, duplicates: dupCount, patchesGenerated: patches.length },
    timestamp: new Date().toISOString(),
  };

  const filename = `${refactorId}.json`;
  fs.writeFileSync(path.join(REFACTOR_DIR, filename), JSON.stringify(record, null, 2));

  return { ok: true, refactorId, filename, path: `data/odi/refactor/${filename}`, ...record.summary, scannedFiles: files.length };
}

function listRefactors({ limit = 20 } = {}) {
  _ensureDir();
  return fs.readdirSync(REFACTOR_DIR)
    .filter(f => f.endsWith(".json")).sort().reverse().slice(0, limit)
    .map(f => {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(REFACTOR_DIR, f), "utf8"));
        return { filename: f, refactorId: d.refactorId, scannedFiles: d.scannedFiles, ...d.summary, timestamp: d.timestamp };
      } catch { return null; }
    }).filter(Boolean);
}

module.exports = { runGlobalRefactor, listRefactors };
