import React, { useState, useRef, useEffect } from "react";
import { track } from "../analytics";
import { listCoordSessions, getCoordStats, agentCollaborate, agentHandoff, agentDelegate } from "../phase19Api";
import "./AgentCollaborationCenter.css";

// ── Agent roster ─────────────────────────────────────────────────────
const AGENTS = {
  seo:       { name: "SEO",       icon: "⌕", color: "#4ecdc4" },
  marketing: { name: "Marketing", icon: "◉", color: "#f0b429" },
  content:   { name: "Content",   icon: "◈", color: "#7c6fff" },
  support:   { name: "Support",   icon: "◎", color: "#52d68a" },
  sales:     { name: "Sales",     icon: "◇", color: "#da552f" },
  dev:       { name: "Dev",       icon: "⬡", color: "#e6edf3" },
  devops:    { name: "DevOps",    icon: "⬟", color: "#fc6d26" },
  research:  { name: "Research",  icon: "⊕", color: "#a78bfa" },
  analytics: { name: "Analytics", icon: "▣", color: "#38bdf8" },
};

// ── Seed handoffs ─────────────────────────────────────────────────────
const HANDOFFS = [
  { id: "h1",  from: "sales",    to: "support",   type: "handoff",    title: "Lead #4821 converted → onboarding",        status: "success",  ts: "14:08", detail: "Deal closed. Handed to Support for product onboarding sequence." },
  { id: "h2",  from: "support",  to: "sales",     type: "escalation", title: "Upsell signal detected — ticket #1019",    status: "success",  ts: "13:52", detail: "User asked about Growth plan features. Routed to Sales for closing." },
  { id: "h3",  from: "seo",      to: "content",   type: "handoff",    title: "Keyword brief ready for blog post",         status: "success",  ts: "13:30", detail: "Top 5 keywords + intent analysis passed to Content Agent." },
  { id: "h4",  from: "research", to: "content",   type: "handoff",    title: "Competitor analysis → blog brief",          status: "success",  ts: "11:14", detail: "10-page competitor landscape delivered. Content Agent drafting post." },
  { id: "h5",  from: "analytics",to: "marketing", type: "trigger",    title: "CTR drop detected — email open rate -12%",  status: "active",   ts: "10:45", detail: "Analytics Agent flagged anomaly. Marketing Agent reviewing subject lines." },
  { id: "h6",  from: "devops",   to: "dev",       type: "trigger",    title: "Deploy passed → unblocked PR queue",        status: "success",  ts: "11:55", detail: "Health check green post-deploy. Dev Agent resuming review queue." },
  { id: "h7",  from: "support",  to: "dev",       type: "escalation", title: "Bug report #112 — reproducible crash",      status: "active",   ts: "09:40", detail: "3 users reporting null crash on Android 12. Routed to Dev." },
  { id: "h8",  from: "marketing",to: "seo",       type: "dependency", title: "Campaign needs landing page SEO audit",     status: "pending",  ts: "15:00", detail: "Email campaign launches Monday. SEO audit of /pricing required first." },
  { id: "h9",  from: "content",  to: "marketing", type: "handoff",    title: "Blog post ready → distribution",            status: "pending",  ts: "14:55", detail: "Draft complete. Passed to Marketing for scheduling and promotion." },
  { id: "h10", from: "sales",    to: "analytics", type: "dependency", title: "Pipeline report needed before team call",   status: "pending",  ts: "16:00", detail: "Sales weekly sync at 16:00. Analytics must complete pipeline summary." },
];

// ── Shared tasks ──────────────────────────────────────────────────────
const SHARED_TASKS = [
  { id: "st1", title: "Product Hunt launch preparation",    agents: ["marketing","seo","content","dev"],  status: "in_progress", progress: 62, due: "2026-06-10" },
  { id: "st2", title: "Weekly performance report",          agents: ["analytics","sales","support"],      status: "in_progress", progress: 80, due: "2026-06-07" },
  { id: "st3", title: "Blog post: WhatsApp automation",     agents: ["research","seo","content","marketing"], status: "in_progress", progress: 45, due: "2026-06-08" },
  { id: "st4", title: "Enterprise onboarding flow",         agents: ["sales","support","dev"],            status: "pending",     progress: 10, due: "2026-06-12" },
  { id: "st5", title: "Infra hardening sprint",             agents: ["devops","dev"],                     status: "in_progress", progress: 35, due: "2026-06-09" },
];

// ── Canvas collaboration graph ────────────────────────────────────────
function CollabGraph({ handoffs, selectedEdge, onSelectEdge }) {
  const canvasRef = useRef(null);
  const edgeHitRef = useRef([]);

  const AGENT_KEYS = Object.keys(AGENTS);
  const N = AGENT_KEYS.length;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    const cx = W / 2, cy = H / 2, R = 155;

    const positions = {};
    AGENT_KEYS.forEach((k, i) => {
      const a = ((i / N) * 2 * Math.PI) - Math.PI / 2;
      positions[k] = { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) };
    });

    ctx.clearRect(0, 0, W, H);
    edgeHitRef.current = [];

    // Count connections per pair
    const pairCount = {};
    handoffs.forEach(h => {
      const key = [h.from, h.to].sort().join("--");
      pairCount[key] = (pairCount[key] || 0) + 1;
    });

    // Draw edges
    const drawn = new Set();
    handoffs.forEach(h => {
      const key = [h.from, h.to].sort().join("--");
      if (drawn.has(key)) return;
      drawn.add(key);
      const src = positions[h.from], dst = positions[h.to];
      if (!src || !dst) return;
      const cnt = pairCount[key] || 1;
      const isSelected = selectedEdge && (
        (selectedEdge.from === h.from && selectedEdge.to === h.to) ||
        (selectedEdge.from === h.to && selectedEdge.to === h.from)
      );
      const col = isSelected ? "#7c6fff" : "rgba(255,255,255,0.12)";
      const w   = isSelected ? 2.5 : Math.min(cnt * 0.8 + 0.6, 3);

      ctx.beginPath();
      ctx.moveTo(src.x, src.y);
      ctx.lineTo(dst.x, dst.y);
      ctx.strokeStyle = col;
      ctx.lineWidth = w;
      ctx.stroke();

      // Store midpoint for hit detection
      const mx = (src.x + dst.x) / 2, my = (src.y + dst.y) / 2;
      edgeHitRef.current.push({ from: h.from, to: h.to, mx, my });

      // Count label
      if (cnt > 1) {
        ctx.font = "700 9px system-ui";
        ctx.fillStyle = "rgba(255,255,255,0.35)";
        ctx.textAlign = "center";
        ctx.fillText(cnt, mx, my - 4);
      }
    });

    // Draw nodes
    AGENT_KEYS.forEach(k => {
      const ag = AGENTS[k];
      const { x, y } = positions[k];
      const activeIn = handoffs.filter(h => h.from === k || h.to === k).length;
      const r = 18 + Math.min(activeIn * 1.5, 8);

      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = ag.color + "22";
      ctx.fill();
      ctx.strokeStyle = ag.color;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.font = `900 ${r > 22 ? 15 : 13}px system-ui`;
      ctx.fillStyle = ag.color;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(ag.icon, x, y);

      ctx.font = "600 9px system-ui";
      ctx.fillStyle = "rgba(200,205,212,0.75)";
      ctx.textBaseline = "top";
      ctx.fillText(ag.name, x, y + r + 4);
    });
  }, [handoffs, selectedEdge]);

  const handleClick = e => {
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    let hit = null;
    edgeHitRef.current.forEach(edge => {
      if (Math.sqrt((mx - edge.mx) ** 2 + (my - edge.my) ** 2) < 18) hit = edge;
    });
    if (hit) onSelectEdge(hit);
    else onSelectEdge(null);
  };

  return (
    <canvas ref={canvasRef} width={500} height={440} className="acc-graph-canvas" onClick={handleClick} />
  );
}

const TYPE_COLORS  = { handoff: "#4ecdc4", escalation: "#f55b5b", trigger: "#f0b429", dependency: "#a78bfa" };
const STA_COLORS   = { success: "#52d68a", active: "#4ecdc4", pending: "#f0b429", failed: "#f55b5b" };

export default function AgentCollaborationCenter({ onNavigate }) {
  const [section,    setSection]    = useState("graph");
  const [selEdge,    setSelEdge]    = useState(null);
  const [typeFilter, setTypeFilter] = useState("all");
  const [sessions,   setSessions]   = useState([]);
  const [coordStats, setCoordStats] = useState(null);
  const [apiError,   setApiError]   = useState(null);
  const [showCoord,  setShowCoord]  = useState(false);
  const [coordMode,  setCoordMode]  = useState("collaborate");
  const [coordFrom,  setCoordFrom]  = useState("seo");
  const [coordTo,    setCoordTo]    = useState("content");
  const [coordGoal,  setCoordGoal]  = useState("");
  const [coordRunning,setCoordRunning] = useState(false);
  const [coordResult, setCoordResult] = useState(null);
  const [coordErr,   setCoordErr]   = useState(null);

  function handleCoord() {
    if (!coordGoal.trim() || coordRunning) return;
    setCoordRunning(true); setCoordResult(null); setCoordErr(null);
    const agentNames = Object.keys(AGENTS);
    const fn = coordMode === "handoff" ? agentHandoff(coordFrom, coordTo, coordGoal)
             : coordMode === "delegate" ? agentDelegate(coordFrom, coordTo, coordGoal)
             : agentCollaborate([coordFrom, coordTo], coordGoal);
    fn.then(r => {
        setCoordResult(r);
        track.event("coord_session_started", { mode: coordMode });
        listCoordSessions({ limit: 20 }).then(res => { if (res?.sessions) setSessions(res.sessions); }).catch(()=>{});
        setTimeout(() => { setShowCoord(false); setCoordResult(null); }, 1800);
      })
      .catch(e => setCoordErr(e.message))
      .finally(() => setCoordRunning(false));
  }

  React.useEffect(() => { track.event("agent_collab_viewed"); }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listCoordSessions({ limit: 20 }), getCoordStats()])
      .then(([sessRes, statsRes]) => {
        if (cancelled) return;
        const liveSessions = sessRes?.sessions;
        if (Array.isArray(liveSessions)) setSessions(liveSessions);
        if (statsRes) setCoordStats(statsRes);
      })
      .catch(err => { if (!cancelled) setApiError(err.message); });
    return () => { cancelled = true; };
  }, []);

  const filtered = HANDOFFS.filter(h => typeFilter === "all" || h.type === typeFilter);
  const edgeHandoffs = selEdge
    ? HANDOFFS.filter(h => (h.from === selEdge.from && h.to === selEdge.to) || (h.from === selEdge.to && h.to === selEdge.from))
    : [];

  const byType = t => HANDOFFS.filter(h => h.type === t).length;

  return (
    <div className="agent-collab-center page-enter">
      {apiError && <div className="ac-api-banner ac-api-banner--error">⚠ Live coordination data unavailable — showing cached data ({apiError})</div>}
      <div className="acc-header">
        <div>
          <h1 className="acc-title">Agent Collaboration Engine</h1>
          <p className="acc-subtitle">Handoffs, shared tasks, escalations, dependencies, and collaboration graph.</p>
        </div>
        <button onClick={() => { setShowCoord(true); setCoordGoal(""); setCoordResult(null); setCoordErr(null); }}
          style={{ padding:"9px 18px", background:"linear-gradient(135deg,var(--accent),var(--accent2))", color:"#06080e", border:"none", borderRadius:"var(--radius-pill)", fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"inherit", whiteSpace:"nowrap" }}>
          + Start Session
        </button>
      </div>

      {/* Summary */}
      <div className="acc-summary-strip">
        {[
          { label: "Total events",  value: HANDOFFS.length,    color: "var(--text)"    },
          { label: "Handoffs",      value: byType("handoff"),  color: "#4ecdc4"        },
          { label: "Escalations",   value: byType("escalation"),color:"#f55b5b"        },
          { label: "Triggers",      value: byType("trigger"),  color: "#f0b429"        },
          { label: "Dependencies",  value: byType("dependency"),color:"#a78bfa"        },
          { label: "Active now",    value: HANDOFFS.filter(h=>h.status==="active").length, color:"var(--accent2)" },
          { label: "Live sessions", value: sessions.length ?? coordStats?.totalSessions ?? 0, color: "var(--success)" },
        ].map(s => (
          <div key={s.label} className="acc-summary-tile">
            <span className="acc-sv" style={{ color: s.color }}>{s.value}</span>
            <span className="acc-sl">{s.label}</span>
          </div>
        ))}
      </div>

      <div className="acc-tabs">
        {[
          { id: "graph",   label: "Collaboration Graph" },
          { id: "feed",    label: "Event Feed"          },
          { id: "shared",  label: "Shared Tasks"        },
        ].map(t => (
          <button key={t.id} className={`acc-tab${section===t.id?" acc-tab--active":""}`} onClick={()=>setSection(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="acc-content" key={section}>

        {/* Graph */}
        {section === "graph" && (
          <div className="acc-graph-layout">
            <div className="acc-graph-wrap">
              <CollabGraph handoffs={HANDOFFS} selectedEdge={selEdge} onSelectEdge={setSelEdge} />
              <p className="acc-graph-hint">Click an edge to see events between two agents</p>
            </div>
            <div className="acc-graph-side">
              <div className="acc-legend">
                {Object.entries(TYPE_COLORS).map(([t,c]) => (
                  <span key={t} className="acc-legend-item">
                    <span className="acc-legend-dot" style={{ background: c }} />{t}
                  </span>
                ))}
              </div>
              {selEdge ? (
                <div className="acc-edge-detail">
                  <div className="acc-edge-pair">
                    <span style={{ color: AGENTS[selEdge.from]?.color }}>{AGENTS[selEdge.from]?.icon} {AGENTS[selEdge.from]?.name}</span>
                    <span className="acc-edge-arrow">↔</span>
                    <span style={{ color: AGENTS[selEdge.to]?.color }}>{AGENTS[selEdge.to]?.icon} {AGENTS[selEdge.to]?.name}</span>
                  </div>
                  <div className="acc-edge-events">
                    {edgeHandoffs.map(h => (
                      <div key={h.id} className="acc-edge-event">
                        <span className="acc-ee-type" style={{ color: TYPE_COLORS[h.type] }}>{h.type}</span>
                        <span className="acc-ee-title">{h.title}</span>
                        <span className="acc-ee-ts">{h.ts}</span>
                        <span className="acc-ee-status" style={{ color: STA_COLORS[h.status] }}>{h.status}</span>
                        <p className="acc-ee-detail">{h.detail}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="acc-edge-placeholder">
                  <span>Click an edge in the graph to inspect events between two agents</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Feed */}
        {section === "feed" && (
          <div className="acc-feed-section">
            <div className="acc-type-chips">
              {["all","handoff","escalation","trigger","dependency"].map(t => (
                <button key={t}
                  className={`acc-chip${typeFilter===t?" acc-chip--active":""}`}
                  style={typeFilter===t&&t!=="all"?{color:TYPE_COLORS[t],borderColor:TYPE_COLORS[t]+"44"}:{}}
                  onClick={()=>setTypeFilter(t)}>{t}</button>
              ))}
            </div>
            <div className="acc-feed-list">
              {filtered.map(h => (
                <div key={h.id} className="acc-feed-row">
                  <span className="acc-feed-ts">{h.ts}</span>
                  <span className="acc-feed-type-dot" style={{ background: TYPE_COLORS[h.type] }} />
                  <div className="acc-feed-agents">
                    <span style={{ color: AGENTS[h.from]?.color }}>{AGENTS[h.from]?.icon} {AGENTS[h.from]?.name}</span>
                    <span className="acc-feed-arrow">→</span>
                    <span style={{ color: AGENTS[h.to]?.color }}>{AGENTS[h.to]?.icon} {AGENTS[h.to]?.name}</span>
                  </div>
                  <div className="acc-feed-info">
                    <span className="acc-feed-title">{h.title}</span>
                    <span className="acc-feed-detail">{h.detail}</span>
                  </div>
                  <span className="acc-feed-status" style={{ color: STA_COLORS[h.status], borderColor: STA_COLORS[h.status]+"33" }}>{h.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Shared tasks */}
        {section === "shared" && (
          <div className="acc-shared-list">
            {SHARED_TASKS.map(t => (
              <div key={t.id} className="acc-shared-card">
                <div className="acc-shared-header">
                  <span className="acc-shared-title">{t.title}</span>
                  <span className="acc-shared-due">Due {t.due}</span>
                  <span className="acc-shared-status" style={{ color: STA_COLORS[t.status], borderColor: STA_COLORS[t.status]+"33" }}>{t.status.replace("_"," ")}</span>
                </div>
                <div className="acc-shared-progress-row">
                  <div className="acc-shared-bar-track">
                    <div className="acc-shared-bar-fill" style={{ width: `${t.progress}%` }} />
                  </div>
                  <span className="acc-shared-pct">{t.progress}%</span>
                </div>
                <div className="acc-shared-agents">
                  {t.agents.map(ag => (
                    <span key={ag} className="acc-agent-chip" style={{ color: AGENTS[ag]?.color, borderColor: AGENTS[ag]?.color+"33" }}>
                      {AGENTS[ag]?.icon} {AGENTS[ag]?.name}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

      </div>

      {showCoord && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center" }}
          onClick={e => e.target === e.currentTarget && setShowCoord(false)}>
          <div style={{ background:"var(--surface-base)", border:"1px solid var(--border)", borderRadius:"var(--radius)", padding:24, width:"min(480px,90vw)", display:"flex", flexDirection:"column", gap:14 }}>
            <h3 style={{ margin:0, fontSize:16, fontWeight:700 }}>Start Coordination Session</h3>
            <div style={{ display:"flex", gap:8 }}>
              {["collaborate","handoff","delegate"].map(m => (
                <button key={m} onClick={() => setCoordMode(m)}
                  style={{ flex:1, padding:"7px 0", border:"1px solid var(--border)", borderRadius:"var(--radius-pill)", background: coordMode===m ? "var(--accent)" : "var(--surface-raised)", color: coordMode===m ? "#06080e" : "var(--text-dim)", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit", textTransform:"capitalize" }}>
                  {m}
                </button>
              ))}
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <div style={{ flex:1, display:"flex", flexDirection:"column", gap:4 }}>
                <label style={{ fontSize:11, fontWeight:700, color:"var(--text-dim)" }}>From</label>
                <select value={coordFrom} onChange={e => setCoordFrom(e.target.value)}
                  style={{ background:"var(--surface-raised)", border:"1px solid var(--border)", borderRadius:"var(--radius)", padding:"7px 10px", color:"var(--text)", fontSize:12, fontFamily:"inherit" }}>
                  {Object.entries(AGENTS).map(([k,v]) => <option key={k} value={k}>{v.name}</option>)}
                </select>
              </div>
              {coordMode !== "collaborate" && (
                <div style={{ flex:1, display:"flex", flexDirection:"column", gap:4 }}>
                  <label style={{ fontSize:11, fontWeight:700, color:"var(--text-dim)" }}>To</label>
                  <select value={coordTo} onChange={e => setCoordTo(e.target.value)}
                    style={{ background:"var(--surface-raised)", border:"1px solid var(--border)", borderRadius:"var(--radius)", padding:"7px 10px", color:"var(--text)", fontSize:12, fontFamily:"inherit" }}>
                    {Object.entries(AGENTS).map(([k,v]) => <option key={k} value={k}>{v.name}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
              <label style={{ fontSize:12, fontWeight:700, color:"var(--text-dim)" }}>{coordMode === "delegate" ? "Task" : "Goal / context"}</label>
              <textarea rows={3} style={{ background:"var(--surface-raised)", border:"1px solid var(--border)", borderRadius:"var(--radius)", padding:"8px 12px", color:"var(--text)", fontSize:13, fontFamily:"inherit", resize:"vertical" }}
                value={coordGoal} onChange={e => setCoordGoal(e.target.value)}
                placeholder={coordMode === "handoff" ? "Handoff context…" : coordMode === "delegate" ? "Task to delegate…" : "Collaboration goal…"}
                autoFocus />
            </div>
            {coordErr && <p style={{ margin:0, fontSize:12, color:"var(--danger)" }}>Error: {coordErr}</p>}
            {coordResult && <p style={{ margin:0, fontSize:12, color:"var(--success)" }}>✓ Session started: {coordResult.sessionId || JSON.stringify(coordResult).slice(0,60)}</p>}
            <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
              <button onClick={() => setShowCoord(false)} style={{ padding:"8px 16px", background:"var(--surface-raised)", border:"1px solid var(--border)", borderRadius:"var(--radius-pill)", cursor:"pointer", fontSize:13, color:"var(--text-dim)", fontFamily:"inherit" }}>Cancel</button>
              <button onClick={handleCoord} disabled={coordRunning || !coordGoal.trim()}
                style={{ padding:"8px 18px", background:"linear-gradient(135deg,var(--accent),var(--accent2))", color:"#06080e", border:"none", borderRadius:"var(--radius-pill)", fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
                {coordRunning ? "Starting…" : "▷ Start"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
