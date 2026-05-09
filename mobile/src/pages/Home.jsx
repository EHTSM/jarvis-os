import React, { useState, useEffect, useRef, useCallback } from "react";
import { useAuth }                     from "../context/AuthContext.jsx";
import { useToast }                    from "../context/ToastContext.jsx";
import { sendMessage, checkHealth }    from "../api.js";
import { saveChatMessage, getChatHistory } from "../firebase.js";

// Quick-action chips — mobile-safe (no OS control)
const CHIPS = [
  "Summarise my business goals",
  "Generate a sales script",
  "What's my conversion rate?",
  "How to follow up with leads?",
  "Create a 7-day marketing plan",
  "Suggest pricing strategies"
];

function Bubble({ msg }) {
  const ts = msg.ts
    ? new Date(typeof msg.ts?.toDate === "function" ? msg.ts.toDate() : msg.ts)
        .toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "";

  const cls = {
    user:   "chat-bubble bubble-user",
    jarvis: "chat-bubble bubble-jarvis selectable",
    system: "chat-bubble bubble-system",
    error:  "chat-bubble bubble-error",
    meta:   "chat-bubble bubble-meta"
  }[msg.role] || "chat-bubble bubble-system";

  return (
    <div className={cls}>
      {msg.text}
      {ts && msg.role !== "meta" && msg.role !== "system" && (
        <span className="bubble-time">{ts}</span>
      )}
    </div>
  );
}

function TypingBubble() {
  return (
    <div className="chat-bubble bubble-jarvis">
      <div className="chat-typing">
        <span /><span /><span />
      </div>
    </div>
  );
}

export default function Home() {
  const { user }  = useAuth();
  const toast     = useToast();
  const bottomRef = useRef(null);
  const inputRef  = useRef(null);

  const [messages, setMessages] = useState([{
    id: "init", role: "system",
    text: "JARVIS online. Ask me anything.",
    ts: Date.now()
  }]);
  const [input,   setInput]   = useState("");
  const [loading, setLoading] = useState(false);
  const [online,  setOnline]  = useState(false);
  const [histLoaded, setHistLoaded] = useState(false);

  // ── Load chat history from Firestore ────────────────────────────
  useEffect(() => {
    if (!user || histLoaded) return;
    getChatHistory(user.uid, 20).then(hist => {
      if (hist.length > 0) {
        const mapped = hist.map(m => ({
          id:   m.id,
          role: m.role,
          text: m.text,
          ts:   m.ts
        }));
        setMessages(prev => [prev[0], ...mapped]);
      }
      setHistLoaded(true);
    }).catch(() => setHistLoaded(true));
  }, [user, histLoaded]);

  // ── Health polling ───────────────────────────────────────────────
  useEffect(() => {
    let was = false;
    const poll = async () => {
      const healthy = await checkHealth();
      if (!was && healthy)  push("system", "Connected to JARVIS.");
      if (was  && !healthy) push("system", "Connection lost — retrying…");
      was = healthy;
      setOnline(healthy);
    };
    poll();
    const id = setInterval(poll, 10000);
    return () => clearInterval(id);
  }, []); // eslint-disable-line

  // ── Auto-scroll ──────────────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const push = useCallback((role, text) => {
    setMessages(prev => [...prev, {
      id: Date.now() + Math.random(), role, text, ts: Date.now()
    }]);
  }, []);

  // ── Send ─────────────────────────────────────────────────────────
  const handleSend = useCallback(async (override) => {
    const cmd = (typeof override === "string" ? override : input).trim();
    if (!cmd || loading) return;
    if (!online) { toast.show("Backend offline. Please wait.", "error"); return; }

    push("user", cmd);
    setInput("");
    setLoading(true);

    // Persist user message
    if (user) saveChatMessage(user.uid, "user", cmd).catch(() => {});

    try {
      const res = await sendMessage(cmd, "smart");
      const reply = res.reply || (res.success ? "Done." : "Request failed.");
      push(res.success ? "jarvis" : "error", reply);

      // Persist JARVIS reply
      if (user) saveChatMessage(user.uid, "jarvis", reply).catch(() => {});

      if (res.intent && !["unknown","blocked","mobile"].includes(res.intent)) {
        push("meta", `intent: ${res.intent}  ·  mode: ${res.mode}`);
      }
    } catch (err) {
      push("error", err.message);
    } finally {
      setLoading(false);
    }
  }, [input, loading, online, user, push, toast]);

  const handleKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleClear = () => {
    setMessages([{ id: Date.now(), role: "system", text: "Chat cleared.", ts: Date.now() }]);
  };

  return (
    <>
      {/* Header */}
      <header className="mobile-header">
        <div className="brand">
          <div className="brand-logo">J</div>
          <span className="brand-name">JARVIS</span>
        </div>
        <div className="header-badge">
          <span className={`status-pill ${online ? "online" : ""}`}>
            <span className="dot" />
            {online ? "Online" : "Offline"}
          </span>
          <button
            onClick={handleClear}
            style={{ color: "var(--text-dim)", fontSize: 20, padding: "4px 6px" }}
            title="Clear chat"
          >
            ↺
          </button>
        </div>
      </header>

      {/* Chat area — fills remaining height */}
      <div className="app-screen" style={{ display: "flex", flexDirection: "column", paddingBottom: 0 }}>
        {/* Messages */}
        <div className="chat-messages" style={{ flex: 1 }}>
          {messages.map(m => <Bubble key={m.id} msg={m} />)}
          {loading && <TypingBubble />}
          <div ref={bottomRef} />
        </div>

        {/* Quick-action chips */}
        <div className="quick-chips">
          {CHIPS.map(c => (
            <button key={c} className="chip" onClick={() => handleSend(c)}>{c}</button>
          ))}
        </div>

        {/* Input row */}
        <div className="chat-input-area">
          <div className="chat-input-wrap">
            <textarea
              ref={inputRef}
              className="chat-input"
              rows={1}
              value={input}
              onChange={e => {
                setInput(e.target.value);
                // auto-grow
                e.target.style.height = "auto";
                e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
              }}
              onKeyDown={handleKey}
              placeholder={online ? "Ask JARVIS anything…" : "Connecting…"}
              disabled={!online || loading}
            />
          </div>
          <button
            className="chat-send-btn"
            onClick={handleSend}
            disabled={!online || loading || !input.trim()}
          >
            ➤
          </button>
        </div>
      </div>
    </>
  );
}
