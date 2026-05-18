import React, { useState, useRef, useEffect, useCallback } from "react";
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
  return [{ id: 0, role: "sys", text: "JARVIS AI Operator Console — type commands or natural language" }];
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

  return (
    <div className="op-panel op-aiconsole" style={style}>
      <div className="op-panel-header">
        <span className="op-panel-title">AI Console</span>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {loading && <span style={{ fontSize: 10, color: "var(--op-amber)" }}>thinking…</span>}
          <button
            className="op-send-btn"
            onClick={handleClear}
            title="Clear console"
            aria-label="Clear console"
          >CLR</button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="op-aiconsole-messages">
        {msgs.map(m => (
          <div key={m.id} className="op-msg op-fade-in">
            {m.role === "user"   && <><span className="op-msg-prompt">&gt;</span><span className="op-msg-user">{m.text}</span></>}
            {m.role === "jarvis" && <><span className="op-msg-prompt">←</span><span className="op-msg-reply">{m.text}</span></>}
            {m.role === "err"    && <><span className="op-msg-prompt">!</span><span className="op-msg-err">{m.text}</span></>}
            {m.role === "sys"    && <span className="op-msg-sys"># {m.text}</span>}
            {m.role === "wait"   && <span className="op-msg-wait">  {m.text}</span>}
          </div>
        ))}
        {loading && (
          <div className="op-msg op-fade-in" style={{ opacity: 0.8 }}>
            <span className="op-msg-prompt">←</span>
            <span className="op-msg-wait" style={{ animation: "op-pulse 1.5s infinite" }}>Awaiting runtime response... ▋</span>
          </div>
        )}
      </div>

      {/* Input row */}
      <div className="op-input-row">
        <span className="op-input-prompt">&gt;</span>
        <input
          ref={inputRef}
          className="op-cmd-input"
          type="text"
          value={input}
          placeholder="command or natural language…"
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          disabled={loading}
          autoComplete="off"
          spellCheck={false}
        />
        <button
          className="op-send-btn"
          onClick={() => send(input)}
          disabled={!input.trim() || loading}
        >→</button>
      </div>
    </div>
  );
}
