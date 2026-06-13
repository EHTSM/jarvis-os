import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { track, pageView } from "./analytics";
import { getBillingStatus } from "./billingApi";
import TrialBanner   from "./components/TrialBanner.jsx";
import UpgradeModal      from "./components/UpgradeModal.jsx";
import BillingDashboard  from "./components/BillingDashboard.jsx";
import SuccessCenter     from "./components/SuccessCenter.jsx";
import HelpHub            from "./components/HelpHub.jsx";
import SeoCommandCenter   from "./components/SeoCommandCenter.jsx";
import ContentEngine      from "./components/ContentEngine.jsx";
import SocialHub          from "./components/SocialHub.jsx";
import EmailMarketingOS   from "./components/EmailMarketingOS.jsx";
import ReferralEngine     from "./components/ReferralEngine.jsx";
import PartnerProgram     from "./components/PartnerProgram.jsx";
import LaunchCommandCenter from "./components/LaunchCommandCenter.jsx";
import TeamWorkspace      from "./components/TeamWorkspace.jsx";
import EnterpriseCRM      from "./components/EnterpriseCRM.jsx";
import WorkspaceSettings  from "./components/WorkspaceSettings.jsx";
import KnowledgeCenter         from "./components/KnowledgeCenter.jsx";
import MemoryCenter            from "./components/MemoryCenter.jsx";
import IntegrationCenter       from "./components/IntegrationCenter.jsx";
import AgentCenter             from "./components/AgentCenter.jsx";
import DeveloperCopilotCenter  from "./components/DeveloperCopilotCenter.jsx";
import EngineeringCenter       from "./components/EngineeringCenter.jsx";
import EngineeringWorkspace    from "./components/EngineeringWorkspace.jsx";
import IntelligencePanel       from "./components/IntelligencePanel.jsx";
import PredictionPanel        from "./components/PredictionPanel.jsx";
import DevOpsCenter            from "./components/DevOpsCenter.jsx";
import SelfHealingCenter       from "./components/SelfHealingCenter.jsx";
import AgentRegistryCenter     from "./components/AgentRegistryCenter.jsx";
import TaskRouterCenter        from "./components/TaskRouterCenter.jsx";
import SharedMemoryCenter      from "./components/SharedMemoryCenter.jsx";
import OperationsCenter             from "./components/OperationsCenter.jsx";
import AgentCollaborationCenter     from "./components/AgentCollaborationCenter.jsx";
import ToolFabricCenter             from "./components/ToolFabricCenter.jsx";
import AutonomousCompanyCenter      from "./components/AutonomousCompanyCenter.jsx";
import ExecutionOrchestratorCenter  from "./components/ExecutionOrchestratorCenter.jsx";
import DataOwnershipCenter          from "./components/DataOwnershipCenter.jsx";
import SupportCenter                from "./components/SupportCenter.jsx";
import TrustComplianceCenter        from "./components/TrustComplianceCenter.jsx";
import DisasterRecoveryCenter       from "./components/DisasterRecoveryCenter.jsx";
import MobilePlatformCenter         from "./components/MobilePlatformCenter.jsx";
import CommunityCenter              from "./components/CommunityCenter.jsx";
import MarketplaceCenter            from "./components/MarketplaceCenter.jsx";
import AICostCenter                 from "./components/AICostCenter.jsx";
import AutonomousRevenueCenter      from "./components/AutonomousRevenueCenter.jsx";
import AutonomousMarketingCenter    from "./components/AutonomousMarketingCenter.jsx";
import AutonomousSupportCenter      from "./components/AutonomousSupportCenter.jsx";
import OoplixRunsOoplixCenter       from "./components/OoplixRunsOoplixCenter.jsx";
import AgentFactoryCenter           from "./components/AgentFactoryCenter.jsx";
import MemoryIntelligenceCenter     from "./components/MemoryIntelligenceCenter.jsx";
import SelfImprovementCenter        from "./components/SelfImprovementCenter.jsx";
import JarvisBrainCenter            from "./components/JarvisBrainCenter.jsx";
import ExecutionConnectorCenter     from "./components/ExecutionConnectorCenter.jsx";
import AutonomousWorkflowCenter     from "./components/AutonomousWorkflowCenter.jsx";
import AgentActionCenter            from "./components/AgentActionCenter.jsx";
import AutonomyScoreCenter          from "./components/AutonomyScoreCenter.jsx";
import { sendMessage, checkHealth, getStats, getOpsData, emergencyStop, emergencyResume } from "./api";
import Chat            from "./components/Chat.jsx";
import Dashboard       from "./components/Dashboard.jsx";
import Logs            from "./components/Logs.jsx";
import ContactsV2      from "./components/ContactsV2.jsx";
import PaymentsV2      from "./components/PaymentsV2.jsx";
import ReportsV2       from "./components/ReportsV2.jsx";
import AgentOSV2      from "./components/AgentOSV2.jsx";
import MemoryOSV2     from "./components/MemoryOSV2.jsx";
import WorkflowOSV2   from "./components/WorkflowOSV2.jsx";
import DeveloperCopilotV2 from "./components/DeveloperCopilotV2.jsx";
import DevOpsCenterV2    from "./components/DevOpsCenterV2.jsx";
import GrowthOSV2       from "./components/GrowthOSV2.jsx";
import Landing         from "./components/Landing.jsx";
import Onboarding      from "./components/Onboarding.jsx";
import ConnectBar      from "./components/ConnectBar.jsx";
import ToastContainer  from "./components/Toast.jsx";
import ProgressBar     from "./components/ProgressBar.jsx";
import OperatorConsole from "./components/operator/OperatorConsole.jsx";
import LoginPage       from "./components/auth/LoginPage.jsx";
import SignupPage      from "./components/auth/SignupPage.jsx";
import ForgotPassword  from "./components/auth/ForgotPassword.jsx";
import PersonalOS      from "./components/PersonalOS.jsx";
import BusinessOS      from "./components/BusinessOS.jsx";
import DeveloperOS     from "./components/DeveloperOS.jsx";
import EnterpriseOS          from "./components/EnterpriseOS.jsx";
import CapabilitiesOverview  from "./components/CapabilitiesOverview.jsx";
import CompanyFooter         from "./components/legal/CompanyFooter.jsx";
import CompanyPage           from "./components/legal/CompanyPage.jsx";
import PrivacyPolicy         from "./components/legal/PrivacyPolicy.jsx";
import TermsOfService        from "./components/legal/TermsOfService.jsx";
import RefundPolicy          from "./components/legal/RefundPolicy.jsx";
import ContactPage           from "./components/legal/ContactPage.jsx";
import TrustCompliance       from "./components/legal/TrustCompliance.jsx";
import PricingPage           from "./components/PricingPage.jsx";
import ControlCenter         from "./components/ControlCenter.jsx";
import MissionControlV1      from "./components/MissionControlV1.jsx";
import CommandPalette        from "./components/CommandPalette.jsx";
import { AuthProvider, useAuth } from "./contexts/AuthContext.jsx";
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
  { id: "jarvisbrain",  label:"Jarvis Brain"   },
  { id: "execconnector",label:"Exec Connectors"},
  { id: "autonomouswf", label:"Auto Workflows" },
  { id: "agentactions", label:"Agent Actions"  },
  { id: "autonomyscore",label:"Autonomy Score" },
  { id: "overview",   label: "Overview"        },
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
  const [tab,      setTab]      = useState("home");
  const [moreOpen,    setMoreOpen]    = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
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

  // ── Global Cmd+K / Ctrl+K shortcut ───────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPaletteOpen(o => { if (!o) track.commandPaletteOpened("keyboard"); return !o; });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

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
  if (screen === "landing")    return <Landing onStart={handleStart} onLogin={handleLogin} onLegal={openLegal} onPricing={() => setScreen("pricing")} />;
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
    <div className={`app app--${_PRODUCT}${opsData?.status === "critical" ? " app--emergency" : ""}`}>
      <ProgressBar visible={loading} />
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <header className="app-header">
        <div className="brand">
          <span className="logo">J</span>
          <span className="brand-name">Ooplix</span>
        </div>
        <div className="header-right">
          {/* Emergency controls on Control Center and Execution tabs */}
          {(tab === "home" || tab === "runtime") && (
            opsData?.status === "critical" ? (
              <button
                className="btn-sm btn-success"
                title="Resume all executions"
                onClick={async () => {
                  const r = await emergencyResume();
                  if (r.success) addToast("success", "Execution resumed");
                  else addToast("error", r.error || "Resume failed");
                }}
              >Resume</button>
            ) : (
              <button
                className="btn-sm btn-danger"
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
            className="cmd-palette-trigger"
            onClick={() => setPaletteOpen(true)}
            title="Command Palette (⌘K)"
            aria-label="Open command palette"
          >
            <span className="cmd-palette-trigger-icon">⌕</span>
            <span className="cmd-palette-trigger-label">Search…</span>
            <kbd className="cmd-palette-trigger-kbd">⌘K</kbd>
          </button>
          <div className={`status-dot ${online ? "online" : "offline"}`}
               title={online ? "Connected" : "Offline"} />
          {!online && (
            <span className="status-reconnect">Reconnecting…</span>
          )}
        </div>
      </header>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onNavigate={(tabId) => { setTab(tabId); setMoreOpen(false); }}
        onAsk={(text) => {
          setTab("chat");
          // Push the query into the chat input via the existing handleSend
          if (text) setTimeout(() => handleSend(text), 150);
        }}
      />

      <nav className="tabs" onClick={() => setMoreOpen(false)}>
        {(_IS_DESKTOP ? DESKTOP_TABS : TABS).map(t => {
          // "More" tab — renders a dropdown of secondary tabs
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
                  <div className="tab-more-menu" role="menu">
                    {MORE_TABS.map(m => (
                      <button
                        key={m.id}
                        className={`tab-more-item${tab === m.id ? " active" : ""}`}
                        role="menuitem"
                        onClick={() => { setTab(m.id); setMoreOpen(false); }}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
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

      <main className="app-main">
        {/* key forces remount on tab change — triggers page-enter CSS animation */}
        <div key={tab} className="app-tab-pane">
        {tab === "mission"  && <MissionControlV1 onNavigate={setTab} />}
        {tab === "home"     && (
          <ControlCenter
            stats={stats}
            opsData={opsData}
            online={online}
            onNavigate={setTab}
            billing={billing}
            onUpgrade={() => setUpgradeOpen(true)}
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
        {tab === "execconnector"     && <ExecutionConnectorCenter   onNavigate={setTab} />}
        {tab === "autonomouswf"      && <WorkflowOSV2               onNavigate={setTab} />}
        {tab === "agentactions"      && <AgentActionCenter          onNavigate={setTab} />}
        {tab === "autonomyscore"     && <AutonomyScoreCenter        onNavigate={setTab} />}
        {tab === "runtime"           && <RuntimeTab product={_PRODUCT} />}
        </div>
      </main>
      {!_IS_DESKTOP && <CompanyFooter onNavigate={openLegal} />}
    </div>
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
