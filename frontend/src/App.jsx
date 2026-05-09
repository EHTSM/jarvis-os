import React, { useState, useEffect, useRef, useCallback } from "react";
import { sendMessage, checkHealth, getEvolutionScore, getSuggestions, approveSuggestion, getStats, getMetrics } from "./api";
import Chat         from "./components/Chat.jsx";
import Dashboard    from "./components/Dashboard.jsx";
import Logs         from "./components/Logs.jsx";
import PaymentPanel from "./components/PaymentPanel.jsx";
import "./App.css";

const TABS = [
  { id: "chat",    label: "Chat"  },
  { id: "stats",   label: "Stats" },
  { id: "logs",    label: "Logs"  },
  { id: "crm",     label: "CRM"   }
];

export default function App() {
  const [messages, setMessages] = useState([{
    id: 1, role: "jarvis",
    text: "JARVIS AI is ready.\n\nTry: \"Open YouTube\", \"Search AI news\", \"What time is it\", or \"Get leads\".\n\nFor sales automation — type what you offer and I'll help you close clients.",
    ts: Date.now()
  }]);
  const [input,       setInput]       = useState("");
  const [loading,     setLoading]     = useState(false);
  const [online,      setOnline]      = useState(false);
  const [tab,         setTab]         = useState("chat");
  const [score,       setScore]       = useState(50);
  const [suggestions, setSuggestions] = useState([]);
  const [stats,       setStats]       = useState(null);
  const [metrics,     setMetrics]     = useState(null);

  const endRef   = useRef(null);
  const inputRef = useRef(null);

  const push = useCallback((role, text, extra = {}) => {
    setMessages(prev => [...prev, {
      id: Date.now() + Math.random(), role, text, ts: Date.now(), ...extra
    }]);
  }, []);

  // ── polling ───────────────────────────────────────────────────────
  useEffect(() => {
    let wasOnline = false;

    const poll = async () => {
      const healthy = await checkHealth();

      if (!wasOnline && healthy)  push("system", "Connected to JARVIS backend.");
      if (wasOnline  && !healthy) push("system", "Backend offline — reconnecting...");
      wasOnline = healthy;
      setOnline(healthy);

      if (healthy) {
        const [sc, sugg, st, mx] = await Promise.allSettled([
          getEvolutionScore(),
          getSuggestions(),
          getStats(),
          getMetrics()
        ]);
        setScore(Math.round(sc.value ?? 50));
        setSuggestions(sugg.value ?? []);
        setStats(st.value ?? null);
        setMetrics(mx.value ?? null);
      }
    };

    poll();
    const id = setInterval(poll, 6000);
    return () => clearInterval(id);
  }, [push]);

  // ── auto-scroll ───────────────────────────────────────────────────
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── send — accepts optional value override (for quick buttons) ────
  const handleSend = useCallback(async (override) => {
    const cmd = (typeof override === "string" ? override : input).trim();
    if (!cmd || loading) return;
    if (!online) { push("error", "Backend offline."); return; }

    push("user", cmd);
    setInput("");
    setLoading(true);

    try {
      const res = await sendMessage(cmd, "smart");
      push(res.success ? "jarvis" : "error", res.reply || (res.success ? "Done." : "Request failed."));
      if (res.success && res.intent && res.intent !== "unknown") {
        push("meta", `intent: ${res.intent}  |  mode: ${res.mode}`);
      }
    } catch (err) {
      push("error", err.message);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [input, loading, online, push]);

  const handleKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleSuggestionClick = async (s) => {
    const ok = await approveSuggestion(s.id).catch(() => null);
    if (ok) push("system", `Approved: ${s.description || s.id}`);
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="logo">⬡</span>
          <span className="brand-name">JARVIS</span>
          <span className="brand-sub">AI OS</span>
        </div>
        <div className="header-right">
          <div className={`status-dot ${online ? "online" : "offline"}`} title={online ? "Connected" : "Offline"} />
          <div className="score-badge" title="Evolution Score">{score}%</div>
        </div>
      </header>

      <nav className="tabs">
        {TABS.map(t => (
          <button key={t.id} className={`tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      <main className="app-main">
        {tab === "chat" && (
          <Chat
            messages={messages}
            input={input}
            loading={loading}
            online={online}
            suggestions={suggestions}
            inputRef={inputRef}
            endRef={endRef}
            onInput={setInput}
            onSend={handleSend}
            onKey={handleKey}
            onSuggestionClick={handleSuggestionClick}
            onClear={() => setMessages([{
              id: Date.now(), role: "system",
              text: "Chat cleared.", ts: Date.now()
            }])}
          />
        )}
        {tab === "stats" && <Dashboard stats={stats} score={score} suggestions={suggestions} />}
        {tab === "logs"  && <Logs metrics={metrics} />}
        {tab === "crm"   && <PaymentPanel onMessage={(role, text) => push(role, text)} />}
      </main>
    </div>
  );
}
