import React, { useState, useEffect, useRef, useCallback, useMemo, Suspense, lazy } from "react";
import { track, pageView } from "./analytics";
import { getBillingStatus } from "./billingApi";
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
import Landing            from "./components/Landing.jsx";
import LandingPage        from "./components/LandingPage.jsx";
import Onboarding         from "./components/Onboarding.jsx";
import Chat               from "./components/Chat.jsx";
import Dashboard          from "./components/Dashboard.jsx";
import CommandCenter      from "./components/CommandCenter.jsx";
import ControlCenter      from "./components/ControlCenter.jsx";
import PricingPage        from "./components/PricingPage.jsx";
import CompanyFooter      from "./components/legal/CompanyFooter.jsx";
import CompanyPage        from "./components/legal/CompanyPage.jsx";
import PrivacyPolicy      from "./components/legal/PrivacyPolicy.jsx";
import TermsOfService     from "./components/legal/TermsOfService.jsx";
import RefundPolicy       from "./components/legal/RefundPolicy.jsx";
import ContactPage        from "./components/legal/ContactPage.jsx";
import TrustCompliance    from "./components/legal/TrustCompliance.jsx";
import CommandPalette     from "./components/CommandPalette.jsx";
import ShortcutsOverlay   from "./components/ShortcutsOverlay.jsx";
import ElectronUpdateBanner from "./components/ElectronUpdateBanner.jsx";
import ElectronOfflineBar   from "./components/ElectronOfflineBar.jsx";
import ElectronWorkspace    from "./components/ElectronWorkspace.jsx";
import { OoplixWordmark }   from "./design/OoplixWordmark.jsx";

// ── Lazy-loaded: secondary/overflow tab components ───────────────────────────
const BillingDashboard         = lazy(() => import("./components/BillingDashboard.jsx"));
const SuccessCenter            = lazy(() => import("./components/SuccessCenter.jsx"));
const HelpHub                  = lazy(() => import("./components/HelpHub.jsx"));
const SeoCommandCenter         = lazy(() => import("./components/SeoCommandCenter.jsx"));
const ContentEngine            = lazy(() => import("./components/ContentEngine.jsx"));
const SocialHub                = lazy(() => import("./components/SocialHub.jsx"));
const EmailMarketingOS         = lazy(() => import("./components/EmailMarketingOS.jsx"));
const ReferralEngine           = lazy(() => import("./components/ReferralEngine.jsx"));
const PartnerProgram           = lazy(() => import("./components/PartnerProgram.jsx"));
const LaunchCommandCenter      = lazy(() => import("./components/LaunchCommandCenter.jsx"));
const TeamWorkspace            = lazy(() => import("./components/TeamWorkspace.jsx"));
const EnterpriseCRM            = lazy(() => import("./components/EnterpriseCRM.jsx"));
const WorkspaceSettings        = lazy(() => import("./components/WorkspaceSettings.jsx"));
const KnowledgeCenter          = lazy(() => import("./components/KnowledgeCenter.jsx"));
const MemoryCenter             = lazy(() => import("./components/MemoryCenter.jsx"));
const IntegrationCenter        = lazy(() => import("./components/IntegrationCenter.jsx"));
const AgentCenter              = lazy(() => import("./components/AgentCenter.jsx"));
const DeveloperCopilotCenter   = lazy(() => import("./components/DeveloperCopilotCenter.jsx"));
const EngineeringCenter        = lazy(() => import("./components/EngineeringCenter.jsx"));
const EngineeringWorkspace     = lazy(() => import("./components/EngineeringWorkspace.jsx"));
const IntelligencePanel        = lazy(() => import("./components/IntelligencePanel.jsx"));
const PredictionPanel          = lazy(() => import("./components/PredictionPanel.jsx"));
const GuardrailsDashboard      = lazy(() => import("./components/GuardrailsDashboard.jsx"));
const RecommendationCenter     = lazy(() => import("./components/RecommendationCenter.jsx"));
const ExecutionCenter          = lazy(() => import("./components/ExecutionCenter.jsx"));
const ReliabilityCenter        = lazy(() => import("./components/ReliabilityCenter.jsx"));
const DevOpsCenter             = lazy(() => import("./components/DevOpsCenter.jsx"));
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
const Logs                     = lazy(() => import("./components/Logs.jsx"));
const ContactsV2               = lazy(() => import("./components/ContactsV2.jsx"));
const PaymentsV2               = lazy(() => import("./components/PaymentsV2.jsx"));
const ReportsV2                = lazy(() => import("./components/ReportsV2.jsx"));
const AgentOSV2                = lazy(() => import("./components/AgentOSV2.jsx"));
const MemoryOSV2               = lazy(() => import("./components/MemoryOSV2.jsx"));
const WorkflowOSV2             = lazy(() => import("./components/WorkflowOSV2.jsx"));
const DeveloperCopilotV2       = lazy(() => import("./components/DeveloperCopilotV2.jsx"));
const DevOpsCenterV2           = lazy(() => import("./components/DevOpsCenterV2.jsx"));
const GrowthOSV2               = lazy(() => import("./components/GrowthOSV2.jsx"));
const PersonalOS               = lazy(() => import("./components/PersonalOS.jsx"));
const BusinessOS               = lazy(() => import("./components/BusinessOS.jsx"));
const DeveloperOS              = lazy(() => import("./components/DeveloperOS.jsx"));
const EnterpriseOS             = lazy(() => import("./components/EnterpriseOS.jsx"));
const CapabilitiesOverview     = lazy(() => import("./components/CapabilitiesOverview.jsx"));
const MissionControlV1         = lazy(() => import("./components/MissionControlV1.jsx"));
const ExecutiveDashboard       = lazy(() => import("./components/ExecutiveDashboard.jsx"));
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

// Power-user overflow — all secondary modules
const MORE_TABS = [
  { id: "success",    label: "Getting Started" },
  { id: "activity",   label: "History"         },
  { id: "billing",    label: "Billing"         },
  { id: "help",       label: "Help & Guides"   },
  { id: "reports",    label: "Reports"         },
  { id: "settings",   label: "Settings"        },
  { id: "mission",    label: "Mission Control" },
  { id: "runtime",    label: "Execution"       },
  { id: "agents",     label: "Agents"          },
  { id: "seo",        label: "SEO"             },
  { id: "content",    label: "Content"         },
  { id: "social",     label: "Social"          },
  { id: "email",      label: "Email"           },
  { id: "referral",   label: "Referral"        },
  { id: "partners",   label: "Partners"        },
  { id: "launch",     label: "Launch"          },
  { id: "personal",   label: "Personal"        },
  { id: "business",   label: "Business"        },
  { id: "developer",  label: "Developer"       },
  { id: "enterprise", label: "Enterprise"      },
  { id: "team",       label: "Team"            },
  { id: "ecrm",       label: "Enterprise CRM"  },
  { id: "knowledge",  label: "Knowledge"       },
  { id: "memory",     label: "Memory"          },
  { id: "integrations",label:"Integrations"    },
  { id: "copilot",    label: "Copilot"         },
  { id: "engineering",label: "Engineering"     },
  { id: "workspace",  label: "Eng Workspace"  },
  { id: "intel",      label: "Intelligence"   },
  { id: "predict",    label: "Prediction"     },
  { id: "guardrails", label: "Guardrails"     },
  { id: "recommend",  label: "Recommend"      },
  { id: "execution",   label: "Execution"      },
  { id: "reliability", label: "Reliability"    },
  { id: "devops",     label: "DevOps"          },
  { id: "selfhealing",label: "Self-Healing"    },
  { id: "registry",   label: "Registry"        },
  { id: "taskrouter", label: "Task Router"     },
  { id: "sharedmem",  label: "Memory Fabric"   },
  { id: "operations", label: "Operations"      },
  { id: "collab",     label: "Collaboration"   },
  { id: "toolfabric", label: "Tool Fabric"     },
  { id: "autonomy",   label: "Autonomous Co"   },
  { id: "orchestrator",label:"Orchestrator"    },
  { id: "dataowner",  label: "Data"            },
  { id: "supportos",  label: "Support"         },
  { id: "trustcompliance", label:"Trust"       },
  { id: "disasterrecovery",label:"Recovery"    },
  { id: "mobile",     label: "Mobile"          },
  { id: "community",  label: "Community"       },
  { id: "marketplace",label: "Marketplace"     },
  { id: "aicost",     label: "AI Costs"        },
  { id: "autorevenue",  label:"Auto Revenue"   },
  { id: "automarketing",label:"Auto Marketing" },
  { id: "autosupport",  label:"Auto Support"   },
  { id: "oroplix",    label: "Ooplix Runs Ooplix" },
  { id: "agentfactory", label:"Agent Factory"  },
  { id: "memoryintel",  label:"Memory Intel"   },
  { id: "selfimprove",  label:"Self-Improve"   },
  { id: "jarvisbrain",    label:"Jarvis Brain"     },
  { id: "executivedash",  label:"Executive Dash"   },
  { id: "execconnector",  label:"Exec Connectors"  },
  { id: "autonomouswf", label:"Auto Workflows" },
  { id: "agentactions", label:"Agent Actions"  },
  { id: "autonomyscore",   label:"Autonomy Score"     },
  { id: "globalactivity", label:"Global Activity"    },
  { id: "systemhealth",   label:"System Health"      },
  { id: "overview",       label: "Overview"          },
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

// ── More ▾ dropdown with live search ─────────────────────────────────────────
function MoreMenu({ currentTab, onSelect }) {
  const [query, setQuery] = React.useState('');
  const inputRef = React.useRef(null);

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = query.trim()
    ? MORE_TABS.filter(m => m.label.toLowerCase().includes(query.toLowerCase()))
    : MORE_TABS;

  return (
    <div className="tab-more-menu" role="menu">
      <div className="tab-more-search-wrap">
        <input
          ref={inputRef}
          className="tab-more-search"
          placeholder="Search tabs…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape') { e.stopPropagation(); onSelect(currentTab); }
            if (e.key === 'Enter' && filtered.length > 0) { e.preventDefault(); onSelect(filtered[0].id); }
          }}
          aria-label="Search tabs"
        />
      </div>
      <div className="tab-more-list">
        {filtered.map(m => (
          <button
            key={m.id}
            className={`tab-more-item${currentTab === m.id ? " active" : ""}`}
            role="menuitem"
            onClick={() => onSelect(m.id)}
          >
            {m.label}
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="tab-more-empty">No tabs match "{query}"</div>
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
  const [tab,      _setTab]     = useState("home");
  const tabHistory  = useRef(["home"]);
  const tabFuture   = useRef([]);
  const setTab = useCallback((next) => {
    _setTab(prev => {
      if (prev === next) return prev;
      tabHistory.current.push(next);
      if (tabHistory.current.length > 40) tabHistory.current.shift();
      tabFuture.current = [];
      return next;
    });
  }, []);
  const [moreOpen,    setMoreOpen]    = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
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
    const id = setInterval(poll, 8000);
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
  useElectronEvent('onMenuAction',       (act)  => { if (act === 'new-contact') setTab('clients'); }, []);
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

    try {
      const res = await sendMessage(cmd, "smart");
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
  }, [input, loading, online, push, addToast]);

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
  if (screen === "pricing")    return <PricingPage onBack={() => setScreen("landing")} onStart={handleStart} />;
  if (screen === "landing")    return <LandingPage onStart={handleStart} onLogin={handleLogin} onLegal={openLegal} onPricing={() => setScreen("pricing")} />;
  if (screen === "onboarding") return <Onboarding onComplete={handleOnboardingComplete} />;

  // ── Signup screen (reached after Onboarding, or from Login "Create account") ──
  if (screen === "signup") {
    return (
      <div className="app-auth-gate">
        <SignupPage
          onSuccess={handleSignupComplete}
          onLogin={() => setScreen("login")}
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
      pricing: <PricingPage onBack={closeLegal} onStart={() => { closeLegal(); handleStart(); }} onUpgrade={(planId) => { closeLegal(); setUpgradeOpen(true); }} />,
    };
    return (
      <div className={`app app--${_PRODUCT}`}>
        {LEGAL_PAGES[legalPage] || <CompanyPage onBack={closeLegal} />}
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
      {/* Global overlays */}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onNavigate={(tabId) => { setTab(tabId); setMoreOpen(false); }}
        onAsk={(text) => {
          setTab("chat");
          if (text) setTimeout(() => handleSend(text), 150);
        }}
      />
      <ShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

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
                    {secondaryActive ? (MORE_TABS.find(m => m.id === tab)?.label ?? "More") + " ▾" : "More ▾"}
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
              >
                {t.label}
              </button>
            );
          })}
        </nav>

        <div className="topbar-actions">
          {/* Back / Forward nav arrows */}
          <button
            className="topbar-nav-arrow"
            disabled={tabHistory.current.length < 2}
            title="Go back (⌘[)"
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
          <button
            className="topbar-nav-arrow"
            disabled={tabFuture.current.length === 0}
            title="Go forward (⌘])"
            onClick={() => {
              const next = tabFuture.current.shift();
              if (!next) return;
              tabHistory.current.push(next);
              _setTab(next);
            }}
            aria-label="Go forward"
          >›</button>
          {(tab === "home" || tab === "runtime") && (
            opsData?.status === "critical" ? (
              <button
                className="btn btn--success btn--sm"
                title="Resume all executions"
                onClick={async () => {
                  const r = await emergencyResume();
                  if (r.success) addToast("success", "Execution resumed");
                  else addToast("error", r.error || "Resume failed");
                }}
              >Resume</button>
            ) : (
              <button
                className="btn btn--danger btn--sm"
                title="Emergency stop — halt all task execution"
                onClick={async () => {
                  const r = await emergencyStop();
                  if (r.success) addToast("warn", "Emergency stop active — all execution halted", 6000);
                  else addToast("error", r.error || "Stop failed");
                }}
              >Stop</button>
            )
          )}
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
        <div key={tab} className="app-tab-pane">
        {tab === "mission"  && <MissionControlV1 onNavigate={setTab} />}
        {tab === "home"     && (
          <CommandCenter
            stats={stats}
            opsData={opsData}
            online={online}
            onNavigate={setTab}
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
        {tab === "runtime"           && <RuntimeTab product={_PRODUCT} />}
        </div>
      </main>
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
