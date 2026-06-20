import React, { useState, useEffect, useCallback } from "react";
import "./ContentSEO.css";

const BASE = process.env.REACT_APP_API_URL || "";
const api   = (path, opts = {}) =>
  fetch(`${BASE}${path}`, { credentials: "include", ...opts }).then(r => r.json());
const post  = (path, body) => api(path, { method: "POST",  headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const patch = (path, body) => api(path, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const TABS = [
  { id: "dashboard",  label: "Dashboard",    icon: "◎" },
  { id: "blog",       label: "Blog Studio",  icon: "✦" },
  { id: "seo",        label: "SEO Command",  icon: "⬡" },
  { id: "repurpose",  label: "Repurpose",    icon: "↻" },
  { id: "landing",    label: "Landing Pages",icon: "◈" },
  { id: "docs",       label: "Docs",         icon: "◻" },
  { id: "calendar",   label: "Calendar",     icon: "◉" },
  { id: "keywords",   label: "Keywords",     icon: "◇" },
  { id: "brand",      label: "Brand Voice",  icon: "⬢" },
  { id: "benchmark",  label: "Benchmark",    icon: "✓" },
];

// ── helpers ───────────────────────────────────────────────────────────────────

function Chip({ children, color }) {
  return <span className={`cs-chip${color ? ` cs-chip-${color}` : ""}`}>{children}</span>;
}

function StatCard({ label, value, sub, accent }) {
  return (
    <div className="cs-stat-card" style={accent ? { borderTop: `2px solid ${accent}` } : {}}>
      <div className="cs-stat-val" style={accent ? { color: accent } : {}}>{value ?? "—"}</div>
      <div className="cs-stat-lbl">{label}</div>
      {sub && <div className="cs-stat-sub">{sub}</div>}
    </div>
  );
}

function ScoreBar({ label, value, accent }) {
  const pct = Math.min(100, Math.max(0, value || 0));
  const col  = accent || (pct >= 80 ? "#22c55e" : pct >= 50 ? "#f59e0b" : "#ef4444");
  return (
    <div className="cs-score-row">
      <span className="cs-score-label">{label}</span>
      <div className="cs-score-track">
        <div className="cs-score-fill" style={{ width: `${pct}%`, background: col }} />
      </div>
      <span className="cs-score-val" style={{ color: col }}>{pct}</span>
    </div>
  );
}

function useContent(path, deps = []) {
  const [data, setData] = useState(null);
  const load = useCallback(() => { api(path).then(r => r.ok !== false && setData(r)); }, [path]);
  useEffect(() => { load(); }, [...deps, load]);
  return [data, load];
}

function useToast() {
  const [msg, setMsg] = useState("");
  const toast = (m) => { setMsg(m); setTimeout(() => setMsg(""), 3000); };
  const Toast = msg ? <span className="cs-toast">{msg}</span> : null;
  return [toast, Toast];
}

function StatusDot({ status }) {
  const c = status === "published" || status === "active" || status === "approved" ? "green"
          : status === "scheduled" ? "yellow"
          : "gray";
  return <span className={`cs-dot cs-dot-${c}`} />;
}

// ── MODULE 9: Dashboard ───────────────────────────────────────────────────────

function DashboardPanel() {
  const [dash, reload] = useContent("/content/dashboard");

  if (!dash?.dashboard) return <div className="cs-loading">Loading…</div>;
  const d = dash.dashboard;

  return (
    <div>
      <div className="cs-section-hdr">
        <span className="cs-section-title">Growth Content Dashboard — G2</span>
        <button className="cs-btn-sm" onClick={reload}>Refresh</button>
      </div>

      <div className="cs-stats-grid">
        <StatCard label="Organic Score"  value={`${d.organicScore}/100`} accent="#22c55e" />
        <StatCard label="Articles"       value={d.content?.totalArticles}   sub={`${d.seo?.publishedCount} published`} />
        <StatCard label="Avg SEO Score"  value={d.seo?.avgArticleSEO}       accent="#7c6fff" />
        <StatCard label="Landing Pages"  value={d.content?.totalLandingPages} sub={`Avg conv. ${d.content?.avgConversionScore}`} />
        <StatCard label="Docs"           value={d.content?.totalDocs} />
        <StatCard label="Keywords"       value={d.keywords?.total}           sub={`${d.keywords?.highOpportunity} high opp.`} />
        <StatCard label="Calendar"       value={d.calendar?.total}           sub={`${d.publishing?.scheduled} scheduled`} />
        <StatCard label="Repurpose Jobs" value={d.repurposing?.totalJobs}    sub={`${d.repurposing?.platforms} platforms`} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
        <div className="cs-card">
          <div className="cs-card-title">SEO Health</div>
          <ScoreBar label="Organic Score"     value={d.organicScore}           accent="#22c55e" />
          <ScoreBar label="Avg Article SEO"   value={d.seo?.avgArticleSEO}     accent="#7c6fff" />
          <ScoreBar label="Avg Conv. Score"   value={d.content?.avgConversionScore} accent="#4ecdc4" />
          <ScoreBar label="KW Coverage"       value={Math.min(100, (d.keywords?.total || 0) * 4)} accent="#f59e0b" />
        </div>
        <div className="cs-card">
          <div className="cs-card-title">Traffic Projection (Organic)</div>
          {d.trafficProjection && (
            <div className="cs-projection">
              {[
                { label: "Month 1", value: d.trafficProjection.month1, color: "#4ecdc4" },
                { label: "Month 3", value: d.trafficProjection.month3, color: "#7c6fff" },
                { label: "Month 6", value: d.trafficProjection.month6, color: "#22c55e" },
              ].map(p => (
                <div key={p.label} className="cs-proj-row">
                  <span className="cs-proj-label">{p.label}</span>
                  <span className="cs-proj-val" style={{ color: p.color }}>{(p.value || 0).toLocaleString()} visits</span>
                </div>
              ))}
              <div className="cs-hint">{d.trafficProjection.assumptions}</div>
            </div>
          )}
        </div>
      </div>

      <div className="cs-card" style={{ marginTop: 12 }}>
        <div className="cs-card-title">Keyword Intelligence Summary</div>
        <div className="cs-stats-grid" style={{ marginTop: 8 }}>
          <StatCard label="Total Keywords"     value={d.keywords?.total} />
          <StatCard label="Avg Opportunity"    value={d.keywords?.avgOpportunity} accent="#7c6fff" />
          <StatCard label="High Opportunity"   value={d.keywords?.highOpportunity} accent="#22c55e" />
          <StatCard label="Competitor Gaps"    value={d.keywords?.competitorGaps} accent="#f59e0b" />
          <StatCard label="Rising Trends"      value={d.keywords?.rising} />
          <StatCard label="Emerging"           value={d.keywords?.emerging} />
        </div>
        {(d.keywords?.topOpportunities || []).length > 0 && (
          <>
            <div className="cs-sub-title">Top Keyword Opportunities</div>
            <div className="cs-list">
              {d.keywords.topOpportunities.map(k => (
                <div key={k.id || k.keyword} className="cs-row">
                  <span className="cs-row-name">{k.keyword}</span>
                  <Chip>{k.intent}</Chip>
                  {k.competitorGap && <Chip color="green">gap</Chip>}
                  <span className="cs-row-meta">{k.volume?.toLocaleString()}/mo</span>
                  <span className="cs-row-meta">diff {k.difficulty}</span>
                  <span className="cs-opp" style={{ color: k.opportunityScore >= 70 ? "#22c55e" : "#f59e0b" }}>⬡ {k.opportunityScore}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── MODULE 1: AI Blog Studio ──────────────────────────────────────────────────

const ARTICLE_TYPES = ["blog", "how-to", "case-study", "release-notes", "product-update", "tutorial", "listicle", "comparison"];

function BlogStudioPanel() {
  const [articles, reload] = useContent("/content/articles");
  const [view, setView]    = useState("list");
  const [filter, setFilter] = useState("all");
  const [form, setForm]    = useState({ type: "blog", title: "", metaDesc: "", keyword: "", slug: "", body: "" });
  const [prompt, setPrompt] = useState(null);
  const [selected, setSelected] = useState(null);
  const [toast, Toast] = useToast();

  const create = async () => {
    if (!form.title) return;
    const art = await post("/content/articles", form);
    if (art.ok !== false) {
      setForm({ type: "blog", title: "", metaDesc: "", keyword: "", slug: "", body: "" });
      toast("Article created");
      reload();
      setView("list");
    }
  };

  const publish = async (id) => {
    await post(`/content/articles/${id}/publish`, {});
    toast("Published!");
    reload();
  };

  const getPrompt = async () => {
    if (!form.type || !form.title) return;
    const r = await api(`/content/articles/prompt?type=${encodeURIComponent(form.type)}&topic=${encodeURIComponent(form.title)}&keyword=${encodeURIComponent(form.keyword)}`);
    if (r.ok !== false) setPrompt(r.prompt);
  };

  const list = (articles?.articles || []).filter(a => filter === "all" || a.type === filter);

  return (
    <div>
      <div className="cs-sub-tabs">
        {["list","create"].map(v => (
          <button key={v} className={`cs-sub-tab${view === v ? " active" : ""}`} onClick={() => setView(v)}>
            {v === "create" ? "+ New Article" : `Articles (${articles?.articles?.length || 0})`}
          </button>
        ))}
        {Toast}
      </div>

      {view === "list" && (
        <div>
          <div className="cs-filter-row">
            {["all", ...ARTICLE_TYPES].map(t => (
              <button key={t} className={`cs-filter-btn${filter === t ? " active" : ""}`} onClick={() => setFilter(t)}>
                {t === "all" ? "All" : t}
              </button>
            ))}
          </div>
          <div className="cs-stats-grid" style={{ margin: "8px 0" }}>
            <StatCard label="Total"     value={articles?.articles?.length || 0} />
            <StatCard label="Published" value={(articles?.articles || []).filter(a => a.status === "published").length} accent="#22c55e" />
            <StatCard label="Draft"     value={(articles?.articles || []).filter(a => a.status === "draft").length} />
            <StatCard label="Avg SEO"   value={Math.round((articles?.articles || []).reduce((s, a) => s + (a.seoScore || 0), 0) / Math.max(1, articles?.articles?.length || 1))} accent="#7c6fff" />
          </div>
          <div className="cs-list">
            {list.length === 0 && <div className="cs-empty">No articles yet. Create your first AI-powered post.</div>}
            {list.map(a => (
              <div key={a.id} className={`cs-row${selected?.id === a.id ? " selected" : ""}`} onClick={() => setSelected(selected?.id === a.id ? null : a)}>
                <StatusDot status={a.status} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="cs-row-name">{a.title}</div>
                  <div className="cs-row-meta">{a.type} · {a.wordCount} words{a.keyword ? ` · KW: ${a.keyword}` : ""}</div>
                  {selected?.id === a.id && a.metaDesc && (
                    <div className="cs-row-meta" style={{ marginTop: 4, color: "#888" }}>Meta: {a.metaDesc}</div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <div className="cs-score-pill" style={{ background: a.seoScore >= 70 ? "#22c55e22" : "#f59e0b22", color: a.seoScore >= 70 ? "#22c55e" : "#f59e0b" }}>SEO {a.seoScore}</div>
                  <Chip color={a.status === "published" ? "green" : "gray"}>{a.status}</Chip>
                  {a.status === "draft" && <button className="cs-btn-sm" onClick={e => { e.stopPropagation(); publish(a.id); }}>Publish</button>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {view === "create" && (
        <div className="cs-form">
          <div className="cs-form-title">New Article</div>
          <div className="cs-form-row">
            <select className="cs-select" value={form.type} onChange={e => setForm(f => ({...f, type: e.target.value}))}>
              {ARTICLE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <input className="cs-input" style={{ flex: 1 }} placeholder="Title *" value={form.title} onChange={e => setForm(f => ({...f, title: e.target.value, slug: e.target.value.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")}))} />
          </div>
          <div className="cs-form-row">
            <input className="cs-input" style={{ flex: 1 }} placeholder="Focus keyword" value={form.keyword} onChange={e => setForm(f => ({...f, keyword: e.target.value}))} />
            <input className="cs-input" style={{ flex: 1 }} placeholder="URL slug" value={form.slug} onChange={e => setForm(f => ({...f, slug: e.target.value}))} />
          </div>
          <input className="cs-input" style={{ width: "100%", marginBottom: 8 }} placeholder="Meta description (150-160 chars)" value={form.metaDesc} onChange={e => setForm(f => ({...f, metaDesc: e.target.value}))} />
          <div className="cs-hint">{form.metaDesc.length}/160</div>
          <textarea className="cs-textarea" placeholder="Article body (or leave blank and use AI prompt below)" value={form.body} onChange={e => setForm(f => ({...f, body: e.target.value}))} />
          <div className="cs-form-row" style={{ marginTop: 8 }}>
            <button className="cs-btn" onClick={create}>Create Article</button>
            <button className="cs-btn-sm" onClick={getPrompt}>Get AI Prompt</button>
          </div>
          {prompt && (
            <div className="cs-prompt-box">
              <div className="cs-sub-title">AI Prompt — paste into Claude</div>
              <div className="cs-prompt-system"><strong>System:</strong> {prompt.systemPrompt}</div>
              <pre className="cs-prompt-body">{prompt.userPrompt}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── MODULE 2: SEO Command Center ──────────────────────────────────────────────

function SEOPanel() {
  const [audit,    reloadAudit]   = useContent("/content/seo/audit");
  const [clusters, reloadClusters] = useContent("/content/seo/clusters");
  const [view,     setView]       = useState("audit");
  const [cfForm,   setCfForm]     = useState({ pillarTopic: "", supportingTopics: "" });
  const [schemaForm, setSchemaForm] = useState({ type: "article", title: "", description: "" });
  const [schemaResult, setSchemaResult] = useState(null);
  const [toast,    Toast]         = useToast();

  const createCluster = async () => {
    if (!cfForm.pillarTopic) return;
    await post("/content/seo/clusters", { pillarTopic: cfForm.pillarTopic, supportingTopics: cfForm.supportingTopics.split(",").map(t => t.trim()).filter(Boolean) });
    setCfForm({ pillarTopic: "", supportingTopics: "" });
    toast("Topic cluster created");
    reloadClusters();
  };

  const generateSchema = async () => {
    const r = await post("/content/seo/schema", { type: schemaForm.type, data: { title: schemaForm.title, description: schemaForm.description } });
    if (r.ok !== false) setSchemaResult(r.schema);
  };

  const STATUS_COLORS = { pass: "#22c55e", warn: "#f59e0b", missing: "#ef4444", action: "#7c6fff", unknown: "#555" };

  return (
    <div>
      <div className="cs-sub-tabs">
        {["audit","clusters","schema","metatags"].map(v => (
          <button key={v} className={`cs-sub-tab${view === v ? " active" : ""}`} onClick={() => setView(v)}>
            {v === "audit" ? "Technical Audit" : v === "clusters" ? `Topic Clusters (${clusters?.clusters?.length || 0})` : v === "schema" ? "Schema Generator" : "Meta Tags"}
          </button>
        ))}
        {Toast}
      </div>

      {view === "audit" && audit?.audit && (
        <div>
          <div className="cs-stats-grid" style={{ marginBottom: 12 }}>
            <StatCard label="SEO Score"      value={`${audit.audit.score}%`}      accent="#22c55e" />
            <StatCard label="Passing"        value={`${audit.audit.passing}/${audit.audit.total}`} />
            <StatCard label="Critical Issues" value={audit.audit.criticalIssues}  accent="#ef4444" />
            <StatCard label="Verdict"        value={audit.audit.verdict?.replace(/_/g," ")} accent={audit.audit.score >= 80 ? "#22c55e" : "#f59e0b"} />
          </div>
          <ScoreBar label="Overall SEO Score" value={audit.audit.score} />
          <div className="cs-list" style={{ marginTop: 12 }}>
            {["critical","high","medium","low"].map(sev => {
              const checks = audit.audit.checks.filter(c => c.severity === sev);
              return checks.length > 0 ? (
                <div key={sev}>
                  <div className="cs-sub-title">{sev.charAt(0).toUpperCase() + sev.slice(1)} ({checks.length})</div>
                  {checks.map(c => (
                    <div key={c.id} className="cs-audit-row">
                      <span style={{ color: STATUS_COLORS[c.status] || "#555", fontWeight: 700, fontSize: 12 }}>{c.pass ? "✓" : c.status === "unknown" ? "?" : "✗"}</span>
                      <div style={{ flex: 1 }}>
                        <div className="cs-row-name">{c.label}</div>
                        <div className="cs-row-meta">{c.note}</div>
                      </div>
                      <Chip color={c.pass ? "green" : c.status === "warn" ? "yellow" : c.status === "unknown" ? "" : "red"}>{c.status}</Chip>
                    </div>
                  ))}
                </div>
              ) : null;
            })}
          </div>
        </div>
      )}

      {view === "clusters" && (
        <div>
          <div className="cs-list">
            {(clusters?.clusters || []).length === 0 && <div className="cs-empty">No topic clusters. Create pillar + supporting content clusters for SEO authority.</div>}
            {(clusters?.clusters || []).map(c => (
              <div key={c.id} className="cs-row">
                <div style={{ flex: 1 }}>
                  <div className="cs-row-name">⬡ {c.pillarTopic}</div>
                  <div className="cs-row-meta">
                    {c.supportingTopics?.length || 0} supporting topics · {c.internalLinks?.length || 0} internal links
                  </div>
                  {c.supportingTopics?.length > 0 && (
                    <div className="cs-tag-row">
                      {c.supportingTopics.map((t, i) => <Chip key={i}>{t}</Chip>)}
                    </div>
                  )}
                </div>
                <Chip color="green">{c.status}</Chip>
              </div>
            ))}
          </div>
          <div className="cs-form" style={{ marginTop: 12 }}>
            <div className="cs-form-title">New Topic Cluster</div>
            <div className="cs-form-row">
              <input className="cs-input" style={{ flex: 1 }} placeholder="Pillar topic *" value={cfForm.pillarTopic} onChange={e => setCfForm(f => ({...f, pillarTopic: e.target.value}))} />
            </div>
            <div className="cs-form-row">
              <input className="cs-input" style={{ flex: 1 }} placeholder="Supporting topics (comma separated)" value={cfForm.supportingTopics} onChange={e => setCfForm(f => ({...f, supportingTopics: e.target.value}))} />
              <button className="cs-btn" onClick={createCluster}>Create</button>
            </div>
          </div>
        </div>
      )}

      {view === "schema" && (
        <div>
          <div className="cs-form">
            <div className="cs-form-title">Schema Markup Generator</div>
            <div className="cs-form-row">
              <select className="cs-select" value={schemaForm.type} onChange={e => setSchemaForm(f => ({...f, type: e.target.value}))}>
                {["article","howto","faq","product","breadcrumb"].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <input className="cs-input" style={{ flex: 1 }} placeholder="Title / name" value={schemaForm.title} onChange={e => setSchemaForm(f => ({...f, title: e.target.value}))} />
              <button className="cs-btn" onClick={generateSchema}>Generate</button>
            </div>
          </div>
          {schemaResult && (
            <div style={{ marginTop: 12 }}>
              <div className="cs-sub-title">Generated JSON-LD — paste inside &lt;script type="application/ld+json"&gt;</div>
              <pre className="cs-prompt-body">{JSON.stringify(schemaResult, null, 2)}</pre>
            </div>
          )}
        </div>
      )}

      {view === "metatags" && (
        <div className="cs-card">
          <div className="cs-card-title">Meta Tag Checklists</div>
          {[
            { tag: "<title>", rule: "30-70 chars, keyword first", status: "pass" },
            { tag: "<meta name=\"description\">", rule: "150-160 chars, include CTA", status: "pass" },
            { tag: "<meta property=\"og:title\">", rule: "Match page title", status: "pass" },
            { tag: "<meta property=\"og:description\">", rule: "Match meta description", status: "pass" },
            { tag: "<meta property=\"og:image\">", rule: "1200×630px, compressed", status: "pass" },
            { tag: "<meta name=\"twitter:card\">", rule: "summary_large_image", status: "pass" },
            { tag: "<link rel=\"canonical\">", rule: "Self-referencing canonical", status: "pass" },
            { tag: "<meta name=\"robots\">", rule: "index, follow (or noindex for drafts)", status: "pass" },
            { tag: "<html lang=\"...\">", rule: "en or en-IN for Indian audience", status: "pass" },
            { tag: "<meta name=\"viewport\">", rule: "width=device-width, initial-scale=1", status: "pass" },
          ].map(m => (
            <div key={m.tag} className="cs-audit-row">
              <span style={{ color: "#22c55e", fontWeight: 700 }}>✓</span>
              <div style={{ flex: 1 }}>
                <code className="cs-code">{m.tag}</code>
                <div className="cs-row-meta">{m.rule}</div>
              </div>
              <Chip color="green">ok</Chip>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── MODULE 3: Content Repurposing Engine ──────────────────────────────────────

function RepurposePanel() {
  const [jobs,   reload] = useContent("/content/repurpose/jobs");
  const [targets]        = useContent("/content/repurpose/targets");
  const [source, setSource]     = useState("");
  const [selected, setSelected] = useState([]);
  const [result, setResult]     = useState(null);
  const [loading, setLoading]   = useState(false);
  const [toast,   Toast]        = useToast();

  const allTargets = targets?.targets || [];
  const toggleTarget = (id) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  const repurpose = async () => {
    if (!source.trim()) return;
    setLoading(true);
    const t = selected.length > 0 ? selected : allTargets.map(t => t.id);
    const r = await post("/content/repurpose", { content: source, targets: t });
    if (r.ok !== false) { setResult(r); reload(); toast(`${r.total} platform outputs generated`); }
    setLoading(false);
  };

  const CHANNEL_ICONS = { blog: "◎", linkedin: "◉", instagram: "◇", facebook: "◈", x: "✕", threads: "⬡", pinterest: "⬢", newsletter: "✉", email: "✉", video_script: "▷" };

  return (
    <div>
      <div className="cs-section-hdr">
        <span className="cs-section-title">Content Repurposing Engine</span>
        {Toast}
      </div>
      <p className="cs-hint">One source → 10 platform-optimized outputs instantly. Select targets or repurpose everywhere.</p>

      <div className="cs-repurpose-platforms">
        {allTargets.map(t => (
          <button
            key={t.id}
            className={`cs-platform-btn${selected.includes(t.id) ? " active" : ""}`}
            onClick={() => toggleTarget(t.id)}
          >
            <span>{CHANNEL_ICONS[t.id] || "◎"}</span>
            <span>{t.label}</span>
            <span className="cs-platform-len">{t.maxLen > 999 ? `${Math.round(t.maxLen/1000)}k` : t.maxLen}</span>
          </button>
        ))}
      </div>

      <div className="cs-form" style={{ marginTop: 12 }}>
        <div className="cs-form-title">Source Content</div>
        <textarea className="cs-textarea" style={{ minHeight: 120 }} placeholder="Paste your source article, blog post, or talking points here…" value={source} onChange={e => setSource(e.target.value)} />
        <div className="cs-form-row" style={{ marginTop: 8 }}>
          <span className="cs-hint">{selected.length === 0 ? "All 10 platforms" : `${selected.length} selected`}</span>
          <button className="cs-btn" onClick={repurpose} disabled={loading || !source.trim()}>{loading ? "Generating…" : "Repurpose Content"}</button>
          {selected.length > 0 && <button className="cs-btn-sm" onClick={() => setSelected([])}>Clear selection</button>}
        </div>
      </div>

      {result && (
        <div style={{ marginTop: 16 }}>
          <div className="cs-sub-title">{result.total} Platform Prompts Generated</div>
          <div className="cs-list">
            {(result.prompts || []).map(p => (
              <div key={p.targetId} className="cs-row">
                <span style={{ fontSize: 14 }}>{CHANNEL_ICONS[p.targetId] || "◎"}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="cs-row-name">{p.targetLabel}</div>
                  <div className="cs-row-meta cs-row-truncate">{p.prompt?.slice(0, 100)}…</div>
                </div>
                <Chip>{p.platform}</Chip>
                <span className="cs-hint">{p.maxLen} chars</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {(jobs?.jobs || []).length > 0 && (
        <>
          <div className="cs-sub-title" style={{ marginTop: 16 }}>Recent Jobs ({jobs.jobs.length})</div>
          <div className="cs-list">
            {(jobs.jobs || []).slice(0, 5).map(j => (
              <div key={j.id} className="cs-row">
                <span className="cs-row-name">{j.targets?.length || 0} platforms</span>
                <Chip color="green">completed</Chip>
                <span className="cs-hint">{new Date(j.createdAt).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── MODULE 4: Landing Page Builder ────────────────────────────────────────────

function LandingPagePanel() {
  const [pages,   reload] = useContent("/content/landing-pages");
  const [view,    setView] = useState("list");
  const [form,    setForm] = useState({ name: "", audience: "", keyword: "", metaTitle: "", metaDesc: "", slug: "" });
  const [prompt,  setPrompt] = useState(null);
  const [toast,   Toast]   = useToast();

  const create = async () => {
    if (!form.name || !form.audience) return;
    const lp = await post("/content/landing-pages", form);
    if (lp.ok !== false) { setForm({ name: "", audience: "", keyword: "", metaTitle: "", metaDesc: "", slug: "" }); toast("Landing page created"); reload(); setView("list"); }
  };

  const getPrompt = async () => {
    if (!form.audience || !form.keyword) return;
    const r = await api(`/content/landing-pages/prompt?audience=${encodeURIComponent(form.audience)}&keyword=${encodeURIComponent(form.keyword)}`);
    if (r.ok !== false) setPrompt(r.prompt);
  };

  const list = pages?.landingPages || [];

  return (
    <div>
      <div className="cs-sub-tabs">
        {["list","create"].map(v => (
          <button key={v} className={`cs-sub-tab${view === v ? " active" : ""}`} onClick={() => setView(v)}>
            {v === "create" ? "+ New Page" : `Pages (${list.length})`}
          </button>
        ))}
        {Toast}
      </div>

      {view === "list" && (
        <div>
          <div className="cs-stats-grid" style={{ marginBottom: 12 }}>
            <StatCard label="Total"     value={list.length} />
            <StatCard label="Avg SEO"   value={Math.round(list.reduce((s, l) => s + (l.seoScore || 0), 0) / Math.max(1, list.length))} accent="#7c6fff" />
            <StatCard label="Avg Conv." value={Math.round(list.reduce((s, l) => s + (l.conversionScore || 0), 0) / Math.max(1, list.length))} accent="#22c55e" />
            <StatCard label="Published" value={list.filter(l => l.status === "published").length} />
          </div>
          <div className="cs-list">
            {list.length === 0 && <div className="cs-empty">No landing pages. Create AI-powered, SEO-optimized pages for each audience.</div>}
            {list.map(lp => (
              <div key={lp.id} className="cs-row">
                <StatusDot status={lp.status} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="cs-row-name">{lp.name}</div>
                  <div className="cs-row-meta">/{lp.slug} · Audience: {lp.audience} · KW: {lp.keyword}</div>
                </div>
                <div className="cs-score-pills">
                  <div className="cs-score-pill" style={{ background: lp.seoScore >= 70 ? "#22c55e22" : "#f59e0b22", color: lp.seoScore >= 70 ? "#22c55e" : "#f59e0b" }}>SEO {lp.seoScore}</div>
                  <div className="cs-score-pill" style={{ background: lp.conversionScore >= 70 ? "#4ecdc422" : "#7c6fff22", color: lp.conversionScore >= 70 ? "#4ecdc4" : "#7c6fff" }}>Conv {lp.conversionScore}</div>
                </div>
                <Chip color={lp.status === "published" ? "green" : "gray"}>{lp.status}</Chip>
              </div>
            ))}
          </div>
        </div>
      )}

      {view === "create" && (
        <div className="cs-form">
          <div className="cs-form-title">New Landing Page</div>
          <div className="cs-form-row">
            <input className="cs-input" placeholder="Page name *" value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} />
            <input className="cs-input" placeholder="Target audience *" value={form.audience} onChange={e => setForm(f => ({...f, audience: e.target.value}))} />
            <input className="cs-input" placeholder="Focus keyword" value={form.keyword} onChange={e => setForm(f => ({...f, keyword: e.target.value}))} />
          </div>
          <div className="cs-form-row">
            <input className="cs-input" style={{ flex: 1 }} placeholder="Meta title (30-70 chars)" value={form.metaTitle} onChange={e => setForm(f => ({...f, metaTitle: e.target.value}))} />
            <input className="cs-input" style={{ flex: 1 }} placeholder="URL slug" value={form.slug} onChange={e => setForm(f => ({...f, slug: e.target.value}))} />
          </div>
          <input className="cs-input" style={{ width: "100%", marginBottom: 8 }} placeholder="Meta description (150-160 chars)" value={form.metaDesc} onChange={e => setForm(f => ({...f, metaDesc: e.target.value}))} />
          <div className="cs-form-row">
            <button className="cs-btn" onClick={create}>Create Page</button>
            <button className="cs-btn-sm" onClick={getPrompt}>Get AI Prompt</button>
          </div>
          {prompt && (
            <div className="cs-prompt-box">
              <div className="cs-sub-title">AI Prompt — generates full page sections</div>
              <pre className="cs-prompt-body">{prompt.userPrompt}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── MODULE 5: Documentation Generator ────────────────────────────────────────

const DOC_TYPES = ["api-reference", "feature-guide", "release-notes", "tutorial", "troubleshooting", "changelog", "faq"];

function DocsPanel() {
  const [docs,   reload] = useContent("/content/docs");
  const [view,   setView] = useState("list");
  const [filter, setFilter] = useState("all");
  const [form,   setForm]  = useState({ type: "feature-guide", title: "", version: "v3.0", body: "" });
  const [prompt, setPrompt] = useState(null);
  const [toast,  Toast]    = useToast();

  const create = async () => {
    if (!form.title) return;
    await post("/content/docs", form);
    setForm({ type: "feature-guide", title: "", version: "v3.0", body: "" });
    toast("Doc created");
    reload();
    setView("list");
  };

  const getPrompt = async () => {
    if (!form.type || !form.title) return;
    const r = await api(`/content/docs/prompt?type=${encodeURIComponent(form.type)}&subject=${encodeURIComponent(form.title)}&version=${encodeURIComponent(form.version)}`);
    if (r.ok !== false) setPrompt(r.prompt);
  };

  const list = (docs?.docs || []).filter(d => filter === "all" || d.type === filter);

  return (
    <div>
      <div className="cs-sub-tabs">
        {["list","create"].map(v => (
          <button key={v} className={`cs-sub-tab${view === v ? " active" : ""}`} onClick={() => setView(v)}>
            {v === "create" ? "+ New Doc" : `Docs (${docs?.docs?.length || 0})`}
          </button>
        ))}
        {Toast}
      </div>

      {view === "list" && (
        <div>
          <div className="cs-filter-row">
            {["all", ...DOC_TYPES].map(t => (
              <button key={t} className={`cs-filter-btn${filter === t ? " active" : ""}`} onClick={() => setFilter(t)}>
                {t === "all" ? "All" : t.replace(/-/g, " ")}
              </button>
            ))}
          </div>
          <div className="cs-list" style={{ marginTop: 8 }}>
            {list.length === 0 && <div className="cs-empty">No docs yet. Generate API references, tutorials, and release notes.</div>}
            {list.map(d => (
              <div key={d.id} className="cs-row">
                <StatusDot status={d.status} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="cs-row-name">{d.title}</div>
                  <div className="cs-row-meta">{d.type.replace(/-/g," ")} · {d.version}{d.tags?.length ? ` · ${d.tags.join(", ")}` : ""}</div>
                </div>
                <Chip>{d.type.replace(/-/g," ")}</Chip>
                <Chip color={d.status === "published" ? "green" : "gray"}>{d.status}</Chip>
              </div>
            ))}
          </div>
        </div>
      )}

      {view === "create" && (
        <div className="cs-form">
          <div className="cs-form-title">New Documentation</div>
          <div className="cs-form-row">
            <select className="cs-select" value={form.type} onChange={e => setForm(f => ({...f, type: e.target.value}))}>
              {DOC_TYPES.map(t => <option key={t} value={t}>{t.replace(/-/g," ")}</option>)}
            </select>
            <input className="cs-input" style={{ flex: 1 }} placeholder="Title / subject *" value={form.title} onChange={e => setForm(f => ({...f, title: e.target.value}))} />
            <input className="cs-input" style={{ width: 100, flex: "none" }} placeholder="Version" value={form.version} onChange={e => setForm(f => ({...f, version: e.target.value}))} />
          </div>
          <textarea className="cs-textarea" placeholder="Content (or use AI prompt to generate)" value={form.body} onChange={e => setForm(f => ({...f, body: e.target.value}))} />
          <div className="cs-form-row" style={{ marginTop: 8 }}>
            <button className="cs-btn" onClick={create}>Create Doc</button>
            <button className="cs-btn-sm" onClick={getPrompt}>Get AI Prompt</button>
          </div>
          {prompt && (
            <div className="cs-prompt-box">
              <div className="cs-sub-title">AI Prompt — copy to Claude for full doc generation</div>
              <pre className="cs-prompt-body">{prompt.userPrompt}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── MODULE 6: Content Calendar ────────────────────────────────────────────────

function CalendarPanel() {
  const [cal,  reload] = useContent("/content/calendar");
  const [form, setForm] = useState({ title: "", type: "blog", channel: "blog", scheduledDate: "", assignee: "", notes: "" });
  const [view, setView] = useState("calendar");
  const [toast, Toast]  = useToast();

  const create = async () => {
    if (!form.title) return;
    await post("/content/calendar", form);
    setForm({ title: "", type: "blog", channel: "blog", scheduledDate: "", assignee: "", notes: "" });
    toast("Entry added to calendar");
    reload();
  };

  const approve = async (id) => {
    await post(`/content/calendar/${id}/approve`, { notes: "Approved", approved: true });
    toast("Approved!");
    reload();
  };

  const reject = async (id) => {
    await post(`/content/calendar/${id}/reject`, { notes: "Needs revision" });
    toast("Sent back for revision");
    reload();
  };

  const entries = cal?.entries || [];
  const stats   = cal?.stats;

  const STATE_COLOR = { draft: "gray", "in-review": "yellow", approved: "green", scheduled: "green", published: "green", rejected: "red" };

  const CHANNELS = ["blog","linkedin","instagram","facebook","x","threads","email","whatsapp","push"];

  return (
    <div>
      <div className="cs-sub-tabs">
        {["calendar","planning","create"].map(v => (
          <button key={v} className={`cs-sub-tab${view === v ? " active" : ""}`} onClick={() => setView(v)}>
            {v === "create" ? "+ Add Entry" : v === "planning" ? "Approval Queue" : `Calendar (${entries.length})`}
          </button>
        ))}
        {Toast}
      </div>

      {stats && (
        <div className="cs-stats-grid" style={{ margin: "8px 0" }}>
          <StatCard label="Total"       value={stats.total} />
          <StatCard label="This Month"  value={stats.thisMonth} />
          <StatCard label="Approved"    value={stats.byState?.approved || 0}    accent="#22c55e" />
          <StatCard label="In Review"   value={stats.byState?.["in-review"] || 0} accent="#f59e0b" />
          <StatCard label="Scheduled"   value={stats.byState?.scheduled || 0}   accent="#7c6fff" />
          <StatCard label="Published"   value={stats.byState?.published || 0}   accent="#4ecdc4" />
        </div>
      )}

      {view === "calendar" && (
        <div className="cs-list">
          {entries.length === 0 && <div className="cs-empty">No calendar entries. Plan your publishing schedule here.</div>}
          {entries.map(e => (
            <div key={e.id} className="cs-row">
              <StatusDot status={e.approvalState} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="cs-row-name">{e.title}</div>
                <div className="cs-row-meta">
                  {e.channel} · {e.type}
                  {e.scheduledDate && ` · ${new Date(e.scheduledDate).toLocaleDateString("en-IN", { month: "short", day: "numeric" })}`}
                  {e.assignee && ` · @${e.assignee}`}
                </div>
              </div>
              {e.keywords?.length > 0 && e.keywords.slice(0, 2).map((k, i) => <Chip key={i}>{k}</Chip>)}
              <Chip color={STATE_COLOR[e.approvalState] || "gray"}>{e.approvalState}</Chip>
            </div>
          ))}
        </div>
      )}

      {view === "planning" && (
        <div className="cs-list">
          {entries.filter(e => e.approvalState === "draft" || e.approvalState === "in-review").length === 0 && (
            <div className="cs-empty">No entries pending approval.</div>
          )}
          {entries.filter(e => e.approvalState === "draft" || e.approvalState === "in-review").map(e => (
            <div key={e.id} className="cs-row">
              <div style={{ flex: 1 }}>
                <div className="cs-row-name">{e.title}</div>
                <div className="cs-row-meta">{e.channel} · {e.type} · {e.scheduledDate || "unscheduled"}</div>
              </div>
              <Chip color={STATE_COLOR[e.approvalState] || "gray"}>{e.approvalState}</Chip>
              <button className="cs-btn-sm" style={{ color: "#22c55e" }} onClick={() => approve(e.id)}>Approve</button>
              <button className="cs-btn-sm" style={{ color: "#ef4444" }} onClick={() => reject(e.id)}>Reject</button>
            </div>
          ))}
        </div>
      )}

      {view === "create" && (
        <div className="cs-form">
          <div className="cs-form-title">Add Calendar Entry</div>
          <div className="cs-form-row">
            <input className="cs-input" style={{ flex: 1 }} placeholder="Title *" value={form.title} onChange={e => setForm(f => ({...f, title: e.target.value}))} />
            <select className="cs-select" value={form.channel} onChange={e => setForm(f => ({...f, channel: e.target.value}))}>
              {CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select className="cs-select" value={form.type} onChange={e => setForm(f => ({...f, type: e.target.value}))}>
              {["blog","social","email","video","newsletter","docs"].map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="cs-form-row">
            <input type="date" className="cs-input" value={form.scheduledDate} onChange={e => setForm(f => ({...f, scheduledDate: e.target.value}))} />
            <input className="cs-input" placeholder="Assignee" value={form.assignee} onChange={e => setForm(f => ({...f, assignee: e.target.value}))} />
            <button className="cs-btn" onClick={create}>Add Entry</button>
          </div>
          <input className="cs-input" style={{ width: "100%", marginBottom: 0 }} placeholder="Notes" value={form.notes} onChange={e => setForm(f => ({...f, notes: e.target.value}))} />
        </div>
      )}
    </div>
  );
}

// ── MODULE 7: Keyword Intelligence ────────────────────────────────────────────

function KeywordsPanel() {
  const [keywords, reload] = useContent("/content/keywords");
  const [intel]            = useContent("/content/keywords/intelligence");
  const [view, setView]    = useState("list");
  const [filter, setFilter] = useState("all");
  const [form, setForm]    = useState({ keyword: "", volume: "", difficulty: "", intent: "commercial", competitorGap: false, trend: "rising" });
  const [toast, Toast]     = useToast();

  const add = async () => {
    if (!form.keyword) return;
    await post("/content/keywords", { ...form, volume: Number(form.volume) || 0, difficulty: Number(form.difficulty) || 50 });
    setForm({ keyword: "", volume: "", difficulty: "", intent: "commercial", competitorGap: false, trend: "rising" });
    toast("Keyword added");
    reload();
  };

  const all = keywords?.keywords || [];
  const filtered = filter === "all" ? all : all.filter(k => k.intent === filter);

  const OPP_COLOR = (s) => s >= 80 ? "#22c55e" : s >= 60 ? "#4ecdc4" : s >= 40 ? "#f59e0b" : "#ef4444";
  const TREND_COLOR = { rising: "#22c55e", emerging: "#7c6fff", stable: "#888", declining: "#ef4444" };

  return (
    <div>
      <div className="cs-sub-tabs">
        {["list","add"].map(v => (
          <button key={v} className={`cs-sub-tab${view === v ? " active" : ""}`} onClick={() => setView(v)}>
            {v === "add" ? "+ Add Keyword" : `Keywords (${all.length})`}
          </button>
        ))}
        {Toast}
      </div>

      {intel?.intelligence && (
        <div className="cs-stats-grid" style={{ margin: "8px 0" }}>
          <StatCard label="Total"           value={intel.intelligence.total} />
          <StatCard label="Avg Opportunity" value={intel.intelligence.avgOpportunity} accent="#7c6fff" />
          <StatCard label="High Opp (70+)"  value={intel.intelligence.highOpportunity} accent="#22c55e" />
          <StatCard label="Competitor Gaps" value={intel.intelligence.competitorGaps}  accent="#f59e0b" />
          <StatCard label="Rising"          value={intel.intelligence.rising} />
          <StatCard label="Emerging"        value={intel.intelligence.emerging}  accent="#7c6fff" />
        </div>
      )}

      {view === "list" && (
        <div>
          <div className="cs-filter-row">
            {["all","transactional","commercial","informational","navigational"].map(i => (
              <button key={i} className={`cs-filter-btn${filter === i ? " active" : ""}`} onClick={() => setFilter(i)}>
                {i === "all" ? "All" : i}
              </button>
            ))}
          </div>
          <div className="cs-list" style={{ marginTop: 8 }}>
            {filtered.length === 0 && <div className="cs-empty">No keywords found for this intent filter.</div>}
            {filtered.map(k => (
              <div key={k.id} className="cs-row">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="cs-row-name">{k.keyword}</div>
                  <div className="cs-row-meta">
                    {(k.volume || 0).toLocaleString()}/mo · Difficulty {k.difficulty}
                    {k.notes && ` · ${k.notes}`}
                  </div>
                </div>
                <Chip>{k.intent}</Chip>
                {k.competitorGap && <Chip color="green">gap</Chip>}
                <span className="cs-trend" style={{ color: TREND_COLOR[k.trend] || "#888" }}>{k.trend}</span>
                <div className="cs-opp-pill" style={{ background: OPP_COLOR(k.opportunityScore) + "22", color: OPP_COLOR(k.opportunityScore) }}>
                  {k.opportunityScore}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {view === "add" && (
        <div className="cs-form">
          <div className="cs-form-title">Add Keyword</div>
          <div className="cs-form-row">
            <input className="cs-input" style={{ flex: 2 }} placeholder="Keyword *" value={form.keyword} onChange={e => setForm(f => ({...f, keyword: e.target.value}))} />
            <input className="cs-input" type="number" style={{ width: 100, flex: "none" }} placeholder="Volume/mo" value={form.volume} onChange={e => setForm(f => ({...f, volume: e.target.value}))} />
            <input className="cs-input" type="number" style={{ width: 100, flex: "none" }} placeholder="Difficulty 0-100" value={form.difficulty} onChange={e => setForm(f => ({...f, difficulty: e.target.value}))} />
          </div>
          <div className="cs-form-row">
            <select className="cs-select" value={form.intent} onChange={e => setForm(f => ({...f, intent: e.target.value}))}>
              {["transactional","commercial","informational","navigational"].map(i => <option key={i} value={i}>{i}</option>)}
            </select>
            <select className="cs-select" value={form.trend} onChange={e => setForm(f => ({...f, trend: e.target.value}))}>
              {["rising","emerging","stable","declining"].map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <label className="cs-check-label">
              <input type="checkbox" checked={form.competitorGap} onChange={e => setForm(f => ({...f, competitorGap: e.target.checked}))} />
              Competitor Gap
            </label>
            <button className="cs-btn" onClick={add}>Add Keyword</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── MODULE 8: Brand Voice Engine ──────────────────────────────────────────────

function BrandVoicePanel() {
  const [voice,   reloadV] = useContent("/content/brand-voice");
  const [glossary, reloadG] = useContent("/content/brand-voice/glossary");
  const [view,     setView] = useState("voice");
  const [termForm, setTermForm] = useState({ term: "", definition: "", preferred: "", avoid: "" });
  const [checkText, setCheckText] = useState("");
  const [checkResult, setCheckResult] = useState(null);
  const [toast, Toast] = useToast();

  const addTerm = async () => {
    if (!termForm.term || !termForm.definition) return;
    await post("/content/brand-voice/glossary", termForm);
    setTermForm({ term: "", definition: "", preferred: "", avoid: "" });
    toast("Term added to glossary");
    reloadG();
  };

  const checkConsistency = async () => {
    if (!checkText) return;
    const r = await post("/content/brand-voice/check", { text: checkText });
    if (r.ok !== false) setCheckResult(r.result);
  };

  const bv = voice?.brandVoice;
  const gl = glossary?.glossary || [];

  return (
    <div>
      <div className="cs-sub-tabs">
        {["voice","glossary","checker"].map(v => (
          <button key={v} className={`cs-sub-tab${view === v ? " active" : ""}`} onClick={() => setView(v)}>
            {v === "voice" ? "Brand Rules" : v === "glossary" ? `Glossary (${gl.length})` : "Consistency Check"}
          </button>
        ))}
        {Toast}
      </div>

      {view === "voice" && bv && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="cs-card">
              <div className="cs-card-title">Tone & Personality</div>
              <div className="cs-kv-row"><span className="cs-kv-key">Tone</span><span className="cs-kv-val">{bv.tone}</span></div>
              <div className="cs-kv-row"><span className="cs-kv-key">POV Style</span><span className="cs-kv-val">{bv.povStyle}</span></div>
              <div className="cs-kv-row"><span className="cs-kv-key">Sentence Style</span><span className="cs-kv-val">{bv.sentenceStyle}</span></div>
              <div className="cs-sub-title" style={{ marginTop: 8 }}>Personality Traits</div>
              <div className="cs-tag-row">{(bv.personality || []).map(p => <Chip key={p} color="green">{p}</Chip>)}</div>
            </div>
            <div className="cs-card">
              <div className="cs-card-title">Word Rules</div>
              <div className="cs-sub-title">Preferred Words</div>
              <div className="cs-tag-row">{(bv.preferredWords || []).map(w => <Chip key={w} color="green">{w}</Chip>)}</div>
              <div className="cs-sub-title">Words to Avoid</div>
              <div className="cs-tag-row">{(bv.avoidWords || []).map(w => <Chip key={w} color="red">{w}</Chip>)}</div>
              <div className="cs-sub-title">Topics to Avoid</div>
              <div className="cs-tag-row">{(bv.avoid || []).map(a => <Chip key={a} color="red">{a}</Chip>)}</div>
            </div>
          </div>
          {bv.examples?.length > 0 && (
            <div className="cs-card" style={{ marginTop: 12 }}>
              <div className="cs-card-title">Voice Examples</div>
              {bv.examples.map((ex, i) => (
                <div key={i} className="cs-voice-example">
                  <div className="cs-voice-good"><span className="cs-voice-badge good">✓ Good</span> {ex.good}</div>
                  <div className="cs-voice-bad"><span className="cs-voice-badge bad">✗ Avoid</span> {ex.bad}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {view === "glossary" && (
        <div>
          <div className="cs-list">
            {gl.length === 0 && <div className="cs-empty">No glossary terms. Add brand-specific terminology.</div>}
            {gl.map((g, i) => (
              <div key={i} className="cs-row">
                <div style={{ flex: 1 }}>
                  <div className="cs-row-name">{g.term}</div>
                  <div className="cs-row-meta">{g.definition}</div>
                  {g.avoid && <div className="cs-row-meta">Avoid: <span style={{ color: "#ef4444" }}>{g.avoid}</span></div>}
                </div>
                <Chip color="green">✓ {g.preferred}</Chip>
              </div>
            ))}
          </div>
          <div className="cs-form" style={{ marginTop: 12 }}>
            <div className="cs-form-title">Add Term</div>
            <div className="cs-form-row">
              <input className="cs-input" placeholder="Term *" value={termForm.term} onChange={e => setTermForm(f => ({...f, term: e.target.value}))} />
              <input className="cs-input" placeholder="Preferred form" value={termForm.preferred} onChange={e => setTermForm(f => ({...f, preferred: e.target.value}))} />
              <input className="cs-input" placeholder="Words to avoid" value={termForm.avoid} onChange={e => setTermForm(f => ({...f, avoid: e.target.value}))} />
            </div>
            <div className="cs-form-row">
              <input className="cs-input" style={{ flex: 1 }} placeholder="Definition *" value={termForm.definition} onChange={e => setTermForm(f => ({...f, definition: e.target.value}))} />
              <button className="cs-btn" onClick={addTerm}>Add Term</button>
            </div>
          </div>
        </div>
      )}

      {view === "checker" && (
        <div>
          <div className="cs-form">
            <div className="cs-form-title">Brand Consistency Checker</div>
            <textarea className="cs-textarea" placeholder="Paste any copy — blog headline, ad text, social post, email subject — to check for brand voice violations…" value={checkText} onChange={e => setCheckText(e.target.value)} />
            <div className="cs-form-row" style={{ marginTop: 8 }}>
              <button className="cs-btn" onClick={checkConsistency} disabled={!checkText}>Check Consistency</button>
            </div>
          </div>
          {checkResult && (
            <div className="cs-card" style={{ marginTop: 12 }}>
              <div className="cs-stats-grid">
                <StatCard label="Brand Score" value={`${checkResult.score}/100`} accent={checkResult.score >= 80 ? "#22c55e" : "#ef4444"} />
                <StatCard label="Violations" value={checkResult.violations?.length || 0} accent={checkResult.violations?.length ? "#ef4444" : "#22c55e"} />
                <StatCard label="Suggestions" value={checkResult.suggestions?.length || 0} accent={checkResult.suggestions?.length ? "#f59e0b" : "#22c55e"} />
                <StatCard label="Passed" value={checkResult.passed ? "Yes" : "No"} accent={checkResult.passed ? "#22c55e" : "#ef4444"} />
              </div>
              {checkResult.violations?.length > 0 && (
                <>
                  <div className="cs-sub-title" style={{ color: "#ef4444" }}>Violations</div>
                  <div className="cs-list">
                    {checkResult.violations.map((v, i) => (
                      <div key={i} className="cs-row">
                        <span style={{ color: "#ef4444" }}>✗</span>
                        <span className="cs-row-name">{v.found}</span>
                        <span className="cs-row-meta">{v.suggestion}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {checkResult.suggestions?.length > 0 && (
                <>
                  <div className="cs-sub-title" style={{ color: "#f59e0b" }}>Terminology Suggestions</div>
                  <div className="cs-list">
                    {checkResult.suggestions.map((s, i) => (
                      <div key={i} className="cs-row">
                        <span style={{ color: "#f59e0b" }}>⚠</span>
                        <span className="cs-row-name">{s.found}</span>
                        <span>→</span>
                        <Chip color="green">{s.preferred}</Chip>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── MODULE 10: Commercial Benchmark ──────────────────────────────────────────

function BenchmarkPanel() {
  const [result,  setResult]  = useState(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    const r = await api("/content/benchmark");
    if (r.ok !== false) setResult(r);
    setRunning(false);
  };

  const READINESS_COLOR = { production_ready: "#22c55e", nearly_ready: "#f59e0b", needs_work: "#ef4444" };

  return (
    <div>
      <div className="cs-section-hdr">
        <span className="cs-section-title">Commercial Benchmark — G2 Content & SEO Engine</span>
        <button className="cs-btn" onClick={run} disabled={running}>{running ? "Running…" : "Run Benchmark"}</button>
      </div>
      <p className="cs-hint">Validates all 10 G2 modules: Blog Studio (5 article types), SEO Command (audit+clusters+schema), Repurposing (10 platforms), Landing Pages (SEO+conversion scores), Docs Generator (5 types), Content Calendar (planning+approval), Keyword Intelligence (10 built-in+scoring), Brand Voice (glossary+consistency checker), Content Dashboard (traffic projections), Organic Readiness.</p>

      {result && (
        <>
          <div className="cs-stats-grid" style={{ marginBottom: 16 }}>
            <StatCard label="Score"       value={`${result.score}%`}              accent={READINESS_COLOR[result.organicReadiness]} />
            <StatCard label="Passed"      value={`${result.passing}/${result.total}`} accent="#22c55e" />
            <StatCard label="Readiness"   value={result.organicReadiness?.replace(/_/g," ")} accent={READINESS_COLOR[result.organicReadiness]} />
            <StatCard label="Regression"  value={result.regressionPass ? "PASS" : "FAIL"} accent={result.regressionPass ? "#22c55e" : "#ef4444"} />
          </div>
          <div className="cs-list">
            {(result.checks || []).map(c => (
              <div key={c.id} className={`cs-row${c.ok ? "" : " cs-row-fail"}`}>
                <span style={{ color: c.ok ? "#22c55e" : "#ef4444", fontWeight: 700, flexShrink: 0 }}>{c.ok ? "✓" : "✗"}</span>
                <span className="cs-row-name" style={{ flex: 1 }}>{c.label}</span>
                {c.error && <span className="cs-row-meta" style={{ color: "#ef4444" }}>{c.error}</span>}
                <Chip color={c.ok ? "green" : "red"}>{c.ok ? "pass" : "fail"}</Chip>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export default function ContentSEO() {
  const [tab, setTab] = useState("dashboard");

  const panels = {
    dashboard: <DashboardPanel />,
    blog:      <BlogStudioPanel />,
    seo:       <SEOPanel />,
    repurpose: <RepurposePanel />,
    landing:   <LandingPagePanel />,
    docs:      <DocsPanel />,
    calendar:  <CalendarPanel />,
    keywords:  <KeywordsPanel />,
    brand:     <BrandVoicePanel />,
    benchmark: <BenchmarkPanel />,
  };

  return (
    <div className="cs-root">
      <div className="cs-header">
        <span className="cs-title">Growth OS — G2</span>
        <span className="cs-subtitle">Content & SEO Engine · Blog · SEO · Repurpose · Landing Pages · Docs · Calendar · Keywords · Brand Voice</span>
      </div>
      <div className="cs-tabs">
        {TABS.map(t => (
          <button key={t.id} className={`cs-tab${tab === t.id ? " active" : ""}`} onClick={() => setTab(t.id)}>
            <span className="cs-tab-icon">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>
      <div className="cs-content">
        {panels[tab]}
      </div>
    </div>
  );
}
