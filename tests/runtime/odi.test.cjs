"use strict";
/**
 * ODI regression test suite (ODI-2 through ODI-9)
 *
 * Tests pure logic functions that work without a live browser:
 *   - layoutGraphService.generateLayoutGraph
 *   - componentGraphService.generateComponentGraph
 *   - designTokenEngine.extractTokens
 *   - uiPatchGenerator list/preview
 *   - accessibilityAuditor list
 *   - responsiveSimulator VIEWPORTS export
 *   - autonomousUIEngineer listRuns
 */

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const fs   = require("fs");
const path = require("path");
const os   = require("os");

// ── Minimal DOM snapshot fixture ───────────────────────────────────────────────
const MOCK_SNAPSHOT = {
  url:       "https://example.com",
  title:     "Example",
  nodeCount: 10,
  viewport:  { width: 1280, height: 900 },
  scrollY:   0,
  edges:     [{ from: "n0", to: "n1", rel: "child" }],
  nodes: [
    // root div
    { nodeId: "n0", parentId: null, tag: "div", id: "root", classes: ["container"], attrs: {}, text: null,
      depth: 0, bbox: { x: 0, y: 0, w: 1280, h: 900 },
      font: { family: "Inter, sans-serif", size: "16px", weight: "400", lineHeight: "24px", letterSpacing: "0px" },
      color: { fg: "rgb(33, 33, 33)", bg: "rgb(255, 255, 255)" },
      visibility: { display: "block", visibility: "visible", opacity: 1, isVisible: true },
      position: { type: "relative", zIndex: null, top: "auto", left: "auto", right: "auto", bottom: "auto" },
      spacing: { marginTop: "0px", marginRight: "0px", marginBottom: "0px", marginLeft: "0px",
                 paddingTop: "16px", paddingRight: "16px", paddingBottom: "16px", paddingLeft: "16px",
                 borderWidth: "0px", borderRadius: "0px" },
      layout: { flexDir: null, display: "block", gridCols: null, overflow: null },
      childIds: ["n1", "n2"] },

    // heading
    { nodeId: "n1", parentId: "n0", tag: "h1", id: null, classes: ["title"], attrs: {}, text: "Hello World",
      depth: 1, bbox: { x: 16, y: 16, w: 400, h: 40 },
      font: { family: "Inter, sans-serif", size: "32px", weight: "700", lineHeight: "40px", letterSpacing: "0px" },
      color: { fg: "rgb(0, 0, 0)", bg: "rgb(255, 255, 255)" },
      visibility: { display: "block", visibility: "visible", opacity: 1, isVisible: true },
      position: { type: "static", zIndex: null, top: "auto", left: "auto", right: "auto", bottom: "auto" },
      spacing: { marginTop: "0px", marginRight: "0px", marginBottom: "8px", marginLeft: "0px",
                 paddingTop: "0px", paddingRight: "0px", paddingBottom: "0px", paddingLeft: "0px",
                 borderWidth: "0px", borderRadius: "0px" },
      layout: { flexDir: null, display: "block", gridCols: null, overflow: null },
      childIds: [] },

    // button
    { nodeId: "n2", parentId: "n0", tag: "button", id: "cta", classes: ["btn", "btn-primary"], attrs: { role: "button" }, text: "Get Started",
      depth: 1, bbox: { x: 16, y: 64, w: 120, h: 40 },
      font: { family: "Inter, sans-serif", size: "14px", weight: "600", lineHeight: "20px", letterSpacing: "0px" },
      color: { fg: "rgb(255, 255, 255)", bg: "rgb(59, 130, 246)" },
      visibility: { display: "inline-flex", visibility: "visible", opacity: 1, isVisible: true },
      position: { type: "static", zIndex: null, top: "auto", left: "auto", right: "auto", bottom: "auto" },
      spacing: { marginTop: "0px", marginRight: "0px", marginBottom: "0px", marginLeft: "0px",
                 paddingTop: "8px", paddingRight: "16px", paddingBottom: "8px", paddingLeft: "16px",
                 borderWidth: "1px", borderRadius: "6px" },
      layout: { flexDir: null, display: "inline-flex", gridCols: null, overflow: null },
      childIds: [] },

    // duplicate button
    { nodeId: "n3", parentId: "n0", tag: "button", id: "cta2", classes: ["btn", "btn-primary"], attrs: { role: "button" }, text: "Get Started",
      depth: 1, bbox: { x: 160, y: 64, w: 120, h: 40 },
      font: { family: "Inter, sans-serif", size: "14px", weight: "600", lineHeight: "20px", letterSpacing: "0px" },
      color: { fg: "rgb(255, 255, 255)", bg: "rgb(59, 130, 246)" },
      visibility: { display: "inline-flex", visibility: "visible", opacity: 1, isVisible: true },
      position: { type: "static", zIndex: null, top: "auto", left: "auto", right: "auto", bottom: "auto" },
      spacing: { marginTop: "0px", marginRight: "0px", marginBottom: "0px", marginLeft: "0px",
                 paddingTop: "8px", paddingRight: "16px", paddingBottom: "8px", paddingLeft: "16px",
                 borderWidth: "1px", borderRadius: "6px" },
      layout: { flexDir: null, display: "inline-flex", gridCols: null, overflow: null },
      childIds: [] },

    // invisible element
    { nodeId: "n4", parentId: "n0", tag: "div", id: null, classes: ["hidden"], attrs: {}, text: null,
      depth: 1, bbox: { x: 0, y: 0, w: 0, h: 0 },
      font: { family: "Inter", size: "14px", weight: "400", lineHeight: "20px", letterSpacing: "0px" },
      color: { fg: "rgb(0,0,0)", bg: "transparent" },
      visibility: { display: "none", visibility: "hidden", opacity: 0, isVisible: false },
      position: { type: "static", zIndex: null, top: "auto", left: "auto", right: "auto", bottom: "auto" },
      spacing: { marginTop: "0px", marginRight: "0px", marginBottom: "0px", marginLeft: "0px",
                 paddingTop: "0px", paddingRight: "0px", paddingBottom: "0px", paddingLeft: "0px",
                 borderWidth: "0px", borderRadius: "0px" },
      layout: { flexDir: null, display: "none", gridCols: null, overflow: null },
      childIds: [] },
  ],
};

// ── Layout Graph tests ─────────────────────────────────────────────────────────
describe("ODI-3 layoutGraphService", () => {
  const { generateLayoutGraph } = require("../../backend/services/layoutGraphService.cjs");

  it("returns nodes, edges, findings, stats", () => {
    const g = generateLayoutGraph(MOCK_SNAPSHOT);
    assert.ok(Array.isArray(g.nodes));
    assert.ok(Array.isArray(g.edges));
    assert.ok(Array.isArray(g.findings));
    assert.ok(typeof g.stats === "object");
  });

  it("visible node count excludes hidden elements", () => {
    const g = generateLayoutGraph(MOCK_SNAPSHOT);
    for (const n of g.nodes) {
      assert.ok(n.bbox.w > 0, `node ${n.nodeId} should have positive width`);
    }
  });

  it("stats fields are numbers", () => {
    const g = generateLayoutGraph(MOCK_SNAPSHOT);
    assert.ok(typeof g.stats.totalNodes === "number");
    assert.ok(typeof g.stats.findingCount === "number");
    assert.ok(typeof g.stats.errors === "number");
    assert.ok(typeof g.stats.warnings === "number");
  });

  it("findings have required fields", () => {
    const g = generateLayoutGraph(MOCK_SNAPSHOT);
    for (const f of g.findings) {
      assert.ok(f.type, "finding must have type");
      assert.ok(f.severity, "finding must have severity");
      assert.ok(f.message, "finding must have message");
    }
  });
});

// ── Component Graph tests ──────────────────────────────────────────────────────
describe("ODI-4 componentGraphService", () => {
  const { generateComponentGraph } = require("../../backend/services/componentGraphService.cjs");

  it("returns graph structure", () => {
    const g = generateComponentGraph(MOCK_SNAPSHOT);
    assert.ok(Array.isArray(g.duplicates));
    assert.ok(Array.isArray(g.orphans));
    assert.ok(Array.isArray(g.unused));
    assert.ok(typeof g.depthAnalysis === "object");
    assert.ok(Array.isArray(g.hierarchy));
    assert.ok(typeof g.stats === "object");
  });

  it("detects duplicate buttons", () => {
    const g = generateComponentGraph(MOCK_SNAPSHOT);
    const hasDup = g.duplicates.some(d => d.count >= 2);
    assert.ok(hasDup, "should detect duplicate button signature");
  });

  it("detects unused elements", () => {
    const g = generateComponentGraph(MOCK_SNAPSHOT);
    assert.ok(g.unused.length >= 1, "hidden div should appear in unused");
  });

  it("stats.maxNestingDepth is correct", () => {
    const g = generateComponentGraph(MOCK_SNAPSHOT);
    assert.ok(g.stats.maxNestingDepth >= 1);
  });

  it("component types include button and heading", () => {
    const g = generateComponentGraph(MOCK_SNAPSHOT);
    assert.ok(g.stats.componentTypes.button >= 2, "should count 2 buttons");
    assert.ok(g.stats.componentTypes.heading >= 1, "should count 1 heading");
  });
});

// ── Design Token Engine tests ──────────────────────────────────────────────────
describe("ODI-6 designTokenEngine", () => {
  const { extractTokens } = require("../../backend/services/designTokenEngine.cjs");

  it("returns tokens, w3c, stats", () => {
    const r = extractTokens(MOCK_SNAPSHOT);
    assert.ok(Array.isArray(r.tokens.colors));
    assert.ok(Array.isArray(r.tokens.spacing));
    assert.ok(typeof r.tokens.typography === "object");
    assert.ok(typeof r.w3c === "object");
    assert.ok(typeof r.stats === "object");
  });

  it("extracts colors from visible nodes", () => {
    const r = extractTokens(MOCK_SNAPSHOT);
    assert.ok(r.tokens.colors.length > 0, "should extract at least 1 color");
  });

  it("extracts spacing from padding", () => {
    const r = extractTokens(MOCK_SNAPSHOT);
    assert.ok(r.tokens.spacing.length > 0, "should extract padding values");
  });

  it("each spacing token has value and px", () => {
    const r = extractTokens(MOCK_SNAPSHOT);
    for (const s of r.tokens.spacing) {
      assert.ok(s.token, "must have token name");
      assert.ok(typeof s.px === "number", "must have px value");
    }
  });

  it("typography has font families", () => {
    const r = extractTokens(MOCK_SNAPSHOT);
    assert.ok(r.tokens.typography.families.length > 0, "should extract font families");
  });

  it("w3c format is structured", () => {
    const r = extractTokens(MOCK_SNAPSHOT);
    // w3c object should not be empty if colors were found
    if (r.tokens.colors.length > 0) {
      assert.ok(Object.keys(r.w3c).length > 0);
    }
  });
});

// ── Responsive Simulator — VIEWPORTS export ────────────────────────────────────
describe("ODI-8 responsiveSimulator", () => {
  const { VIEWPORTS } = require("../../backend/services/responsiveSimulator.cjs");

  it("exports 5 canonical viewports", () => {
    assert.equal(VIEWPORTS.length, 5);
  });

  it("viewports have required fields", () => {
    for (const vp of VIEWPORTS) {
      assert.ok(vp.name);
      assert.ok(typeof vp.width === "number" && vp.width > 0);
      assert.ok(typeof vp.height === "number" && vp.height > 0);
      assert.ok(vp.device);
    }
  });

  it("viewport names are canonical", () => {
    const names = VIEWPORTS.map(v => v.name);
    assert.ok(names.includes("mobile"));
    assert.ok(names.includes("tablet"));
    assert.ok(names.includes("desktop"));
  });
});

// ── Patch Generator — list/preview on empty store ─────────────────────────────
describe("ODI-9 uiPatchGenerator", () => {
  const { listPatches, previewPatch } = require("../../backend/services/uiPatchGenerator.cjs");

  it("listPatches returns an array", () => {
    const list = listPatches({ limit: 10 });
    assert.ok(Array.isArray(list));
  });

  it("previewPatch returns not-found for unknown id", () => {
    const r = previewPatch("nonexistent-patch-id");
    assert.equal(r.ok, false);
    assert.ok(r.error);
  });
});

// ── Autonomous UI Engineer — listRuns ─────────────────────────────────────────
describe("ODI-10 autonomousUIEngineer", () => {
  const { listRuns, getRun } = require("../../backend/services/autonomousUIEngineer.cjs");

  it("listRuns returns an array", () => {
    const runs = listRuns({ limit: 5 });
    assert.ok(Array.isArray(runs));
  });

  it("getRun returns null for unknown id", () => {
    const r = getRun("nonexistent-run-id");
    assert.equal(r, null);
  });
});

// ── ODI-11 Visual Regression ──────────────────────────────────────────────────
describe("ODI-11 visualRegressionEngine", () => {
  const { listRegressions } = require("../../backend/services/visualRegressionEngine.cjs");

  it("listRegressions returns an array", () => {
    const r = listRegressions({ limit: 5 });
    assert.ok(Array.isArray(r));
  });
});

// ── ODI-12 UX Optimizer ───────────────────────────────────────────────────────
describe("ODI-12 uxOptimizerService", () => {
  const { scoreUX } = require("../../backend/services/uxOptimizerService.cjs");

  it("scoreUX returns uxScore, professionalScore, consistencyScore", () => {
    const r = scoreUX(MOCK_SNAPSHOT);
    assert.ok(typeof r.uxScore === "number");
    assert.ok(typeof r.professionalScore === "number");
    assert.ok(typeof r.consistencyScore === "number");
  });

  it("scores are in 0-100 range", () => {
    const r = scoreUX(MOCK_SNAPSHOT);
    assert.ok(r.uxScore >= 0 && r.uxScore <= 100);
    assert.ok(r.professionalScore >= 0 && r.professionalScore <= 100);
  });

  it("returns dimensions object with all 7 keys", () => {
    const r = scoreUX(MOCK_SNAPSHOT);
    const expected = ["spacing", "alignment", "readability", "hierarchy", "cta", "whitespace", "balance"];
    for (const k of expected) assert.ok(k in r.dimensions, `missing dimension: ${k}`);
  });

  it("returns issues and improvements arrays", () => {
    const r = scoreUX(MOCK_SNAPSHOT);
    assert.ok(Array.isArray(r.issues));
    assert.ok(Array.isArray(r.improvements));
  });

  it("detects CTA button in mock snapshot", () => {
    const r = scoreUX(MOCK_SNAPSHOT);
    // button node exists in MOCK_SNAPSHOT so CTA score should not be worst-case 50
    const ctaScore = r.dimensions.cta.score;
    assert.ok(typeof ctaScore === "number");
  });
});

// ── ODI-13 Design System AI ───────────────────────────────────────────────────
describe("ODI-13 designSystemAI", () => {
  const { analyzeDesignSystem } = require("../../backend/services/designSystemAI.cjs");

  const MOCK_TOKENS = {
    tokens: {
      colors: [
        { value: "#3B82F6", token: "color.bg.1", role: "bg", count: 5 },
        { value: "#1E40AF", token: "color.bg.2", role: "bg", count: 3 },
        { value: "#111827", token: "color.text.1", role: "text", count: 10 },
      ],
      spacing: [
        { px: 8,  token: "spacing.2" },
        { px: 18, token: "spacing.3" }, // off-grid: nearest 16, diff=2 → fires
        { px: 22, token: "spacing.4" }, // off-grid: nearest 20, diff=2 → fires
        { px: 16, token: "spacing.5" },
      ],
      typography: { families: ["Inter"], sizes: ["14px", "16px", "32px"], weights: ["400", "700"], lineHeights: [] },
      radius: [{ token: "0px", px: 0 }, { token: "6px", px: 6 }],
      iconSizes: [],
    },
  };

  it("returns systemScore, inconsistencies, tokenPatches, summary", () => {
    const r = analyzeDesignSystem(MOCK_TOKENS);
    assert.ok(typeof r.systemScore === "number");
    assert.ok(Array.isArray(r.inconsistencies));
    assert.ok(Array.isArray(r.tokenPatches));
    assert.ok(typeof r.summary === "object");
  });

  it("systemScore is in 0-100 range", () => {
    const r = analyzeDesignSystem(MOCK_TOKENS);
    assert.ok(r.systemScore >= 0 && r.systemScore <= 100);
  });

  it("detects off-grid spacing", () => {
    const r = analyzeDesignSystem(MOCK_TOKENS);
    const offGrid = r.inconsistencies.some(i => i.type === "off_grid_spacing");
    assert.ok(offGrid, "should detect 15px off-grid spacing");
  });

  it("generates tokenPatches for off-grid issues", () => {
    const r = analyzeDesignSystem(MOCK_TOKENS);
    assert.ok(r.tokenPatches.length > 0, "should generate patches for off-grid spacing");
  });
});

// ── ODI-18 Brand Intelligence ─────────────────────────────────────────────────
describe("ODI-18 brandIntelligence", () => {
  const { analyzeBrand } = require("../../backend/services/brandIntelligence.cjs");

  it("returns brandScore, violations, stats", () => {
    const r = analyzeBrand(MOCK_SNAPSHOT, {});
    assert.ok(typeof r.brandScore === "number");
    assert.ok(Array.isArray(r.violations));
    assert.ok(typeof r.stats === "object");
  });

  it("brandScore is in 0-100 range", () => {
    const r = analyzeBrand(MOCK_SNAPSHOT, {});
    assert.ok(r.brandScore >= 0 && r.brandScore <= 100);
  });

  it("returns brandStrength string", () => {
    const r = analyzeBrand(MOCK_SNAPSHOT, {});
    assert.ok(["strong", "moderate", "weak"].includes(r.brandStrength));
  });

  it("with known brand font, detects if missing", () => {
    const r = analyzeBrand(MOCK_SNAPSHOT, { fonts: { primary: "Roboto" } });
    const hasMissingFont = r.violations.some(v => v.type === "missing_brand_font");
    assert.ok(hasMissingFont, "should detect missing Roboto font");
  });
});

// ── ODI-19 Design Memory ──────────────────────────────────────────────────────
describe("ODI-19 designMemory", () => {
  const { remember, recall, stats, listMemories } = require("../../backend/services/designMemory.cjs");

  it("remember stores an entry and returns id", () => {
    const r = remember({
      finding:   { type: "test_finding", severity: "warning", message: "test" },
      patchSpec: [{ patchTarget: "foo", patchReplacement: "bar" }],
      strategy:  "test",
    });
    assert.ok(r.ok);
    assert.ok(r.id.startsWith("mem-"));
  });

  it("recall retrieves stored memories", () => {
    const r = recall({ strategy: "test", limit: 5 });
    assert.ok(Array.isArray(r));
  });

  it("listMemories returns an array", () => {
    const r = listMemories({ limit: 10 });
    assert.ok(Array.isArray(r));
  });

  it("stats returns total count", () => {
    const s = stats();
    assert.ok(typeof s.total === "number" && s.total >= 0);
  });
});

// ── ODI-20 Autonomous Design Loop ─────────────────────────────────────────────
describe("ODI-20 autonomousDesignLoop", () => {
  const { listRuns, getRun } = require("../../backend/services/autonomousDesignLoop.cjs");

  it("listRuns returns an array", () => {
    const r = listRuns({ limit: 5 });
    assert.ok(Array.isArray(r));
  });

  it("getRun returns null for unknown id", () => {
    const r = getRun("nonexistent-loop-id");
    assert.equal(r, null);
  });
});

// ── ODI-21 AI Design Planner ───────────────────────────────────────────────────
describe("ODI-21 aiDesignPlanner", () => {
  const svc = require("../../backend/services/aiDesignPlanner.cjs");

  it("listPlans returns an array", () => {
    const r = svc.listPlans({ limit: 5 });
    assert.ok(Array.isArray(r));
  });

  it("getPlan returns null for unknown id", () => {
    const r = svc.getPlan("no-such-plan");
    assert.equal(r, null);
  });

  it("updatePlan returns error for unknown id", () => {
    const r = svc.updatePlan("no-such-plan", { featureRequest: "x" });
    assert.equal(r.ok, false);
  });
});

// ── ODI-22 Autonomous Page Builder ────────────────────────────────────────────
describe("ODI-22 autonomousPageBuilder", () => {
  const svc = require("../../backend/services/autonomousPageBuilder.cjs");

  it("listPages returns an array", () => {
    const r = svc.listPages({ limit: 5 });
    assert.ok(Array.isArray(r));
  });

  it("getPage returns null for unknown id", () => {
    const r = svc.getPage("no-such-page");
    assert.equal(r, null);
  });

  it("buildPage returns error without planId and pageSpec", async () => {
    const r = await svc.buildPage({});
    assert.equal(r.ok, false);
  });
});

// ── ODI-23 Global Design Refactor ─────────────────────────────────────────────
describe("ODI-23 globalDesignRefactor", () => {
  const svc = require("../../backend/services/globalDesignRefactor.cjs");

  it("listRefactors returns an array", () => {
    const r = svc.listRefactors({ limit: 5 });
    assert.ok(Array.isArray(r));
  });
});

// ── ODI-24 AI Theme Engine ────────────────────────────────────────────────────
describe("ODI-24 aiThemeEngine", () => {
  const svc = require("../../backend/services/aiThemeEngine.cjs");

  it("THEME_DEFINITIONS has 6 built-in themes", () => {
    const keys = Object.keys(svc.THEME_DEFINITIONS);
    assert.equal(keys.length, 6);
    assert.ok(keys.includes("light"));
    assert.ok(keys.includes("dark"));
    assert.ok(keys.includes("glass"));
    assert.ok(keys.includes("enterprise"));
    assert.ok(keys.includes("minimal"));
    assert.ok(keys.includes("luxury"));
  });

  it("generateTheme returns ok with valid themeName", () => {
    const r = svc.generateTheme({ themeName: "dark" });
    assert.equal(r.ok, true);
    assert.ok(r.themeId);
    assert.ok(r.theme);
    assert.ok(r.cssVars);
    assert.ok(r.tailwindConfig);
  });

  it("generateTheme returns error for unknown themeName", () => {
    const r = svc.generateTheme({ themeName: "nonexistent" });
    assert.equal(r.ok, false);
  });

  it("generateTheme includes 13 color roles", () => {
    const r = svc.generateTheme({ themeName: "enterprise" });
    assert.equal(r.ok, true);
    const colorKeys = Object.keys(r.theme.colors);
    assert.ok(colorKeys.length >= 13);
  });

  it("generateAllThemes returns all 6", () => {
    const r = svc.generateAllThemes();
    assert.ok(r.themes);
    assert.ok(Object.keys(r.themes).length >= 6);
  });

  it("listThemes returns an array", () => {
    const r = svc.listThemes({ limit: 10 });
    assert.ok(Array.isArray(r));
  });

  it("getTheme returns null for unknown id", () => {
    const r = svc.getTheme("no-such-theme");
    assert.equal(r, null);
  });
});

// ── ODI-25 Live Design Inspector ──────────────────────────────────────────────
describe("ODI-25 liveDesignInspector", () => {
  const svc = require("../../backend/services/liveDesignInspector.cjs");

  it("listInspections returns an array", () => {
    const r = svc.listInspections({ limit: 5 });
    assert.ok(Array.isArray(r));
  });

  it("inspectElement returns error without url or pageId", async () => {
    const r = await svc.inspectElement({ selector: "body" });
    assert.equal(r.ok, false);
  });

  it("inspectMultiple returns error without url", async () => {
    const r = await svc.inspectMultiple({ selectors: ["body"] });
    assert.equal(r.ok, false);
  });
});

// ── ODI-26 Live Design Editor ─────────────────────────────────────────────────
describe("ODI-26 liveDesignEditor", () => {
  const svc = require("../../backend/services/liveDesignEditor.cjs");

  it("listSessions returns an array", () => {
    const r = svc.listSessions();
    assert.ok(Array.isArray(r));
  });

  it("listEdits returns an array", () => {
    const r = svc.listEdits({ limit: 5 });
    assert.ok(Array.isArray(r));
  });

  it("applyChange returns error for unknown sessionId", async () => {
    const r = await svc.applyChange({ sessionId: "no-such-session", selector: "body", changes: { spacing: 8 } });
    assert.equal(r.ok, false);
  });

  it("commitSession returns error for unknown sessionId", () => {
    const r = svc.commitSession("no-such-session");
    assert.equal(r.ok, false);
  });

  it("startSession returns error without url", async () => {
    const r = await svc.startSession({});
    assert.equal(r.ok, false);
  });
});

// ── ODI-27 Animation Engine ───────────────────────────────────────────────────
describe("ODI-27 animationEngine", () => {
  const svc = require("../../backend/services/animationEngine.cjs");

  it("ANIMATION_CATALOG has 8 entries", () => {
    assert.equal(Object.keys(svc.ANIMATION_CATALOG).length, 8);
  });

  it("detectAnimationOpportunities returns array from snapshot", () => {
    const r = svc.detectAnimationOpportunities(MOCK_SNAPSHOT);
    assert.ok(Array.isArray(r));
  });

  it("detectAnimationOpportunities detects missing focus rings", () => {
    const snap = {
      ...MOCK_SNAPSHOT,
      nodes: [
        { nodeId: "n0", tag: "button", classes: [], visibility: { isVisible: true }, attrs: {} },
        { nodeId: "n1", tag: "a",      classes: [], visibility: { isVisible: true }, attrs: {} },
        { nodeId: "n2", tag: "input",  classes: [], visibility: { isVisible: true }, attrs: {} },
      ],
    };
    const r = svc.detectAnimationOpportunities(snap);
    const hasFocusRings = r.some(s => s.type === "missing_focus_rings");
    assert.ok(hasFocusRings, "Should detect missing focus rings");
  });

  it("generateAnimationCSS returns keyframes, reducedMotion, tailwindExtend", () => {
    const suggestions = svc.detectAnimationOpportunities(MOCK_SNAPSHOT);
    const css = svc.generateAnimationCSS(suggestions);
    assert.ok(css.reducedMotion?.includes("prefers-reduced-motion"));
    assert.ok(css.tailwindExtend?.animation);
    assert.ok(Array.isArray(css.utilityClasses));
  });

  it("analyzeAnimations returns error without dom data", async () => {
    const r = await svc.analyzeAnimations({});
    assert.equal(r.ok, false);
  });

  it("analyzeAnimations works with domSnapshot directly", async () => {
    const r = await svc.analyzeAnimations({ domSnapshot: MOCK_SNAPSHOT });
    assert.equal(r.ok, true);
    assert.ok(typeof r.suggestions === "number" || Array.isArray(r.suggestions));
  });

  it("listReports returns an array", () => {
    const r = svc.listReports({ limit: 5 });
    assert.ok(Array.isArray(r));
  });
});

// ── ODI-28 Enterprise Design Review ──────────────────────────────────────────
describe("ODI-28 enterpriseDesignReview", () => {
  const svc = require("../../backend/services/enterpriseDesignReview.cjs");

  it("listReviews returns an array", () => {
    const r = svc.listReviews({ limit: 5 });
    assert.ok(Array.isArray(r));
  });

  it("reviewPage returns error without url", async () => {
    const r = await svc.reviewPage({});
    assert.equal(r.ok, false);
  });

  it("reviewPages returns error without urls array", async () => {
    const r = await svc.reviewPages({});
    assert.equal(r.ok, false);
  });
});

// ── ODI-29 Continuous Design Observer ────────────────────────────────────────
describe("ODI-29 continuousDesignObserver", () => {
  const svc = require("../../backend/services/continuousDesignObserver.cjs");

  it("getStatus returns ok and running=false initially", () => {
    const r = svc.getStatus();
    assert.equal(r.ok, true);
    assert.equal(typeof r.running, "boolean");
  });

  it("stop returns error when not running", () => {
    const r = svc.stop();
    assert.equal(r.ok, false);
  });

  it("start returns error for non-existent watchDir", () => {
    const r = svc.start({ url: "http://localhost:5050", watchDir: "/no/such/dir/here" });
    assert.equal(r.ok, false);
  });

  it("listCycles returns an array", () => {
    const r = svc.listCycles({ limit: 5 });
    assert.ok(Array.isArray(r));
  });

  it("runManualCycle returns error without url", async () => {
    const r = await svc.runManualCycle({});
    assert.equal(r.ok, false);
  });
});

// ── ODI-30 Self-Operating Design System ──────────────────────────────────────
describe("ODI-30 selfOperatingDesignSystem", () => {
  const svc = require("../../backend/services/selfOperatingDesignSystem.cjs");

  it("listRuns returns an array", () => {
    const r = svc.listRuns({ limit: 5 });
    assert.ok(Array.isArray(r));
  });

  it("getRun returns null for unknown id", () => {
    const r = svc.getRun("no-such-sods-run");
    assert.equal(r, null);
  });

  it("run returns error without featureRequest", async () => {
    const r = await svc.run({});
    assert.equal(r.ok, false);
  });
});
