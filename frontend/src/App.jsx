import React, { useState, useEffect, useRef, useCallback, useMemo, Suspense, lazy } from "react";
import { AnimatePresence } from "framer-motion";
import { track } from "./analytics";
import { getBillingStatus } from "./billingApi";
import { checkHealth, getStats, getOpsData } from "./telemetryApi";
import { sendMessage } from "./api";
import { emergencyStop, emergencyResume } from "./runtimeApi";
import { _fetch } from "./_client";
// ── Eagerly-loaded: critical path + shell UI ────────────────────────────────
import TrialBanner        from "./components/TrialBanner.jsx";
import UpgradeModal       from "./components/UpgradeModal.jsx";
import ConnectBar         from "./components/ConnectBar.jsx";
import ToastContainer     from "./components/Toast.jsx";
import ProgressBar        from "./components/ProgressBar.jsx";
import OperatorConsole    from "./components/operator/OperatorConsole.jsx";
import LoginPage          from "./components/auth/LoginPage.jsx";
import SignupPage         from "./components/auth/SignupPage.jsx";
import ForgotPassword     from "./components/auth/ForgotPassword.jsx";
import ResetPasswordPage  from "./components/auth/ResetPasswordPage.jsx";
import VerifyEmailPage    from "./components/auth/VerifyEmailPage.jsx";
import AcceptInvitePage   from "./components/auth/AcceptInvitePage.jsx";
import Chat, { MODELS }  from "./components/Chat.jsx";
import Dashboard          from "./components/Dashboard.jsx";
import CommandCenter      from "./components/CommandCenter.jsx";
import CustomerDashboard  from "./components/CustomerDashboard.jsx";
import CustomerFirstRunWizard, { shouldShowCustomerFirstRun } from "./components/CustomerFirstRunWizard.jsx";
import CompanyFooter      from "./components/legal/CompanyFooter.jsx";
import ThemeToggle, { initTheme } from "./components/ThemeToggle.jsx";
// Non-critical paths — lazy-split from main bundle
const LandingPage        = lazy(() => import("./components/LandingPage.jsx"));
const WelcomeFlow        = lazy(() => import("./components/WelcomeFlow.jsx"));
const GuidedTour         = lazy(() => import("./components/GuidedTour.jsx"));
const Onboarding         = lazy(() => import("./components/Onboarding.jsx"));
const PricingPage        = lazy(() => import("./components/PricingPage.jsx"));
const CompanyPage        = lazy(() => import("./components/legal/CompanyPage.jsx"));
const PrivacyPolicy      = lazy(() => import("./components/legal/PrivacyPolicy.jsx"));
const TermsOfService     = lazy(() => import("./components/legal/TermsOfService.jsx"));
const RefundPolicy       = lazy(() => import("./components/legal/RefundPolicy.jsx"));
const CookiePolicy       = lazy(() => import("./components/legal/CookiePolicy.jsx"));
const ContactPage        = lazy(() => import("./components/legal/ContactPage.jsx"));
const TrustCompliance    = lazy(() => import("./components/legal/TrustCompliance.jsx"));
const CommandPalette     = lazy(() => import("./components/CommandPalette.jsx"));
const ShortcutsOverlay   = lazy(() => import("./components/ShortcutsOverlay.jsx"));
import ElectronUpdateBanner from "./components/ElectronUpdateBanner.jsx";
import ElectronOfflineBar   from "./components/ElectronOfflineBar.jsx";
import ElectronWorkspace    from "./components/ElectronWorkspace.jsx";
import ErrorBoundary        from "./components/ErrorBoundary.jsx";
import { OoplixWordmark }   from "./design/OoplixWordmark.jsx";

// ── Lazy-loaded: secondary/overflow tab components ───────────────────────────
const BillingDashboard         = lazy(() => import("./components/BillingDashboard.jsx"));
const SuccessCenter            = lazy(() => import("./components/SuccessCenter.jsx"));
const HelpHub                  = lazy(() => import("./components/HelpHub.jsx"));
const PartnerProgram           = lazy(() => import("./components/PartnerProgram.jsx"));
const TeamWorkspace            = lazy(() => import("./components/TeamWorkspace.jsx"));
const WorkspaceSettings        = lazy(() => import("./components/WorkspaceSettings.jsx"));
const KnowledgeCenter          = lazy(() => import("./components/KnowledgeCenter.jsx"));
const IntegrationCenter        = lazy(() => import("./components/IntegrationCenter.jsx"));
const ConnectorSetupWizard     = lazy(() => import("./components/ConnectorSetupWizard.jsx"));
const EngineeringCenter        = lazy(() => import("./components/EngineeringCenter.jsx"));
const EngineeringWorkspace     = lazy(() => import("./components/EngineeringWorkspace.jsx"));
const IntelligencePanel        = lazy(() => import("./components/IntelligencePanel.jsx"));
const PredictionPanel          = lazy(() => import("./components/PredictionPanel.jsx"));
const GuardrailsDashboard      = lazy(() => import("./components/GuardrailsDashboard.jsx"));
const RecommendationCenter     = lazy(() => import("./components/RecommendationCenter.jsx"));
const ExecutionCenter          = lazy(() => import("./components/ExecutionCenter.jsx"));
const ReliabilityCenter        = lazy(() => import("./components/ReliabilityCenter.jsx"));
const DevOpsCenterV2           = lazy(() => import("./components/DevOpsCenterV2.jsx"));
const MobilePlatformCenter     = lazy(() => import("./components/MobilePlatformCenter.jsx"));
const FounderTwinConsole       = lazy(() => import("./components/FounderTwinConsole.jsx"));
const LegalOSCenter            = lazy(() => import("./components/LegalOSCenter.jsx"));
const CustomerSuccessCenter    = lazy(() => import("./components/CustomerSuccessCenter.jsx"));
const DailyPlanningConsole     = lazy(() => import("./components/DailyPlanningConsole.jsx"));
const FounderAssistant         = lazy(() => import("./components/FounderAssistant.jsx"));
const SelfHealingCenter        = lazy(() => import("./components/SelfHealingCenter.jsx"));
// Production Completion Week: RuntimeObserverPanel is a real, working
// dashboard (polls /runtime/observer/status|events|statistics|sources|health
// every 10s) that was only reachable inside ElectronWorkspace's Electron-only
// bottom panel — web-mode users had no way to see it at all. Reusing the
// exact same component here, not duplicating it.
const RuntimeObserverPanel     = lazy(() => import("./components/RuntimeObserverPanel.jsx"));
// V6-V10 Production Realization: executiveOrg/enterpriseOrg/ecosystemOrg/
// civilizationOrg/autonomousOrg (backend/routes/{executive,enterprise,
// ecosystem,civilization,autonomous}Org.js) are real, self-ticking backend
// infrastructure confirmed this session, previously with zero frontend
// surface. One reusable component (OrgLevelStatus.jsx), parameterized by
// level below, instead of 5 near-duplicate dashboard files.
const OrgLevelStatus           = lazy(() => import("./components/OrgLevelStatus.jsx"));
const AgentRegistryCenter      = lazy(() => import("./components/AgentRegistryCenter.jsx"));
const TaskRouterCenter         = lazy(() => import("./components/TaskRouterCenter.jsx"));
const SharedMemoryCenter       = lazy(() => import("./components/SharedMemoryCenter.jsx"));
const OperationsCenter         = lazy(() => import("./components/OperationsCenter.jsx"));
const AgentCollaborationCenter = lazy(() => import("./components/AgentCollaborationCenter.jsx"));
const ToolFabricCenter         = lazy(() => import("./components/ToolFabricCenter.jsx"));
const CompanyFactoryCenter     = lazy(() => import("./components/CompanyFactoryCenter.jsx"));
const CreativeStudio           = lazy(() => import("./components/CreativeStudio.jsx"));
const WorkflowAutomationCenter = lazy(() => import("./components/WorkflowAutomationCenter.jsx"));
const AnalyticsCenter          = lazy(() => import("./components/AnalyticsCenter.jsx"));
const ReferralEngine           = lazy(() => import("./components/ReferralEngine.jsx"));
const OrgAdminCenter           = lazy(() => import("./components/OrgAdminCenter.jsx"));
const ExecutionOrchestratorCenter = lazy(() => import("./components/ExecutionOrchestratorCenter.jsx"));
const SupportCenter            = lazy(() => import("./components/SupportCenter.jsx"));
const TrustComplianceCenter    = lazy(() => import("./components/TrustComplianceCenter.jsx"));
const MarketplaceCenter        = lazy(() => import("./components/MarketplaceCenter.jsx"));
const AICostCenter             = lazy(() => import("./components/AICostCenter.jsx"));
const AIUsageDashboard         = lazy(() => import("./components/AIUsageDashboard.jsx"));
const OoplixRunsOoplixCenter   = lazy(() => import("./components/OoplixRunsOoplixCenter.jsx"));
const AutonomousAgentDashboard = lazy(() => import("./components/AutonomousAgentDashboard.jsx"));
const AgentFactoryCenter       = lazy(() => import("./components/AgentFactoryCenter.jsx"));
const MemoryIntelligenceCenter = lazy(() => import("./components/MemoryIntelligenceCenter.jsx"));
const SelfImprovementCenter    = lazy(() => import("./components/SelfImprovementCenter.jsx"));
const JarvisBrainCenter        = lazy(() => import("./components/JarvisBrainCenter.jsx"));
const ExecutionConnectorCenter = lazy(() => import("./components/ExecutionConnectorCenter.jsx"));
const AgentActionCenter        = lazy(() => import("./components/AgentActionCenter.jsx"));
const AutonomyScoreCenter      = lazy(() => import("./components/AutonomyScoreCenter.jsx"));
const GlobalActivityFeed       = lazy(() => import("./components/GlobalActivityFeed.jsx"));
const SystemHealthDashboard    = lazy(() => import("./components/SystemHealthDashboard.jsx"));
const BetaChecklist            = lazy(() => import("./components/BetaChecklist.jsx"));
const Logs                     = lazy(() => import("./components/Logs.jsx"));
const ContactsV2               = lazy(() => import("./components/ContactsV2.jsx"));
const PaymentsV2               = lazy(() => import("./components/PaymentsV2.jsx"));
const ReportsV2                = lazy(() => import("./components/ReportsV2.jsx"));
const AgentOSV2                = lazy(() => import("./components/AgentOSV2.jsx"));
const MemoryOSV2               = lazy(() => import("./components/MemoryOSV2.jsx"));
const WorkflowOSV2             = lazy(() => import("./components/WorkflowOSV2.jsx"));
const DeveloperCopilotV2       = lazy(() => import("./components/DeveloperCopilotV2.jsx"));
// GrowthOS/ContentSEO/DistributionOS (Module 9) — real, backend-wired G1/G2/G3
// marketing suites. Replace the removed GrowthOSV2, a fake localStorage-only
// wrapper that never called /growth, /content, or /distrib.
const GrowthOS                 = lazy(() => import("./components/GrowthOS.jsx"));
const ContentSEO               = lazy(() => import("./components/ContentSEO.jsx"));
const DistributionOS           = lazy(() => import("./components/DistributionOS.jsx"));
const BusinessOS               = lazy(() => import("./components/BusinessOS.jsx"));
const CapabilitiesOverview     = lazy(() => import("./components/CapabilitiesOverview.jsx"));
const MissionControlV1         = lazy(() => import("./components/MissionControlV1.jsx"));
const ExecutiveDashboard       = lazy(() => import("./components/ExecutiveDashboard.jsx"));
const DevHUD                   = lazy(() => import("./components/DevHUD.jsx"));
const EndOfDayReview           = lazy(() => import("./components/EndOfDayReview.jsx"));
// AI Command Center (Module 3) — previously fully built but never wired into
// nav. operator-os/MissionControl.jsx is NOT excluded — ElectronWorkspace.jsx
// renders it directly (isElectron() only) as the Operator OS home dashboard,
// independent of the tab system below. Clicking its "Missions" tile calls
// onNavigate("mission"), which routes back into this tab's MissionControlV1
// (the drill-down detail view). In web mode, ElectronWorkspace is a pure
// passthrough (`if (!isElectron()) return children`), so only MissionControlV1
// ever renders there. Not a duplicate — two intentionally distinct
// granularities (Electron home dashboard vs. mission detail view).
const OperatorCommandLayer     = lazy(() => import("./components/operator-os/OperatorCommandLayer.jsx"));
const ExecutiveLoop            = lazy(() => import("./components/operator-os/ExecutiveLoop.jsx"));
const IntelligenceOverlay      = lazy(() => import("./components/operator-os/IntelligenceOverlay.jsx"));
const LiveAgentCollaboration   = lazy(() => import("./components/operator-os/LiveAgentCollaboration.jsx"));
import WorkspaceSwitcher        from "./components/WorkspaceSwitcher.jsx";
import OrgSwitcher              from "./components/OrgSwitcher.jsx";
import { usePinnedTabs }        from "./components/WorkspacePersonalization.jsx";
import Tooltip                  from "./components/Tooltip.jsx";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts.js";
import { AuthProvider, useAuth } from "./contexts/AuthContext.jsx";
import { startPersonalNotifications, stopPersonalNotifications } from "./personalNotifications";
import { useElectronEvent } from "./hooks/useElectron.js";
import "./App.css";

// Web: 5 primary tabs — secondary modules in "More" overflow
// Primary nav — what a new customer needs immediately
const TABS = [
  { id: "home",     label: "Dashboard"   },
  { id: "clients",  label: "Contacts"    },
  { id: "payments", label: "Payments"    },
  { id: "insights", label: "Pipeline"    },
  { id: "chat",     label: "AI"          },
  { id: "more",     label: "More ▾"     },
];

// Founder Journey Final Polish (A.4.3) finding: "lead"/"leads"/"lead
// capture" — words a founder actually searches for — returned 0 matches in
// the More-menu search, because "Contacts" (the real CRM/lead-pipeline
// feature) lives in the always-visible TABS bar, which MoreMenu's search
// never looks at (only MORE_TABS is searched). The button is one click away
// but invisible to search. Additive-only: aliases here don't touch TABS'
// own rendering, only give MoreMenu.filtered() something to match against.
const PRIMARY_TAB_ALIASES = {
  clients:  "lead leads lead capture client sales",
  payments: "invoice invoicing",
};

// Power-user overflow — all secondary modules, grouped by domain
const MORE_TABS = [
  // ── Account & Setup
  { id: "success",    label: "Getting Started",    group: "Account"      },
  { id: "billing",    label: "Billing",            group: "Account", alias: "finance" },
  { id: "settings",   label: "Settings",           group: "Account", alias: "notification notifications" },
  { id: "help",       label: "Help & Guides",      group: "Account"      },
  { id: "betachecklist", label: "Beta Checklist",  group: "Account"      },
  { id: "overview",   label: "Overview",           group: "Account"      },
  // ── Operations
  { id: "workflowautomation", label: "Workflow Automation", group: "Operations" },
  { id: "analyticscenter", label: "Analytics",       group: "Operations"   },
  { id: "activity",   label: "History",            group: "Operations", alias: "logs" },
  { id: "reports",    label: "Reports",            group: "Operations"   },
  { id: "mission",    label: "Mission Control",    group: "Operations"   },
  { id: "runtime",    label: "Runtime Console",    group: "Operations"   },
  { id: "execution",  label: "Execution",          group: "Operations"   },
  { id: "operations", label: "Operations",         group: "Operations"   },
  { id: "orchestrator",label:"Orchestrator",       group: "Operations"   },
  { id: "reliability",label: "Reliability",        group: "Operations", alias: "incident alert monitoring" },
  { id: "globalactivity", label:"Global Activity", group: "Operations"   },
  { id: "systemhealth",   label:"System Health",   group: "Operations"   },
  { id: "mobile",         label:"Mobile Platform", group: "Operations"   },
  // ── AI & Agents
  { id: "agents",     label: "Agents",             group: "AI & Agents"  },
  { id: "agentruntime", label: "Agent Runtime",    group: "AI & Agents"  },
  { id: "agentfactory", label:"Agent Factory",     group: "AI & Agents"  },
  { id: "agentactions", label:"Agent Actions",     group: "AI & Agents"  },
  { id: "collab",     label: "Collaboration",      group: "AI & Agents"  },
  { id: "taskrouter", label: "Task Router",        group: "AI & Agents"  },
  { id: "registry",   label: "Registry",           group: "AI & Agents"  },
  { id: "toolfabric", label: "Tool Fabric",        group: "AI & Agents"  },
  { id: "autonomouswf",label:"Auto Workflows",     group: "AI & Agents"  },
  { id: "autonomyscore", label:"Autonomy Score",   group: "AI & Agents"  },
  { id: "agentcollab", label:"Live Agent Roster",  group: "AI & Agents"  },
  // ── Intelligence
  { id: "intel",      label: "Intelligence",       group: "Intelligence" },
  { id: "predict",    label: "Prediction",         group: "Intelligence" },
  { id: "recommend",  label: "Recommendations",    group: "Intelligence" },
  { id: "guardrails", label: "Guardrails",         group: "Intelligence" },
  { id: "nlconsole",  label: "Command Console",    group: "Intelligence" },
  { id: "execloop",   label: "Executive Loop",     group: "Intelligence" },
  { id: "inteloverlay", label:"Reasoning & Risk",  group: "Intelligence" },
  { id: "sharedmem",  label: "Memory Fabric",      group: "Intelligence" },
  { id: "memoryintel",label:"Memory Intel",        group: "Intelligence" },
  { id: "memory",     label: "Memory OS",          group: "Intelligence" },
  { id: "knowledge",  label: "Knowledge Base",     group: "Intelligence" },
  { id: "selfimprove",label:"Self-Improve",        group: "Intelligence" },
  { id: "jarvisbrain",label:"Jarvis Brain",        group: "Intelligence" },
  { id: "twin",       label: "Digital Twin",       group: "Intelligence" },
  { id: "planning",   label: "Daily Planning",     group: "Intelligence" },
  { id: "assistant",  label: "Founder Assistant",  group: "Intelligence" },
  // ── Engineering
  { id: "engineering",label: "Engineering",        group: "Engineering"  },
  { id: "workspace",  label: "Eng Workspace",      group: "Engineering"  },
  { id: "copilot",    label: "Copilot",            group: "Engineering", alias: "review debug test ci github pipeline commit repository project code review" },
  { id: "devops",     label: "DevOps",             group: "Engineering", alias: "docker deploy deployment rollback blue green canary" },
  { id: "selfhealing",label: "Self-Healing",       group: "Engineering"  },
  { id: "observer",   label: "Runtime Observer",   group: "Engineering", alias: "observability monitoring git logs" },
  // ── Org Levels (L4, V6-V10) — read-only status views over real, self-ticking
  // backend infrastructure (backend/routes/{autonomousKnowledgeOrg,executive,
  // enterprise,ecosystem,civilization,autonomous}Org.js), each rendering
  // OrgLevelStatus with a different `level` prop rather than separate components.
  { id: "orglevel-ako",  label: "Knowledge Org (L4)",   group: "Org Levels" },
  { id: "orglevel-eos",  label: "Executive OS (L6)",    group: "Org Levels" },
  { id: "orglevel-ent",  label: "Enterprise OS (L7)",   group: "Org Levels" },
  { id: "orglevel-eco",  label: "Ecosystem OS (L8)",    group: "Org Levels" },
  { id: "orglevel-civ",  label: "Civilization OS (L9)", group: "Org Levels" },
  { id: "orglevel-auto", label: "Autonomous OS (L10)",  group: "Org Levels" },
  { id: "execconnector", label:"Exec Connectors",  group: "Engineering"  },
  // ── Growth & Revenue
  { id: "creative",   label: "Creative Studio",    group: "Growth", alias: "brand brand kit" },
  { id: "growth",     label: "Growth",             group: "Growth", alias: "marketing campaign" },
  { id: "contentseo", label: "Content & SEO",      group: "Growth", alias: "website forms landing page" },
  { id: "distribution",label:"Distribution",       group: "Growth"       },
  { id: "referral",   label: "Referral Engine",    group: "Growth"       },
  { id: "partners",   label: "Partners",           group: "Growth"       },
  { id: "aicost",     label: "AI Costs",           group: "Growth"       },
  { id: "aiusage",    label: "AI Orchestration",   group: "Growth"       },
  // ── Enterprise & Platform
  { id: "business",   label: "CRM",                group: "Enterprise"   },
  { id: "companies",  label: "Companies",          group: "Enterprise", alias: "business company" },
  { id: "team",       label: "Team",               group: "Enterprise", alias: "invite employee" },
  { id: "integrations",label:"Integrations",       group: "Enterprise", alias: "gitlab github bitbucket" },
  { id: "marketplace",label: "Marketplace",        group: "Enterprise"   },
  { id: "trustcompliance",label:"Trust",           group: "Enterprise"   },
  { id: "legalos",    label: "Legal OS",           group: "Enterprise"   },
  { id: "supportos",  label: "Support",            group: "Enterprise"   },
  { id: "customersuccess", label: "Customer Success", group: "Enterprise" },
  { id: "oroplix",    label: "Ooplix Runs Ooplix", group: "Enterprise"   },
  { id: "executivedash",label:"Executive Dash",    group: "Enterprise"   },
  { id: "orgadmin",   label: "Organization",       group: "Enterprise"   },
];

// ── Tab metadata lookup — powers breadcrumbs + recent pages ─────────
// Single source of truth: TABS ∪ MORE_TABS. No separate label registry to drift.
const _TAB_META = new Map([...TABS, ...MORE_TABS].map(t => [t.id, t]));
function tabMeta(id) {
  return _TAB_META.get(id) || { id, label: id, group: null };
}

// ── Context detection ─────────────────────────────────────────────
// desktop=1 query param → Electron shell; skip landing + onboarding
// app.* hostname         → SaaS web app;  skip marketing landing page
function _isDesktopShell() {
  try {
    return new URLSearchParams(window.location.search).get("desktop") === "1";
  } catch { return false; }
}

function _isSaasApp() {
  try {
    return window.location.hostname.startsWith("app.");
  } catch { return false; }
}

// ── Determine initial screen from localStorage ───────────────────
function _initialScreen() {
  // Emailed deep links (password reset / email verification) take priority
  // over every other screen — they carry a one-time token in the query
  // string and must render regardless of onboarding/auth state.
  try {
    const path = window.location.pathname;
    if (path === "/reset-password") return "reset-password";
    if (path === "/verify-email")   return "verify-email";
    if (path === "/accept-invite")  return "accept-invite";
  } catch { /* SSR-safe no-op */ }

  // Electron desktop: go straight to cockpit — no marketing screens
  if (_isDesktopShell()) return "app";
  // SaaS domain (app.ooplix.com): skip public landing, require onboarding if new
  if (_isSaasApp()) {
    if (!localStorage.getItem("jarvis_biz_profile")) return "onboarding";
    return "app";
  }
  // Public web: full flow — landing → onboarding → app
  if (localStorage.getItem("jarvis_started") !== "1") return "landing";
  if (!localStorage.getItem("jarvis_biz_profile"))    return "onboarding";
  return "app";
}

function _loadProfile() {
  try { return JSON.parse(localStorage.getItem("jarvis_biz_profile") || "null"); }
  catch { return null; }
}

// ── More ▾ dropdown with live search + grouped sections ──────────────────────
function MoreMenu({ currentTab, onSelect, pinned, onTogglePin }) {
  const [query,   setQuery]   = React.useState('');
  const [cursor,  setCursor]  = React.useState(0);
  const inputRef  = React.useRef(null);
  const listRef   = React.useRef(null);

  React.useEffect(() => { inputRef.current?.focus(); }, []);
  React.useEffect(() => { setCursor(0); }, [query]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return MORE_TABS;
    // Workflow Simplification Certification finding: a founder searching
    // the single most natural term for an entire category — "marketing"
    // (0 matches; the real module is labeled "Growth"), "finance" (0
    // matches; the real module is labeled "Billing") — got nothing, despite
    // real, substantial functionality existing under a less obvious name.
    // `alias` is an additive, invisible synonym field (no label/group
    // renamed, no risk to existing muscle memory) checked alongside the
    // visible label/group text.
    const moreMatches = MORE_TABS.filter(m => m.label.toLowerCase().includes(q) || m.group?.toLowerCase().includes(q) || m.alias?.toLowerCase().includes(q));
    // A.4.3 finding (see PRIMARY_TAB_ALIASES above): the always-visible
    // TABS bar (Contacts/Payments/Pipeline/AI) is invisible to this search,
    // so a founder searching "lead" got nothing despite Contacts being
    // exactly that feature one click away. Surfaced here, tagged with its
    // own group so it reads as a quick-access shortcut, not an overflow
    // module — TABS' own rendering in the main bar is untouched.
    const primaryMatches = TABS.filter(t => t.id !== "more").filter(t => {
      const alias = PRIMARY_TAB_ALIASES[t.id] || "";
      return t.label.toLowerCase().includes(q) || alias.toLowerCase().includes(q);
    }).map(t => ({ ...t, group: "Quick Access" }));
    return [...primaryMatches, ...moreMatches];
  }, [query]);

  const pinnedItems = React.useMemo(
    () => MORE_TABS.filter(m => pinned?.includes(m.id)),
    [pinned]
  );

  // Build grouped structure for display
  const grouped = React.useMemo(() => {
    if (query.trim()) return null; // flat list when searching
    const acc = {};
    for (const m of MORE_TABS) {
      const g = m.group || "Other";
      if (!acc[g]) acc[g] = [];
      acc[g].push(m);
    }
    return acc;
  }, [query]);

  const scrollItemIntoView = React.useCallback((idx) => {
    const item = listRef.current?.querySelectorAll('.tab-more-item')[idx];
    item?.scrollIntoView({ block: 'nearest' });
  }, []);

  const renderItem = (m, idx, { hideGroup = false } = {}) => (
    <button
      key={m.id}
      className={`tab-more-item${currentTab === m.id ? " active" : ""}${idx === cursor ? " focused" : ""}`}
      role="menuitem"
      aria-current={currentTab === m.id ? "page" : undefined}
      onMouseEnter={() => idx >= 0 && setCursor(idx)}
      onClick={() => onSelect(m.id)}
      onContextMenu={(e) => { e.preventDefault(); onTogglePin?.(m.id); }}
      title="Right-click to pin/unpin"
    >
      <span className="tab-more-item-label">{m.label}</span>
      {m.group && !hideGroup && <span className="tab-more-item-group">{m.group}</span>}
      <span
        className={`tab-more-item-pin${pinned?.includes(m.id) ? " tab-more-item-pin--active" : ""}`}
        role="button"
        aria-label={pinned?.includes(m.id) ? `Unpin ${m.label}` : `Pin ${m.label}`}
        onClick={(e) => { e.stopPropagation(); onTogglePin?.(m.id); }}
      >
        {pinned?.includes(m.id) ? "📌" : "📍"}
      </span>
    </button>
  );

  return (
    <div className="tab-more-menu" role="menu">
      <div className="tab-more-search-wrap">
        <span className="tab-more-search-icon" aria-hidden="true">⌕</span>
        <input
          ref={inputRef}
          className="tab-more-search"
          placeholder={`Search ${MORE_TABS.length} modules…`}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape') { e.stopPropagation(); onSelect(currentTab); }
            if (e.key === 'Enter' && filtered.length > 0) { e.preventDefault(); onSelect(filtered[cursor].id); }
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              const next = Math.min(cursor + 1, filtered.length - 1);
              setCursor(next);
              scrollItemIntoView(next);
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              const prev = Math.max(cursor - 1, 0);
              setCursor(prev);
              scrollItemIntoView(prev);
            }
          }}
          aria-label="Search modules"
        />
      </div>
      <div className="tab-more-list" ref={listRef}>
        {filtered.length === 0 && (
          <div className="tab-more-empty">No modules match "{query}"</div>
        )}
        {!query.trim() && pinnedItems.length > 0 && (
          <div className="tab-more-group tab-more-group--pinned">
            <div className="tab-more-group-label">📌 Pinned</div>
            {pinnedItems.map((m) => renderItem(m, -1, { hideGroup: true }))}
          </div>
        )}
        {query.trim() ? (
          // Flat list when searching
          filtered.map((m, i) => renderItem(m, i))
        ) : (
          // Grouped sections when not searching
          Object.entries(grouped).map(([group, items]) => (
            <div key={group} className="tab-more-group">
              <div className="tab-more-group-label">{group}</div>
              {items.map((m) => renderItem(m, filtered.indexOf(m), { hideGroup: true }))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── Breadcrumbs — Home / Group / Current page, driven by tabMeta() ──
function Breadcrumbs({ tabId, onNavigate }) {
  const meta = tabMeta(tabId);
  if (tabId === "home") return null; // no breadcrumb needed on the landing tab itself

  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <button className="breadcrumb-item breadcrumb-item--link" onClick={() => onNavigate("home")}>
        Dashboard
      </button>
      {meta.group && (
        <>
          <span className="breadcrumb-sep" aria-hidden="true">›</span>
          <span className="breadcrumb-item breadcrumb-item--group">{meta.group}</span>
        </>
      )}
      <span className="breadcrumb-sep" aria-hidden="true">›</span>
      <span className="breadcrumb-item breadcrumb-item--current" aria-current="page">{meta.label}</span>
    </nav>
  );
}

// ── Recent Pages — reads the same tabHistory ref the back/forward arrows use ──
function RecentPagesMenu({ historyRef, currentTab, onSelect }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);

  React.useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Most-recent-first, de-duplicated, excluding the current tab, capped to 8
  const recent = React.useMemo(() => {
    if (!open) return [];
    const seen = new Set([currentTab]);
    const out = [];
    for (let i = historyRef.current.length - 1; i >= 0 && out.length < 8; i--) {
      const id = historyRef.current[i];
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  }, [open, currentTab, historyRef]);

  return (
    <div className="recent-pages" ref={ref}>
      <Tooltip label="Recent pages" placement="bottom">
        <button
          className="topbar-nav-arrow"
          onClick={() => setOpen(o => !o)}
          aria-haspopup="true"
          aria-expanded={open}
          aria-label="Recent pages"
        >⏱</button>
      </Tooltip>
      {open && (
        <div className="recent-pages-dropdown">
          <div className="recent-pages-header">Recent Pages</div>
          {recent.length === 0 ? (
            <div className="tab-more-empty">No recent pages yet</div>
          ) : (
            recent.map(id => {
              const meta = tabMeta(id);
              return (
                <button
                  key={id}
                  className="tab-more-item"
                  role="menuitem"
                  onClick={() => { onSelect(id); setOpen(false); }}
                >
                  <span className="tab-more-item-label">{meta.label}</span>
                  {meta.group && <span className="tab-more-item-group">{meta.group}</span>}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

function _welcomeMessage(profile) {
  if (!profile) {
    return "Hi! I'm Ooplix — your AI Operating System.\n\nI manage your entire business in the background: follow up with leads automatically, run code and shell commands, execute workflows, track your pipeline, and take action while you're away.\n\nOpen the Control Room tab to execute tasks directly, or just tell me what you need.";
  }
  const hasLeads = (() => {
    try { return localStorage.getItem("jarvis_has_leads") === "1"; } catch { return false; }
  })();
  if (!hasLeads) {
    return `Hi! Ooplix is set up for ${profile.business || "your work"}.\n\nAdd your first contact in the Contacts tab — just a name and WhatsApp number — and I'll handle all follow-ups from there.\n\nOr open the Control Room to run a task, automate a workflow, or execute anything directly.`;
  }
  return `Hi! Ooplix is running for ${profile.business || "your business"}.\n\nI'm monitoring your pipeline, sending follow-ups, and ready for your next command. Check the Pipeline tab for lead activity, or the History tab for what I've sent.\n\nWhat do you need?`;
}

function TabSkeleton() {
  return (
    <div className="tab-skeleton" aria-hidden="true">
      <div className="tab-skeleton__header">
        <div className="sk-row sk-row--lg sk-row--w33" />
        <div className="sk-row sk-row--sm sk-row--w50" />
      </div>
      <div className="tab-skeleton__cards">
        <div className="sk-card" />
        <div className="sk-card" />
        <div className="sk-card" />
        <div className="sk-card" />
      </div>
      <div className="tab-skeleton__rows">
        <div className="sk-row sk-row--w75" />
        <div className="sk-row sk-row--w50" />
        <div className="sk-row sk-row--w33" />
        <div className="sk-row sk-row--w75" />
        <div className="sk-row sk-row--w50" />
      </div>
    </div>
  );
}

export default function App() {
  return <AuthProvider><AppInner /></AuthProvider>;
}

// Applied at module load (before first paint), same pattern as
// _isDesktopShell()/_isSaasApp() below — avoids a dark→light flash that a
// useEffect-based apply would cause.
initTheme();

const _IS_DESKTOP = _isDesktopShell();
const _IS_SAAS    = _isSaasApp();
const _PRODUCT   = _IS_DESKTOP ? "desktop" : _IS_SAAS ? "saas" : "public";

const DESKTOP_TABS = [
  { id: "home",     label: "Dashboard"  },
  { id: "clients",  label: "Contacts"   },
  { id: "payments", label: "Payments"   },
  { id: "insights", label: "Pipeline"   },
  { id: "chat",     label: "AI"         },
  { id: "more",     label: "More ▾"    },
];

function AppInner() {
  const { user, loading: authLoading, logout } = useAuth();

  // V6 Phase 8 (Personal JARVIS): overdue-task / pending-decision native
  // notifications — desktop-only (Electron), only once authenticated since
  // /planning/agenda requires a session.
  useEffect(() => {
    if (user) startPersonalNotifications();
    else stopPersonalNotifications();
    return () => stopPersonalNotifications();
  }, [user]);

  const [screen,   setScreen]   = useState(_initialScreen);
  const [messages, setMessages] = useState(() => [{
    id: 1, role: "jarvis",
    text: _welcomeMessage(_loadProfile()),
    ts: Date.now()
  }]);
  const [input,   setInput]   = useState("");
  const [loading, setLoading] = useState(false);
  const [online,  setOnline]  = useState(false);
  // Default: Control Center (home) — overview + dispatch + live status
  const [tab,      _setTab]     = useState(() => {
    // Restore last tab from electron-store on desktop; skip for non-desktop
    if (_IS_DESKTOP) {
      try {
        const saved = localStorage.getItem("ooplix_last_tab");
        if (saved) return saved;
      } catch {}
    }
    return "home";
  });
  const tabHistory  = useRef(["home"]);
  const tabFuture   = useRef([]);
  const [showEOD,     setShowEOD]     = useState(false);

  const setTab = useCallback((next) => {
    if (next === "eod") { setShowEOD(true); return; }
    _setTab(prev => {
      if (prev === next) return prev;
      tabHistory.current.push(next);
      if (tabHistory.current.length > 40) tabHistory.current.shift();
      tabFuture.current = [];
      try { localStorage.setItem("ooplix_last_tab", next); } catch {}
      if (_IS_DESKTOP) window.electronAPI?.storeSet?.("lastTab", next);
      return next;
    });
  }, []);
  const [moreOpen,    setMoreOpen]    = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { pinned: pinnedTabIds, toggle: togglePinnedTab } = usePinnedTabs();
  const [chatModel,   setChatModel]   = useState(() => {
    try { return localStorage.getItem("ooplix_chat_model") || "auto"; } catch { return "auto"; }
  });
  const [showWelcome,  setShowWelcome]  = useState(false);
  const [showTour,     setShowTour]     = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // First launch: show WelcomeFlow on Desktop, offer tour after dismiss
  useEffect(() => {
    if (!_IS_DESKTOP || screen !== "app") return;
    const done = localStorage.getItem("ooplix_welcome_done") === "1";
    if (!done) {
      const t = setTimeout(() => setShowWelcome(true), 700);
      return () => clearTimeout(t);
    }
    const tourDone = localStorage.getItem("ooplix_tour_done") === "1";
    if (!tourDone) {
      const t = setTimeout(() => setShowTour(true), 1200);
      return () => clearTimeout(t);
    }
  }, [screen]);
  const [stats,     setStats]     = useState(null);
  const [opsData,   setOpsData]   = useState(null);
  const [toasts,    setToasts]    = useState([]);
  const [billing,   setBilling]   = useState(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const _toastId = useRef(0);

  const addToast = useCallback((type, message, duration) => {
    const id = ++_toastId.current;
    setToasts(prev => [...prev.slice(-4), { id, type, message, duration }]);
  }, []);

  const removeToast = useCallback(id => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const endRef   = useRef(null);
  const inputRef = useRef(null);

  const push = useCallback((role, text) => {
    setMessages(prev => [...prev, {
      id: Date.now() + Math.random(), role, text, ts: Date.now()
    }]);
  }, []);

  // ── Record last-visit timestamp on app mount ─────────────────────
  useEffect(() => {
    if (screen !== "app") return;
    localStorage.setItem("jarvis_last_visit_ts", String(Date.now()));
  }, [screen]);

  // ── Document title for SEO + browser tab clarity ──────────────────
  useEffect(() => {
    const titles = {
      landing:    "Ooplix — AI Operating System for Your Business",
      pricing:    "Pricing — Ooplix",
      onboarding: "Get Started — Ooplix",
      signup:     "Create Account — Ooplix",
      login:      "Sign In — Ooplix",
      forgot:     "Reset Password — Ooplix",
      app:        "Ooplix",
    };
    document.title = titles[screen] ?? "Ooplix";
  }, [screen]);

  // ── Billing status polling ────────────────────────────────────────
  useEffect(() => {
    if (screen !== "app" || !user) return;
    const fetchBilling = () => getBillingStatus().then(b => { if (b) setBilling(b); });
    fetchBilling();
    const id = setInterval(fetchBilling, 60_000); // refresh every minute
    return () => clearInterval(id);
  }, [screen, user]);

  // ── Health + data polling (only when in app screen) ───────────────
  useEffect(() => {
    if (screen !== "app") return;
    let wasOnline    = false;
    let connectedOnce = false; // only announce connected once per session

    const poll = async () => {
      const healthy = await checkHealth();
      if (!wasOnline && healthy && !connectedOnce) {
        push("system", "Connected to Ooplix.");
        connectedOnce = true;
      }
      if (wasOnline && !healthy) push("system", "Connection lost — reconnecting…");
      // Re-arm so next reconnect after a drop also announces
      if (!healthy) connectedOnce = false;
      wasOnline = healthy;
      setOnline(healthy);

      // /stats and /ops are operator-only (platform-wide founder data —
      // CRM lead stats, revenue, system metrics — gated server-side by
      // ops.js's operatorOnly, "a regular customer must never reach
      // these"). Every non-operator account was polling both every 8s for
      // the whole session and getting a 403 each time — silently swallowed
      // (getStats/getOpsData catch and return null), so nothing visibly
      // broke, but it was constant, avoidable console noise and wasted
      // requests for the product's primary audience (founders, role
      // "user"). Scope the poll to operators, matching the same
      // user?.role === "operator" gate CommandCenter/home-tab already use.
      if (healthy && user?.role === "operator") {
        const [st, ops] = await Promise.allSettled([getStats(), getOpsData()]);
        setStats(st.value   ?? null);
        setOpsData(ops.value ?? null);
      }
    };

    poll();
    const id = setInterval(() => { if (!document.hidden) poll(); }, 8000);
    return () => clearInterval(id);
  }, [screen, push, user]);

  // ── Auto-scroll ───────────────────────────────────────────────────
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Keyboard shortcuts ────────────────────────────────────────────
  useKeyboardShortcuts({
    'palette':             () => { setPaletteOpen(o => !o); track.commandPaletteOpened('keyboard'); },
    'nav-home':            () => { setTab('home');           setScreen('app'); },
    'nav-intelligence':    () => { setTab('chat');           setScreen('app'); },
    'nav-engineering':     () => { setTab('engineering');    setScreen('app'); },
    'nav-contacts':        () => { setTab('clients');        setScreen('app'); },
    'nav-payments':        () => { setTab('payments');       setScreen('app'); },
    'nav-reports':         () => { setTab('reports');        setScreen('app'); },
    'nav-chat':            () => { setTab('chat');           setScreen('app'); },
    'nav-systemhealth':    () => { setTab('systemhealth');   setScreen('app'); },
    'nav-globalactivity':  () => { setTab('globalactivity'); setScreen('app'); },
    'nav-back': () => {
      const hist = tabHistory.current;
      if (hist.length < 2) return;
      hist.pop();
      const prev = hist[hist.length - 1];
      tabFuture.current.unshift(tab);
      _setTab(prev);
    },
    'nav-forward': () => {
      const next = tabFuture.current.shift();
      if (!next) return;
      tabHistory.current.push(next);
      _setTab(next);
    },
    'help':                () => setShortcutsOpen(o => !o),
    'search':              () => setPaletteOpen(true),
    'eod-review':          () => setShowEOD(o => !o),
    'escape':              () => {
      if (shortcutsOpen) { setShortcutsOpen(false); return; }
      if (paletteOpen)   { setPaletteOpen(false);   return; }
      if (moreOpen)      { setMoreOpen(false);       return; }
    },
  });

  // ── Electron native menu + IPC integration ───────────────────────
  // Legacy event names (from older main process)
  useElectronEvent('onNavigate',       (tab) => { setTab(tab); setScreen('app'); }, []);
  useElectronEvent('onOpenPalette',    ()    => setPaletteOpen(true),               []);
  useElectronEvent('onOpenSettings',   ()    => setTab('settings'),                 []);
  useElectronEvent('onEmergencyStop',  ()    => { /* trigger stop */ },             []);
  useElectronEvent('onEmergencyResume',()    => { /* trigger resume */ },           []);
  useElectronEvent('onNewTask',        ()    => { setTab('home'); setScreen('app'); setPaletteOpen(true); }, []);
  // Current event names (from production main.cjs)
  useElectronEvent('onNav',              (tab)  => { setTab(tab); setScreen('app'); },          []);
  useElectronEvent('onMenuAction', (act) => {
    if (act === 'new-contact')      setTab('clients');
    if (act === 'export-contacts')  setTab('clients');  // opens Contacts tab where export lives
  }, []);
  useElectronEvent('onOpenCommandPalette',()    => setPaletteOpen(true),                        []);
  useElectronEvent('onDeepLink',         (data) => { if (data?.route) { setTab(data.route); setScreen('app'); } }, []);
  useElectronEvent('onImportContacts',   ()     => setTab('clients'),                           []);

  // Mission Control OS nav — fired by ElectronWorkspace when operator clicks a section
  useEffect(() => {
    const handler = (e) => {
      const view = e.detail;
      if (view && view !== 'os') { setTab(view); setScreen('app'); }
    };
    window.addEventListener('jarvis-os-nav', handler);
    return () => window.removeEventListener('jarvis-os-nav', handler);
  }, []);

  // ── Sync tray status with runtime state ──────────────────────────
  useEffect(() => {
    if (!window.electronAPI) return;
    const qRun = opsData?.queue?.counts?.running ?? 0;
    window.electronAPI.updateTray?.({ agentCount: qRun, online });
  }, [opsData, online]);

  // ── Send ──────────────────────────────────────────────────────────
  const handleSend = useCallback(async (override) => {
    const cmd = (typeof override === "string" ? override : input).trim();
    if (!cmd || loading) return;
    if (!online) { push("error", "Backend offline. Please wait."); addToast("error", "Backend offline"); return; }

    push("user", cmd);
    setInput("");
    setLoading(true);

    const isExecCmd = /^(run|execute|create file|read file|open |launch )/i.test(cmd);

    // Resolve model/provider from chatModel selection
    const selectedModelCfg = MODELS.find(m => m.id === chatModel) || MODELS[0];
    const modelOpts = selectedModelCfg.provider
      ? { provider: selectedModelCfg.provider, model: selectedModelCfg.model }
      : {};

    try {
      const res = await sendMessage(cmd, "smart", modelOpts);
      push(res.success ? "jarvis" : "error", res.reply || (res.success ? "Done." : "Request failed."));
      if (isExecCmd) {
        if (res.success) addToast("success", _execSummary(cmd, res));
        else             addToast("error",   res.reply?.slice(0, 80) || "Command failed");
      }
    } catch (err) {
      push("error", err.message);
      addToast("error", err.message.slice(0, 80));
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [input, loading, online, push, addToast, chatModel]);

  function _execSummary(cmd, res) {
    if (/^run\s|^execute\s/i.test(cmd)) return "Command executed";
    if (/^create file/i.test(cmd))      return "File created";
    if (/^read file/i.test(cmd))        return "File read";
    if (/^open\s|^launch\s/i.test(cmd)) return `Opened ${cmd.split(" ")[1] || "app"}`;
    return "Done";
  }

  const handleKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  // ── Landing → Onboarding ──────────────────────────────────────────
  const handleStart = () => {
    localStorage.setItem("jarvis_started", "1");
    track.signupStarted("landing_cta");
    setScreen("onboarding");
  };

  // Login: show the login screen — authentication happens there before app access
  const handleLogin = () => {
    localStorage.setItem("jarvis_started", "1");
    setScreen("login");
  };

  // ── Onboarding complete → Signup ─────────────────────────────────
  // Profile is saved to localStorage by Onboarding component.
  // User now needs to create an account (email + password) to activate their trial.
  const handleOnboardingComplete = (profile) => {
    track.signupCompleted(profile?.business || "");
    // Route to signup — account creation fires POST /accounts/register which
    // also creates the billing trial record server-side.
    setScreen("signup");
  };

  // ── Signup complete → App ─────────────────────────────────────────
  const handleSignupComplete = () => {
    setMessages([{
      id: Date.now(), role: "jarvis",
      text: `Welcome! Your 7-day free trial has started.\n\nAdd your first contact in the Contacts tab — enter their name and WhatsApp number, and I'll handle follow-ups from there.`,
      ts:   Date.now()
    }]);
    track.trialStarted();
    localStorage.setItem("jarvis_just_onboarded", "1");
    _consumePendingInvite();
    setScreen("app");
    setTab("home");
  };

  // Consumes a workspace-invite token stashed by the accept-invite screen
  // before the user was routed to signup/login (see screen === "accept-invite"
  // above) — fires once, after the user has a real session, so the invite
  // link's promise ("click this to join") is actually kept regardless of
  // whether the user needed to sign up or just log in first.
  const _consumePendingInvite = () => {
    let token = null;
    try { token = sessionStorage.getItem("jarvis_pending_invite_token"); } catch { return; }
    if (!token) return;
    try { sessionStorage.removeItem("jarvis_pending_invite_token"); } catch { /* no-op */ }
    _fetch("/workspace/accept-invite", { method: "POST", body: JSON.stringify({ token }) }).catch(() => {});
  };

  // ── First-launch hint (dismissible, shown once after onboarding) ──
  const [showFirstLaunchHint, setShowFirstLaunchHint] = useState(
    () => localStorage.getItem("jarvis_just_onboarded") === "1"
  );
  const dismissFirstLaunchHint = useCallback(() => {
    localStorage.removeItem("jarvis_just_onboarded");
    setShowFirstLaunchHint(false);
  }, []);

  // ── Customer first-run wizard (Module 6) ──────────────────────────
  // A real multi-step wizard for regular customers — distinct from the
  // thin dismissible hint above and from FirstRunSetup.jsx (operator-only,
  // covers risk levels/dry-run/runtime health, none of which apply here).
  // Shown once per account (own localStorage key), never for operators.
  // user is not resolved on first render (authLoading), so this is derived
  // reactively rather than computed once in a useState initializer.
  //
  // Founder Journey Certification finding: neither this condition nor
  // shouldShowCustomerFirstRun() excluded the desktop shell, so on
  // ?desktop=1 both this wizard AND WelcomeFlow.jsx (the desktop-specific
  // equivalent — project picker + coding-mission quick actions, gated on
  // _IS_DESKTOP, see its own file header) were simultaneously eligible for
  // the exact same brand-new signup. Reproduced directly: both wizards'
  // "Welcome to Ooplix" cards raced to mount, and the second one's
  // backdrop blocked clicks meant for the first — a real, confusing
  // stacked-onboarding experience, not just a test artifact. WelcomeFlow
  // already covers desktop's "get oriented" need with desktop-appropriate
  // content (this wizard's CRM/team-invite/connectors steps don't fit the
  // immediate desktop-shell context); excluding this one on desktop,
  // matching the exact !_IS_DESKTOP precedent already used one screen
  // below for showFirstLaunchHint.
  const [firstRunDismissed, setFirstRunDismissed] = useState(false);
  const showCustomerFirstRun = !authLoading && !!user && user.role !== "operator"
    && !_IS_DESKTOP && !firstRunDismissed && shouldShowCustomerFirstRun();

  // ── Legal page overlay ────────────────────────────────────────────
  // null = no legal page; string = which page is open
  const [legalPage, setLegalPage] = useState(null);
  const openLegal  = useCallback((page) => setLegalPage(page), []);
  const closeLegal = useCallback(() => setLegalPage(null),     []);

  // ── Screen routing ────────────────────────────────────────────────
  const _screenFallback = <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:"#0a0a0a"}}><div className="sk-row sk-row--w75" style={{width:180,margin:"0 auto"}} /></div>;
  if (screen === "pricing")    return <Suspense fallback={_screenFallback}><PricingPage onBack={() => setScreen("landing")} onStart={handleStart} /></Suspense>;
  if (screen === "landing")    return <Suspense fallback={_screenFallback}><LandingPage onStart={handleStart} onLogin={handleLogin} onLegal={openLegal} onPricing={() => setScreen("pricing")} /></Suspense>;
  if (screen === "onboarding") return <Suspense fallback={_screenFallback}><Onboarding onComplete={handleOnboardingComplete} /></Suspense>;

  // ── Signup screen (reached after Onboarding, or from Login "Create account") ──
  if (screen === "signup") {
    return (
      <div className="app-auth-gate">
        <SignupPage
          onSuccess={handleSignupComplete}
          onLogin={() => setScreen("login")}
          onLegal={openLegal}
        />
      </div>
    );
  }

  // ── Emailed deep links (reset-password / verify-email) ────────────────────
  // These must render before any auth-gate/onboarding check — a signed-out
  // user clicking an emailed link has no session yet, and a signed-in user
  // verifying a second email address shouldn't be redirected into the app.
  if (screen === "reset-password") {
    return (
      <div className="app-auth-gate">
        <ResetPasswordPage onDone={() => { window.history.replaceState({}, "", "/"); setScreen("login"); }} />
      </div>
    );
  }
  if (screen === "verify-email") {
    return (
      <div className="app-auth-gate">
        <VerifyEmailPage onDone={() => { window.history.replaceState({}, "", "/"); setScreen(user ? "app" : "login"); }} />
      </div>
    );
  }
  if (screen === "accept-invite") {
    // Stash the token before leaving this screen for signup/login — those
    // flows clear the URL's query string, so the token would otherwise be
    // lost and the user would land in the app without ever having joined
    // the workspace they clicked the invite link for.
    const stashInviteToken = () => {
      try {
        const t = new URLSearchParams(window.location.search).get("token");
        if (t) sessionStorage.setItem("jarvis_pending_invite_token", t);
      } catch { /* no-op */ }
    };
    return (
      <div className="app-auth-gate">
        <AcceptInvitePage
          onDone={() => { window.history.replaceState({}, "", "/"); setScreen(user ? "app" : "login"); }}
          onSignup={() => { stashInviteToken(); window.history.replaceState({}, "", "/"); setScreen("signup"); }}
          onLogin={() => { stashInviteToken(); window.history.replaceState({}, "", "/"); setScreen("login"); }}
        />
      </div>
    );
  }

  // ── Forgot password screen ────────────────────────────────────────────────
  if (screen === "forgot") {
    return (
      <div className="app-auth-gate">
        <ForgotPassword onBack={() => setScreen("login")} />
      </div>
    );
  }

  // ── Explicit login screen (reached via "Sign in" on landing or from Signup) ──
  if (screen === "login") {
    return (
      <div className="app-auth-gate">
        <LoginPage
          onSuccess={() => { _consumePendingInvite(); setScreen("app"); }}
          onSignup={() => setScreen("signup")}
          onForgot={() => setScreen("forgot")}
        />
      </div>
    );
  }

  // ── Auth gate for main app ────────────────────────────────────────
  // All meaningful API calls require a session. Block the app until the
  // user is authenticated. authLoading is true only on initial mount
  // while the session cookie is being verified.
  if (authLoading) return <div className="runtime-auth-loading">Loading…</div>;
  if (!user) {
    // Show signup if they just came through onboarding but haven't created an account yet,
    // otherwise show login for returning users.
    const justOnboarded = localStorage.getItem("jarvis_just_onboarded") === "1";
    const hasProfile    = !!localStorage.getItem("jarvis_biz_profile");
    if (hasProfile && !justOnboarded) {
      // Returning user — show login. onSuccess must set screen to "app" because
      // screen may still be "landing"/"onboarding" from _initialScreen(); relying
      // on AuthContext re-render alone is not enough to advance past those screens.
      return (
        <div className="app-auth-gate">
          <LoginPage
            onSuccess={() => { _consumePendingInvite(); setScreen("app"); }}
            onSignup={() => setScreen("signup")}
            onForgot={() => setScreen("forgot")}
          />
        </div>
      );
    }
    // New user — show signup. handleSignupComplete already calls setScreen("app").
    return (
      <div className="app-auth-gate">
        <SignupPage
          onSuccess={() => { _consumePendingInvite(); setScreen("app"); }}
          onLogin={() => setScreen("login")}
        />
      </div>
    );
  }

  // ── Legal page overlay (renders over full app) ───────────────────
  if (legalPage) {
    const LEGAL_PAGES = {
      company: <CompanyPage   onBack={closeLegal} />,
      privacy: <PrivacyPolicy onBack={closeLegal} />,
      terms:   <TermsOfService onBack={closeLegal} />,
      refund:  <RefundPolicy  onBack={closeLegal} />,
      cookies: <CookiePolicy  onBack={closeLegal} />,
      contact: <ContactPage   onBack={closeLegal} />,
      trust:   <TrustCompliance onBack={closeLegal} />,
      pricing: <PricingPage onBack={closeLegal} onStart={() => { closeLegal(); handleStart(); }} onUpgrade={() => { closeLegal(); setUpgradeOpen(true); }} />,
    };
    return (
      <div className={`app app--${_PRODUCT}`}>
        <Suspense fallback={null}>
          {LEGAL_PAGES[legalPage] || <CompanyPage onBack={closeLegal} />}
        </Suspense>
        <CompanyFooter onNavigate={openLegal} />
      </div>
    );
  }

  // ── Main app ──────────────────────────────────────────────────────
  return (
    <ElectronWorkspace>
    <div className={`app app--${_PRODUCT}${opsData?.status === "critical" ? " app--emergency" : ""}`}>
      <ElectronUpdateBanner />
      <ElectronOfflineBar />
      <a href="#main-content" className="skip-link">Skip to content</a>
      <ProgressBar visible={loading} />
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      {/* Global overlays — AnimatePresence enables mount/unmount transitions */}
      <Suspense fallback={null}>
        <AnimatePresence>
          {showWelcome && (
            <WelcomeFlow
              onDismiss={(completed) => {
                // Real Productivity & Operator Experience Certification:
                // this write was previously gated behind `completed`, so
                // clicking "Skip setup" (WelcomeFlow.jsx calls
                // onDismiss(false)) never persisted the dismissal.
                // Reproduced directly: skip the wizard, it disappears;
                // reload the page, the identical full-viewport overlay
                // (position:fixed, z-index:1000, pointer-events:auto)
                // reappears and blocks every click in the app — every
                // time, forever, since a user who already chose "skip"
                // has no other route to the completion branch that used
                // to be the only path that persisted dismissal. Persist
                // on every dismissal path; only the post-dismiss tour
                // offer stays completion-gated (skipping setup shouldn't
                // also force the separate guided tour to auto-open).
                try { localStorage.setItem("ooplix_welcome_done", "1"); } catch {}
                setShowWelcome(false);
                if (completed) setTimeout(() => setShowTour(true), 400);
              }}
              onDispatchMission={(goal) => {
                setTab("jarvisbrain");
              }}
            />
          )}
        </AnimatePresence>
        <AnimatePresence>
          {showTour && (
            <GuidedTour onFinish={() => setShowTour(false)} />
          )}
        </AnimatePresence>
        <AnimatePresence>
          {paletteOpen && (
            <CommandPalette
              open={paletteOpen}
              onClose={() => setPaletteOpen(false)}
              onNavigate={(tabId) => { setTab(tabId); setMoreOpen(false); }}
              onAsk={(text) => {
                setTab("chat");
                if (text) setTimeout(() => handleSend(text), 150);
              }}
              onSignOut={logout}
            />
          )}
        </AnimatePresence>
        <AnimatePresence>
          {shortcutsOpen && (
            <ShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
          )}
        </AnimatePresence>
      </Suspense>

      {/* OS Topbar — unified header: logo + tabs + actions */}
      <header className="topbar" role="banner">
        {_IS_DESKTOP && <div className="topbar-traffic-safe" />}
        <div className="topbar-logo">
          <OoplixWordmark size={24} />
        </div>

        <nav className="tabs" aria-label="Primary navigation" onClick={() => setMoreOpen(false)}>
          {(_IS_DESKTOP ? DESKTOP_TABS : TABS).map(t => {
            if (t.id === "more") {
              const secondaryActive = MORE_TABS.some(m => m.id === tab);
              return (
                <div key="more" className="tab-more-wrap" onClick={e => e.stopPropagation()}>
                  <button
                    className={`tab tab--more${secondaryActive ? " active" : ""}${moreOpen ? " tab--more-open" : ""}`}
                    onClick={() => setMoreOpen(o => !o)}
                    aria-haspopup="true"
                    aria-expanded={moreOpen}
                  >
                    {secondaryActive ? (MORE_TABS.find(m => m.id === tab)?.label ?? "More") + " ▾" : `More (${MORE_TABS.length}) ▾`}
                  </button>
                  {moreOpen && (
                    <MoreMenu
                      currentTab={tab}
                      onSelect={(id) => { setTab(id); setMoreOpen(false); }}
                      pinned={pinnedTabIds}
                      onTogglePin={togglePinnedTab}
                    />
                  )}
                </div>
              );
            }
            return (
              <button
                key={t.id}
                className={`tab${tab === t.id ? " active" : ""}${t.featured ? " tab--featured" : ""}`}
                onClick={() => { setTab(t.id); track.tabChanged(t.id); }}
                aria-current={tab === t.id ? "page" : undefined}
                aria-label={t.id === "chat" ? "AI Chat" : t.id === "more" ? "More tabs" : undefined}
              >
                {t.label}
              </button>
            );
          })}
        </nav>

        <div className="topbar-actions">
          {/* Back / Forward nav arrows */}
          <Tooltip label="Go back (⌘[)" placement="bottom">
            <button
              className="topbar-nav-arrow"
              disabled={tabHistory.current.length < 2}
              onClick={() => {
                const hist = tabHistory.current;
                if (hist.length < 2) return;
                const leaving = hist.pop();
                const prev = hist[hist.length - 1];
                tabFuture.current.unshift(leaving);
                _setTab(prev);
              }}
              aria-label="Go back"
            >‹</button>
          </Tooltip>
          <Tooltip label="Go forward (⌘])" placement="bottom">
            <button
              className="topbar-nav-arrow"
              disabled={tabFuture.current.length === 0}
              onClick={() => {
                const next = tabFuture.current.shift();
                if (!next) return;
                tabHistory.current.push(next);
                _setTab(next);
              }}
              aria-label="Go forward"
            >›</button>
          </Tooltip>
          <RecentPagesMenu historyRef={tabHistory} currentTab={tab} onSelect={setTab} />
          {(tab === "home" || tab === "runtime") && (
            opsData?.status === "critical" ? (
              <Tooltip label="Resume all executions" placement="bottom">
                <button
                  className="btn btn--success btn--sm"
                  onClick={async () => {
                    const r = await emergencyResume();
                    if (r.success) addToast("success", "Execution resumed");
                    else addToast("error", r.error || "Resume failed");
                  }}
                >Resume</button>
              </Tooltip>
            ) : (
              <Tooltip label="Emergency stop — halt all execution (⌘⇧.)" placement="bottom">
                <button
                  className="btn btn--danger btn--sm"
                  onClick={async () => {
                    const r = await emergencyStop();
                    if (r.success) addToast("warn", "Emergency stop active — all execution halted", 6000);
                    else addToast("error", r.error || "Stop failed");
                  }}
                >Stop</button>
              </Tooltip>
            )
          )}
          <WorkspaceSwitcher onNavigate={setTab} />
          <OrgSwitcher onNavigate={setTab} />
          <ThemeToggle compact />
          <button
            className="palette-trigger"
            onClick={() => setPaletteOpen(true)}
            title="Command Palette"
            aria-label="Open command palette (⌘K)"
          >
            <span style={{ fontSize: 13, lineHeight: 1 }}>⌕</span>
            <span>Search…</span>
            <kbd>⌘K</kbd>
          </button>
          <button
            className="topbar-status"
            onClick={() => setTab("systemhealth")}
            title={online ? "Runtime connected — click to view system health" : "Runtime offline — click to view system health"}
          >
            <span className={`online-dot${online ? "" : " online-dot--offline"}`} />
            <span>{online ? "Live" : "Offline"}</span>
          </button>
        </div>
      </header>

      <Breadcrumbs tabId={tab} onNavigate={setTab} />

      {/* Trial conversion banner — shown to trialing/expired users */}
      {!_IS_DESKTOP && billing?.status !== "active" && (
        <TrialBanner
          billing={billing}
          onUpgrade={() => setUpgradeOpen(true)}
        />
      )}

      {/* ConnectBar only on tabs where service connectivity is directly relevant.
          Not shown globally — prevents the permanent "broken state" signal. */}
      {(tab === "insights" || tab === "clients" || tab === "payments") && !_IS_DESKTOP && (
        <ConnectBar
          services={opsData?.services || {}}
          onSetupWhatsApp={() => setTab("clients")}
        />
      )}

      {showCustomerFirstRun && (
        <CustomerFirstRunWizard
          onNavigate={setTab}
          onComplete={() => setFirstRunDismissed(true)}
        />
      )}

      {showFirstLaunchHint && !_IS_DESKTOP && (
        <div className="first-launch-hint">
          <span className="first-launch-title">Trial started — 7 days free.</span>
          <span className="first-launch-body">
            Add your first contact and Ooplix will send a WhatsApp follow-up automatically.{" "}
            <button
              className="first-launch-link"
              onClick={() => { setTab("clients"); dismissFirstLaunchHint(); }}
            >
              Add a contact →
            </button>
          </span>
          <button className="first-launch-dismiss" onClick={dismissFirstLaunchHint}>✕</button>
        </div>
      )}

      <UpgradeModal
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        billing={billing}
        onSuccess={() => {
          addToast("success", "Payment initiated — check your email for confirmation.");
          setUpgradeOpen(false);
        }}
      />

      <main className="app-main" id="main-content" role="main">
        {/* key forces remount on tab change — triggers page-enter CSS animation */}
        <div key={tab} className="app-tab-pane motion-premium">
        <ErrorBoundary label={tab}>
        <Suspense fallback={<TabSkeleton />}>
        {tab === "mission"  && <MissionControlV1 onNavigate={setTab} />}
        {tab === "workflowautomation" && <WorkflowAutomationCenter />}
        {tab === "analyticscenter" && <AnalyticsCenter />}
        {tab === "home" && user?.role === "operator" && (
          <CommandCenter
            stats={stats}
            opsData={opsData}
            online={online}
            onNavigate={setTab}
            onRefreshOps={async () => {
              if (!online) return;
              const [st, ops] = await Promise.allSettled([getStats(), getOpsData()]);
              if (st.value)  setStats(st.value);
              if (ops.value) setOpsData(ops.value);
            }}
          />
        )}
        {tab === "home" && user?.role !== "operator" && (
          <CustomerDashboard onNavigate={setTab} />
        )}
        {tab === "chat" && (
          <Chat
            messages={messages}
            input={input}
            loading={loading}
            online={online}
            inputRef={inputRef}
            endRef={endRef}
            onInput={setInput}
            onSend={handleSend}
            onKey={handleKey}
            onClear={() => setMessages([{
              id: Date.now(), role: "system",
              text: "Chat cleared.", ts: Date.now()
            }])}
            model={chatModel}
            onModelChange={(m) => {
              setChatModel(m);
              try { localStorage.setItem("ooplix_chat_model", m); } catch {}
            }}
          />
        )}
        {tab === "overview"  && <CapabilitiesOverview onNavigate={setTab} />}
        {tab === "insights"  && <Dashboard stats={stats} opsData={opsData} onNavigate={setTab} online={online} />}
        {tab === "activity"  && <Logs opsData={opsData} stats={stats} onNavigate={setTab} />}
        {tab === "clients"   && <ContactsV2 onNavigate={setTab} />}
        {tab === "payments"  && <PaymentsV2 onNavigate={setTab} />}
        {tab === "success"   && (
          <SuccessCenter
            stats={stats}
            opsData={opsData}
            billing={billing}
            onNavigate={setTab}
            onUpgrade={() => setUpgradeOpen(true)}
          />
        )}
        {tab === "help"      && <HelpHub onNavigate={setTab} />}
        {tab === "creative"  && <CreativeStudio />}
        {tab === "growth"       && <GrowthOS />}
        {tab === "contentseo"   && <ContentSEO />}
        {tab === "distribution" && <DistributionOS />}
        {tab === "partners"  && <PartnerProgram onNavigate={setTab} />}
        {tab === "referral"  && <ReferralEngine onNavigate={setTab} />}
        {tab === "billing"   && (
          <BillingDashboard onUpgrade={() => setUpgradeOpen(true)} />
        )}
        {tab === "business"  && <BusinessOS  onToast={addToast} onNavigate={setTab} />}
        {tab === "team"      && <TeamWorkspace onNavigate={setTab} />}
        {tab === "reports"   && <ReportsV2 onNavigate={setTab} online={online} />}
        {tab === "settings"      && <WorkspaceSettings  onNavigate={setTab} />}
        {tab === "knowledge"     && <KnowledgeCenter   onNavigate={setTab} />}
        {tab === "memory"        && <MemoryOSV2          onNavigate={setTab} />}
        {tab === "integrations" && user?.role === "operator" && <IntegrationCenter  onNavigate={setTab} />}
        {tab === "integrations" && user?.role !== "operator" && <ConnectorSetupWizard onToast={addToast} />}
        {tab === "agents"        && <AgentOSV2               onNavigate={setTab} online={online} />}
        {tab === "copilot"       && <DeveloperCopilotV2 onNavigate={setTab} />}
        {tab === "engineering"   && <EngineeringCenter      onNavigate={setTab} />}
        {tab === "workspace"     && <EngineeringWorkspace   onNavigate={setTab} />}
        {tab === "intel"         && <IntelligencePanel      onNavigate={setTab} />}
        {tab === "predict"       && <PredictionPanel        onNavigate={setTab} />}
        {tab === "guardrails"    && <GuardrailsDashboard    onNavigate={setTab} />}
        {tab === "recommend"     && <RecommendationCenter   onNavigate={setTab} />}
        {tab === "execution"     && <ExecutionCenter        onNavigate={setTab} />}
        {tab === "reliability"   && <ReliabilityCenter      onNavigate={setTab} />}
        {tab === "devops" && user?.role === "operator" && <DevOpsCenterV2 onNavigate={setTab} />}
        {tab === "devops" && user?.role !== "operator" && (
          // DevOpsCenterV2 unconditionally polls /ops, /metrics, and every
          // /computer/docker/* route — all operatorOnly server-side (same
          // route group as the fixed App.jsx /stats+/ops polling bug) —
          // so any non-operator account landing on this tab fired a burst
          // of silently-swallowed 403s. Docker container control and
          // dependency-update infrastructure isn't meaningful founder-
          // facing content, so this mirrors the "integrations" tab's own
          // operator/non-operator branch above rather than inventing new UI.
          <div className="app-tab-empty" style={{ padding: "48px 24px", textAlign: "center", color: "var(--text-dim)" }}>
            <p>DevOps is available to organization operators.</p>
          </div>
        )}
        {tab === "mobile"        && <MobilePlatformCenter   onNavigate={setTab} />}
        {tab === "twin"          && <FounderTwinConsole                          />}
        {tab === "customersuccess" && <CustomerSuccessCenter                     />}
        {tab === "planning"      && <DailyPlanningConsole                        />}
        {tab === "assistant"     && <FounderAssistant onNavigate={setTab}          />}
        {tab === "selfhealing"   && <SelfHealingCenter      onNavigate={setTab} />}
        {tab === "observer"      && <RuntimeObserverPanel />}
        {tab === "orglevel-ako"  && <OrgLevelStatus level="ako" />}
        {tab === "orglevel-eos"  && <OrgLevelStatus level="eos" />}
        {tab === "orglevel-ent"  && <OrgLevelStatus level="ent" />}
        {tab === "orglevel-eco"  && <OrgLevelStatus level="eco" />}
        {tab === "orglevel-civ"  && <OrgLevelStatus level="civ" />}
        {tab === "orglevel-auto" && <OrgLevelStatus level="auto" />}
        {tab === "registry"      && <AgentRegistryCenter   onNavigate={setTab} />}
        {tab === "taskrouter"    && <TaskRouterCenter       onNavigate={setTab} />}
        {tab === "sharedmem"     && <SharedMemoryCenter     onNavigate={setTab} />}
        {tab === "operations"    && <OperationsCenter            onNavigate={setTab} />}
        {tab === "collab"        && <AgentCollaborationCenter    onNavigate={setTab} />}
        {tab === "toolfabric"    && <ToolFabricCenter            onNavigate={setTab} />}
        {tab === "companies"     && <CompanyFactoryCenter />}
        {tab === "orgadmin"      && <OrgAdminCenter onToast={addToast} />}
        {tab === "orchestrator"      && <ExecutionOrchestratorCenter onNavigate={setTab} />}
        {tab === "supportos"         && <SupportCenter              onNavigate={setTab} />}
        {tab === "trustcompliance"   && <TrustComplianceCenter      onNavigate={setTab} />}
        {tab === "legalos"           && <LegalOSCenter                                 />}
        {tab === "marketplace"       && <MarketplaceCenter          onNavigate={setTab} />}
        {tab === "aicost"            && <AICostCenter               onNavigate={setTab} />}
        {tab === "aiusage"           && <AIUsageDashboard />}
        {tab === "oroplix"           && <OoplixRunsOoplixCenter     onNavigate={setTab} />}
        {tab === "agentruntime"      && <AutonomousAgentDashboard />}
        {tab === "agentfactory"      && <AgentFactoryCenter         onNavigate={setTab} />}
        {tab === "memoryintel"       && <MemoryIntelligenceCenter   onNavigate={setTab} />}
        {tab === "selfimprove"       && <SelfImprovementCenter      onNavigate={setTab} />}
        {tab === "jarvisbrain"       && <JarvisBrainCenter          onNavigate={setTab} />}
        {tab === "nlconsole"         && <OperatorCommandLayer />}
        {tab === "execloop"          && <ExecutiveLoop />}
        {tab === "inteloverlay"      && <IntelligenceOverlay />}
        {tab === "agentcollab"       && <LiveAgentCollaboration />}
        {tab === "executivedash"     && <ExecutiveDashboard         onNavigate={setTab} />}
        {tab === "execconnector"     && <ExecutionConnectorCenter   onNavigate={setTab} />}
        {tab === "autonomouswf"      && <WorkflowOSV2               onNavigate={setTab} />}
        {tab === "agentactions"      && <AgentActionCenter          onNavigate={setTab} />}
        {tab === "autonomyscore"     && <AutonomyScoreCenter        onNavigate={setTab} />}
        {tab === "globalactivity"    && (
          <div style={{ height: "100%", overflow: "hidden" }}>
            <GlobalActivityFeed onNavigate={setTab} />
          </div>
        )}
        {tab === "systemhealth"      && (
          <div style={{ height: "100%", overflow: "hidden" }}>
            <SystemHealthDashboard onNavigate={setTab} />
          </div>
        )}
        {tab === "betachecklist"     && (
          <div style={{ height: "100%", overflow: "hidden" }}>
            <BetaChecklist onNavigate={setTab} />
          </div>
        )}
        {tab === "runtime"           && <RuntimeTab product={_PRODUCT} />}
        </Suspense>
        </ErrorBoundary>
        </div>
      </main>

      {/* Developer HUD — slim status bar */}
      <Suspense fallback={null}>
        <DevHUD online={online} onNavigate={setTab} />
      </Suspense>

      {/* End of Day Review modal */}
      <AnimatePresence>
        {showEOD && (
          <Suspense fallback={null}>
            <EndOfDayReview onClose={() => setShowEOD(false)} />
          </Suspense>
        )}
      </AnimatePresence>

      {!_IS_DESKTOP && <CompanyFooter onNavigate={openLegal} />}
    </div>
    </ElectronWorkspace>
  );
}

function RuntimeTab({ product }) {
  const { user, loading, logout, sessionExpiring, silentCheck } = useAuth();
  if (loading) return <div className="runtime-auth-loading">Checking access…</div>;
  if (!user)   return <LoginPage />;
  return (
    <div className={`runtime-tab-wrap runtime-tab-wrap--${product}`}>
      {sessionExpiring && (
        <div className="session-expiry-bar">
          <span>Session expires in ~5 minutes.</span>
          <button className="session-expiry-btn session-expiry-btn--verify" onClick={silentCheck}>Verify</button>
          <button className="session-expiry-btn session-expiry-btn--logout" onClick={logout}>Sign out</button>
        </div>
      )}
      <OperatorConsole product={product} />
    </div>
  );
}
