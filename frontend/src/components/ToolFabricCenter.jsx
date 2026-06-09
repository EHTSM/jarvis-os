import React, { useState, useCallback, useEffect } from "react";
import { track } from "../analytics";
import { listTools, toolStatus, setToolPermission, executeTool } from "../phase19Api";
import "./ToolFabricCenter.css";

const TOOLS_KEY = "ooplix_tool_fabric";
function _load(k,fb){try{return JSON.parse(localStorage.getItem(k)||JSON.stringify(fb));}catch{return fb;}}
function _save(k,v){localStorage.setItem(k,JSON.stringify(v));}

// ── Tool registry seed ────────────────────────────────────────────────
const SEED_TOOLS = [
  {
    id: "t_github", name: "GitHub", icon: "◉", color: "#e6edf3", category: "engineering",
    status: "healthy", health: 100, owner: "DevOps Agent",
    permissions: ["read_repos","write_code","post_comments","read_ci","trigger_workflows"],
    usedBy: ["dev","devops"], callsToday: 47, callsTotal: 1820, errorRate: "0.4%",
    lastCall: "45 min ago", description: "Repository access, PR reviews, CI status, workflow triggers.",
    config: { apiVersion: "v3", baseUrl: "api.github.com", rateLimit: "5000/hr" },
  },
  {
    id: "t_gmail", name: "Gmail", icon: "G", color: "#ea4335", category: "communication",
    status: "disconnected", health: 0, owner: "Marketing Agent",
    permissions: ["read_mail","send_mail","manage_contacts"],
    usedBy: ["marketing","support","sales"], callsToday: 0, callsTotal: 0, errorRate: "—",
    lastCall: "never", description: "Read and send email, sync contacts, trigger email sequences.",
    config: { apiVersion: "v1", baseUrl: "gmail.googleapis.com", rateLimit: "250 quota units/s" },
  },
  {
    id: "t_slack", name: "Slack", icon: "#", color: "#4a154b", category: "communication",
    status: "disconnected", health: 0, owner: "DevOps Agent",
    permissions: ["post_messages","read_channels"],
    usedBy: ["devops","analytics"], callsToday: 0, callsTotal: 0, errorRate: "—",
    lastCall: "never", description: "Post alerts, pipeline updates, and task completions to channels.",
    config: { apiVersion: "v2", baseUrl: "slack.com/api", rateLimit: "1 req/s per method" },
  },
  {
    id: "t_notion", name: "Notion", icon: "N", color: "#ffffff", category: "knowledge",
    status: "healthy", health: 100, owner: "Content Agent",
    permissions: ["read_pages","write_pages","read_databases","create_pages"],
    usedBy: ["content","research","dev"], callsToday: 18, callsTotal: 640, errorRate: "0.0%",
    lastCall: "1h ago", description: "Sync pages and databases to the Knowledge Base, write docs and reports.",
    config: { apiVersion: "2022-06-28", baseUrl: "api.notion.com", rateLimit: "3 req/s" },
  },
  {
    id: "t_gdrive", name: "Google Drive", icon: "▲", color: "#fbbc04", category: "storage",
    status: "disconnected", health: 0, owner: "Research Agent",
    permissions: ["read_files","write_files","list_folders"],
    usedBy: ["research","content"], callsToday: 0, callsTotal: 0, errorRate: "—",
    lastCall: "never", description: "Access and write files and folders, read documents into Knowledge Base.",
    config: { apiVersion: "v3", baseUrl: "www.googleapis.com/drive", rateLimit: "1000 req/100s" },
  },
  {
    id: "t_telegram", name: "Telegram", icon: "✈", color: "#2aabee", category: "communication",
    status: "healthy", health: 98, owner: "Support Agent",
    permissions: ["send_messages","receive_commands","read_updates"],
    usedBy: ["support","devops","analytics"], callsToday: 22, callsTotal: 890, errorRate: "0.2%",
    lastCall: "5 min ago", description: "Send notifications, workflow alerts, and receive bot commands.",
    config: { apiVersion: "Bot API 7.x", baseUrl: "api.telegram.org", rateLimit: "30 msg/s" },
  },
  {
    id: "t_openrouter", name: "OpenRouter", icon: "⊕", color: "#7c6fff", category: "ai",
    status: "healthy", health: 99, owner: "System",
    permissions: ["inference","model_routing","streaming"],
    usedBy: ["seo","marketing","content","support","sales","dev","research","analytics"], callsToday: 134, callsTotal: 6420, errorRate: "0.1%",
    lastCall: "2 min ago", description: "Unified LLM routing — access 100+ models from a single API.",
    config: { apiVersion: "v1", baseUrl: "openrouter.ai/api", rateLimit: "per-model" },
  },
  {
    id: "t_ollama", name: "Ollama", icon: "◎", color: "#52d68a", category: "ai",
    status: "degraded", health: 62, owner: "Dev Agent",
    permissions: ["local_inference","model_pull","streaming"],
    usedBy: ["dev","research"], callsToday: 8, callsTotal: 210, errorRate: "3.1%",
    lastCall: "30 min ago", description: "Local model inference for private data tasks and low-latency dev workflows.",
    config: { apiVersion: "v0.1", baseUrl: "localhost:11434", rateLimit: "hardware-limited" },
  },
];

const AGENT_COLORS = {
  dev:"#e6edf3", devops:"#fc6d26", marketing:"#f0b429", content:"#7c6fff",
  support:"#52d68a", sales:"#da552f", research:"#a78bfa", analytics:"#38bdf8",
  seo:"#4ecdc4",
};

const STATUS_CFG = {
  healthy:     { color: "var(--success)", label: "Healthy"     },
  degraded:    { color: "var(--warning)", label: "Degraded"    },
  disconnected:{ color: "var(--text-faint)",label:"Disconnected"},
  error:       { color: "var(--danger)",  label: "Error"       },
};

function HealthBar({ pct, color }) {
  return (
    <div className="tfc-health-bar-track">
      <div className="tfc-health-bar-fill" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

export default function ToolFabricCenter({ onNavigate }) {
  const [tools,      setTools]      = useState(() => _load(TOOLS_KEY, SEED_TOOLS));
  const [selected,   setSelected]   = useState("t_openrouter");
  const [catFilter,  setCatFilter]  = useState("all");
  const [staFilter,  setStaFilter]  = useState("all");
  const [toast,      setToast]      = useState(null);
  const [apiError,   setApiError]   = useState(null);
  const [toolInput,  setToolInput]  = useState("");
  const [toolRunning,setToolRunning]= useState(false);
  const [toolResult, setToolResult] = useState(null);
  const [toolErr,    setToolErr]    = useState(null);

  useEffect(() => { track.event("tool_fabric_viewed"); }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listTools(), toolStatus()])
      .then(([listRes, statusRes]) => {
        if (cancelled) return;
        const liveTool = listRes?.tools;
        const statusMap = statusRes?.status || {};
        if (Array.isArray(liveTool) && liveTool.length > 0) {
          const mapped = liveTool.map(t => ({
            id:          t.id || t.name,
            name:        t.name,
            icon:        t.icon || "◉",
            color:       "#ffffff",
            category:    t.category || "runtime",
            status:      t.status || statusMap[t.id] || "healthy",
            health:      t.health ?? 100,
            owner:       t.owner || "Runtime",
            permissions: Array.isArray(t.permissions) ? t.permissions : [],
            usedBy:      Array.isArray(t.usedBy) ? t.usedBy : [],
            callsToday:  t.callsToday ?? 0,
            callsTotal:  t.callsTotal ?? 0,
            errorRate:   t.errorRate ?? "0%",
            lastCall:    t.lastCall || "—",
            description: t.description || "",
            config:      t.config || {},
          }));
          setTools(mapped);
          _save(TOOLS_KEY, mapped);
          setSelected(mapped[0]?.id || null);
        }
      })
      .catch(err => { if (!cancelled) setApiError(err.message); });
    return () => { cancelled = true; };
  }, []);
  const showToast = m => { setToast(m); setTimeout(()=>setToast(null), 2400); };

  const handleConnect = useCallback(id => {
    setTools(prev => {
      const next = prev.map(t => t.id===id ? {...t, status:"healthy", health:100, lastCall:"just now"} : t);
      _save(TOOLS_KEY, next); return next;
    });
    showToast(`${SEED_TOOLS.find(t=>t.id===id)?.name} connected`);
    track.event("tool_connected", { id });
  }, []);

  const handleDisconnect = useCallback(id => {
    setTools(prev => {
      const next = prev.map(t => t.id===id ? {...t, status:"disconnected", health:0, callsToday:0, lastCall:"never"} : t);
      _save(TOOLS_KEY, next); return next;
    });
    setSelected(null); showToast("Tool disconnected");
  }, []);

  const allCats = [...new Set(SEED_TOOLS.map(t=>t.category))];
  const visible = tools.filter(t =>
    (catFilter==="all" || t.category===catFilter) &&
    (staFilter==="all" || t.status===staFilter)
  );
  const selTool = selected ? tools.find(t=>t.id===selected) : null;
  const connectedCount = tools.filter(t=>t.status!=="disconnected").length;
  const healthyCount   = tools.filter(t=>t.status==="healthy").length;
  const totalCalls     = tools.reduce((s,t)=>s+t.callsToday,0);

  return (
    <div className="tool-fabric-center page-enter">
      {toast && <div className="tfc-toast">{toast}</div>}
      {apiError && <div className="ac-api-banner ac-api-banner--error">⚠ Live tool data unavailable — showing cached data ({apiError})</div>}

      <div className="tfc-header">
        <div>
          <h1 className="tfc-title">Tool Fabric</h1>
          <p className="tfc-subtitle">Tool registry, permissions, ownership, health, and usage across all agents.</p>
        </div>
      </div>

      <div className="tfc-summary-strip">
        {[
          { label: "Tools",      value: tools.length,    color:"var(--text)"     },
          { label: "Connected",  value: connectedCount,  color:"var(--success)"  },
          { label: "Healthy",    value: healthyCount,    color:"var(--success)"  },
          { label: "Degraded",   value: tools.filter(t=>t.status==="degraded").length,  color:"var(--warning)" },
          { label: "Calls today",value: totalCalls,      color:"var(--accent2)"  },
          { label: "Disconnected",value:tools.filter(t=>t.status==="disconnected").length, color:"var(--text-faint)" },
        ].map(s=>(
          <div key={s.label} className="tfc-summary-tile">
            <span className="tfc-sv" style={{ color: s.color }}>{s.value}</span>
            <span className="tfc-sl">{s.label}</span>
          </div>
        ))}
      </div>

      <div className="tfc-filters">
        <div className="tfc-filter-row">
          <button className={`tfc-chip${catFilter==="all"?" tfc-chip--active":""}`} onClick={()=>setCatFilter("all")}>All</button>
          {allCats.map(c=>(
            <button key={c} className={`tfc-chip${catFilter===c?" tfc-chip--active":""}`} onClick={()=>setCatFilter(p=>p===c?"all":c)}>{c}</button>
          ))}
        </div>
        <div className="tfc-filter-row">
          {["all","healthy","degraded","disconnected"].map(s=>(
            <button key={s} className={`tfc-chip${staFilter===s?" tfc-chip--active":""}`} onClick={()=>setStaFilter(s)}>{s}</button>
          ))}
        </div>
      </div>

      <div className="tfc-layout">
        <div className="tfc-list">
          {visible.map(t => {
            const sc = STATUS_CFG[t.status] || STATUS_CFG.disconnected;
            return (
              <button key={t.id}
                className={`tfc-tool-row${selected===t.id?" tfc-tool-row--sel":""}`}
                onClick={()=>setSelected(p=>p===t.id?null:t.id)}
              >
                <div className="tfc-tr-icon-wrap" style={{ background: t.color+"18", borderColor: t.color+"2e" }}>
                  <span className="tfc-tr-icon" style={{ color: t.color }}>{t.icon}</span>
                </div>
                <div className="tfc-tr-info">
                  <span className="tfc-tr-name">{t.name}</span>
                  <span className="tfc-tr-cat">{t.category}</span>
                </div>
                <div className="tfc-tr-health-col">
                  <HealthBar pct={t.health} color={sc.color} />
                  <span className="tfc-tr-health-pct" style={{ color: sc.color }}>{t.health}%</span>
                </div>
                <span className="tfc-tr-calls">{t.callsToday} today</span>
                <span className="tfc-tr-status" style={{ color: sc.color }}>{sc.label}</span>
              </button>
            );
          })}
        </div>

        {selTool && (() => {
          const sc = STATUS_CFG[selTool.status] || STATUS_CFG.disconnected;
          return (
            <div className="tfc-detail">
              <div className="tfc-detail-head">
                <div className="tfc-detail-icon-wrap" style={{ background: selTool.color+"18", borderColor: selTool.color+"2e" }}>
                  <span style={{ color: selTool.color, fontSize: 22, fontWeight: 900 }}>{selTool.icon}</span>
                </div>
                <div>
                  <span className="tfc-detail-name">{selTool.name}</span>
                  <span className="tfc-detail-cat">{selTool.category}</span>
                </div>
              </div>
              <p className="tfc-detail-desc">{selTool.description}</p>

              <div className="tfc-detail-health-row">
                <span className="tfc-dh-label">Health</span>
                <div className="tfc-dh-bar-wrap">
                  <HealthBar pct={selTool.health} color={sc.color} />
                </div>
                <span className="tfc-dh-val" style={{ color: sc.color }}>{selTool.health}%</span>
                <span className="tfc-dh-status" style={{ color: sc.color, borderColor: sc.color+"33" }}>{sc.label}</span>
              </div>

              <div className="tfc-detail-meta-grid">
                <span className="tfc-dml">Owner</span><span className="tfc-dmv">{selTool.owner}</span>
                <span className="tfc-dml">Calls today</span><span className="tfc-dmv">{selTool.callsToday}</span>
                <span className="tfc-dml">Total calls</span><span className="tfc-dmv">{selTool.callsTotal}</span>
                <span className="tfc-dml">Error rate</span>
                <span className="tfc-dmv" style={{ color: selTool.errorRate!=="—"&&parseFloat(selTool.errorRate)>1?"var(--danger)":"inherit" }}>{selTool.errorRate}</span>
                <span className="tfc-dml">Last call</span><span className="tfc-dmv">{selTool.lastCall}</span>
              </div>

              <div className="tfc-detail-section">
                <p className="tfc-ds-label">Permissions</p>
                <div className="tfc-chips">
                  {selTool.permissions.map(p=><span key={p} className="tfc-perm-chip tfc-mono">{p}</span>)}
                </div>
              </div>

              <div className="tfc-detail-section">
                <p className="tfc-ds-label">Used by agents</p>
                <div className="tfc-chips">
                  {selTool.usedBy.map(ag=>(
                    <span key={ag} className="tfc-agent-chip" style={{ color: AGENT_COLORS[ag]||"var(--text-faint)", borderColor: (AGENT_COLORS[ag]||"#fff")+"33" }}>{ag}</span>
                  ))}
                </div>
              </div>

              <div className="tfc-detail-section">
                <p className="tfc-ds-label">Config</p>
                <div className="tfc-config-box">
                  {Object.entries(selTool.config).map(([k,v])=>(
                    <div key={k} className="tfc-config-row">
                      <span className="tfc-config-key">{k}</span>
                      <span className="tfc-config-val tfc-mono">{v}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="tfc-detail-section">
                <p className="tfc-ds-label">Execute tool</p>
                <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                  <input
                    className="mc-form-input"
                    style={{ flex:1, minWidth:0 }}
                    value={toolInput}
                    onChange={e => { setToolInput(e.target.value); setToolResult(null); setToolErr(null); }}
                    onKeyDown={e => {
                      if (e.key === "Enter" && toolInput.trim() && !toolRunning) {
                        setToolRunning(true);
                        executeTool(selTool.id, toolInput.trim())
                          .then(r => setToolResult(r))
                          .catch(e => setToolErr(e.message))
                          .finally(() => setToolRunning(false));
                      }
                    }}
                    placeholder={`Input for ${selTool.name}…`}
                  />
                  <button
                    disabled={toolRunning || !toolInput.trim()}
                    onClick={() => {
                      if (!toolInput.trim() || toolRunning) return;
                      setToolRunning(true); setToolResult(null); setToolErr(null);
                      executeTool(selTool.id, toolInput.trim())
                        .then(r => setToolResult(r))
                        .catch(e => setToolErr(e.message))
                        .finally(() => setToolRunning(false));
                    }}
                    style={{ padding:"8px 16px", background:"linear-gradient(135deg,var(--accent),var(--accent2))", color:"#06080e", border:"none", borderRadius:"var(--radius-pill)", fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"inherit", whiteSpace:"nowrap" }}
                  >{toolRunning ? "Running…" : "▷ Run"}</button>
                </div>
                {toolErr && <p style={{ color:"var(--danger)", fontSize:12, marginTop:6 }}>Error: {toolErr}</p>}
                {toolResult && (
                  <div style={{ marginTop:8, padding:"8px 12px", background:"var(--surface-raised)", borderRadius:"var(--radius)", fontSize:12 }}>
                    <span style={{ color: toolResult.success ? "var(--success)" : "var(--warning)", fontWeight:700 }}>
                      {toolResult.success ? "✓ Success" : "⚠ Result"}
                    </span>
                    {" — "}{typeof toolResult.output === "string" ? toolResult.output : JSON.stringify(toolResult.output || toolResult.result || toolResult.error || "done")}
                  </div>
                )}
              </div>

              <div className="tfc-detail-actions">
                {selTool.status==="disconnected" ? (
                  <button className="tfc-act-btn tfc-act-btn--connect" onClick={()=>handleConnect(selTool.id)}>Connect →</button>
                ) : (
                  <button className="tfc-act-btn tfc-act-btn--disconnect" onClick={()=>handleDisconnect(selTool.id)}>Disconnect</button>
                )}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
