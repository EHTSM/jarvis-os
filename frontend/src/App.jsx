import React, { useState, useEffect, useRef, useCallback } from "react";
import { sendMessage, checkHealth, getStats, getOpsData, emergencyStop, emergencyResume } from "./api";
import Chat            from "./components/Chat.jsx";
import Dashboard       from "./components/Dashboard.jsx";
import Logs            from "./components/Logs.jsx";
import PaymentPanel    from "./components/PaymentPanel.jsx";
import Landing         from "./components/Landing.jsx";
import Onboarding      from "./components/Onboarding.jsx";
import ConnectBar      from "./components/ConnectBar.jsx";
import ToastContainer  from "./components/Toast.jsx";
import ProgressBar     from "./components/ProgressBar.jsx";
import OperatorConsole from "./components/operator/OperatorConsole.jsx";
import LoginPage       from "./components/auth/LoginPage.jsx";
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
import { AuthProvider, useAuth } from "./contexts/AuthContext.jsx";
import "./App.css";

// Web: 5 primary tabs — secondary modules in "More" overflow
const TABS = [
  { id: "runtime",  label: "Control Room", featured: true },
  { id: "chat",     label: "Intelligence"  },
  { id: "insights", label: "Pipeline"      },
  { id: "clients",  label: "Contacts"      },
  { id: "more",     label: "More ▾"        },
];

// Secondary tabs shown in the More dropdown
const MORE_TABS = [
  { id: "overview",   label: "Overview"    },
  { id: "activity",   label: "History"     },
  { id: "personal",   label: "Personal"    },
  { id: "business",   label: "Business"    },
  { id: "developer",  label: "Developer"   },
  { id: "enterprise", label: "Enterprise"  },
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

// Desktop: same 5-tab structure — runtime is already default here
const DESKTOP_TABS = [
  { id: "runtime",  label: "Control Room", featured: true },
  { id: "chat",     label: "Intelligence"  },
  { id: "insights", label: "Pipeline"      },
  { id: "clients",  label: "Contacts"      },
  { id: "more",     label: "More ▾"        },
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
  // Both web and desktop default to Control Room — it IS the product
  const [tab,      setTab]      = useState("runtime");
  const [moreOpen, setMoreOpen] = useState(false);
  const [stats,     setStats]     = useState(null);
  const [opsData,   setOpsData]   = useState(null);
  const [toasts,    setToasts]    = useState([]);
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
    setScreen("onboarding");
  };

  // Login: show the login screen — authentication happens there before app access
  const handleLogin = () => {
    localStorage.setItem("jarvis_started", "1");
    setScreen("login");
  };

  // ── Onboarding complete ───────────────────────────────────────────
  const handleOnboardingComplete = (profile) => {
    setMessages([{
      id: Date.now(), role: "jarvis",
      text: `Setup complete! Ooplix is ready for your ${profile.business || "business"}.\n\nAdd your first client below — enter their name and WhatsApp number, and I'll take it from there.`,
      ts:   Date.now()
    }]);
    localStorage.setItem("jarvis_just_onboarded", "1");
    setScreen("app");
    setTab("clients");
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

  // ── Explicit login screen (reached via "Sign in" on landing) ──────
  if (screen === "login") {
    return (
      <div className="app-auth-gate">
        <LoginPage onSuccess={() => setScreen("app")} />
      </div>
    );
  }

  // ── Auth gate for main app ────────────────────────────────────────
  // All meaningful API calls require a session. Block the app until the
  // user is authenticated. authLoading is true only on initial mount
  // while the session cookie is being verified.
  if (authLoading) return <div className="runtime-auth-loading">Loading…</div>;
  if (!user) {
    // context="fresh" when user just came through onboarding — explains the password ask
    const justOnboarded = localStorage.getItem("jarvis_just_onboarded") === "1";
    return (
      <div className="app-auth-gate">
        <LoginPage context={justOnboarded ? "fresh" : undefined} onSuccess={() => {/* AuthContext updates user */}} />
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
      pricing: <PricingPage onBack={closeLegal} onStart={() => { closeLegal(); handleStart(); }} />,
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
          {/* Phase 1657: emergency controls only shown on runtime/cockpit tab — reduce clutter */}
          {tab === "runtime" && (
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
          <div className={`status-dot ${online ? "online" : "offline"}`}
               title={online ? "Connected" : "Offline"} />
          {!online && (
            <span className="status-reconnect">Reconnecting…</span>
          )}
        </div>
      </header>

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
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          );
        })}
      </nav>

      {tab !== "runtime" && !_IS_DESKTOP && (
        <ConnectBar
          services={opsData?.services || {}}
          onSetupWhatsApp={() => setTab("clients")}
        />
      )}

      {showFirstLaunchHint && !_IS_DESKTOP && (
        <div className="first-launch-hint">
          <span className="first-launch-title">Welcome to Ooplix!</span>
          <span className="first-launch-body">
            Not sure where to start?{" "}
            <button
              className="first-launch-link"
              onClick={() => { setTab("overview"); dismissFirstLaunchHint(); }}
            >
              See what Ooplix can do →
            </button>
          </span>
          <button className="first-launch-dismiss" onClick={dismissFirstLaunchHint}>✕</button>
        </div>
      )}

      <main className="app-main">
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
        {tab === "clients"   && (
          <PaymentPanel
            onMessage={push}
            onToast={addToast}
            whatsappConnected={opsData?.services?.whatsapp ?? false}
          />
        )}
        {tab === "personal"  && <PersonalOS  onToast={addToast} />}
        {tab === "business"  && <BusinessOS  onToast={addToast} />}
        {tab === "developer" && <DeveloperOS onToast={addToast} />}
        {tab === "enterprise" && <EnterpriseOS onToast={addToast} />}
        {tab === "runtime"   && <RuntimeTab product={_PRODUCT} />}
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
