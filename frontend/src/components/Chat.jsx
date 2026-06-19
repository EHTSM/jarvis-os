import React, { useState, useEffect } from "react";
import "./Chat.css";

const BASE = process.env.REACT_APP_API_URL || "";

// ── Workspace Context Strip ───────────────────────────────────────
function WorkspaceContext() {
  const [ctx, setCtx] = useState(null);
  useEffect(() => {
    fetch(`${BASE}/coding/context`, { credentials: "include" })
      .then(r => r.json()).then(d => setCtx(d)).catch(() => {});
  }, []);
  if (!ctx) return null;
  return (
    <div className="chat-ws-ctx">
      {ctx.cwd    && <span className="chat-ctx-chip">📁 {ctx.cwd.split("/").pop()}</span>}
      {ctx.branch && <span className="chat-ctx-chip">⎇ {ctx.branch}</span>}
      {ctx.activeMission && <span className="chat-ctx-chip chat-ctx-chip--mission">✦ {ctx.activeMission}</span>}
      {ctx.health && <span className={`chat-ctx-chip chat-ctx-chip--health chat-ctx-chip--${ctx.health}`}>◎ {ctx.health}</span>}
    </div>
  );
}

const CHAT_PROMPTS = [
  "What's my pipeline status?",
  "How many leads this week?",
  "Run pm2 list",
  "Show my revenue this week",
  "Send daily pipeline summary",
  "Check system health",
];

function ChatEmptyPrompts({ onSend }) {
  return (
    <div className="chat-empty-prompts">
      <p className="chat-empty-label">Ask a question or run a command</p>
      <div className="chat-empty-chips">
        {CHAT_PROMPTS.map(p => (
          <button
            key={p}
            className="chat-empty-chip"
            onClick={() => onSend(p)}
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

const ROLE_LABELS = {
  user:   "You",
  jarvis: "Ooplix",
  system: "system",
  error:  "error"
};

const ROLE_COLORS = {
  user:   "#9a90ff",
  jarvis: "#4ecdc4",
  system: "#9b9fb7",
  error:  "#ff7b7b"
};

const PROVIDER_LABELS = {
  openai: "OpenAI",
  claude: "Claude",
  grok:   "Grok",
  local:  "Local",
  default: "AI"
};

function _providerLabel(provider) {
  if (!provider) return null;
  const key = String(provider).toLowerCase();
  return PROVIDER_LABELS[key] || provider;
}

function _isCode(text) {
  if (!text) return false;
  return (
    text.startsWith("$ ") ||
    text.startsWith("On branch") ||
    /^(M |A |D |\?\? )/.test(text) ||
    (text.includes("\n") && /\d{1,3} (insertions|deletions)/.test(text)) ||
    text.startsWith("node_modules") ||
    text.startsWith("package.json")
  );
}

function MessageBody({ text }) {
  if (_isCode(text)) {
    return <pre className="msg-code">{text}</pre>;
  }
  return <div className="msg-body">{text}</div>;
}

function Message({ msg, showHeader }) {
  if (msg.role === "system") {
    return <div className="msg msg--system">{msg.text}</div>;
  }

  if (msg.role === "error") {
    return (
      <div className="msg msg--error">
        <div className="msg-error-header">
          <span className="msg-error-icon">✕</span>
          <span className="msg-error-label">Error</span>
        </div>
        <div className="msg-body msg-body--error">{msg.text}</div>
      </div>
    );
  }

  const color    = ROLE_COLORS[msg.role] || "#ccc";
  const label    = ROLE_LABELS[msg.role] || msg.role;
  const provider = _providerLabel(msg.provider || msg.model);
  const ts       = msg.ts
    ? new Date(msg.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "";

  return (
    <div className={`msg msg--${msg.role}${msg.role === "jarvis" ? " msg--ai" : ""}`}>
      {showHeader && (
        <div className="msg-header">
          <div className="msg-meta-left">
            <span className="msg-role" style={{ color }}>{label}</span>
            {provider && <span className="msg-badge">{provider}</span>}
          </div>
          {ts && <span className="msg-time">{ts}</span>}
        </div>
      )}
      <MessageBody text={msg.text} />
      {(msg.workflow || msg.status) && (
        <div className="msg-footer">
          {msg.workflow && <span className="msg-footer-chip">{msg.workflow}</span>}
          {msg.status   && <span className="msg-footer-code">{msg.status}</span>}
        </div>
      )}
    </div>
  );
}

function _buildQuickActions() {
  try {
    const p = JSON.parse(localStorage.getItem("jarvis_biz_profile") || "null");
    if (!p) {
      return [
        { label: "What can you do?",  cmd: "What can Ooplix do for me?"    },
        { label: "Add a contact",     cmd: "How do I add my first contact?" },
        { label: "Show pipeline",     cmd: "Show my pipeline status"        },
        { label: "Control Room",      cmd: "What is the Control Room?"      },
      ];
    }
    const isDev = /dev|engineer|code|software|tech|program/i.test(p.business || "");
    if (isDev) {
      return [
        { label: "Git status",    cmd: "run git status"                          },
        { label: "Run tests",     cmd: "run npm test"                            },
        { label: "System check",  cmd: "run pm2 list"                            },
        { label: "Recent logs",   cmd: "run pm2 logs jarvis-backend --lines 20"  },
      ];
    }
    return [
      { label: "Hot leads",         cmd: "Show my hot leads"            },
      { label: "This week",         cmd: "What happened this week?"     },
      { label: "Payment link",      cmd: "Generate a payment link"      },
      { label: "Follow-up status",  cmd: "Show follow-up activity"      },
    ];
  } catch {
    return [
      { label: "Show pipeline",    cmd: "Show my pipeline status"        },
      { label: "Payment link",     cmd: "Generate a payment link"        },
      { label: "What can you do?", cmd: "What can Ooplix do for me?"     },
      { label: "Help",             cmd: "What should I do first?"        },
    ];
  }
}

const QUICK_ACTIONS = _buildQuickActions();

export default function Chat({
  messages, input, loading, online,
  inputRef, endRef,
  onInput, onSend, onKey, onClear
}) {
  const currentWorkflow = messages
    .slice()
    .reverse()
    .find(m => m.workflow || m.status);
  const workflowDone = currentWorkflow && (
    currentWorkflow.status === "completed" ||
    currentWorkflow.status === "success" ||
    currentWorkflow.status === "done"
  );

  return (
    <div className="chat">
      {/* Workspace context strip */}
      <WorkspaceContext />

      {/* Workflow status banner — thin, informational */}
      {currentWorkflow && (
        <div className={`chat-workflow-banner${workflowDone ? " chat-workflow-banner--done" : ""}`}>
          <div>
            <span className="chat-workflow-title">
              {workflowDone ? "✓ Completed" : "Running"}
            </span>
            <span className="chat-workflow-sub">
              {currentWorkflow.workflow || (workflowDone ? "Workflow finished" : "Ooplix is working…")}
            </span>
          </div>
          {currentWorkflow.status && (
            <span className={`chat-workflow-pill${workflowDone ? " chat-workflow-pill--done" : ""}`}>
              {currentWorkflow.status}
            </span>
          )}
        </div>
      )}

      {/* Message list */}
      <div className="chat-messages">
        {messages.length === 1 && messages[0]?.role === "jarvis" && !loading && (
          <ChatEmptyPrompts onSend={onSend} />
        )}
        {messages.map((m, idx) => {
          const prev       = messages[idx - 1];
          const showHeader = !prev || prev.role !== m.role || prev.provider !== m.provider;
          return (
            <Message key={m.id} msg={m} showHeader={showHeader} />
          );
        })}

        {/* AI thinking indicator */}
        {loading && (
          <div className="msg msg--jarvis msg--ai">
            <div className="msg-header">
              <div className="msg-meta-left">
                <span className="msg-role" style={{ color: ROLE_COLORS.jarvis }}>Ooplix</span>
                <span className="msg-thinking-label">thinking…</span>
              </div>
            </div>
            <div className="msg-body typing">
              <span /><span /><span />
            </div>
          </div>
        )}

        <div ref={endRef} />
      </div>

      {/* Quick action chips */}
      <div className="quick-cmds">
        {QUICK_ACTIONS.map(a => (
          <button
            key={a.cmd}
            className="quick-btn"
            onClick={() => onSend(a.cmd)}
            disabled={!online || loading}
            title={a.cmd}
          >
            {a.label}
          </button>
        ))}
      </div>

      {/* Input row */}
      <div className="chat-input-row">
        <input
          ref={inputRef}
          className="chat-input"
          value={input}
          onChange={e => onInput(e.target.value)}
          onKeyDown={onKey}
          placeholder={loading ? "Ooplix is responding…" : online ? "Message Ooplix, or type a command…" : "Connecting…"}
          disabled={!online || loading}
          autoFocus
          autoComplete="off"
          spellCheck={false}
        />
        <button
          className="send-btn"
          onClick={onSend}
          disabled={!online || loading || !input.trim()}
          aria-label="Send message"
        >
          {loading ? "…" : "Send"}
        </button>
        <button
          className="clear-btn"
          onClick={onClear}
          title="Clear conversation"
          aria-label="Clear conversation"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
