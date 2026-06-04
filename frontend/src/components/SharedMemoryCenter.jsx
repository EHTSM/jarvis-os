import React, { useState, useCallback, useRef, useEffect } from "react";
import { track } from "../analytics";
import "./SharedMemoryCenter.css";

// ── Seed memory fabric ────────────────────────────────────────────────
const MEMORY_NODES = [
  // Global
  { id: "gm1",  scope: "global",  category: "identity",  title: "Platform name",            body: "Ooplix — AI Operating System for business operators",              importance: "critical", usedBy: ["ag_seo","ag_marketing","ag_content","ag_support","ag_sales","ag_dev","ag_devops","ag_research","ag_analytics"], accessCount: 312, lastAccessed: "2 min ago"  },
  { id: "gm2",  scope: "global",  category: "identity",  title: "Owner",                    body: "Altamashjauhar. Primary operator and product owner.",               importance: "critical", usedBy: ["ag_support","ag_sales","ag_dev"], accessCount: 88, lastAccessed: "14 min ago" },
  // Company
  { id: "cm1",  scope: "company", category: "pricing",   title: "Starter plan",             body: "₹999/month. Up to 100 leads, 1 seat, 4 follow-up tiers.",          importance: "high",     usedBy: ["ag_marketing","ag_sales","ag_support"], accessCount: 140, lastAccessed: "20 min ago" },
  { id: "cm2",  scope: "company", category: "pricing",   title: "Growth plan",              body: "₹2,499/month. Up to 1,000 leads, 5 seats, all features.",          importance: "high",     usedBy: ["ag_marketing","ag_sales","ag_support"], accessCount: 129, lastAccessed: "20 min ago" },
  { id: "cm3",  scope: "company", category: "market",    title: "Target ICP",               body: "Indian SMBs: freelancers, coaches, agencies, consultants. WhatsApp-first. Price-sensitive.", importance: "critical", usedBy: ["ag_marketing","ag_sales","ag_seo","ag_content"], accessCount: 201, lastAccessed: "5 min ago" },
  { id: "cm4",  scope: "company", category: "brand",     title: "Tone of voice",            body: "Direct, operator-focused, no buzzwords. Lead with pain then solution.", importance: "medium", usedBy: ["ag_marketing","ag_content","ag_sales"], accessCount: 95, lastAccessed: "35 min ago" },
  // Agent
  { id: "am1",  scope: "agent",   category: "keywords",  title: "SEO primary keywords",     body: "WhatsApp follow-up automation India, AI CRM freelancers, Razorpay automation", importance: "high", usedBy: ["ag_seo","ag_content"], accessCount: 67, lastAccessed: "12 min ago" },
  { id: "am2",  scope: "agent",   category: "escalation","title": "Support escalation rules","body": "Escalate to human: billing disputes, security issues, churn risk, angry tone.", importance: "critical", usedBy: ["ag_support"], accessCount: 44, lastAccessed: "8 min ago"  },
  { id: "am3",  scope: "agent",   category: "outreach",  title: "Sales outreach template",   body: "Subject: saw your work on [X]. 1-line personal hook → 1-line pain → 1-line CTA.", importance: "medium", usedBy: ["ag_sales","ag_marketing"], accessCount: 38, lastAccessed: "1h ago"    },
  // Project
  { id: "pm1",  scope: "project", category: "workflow",  title: "WhatsApp follow-up sequence",body: "T+0 greeting → Day 3 check-in → Day 5 value add → Day 7 close → Day 14 re-engage.", importance: "high", usedBy: ["ag_sales","ag_support","ag_marketing"], accessCount: 182, lastAccessed: "3 min ago"  },
  { id: "pm2",  scope: "project", category: "tech",      title: "Webhook rate limit fix",    body: "Add rate-limit middleware before HMAC validator in routes/webhooks.js. PR in review.", importance: "high", usedBy: ["ag_dev","ag_devops"], accessCount: 12, lastAccessed: "45 min ago" },
  { id: "pm3",  scope: "project", category: "mission",   title: "Phase 11 mission",          body: "Build AgentRegistry, TaskRouter, SharedMemory, OperationsCenter. No backend rewrites.", importance: "critical", usedBy: ["ag_dev","ag_devops","ag_analytics"], accessCount: 7, lastAccessed: "just now"  },
];

const SCOPE_COLORS = { global: "var(--warning)", company: "var(--accent)", agent: "var(--accent2)", project: "#52d68a" };
const IMP_COLORS   = { critical: "var(--danger)", high: "var(--warning)", medium: "var(--accent2)", low: "var(--text-faint)" };
const AGENT_MAP    = {
  ag_seo: { name: "SEO", color: "var(--accent2)" }, ag_marketing: { name: "Marketing", color: "var(--warning)" },
  ag_content: { name: "Content", color: "var(--accent)" }, ag_support: { name: "Support", color: "#52d68a" },
  ag_sales: { name: "Sales", color: "#da552f" }, ag_dev: { name: "Dev", color: "#e6edf3" },
  ag_devops: { name: "DevOps", color: "#fc6d26" }, ag_research: { name: "Research", color: "#a78bfa" },
  ag_analytics: { name: "Analytics", color: "#38bdf8" },
};

// ── Simple canvas-based graph ─────────────────────────────────────────
function MemoryGraph({ nodes, onSelect }) {
  const canvasRef = useRef(null);
  const [hovered, setHovered] = useState(null);

  const nodePositions = useRef({});

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width; const H = canvas.height;

    // Layout: scopes in rings
    const scopeAngles = { global: 0, company: Math.PI * 0.5, agent: Math.PI, project: Math.PI * 1.5 };
    const positions = {};
    const scopeGroups = {};
    nodes.forEach(n => { if (!scopeGroups[n.scope]) scopeGroups[n.scope] = []; scopeGroups[n.scope].push(n); });

    Object.entries(scopeGroups).forEach(([scope, ns]) => {
      const baseAngle = scopeAngles[scope] || 0;
      const cx = W / 2; const cy = H / 2;
      const r = 150;
      ns.forEach((n, i) => {
        const a = baseAngle + (i - (ns.length - 1) / 2) * 0.4;
        positions[n.id] = { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), n };
      });
    });
    // Centre nodes (global/critical)
    const gNodes = nodes.filter(n => n.importance === "critical");
    gNodes.forEach((n, i) => {
      const a = (i / gNodes.length) * Math.PI * 2;
      positions[n.id] = { x: W/2 + 60 * Math.cos(a), y: H/2 + 60 * Math.sin(a), n };
    });
    nodePositions.current = positions;

    ctx.clearRect(0, 0, W, H);

    // Draw edges
    nodes.forEach(n => {
      n.usedBy.forEach(agId => {
        const src = positions[n.id];
        if (!src) return;
        ctx.beginPath();
        ctx.moveTo(src.x, src.y);
        // agent node — draw line toward edge
        const ang = Object.keys(scopeAngles).indexOf(n.scope) * Math.PI * 0.5;
        const ex = W/2 + 220 * Math.cos(ang + 0.05);
        const ey = H/2 + 220 * Math.sin(ang + 0.05);
        ctx.lineTo(ex, ey);
        ctx.strokeStyle = (SCOPE_COLORS[n.scope] || "#fff") + "1a";
        ctx.lineWidth = 1;
        ctx.stroke();
      });
    });

    // Draw scope labels
    Object.entries(scopeAngles).forEach(([scope, ang]) => {
      const x = W/2 + 220 * Math.cos(ang); const y = H/2 + 220 * Math.sin(ang);
      ctx.font = "700 10px system-ui";
      ctx.fillStyle = SCOPE_COLORS[scope] || "#fff";
      ctx.textAlign = "center";
      ctx.fillText(scope.toUpperCase(), x, y);
    });

    // Draw nodes
    Object.values(positions).forEach(({ x, y, n }) => {
      const r = n.importance === "critical" ? 9 : n.importance === "high" ? 7 : 5;
      const col = SCOPE_COLORS[n.scope] || "#fff";
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = col + (hovered === n.id ? "dd" : "66");
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = hovered === n.id ? 2 : 1;
      ctx.stroke();
      if (n.importance === "critical" || hovered === n.id) {
        ctx.font = hovered === n.id ? "700 11px system-ui" : "600 9px system-ui";
        ctx.fillStyle = "#c8cdd4";
        ctx.textAlign = "center";
        ctx.fillText(n.title.slice(0, 20), x, y - r - 4);
      }
    });
  }, [nodes, hovered]);

  const handleMouseMove = e => {
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left; const my = e.clientY - rect.top;
    let found = null;
    Object.values(nodePositions.current).forEach(({ x, y, n }) => {
      const dist = Math.sqrt((mx-x)**2 + (my-y)**2);
      if (dist < 12) found = n.id;
    });
    setHovered(found);
  };
  const handleClick = e => {
    if (hovered) {
      const pos = nodePositions.current[hovered];
      if (pos) onSelect(pos.n.id);
    }
  };

  return (
    <canvas
      ref={canvasRef} width={560} height={400}
      className="smc-graph-canvas"
      onMouseMove={handleMouseMove}
      onClick={handleClick}
      style={{ cursor: hovered ? "pointer" : "default" }}
    />
  );
}

export default function SharedMemoryCenter({ onNavigate }) {
  const [scope,    setScope]    = useState("all");
  const [section,  setSection]  = useState("list");
  const [selected, setSelected] = useState("gm1");
  const [search,   setSearch]   = useState("");

  React.useEffect(() => { track.event("shared_memory_viewed"); }, []);

  const visible = MEMORY_NODES.filter(n =>
    (scope === "all" || n.scope === scope) &&
    (!search || n.title.toLowerCase().includes(search.toLowerCase()) || n.body.toLowerCase().includes(search.toLowerCase()))
  );
  const selNode = selected ? MEMORY_NODES.find(n => n.id === selected) : null;

  const scopeCounts = ["global","company","agent","project"].reduce((acc,s)=>{acc[s]=MEMORY_NODES.filter(n=>n.scope===s).length;return acc;},{});

  return (
    <div className="shared-memory-center page-enter">
      <div className="smc-header">
        <div>
          <h1 className="smc-title">Shared Memory Fabric</h1>
          <p className="smc-subtitle">Global, company, agent, and project memory — relationships, usage frequency, and graph view.</p>
        </div>
      </div>

      {/* Scope strip */}
      <div className="smc-scope-strip">
        {[{id:"all",label:"All",color:"var(--text)"}, ...["global","company","agent","project"].map(s=>({id:s,label:s,color:SCOPE_COLORS[s]}))].map(sc => (
          <button key={sc.id}
            className={`smc-scope-tile${scope===sc.id?" smc-scope-tile--active":""}`}
            style={scope===sc.id?{borderColor:sc.color+"44",background:sc.color+"0d"}:{}}
            onClick={()=>setScope(sc.id)}
          >
            <span className="smc-scope-label" style={{ color: sc.color }}>{sc.label}</span>
            <span className="smc-scope-count">{sc.id==="all"?MEMORY_NODES.length:scopeCounts[sc.id]||0}</span>
          </button>
        ))}
      </div>

      {/* View toggle */}
      <div className="smc-view-tabs">
        {[{id:"list",label:"List view"},{id:"graph",label:"Graph view"}].map(t=>(
          <button key={t.id} className={`smc-vtab${section===t.id?" smc-vtab--active":""}`} onClick={()=>setSection(t.id)}>{t.label}</button>
        ))}
        <div className="smc-search-wrap">
          <span className="smc-search-icon">⌕</span>
          <input className="smc-search-input" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search memories…" />
          {search && <button className="smc-search-clear" onClick={()=>setSearch("")}>✕</button>}
        </div>
      </div>

      <div className="smc-content" key={section}>

        {section === "graph" && (
          <div className="smc-graph-section">
            <div className="smc-graph-wrap">
              <MemoryGraph nodes={MEMORY_NODES} onSelect={id=>{setSelected(id);}} />
            </div>
            {selNode && (
              <div className="smc-graph-detail">
                <span className="smc-gd-scope" style={{ color: SCOPE_COLORS[selNode.scope] }}>{selNode.scope}</span>
                <p className="smc-gd-title">{selNode.title}</p>
                <p className="smc-gd-body">{selNode.body}</p>
                <div className="smc-gd-meta">
                  <span>Used {selNode.accessCount}×</span>
                  <span>Last: {selNode.lastAccessed}</span>
                  <span style={{ color: IMP_COLORS[selNode.importance] }}>{selNode.importance}</span>
                </div>
                <div className="smc-gd-agents">
                  {selNode.usedBy.map(id => {
                    const a = AGENT_MAP[id];
                    return a ? <span key={id} className="smc-agent-chip" style={{ color: a.color, borderColor: a.color + "33" }}>{a.name}</span> : null;
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {section === "list" && (
          <div className="smc-list-layout">
            <div className="smc-node-list">
              {visible.length === 0 ? (
                <div className="smc-empty"><span>◎</span><p>No memories match</p></div>
              ) : visible.map(n => (
                <button key={n.id}
                  className={`smc-node-row${selected===n.id?" smc-node-row--sel":""}`}
                  onClick={()=>setSelected(n.id)}
                >
                  <div className="smc-node-left">
                    <span className="smc-scope-dot" style={{ background: SCOPE_COLORS[n.scope] }} />
                    <div className="smc-node-info">
                      <span className="smc-node-title">{n.title}</span>
                      <span className="smc-node-body">{n.body.slice(0,70)}{n.body.length>70?"…":""}</span>
                    </div>
                  </div>
                  <div className="smc-node-right">
                    <span className="smc-imp-badge" style={{ color: IMP_COLORS[n.importance], borderColor: IMP_COLORS[n.importance]+"33" }}>{n.importance}</span>
                    <span className="smc-access-count">{n.accessCount}×</span>
                    <span className="smc-last-access">{n.lastAccessed}</span>
                  </div>
                </button>
              ))}
            </div>

            {selNode && (
              <div className="smc-detail">
                <div className="smc-detail-top">
                  <span className="smc-detail-scope" style={{ color: SCOPE_COLORS[selNode.scope], borderColor: SCOPE_COLORS[selNode.scope]+"33" }}>{selNode.scope}</span>
                  <span className="smc-detail-imp" style={{ color: IMP_COLORS[selNode.importance], borderColor: IMP_COLORS[selNode.importance]+"33" }}>{selNode.importance}</span>
                </div>
                <h3 className="smc-detail-title">{selNode.title}</h3>
                <p className="smc-detail-body">{selNode.body}</p>
                <div className="smc-detail-meta">
                  <span>Category: <strong>{selNode.category}</strong></span>
                  <span>Accessed: <strong>{selNode.accessCount}×</strong></span>
                  <span>Last: <strong>{selNode.lastAccessed}</strong></span>
                </div>
                <div className="smc-detail-section">
                  <p className="smc-ds-label">Used by agents ({selNode.usedBy.length})</p>
                  <div className="smc-agents-chips">
                    {selNode.usedBy.map(id => {
                      const a = AGENT_MAP[id];
                      return a ? <span key={id} className="smc-agent-chip" style={{ color: a.color, borderColor: a.color+"33" }}>{a.name}</span> : null;
                    })}
                  </div>
                </div>
                <div className="smc-detail-section">
                  <p className="smc-ds-label">References</p>
                  <div className="smc-refs">
                    {MEMORY_NODES.filter(n => n.id !== selNode.id && n.category === selNode.category).slice(0,3).map(ref=>(
                      <button key={ref.id} className="smc-ref-chip" onClick={()=>setSelected(ref.id)}>
                        <span style={{ color: SCOPE_COLORS[ref.scope] }}>●</span> {ref.title}
                      </button>
                    ))}
                    {MEMORY_NODES.filter(n => n.id !== selNode.id && n.category === selNode.category).length === 0 && (
                      <span className="smc-no-refs">No related memories</span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
