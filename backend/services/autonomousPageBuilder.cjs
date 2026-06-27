"use strict";
/**
 * ODI-22 Autonomous Page Builder
 *
 * Given an ODI-21 design plan (or a page spec), generates a complete React page:
 *   - Routing-ready (exported default component + route config)
 *   - Responsive layout (Tailwind CSS, mobile-first)
 *   - Accessibility (ARIA, semantic HTML, focus management)
 *   - Loading / skeleton states
 *   - Empty states (with illustration guidance)
 *   - Error states (retry pattern)
 *   - Animated transitions (Tailwind animate)
 *
 * Each generated page is persisted to data/odi/pages/.
 * writeToFile=true writes to frontend/src/pages/<PageName>.jsx
 */

const fs   = require("fs");
const path = require("path");
const ai   = require("./aiService");

const PAGES_DIR     = path.join(__dirname, "../../data/odi/pages");
const FRONTEND_DIR  = path.join(process.cwd(), "frontend/src/pages");
function _ensureDir() { if (!fs.existsSync(PAGES_DIR)) fs.mkdirSync(PAGES_DIR, { recursive: true }); }

const PAGE_PROMPT = (page, components, tokens, responsive) => `You are an expert React + Tailwind CSS engineer.

Generate a COMPLETE, production-ready React page component.

Page: ${page.page || page}
Purpose: ${page.purpose || ""}
Route: ${page.route || "/"}
Components needed: ${JSON.stringify(components || [])}
Design tokens: ${JSON.stringify(tokens || {})}
Responsive strategy: ${JSON.stringify(responsive || {})}

Requirements:
1. Default export named ${(page.page || page).replace(/\s+/g, "")}Page
2. Mobile-first Tailwind CSS — responsive breakpoints sm/md/lg/xl
3. Loading state: skeleton placeholders with animate-pulse
4. Empty state: helpful message + icon + action button
5. Error state: error message + retry button
6. Full ARIA attributes and semantic HTML
7. Use React hooks: useState, useEffect, useCallback where appropriate
8. Data fetching placeholder: fetch from \`/api/...\` with loading/error/data states
9. No external UI libraries — Tailwind only

Return JSON only:
{
  "pageName": "string",
  "fileName": "PageName.jsx",
  "code": "complete JSX string",
  "routeConfig": { "path": "/route", "element": "<PageName />" },
  "imports": ["react", "react-router-dom"],
  "description": "brief description"
}`;

async function buildPage({ planId, pageSpec, writeToFile = false } = {}) {
  let page, components, tokens, responsive;

  if (planId) {
    const { getPlan } = require("./aiDesignPlanner.cjs");
    const record = getPlan(planId);
    if (!record) return { ok: false, error: `Plan not found: ${planId}` };
    const plan = record.plan;
    page       = pageSpec || plan.pageMap?.[0];
    components = page ? plan.componentTree?.[page.page] : [];
    tokens     = plan.designTokens;
    responsive = plan.responsiveStrategy;
  } else if (pageSpec) {
    page       = pageSpec;
    components = pageSpec.components || [];
    tokens     = pageSpec.tokens || {};
    responsive = pageSpec.responsive || {};
  } else {
    return { ok: false, error: "planId or pageSpec required" };
  }

  if (!page) return { ok: false, error: "No page to build" };

  let result;
  try {
    const raw = await ai.callAI(PAGE_PROMPT(page, components, tokens, responsive), { maxTokens: 3000 });
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { ok: false, error: "AI did not return valid JSON" };
    result = JSON.parse(jsonMatch[0]);
  } catch (e) {
    return { ok: false, error: `Page generation failed: ${e.message}` };
  }

  _ensureDir();
  const slug     = new Date().toISOString().replace(/[:.]/g, "-");
  const pageId   = `page-${slug}`;
  const filename = `${pageId}.json`;
  const record   = { pageId, planId: planId || null, pageName: result.pageName, fileName: result.fileName, routeConfig: result.routeConfig, description: result.description, code: result.code, imports: result.imports, generatedAt: new Date().toISOString() };

  fs.writeFileSync(path.join(PAGES_DIR, filename), JSON.stringify(record, null, 2));

  if (writeToFile && result.code && result.fileName) {
    if (!fs.existsSync(FRONTEND_DIR)) fs.mkdirSync(FRONTEND_DIR, { recursive: true });
    fs.writeFileSync(path.join(FRONTEND_DIR, result.fileName), result.code, "utf8");
    record.writtenTo = `frontend/src/pages/${result.fileName}`;
  }

  return { ok: true, pageId, filename, path: `data/odi/pages/${filename}`, ...record };
}

async function buildAllPages({ planId, writeToFile = false } = {}) {
  if (!planId) return { ok: false, error: "planId required" };
  const { getPlan } = require("./aiDesignPlanner.cjs");
  const record = getPlan(planId);
  if (!record) return { ok: false, error: `Plan not found: ${planId}` };

  const pages  = record.plan.pageMap || [];
  const results = [];
  for (const page of pages) {
    const r = await buildPage({ planId, pageSpec: page, writeToFile });
    results.push({ page: page.page, ok: r.ok, pageId: r.pageId, error: r.error });
  }
  return { ok: true, planId, total: results.length, built: results.filter(r => r.ok).length, results };
}

function listPages({ limit = 50 } = {}) {
  _ensureDir();
  return fs.readdirSync(PAGES_DIR)
    .filter(f => f.endsWith(".json")).sort().reverse().slice(0, limit)
    .map(f => {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(PAGES_DIR, f), "utf8"));
        return { filename: f, pageId: d.pageId, pageName: d.pageName, planId: d.planId, writtenTo: d.writtenTo, generatedAt: d.generatedAt };
      } catch { return null; }
    }).filter(Boolean);
}

function getPage(pageId) {
  _ensureDir();
  const files = fs.readdirSync(PAGES_DIR).filter(f => f.includes(pageId));
  if (!files.length) return null;
  try { return JSON.parse(fs.readFileSync(path.join(PAGES_DIR, files[0]), "utf8")); } catch { return null; }
}

module.exports = { buildPage, buildAllPages, listPages, getPage };
