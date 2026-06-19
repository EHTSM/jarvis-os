import React, { useState, useEffect, useRef, useCallback, useMemo, Suspense, lazy } from "react";
import { AnimatePresence } from "framer-motion";
import { track } from "./analytics";
import { getBillingStatus } from "./billingApi";
import { checkHealth, getStats, getOpsData } from "./telemetryApi";
import { sendMessage } from "./api";
import { emergencyStop, emergencyResume } from "./runtimeApi";
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
import Chat, { MODELS }  from "./components/Chat.jsx";
import Dashboard          from "./components/Dashboard.jsx";
import CommandCenter      from "./components/CommandCenter.jsx";
import CompanyFooter      from "./components/legal/CompanyFooter.jsx";
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
const EnterpriseCRM            = lazy(() => import("./components/EnterpriseCRM.jsx"));
const WorkspaceSettings        = lazy(() => import("./components/WorkspaceSettings.jsx"));
const KnowledgeCenter          = lazy(() => import("./components/KnowledgeCenter.jsx"));
const IntegrationCenter        = lazy(() => import("./components/IntegrationCenter.jsx"));
const EngineeringCenter        = lazy(() => import("./components/EngineeringCenter.jsx"));
const EngineeringWorkspace     = lazy(() => import("./components/EngineeringWorkspace.jsx"));
const IntelligencePanel        = lazy(() => import("./components/IntelligencePanel.jsx"));
const PredictionPanel          = lazy(() => import("./components/PredictionPanel.jsx"));
const GuardrailsDashboard      = lazy(() => import("./components/GuardrailsDashboard.jsx"));
const RecommendationCenter     = lazy(() => import("./components/RecommendationCenter.jsx"));
const ExecutionCenter          = lazy(() => import("./components/ExecutionCenter.jsx"));
const ReliabilityCenter        = lazy(() => import("./components/ReliabilityCenter.jsx"));
const DevOpsCenterV2           = lazy(() => import("./components/DevOpsCenterV2.jsx"));
const SelfHealingCenter        = lazy(() => import("./components/SelfHealingCenter.jsx"));
const AgentRegistryCenter      = lazy(() => import("./components/AgentRegistryCenter.jsx"));
const TaskRouterCenter         = lazy(() => import("./components/TaskRouterCenter.jsx"));
const SharedMemoryCenter       = lazy(() => import("./components/SharedMemoryCenter.jsx"));
const OperationsCenter         = lazy(() => import("./components/OperationsCenter.jsx"));
const AgentCollaborationCenter = lazy(() => import("./components/AgentCollaborationCenter.jsx"));
const ToolFabricCenter         = lazy(() => import("./components/ToolFabricCenter.jsx"));
const AutonomousCompanyCenter  = lazy(() => import("./components/AutonomousCompanyCenter.jsx"));
const ExecutionOrchestratorCenter = lazy(() => import("./components/ExecutionOrchestratorCenter.jsx"));
const DataOwnershipCenter      = lazy(() => import("./components/DataOwnershipCenter.jsx"));
const SupportCenter            = lazy(() => import("./components/SupportCenter.jsx"));
const TrustComplianceCenter    = lazy(() => import("./components/TrustComplianceCenter.jsx"));
const DisasterRecoveryCenter   = lazy(() => import("./components/DisasterRecoveryCenter.jsx"));
const MobilePlatformCenter     = lazy(() => import("./components/MobilePlatformCenter.jsx"));
const CommunityCenter          = lazy(() => import("./components/CommunityCenter.jsx"));
const MarketplaceCenter        = lazy(() => import("./components/MarketplaceCenter.jsx"));
const AICostCenter             = lazy(() => import("./components/AICostCenter.jsx"));
const AutonomousRevenueCenter  = lazy(() => import("./components/AutonomousRevenueCenter.jsx"));
const AutonomousMarketingCenter = lazy(() => import("./components/AutonomousMarketingCenter.jsx"));
const AutonomousSupportCenter  = lazy(() => import("./components/AutonomousSupportCenter.jsx"));
const OoplixRunsOoplixCenter   = lazy(() => import("./components/OoplixRunsOoplixCenter.jsx"));
const AutonomousAgentDashboard = lazy(() => import("./components/AutonomousAgentDashboard.jsx"));
const AgentFactoryCenter       = lazy(() => import("./components/AgentFactoryCenter.jsx"));
const MemoryIntelligenceCenter = lazy(() => import("./components/MemoryIntelligenceCenter.jsx"));
const SelfImprovementCenter    = lazy(() => import("./components/SelfImprovementCenter.jsx"));
const JarvisBrainCenter        = lazy(() => import("./components/JarvisBrainCenter.jsx"));
const ExecutionConnectorCenter = lazy(() => import("./components/ExecutionConnectorCenter.jsx"));
const AutonomousWorkflowCenter = lazy(() => import("./components/AutonomousWorkflowCenter.jsx"));
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
const GrowthOSV2               = lazy(() => import("./components/GrowthOSV2.jsx"));
const PersonalOS               = lazy(() => import("./components/PersonalOS.jsx"));
const BusinessOS               = lazy(() => import("./components/BusinessOS.jsx"));
const DeveloperOS              = lazy(() => import("./components/DeveloperOS.jsx"));
const EnterpriseOS             = lazy(() => import("./components/EnterpriseOS.jsx"));
const CapabilitiesOverview     = lazy(() => import("./components/CapabilitiesOverview.jsx"));
const MissionControlV1         = lazy(() => import("./components/MissionControlV1.jsx"));
const ExecutiveDashboard       = lazy(() => import("./components/ExecutiveDashboard.jsx"));
const DevHUD                   = lazy(() => import("./components/DevHUD.jsx"));
const EndOfDayReview           = lazy(() => import("./components/EndOfDayReview.jsx"));
import WorkspaceSwitcher        from "./components/WorkspaceSwitcher.jsx";
import Tooltip                  from "./components/Tooltip.jsx";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts.js";
import { AuthProvider, useAuth } from "./contexts/AuthContext.jsx";
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

// Power-user overflow — all secondary modules, grouped by domain
const MORE_TABS = [
  // ── Account & Setup
  { id: "success",    label: "Getting Started",    group: "Account"      },
  { id: "billing",    label: "Billing",            group: "Account"      },
  { id: "settings",   label: "Settings",           group: "Account"      },
  { id: "help",       label: "Help & Guides",      group: "Account"      },
  { id: "betachecklist", label: "Beta Checklist",  group: "Account"      },
  { id: "overview",   label: "Overview",           group: "Account"      },
  // ── Operations
  { id: "activity",   label: "History",            group: "Operations"   },
  { id: "reports",    label: "Reports",            group: "Operations"   },
  { id: "mission",    label: "Mission Control",    group: "Operations"   },
  { id: "runtime",    label: "Runtime Console",    group: "Operations"   },
  { id: "execution",  label: "Execution",          group: "Operations"   },
  { id: "operations", label: "Operations",         group: "Operations"   },
  { id: "orchestrator",label:"Orchestrator",       group: "Operations"   },
  { id: "reliability",label: "Reliability",        group: "Operations"   },
  { id: "globalactivity", label:"Global Activity", group: "Operations"   },
  { id: "systemhealth",   label:"System Health",   group: "Operations"   },
  // ── AI & Agents
  { id: "agents",     label: "Agents",             group: "AI & Agents"  },
  { id: "agentruntime", label: "Agent Runtime",    group: "AI & Agents"  },
  { id: "agentfactory", label:"Agent Factory",     group: "AI & Agents"  },
  { id: "agentactions", label:"Agent Actions",     group: "AI & Agents"  },
  { id: "collab",     label: "Collaboration",      group: "AI & Agents"  },
  { id: "taskrouter", label: "Task Router",        group: "AI & Agents"  },
  { id: "registry",   label: "Registry",           group: "AI & Agents"  },
  { id: "toolfabric", label: "Tool Fabric",        group: "AI & Agents"  },
  { id: "autonomy",   label: "Autonomous Co",      group: "AI & Agents"  },
  { id: "autonomouswf",label:"Auto Workflows",     group: "AI & Agents"  },
  { id: "autonomyscore", label:"Autonomy Score",   group: "AI & Agents"  },
  // ── Intelligence
  { id: "intel",      label: "Intelligence",       group: "Intelligence" },
  { id: "predict",    label: "Prediction",         group: "Intelligence" },
  { id: "recommend",  label: "Recommendations",    group: "Intelligence" },
  { id: "guardrails", label: "Guardrails",         group: "Intelligence" },
  { id: "memory",     label: "Memory",             group: "Intelligence" },
  { id: "sharedmem",  label: "Memory Fabric",      group: "Intelligence" },
  { id: "memoryintel",label:"Memory Intel",        group: "Intelligence" },
  { id: "knowledge",  label: "Knowledge",          group: "Intelligence" },
  { id: "selfimprove",label:"Self-Improve",        group: "Intelligence" },
  { id: "jarvisbrain",label:"Jarvis Brain",        group: "Intelligence" },
  // ── Engineering
  { id: "engineering",label: "Engineering",        group: "Engineering"  },
  { id: "workspace",  label: "Eng Workspace",      group: "Engineering"  },
  { id: "copilot",    label: "Copilot",            group: "Engineering"  },
  { id: "devops",     label: "DevOps",             group: "Engineering"  },
  { id: "selfhealing",label: "Self-Healing",       group: "Engineering"  },
  { id: "developer",  label: "Developer OS",       group: "Engineering"  },
  { id: "execconnector", label:"Exec Connectors",  group: "Engineering"  },
  // ── Growth & Revenue
  { id: "seo",        label: "SEO",                group: "Growth"       },
  { id: "content",    label: "Content",            group: "Growth"       },
  { id: "social",     label: "Social",             group: "Growth"       },
  { id: "email",      label: "Email",              group: "Growth"       },
  { id: "referral",   label: "Referral",           group: "Growth"       },
  { id: "partners",   label: "Partners",           group: "Growth"       },
  { id: "launch",     label: "Launch",             group: "Growth"       },
  { id: "autorevenue",  label:"Auto Revenue",      group: "Growth"       },
  { id: "automarketing",label:"Auto Marketing",    group: "Growth"       },
  { id: "autosupport",  label:"Auto Support",      group: "Growth"       },
  { id: "aicost",     label: "AI Costs",           group: "Growth"       },
  // ── Enterprise & Platform
  { id: "personal",   label: "Personal OS",        group: "Enterprise"   },
  { id: "business",   label: "Business OS",        group: "Enterprise"   },
  { id: "enterprise", label: "Enterprise OS",      group: "Enterprise"   },
  { id: "team",       label: "Team",               group: "Enterprise"   },
  { id: "ecrm",       label: "Enterprise CRM",     group: "Enterprise"   },
  { id: "integrations",label:"Integrations",       group: "Enterprise"   },
  { id: "mobile",     label: "Mobile",             group: "Enterprise"   },
  { id: "marketplace",label: "Marketplace",        group: "Enterprise"   },
  { id: "community",  label: "Community",          group: "Enterprise"   },
  { id: "trustcompliance",label:"Trust",           group: "Enterprise"   },
  { id: "disasterrecovery",label:"Recovery",       group: "Enterprise"   },
  { id: "supportos",  label: "Support",            group: "Enterprise"   },
  { id: "dataowner",  label: "Data",               group: "Enterprise"   },
  { id: "oroplix",    label: "Ooplix Runs Ooplix", group: "Enterprise"   },
  { id: "executivedash",label:"Executive Dash",    group: "Enterprise"   },
];

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
function MoreMenu({ currentTab, onSelect }) {
  const [query,   setQuery]   = React.useState('');
  const [cursor,  setCursor]  = React.useState(0);
  const inputRef  = React.useRef(null);
  const listRef   = React.useRef(null);

  React.useEffect(() => { inputRef.current?.focus(); }, []);
  React.useEffect(() => { setCursor(0); }, [query]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? MORE_TABS.filter(m => m.label.toLowerCase().includes(q) || m.group?.toLowerCase().includes(q)) : MORE_TABS;
  }, [query]);

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
        {query.trim() ? (
          // Flat list when searching
          filtered.map((m, i) => (
            <button
              key={m.id}
              className={`tab-more-item${currentTab === m.id ? " active" : ""}${i === cursor ? " focused" : ""}`}
              role="menuitem"
              aria-current={currentTab === m.id ? "page" : undefined}
              onMouseEnter={() => setCursor(i)}
              onClick={() => onSelect(m.id)}
            >
              {m.label}
              {m.group && <span className="tab-more-item-group">{m.group}</span>}
            </button>
          ))
        ) : (
          // Grouped sections when not searching
          Object.entries(grouped).map(([group, items]) => (
            <div key={group} className="tab-more-group">
              <div className="tab-more-group-label">{group}</div>
              {items.map((m) => {
                const flatIdx = filtered.indexOf(m);
                return (
                  <button
                    key={m.id}
                    className={`tab-more-item${currentTab === m.id ? " active" : ""}${flatIdx === cursor ? " focused" : ""}`}
                    role="menuitem"
                    aria-current={currentTab === m.id ? "page" : undefined}
                    onMouseEnter={() => setCursor(flatIdx)}
                    onClick={() => onSelect(m.id)}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
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
  const { user, loading: authLoading } = useAuth();
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

      if (healthy) {
        const [st, ops] = await Promise.allSettled([getStats(), getOpsData()]);
        setStats(st.value   ?? null);
        setOpsData(ops.value ?? null);
      }
    };

    poll();
    const id = setInterval(() => { if (!document.hidden) poll(); }, 8000);
    return () => clearInterval(id);
  }, [screen, push]);

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
    setScreen("app");
    setTab("home");
  };

  // ── First-launch hint (dismissible, shown once after onboarding) ──
  const [showFirstLaunchHint, setShowFirstLaunchHint] = useState(
    () => localStorage.getItem("jarvis_just_onboarded") === "1"
  );
  const dismissFirstLaunchHint = useCallback(() => {
    localStorage.removeItem("jarvis_just_onboarded");
    setShowFirstLaunchHint(false);
  }, []);

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
          onSuccess={() => setScreen("app")}
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
            onSuccess={() => setScreen("app")}
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
          onSuccess={() => setScreen("app")}
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
                if (completed) { try { localStorage.setItem("ooplix_welcome_done", "1"); } catch {} }
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
          <div className="topbar-status" title={online ? "Runtime connected" : "Runtime offline"}>
            <span className={`online-dot${online ? "" : " online-dot--offline"}`} />
            <span>{online ? "Live" : "Offline"}</span>
          </div>
        </div>
      </header>

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
        {tab === "home"     && (
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
        {tab === "seo"       && <GrowthOSV2 onNavigate={setTab} initialTab="seo"      />}
        {tab === "content"   && <GrowthOSV2 onNavigate={setTab} initialTab="content"   />}
        {tab === "social"    && <GrowthOSV2 onNavigate={setTab} initialTab="social"    />}
        {tab === "email"     && <GrowthOSV2 onNavigate={setTab} initialTab="email"     />}
        {tab === "referral"  && <GrowthOSV2 onNavigate={setTab} initialTab="referral"  />}
        {tab === "partners"  && <PartnerProgram onNavigate={setTab} />}
        {tab === "launch"    && <GrowthOSV2 onNavigate={setTab} initialTab="launch"    />}
        {tab === "billing"   && (
          <BillingDashboard onUpgrade={() => setUpgradeOpen(true)} />
        )}
        {tab === "personal"  && <PersonalOS  onToast={addToast} />}
        {tab === "business"  && <BusinessOS  onToast={addToast} />}
        {tab === "developer" && <DeveloperOS onToast={addToast} />}
        {tab === "enterprise" && <EnterpriseOS onToast={addToast} />}
        {tab === "team"      && <TeamWorkspace onNavigate={setTab} />}
        {tab === "ecrm"      && <EnterpriseCRM onNavigate={setTab} />}
        {tab === "reports"   && <ReportsV2 onNavigate={setTab} online={online} />}
        {tab === "settings"      && <WorkspaceSettings  onNavigate={setTab} />}
        {tab === "knowledge"     && <KnowledgeCenter   onNavigate={setTab} />}
        {tab === "memory"        && <MemoryOSV2          onNavigate={setTab} />}
        {tab === "integrations"  && <IntegrationCenter  onNavigate={setTab} />}
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
        {tab === "devops"        && <DevOpsCenterV2         onNavigate={setTab} />}
        {tab === "selfhealing"   && <SelfHealingCenter      onNavigate={setTab} />}
        {tab === "registry"      && <AgentRegistryCenter   onNavigate={setTab} />}
        {tab === "taskrouter"    && <TaskRouterCenter       onNavigate={setTab} />}
        {tab === "sharedmem"     && <SharedMemoryCenter     onNavigate={setTab} />}
        {tab === "operations"    && <OperationsCenter            onNavigate={setTab} />}
        {tab === "collab"        && <AgentCollaborationCenter    onNavigate={setTab} />}
        {tab === "toolfabric"    && <ToolFabricCenter            onNavigate={setTab} />}
        {tab === "autonomy"      && <AutonomousCompanyCenter     onNavigate={setTab} />}
        {tab === "orchestrator"      && <ExecutionOrchestratorCenter onNavigate={setTab} />}
        {tab === "dataowner"         && <DataOwnershipCenter        onNavigate={setTab} />}
        {tab === "supportos"         && <SupportCenter              onNavigate={setTab} />}
        {tab === "trustcompliance"   && <TrustComplianceCenter      onNavigate={setTab} />}
        {tab === "disasterrecovery"  && <DisasterRecoveryCenter     onNavigate={setTab} />}
        {tab === "mobile"            && <MobilePlatformCenter       onNavigate={setTab} />}
        {tab === "community"         && <CommunityCenter            onNavigate={setTab} />}
        {tab === "marketplace"       && <MarketplaceCenter          onNavigate={setTab} />}
        {tab === "aicost"            && <AICostCenter               onNavigate={setTab} />}
        {tab === "autorevenue"       && <AutonomousRevenueCenter    onNavigate={setTab} />}
        {tab === "automarketing"     && <AutonomousMarketingCenter  onNavigate={setTab} />}
        {tab === "autosupport"       && <AutonomousSupportCenter    onNavigate={setTab} />}
        {tab === "oroplix"           && <OoplixRunsOoplixCenter     onNavigate={setTab} />}
        {tab === "agentruntime"      && <AutonomousAgentDashboard />}
        {tab === "agentfactory"      && <AgentFactoryCenter         onNavigate={setTab} />}
        {tab === "memoryintel"       && <MemoryIntelligenceCenter   onNavigate={setTab} />}
        {tab === "selfimprove"       && <SelfImprovementCenter      onNavigate={setTab} />}
        {tab === "jarvisbrain"       && <JarvisBrainCenter          onNavigate={setTab} />}
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
