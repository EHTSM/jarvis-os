import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { sendMessage } from "../../api";

const MAX_HISTORY  = 200;
const STORAGE_KEY  = "jarvis_console_msgs";
const STORAGE_MAX  = 50; // max messages to persist across refreshes

function _loadPersistedMsgs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch { /* ignore corrupt storage */ }
  return [{ id: 0, role: "sys", text: "JARVIS AI console — type commands or natural language" }];
}

function _savePersistedMsgs(msgs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(msgs.slice(-STORAGE_MAX)));
  } catch { /* storage full — ignore */ }
}

// In-memory buffer: synced from storage on first load, then kept up to date
const _persistedMsgs = _loadPersistedMsgs();

export default function AIConsolePanel({ style }) {
  const [msgs,    setMsgs]    = useState(_persistedMsgs);
  const [input,   setInput]   = useState("");
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState([]);  // command history for ↑↓
  const [histIdx, setHistIdx] = useState(-1);

  const memoryTags = useMemo(() => {
    const tags = [];
    for (let i = msgs.length - 1; i >= 0 && tags.length < 4; i--) {
      const msg = msgs[i];
      if (!msg || msg.role === "sys" || msg.role === "wait") continue;
      const text = (msg.text || "").split(/[\n,.;]/)[0].trim();
      if (!text) continue;
      const label = text.length > 22 ? `${text.slice(0, 22)}…` : text;
      if (!tags.includes(label)) tags.push(label);
    }
    return tags;
  }, [msgs]);

  const assistantSummary = useMemo(() => {
    if (loading) return "JARVIS is synthesizing the next operational insight…";
    const last = [...msgs].reverse().find(m => m.role === "jarvis");
    if (!last) return "JARVIS is ready for your next command.";
    const summary = (last.text || "").replace(/\s+/g, " ").trim();
    const firstLine = summary.split(/[\n\.]/)[0].trim();
    return firstLine.length > 100 ? `${firstLine.slice(0, 100)}…` : firstLine;
  }, [msgs, loading]);

  const inputRef = useRef(null);
  const scrollRef = useRef(null);

  // Keyboard Shortcut: Alt+C to focus console
  useEffect(() => {
    const handleGlobalKey = (e) => {
      if (e.altKey && e.code === "KeyC") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleGlobalKey);
    return () => window.removeEventListener("keydown", handleGlobalKey);
  }, []);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [msgs]);

  const push = useCallback((role, text) => {
    const entry = { id: Date.now() + Math.random(), role, text };
    _persistedMsgs.push(entry);
    if (_persistedMsgs.length > MAX_HISTORY) _persistedMsgs.splice(1, _persistedMsgs.length - MAX_HISTORY);
    _savePersistedMsgs(_persistedMsgs);
    setMsgs([..._persistedMsgs]);
  }, []);

  const send = useCallback(async (cmd) => {
    const text = cmd.trim();
    if (!text || loading) return;

    push("user", text);
    setHistory(prev => [text, ...prev.slice(0, 49)]);
    setHistIdx(-1);
    setInput("");
    setLoading(true);

    try {
      const res = await sendMessage(text, "smart");
      push(res.success ? "jarvis" : "err", res.reply || (res.success ? "Done." : "Failed."));
    } catch (e) {
      push("err", e.message);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [loading, push]);

  const handleKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
      return;
    }
    // Arrow up/down for command history
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const idx = Math.min(histIdx + 1, history.length - 1);
      setHistIdx(idx);
      if (history[idx] !== undefined) setInput(history[idx]);
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const idx = histIdx - 1;
      if (idx < 0) { setHistIdx(-1); setInput(""); }
      else { setHistIdx(idx); setInput(history[idx] || ""); }
    }
  };

  const handleClear = () => {
    _persistedMsgs.splice(1);
    _savePersistedMsgs(_persistedMsgs);
    setMsgs([_persistedMsgs[0]]);
  };

  const msgCount = msgs.filter(m => m.role === "user" || m.role === "jarvis").length;

  return (
    <div className="op-panel op-aiconsole" style={style}>
      <div className="op-panel-header">
        <div>
          <span className="op-panel-title">Ask JARVIS</span>
          <span className="op-aiconsole-meta">Your AI operator — type anything</span>
          <div className="op-aiconsole-status">
            <span className="op-aiconsole-badge">● ready</span>
            {msgCount > 0 && (
              <span className="op-aiconsole-badge op-aiconsole-badge-soft">{msgCount} exchange{msgCount !== 1 ? "s" : ""}</span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {loading && <span className="op-aiconsole-thinking">JARVIS is thinking…</span>}
          <button
            className="op-send-btn"
            onClick={handleClear}
            title="Clear conversation"
            aria-label="Clear conversation"
          >Clear</button>
        </div>
      </div>

      <div className="op-aiconsole-meta-row">
        <div className="op-aiconsole-summary-card">
          <div className="op-aiconsole-summary-title">What JARVIS thinks</div>
          <div className="op-aiconsole-summary-text">{assistantSummary}</div>
        </div>
        <div className="op-aiconsole-summary-card op-aiconsole-memory-card">
          <div className="op-aiconsole-summary-title">Recent context</div>
          <div className="op-aiconsole-memory-chips">
            {memoryTags.length > 0 ? memoryTags.map((tag, idx) => (
              <span key={idx} className="op-aiconsole-memory-chip">{tag}</span>
            )) : (
              <span className="op-aiconsole-memory-empty">Your recent actions will appear here as context chips.</span>
            )}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="op-aiconsole-messages">
        {msgs.length === 1 && msgs[0].role === "sys" && (
          <div className="op-aiconsole-welcome">
            <div className="op-aiconsole-welcome-icon">✦</div>
            <div className="op-aiconsole-welcome-title">How can I help you today?</div>
            <div className="op-aiconsole-welcome-sub">Ask anything — run a task, check status, get guidance, or just describe what you need.</div>
            <div className="op-aiconsole-welcome-hints">
              <span className="op-aiconsole-welcome-hint">Try: "What's running right now?"</span>
              <span className="op-aiconsole-welcome-hint">Try: "Run a health check"</span>
              <span className="op-aiconsole-welcome-hint">Try: "What should I do next?"</span>
            </div>
          </div>
        )}
        {msgs.map(m => {
          if (m.role === "sys" && msgs.length === 1) return null;
          return (
            <div
              key={m.id}
              className={`op-msg op-fade-in ${
                m.role === "jarvis" ? "op-msg-ai" :
                m.role === "user" ? "op-msg-user-entry" :
                m.role === "err" ? "op-msg-error-entry" :
                m.role === "sys" ? "op-msg-sys-entry" : ""
              }`}
            >
              {m.role === "user"   && <><span className="op-msg-prompt op-msg-prompt--you">You</span><span className="op-msg-user">{m.text}</span></>}
              {m.role === "jarvis" && <><span className="op-msg-prompt op-msg-prompt--ai">J</span><span className="op-msg-reply">{m.text}</span></>}
              {m.role === "err"    && <><span className="op-msg-prompt op-msg-prompt--err">!</span><span className="op-msg-err">{m.text}</span></>}
              {m.role === "sys"    && <span className="op-msg-sys">{m.text}</span>}
              {m.role === "wait"   && <span className="op-msg-wait">{m.text}</span>}
            </div>
          );
        })}
        {loading && (
          <div className="op-msg op-msg-ai op-fade-in op-aiconsole-loading-msg">
            <span className="op-msg-prompt op-msg-prompt--ai">J</span>
            <span className="op-msg-wait">
              <span className="op-aiconsole-dot-pulse">●</span>
              <span className="op-aiconsole-dot-pulse" style={{ animationDelay: "0.2s" }}>●</span>
              <span className="op-aiconsole-dot-pulse" style={{ animationDelay: "0.4s" }}>●</span>
            </span>
          </div>
        )}
      </div>

      {/* Input row */}
      <div className="op-input-row">
        <input
          ref={inputRef}
          className="op-cmd-input"
          type="text"
          value={input}
          placeholder="Ask anything or run a command…"
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          disabled={loading}
          autoComplete="off"
          spellCheck={false}
          aria-label="Message JARVIS"
        />
        <button
          className={`op-send-btn op-send-btn--primary${input.trim() && !loading ? " op-send-btn--ready" : ""}`}
          onClick={() => send(input)}
          disabled={!input.trim() || loading}
          aria-label="Send message"
        >Send</button>
      </div>
    </div>
  );
}
