"use strict";
/**
 * ODI-15 Autonomous Component Generator
 *
 * Generates complete React + Tailwind components:
 *   - Accessibility attributes (aria-*, role, tabIndex, keyboard handlers)
 *   - Animation (Tailwind transition/animate classes)
 *   - PropTypes and basic Jest test scaffold
 *   - Persists to data/odi/components-gen/
 *
 * Does NOT write to the filesystem automatically — returns the component code
 * and test scaffold for the operator to review. A writeToFile flag enables
 * direct write to frontend/src/components/.
 */

const fs   = require("fs");
const path = require("path");
const ai   = require("./aiService");

const GEN_DIR   = path.join(__dirname, "../../data/odi/components-gen");
const COMP_DIR  = path.join(process.cwd(), "frontend/src/components");
function _ensureDir() { if (!fs.existsSync(GEN_DIR)) fs.mkdirSync(GEN_DIR, { recursive: true }); }

// ── AI prompt ────────────────────────────────────────────────────────────────

async function generateComponent({ name, description, props, type, writeToFile = false } = {}) {
  if (!name) return { ok: false, error: "name required" };

  const compType  = type || "functional";
  const propsList = Array.isArray(props) ? props.join(", ") : (props || "children");

  const prompt = `You are an expert React + Tailwind CSS component engineer.

Generate a complete, production-ready React component called "${name}".

Requirements:
- Type: ${compType} component using React hooks where appropriate
- Description: ${description || "A reusable UI component"}
- Props: ${propsList}
- Styling: Tailwind CSS utility classes ONLY (no inline styles, no CSS modules)
- Accessibility: Include all required ARIA attributes, role, tabIndex, keyboard handlers (onKeyDown for Enter/Space on interactive elements)
- Animation: Use Tailwind transition/duration/ease classes for smooth interactions
- PropTypes: Include PropTypes validation at the bottom
- Default export: yes

Also generate a basic Jest test scaffold.

Return JSON only (no prose before or after):
{
  "component": "// complete JSX code as a string",
  "test": "// complete test file code as a string",
  "dependencies": ["react", "prop-types"],
  "usage": "<${name} example usage />"
}`;

  try {
    const raw = await ai.callAI(prompt, { maxTokens: 1500 });
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { ok: false, error: "AI did not return JSON" };

    const parsed = JSON.parse(jsonMatch[0]);
    _ensureDir();

    const slug = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `${name}-${slug}.json`;
    const record = { name, description, props, type: compType, ...parsed, generatedAt: new Date().toISOString() };
    fs.writeFileSync(path.join(GEN_DIR, filename), JSON.stringify(record, null, 2));

    if (writeToFile && parsed.component) {
      if (!fs.existsSync(COMP_DIR)) fs.mkdirSync(COMP_DIR, { recursive: true });
      const jsxPath = path.join(COMP_DIR, `${name}.jsx`);
      fs.writeFileSync(jsxPath, parsed.component, "utf8");
      record.writtenTo = `frontend/src/components/${name}.jsx`;
    }

    return { ok: true, filename, path: `data/odi/components-gen/${filename}`, ...record };
  } catch (e) {
    return { ok: false, error: `Generation failed: ${e.message}` };
  }
}

function listGenerated({ limit = 50 } = {}) {
  _ensureDir();
  return fs.readdirSync(GEN_DIR)
    .filter(f => f.endsWith(".json")).sort().reverse().slice(0, limit)
    .map(f => {
      try { const d = JSON.parse(fs.readFileSync(path.join(GEN_DIR, f), "utf8")); return { filename: f, name: d.name, type: d.type, writtenTo: d.writtenTo, generatedAt: d.generatedAt }; }
      catch { return null; }
    }).filter(Boolean);
}

module.exports = { generateComponent, listGenerated };
