"use strict";
/**
 * ODI-5 Screenshot Analyzer
 *
 * Combines Screenshot + DOM + Layout + Component graph into a unified AI analysis.
 *
 * Pipeline:
 *   1. Load screenshot (base64 PNG)
 *   2. Load DOM snapshot
 *   3. Run layoutGraphService on DOM
 *   4. Run componentGraphService on DOM
 *   5. Build a structured context prompt
 *   6. Call Claude vision API with image + context
 *   7. Return structured findings
 *
 * Uses existing aiService.js callAI() with direct Anthropic vision HTTP call
 * when ANTHROPIC_API_KEY is set (vision needs multi-part content format).
 */

const fs   = require("fs");
const path = require("path");
const axios = require("axios");

const { generateLayoutGraph }    = require("./layoutGraphService.cjs");
const { generateComponentGraph } = require("./componentGraphService.cjs");

const ANALYSES_DIR = path.join(__dirname, "../../data/odi/analyses");
function _ensureDir() { if (!fs.existsSync(ANALYSES_DIR)) fs.mkdirSync(ANALYSES_DIR, { recursive: true }); }

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VER = "2023-06-01";

// ── Vision call (Claude with image) ──────────────────────────────────────────
async function _callClaudeVision(imageBase64, textPrompt, systemPrompt) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not set — cannot run vision analysis");

  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

  const body = {
    model,
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{
      role: "user",
      content: [
        {
          type:   "image",
          source: { type: "base64", media_type: "image/png", data: imageBase64 },
        },
        {
          type: "text",
          text: textPrompt,
        },
      ],
    }],
  };

  const res = await axios.post(ANTHROPIC_URL, body, {
    headers: {
      "x-api-key":         key,
      "anthropic-version": ANTHROPIC_VER,
      "Content-Type":      "application/json",
    },
    timeout: 60_000,
  });
  const text = res.data?.content?.[0]?.text;
  if (!text) throw new Error("Empty Claude vision response");
  return text;
}

// ── Fallback text-only analysis ───────────────────────────────────────────────
async function _callTextFallback(textPrompt, systemPrompt) {
  const ai = require("./aiService.js");
  return ai.callAI(textPrompt, { system: systemPrompt, maxTokens: 2048 });
}

// ── JSON extraction helper ────────────────────────────────────────────────────
function _extractJSON(raw) {
  // Try fenced code block first
  const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) {
    try { return JSON.parse(m[1]); } catch {}
  }
  // Try full raw
  try { return JSON.parse(raw); } catch {}
  // Return structured text fallback
  return { raw, parsed: false };
}

// ── Build context for AI ──────────────────────────────────────────────────────
function _buildContext(domSnapshot, layoutGraph, componentGraph) {
  const lf = layoutGraph.findings;
  const cs = componentGraph.stats;
  return `
URL: ${domSnapshot.url}
Title: ${domSnapshot.title}
Viewport: ${domSnapshot.viewport?.width}×${domSnapshot.viewport?.height}
DOM nodes: ${domSnapshot.nodeCount} total, ${layoutGraph.stats.visibleNodes} visible

LAYOUT FINDINGS (${lf.length}):
${lf.slice(0, 15).map(f => `  [${f.severity.toUpperCase()}] ${f.message}`).join("\n") || "  None"}

COMPONENT GRAPH:
  Duplicate groups: ${cs.duplicateGroups} (${cs.duplicateInstances} instances)
  Orphan nodes:     ${cs.orphanCount}
  Unused/hidden:    ${cs.unusedCount}
  Max nesting:      ${cs.maxNestingDepth}
  Types: ${JSON.stringify(cs.componentTypes)}
`.trim();
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function analyzeScreenshot({ screenshotFilename, domFilename, domSnapshot } = {}) {
  // Load screenshot
  let imageBase64 = null;
  if (screenshotFilename) {
    const imgPath = path.join(__dirname, "../../data/odi/screenshots", screenshotFilename);
    if (!fs.existsSync(imgPath)) return { ok: false, error: `Screenshot not found: ${screenshotFilename}` };
    imageBase64 = fs.readFileSync(imgPath).toString("base64");
  }

  // Load DOM snapshot
  let snapshot = domSnapshot;
  if (!snapshot && domFilename) {
    const fp = path.join(__dirname, "../../data/odi/dom", domFilename);
    if (!fs.existsSync(fp)) return { ok: false, error: `DOM file not found: ${domFilename}` };
    snapshot = JSON.parse(fs.readFileSync(fp, "utf8"));
  }
  if (!snapshot) return { ok: false, error: "domFilename or domSnapshot required" };

  // Generate derived graphs
  const layoutGraph    = generateLayoutGraph(snapshot);
  const componentGraph = generateComponentGraph(snapshot);
  const context        = _buildContext(snapshot, layoutGraph, componentGraph);

  const system = `You are a senior UI/UX engineer and design systems expert performing an automated design intelligence audit.
Analyze the screenshot and structured data. Return ONLY valid JSON in this exact structure:
{
  "score": 0-100,
  "summary": "one-line executive summary",
  "findings": [
    { "id": "F1", "severity": "error|warning|info", "category": "layout|component|typography|color|spacing|accessibility|responsive", "message": "clear description", "location": "element or area", "suggestion": "concrete fix" }
  ],
  "designSystemIssues": ["issue1", "issue2"],
  "quickWins": ["actionable fix 1", "actionable fix 2"],
  "positives": ["what looks good"]
}`;

  const userPrompt = imageBase64
    ? `Analyze this UI screenshot combined with the structured DOM/layout data below.\n\n${context}\n\nProvide findings as JSON.`
    : `No screenshot available. Analyze based on structural data only.\n\n${context}\n\nProvide findings as JSON.`;

  let raw, parsed, aiError;
  try {
    if (imageBase64) {
      raw = await _callClaudeVision(imageBase64, userPrompt, system);
    } else {
      raw = await _callTextFallback(userPrompt, system);
    }
    parsed = _extractJSON(raw);
  } catch (e) {
    aiError = e.message;
    // Degrade gracefully: return structural findings without AI
    parsed = {
      score: null,
      summary: "AI unavailable — structural analysis only",
      findings: layoutGraph.findings.map((f, i) => ({
        id: `S${i + 1}`, severity: f.severity, category: "layout", message: f.message, location: f.nodeId || "", suggestion: "",
      })),
      designSystemIssues: [],
      quickWins: [],
      positives: [],
    };
  }

  const result = {
    ok: true,
    timestamp: new Date().toISOString(),
    url:        snapshot.url,
    title:      snapshot.title,
    screenshotFilename,
    domFilename,
    aiUsed:     !!imageBase64 && !aiError,
    aiError:    aiError || null,
    layoutFindings:    layoutGraph.findings.length,
    componentStats:    componentGraph.stats,
    analysis:          parsed,
  };

  // Persist to disk
  _ensureDir();
  const slug = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `analysis-${slug}.json`;
  fs.writeFileSync(path.join(ANALYSES_DIR, filename), JSON.stringify(result, null, 2));
  result.filename = filename;
  result.path     = `data/odi/analyses/${filename}`;

  return result;
}

function listAnalyses({ limit = 50 } = {}) {
  _ensureDir();
  return fs.readdirSync(ANALYSES_DIR)
    .filter(f => f.endsWith(".json")).sort().reverse().slice(0, limit)
    .map(f => {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(ANALYSES_DIR, f), "utf8"));
        return { filename: f, url: d.url, aiUsed: d.aiUsed, score: d.analysis?.score, timestamp: d.timestamp };
      } catch { return null; }
    }).filter(Boolean);
}

module.exports = { analyzeScreenshot, listAnalyses };
