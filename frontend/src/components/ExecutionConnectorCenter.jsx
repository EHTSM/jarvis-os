import React, { useState, useCallback } from "react";
import { track } from "../analytics";
import "./ExecutionConnectorCenter.css";

const KEY = "ooplix_exec_connectors_v1";
function _load(k, fb) { try { return JSON.parse(localStorage.getItem(k) || JSON.stringify(fb)); } catch { return fb; } }
function _save(k, v) { localStorage.setItem(k, JSON.stringify(v)); }

const CONNECTORS = [
  { id: "github",   icon: "🐙", name: "GitHub",       type: "Code",    color: "#e2e8f0", actions: 8,  runs: 312, failRate: "0.3%" },
  { id: "gmail",    icon: "📧", name: "Gmail",         type: "Email",   color: "#ea4335", actions: 5,  runs: 891, failRate: "0.1%" },
  { id: "slack",    icon: "💬", name: "Slack",         type: "Comms",   color: "#4a154b", actions: 6,  runs: 544, failRate: "0.2%" },
  { id: "notion",   icon: "📝", name: "Notion",        type: "Docs",    color: "#000000", actions: 7,  runs: 221, failRate: "0.4%" },
  { id: "gdrive",   icon: "📁", name: "Google Drive",  type: "Storage", color: "#4285f4", actions: 4,  runs: 178, failRate: "0.0%" },
  { id: "telegram", icon: "✈️", name: "Telegram",      type: "Comms",   color: "#2ca5e0", actions: 3,  runs: 402, failRate: "0.5%" },
  { id: "openrouter",icon:"🔀", name: "OpenRouter",    type: "AI",      color: "#7c6fff", actions: 12, runs: 1204, failRate: "0.8%" },
  { id: "ollama",   icon: "🦙", name: "Ollama",        type: "AI",      color: "#00dc82", actions: 10, runs: 388, failRate: "0.2%" },
];

const SEED_CONNECTED = ["github","gmail","slack","openrouter","ollama"];

const ACTIONS_SEED = [
  { connector:"github",    action:"create_pr",      permission:"allowed", desc:"Open a pull request on any repo" },
  { connector:"github",    action:"push_commit",     permission:"allowed", desc:"Push commits to non-main branches" },
  { connector:"github",    action:"merge_pr",        permission:"denied",  desc:"Merge PRs without human review" },
  { connector:"gmail",     action:"send_email",      permission:"allowed", desc:"Send emails from connected account" },
  { connector:"gmail",     action:"read_inbox",      permission:"allowed", desc:"Read unread inbox messages" },
  { connector:"slack",     action:"post_message",    permission:"allowed", desc:"Post to any channel" },
  { connector:"slack",     action:"create_channel",  permission:"denied",  desc:"Create new Slack channels" },
  { connector:"openrouter",action:"call_model",      permission:"allowed", desc:"Route inference to any model" },
  { connector:"openrouter",action:"stream_response", permission:"allowed", desc:"Stream long-form model output" },
  { connector:"ollama",    action:"run_local_model",  permission:"allowed", desc:"Run local inference" },
  { connector:"notion",    action:"create_page",      permission:"pending", desc:"Create pages in connected workspace" },
  { connector:"gdrive",    action:"upload_file",      permission:"pending", desc:"Upload files to Drive" },
];

const HISTORY_SEED = [
  { ts:"2m ago",  connector:"github",     action:"create_pr",     status:"success", detail:"PR #142: fix auth middleware" },
  { ts:"5m ago",  connector:"slack",      action:"post_message",  status:"success", detail:"#ops: deploy complete" },
  { ts:"12m ago", connector:"openrouter", action:"call_model",    status:"success", detail:"claude-sonnet-4-6 · 1,204 tokens" },
  { ts:"18m ago", connector:"gmail",      action:"send_email",    status:"success", detail:"lead@acmecorp.com · follow-up" },
  { ts:"24m ago", connector:"ollama",     action:"run_local_model",status:"success",detail:"llama3:70b · 840 tokens" },
  { ts:"31m ago", connector:"github",     action:"push_commit",   status:"success", detail:"feat: memory node refresh" },
  { ts:"40m ago", connector:"slack",      action:"post_message",  status:"failed",  detail:"Rate limit hit — channel #alerts" },
  { ts:"55m ago", connector:"openrouter", action:"call_model",    status:"failed",  detail:"Timeout after 30s · retry queued" },
];

const FAIL_SEED = [
  { ts:"40m ago", connector:"slack",      action:"post_message",  reason:"Rate limit — 429 from Slack API",      retries:3 },
  { ts:"55m ago", connector:"openrouter", action:"call_model",    reason:"Timeout 30s — upstream model overload", retries:2 },
  { ts:"3h ago",  connector:"notion",     action:"create_page",   reason:"401 Unauthorized — token expired",      retries:1 },
  { ts:"6h ago",  connector:"github",     action:"push_commit",   reason:"Branch protection rule violation",      retries:0 },
];

const iconOf = id => CONNECTORS.find(c => c.id === id)?.icon || "🔌";
const nameOf = id => CONNECTORS.find(c => c.id === id)?.name || id;

export default function ExecutionConnectorCenter({ onNavigate }) {
  const [connected, setConnected] = useState(() => _load(KEY, SEED_CONNECTED));
  const [tab, setTab] = useState("connectors");
  const TABS = ["connectors","actions","history","failures"];

  function toggle(id) {
    const next = connected.includes(id) ? connected.filter(x => x !== id) : [...connected, id];
    setConnected(next); _save(KEY, next);
    track("ecc_toggle", { id, connected: !connected.includes(id) });
  }

  return (
    <div className="ecc">
      <div className="ecc-header">
        <div>
          <h1 className="ecc-title">Execution Connector Center</h1>
          <p className="ecc-subtitle">Connect tools, manage action permissions and audit execution history.</p>
        </div>
      </div>

      <div className="ecc-stats">
        <div className="ecc-stat"><span className="ecc-stat-val" style={{color:"#00dc82"}}>{connected.length}</span><span className="ecc-stat-lbl">Connected</span></div>
        <div className="ecc-stat"><span className="ecc-stat-val">{CONNECTORS.length}</span><span className="ecc-stat-lbl">Available</span></div>
        <div className="ecc-stat"><span className="ecc-stat-val" style={{color:"var(--accent)"}}>{ACTIONS_SEED.filter(a=>a.permission==="allowed").length}</span><span className="ecc-stat-lbl">Permitted</span></div>
        <div className="ecc-stat"><span className="ecc-stat-val" style={{color:"var(--warning)"}}>{HISTORY_SEED.filter(h=>h.status==="success").length}</span><span className="ecc-stat-lbl">Runs Today</span></div>
        <div className="ecc-stat"><span className="ecc-stat-val" style={{color:"#ff6464"}}>{FAIL_SEED.length}</span><span className="ecc-stat-lbl">Failures</span></div>
      </div>

      <div className="ecc-tabs">
        {["connectors","actions","history","failures"].map(t => (
          <button key={t} className={`ecc-tab${tab===t?" active":""}`} onClick={() => setTab(t)} style={{textTransform:"capitalize"}}>{t}</button>
        ))}
      </div>

      {tab === "connectors" && (
        <div className="ecc-connector-grid">
          {CONNECTORS.map(c => {
            const on = connected.includes(c.id);
            return (
              <div key={c.id} className="ecc-connector-card">
                <div className="ecc-connector-head">
                  <div className="ecc-connector-icon" style={{background: on ? c.color+"22" : "var(--surface-raised)"}}>{c.icon}</div>
                  <div>
                    <div className="ecc-connector-name">{c.name}</div>
                    <div className="ecc-connector-type">{c.type}</div>
                  </div>
                </div>
                <div className="ecc-connector-status">
                  <div className="ecc-status-dot" style={{background: on ? "#00dc82" : "var(--text-faint)"}} />
                  <span style={{color: on ? "#00dc82" : "var(--text-faint)"}}>{on ? "Connected" : "Disconnected"}</span>
                </div>
                <div className="ecc-connector-actions">{c.actions} actions · {c.runs} runs · {c.failRate} fail rate</div>
                <div className="ecc-connector-footer">
                  <span className="ecc-connector-runs">{c.runs} total</span>
                  <button className={`ecc-connect-btn${on?" connected":""}`} onClick={() => toggle(c.id)}>
                    {on ? "Connected ✓" : "Connect"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === "actions" && (
        <table className="ecc-table">
          <thead>
            <tr>
              <th>Connector</th><th>Action</th><th>Permission</th><th>Description</th>
            </tr>
          </thead>
          <tbody>
            {ACTIONS_SEED.map((a,i) => (
              <tr key={i}>
                <td>{iconOf(a.connector)} {nameOf(a.connector)}</td>
                <td style={{fontFamily:"monospace",fontSize:12,color:"var(--accent)"}}>{a.action}</td>
                <td><span className={`ecc-badge ecc-badge-${a.permission}`}>{a.permission}</span></td>
                <td>{a.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {tab === "history" && (
        <table className="ecc-table">
          <thead>
            <tr><th>Time</th><th>Connector</th><th>Action</th><th>Status</th><th>Detail</th></tr>
          </thead>
          <tbody>
            {HISTORY_SEED.map((h,i) => (
              <tr key={i}>
                <td style={{color:"var(--text-faint)"}}>{h.ts}</td>
                <td>{iconOf(h.connector)} {nameOf(h.connector)}</td>
                <td style={{fontFamily:"monospace",fontSize:12}}>{h.action}</td>
                <td><span className={`ecc-badge ecc-badge-${h.status}`}>{h.status}</span></td>
                <td style={{fontSize:12}}>{h.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {tab === "failures" && (
        <table className="ecc-table">
          <thead>
            <tr><th>Time</th><th>Connector</th><th>Action</th><th>Reason</th><th>Retries</th></tr>
          </thead>
          <tbody>
            {FAIL_SEED.map((f,i) => (
              <tr key={i}>
                <td style={{color:"var(--text-faint)"}}>{f.ts}</td>
                <td>{iconOf(f.connector)} {nameOf(f.connector)}</td>
                <td style={{fontFamily:"monospace",fontSize:12}}>{f.action}</td>
                <td style={{color:"#ff6464",fontSize:12}}>{f.reason}</td>
                <td style={{textAlign:"center"}}>{f.retries}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
