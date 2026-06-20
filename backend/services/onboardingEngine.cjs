"use strict";
/**
 * Interactive Onboarding Engine — role-based guided first-project flows.
 *
 * Roles: developer, designer, agency, founder, student, enterprise.
 * Each role has: steps, first project type, welcome message, suggested features.
 *
 * Storage: data/onboarding-state.json  { [accountId]: OnboardingState }
 */

const fs   = require("fs");
const path = require("path");

const STORE_FILE = path.join(__dirname, "../../data/onboarding-state.json");

// ── Role definitions ──────────────────────────────────────────────
const ROLES = {
  developer: {
    id: "developer", label: "Developer",
    icon: "⌨",
    welcome: "Let's build something. Your first project: a Node.js API with AI-powered endpoints.",
    firstProject: "node_api",
    suggestedWorkspace: "node_api",
    steps: [
      { id: "workspace",   label: "Open Code Workspace",        feature: "code_editor"  },
      { id: "ai_chat",     label: "Ask AI to generate a route", feature: "ai_chat"      },
      { id: "mission",     label: "Create your first Mission",  feature: "missions"     },
      { id: "git",         label: "Commit with AI",             feature: "visual_git"   },
      { id: "deploy",      label: "Deploy to staging",          feature: "deployment"   },
    ],
  },
  designer: {
    id: "designer", label: "Designer",
    icon: "✦",
    welcome: "Your creative workspace is ready. Start with AI-powered brand identity generation.",
    firstProject: "brand_identity",
    suggestedWorkspace: "marketing_agency",
    steps: [
      { id: "creative",    label: "Open Creative Studio",        feature: "creative_studio" },
      { id: "brand_kit",   label: "Create your Brand Kit",       feature: "brand_studio"    },
      { id: "generate_logo","label": "Generate a logo with AI",  feature: "logo_generate"   },
      { id: "social",      label: "Generate social content",     feature: "social_content"  },
      { id: "assets",      label: "Save to Asset Library",       feature: "asset_library"   },
    ],
  },
  agency: {
    id: "agency", label: "Agency",
    icon: "◈",
    welcome: "Manage multiple clients. Start by creating your first client workspace.",
    firstProject: "client_workspace",
    suggestedWorkspace: "marketing_agency",
    steps: [
      { id: "workspace",   label: "Create Client Workspace",     feature: "workspace"       },
      { id: "brand",       label: "Set up Client Brand Kit",     feature: "brand_studio"    },
      { id: "automation",  label: "Set up Browser Automation",   feature: "browser_platform"},
      { id: "social",      label: "Schedule Social Content",     feature: "social_content"  },
      { id: "team",        label: "Invite team members",         feature: "team_management" },
    ],
  },
  founder: {
    id: "founder", label: "Founder",
    icon: "★",
    welcome: "Launch faster. Your SaaS infrastructure is one click away.",
    firstProject: "saas_startup",
    suggestedWorkspace: "saas_startup",
    steps: [
      { id: "mission",     label: "Define your first product Mission", feature: "missions"   },
      { id: "ai_pipeline", label: "Set up AI autonomous pipeline",     feature: "pipeline"   },
      { id: "billing",     label: "Configure billing",                 feature: "billing"    },
      { id: "metrics",     label: "View launch dashboard",             feature: "analytics"  },
      { id: "referral",    label: "Share referral link",               feature: "referral"   },
    ],
  },
  student: {
    id: "student", label: "Student",
    icon: "◐",
    welcome: "Learn by building. Your first mission: build a real app with AI assistance.",
    firstProject: "learning_project",
    suggestedWorkspace: "react_app",
    steps: [
      { id: "academy",     label: "Start a learning path",         feature: "academy"       },
      { id: "workspace",   label: "Open your first workspace",     feature: "code_editor"   },
      { id: "ai_help",     label: "Ask AI to explain something",   feature: "ai_chat"       },
      { id: "mission",     label: "Complete a learning mission",   feature: "missions"      },
      { id: "badge",       label: "Earn your first badge",         feature: "badges"        },
    ],
  },
  enterprise: {
    id: "enterprise", label: "Enterprise",
    icon: "⬡",
    welcome: "Enterprise-grade AI operating system. Let's start with your org setup.",
    firstProject: "enterprise_workspace",
    suggestedWorkspace: "saas_startup",
    steps: [
      { id: "org_setup",   label: "Configure your Organization",   feature: "org_management" },
      { id: "sso",         label: "Set up SSO / SAML",             feature: "sso"            },
      { id: "policies",    label: "Configure AI policies",         feature: "enterprise_ai"  },
      { id: "team",        label: "Invite team members",           feature: "team_management"},
      { id: "success",     label: "Meet your Success team",        feature: "cst"            },
    ],
  },
};

const SAMPLE_WORKSPACES = {
  react_app:        { id: "react_app",        name: "React App",          icon: "⚛", stack: ["React","TypeScript","Vite","Tailwind"],      role: ["developer","student"] },
  node_api:         { id: "node_api",         name: "Node API",           icon: "⬡", stack: ["Node.js","Express","PostgreSQL","JWT"],       role: ["developer"] },
  flutter_app:      { id: "flutter_app",      name: "Flutter App",        icon: "◈", stack: ["Flutter","Dart","Firebase","Riverpod"],       role: ["developer","student"] },
  marketing_agency: { id: "marketing_agency", name: "Marketing Agency",   icon: "★", stack: ["Brand Studio","Social Engine","Browser Auto"], role: ["agency","designer"] },
  ecommerce_brand:  { id: "ecommerce_brand",  name: "E-commerce Brand",   icon: "◐", stack: ["Shopify","Creative Studio","Social Engine"],   role: ["founder","agency"] },
  saas_startup:     { id: "saas_startup",     name: "SaaS Startup",       icon: "✦", stack: ["Mission Engine","Billing","Analytics","API"],  role: ["founder","developer"] },
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

// ── API ────────────────────────────────────────────────────────────

function getRoles() { return Object.values(ROLES); }
function getRole(id) { return ROLES[id] || null; }
function getSampleWorkspaces() { return Object.values(SAMPLE_WORKSPACES); }

function startOnboarding(accountId, roleId) {
  const role = ROLES[roleId];
  if (!role) return { ok: false, error: `Unknown role: ${roleId}` };

  const store = _load();
  const state = {
    accountId, roleId,
    started:   new Date().toISOString(),
    completed: false,
    steps: role.steps.map(s => ({ ...s, done: false, doneAt: null })),
    currentStep: 0,
    suggestedWorkspace: role.suggestedWorkspace,
    firstProject: role.firstProject,
  };
  store[accountId] = state;
  _save(store);
  return { ok: true, state, role };
}

function getState(accountId) {
  return _load()[accountId] || null;
}

function completeStep(accountId, stepId) {
  const store = _load();
  const state = store[accountId];
  if (!state) return null;
  const step = state.steps.find(s => s.id === stepId);
  if (!step) return state;
  if (!step.done) {
    step.done   = true;
    step.doneAt = new Date().toISOString();
    const currentIdx = state.steps.indexOf(step);
    state.currentStep = Math.max(state.currentStep, currentIdx + 1);
    if (state.steps.every(s => s.done)) {
      state.completed  = true;
      state.completedAt = new Date().toISOString();
    }
  }
  _save(store);
  return state;
}

function getProgress(accountId) {
  const state = getState(accountId);
  if (!state) return null;
  const done  = state.steps.filter(s => s.done).length;
  return {
    roleId:    state.roleId,
    done,
    total:     state.steps.length,
    pct:       Math.round((done / state.steps.length) * 100),
    completed: state.completed,
    nextStep:  state.steps.find(s => !s.done) || null,
  };
}

function getAllProgress() {
  const store = _load();
  return Object.values(store).map(s => ({
    accountId:  s.accountId,
    roleId:     s.roleId,
    completed:  s.completed,
    pct: Math.round((s.steps.filter(x => x.done).length / s.steps.length) * 100),
    started:    s.started,
  }));
}

module.exports = {
  getRoles, getRole, getSampleWorkspaces,
  startOnboarding, getState, completeStep, getProgress, getAllProgress,
  ROLES, SAMPLE_WORKSPACES,
};
