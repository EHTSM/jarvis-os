import React from "react";
import "./Chat.css";

const ROLE_LABELS = {
  user:   "You",
  jarvis: "JARVIS",
  system: "system",
  error:  "error"
};

const ROLE_COLORS = {
  user:   "#6c63ff",
  jarvis: "#00d4ff",
  system: "#8888aa",
  error:  "#ff5252"
};

function Message({ msg }) {
  if (msg.role === "system") {
    return <div className="msg msg--system">{msg.text}</div>;
  }

  const color = ROLE_COLORS[msg.role] || "#ccc";
  const label = ROLE_LABELS[msg.role] || msg.role;
  const ts    = new Date(msg.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div className={`msg msg--${msg.role}`}>
      <div className="msg-header">
        <span className="msg-role" style={{ color }}>{label}</span>
        <span className="msg-time">{ts}</span>
      </div>
      <div className="msg-body">{msg.text}</div>
    </div>
  );
}

const QUICK_ACTIONS = [
  { label: "Add Client",        cmd: "Add a new client"        },
  { label: "Show Leads",        cmd: "Show me all my leads"    },
  { label: "Send Payment Link", cmd: "Generate a payment link" },
];

export default function Chat({
  messages, input, loading, online,
  inputRef, endRef,
  onInput, onSend, onKey, onClear
}) {
  return (
    <div className="chat">
      <div className="chat-messages">
        {messages.map(m => <Message key={m.id} msg={m} />)}
        {loading && (
          <div className="msg msg--jarvis">
            <div className="msg-header">
              <span className="msg-role" style={{ color: "#00d4ff" }}>JARVIS</span>
            </div>
            <div className="msg-body typing"><span /><span /><span /></div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="quick-cmds">
        {QUICK_ACTIONS.map(a => (
          <button key={a.cmd} className="quick-btn" onClick={() => onSend(a.cmd)}>
            {a.label}
          </button>
        ))}
      </div>

      <div className="chat-input-row">
        <input
          ref={inputRef}
          className="chat-input"
          value={input}
          onChange={e => onInput(e.target.value)}
          onKeyDown={onKey}
          placeholder={online ? "Ask JARVIS anything…" : "Connecting…"}
          disabled={!online || loading}
          autoFocus
        />
        <button className="send-btn" onClick={onSend} disabled={!online || loading || !input.trim()}>
          {loading ? "…" : "Send"}
        </button>
        <button className="clear-btn" onClick={onClear} title="Clear chat">✕</button>
      </div>
    </div>
  );
}
