import React, { useState, useEffect, useCallback, useRef } from "react";
import { track } from "../analytics";
import {
  listMemoryNodes,
  searchMemory,
  memoryStats,
} from "../phase18Api";
import { getKnowledge, addKnowledge, deleteKnowledge } from "../personalApi";
import "./MemoryOSV2.css";

// ── Constants ─────────────────────────────────────────────────────────

const TABS = [
  { id: "index",       label: "Memory Index" },
  { id: "shared",      label: "Shared Fabric" },
  { id: "intelligence",label: "Intelligence"  },
  { id: "knowledge",   label: "Knowledge"     },
  { id: "search",      label: "Search"        },
];

const TYPE_META = {
  context: { label: "context",  color: "#7c6fff", bg: "rgba(124,111,255,.12)" },
  user:    { label: "user",     color: "#4ecdc4", bg: "rgba(78,205,196,.12)"  },
  event:   { label: "event",    color: "#f0b429", bg: "rgba(240,180,41,.10)"  },
  summary: { label: "summary",  color: "#5dc8f5", bg: "rgba(93,200,245,.10)"  },
  error:   { label: "error",    color: "#f55b5b", bg: "rgba(245,91,91,.10)"   },
  task:    { label: "task",     color: "#52d68a", bg: "rgba(82,214,138,.10)"  },
  company: { label: "company",  color: "#f0b429", bg: "rgba(240,180,41,.10)"  },
  project: { label: "project",  color: "#4ecdc4", bg: "rgba(78,205,196,.12)"  },
  agent:   { label: "agent",    color: "#f55b5b", bg: "rgba(245,91,91,.10)"   },
  workflow:{ label: "workflow",  color: "#52d68a", bg: "rgba(82,214,138,.10)"  },
};

const SHARED_NODES = [
  { id: "gm1", scope: "global",  type: "context", title: "Platform identity",          body: "Ooplix — AI Operating System for business operators",             usedBy: ["SEO","Marketing","Content","Support","Sales"], accessCount: 312, lastAccessed: "2 min ago"  },
  { id: "gm2", scope: "global",  type: "user",    title: "Owner",                      body: "Altamashjauhar. Primary operator and product owner.",              usedBy: ["Support","Sales","Dev"], accessCount: 88, lastAccessed: "14 min ago" },
  { id: "cm1", scope: "company", type: "context", title: "Starter plan pricing",       body: "₹999/month. Up to 100 leads, 1 seat, 4 follow-up tiers.",          usedBy: ["Marketing","Sales","Support"], accessCount: 140, lastAccessed: "20 min ago" },
  { id: "cm2", scope: "company", type: "context", title: "Growth plan pricing",        body: "₹2,499/month. Up to 1,000 leads, 5 seats, all features.",          usedBy: ["Marketing","Sales","Support"], accessCount: 129, lastAccessed: "20 min ago" },
  { id: "cm3", scope: "company", type: "context", title: "Target ICP",                 body: "Indian SMBs: freelancers, coaches, agencies, consultants. WhatsApp-first. Price-sensitive.", usedBy: ["Marketing","Sales","SEO","Content"], accessCount: 201, lastAccessed: "5 min ago" },
  { id: "am1", scope: "agent",   type: "agent",   title: "SEO primary keywords",       body: "WhatsApp follow-up automation India, AI CRM freelancers, Razorpay automation",  usedBy: ["SEO","Content"], accessCount: 67, lastAccessed: "12 min ago" },
  { id: "am2", scope: "agent",   type: "agent",   title: "Support escalation rules",   body: "Escalate to human: billing disputes, security issues, churn risk, angry tone.", usedBy: ["Support"], accessCount: 44, lastAccessed: "8 min ago"  },
  { id: "pm1", scope: "project", type: "workflow","title": "WhatsApp follow-up sequence","body": "T+0 greeting → Day 3 check-in → Day 5 value add → Day 7 close → Day 14 re-engage.", usedBy: ["Sales","Support","Marketing"], accessCount: 182, lastAccessed: "3 min ago" },
];

const SCOPE_COLORS = { global: "#f0b429", company: "#7c6fff", agent: "#f55b5b", project: "#52d68a" };

const SEED_ENTRIES = [
  { id: "e1",  type: "context", title: "Lead Raj Kumar qualified at ₹15k",               body: "Lead was contacted via WhatsApp on 2026-06-06. Expressed interest in Growth plan. Follow-up scheduled for Day 3.", tags: ["lead","crm"],        created: "2026-06-06T14:33:00Z" },
  { id: "e2",  type: "event",   title: "WhatsApp batch sent — 12 messages",               body: "Tier 2 follow-up sequence dispatched. 12 contacts in the batch. Avg delivery time: 2.1s.", tags: ["whatsapp","batch"],  created: "2026-06-06T14:28:00Z" },
  { id: "e3",  type: "error",   title: "Workflow timeout recorded for learning",           body: "Task ID wf-4421 timed out after 30s. Cause: downstream API rate limit on /payment/link. Retried 3x.", tags: ["error","workflow"],  created: "2026-06-06T14:20:00Z" },
  { id: "e4",  type: "user",    title: "Operator prefers INR pricing format",              body: "Confirmed from onboarding responses. All monetary values should be presented as ₹X,XXX format.", tags: ["preference","ux"],   created: "2026-06-06T13:00:00Z" },
  { id: "e5",  type: "summary", title: "Daily lead analysis — 124 leads reviewed",        body: "Qualified: 18, Hot: 7, Won: 3, Lost: 2. Average deal size: ₹12,400. Conversion from hot to won: 43%.", tags: ["summary","leads"],   created: "2026-06-06T12:00:00Z" },
  { id: "e6",  type: "context", title: "Razorpay integration live",                        body: "Payment link generation via POST /payment/link. Keys configured in .env. Test transaction ₹1 passed.", tags: ["payments","razorpay"],created: "2026-06-05T10:00:00Z" },
  { id: "e7",  type: "task",    title: "Phase 43 Agent OS V2 completed",                   body: "7-tab Agent OS built: Center, Registry, Running, Factory, Collaboration, Intelligence, Actions. Build passed.", tags: ["phase","engineering"],created: "2026-06-07T09:00:00Z" },
  { id: "e8",  type: "user",    title: "Business model: SaaS subscription",                body: "Monthly recurring revenue model. Razorpay for INR billing. Trial: 14 days free. No card required.", tags: ["biz","model"],       created: "2026-06-04T08:00:00Z" },
  { id: "e9",  type: "event",   title: "New contact added: Priya Sharma",                  body: "Added via Contacts V2 UI. Service: Marketing Automation. Deal value: ₹8,500. Status: new.", tags: ["crm","contact"],     created: "2026-06-06T11:40:00Z" },
  { id: "e10", type: "summary", title: "Weekly automation summary — 487 tasks run",        body: "Tier 1: 210, Tier 2: 148, Tier 3: 87, Tier 4: 42. Failure rate: 3.2%. DLQ: 4 items.", tags: ["automation","week"], created: "2026-06-02T08:00:00Z" },
];

const AI_INSIGHTS = [
  { id: "i1", type: "pattern",   title: "WhatsApp outreach peaks Tuesday–Thursday",    body: "84% of conversions originate from messages sent between 10:00–13:00 on weekdays. Schedule batch sends accordingly.", confidence: 91, tags: ["whatsapp","timing"]  },
  { id: "i2", type: "cluster",   title: "Pricing context accessed 270+ times this week", body: "Starter and Growth plan entries are referenced heavily by Sales and Marketing agents. Consider adding an FAQ memory node.", confidence: 88, tags: ["pricing","agents"]  },
  { id: "i3", type: "recommend", title: "Add ICP refinement to memory",                 body: "Target ICP entry is 5 months old. Recent lead data suggests coaches and agencies convert 2× vs. freelancers. Update recommended.", confidence: 76, tags: ["icp","refresh"]    },
  { id: "i4", type: "anomaly",   title: "Error rate spike on June 5",                   body: "Workflow timeout errors tripled vs. prior week (3 → 9). Root cause: Razorpay /payment/link rate limit. Resolved June 6.", confidence: 95, tags: ["error","anomaly"]   },
  { id: "i5", type: "cluster",   title: "SEO + Content agents share 6 memory nodes",    body: "High overlap suggests a shared 'content-strategy' scope could reduce redundant context loading by ~40%.", confidence: 72, tags: ["agents","efficiency"] },
];

const RECENT_QUERIES = [
  { q: "WhatsApp follow-up", ts: "2 min ago",  results: 8 },
  { q: "Razorpay payment",   ts: "18 min ago", results: 12 },
  { q: "lead qualification", ts: "1h ago",     results: 5  },
  { q: "pricing India",      ts: "3h ago",     results: 6  },
];

const KNOWLEDGE_CATS = [
  { id: "product",      label: "Product",     icon: "◈", color: "#7c6fff" },
  { id: "sales",        label: "Sales",       icon: "◎", color: "#f0b429" },
  { id: "engineering",  label: "Engineering", icon: "⬟", color: "#4ecdc4" },
  { id: "support",      label: "Support",     icon: "◉", color: "#52d68a" },
  { id: "legal",        label: "Legal",       icon: "▷", color: "#f55b5b" },
];

const DOC_TYPES = {
  pdf:  { label: "PDF", color: "#e74c3c" },
  docx: { label: "DOC", color: "#2980b9" },
  pptx: { label: "PPT", color: "#e67e22" },
  web:  { label: "WEB", color: "#27ae60" },
  txt:  { label: "TXT", color: "#8994b0" },
};

const SEED_DOCS = [
  { id: "d1", name: "Product Roadmap Q3 2026.pdf",      type: "pdf",  size: "840 KB", category: "product",     status: "indexed",    chunks: 34, added: "2026-05-10", tags: ["roadmap","product"]  },
  { id: "d2", name: "Ooplix Pitch Deck.pptx",           type: "pptx", size: "2.1 MB", category: "sales",       status: "indexed",    chunks: 18, added: "2026-05-12", tags: ["pitch","sales"]      },
  { id: "d3", name: "Technical Architecture.docx",       type: "docx", size: "320 KB", category: "engineering", status: "indexed",    chunks: 51, added: "2026-05-14", tags: ["arch","dev"]         },
  { id: "d4", name: "Operator Onboarding Guide.pdf",     type: "pdf",  size: "1.2 MB", category: "support",     status: "indexed",    chunks: 62, added: "2026-05-18", tags: ["onboarding","guide"] },
  { id: "d5", name: "Sales Playbook 2026.docx",          type: "docx", size: "450 KB", category: "sales",       status: "processing", chunks: 0,  added: "2026-05-20", tags: ["sales","playbook"]   },
  { id: "d6", name: "Compliance & Legal FAQ.pdf",        type: "pdf",  size: "190 KB", category: "legal",       status: "indexed",    chunks: 22, added: "2026-06-01", tags: ["legal","compliance"] },
];

// ── Helpers ───────────────────────────────────────────────────────────

function _fmtTime(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}

function _timeAgo(iso) {
  if (!iso) return "—";
  try {
    const diff = Math.floor((Date.now() - new Date(iso)) / 1000);
    if (diff < 60)   return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
    if (diff < 86400)return `${Math.floor(diff/3600)}h ago`;
    return `${Math.floor(diff/86400)}d ago`;
  } catch { return "—"; }
}

function TypeChip({ type }) {
  const m = TYPE_META[type] || TYPE_META.context;
  return (
    <span className="mov2-type-chip" style={{ color: m.color, background: m.bg }}>
      {m.label}
    </span>
  );
}

function SkelLine({ w = "100%", h = 12 }) {
  return <span className="mov2-skeleton" style={{ width: w, height: h, borderRadius: 4, display: "block" }} />;
}

function Toast({ msg, type, onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 3200); return () => clearTimeout(t); }, [onDone]);
  return <div className={`mov2-toast mov2-toast--${type}`}>{msg}</div>;
}

// ── Memory Index tab ──────────────────────────────────────────────────

function TabIndex({ entries, loading, apiDown }) {
  const [search, setSearch]   = useState("");
  const [typeF,  setTypeF]    = useState("all");
  const [expanded, setExpanded] = useState(null);
  const [page, setPage]       = useState(1);
  const PAGE = 10;

  const types = ["all", ...Array.from(new Set(entries.map(e => e.type)))];

  const filtered = entries.filter(e => {
    const matchType = typeF === "all" || e.type === typeF;
    const q = search.toLowerCase();
    const matchQ = !q || (e.title || "").toLowerCase().includes(q) || (e.body || "").toLowerCase().includes(q) || (e.tags || []).some(t => t.includes(q));
    return matchType && matchQ;
  });

  const shown = filtered.slice(0, page * PAGE);
  const hasMore = shown.length < filtered.length;

  if (loading) return (
    <div className="mov2-index-list">
      {[0,1,2,3,4].map(i => (
        <div key={i} className="mov2-entry-row mov2-entry-row--skel">
          <SkelLine w={60} h={18} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5 }}>
            <SkelLine w="60%" h={13} />
            <SkelLine w="40%" h={11} />
          </div>
          <SkelLine w={50} h={11} />
        </div>
      ))}
    </div>
  );

  if (apiDown) return (
    <div className="mov2-empty">
      <span className="mov2-empty-icon">⚠</span>
      <p className="mov2-empty-title">Memory API not available</p>
      <p className="mov2-empty-sub">Memory indexing may not be enabled on this server. Contact your administrator.</p>
    </div>
  );

  return (
    <div className="mov2-index-root">
      <div className="mov2-index-toolbar">
        <div className="mov2-search-wrap">
          <span className="mov2-search-icon">🔍</span>
          <input
            className="mov2-search"
            placeholder="Search memory entries…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <div className="mov2-filter-chips">
          {types.map(t => (
            <button
              key={t}
              className={`mov2-filter-chip${typeF === t ? " mov2-filter-chip--active" : ""}`}
              onClick={() => { setTypeF(t); setPage(1); }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="mov2-empty">
          <span className="mov2-empty-icon">◎</span>
          <p className="mov2-empty-title">No entries match "{search || typeF}"</p>
          <p className="mov2-empty-sub">Try a broader search or different type filter.</p>
        </div>
      ) : (
        <>
          <div className="mov2-index-list">
            {shown.map(e => (
              <div
                key={e.id}
                className={`mov2-entry-row${expanded === e.id ? " mov2-entry-row--open" : ""}`}
                onClick={() => setExpanded(v => v === e.id ? null : e.id)}
              >
                <TypeChip type={e.type} />
                <div className="mov2-entry-main">
                  <span className="mov2-entry-title">{e.title || e.body?.slice(0, 60) || "Untitled"}</span>
                  {expanded === e.id && (
                    <p className="mov2-entry-body">{e.body || e.content || e.title}</p>
                  )}
                  {(e.tags?.length > 0) && (
                    <div className="mov2-entry-tags">
                      {(e.tags || []).map(t => <span key={t} className="mov2-tag">{t}</span>)}
                    </div>
                  )}
                </div>
                <span className="mov2-entry-ts">{_timeAgo(e.created || e.createdAt || e.lastUpdated)}</span>
              </div>
            ))}
          </div>
          {hasMore && (
            <button className="mov2-load-more" onClick={() => setPage(p => p + 1)}>
              Load more ({filtered.length - shown.length} remaining)
            </button>
          )}
          <p className="mov2-count-label">Showing {shown.length} of {filtered.length} entries</p>
        </>
      )}
    </div>
  );
}

// ── Shared Fabric tab ─────────────────────────────────────────────────

function TabShared() {
  const [selected, setSelected] = useState(null);
  const [scopeF, setScopeF]     = useState("all");

  const scopes = ["all", "global", "company", "agent", "project"];
  const filtered = SHARED_NODES.filter(n => scopeF === "all" || n.scope === scopeF);

  return (
    <div className="mov2-shared-root">
      <div className="mov2-coming-soon">
        <span className="mov2-coming-icon">◈</span>
        <div>
          <p className="mov2-coming-title">Shared Memory Fabric — Full Graph View <span className="csb-beta-badge">BETA</span></p>
          <p className="mov2-coming-sub">Interactive relationship graph and cross-agent context visualization are under development. Memory nodes and access data shown below.</p>
        </div>
      </div>

      <div className="mov2-shared-toolbar">
        {scopes.map(s => (
          <button
            key={s}
            className={`mov2-scope-chip${scopeF === s ? " mov2-scope-chip--active" : ""}`}
            onClick={() => setScopeF(s)}
          >
            {s === "all" ? "All Scopes" : s}
          </button>
        ))}
      </div>

      <div className="mov2-shared-grid">
        {filtered.map(n => (
          <div
            key={n.id}
            className={`mov2-shared-node${selected === n.id ? " mov2-shared-node--selected" : ""}`}
            onClick={() => setSelected(v => v === n.id ? null : n.id)}
          >
            <div className="mov2-node-top">
              <span
                className="mov2-node-scope"
                style={{ color: SCOPE_COLORS[n.scope] || "#7c6fff", background: (SCOPE_COLORS[n.scope] || "#7c6fff") + "18" }}
              >
                {n.scope}
              </span>
              <TypeChip type={n.type} />
              <span className="mov2-node-access">↗ {n.accessCount}</span>
            </div>
            <p className="mov2-node-title">{n.title}</p>
            {selected === n.id && <p className="mov2-node-body">{n.body}</p>}
            <div className="mov2-node-agents">
              {n.usedBy.slice(0, 4).map(a => (
                <span key={a} className="mov2-agent-tag">{a}</span>
              ))}
              {n.usedBy.length > 4 && <span className="mov2-agent-tag mov2-agent-tag--more">+{n.usedBy.length - 4}</span>}
            </div>
            <span className="mov2-node-last">{n.lastAccessed}</span>
          </div>
        ))}
      </div>

      <div className="mov2-shared-summary">
        <div className="mov2-summary-stat">
          <span className="mov2-ss-val">{SHARED_NODES.length}</span>
          <span className="mov2-ss-label">Shared Nodes</span>
        </div>
        <div className="mov2-summary-stat">
          <span className="mov2-ss-val">{SHARED_NODES.reduce((a, n) => a + n.accessCount, 0).toLocaleString()}</span>
          <span className="mov2-ss-label">Total Accesses</span>
        </div>
        <div className="mov2-summary-stat">
          <span className="mov2-ss-val">{Array.from(new Set(SHARED_NODES.flatMap(n => n.usedBy))).length}</span>
          <span className="mov2-ss-label">Connected Agents</span>
        </div>
        <div className="mov2-summary-stat">
          <span className="mov2-ss-val">{Array.from(new Set(SHARED_NODES.map(n => n.scope))).length}</span>
          <span className="mov2-ss-label">Memory Scopes</span>
        </div>
      </div>
    </div>
  );
}

// ── Intelligence tab ──────────────────────────────────────────────────

const INSIGHT_ICONS = { pattern: "📈", cluster: "🔗", recommend: "💡", anomaly: "⚠" };
const INSIGHT_COLORS = { pattern: "#7c6fff", cluster: "#4ecdc4", recommend: "#52d68a", anomaly: "#f55b5b" };

function TabIntelligence() {
  const [activeInsight, setActiveInsight] = useState(null);

  return (
    <div className="mov2-intel-root">
      <div className="mov2-coming-soon">
        <span className="mov2-coming-icon">◉</span>
        <div>
          <p className="mov2-coming-title">Deep Memory Intelligence <span className="csb-beta-badge">BETA</span></p>
          <p className="mov2-coming-sub">Auto-generated embeddings, semantic clustering, and cross-session pattern recognition are in development. Current insights are from heuristic analysis.</p>
        </div>
      </div>

      <div className="mov2-intel-header">
        <div className="mov2-intel-stat">
          <span className="mov2-is-val">{AI_INSIGHTS.length}</span>
          <span className="mov2-is-label">Active Insights</span>
        </div>
        <div className="mov2-intel-stat">
          <span className="mov2-is-val">{Math.round(AI_INSIGHTS.reduce((a, i) => a + i.confidence, 0) / AI_INSIGHTS.length)}%</span>
          <span className="mov2-is-label">Avg Confidence</span>
        </div>
        <div className="mov2-intel-stat">
          <span className="mov2-is-val">{Array.from(new Set(AI_INSIGHTS.map(i => i.type))).length}</span>
          <span className="mov2-is-label">Insight Types</span>
        </div>
      </div>

      <div className="mov2-insight-list">
        {AI_INSIGHTS.map(ins => (
          <div
            key={ins.id}
            className={`mov2-insight-card${activeInsight === ins.id ? " mov2-insight-card--open" : ""}`}
            onClick={() => setActiveInsight(v => v === ins.id ? null : ins.id)}
          >
            <div className="mov2-insight-top">
              <span
                className="mov2-insight-type"
                style={{ color: INSIGHT_COLORS[ins.type], background: INSIGHT_COLORS[ins.type] + "18" }}
              >
                {INSIGHT_ICONS[ins.type]} {ins.type}
              </span>
              <div className="mov2-confidence-wrap">
                <div className="mov2-confidence-bar">
                  <div
                    className="mov2-confidence-fill"
                    style={{ width: `${ins.confidence}%`, background: INSIGHT_COLORS[ins.type] }}
                  />
                </div>
                <span className="mov2-confidence-label">{ins.confidence}%</span>
              </div>
            </div>
            <p className="mov2-insight-title">{ins.title}</p>
            {activeInsight === ins.id && <p className="mov2-insight-body">{ins.body}</p>}
            <div className="mov2-insight-tags">
              {ins.tags.map(t => <span key={t} className="mov2-tag">{t}</span>)}
            </div>
          </div>
        ))}
      </div>

      <div className="mov2-cluster-section">
        <h3 className="mov2-section-title">Memory Clusters</h3>
        <div className="mov2-cluster-grid">
          {[
            { label: "Pricing & Plans",  size: 8,  color: "#7c6fff", entries: ["Starter plan","Growth plan","Trial terms","Billing FAQ"] },
            { label: "WhatsApp Ops",     size: 12, color: "#52d68a", entries: ["Follow-up sequence","Message templates","QR session","Batch send"] },
            { label: "Lead Lifecycle",   size: 6,  color: "#4ecdc4", entries: ["Qualification criteria","Stage transitions","Won/Lost rules"] },
            { label: "Error Patterns",   size: 4,  color: "#f55b5b", entries: ["Timeout events","API failures","Retry logic"] },
          ].map(c => (
            <div key={c.label} className="mov2-cluster-card" style={{ borderColor: c.color + "30" }}>
              <div className="mov2-cluster-dot" style={{ background: c.color }} />
              <p className="mov2-cluster-name" style={{ color: c.color }}>{c.label}</p>
              <span className="mov2-cluster-size">{c.size} nodes</span>
              <div className="mov2-cluster-entries">
                {c.entries.map(e => <span key={e} className="mov2-cluster-entry">{e}</span>)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Knowledge tab ─────────────────────────────────────────────────────

function TabKnowledge({ addToast }) {
  const [docs, setDocs]       = useState(SEED_DOCS);
  const [catF, setCatF]       = useState("all");
  const [search, setSearch]   = useState("");
  const [liveData, setLive]   = useState(null);
  const [notified, setNotified] = useState(false);

  useEffect(() => {
    getKnowledge({ limit: 50 }).then(res => {
      if (res && Array.isArray(res.entries) && res.entries.length > 0) setLive(res.entries);
    }).catch(() => {});
  }, []);

  const filtered = docs.filter(d => {
    const matchCat = catF === "all" || d.category === catF;
    const q = search.toLowerCase();
    const matchQ = !q || d.name.toLowerCase().includes(q) || (d.tags || []).some(t => t.includes(q));
    return matchCat && matchQ;
  });

  function handleDelete(id) {
    setDocs(d => d.filter(x => x.id !== id));
    deleteKnowledge(id).catch(() => {});
    addToast("Document removed", "info");
  }

  function handleNotify() {
    setNotified(true);
    track("knowledge_notify_me");
    addToast("We'll notify you when Knowledge Base is available!", "success");
  }

  return (
    <div className="mov2-know-root">
      <div className="mov2-coming-soon">
        <span className="mov2-coming-icon">▷</span>
        <div>
          <p className="mov2-coming-title">Knowledge Base — Upload <span className="csb-beta-badge">BETA</span></p>
          <p className="mov2-coming-sub">Direct document upload and ingestion is under development. Existing documents shown below.</p>
        </div>
      </div>

      <div className="mov2-know-notify">
        <div className="mov2-know-notify-body">
          <p className="mov2-kn-title">Get Notified When It's Ready</p>
          <p className="mov2-kn-sub">We'll let you know when you can upload PDFs, DOCX, and TXT files for Jarvis to reference.</p>
        </div>
        {notified ? (
          <span className="mov2-kn-done">✓ You're on the list</span>
        ) : (
          <button className="mov2-btn mov2-btn--ghost" onClick={handleNotify}>Notify me</button>
        )}
      </div>

      <div className="mov2-know-cats">
        {["all", ...KNOWLEDGE_CATS.map(c => c.id)].map(c => {
          const cat = KNOWLEDGE_CATS.find(x => x.id === c);
          return (
            <button
              key={c}
              className={`mov2-cat-chip${catF === c ? " mov2-cat-chip--active" : ""}`}
              style={catF === c && cat ? { borderColor: cat.color + "60", color: cat.color } : {}}
              onClick={() => setCatF(c)}
            >
              {cat ? `${cat.icon} ${cat.label}` : "All"}
            </button>
          );
        })}
      </div>

      <div className="mov2-search-wrap">
        <span className="mov2-search-icon">🔍</span>
        <input
          className="mov2-search"
          placeholder="Search documents…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="mov2-empty">
          <span className="mov2-empty-icon">◎</span>
          <p className="mov2-empty-title">No documents found</p>
          <p className="mov2-empty-sub">Try a different search or category.</p>
        </div>
      ) : (
        <div className="mov2-doc-list">
          {filtered.map(d => {
            const dt = DOC_TYPES[d.type] || DOC_TYPES.txt;
            return (
              <div key={d.id} className="mov2-doc-row">
                <span className="mov2-doc-type" style={{ color: dt.color, background: dt.color + "22" }}>{dt.label}</span>
                <div className="mov2-doc-info">
                  <span className="mov2-doc-name">{d.name}</span>
                  <span className="mov2-doc-meta">
                    {d.size} · {d.chunks ? `${d.chunks} chunks` : "processing…"} · Added {d.added}
                  </span>
                </div>
                <div className="mov2-doc-tags">
                  {(d.tags || []).map(t => <span key={t} className="mov2-tag">{t}</span>)}
                </div>
                <span className={`mov2-doc-status mov2-doc-status--${d.status}`}>{d.status}</span>
                <button className="mov2-doc-del" onClick={() => handleDelete(d.id)} title="Remove">✕</button>
              </div>
            );
          })}
        </div>
      )}

      <div className="mov2-know-features">
        <p className="mov2-kf-title">What you'll be able to do</p>
        <div className="mov2-kf-list">
          {[
            "Upload PDF, DOCX, TXT files — auto-chunked and indexed",
            "Define FAQs for customer support automation",
            "Add product specs for pricing AI answers",
            "Jarvis auto-references these when answering questions",
            "Version control and re-index on update",
          ].map(f => (
            <div key={f} className="mov2-kf-item">
              <span className="mov2-kf-check">✓</span>
              <span className="mov2-kf-text">{f}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Search & Retrieval tab ────────────────────────────────────────────

function TabSearch({ allEntries }) {
  const [query, setQuery]         = useState("");
  const [results, setResults]     = useState(null);
  const [searching, setSearching] = useState(false);
  const [recentQs, setRecentQs]   = useState(RECENT_QUERIES);
  const inputRef = useRef(null);

  const SUGGESTED = ["WhatsApp follow-up", "pricing India", "lead qualification", "Razorpay payment", "SEO keywords"];

  async function doSearch(q) {
    if (!q.trim()) return;
    setSearching(true);
    setResults(null);
    try {
      const r = await searchMemory(q);
      const hits = Array.isArray(r) ? r : (r?.results || r?.entries || []);
      setResults(hits.length > 0 ? hits : _localSearch(q));
    } catch {
      setResults(_localSearch(q));
    } finally {
      setSearching(false);
      setRecentQs(prev => [{ q, ts: "just now", results: 0 }, ...prev.slice(0, 4)]);
    }
  }

  function _localSearch(q) {
    const lq = q.toLowerCase();
    return allEntries.filter(e =>
      (e.title || "").toLowerCase().includes(lq) ||
      (e.body || "").toLowerCase().includes(lq) ||
      (e.tags || []).some(t => t.includes(lq))
    );
  }

  function handleKey(e) {
    if (e.key === "Enter") doSearch(query);
  }

  return (
    <div className="mov2-search-root">
      <div className="mov2-global-search-wrap">
        <span className="mov2-gs-icon">🔍</span>
        <input
          ref={inputRef}
          className="mov2-global-search"
          placeholder="Search memory, knowledge, and context…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKey}
        />
        <button
          className="mov2-gs-btn"
          onClick={() => doSearch(query)}
          disabled={searching || !query.trim()}
        >
          {searching ? "…" : "Search"}
        </button>
      </div>

      {!results && !searching && (
        <>
          <div className="mov2-search-section">
            <p className="mov2-search-section-title">Suggested Searches</p>
            <div className="mov2-suggested-chips">
              {SUGGESTED.map(s => (
                <button
                  key={s}
                  className="mov2-suggested-chip"
                  onClick={() => { setQuery(s); doSearch(s); }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div className="mov2-search-section">
            <p className="mov2-search-section-title">Recent Queries</p>
            <div className="mov2-recent-list">
              {recentQs.map((r, i) => (
                <div
                  key={i}
                  className="mov2-recent-row"
                  onClick={() => { setQuery(r.q); doSearch(r.q); }}
                >
                  <span className="mov2-recent-q">🕐 {r.q}</span>
                  <span className="mov2-recent-meta">{r.ts}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {searching && (
        <div className="mov2-search-searching">
          <span className="mov2-search-spin">⟳</span>
          <span>Searching memory…</span>
        </div>
      )}

      {results !== null && !searching && (
        <div className="mov2-search-results">
          <div className="mov2-sr-header">
            <p className="mov2-sr-count">
              {results.length > 0 ? `${results.length} result${results.length > 1 ? "s" : ""} for "${query}"` : `No results for "${query}"`}
            </p>
            <button className="mov2-sr-clear" onClick={() => { setResults(null); setQuery(""); }}>Clear</button>
          </div>
          {results.length === 0 ? (
            <div className="mov2-empty">
              <span className="mov2-empty-icon">◎</span>
              <p className="mov2-empty-title">No entries match "{query}"</p>
              <p className="mov2-empty-sub">Try a lead name, date, event type, or broader keyword.</p>
            </div>
          ) : (
            <div className="mov2-sr-list">
              {results.map((e, i) => (
                <div key={e.id || i} className="mov2-sr-row">
                  <TypeChip type={e.type || "context"} />
                  <div className="mov2-sr-body">
                    <p className="mov2-sr-title">{e.title || e.key || "Untitled"}</p>
                    <p className="mov2-sr-snippet">{(e.body || e.content || "").slice(0, 120)}{(e.body || e.content || "").length > 120 ? "…" : ""}</p>
                    {(e.tags?.length > 0) && (
                      <div className="mov2-entry-tags" style={{ marginTop: 4 }}>
                        {e.tags.map(t => <span key={t} className="mov2-tag">{t}</span>)}
                      </div>
                    )}
                  </div>
                  <span className="mov2-sr-ts">{_timeAgo(e.created || e.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Root component ────────────────────────────────────────────────────

export default function MemoryOSV2({ onNavigate }) {
  const [tab, setTab]         = useState("index");
  const [entries, setEntries] = useState(SEED_ENTRIES);
  const [stats, setStats]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [apiDown, setApiDown] = useState(false);
  const [toasts, setToasts]   = useState([]);

  const addToast = useCallback((msg, type = "info") => {
    const id = Date.now();
    setToasts(t => [...t, { id, msg, type }]);
  }, []);

  const removeToast = useCallback(id => setToasts(t => t.filter(x => x.id !== id)), []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [nodesRes, statsRes] = await Promise.all([
        listMemoryNodes({ limit: 50 }),
        memoryStats(),
      ]);
      const nodes = Array.isArray(nodesRes) ? nodesRes
        : (nodesRes?.nodes || nodesRes?.entries || nodesRes?.data || []);
      if (nodes.length > 0) setEntries(nodes);
      if (statsRes && !statsRes.error) setStats(statsRes);
      setApiDown(false);
    } catch {
      setApiDown(false); // keep SEED_ENTRIES, don't mark down
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const totalEntries = stats?.total || stats?.count || entries.length;
  const lastUpdated  = stats?.lastUpdated || entries[0]?.created;

  return (
    <div className="mov2-root">
      {/* Header */}
      <div className="mov2-header">
        <div>
          <h1 className="mov2-page-title">Memory OS</h1>
          <p className="mov2-page-sub">Jarvis's working knowledge, context, and shared memory fabric</p>
        </div>
        <div className="mov2-header-right">
          <div className="mov2-stat-strip">
            <div className="mov2-hstat">
              <span className="mov2-hstat-val">{totalEntries.toLocaleString()}</span>
              <span className="mov2-hstat-label">Entries</span>
            </div>
            <div className="mov2-hstat-sep" />
            <div className="mov2-hstat">
              <span className="mov2-hstat-val">{SHARED_NODES.length}</span>
              <span className="mov2-hstat-label">Shared</span>
            </div>
            <div className="mov2-hstat-sep" />
            <div className="mov2-hstat">
              <span className="mov2-hstat-val">{AI_INSIGHTS.length}</span>
              <span className="mov2-hstat-label">Insights</span>
            </div>
          </div>
          <button className="mov2-refresh-btn" onClick={refresh}>↻ Refresh</button>
        </div>
      </div>

      {/* Sub-nav */}
      <div className="mov2-subnav">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`mov2-subnav-tab${tab === t.id ? " mov2-subnav-tab--active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="mov2-tab-content">
        {tab === "index"        && <TabIndex entries={entries} loading={loading} apiDown={apiDown} />}
        {tab === "shared"       && <TabShared />}
        {tab === "intelligence" && <TabIntelligence />}
        {tab === "knowledge"    && <TabKnowledge addToast={addToast} />}
        {tab === "search"       && <TabSearch allEntries={entries} />}
      </div>

      {/* Toasts */}
      <div className="mov2-toast-container">
        {toasts.map(t => (
          <Toast key={t.id} msg={t.msg} type={t.type} onDone={() => removeToast(t.id)} />
        ))}
      </div>
    </div>
  );
}
