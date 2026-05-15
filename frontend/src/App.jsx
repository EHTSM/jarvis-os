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
import { AuthProvider, useAuth } from "./contexts/AuthContext.jsx";
import "./App.css";

const TABS = [
  { id: "chat",     label: "Chat"       },
  { id: "insights", label: "Revenue"    },
  { id: "activity", label: "Automation" },
  { id: "clients",  label: "Clients"    },
  { id: "runtime",  label: "Runtime"    },
];

// ── Determine initial screen from localStorage ───────────────────
function _initialScreen() {
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
    return "Hi! I'm JARVIS — your automated sales assistant.\n\nI follow up with leads on WhatsApp, generate payment links, and help close clients.\n\nWhat would you like to do first?";
  }
  return `Hi! JARVIS is set up for your ${profile.business || "business"}.\n\nI'll automatically follow up with every lead and send payment links when they're ready to buy.\n\nType anything to get started — or use the quick actions below.`;
}

export default function App() {
  return <AuthProvider><AppInner /></AuthProvider>;
}

function AppInner() {
  const [screen,   setScreen]   = useState(_initialScreen);
  const [messages, setMessages] = useState(() => [{
    id: 1, role: "jarvis",
    text: _welcomeMessage(_loadProfile()),
    ts: Date.now()
  }]);
  const [input,   setInput]   = useState("");
  const [loading, setLoading] = useState(false);
  const [online,  setOnline]  = useState(false);
  const [tab,     setTab]     = useState("chat");
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

  // ── Health + data polling (only when in app screen) ───────────────
  useEffect(() => {
    if (screen !== "app") return;
    let wasOnline = false;

    const poll = async () => {
      const healthy = await checkHealth();
      if (!wasOnline && healthy)  push("system", "Connected to JARVIS.");
      if (wasOnline  && !healthy) push("system", "Connection lost — reconnecting…");
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

  // Login: skip onboarding, go straight to app (returns user with existing data)
  const handleLogin = () => {
    localStorage.setItem("jarvis_started", "1");
    setScreen("app");
  };

  // ── Onboarding complete ───────────────────────────────────────────
  const handleOnboardingComplete = (profile) => {
    setMessages([{
      id: Date.now(), role: "jarvis",
      text: _welcomeMessage(profile),
      ts:   Date.now()
    }]);
    setScreen("app");
    setTab("clients");
  };

  // ── Screen routing ────────────────────────────────────────────────
  if (screen === "landing")    return <Landing onStart={handleStart} onLogin={handleLogin} />;
  if (screen === "onboarding") return <Onboarding onComplete={handleOnboardingComplete} />;

  // ── Main app ──────────────────────────────────────────────────────
  return (
    <div className={`app${opsData?.status === "critical" ? " app--emergency" : ""}`}>
      <ProgressBar visible={loading} />
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <header className="app-header">
        <div className="brand">
          <span className="logo">J</span>
          <span className="brand-name">JARVIS</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {opsData?.status === "critical" ? (
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
          )}
          <div className={`status-dot ${online ? "online" : "offline"}`}
               title={online ? "Connected" : "Offline"} />
        </div>
      </header>

      <nav className="tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`tab ${tab === t.id ? "active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab !== "runtime" && (
        <ConnectBar
          services={opsData?.services || {}}
          onSetupWhatsApp={() => setTab("clients")}
        />
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
        {tab === "insights"  && <Dashboard stats={stats} opsData={opsData} />}
        {tab === "activity"  && <Logs opsData={opsData} stats={stats} />}
        {tab === "clients"   && (
          <PaymentPanel
            onMessage={push}
            onToast={addToast}
            whatsappConnected={opsData?.services?.whatsapp ?? false}
          />
        )}
        {tab === "runtime"   && <RuntimeTab />}
      </main>
    </div>
  );
}

function RuntimeTab() {
  const { user, loading, logout } = useAuth();
  if (loading) return <div className="runtime-auth-loading">Checking access…</div>;
  if (!user)   return <LoginPage />;
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", justifyContent: "flex-end", padding: "0.5rem 1rem 0" }}>
        <button className="btn-sm" style={{ fontSize: "0.75rem", opacity: 0.6 }} onClick={logout}>
          Sign out
        </button>
      </div>
      <OperatorConsole />
    </div>
  );
}
