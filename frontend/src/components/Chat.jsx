import React from "react";
import "./Chat.css";

const ROLE_COLORS = {
  user:   "#6c63ff",
  jarvis: "#00d4ff",
  system: "#8888aa",
  meta:   "#ffab40",
  error:  "#ff5252"
};

function Message({ msg }) {
  const color = ROLE_COLORS[msg.role] || "#ccc";
  const ts    = new Date(msg.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div className={`msg msg--${msg.role}`}>
      <div className="msg-header">
        <span className="msg-role" style={{ color }}>{msg.role === "jarvis" ? "JARVIS" : msg.role.toUpperCase()}</span>
        <span className="msg-time">{ts}</span>
      </div>
      <div className="msg-body">{msg.text}</div>
    </div>
  );
}

export default function Chat({
  messages, input, loading, online,
  suggestions, inputRef, endRef,
  onInput, onSend, onKey, onSuggestionClick, onClear
}) {
  const quickCmds = [
    "Open YouTube", "Search AI news", "What time is it",
    "Get leads", "How much does it cost?", "Open VS Code"
  ];

  return (
    <div className="chat">
      {/* Messages */}
      <div className="chat-messages">
        {messages.map(m => <Message key={m.id} msg={m} />)}
        {loading && (
          <div className="msg msg--jarvis">
            <div className="msg-header"><span className="msg-role" style={{ color: "#00d4ff" }}>JARVIS</span></div>
            <div className="msg-body typing"><span /><span /><span /></div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Quick commands */}
      <div className="quick-cmds">
        {quickCmds.map(c => (
          <button key={c} className="quick-btn" onClick={() => onSend(c)}>
            {c}
          </button>
        ))}
      </div>

      {/* Evolution suggestions */}
      {suggestions.length > 0 && (
        <div className="suggestions">
          <span className="sugg-label">Suggestions:</span>
          {suggestions.slice(0, 3).map((s, i) => (
            <button key={i} className="sugg-btn" onClick={() => onSuggestionClick(s)}>
              {s.description || s.type || `Suggestion ${i + 1}`}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="chat-input-row">
        <input
          ref={inputRef}
          className="chat-input"
          value={input}
          onChange={e => onInput(e.target.value)}
          onKeyDown={onKey}
          placeholder={online ? "Type a command or question..." : "Backend offline..."}
          disabled={!online || loading}
          autoFocus
        />
        <button className="send-btn" onClick={onSend} disabled={!online || loading || !input.trim()}>
          {loading ? "..." : "Send"}
        </button>
        <button className="clear-btn" onClick={onClear} title="Clear chat">✕</button>
      </div>
    </div>
  );
}
