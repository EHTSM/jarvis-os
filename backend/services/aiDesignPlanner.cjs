"use strict";
/**
 * ODI-21 AI Design Planner
 *
 * Given a feature request string, produces a full design plan:
 *   - pageMap:          Array of pages with purpose, route, priority
 *   - componentTree:    Hierarchical component structure per page
 *   - navigation:       Nav items, hierarchy, mobile strategy
 *   - userFlow:         Linear steps a user takes to accomplish the goal
 *   - designTokens:     Minimal token set for the feature
 *   - responsiveStrategy: Mobile/tablet/desktop breakpoint guidance
 *
 * Output is editable JSON stored in data/odi/plans/.
 * Uses existing aiService — no new AI clients.
 */

const fs   = require("fs");
const path = require("path");
const ai   = require("./aiService");

const PLANS_DIR = path.join(__dirname, "../../data/odi/plans");
function _ensureDir() { if (!fs.existsSync(PLANS_DIR)) fs.mkdirSync(PLANS_DIR, { recursive: true }); }

const PLAN_SCHEMA = `{
  "pageMap": [
    { "page": "string", "route": "/route", "purpose": "string", "priority": "primary|secondary|utility", "icon": "string" }
  ],
  "componentTree": {
    "PageName": [
      { "component": "string", "type": "layout|data|input|feedback|nav", "children": [], "props": [] }
    ]
  },
  "navigation": {
    "primary": [{ "label": "string", "route": "string", "icon": "string" }],
    "secondary": [],
    "mobile": "bottom-tabs|hamburger|drawer",
    "hierarchy": "flat|nested"
  },
  "userFlow": [
    { "step": 1, "action": "string", "screen": "string", "outcome": "string" }
  ],
  "designTokens": {
    "colors": { "primary": "#hex", "secondary": "#hex", "surface": "#hex", "text": "#hex", "border": "#hex", "error": "#hex" },
    "spacing": { "xs": "4px", "sm": "8px", "md": "16px", "lg": "24px", "xl": "32px", "2xl": "48px" },
    "typography": { "heading": "font-family", "body": "font-family", "sizes": { "xs": "12px", "sm": "14px", "md": "16px", "lg": "20px", "xl": "24px", "2xl": "32px" } },
    "radius": { "sm": "4px", "md": "8px", "lg": "12px", "full": "9999px" },
    "shadows": { "sm": "...", "md": "...", "lg": "..." }
  },
  "responsiveStrategy": {
    "breakpoints": { "mobile": "375px", "tablet": "768px", "desktop": "1280px", "wide": "1440px" },
    "mobileFirst": true,
    "layoutShifts": [{ "from": "mobile", "to": "tablet", "change": "string" }],
    "touchTargets": "44px minimum",
    "navigation": "bottom-tabs on mobile, sidebar on desktop"
  }
}`;

async function createPlan({ featureRequest, context } = {}) {
  if (!featureRequest) return { ok: false, error: "featureRequest required" };

  const prompt = `You are an expert product designer and frontend architect.

Feature Request: "${featureRequest}"
${context ? `Additional Context: ${context}` : ""}

Generate a complete, production-ready design plan as JSON matching this schema exactly:
${PLAN_SCHEMA}

Rules:
- pageMap: include ALL pages needed, no more than 8
- componentTree: list real React component names (e.g. LeadTable, LeadCard, AddLeadForm)
- navigation: be specific about what appears where
- userFlow: cover the core happy path in 5-8 steps
- designTokens: provide actual hex values and pixel values
- responsiveStrategy: be specific about layout changes at each breakpoint

Return ONLY the JSON object. No prose, no markdown fences.`;

  let plan;
  try {
    const raw = await ai.callAI(prompt, { maxTokens: 2000 });
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { ok: false, error: "AI did not return valid JSON plan" };
    plan = JSON.parse(jsonMatch[0]);
  } catch (e) {
    return { ok: false, error: `Plan generation failed: ${e.message}` };
  }

  _ensureDir();
  const slug     = new Date().toISOString().replace(/[:.]/g, "-");
  const planId   = `plan-${slug}`;
  const filename = `${planId}.json`;
  const record   = { planId, featureRequest, context: context || null, plan, createdAt: new Date().toISOString(), status: "draft" };

  fs.writeFileSync(path.join(PLANS_DIR, filename), JSON.stringify(record, null, 2));

  return { ok: true, planId, filename, path: `data/odi/plans/${filename}`, plan };
}

function getPlan(planId) {
  _ensureDir();
  const files = fs.readdirSync(PLANS_DIR).filter(f => f.includes(planId) || f.startsWith(planId));
  if (!files.length) return null;
  try { return JSON.parse(fs.readFileSync(path.join(PLANS_DIR, files[0]), "utf8")); } catch { return null; }
}

function updatePlan(planId, patch) {
  const record = getPlan(planId);
  if (!record) return { ok: false, error: "Plan not found" };
  const merged = { ...record, plan: { ...record.plan, ...patch }, updatedAt: new Date().toISOString(), status: "edited" };
  const files  = fs.readdirSync(PLANS_DIR).filter(f => f.includes(planId) || f.startsWith(planId));
  fs.writeFileSync(path.join(PLANS_DIR, files[0]), JSON.stringify(merged, null, 2));
  return { ok: true, ...merged };
}

function listPlans({ limit = 50 } = {}) {
  _ensureDir();
  return fs.readdirSync(PLANS_DIR)
    .filter(f => f.endsWith(".json")).sort().reverse().slice(0, limit)
    .map(f => {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(PLANS_DIR, f), "utf8"));
        return { filename: f, planId: d.planId, featureRequest: d.featureRequest, status: d.status, pages: d.plan?.pageMap?.length, createdAt: d.createdAt };
      } catch { return null; }
    }).filter(Boolean);
}

module.exports = { createPlan, getPlan, updatePlan, listPlans };
