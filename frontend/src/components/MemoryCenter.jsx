import React, { useState, useCallback, useEffect } from "react";
import { track } from "../analytics";
import { listMemoryNodes, searchMemory, saveMemoryNode, archiveMemoryNode, memoryStats } from "../phase18Api";
import "./MemoryCenter.css";

// ── Persistence ───────────────────────────────────────────────────────
const MEM_KEY = "ooplix_memory_entries";

function _load(key, fb) {
  try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fb)); }
  catch { return fb; }
}
function _save(key, v) { localStorage.setItem(key, JSON.stringify(v)); }

// ── Memory types ──────────────────────────────────────────────────────
const MEMORY_TYPES = [
  { id: "user",     label: "User",     icon: "◎", color: "var(--accent)"  },
  { id: "company",  label: "Company",  icon: "◉", color: "var(--warning)" },
  { id: "project",  label: "Project",  icon: "◈", color: "var(--accent2)" },
  { id: "workflow", label: "Workflow", icon: "▷", color: "#52d68a"        },
  { id: "agent",    label: "Agent",    icon: "⬟", color: "var(--danger)"  },
];

const IMPORTANCE = [
  { id: "critical", label: "Critical", color: "var(--danger)"  },
  { id: "high",     label: "High",     color: "var(--warning)" },
  { id: "medium",   label: "Medium",   color: "var(--accent2)" },
  { id: "low",      label: "Low",      color: "var(--text-faint)" },
];

// ── Seed memories ─────────────────────────────────────────────────────
const SEED = [
  { id: "m1",  type: "user",     title: "Owner name",                    body: "Altamashjauhar",                                         importance: "critical", tags: ["identity"],            created: "2026-01-01", used: 42  },
  { id: "m2",  type: "company",  title: "Product name",                  body: "Ooplix — AI Operating System for business operators",    importance: "critical", tags: ["brand","product"],     created: "2026-01-01", used: 89  },
  { id: "m3",  type: "company",  title: "Pricing — Starter",             body: "₹999/month. Up to 100 leads, 1 seat, 4 follow-up tiers.",importance: "high",     tags: ["pricing","billing"],   created: "2026-02-01", used: 31  },
  { id: "m4",  type: "company",  title: "Pricing — Growth",              body: "₹2,499/month. Up to 1,000 leads, 5 seats, all features.",importance: "high",     tags: ["pricing","billing"],   created: "2026-02-01", used: 29  },
  { id: "m5",  type: "project",  title: "Phase 9 — AI OS mission",       body: "Building Knowledge, Memory, Integration, Agent OS. No backend rewrites. Local persistence only.",
                                                                                                                                           importance: "critical", tags: ["mission","phase9"],    created: "2026-06-04", used: 5   },
  { id: "m6",  type: "workflow", title: "WhatsApp follow-up sequence",   body: "Greeting (T+0) → Day 3 check-in → Day 5 value add → Day 7 close attempt → Day 14 re-engagement",
                                                                                                                                           importance: "high",     tags: ["whatsapp","followup"], created: "2026-03-01", used: 104 },
  { id: "m7",  type: "agent",    title: "SEO Agent — primary keywords",  body: "WhatsApp follow-up automation India, AI CRM freelancers, Razorpay automation, lead management India",
                                                                                                                                           importance: "high",     tags: ["seo","keywords"],      created: "2026-04-01", used: 18  },
  { id: "m8",  type: "user",     title: "Preferred tone — outreach",     body: "Direct, operator-focused, no buzzwords. Lead with pain (manual follow-up cost) then solution.",
                                                                                                                                           importance: "medium",   tags: ["tone","comms"],        created: "2026-03-15", used: 22  },
  { id: "m9",  type: "workflow", title: "Payment link flow",             body: "Generate via Razorpay API. Send in WhatsApp message after verbal agreement. Follow up if unpaid after 24h.",
                                                                                                                                           importance: "high",     tags: ["payments","razorpay"], created: "2026-04-10", used: 37  },
  { id: "m10", type: "company",  title: "Target market",                 body: "Indian SMBs: freelancers, coaches, agencies, consultants. WhatsApp-first market. Price-sensitive. Automation-ready.",
                                                                                                                                           importance: "critical", tags: ["market","icp"],        created: "2026-01-15", used: 56  },
];

function ImpBadge({ importance }) {
  const def = IMPORTANCE.find(i => i.id === importance) || IMPORTANCE[3];
  return <span className="mc-imp-badge" style={{ color: def.color, borderColor: def.color+"33" }}>{def.label}</span>;
}

function TypeBadge({ type }) {
  const def = MEMORY_TYPES.find(t => t.id === type) || MEMORY_TYPES[0];
  return <span className="mc-type-badge" style={{ color: def.color }}>{def.icon} {def.label}</span>;
}

function MemoryForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(initial || { type: "user", title: "", body: "", importance: "medium", tags: "" });
  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.title.trim() || !form.body.trim()) return;
    onSave({
      ...form,
      tags: typeof form.tags === "string" ? form.tags.split(",").map(t=>t.trim()).filter(Boolean) : form.tags,
    });
  };
  return (
    <form className="mc-form" onSubmit={handleSubmit}>
      <div className="mc-form-row">
        <div className="mc-form-field">
          <label className="mc-form-label">Type</label>
          <select className="mc-form-select" value={form.type} onChange={e=>setForm(f=>({...f,type:e.target.value}))}>
            {MEMORY_TYPES.map(t=><option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>
        <div className="mc-form-field">
          <label className="mc-form-label">Importance</label>
          <select className="mc-form-select" value={form.importance} onChange={e=>setForm(f=>({...f,importance:e.target.value}))}>
            {IMPORTANCE.map(i=><option key={i.id} value={i.id}>{i.label}</option>)}
          </select>
        </div>
      </div>
      <div className="mc-form-field">
        <label className="mc-form-label">Title</label>
        <input className="mc-form-input" value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))} placeholder="Memory title" autoFocus />
      </div>
      <div className="mc-form-field">
        <label className="mc-form-label">Body</label>
        <textarea className="mc-form-textarea" value={form.body} onChange={e=>setForm(f=>({...f,body:e.target.value}))} rows={4} placeholder="What should be remembered…" />
      </div>
      <div className="mc-form-field">
        <label className="mc-form-label">Tags (comma-separated)</label>
        <input className="mc-form-input" value={typeof form.tags === "string" ? form.tags : form.tags.join(", ")} onChange={e=>setForm(f=>({...f,tags:e.target.value}))} placeholder="product, pricing, q3" />
      </div>
      <div className="mc-form-actions">
        <button type="button" className="mc-form-cancel" onClick={onCancel}>Cancel</button>
        <button type="submit" className="mc-form-save">Save memory</button>
      </div>
    </form>
  );
}

export default function MemoryCenter({ onNavigate }) {
  const [memories,    setMemories]    = useState(() => _load(MEM_KEY, SEED));
  const [activeType,  setActiveType]  = useState("all");
  const [activeImp,   setActiveImp]   = useState("all");
  const [searchQ,     setSearchQ]     = useState("");
  const [editing,     setEditing]     = useState(null);
  const [adding,      setAdding]      = useState(false);
  const [selected,    setSelected]    = useState(null);
  const [toast,       setToast]       = useState(null);
  const [apiError,    setApiError]    = useState(null);

  useEffect(() => { track.event("memory_center_viewed"); }, []);

  // Load live memory nodes from backend; fall back to localStorage seed on error
  useEffect(() => {
    let cancelled = false;
    listMemoryNodes({ limit: 100 })
      .then(res => {
        if (cancelled) return;
        const nodes = res?.nodes || res?.memories;
        if (Array.isArray(nodes) && nodes.length > 0) {
          const mapped = nodes.map(n => ({
            id:         n.id,
            type:       n.type || "user",
            title:      n.title || n.key || "Memory",
            body:       n.body || n.value || "",
            importance: n.importance || n.priority || "medium",
            tags:       Array.isArray(n.tags) ? n.tags : [],
            created:    n.createdAt ? new Date(n.createdAt).toISOString().slice(0,10) : "",
            used:       n.accessCount ?? 0,
          }));
          setMemories(mapped);
          _save(MEM_KEY, mapped);
        }
      })
      .catch(err => { if (!cancelled) setApiError(err.message); });
    return () => { cancelled = true; };
  }, []);

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(null), 2400); };

  const persist = useCallback((next) => { _save(MEM_KEY, next); setMemories(next); }, []);

  const handleAdd = useCallback((data) => {
    const entry = { ...data, id: `m${Date.now()}`, created: new Date().toISOString().slice(0,10), used: 0 };
    persist([entry, ...memories]);
    setAdding(false); showToast("Memory saved");
    track.event("memory_added", { type: data.type });
    saveMemoryNode(data).catch(() => {/* local save already done */});
  }, [memories, persist]);

  const handleEdit = useCallback((data) => {
    persist(memories.map(m => m.id === data.id ? { ...m, ...data } : m));
    setEditing(null); showToast("Memory updated");
  }, [memories, persist]);

  const handleDelete = useCallback((id) => {
    persist(memories.filter(m => m.id !== id));
    if (selected === id) setSelected(null);
    showToast("Deleted");
    archiveMemoryNode(id).catch(() => {});
  }, [memories, persist, selected]);

  const visible = memories.filter(m => {
    const matchType = activeType === "all" || m.type === activeType;
    const matchImp  = activeImp  === "all" || m.importance === activeImp;
    const matchQ    = !searchQ || m.title.toLowerCase().includes(searchQ.toLowerCase()) || m.body.toLowerCase().includes(searchQ.toLowerCase()) || m.tags.join(" ").includes(searchQ.toLowerCase());
    return matchType && matchImp && matchQ;
  });

  const sel = selected ? memories.find(m => m.id === selected) : null;

  return (
    <div className="memory-center page-enter">
      {toast && <div className="mc-toast">{toast}</div>}
      {apiError && <div className="ac-api-banner ac-api-banner--error">⚠ Live memory unavailable — showing cached data ({apiError})</div>}

      <div className="mc-header">
        <div>
          <h1 className="mc-title">Memory OS</h1>
          <p className="mc-subtitle">Persistent intelligence — what the system remembers about your business, users, and workflows.</p>
        </div>
        <button className="mc-add-btn" onClick={() => setAdding(true)}>+ Add memory</button>
      </div>

      {/* Type summary bar */}
      <div className="mc-type-strip">
        {MEMORY_TYPES.map(t => {
          const cnt = memories.filter(m => m.type === t.id).length;
          return (
            <button
              key={t.id}
              className={`mc-type-tile${activeType === t.id ? " mc-type-tile--active" : ""}`}
              style={activeType === t.id ? { borderColor: t.color+"44", background: t.color+"0d" } : {}}
              onClick={() => setActiveType(prev => prev === t.id ? "all" : t.id)}
            >
              <span className="mc-type-icon" style={{ color: t.color }}>{t.icon}</span>
              <span className="mc-type-label">{t.label}</span>
              <span className="mc-type-count" style={{ color: t.color }}>{cnt}</span>
            </button>
          );
        })}
      </div>

      {/* Search + importance filter */}
      <div className="mc-controls">
        <div className="mc-search-wrap">
          <span className="mc-search-icon">⌕</span>
          <input className="mc-search-input" value={searchQ} onChange={e=>setSearchQ(e.target.value)} placeholder="Search memories…" />
          {searchQ && <button className="mc-search-clear" onClick={() => setSearchQ("")}>✕</button>}
        </div>
        <div className="mc-imp-chips">
          <button className={`mc-imp-chip${activeImp==="all"?" mc-imp-chip--active":""}`} onClick={()=>setActiveImp("all")}>All</button>
          {IMPORTANCE.map(i => (
            <button key={i.id}
              className={`mc-imp-chip${activeImp===i.id?" mc-imp-chip--active":""}`}
              style={activeImp===i.id?{color:i.color,borderColor:i.color+"44"}:{}}
              onClick={()=>setActiveImp(prev=>prev===i.id?"all":i.id)}
            >{i.label}</button>
          ))}
        </div>
      </div>

      {/* Add form */}
      {adding && (
        <div className="mc-form-card">
          <h3 className="mc-form-heading">New memory</h3>
          <MemoryForm onSave={handleAdd} onCancel={() => setAdding(false)} />
        </div>
      )}

      {/* Edit form */}
      {editing && (
        <div className="mc-modal-overlay" onClick={() => setEditing(null)}>
          <div className="mc-modal" onClick={e=>e.stopPropagation()}>
            <h3 className="mc-form-heading">Edit memory</h3>
            <MemoryForm
              initial={{ ...editing, tags: editing.tags.join(", ") }}
              onSave={handleEdit}
              onCancel={() => setEditing(null)}
            />
          </div>
        </div>
      )}

      <div className="mc-layout">
        {/* List */}
        <div className="mc-list">
          {visible.length === 0 ? (
            <div className="mc-empty">
              <span className="mc-empty-icon">◎</span>
              <p className="mc-empty-title">No memories match</p>
              <button className="mc-empty-cta" onClick={() => setAdding(true)}>Add memory →</button>
            </div>
          ) : (
            visible.map(m => (
              <button
                key={m.id}
                className={`mc-entry${selected === m.id ? " mc-entry--selected" : ""}`}
                onClick={() => setSelected(prev => prev === m.id ? null : m.id)}
              >
                <div className="mc-entry-top">
                  <TypeBadge type={m.type} />
                  <ImpBadge importance={m.importance} />
                  <span className="mc-entry-used">{m.used}× used</span>
                </div>
                <span className="mc-entry-title">{m.title}</span>
                <p className="mc-entry-body">{m.body.slice(0, 90)}{m.body.length > 90 ? "…" : ""}</p>
                <div className="mc-entry-tags">
                  {m.tags.slice(0,4).map(t => <span key={t} className="mc-tag">{t}</span>)}
                </div>
              </button>
            ))
          )}
        </div>

        {/* Detail panel */}
        {sel && (
          <div className="mc-detail">
            <div className="mc-detail-actions">
              <button className="mc-detail-edit" onClick={() => setEditing(sel)}>Edit</button>
              <button className="mc-detail-del"  onClick={() => handleDelete(sel.id)}>Delete</button>
            </div>
            <div className="mc-detail-header">
              <TypeBadge type={sel.type} />
              <ImpBadge importance={sel.importance} />
            </div>
            <h3 className="mc-detail-title">{sel.title}</h3>
            <p className="mc-detail-body">{sel.body}</p>
            <div className="mc-detail-meta">
              <span>Created: {sel.created}</span>
              <span>Used: {sel.used}×</span>
            </div>
            <div className="mc-detail-tags">
              {sel.tags.map(t => <span key={t} className="mc-tag">{t}</span>)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
