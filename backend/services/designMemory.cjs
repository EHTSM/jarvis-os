"use strict";
/**
 * ODI-19 Design Memory
 *
 * When a patch or improvement is accepted (applied + not rolled back),
 * the system learns:
 *   - WHAT was changed (patchSpec)
 *   - WHY (finding category + description)
 *   - WHERE (component/file)
 *   - HOW (strategy: color/spacing/alignment/a11y/etc.)
 *   - OUTCOME (score before vs after)
 *
 * Future patch generation queries memory for similar patterns, prepending
 * accepted solutions as examples to the AI prompt.
 *
 * Storage: data/odi/memory/ — JSON per memory entry + memory-index.json
 */

const fs   = require("fs");
const path = require("path");

const MEM_DIR   = path.join(__dirname, "../../data/odi/memory");
const INDEX_FILE = path.join(MEM_DIR, "index.json");

function _ensureDir() { if (!fs.existsSync(MEM_DIR)) fs.mkdirSync(MEM_DIR, { recursive: true }); }

function _loadIndex() {
  _ensureDir();
  if (!fs.existsSync(INDEX_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(INDEX_FILE, "utf8")); }
  catch { return []; }
}

function _saveIndex(index) {
  fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2));
}

// ── Memory writers ────────────────────────────────────────────────────────────

function remember({ finding, patchSpec, targetFile, scoreBefore, scoreAfter, strategy, outcome = "applied" } = {}) {
  if (!finding || !patchSpec) return { ok: false, error: "finding and patchSpec required" };

  _ensureDir();
  const id   = `mem-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const entry = {
    id,
    finding: {
      type:     finding.type || finding.category || "unknown",
      severity: finding.severity || "warning",
      message:  finding.message || "",
    },
    patchSpec: Array.isArray(patchSpec) ? patchSpec : [patchSpec],
    targetFile:   targetFile || null,
    strategy:     strategy   || finding.category || "general",
    scoreBefore:  scoreBefore ?? null,
    scoreAfter:   scoreAfter  ?? null,
    improvement:  scoreBefore != null && scoreAfter != null ? scoreAfter - scoreBefore : null,
    outcome,
    usageCount:   0,
    createdAt:    new Date().toISOString(),
    lastUsedAt:   null,
  };

  const filename = `${id}.json`;
  fs.writeFileSync(path.join(MEM_DIR, filename), JSON.stringify(entry, null, 2));

  const index = _loadIndex();
  index.push({ id, filename, strategy: entry.strategy, findingType: entry.finding.type, improvement: entry.improvement, createdAt: entry.createdAt });
  _saveIndex(index);

  return { ok: true, id, filename, path: `data/odi/memory/${filename}` };
}

// ── Memory readers ────────────────────────────────────────────────────────────

function recall({ strategy, findingType, limit = 5 } = {}) {
  const index = _loadIndex();
  let matches = index;
  if (strategy)    matches = matches.filter(m => m.strategy === strategy);
  if (findingType) matches = matches.filter(m => m.findingType === findingType);

  // Sort by improvement desc, then recency
  matches.sort((a, b) => (b.improvement || 0) - (a.improvement || 0) || new Date(b.createdAt) - new Date(a.createdAt));
  matches = matches.slice(0, limit);

  return matches.map(m => {
    try {
      const entry = JSON.parse(fs.readFileSync(path.join(MEM_DIR, m.filename), "utf8"));
      entry.usageCount++;
      entry.lastUsedAt = new Date().toISOString();
      fs.writeFileSync(path.join(MEM_DIR, m.filename), JSON.stringify(entry, null, 2));
      return entry;
    } catch { return null; }
  }).filter(Boolean);
}

function buildMemoryContext(findingType, strategy) {
  const memories = recall({ strategy, findingType, limit: 3 });
  if (!memories.length) return "";

  return memories.map((m, i) =>
    `Example ${i + 1} (${m.strategy}, +${m.improvement ?? "?"}pt improvement):\n` +
    `  Problem: ${m.finding.message}\n` +
    `  Fix: ${m.patchSpec.map(p => p.patchReplacement?.slice(0, 80)).join(" | ")}`
  ).join("\n\n");
}

function listMemories({ limit = 50, strategy } = {}) {
  const index = _loadIndex();
  let list = strategy ? index.filter(m => m.strategy === strategy) : index;
  return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, limit);
}

function deleteMemory(id) {
  const index = _loadIndex();
  const entry = index.find(m => m.id === id);
  if (!entry) return { ok: false, error: "Memory not found" };
  const fp = path.join(MEM_DIR, entry.filename);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
  _saveIndex(index.filter(m => m.id !== id));
  return { ok: true };
}

function stats() {
  const index = _loadIndex();
  const byStrategy = {};
  for (const m of index) {
    byStrategy[m.strategy] = (byStrategy[m.strategy] || 0) + 1;
  }
  return {
    total: index.length,
    byStrategy,
    avgImprovement: index.filter(m => m.improvement != null).length
      ? Math.round(index.filter(m => m.improvement != null).reduce((s, m) => s + m.improvement, 0) / index.filter(m => m.improvement != null).length * 10) / 10
      : null,
  };
}

module.exports = { remember, recall, buildMemoryContext, listMemories, deleteMemory, stats };
