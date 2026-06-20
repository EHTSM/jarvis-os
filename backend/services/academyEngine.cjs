"use strict";
/**
 * Academy Engine — learning paths, badges, progress, certificates.
 *
 * Learning paths tie to real missions. Completion earns badges + certificates.
 *
 * Storage: data/academy-progress.json
 */

const fs   = require("fs");
const path = require("path");

const STORE_FILE = path.join(__dirname, "../../data/academy-progress.json");

// ── Catalogue ──────────────────────────────────────────────────────
const PATHS = {
  ai_builder: {
    id: "ai_builder", title: "AI Builder",
    description: "Build your first AI-powered app end-to-end.",
    level: "beginner", estimatedHours: 2, badge: "ai_builder_v1",
    modules: [
      { id: "intro",     title: "What is Ooplix?",             type: "video",       durationMin: 5  },
      { id: "workspace", title: "Your First Workspace",        type: "interactive", durationMin: 10 },
      { id: "ai_chat",   title: "Talk to Your AI",             type: "interactive", durationMin: 8  },
      { id: "mission",   title: "Create a Mission",            type: "mission",     durationMin: 15 },
      { id: "deploy",    title: "Deploy Your First App",       type: "walkthrough", durationMin: 12 },
    ],
  },
  creative_pro: {
    id: "creative_pro", title: "Creative Pro",
    description: "Master AI-powered image, video, and brand generation.",
    level: "intermediate", estimatedHours: 3, badge: "creative_pro_v1",
    modules: [
      { id: "image_gen",  title: "AI Image Generation",        type: "interactive", durationMin: 10 },
      { id: "brand_kit",  title: "Build a Brand Kit",          type: "interactive", durationMin: 15 },
      { id: "social",     title: "Social Content at Scale",    type: "interactive", durationMin: 12 },
      { id: "video",      title: "Text to Video",              type: "walkthrough", durationMin: 10 },
      { id: "assets",     title: "Asset Library Mastery",      type: "interactive", durationMin: 8  },
    ],
  },
  browser_automator: {
    id: "browser_automator", title: "Browser Automator",
    description: "Automate any website with natural language.",
    level: "intermediate", estimatedHours: 2, badge: "browser_auto_v1",
    modules: [
      { id: "nl_browser", title: "Natural Language Browser",   type: "interactive", durationMin: 10 },
      { id: "flows",      title: "Record & Replay Flows",      type: "interactive", durationMin: 12 },
      { id: "hitl",       title: "Human-in-the-Loop Safety",   type: "video",       durationMin: 6  },
      { id: "marketplace","title": "Browser Marketplace",      type: "walkthrough", durationMin: 8  },
    ],
  },
  founder_launch: {
    id: "founder_launch", title: "Founder Launch",
    description: "Launch a SaaS product with Ooplix in one week.",
    level: "advanced", estimatedHours: 5, badge: "founder_launch_v1",
    modules: [
      { id: "missions",   title: "Mission-Driven Development", type: "interactive", durationMin: 20 },
      { id: "pipeline",   title: "Autonomous Engineering",     type: "walkthrough", durationMin: 15 },
      { id: "billing",    title: "Set Up Billing",             type: "interactive", durationMin: 10 },
      { id: "analytics",  title: "Launch Dashboard",           type: "interactive", durationMin: 8  },
      { id: "scale",      title: "Scaling to 10,000 Users",   type: "video",       durationMin: 12 },
    ],
  },
};

const BADGES = {
  ai_builder_v1:    { id: "ai_builder_v1",    title: "AI Builder",       icon: "⬡", color: "#7c6af7" },
  creative_pro_v1:  { id: "creative_pro_v1",  title: "Creative Pro",     icon: "✦", color: "#a78bfa" },
  browser_auto_v1:  { id: "browser_auto_v1",  title: "Browser Automator",icon: "◈", color: "#22c55e" },
  founder_launch_v1:{ id: "founder_launch_v1",title: "Founder",          icon: "★", color: "#f59e0b" },
  first_mission:    { id: "first_mission",    title: "First Mission",    icon: "◐", color: "#ef4444" },
  first_deploy:     { id: "first_deploy",     title: "First Deploy",     icon: "⬢", color: "#3b82f6" },
};

// ── Storage ────────────────────────────────────────────────────────

function _load() {
  try { return JSON.parse(fs.readFileSync(STORE_FILE, "utf8")); }
  catch { return {}; }
}
function _save(d) {
  try {
    fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
    fs.writeFileSync(STORE_FILE, JSON.stringify(d, null, 2));
  } catch { /* non-fatal */ }
}
function _ensure(store, accountId) {
  if (!store[accountId]) store[accountId] = { paths: {}, badges: [], certificates: [] };
  return store[accountId];
}

// ── API ────────────────────────────────────────────────────────────

function listPaths()   { return Object.values(PATHS); }
function getPath(id)   { return PATHS[id] || null; }
function listBadges()  { return Object.values(BADGES); }

function enrollPath(accountId, pathId) {
  const p = PATHS[pathId];
  if (!p) return { ok: false, error: "Unknown path" };
  const store = _load();
  const acct  = _ensure(store, accountId);
  if (!acct.paths[pathId]) {
    acct.paths[pathId] = {
      pathId, enrolledAt: new Date().toISOString(),
      completed: false, modules: {},
    };
  }
  _save(store);
  return { ok: true, enrollment: acct.paths[pathId], path: p };
}

function completeModule(accountId, pathId, moduleId) {
  const store = _load();
  const acct  = _ensure(store, accountId);
  if (!acct.paths[pathId]) enrollPath(accountId, pathId);
  const prog  = acct.paths[pathId];
  prog.modules[moduleId] = { done: true, doneAt: new Date().toISOString() };

  const p     = PATHS[pathId];
  const total = p?.modules?.length || 0;
  const done  = Object.values(prog.modules).filter(m => m.done).length;
  if (total > 0 && done >= total && !prog.completed) {
    prog.completed   = true;
    prog.completedAt = new Date().toISOString();
    // Award badge
    const badge = p.badge;
    if (badge && !acct.badges.includes(badge)) {
      acct.badges.push(badge);
      // Issue certificate
      acct.certificates.push({
        id:      `cert-${Date.now()}`,
        pathId,
        pathTitle: p.title,
        badge,
        issuedAt: new Date().toISOString(),
        accountId,
      });
    }
  }
  _save(store);
  return { ok: true, progress: prog };
}

function awardBadge(accountId, badgeId) {
  const store = _load();
  const acct  = _ensure(store, accountId);
  if (!acct.badges.includes(badgeId)) acct.badges.push(badgeId);
  _save(store);
  return BADGES[badgeId] || null;
}

function getProgress(accountId) {
  const store = _load();
  const acct  = store[accountId];
  if (!acct) return { paths: [], badges: [], certificates: [] };

  const pathProgress = Object.entries(acct.paths || {}).map(([pathId, prog]) => {
    const p    = PATHS[pathId] || {};
    const total = (p.modules || []).length;
    const done  = Object.values(prog.modules || {}).filter(m => m.done).length;
    return { pathId, title: p.title, completed: prog.completed, done, total, pct: total ? Math.round((done/total)*100) : 0 };
  });

  return {
    paths:        pathProgress,
    badges:       (acct.badges || []).map(b => BADGES[b]).filter(Boolean),
    certificates: acct.certificates || [],
  };
}

function getLeaderboard() {
  const store = _load();
  return Object.entries(store).map(([accountId, acct]) => ({
    accountId,
    badges:     (acct.badges || []).length,
    pathsDone:  Object.values(acct.paths || {}).filter(p => p.completed).length,
    certs:      (acct.certificates || []).length,
  })).sort((a,b) => b.badges - a.badges).slice(0,20);
}

module.exports = { listPaths, getPath, listBadges, enrollPath, completeModule, awardBadge, getProgress, getLeaderboard, PATHS, BADGES };
