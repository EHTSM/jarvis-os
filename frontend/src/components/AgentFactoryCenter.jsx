import React, { useState, useCallback, useEffect } from "react";
import { track } from "../analytics";
import { listManagedAgents, createManagedAgent, getAgentFactoryStats } from "../phase20Api";
import { getPlugins, getCapabilities, getCapabilityMap, getTemplates, getManifest } from "../phase26Api";
import "./AgentFactoryCenter.css";

const KEY = "ooplix_agent_factory_v1";
function _load(k, fb) { try { return JSON.parse(localStorage.getItem(k) || JSON.stringify(fb)); } catch { return fb; } }
function _save(k, v) { localStorage.setItem(k, JSON.stringify(v)); }

const TEMPLATES = [
  { id: "sales",     icon: "💰", name: "Sales Agent",     color: "#00dc82", badge: "Revenue",   desc: "Qualifies leads, follows up, closes deals autonomously." },
  { id: "marketing", icon: "📣", name: "Marketing Agent", color: "var(--warning)", badge: "Growth", desc: "Runs campaigns, A/B tests, schedules content distribution." },
  { id: "seo",       icon: "🔍", name: "SEO Agent",       color: "var(--accent2)", badge: "Traffic", desc: "Keyword research, meta generation, rank tracking." },
  { id: "support",   icon: "🎧", name: "Support Agent",   color: "#7c6fff", badge: "CX",       desc: "Handles tickets, resolves issues, escalates intelligently." },
  { id: "research",  icon: "🔬", name: "Research Agent",  color: "#00c6ff", badge: "Intel",   desc: "Crawls sources, synthesizes insights, builds briefs." },
  { id: "dev",       icon: "💻", name: "Dev Agent",       color: "#ff6464", badge: "Build",   desc: "Writes code, reviews PRs, automates CI tasks." },
  { id: "devops",    icon: "⚙️", name: "DevOps Agent",    color: "var(--warning)", badge: "Ops", desc: "Monitors infra, deploys builds, handles incidents." },
  { id: "analytics", icon: "📊", name: "Analytics Agent", color: "var(--accent)", badge: "Data", desc: "Tracks KPIs, generates reports, surfaces anomalies." },
];

const SEED_AGENTS = [
  { id: "af_01", name: "Sales Lead Qualifier", template: "sales",     status: "active",  runsToday: 23, model: "claude-sonnet-4-6", created: "2026-05-20" },
  { id: "af_02", name: "Growth Campaign Bot",  template: "marketing", status: "active",  runsToday: 11, model: "claude-sonnet-4-6", created: "2026-05-22" },
  { id: "af_03", name: "Keyword Rank Watcher", template: "seo",       status: "idle",    runsToday: 4,  model: "claude-haiku-4-5-20251001",  created: "2026-05-25" },
  { id: "af_04", name: "Tier-1 Support Bot",   template: "support",   status: "active",  runsToday: 47, model: "claude-sonnet-4-6", created: "2026-06-01" },
  { id: "af_05", name: "Competitor Intel",     template: "research",  status: "idle",    runsToday: 2,  model: "claude-opus-4-8",  created: "2026-06-02" },
  { id: "af_06", name: "PR Review Bot",        template: "dev",       status: "retired", runsToday: 0,  model: "claude-sonnet-4-6", created: "2026-05-18" },
];

export default function AgentFactoryCenter({ onNavigate }) {
  const [agents, setAgents]   = useState(() => _load(KEY, SEED_AGENTS));
  const [modal, setModal]     = useState(null);
  const [cloneSource, setClone] = useState(null);
  const [form, setForm]       = useState({ name: "", template: "sales", model: "claude-sonnet-4-6", description: "" });
  const [apiError, setApiError] = useState(null);

  // p26 live data
  const [p26Tab,       setP26Tab]       = useState("plugins");
  const [plugins,      setPlugins]      = useState([]);
  const [capabilities, setCapabilities] = useState([]);
  const [p26Templates, setP26Templates] = useState([]);
  const [manifest,     setManifest]     = useState(null);
  const [p26Loading,   setP26Loading]   = useState(true);

  useEffect(() => {
    let cancelled = false;
    listManagedAgents().then(res => {
      if (cancelled) return;
      const live = res?.agents;
      if (Array.isArray(live) && live.length > 0) {
        const mapped = live.map(a => ({
          id:       a.id, name: a.name, template: a.type || "custom",
          status:   a.status || "idle", runsToday: a.runsToday ?? 0,
          model:    a.model || "claude-sonnet-4-6",
          created:  a.createdAt ? new Date(a.createdAt).toLocaleDateString() : "—",
        }));
        setAgents(mapped); _save(KEY, mapped);
      }
    }).catch(err => { if (!cancelled) setApiError(err.message); });
    return () => { cancelled = true; };
  }, []);

  // Load p26 live data (plugins, capabilities, templates, manifest)
  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([getPlugins(), getCapabilities(), getTemplates(), getManifest()])
      .then(([plRes, capRes, tmplRes, mfRes]) => {
        if (cancelled) return;
        if (plRes.status === "fulfilled") {
          const raw = plRes.value;
          setPlugins(Array.isArray(raw) ? raw : (raw?.plugins ?? []));
        }
        if (capRes.status === "fulfilled") {
          const raw = capRes.value;
          setCapabilities(Array.isArray(raw) ? raw : (raw?.capabilities ?? []));
        }
        if (tmplRes.status === "fulfilled") {
          const raw = tmplRes.value;
          setP26Templates(Array.isArray(raw) ? raw : (raw?.templates ?? []));
        }
        if (mfRes.status === "fulfilled") setManifest(mfRes.value);
        setP26Loading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const saveAgents = useCallback(a => { setAgents(a); _save(KEY, a); }, []);

  function openCreate() { setForm({ name: "", template: "sales", model: "claude-sonnet-4-6", description: "" }); setModal("create"); }
  function openClone(agent) { setClone(agent); setForm({ name: agent.name + " (copy)", template: agent.template, model: agent.model, description: "" }); setModal("clone"); }
  function openTrain(agent) { setClone(agent); setModal("train"); }

  function handleCreate() {
    const n = { id: "af_" + Date.now(), name: form.name || "New Agent", template: form.template, status: "idle", runsToday: 0, model: form.model, created: new Date().toISOString().slice(0,10) };
    saveAgents([n, ...agents]);
    track("agent_factory_create", { template: form.template });
    createManagedAgent({ name: n.name, type: n.template, model: n.model }).catch(() => {});
    setModal(null);
  }

  function handleRetire(id) {
    saveAgents(agents.map(a => a.id === id ? { ...a, status: "retired" } : a));
    track("agent_factory_retire", { id });
  }

  const tmplOf = id => TEMPLATES.find(t => t.id === id) || TEMPLATES[0];
  const active  = agents.filter(a => a.status !== "retired").length;
  const retired = agents.filter(a => a.status === "retired").length;
  const runsToday = agents.reduce((s, a) => s + (a.runsToday || 0), 0);

  return (
    <div className="afc">
      <div className="afc-header">
        <div>
          <h1 className="afc-title">Agent Factory</h1>
          <p className="afc-subtitle">Create, clone, train and retire AI agents. Launch from templates.</p>
        </div>
        <div className="afc-actions">
          <button className="afc-btn afc-btn-ghost" onClick={() => track("afc_docs")}>Templates</button>
          <button className="afc-btn afc-btn-primary" onClick={openCreate}>+ Create Agent</button>
        </div>
      </div>

      <div className="afc-stats">
        <div className="afc-stat"><span className="afc-stat-val">{agents.length}</span><span className="afc-stat-lbl">Total</span></div>
        <div className="afc-stat"><span className="afc-stat-val" style={{color:"#00dc82"}}>{active}</span><span className="afc-stat-lbl">Active</span></div>
        <div className="afc-stat"><span className="afc-stat-val" style={{color:"var(--warning)"}}>{retired}</span><span className="afc-stat-lbl">Retired</span></div>
        <div className="afc-stat"><span className="afc-stat-val" style={{color:"var(--accent)"}}>{runsToday}</span><span className="afc-stat-lbl">Runs Today</span></div>
        <div className="afc-stat"><span className="afc-stat-val">{TEMPLATES.length}</span><span className="afc-stat-lbl">Templates</span></div>
      </div>

      <div className="afc-section-title">Agent Templates</div>
      <div className="afc-templates">
        {TEMPLATES.map(t => (
          <div key={t.id} className="afc-tmpl-card" onClick={() => { setForm({ name: t.name, template: t.id, model: "claude-sonnet-4-6", description: t.desc }); setModal("create"); }}>
            <div className="afc-tmpl-icon">{t.icon}</div>
            <div className="afc-tmpl-name">{t.name}</div>
            <div className="afc-tmpl-desc">{t.desc}</div>
            <span className="afc-tmpl-badge" style={{ background: t.color + "20", color: t.color }}>{t.badge}</span>
          </div>
        ))}
      </div>

      <div className="afc-section-title">Your Agents</div>
      <div className="afc-agents">
        {agents.map(a => {
          const tmpl = tmplOf(a.template);
          return (
            <div key={a.id} className="afc-agent-row">
              <div className="afc-agent-icon" style={{ background: tmpl.color + "20" }}>{tmpl.icon}</div>
              <div className="afc-agent-info">
                <div className="afc-agent-name">{a.name}</div>
                <div className="afc-agent-meta">{tmpl.name} · {a.model} · {a.runsToday} runs today · Created {a.created}</div>
              </div>
              <span className={`afc-agent-status afc-agent-status--${a.status}`}>{a.status}</span>
              <div className="afc-agent-btns">
                <button className="afc-agent-btn" onClick={() => openClone(a)}>Clone</button>
                <button className="afc-agent-btn" onClick={() => openTrain(a)}>Train</button>
                {a.status !== "retired" && <button className="afc-agent-btn" onClick={() => handleRetire(a.id)}>Retire</button>}
              </div>
            </div>
          );
        })}
      </div>

      {(modal === "create" || modal === "clone") && (
        <div className="afc-modal-overlay" onClick={e => e.target === e.currentTarget && setModal(null)}>
          <div className="afc-modal">
            <h2 className="afc-modal-title">{modal === "clone" ? `Clone: ${cloneSource?.name}` : "Create Agent"}</h2>
            <div className="afc-modal-form">
              <div>
                <div className="afc-modal-label">Agent Name</div>
                <input className="afc-modal-input" value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} placeholder="e.g. My Sales Bot" />
              </div>
              <div>
                <div className="afc-modal-label">Template</div>
                <select className="afc-modal-select" value={form.template} onChange={e => setForm(f => ({...f, template: e.target.value}))}>
                  {TEMPLATES.map(t => <option key={t.id} value={t.id}>{t.icon} {t.name}</option>)}
                </select>
              </div>
              <div>
                <div className="afc-modal-label">Model</div>
                <select className="afc-modal-select" value={form.model} onChange={e => setForm(f => ({...f, model: e.target.value}))}>
                  <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
                  <option value="claude-opus-4-8">Claude Opus 4.8</option>
                  <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5</option>
                </select>
              </div>
              <div>
                <div className="afc-modal-label">Description</div>
                <textarea className="afc-modal-textarea" value={form.description} onChange={e => setForm(f => ({...f, description: e.target.value}))} placeholder="What should this agent do?" />
              </div>
            </div>
            <div className="afc-modal-footer">
              <button className="afc-btn afc-btn-ghost" onClick={() => setModal(null)}>Cancel</button>
              <button className="afc-btn afc-btn-primary" onClick={handleCreate}>
                {modal === "clone" ? "Clone Agent" : "Create Agent"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── p26 Intelligence Layer ── */}
      <div className="afc-section-title" style={{ marginTop: 20 }}>Intelligence Layer</div>
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {["plugins","capabilities","templates","manifest"].map(t => (
          <button key={t} onClick={() => setP26Tab(t)} style={{
            padding: "5px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius-pill)",
            background: p26Tab === t ? "var(--accent)" : "var(--surface-raised)",
            color: p26Tab === t ? "#06080e" : "var(--text-dim)", fontSize: 11,
            fontWeight: 700, cursor: "pointer", fontFamily: "inherit", textTransform: "capitalize",
          }}>{t}</button>
        ))}
      </div>

      {p26Tab === "plugins" && (
        <div className="afc-agents">
          {p26Loading ? <div style={{ color: "var(--text-faint)", fontSize: 12, padding: 8 }}>Loading plugins…</div>
          : plugins.length === 0 ? <div style={{ color: "var(--text-faint)", fontSize: 12, padding: 8, fontStyle: "italic" }}>No plugins registered.</div>
          : plugins.map((p, i) => (
            <div key={p.id ?? i} className="afc-agent-row">
              <div className="afc-agent-icon" style={{ background: "rgba(124,111,255,0.12)" }}>⬡</div>
              <div className="afc-agent-info">
                <div className="afc-agent-name">{p.name ?? p.id}</div>
                <div className="afc-agent-meta">{p.type ?? "plugin"}{p.version ? ` · v${p.version}` : ""}{p.description ? ` · ${p.description}` : ""}</div>
              </div>
              <span className="afc-agent-status" style={{ color: p.enabled === false ? "var(--text-faint)" : "#22c55e" }}>
                {p.enabled === false ? "disabled" : "enabled"}
              </span>
            </div>
          ))}
        </div>
      )}

      {p26Tab === "capabilities" && (
        <div className="afc-agents">
          {p26Loading ? <div style={{ color: "var(--text-faint)", fontSize: 12, padding: 8 }}>Loading capabilities…</div>
          : capabilities.length === 0 ? <div style={{ color: "var(--text-faint)", fontSize: 12, padding: 8, fontStyle: "italic" }}>No capabilities registered.</div>
          : capabilities.map((c, i) => (
            <div key={c.id ?? i} className="afc-agent-row">
              <div className="afc-agent-icon" style={{ background: "rgba(0,198,255,0.1)" }}>◈</div>
              <div className="afc-agent-info">
                <div className="afc-agent-name">{c.name ?? c.id}</div>
                <div className="afc-agent-meta">{c.category ?? c.type ?? "capability"}{c.description ? ` · ${c.description}` : ""}</div>
              </div>
              {c.agentCount != null && <span style={{ fontSize: 11, color: "var(--text-dim)", marginRight: 8 }}>{c.agentCount} agents</span>}
            </div>
          ))}
        </div>
      )}

      {p26Tab === "templates" && (
        <div className="afc-agents">
          {p26Loading ? <div style={{ color: "var(--text-faint)", fontSize: 12, padding: 8 }}>Loading templates…</div>
          : p26Templates.length === 0 ? <div style={{ color: "var(--text-faint)", fontSize: 12, padding: 8, fontStyle: "italic" }}>No p26 templates registered.</div>
          : p26Templates.map((t, i) => (
            <div key={t.id ?? i} className="afc-agent-row">
              <div className="afc-agent-icon" style={{ background: "rgba(0,220,130,0.1)" }}>◇</div>
              <div className="afc-agent-info">
                <div className="afc-agent-name">{t.name ?? t.id}</div>
                <div className="afc-agent-meta">{t.type ?? "template"}{t.description ? ` · ${t.description}` : ""}</div>
              </div>
              <button className="afc-agent-btn" onClick={() => track("p26_template_use", { id: t.id })}>Use</button>
            </div>
          ))}
        </div>
      )}

      {p26Tab === "manifest" && (
        <div style={{ background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "12px 14px" }}>
          {p26Loading ? <div style={{ color: "var(--text-faint)", fontSize: 12 }}>Loading manifest…</div>
          : !manifest ? <div style={{ color: "var(--text-faint)", fontSize: 12, fontStyle: "italic" }}>No manifest available.</div>
          : Object.entries(manifest).slice(0, 20).map(([k, v]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, padding: "3px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", color: "var(--text-dim)" }}>
              <span style={{ color: "var(--text-faint)", marginRight: 12 }}>{k}</span>
              <span style={{ color: "var(--text)", fontWeight: 600 }}>{typeof v === "object" ? JSON.stringify(v).slice(0, 60) : String(v)}</span>
            </div>
          ))}
        </div>
      )}

      {modal === "train" && cloneSource && (
        <div className="afc-modal-overlay" onClick={e => e.target === e.currentTarget && setModal(null)}>
          <div className="afc-modal">
            <h2 className="afc-modal-title">Train: {cloneSource.name}</h2>
            <div className="afc-modal-form">
              <div>
                <div className="afc-modal-label">Training Examples</div>
                <textarea className="afc-modal-textarea" placeholder="Paste input/output examples, one per line…" style={{minHeight:120}} />
              </div>
              <div>
                <div className="afc-modal-label">Fine-Tune Goal</div>
                <input className="afc-modal-input" placeholder="e.g. Better at qualifying SaaS leads" />
              </div>
              <div>
                <div className="afc-modal-label">Notes</div>
                <textarea className="afc-modal-textarea" placeholder="Constraints, style guide, things to avoid…" />
              </div>
            </div>
            <div className="afc-modal-footer">
              <button className="afc-btn afc-btn-ghost" onClick={() => setModal(null)}>Cancel</button>
              <button className="afc-btn afc-btn-primary" onClick={() => { track("agent_factory_train", { id: cloneSource.id }); setModal(null); }}>
                Submit Training
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
