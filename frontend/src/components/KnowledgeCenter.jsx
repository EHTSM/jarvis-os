import React, { useState, useCallback, useRef } from "react";
import { track } from "../analytics";
import "./KnowledgeCenter.css";

// ── Persistence ───────────────────────────────────────────────────────
const DOCS_KEY = "ooplix_knowledge_docs";
const COLS_KEY = "ooplix_knowledge_collections";
const WEBS_KEY = "ooplix_knowledge_websites";

function _load(key, fb) {
  try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fb)); }
  catch { return fb; }
}
function _save(key, v) { localStorage.setItem(key, JSON.stringify(v)); }

// ── Icon by type ──────────────────────────────────────────────────────
function typeIcon(type) {
  if (type === "pdf")  return { icon: "PDF", color: "#e74c3c" };
  if (type === "docx") return { icon: "DOC", color: "#2980b9" };
  if (type === "pptx") return { icon: "PPT", color: "#e67e22" };
  if (type === "web")  return { icon: "WEB", color: "#27ae60" };
  return { icon: "TXT", color: "var(--text-faint)" };
}

// ── Seed documents ────────────────────────────────────────────────────
const SEED_DOCS = [
  { id: "d1", name: "Product Roadmap Q3 2026.pdf",        type: "pdf",  size: "840 KB", collection: "product",   added: "2026-05-10", status: "indexed",   chunks: 34, tags: ["roadmap","product"] },
  { id: "d2", name: "Ooplix Pitch Deck.pptx",             type: "pptx", size: "2.1 MB", collection: "sales",     added: "2026-05-12", status: "indexed",   chunks: 18, tags: ["pitch","sales"]     },
  { id: "d3", name: "Technical Architecture.docx",         type: "docx", size: "320 KB", collection: "engineering",added:"2026-05-14", status: "indexed",   chunks: 51, tags: ["architecture","dev"] },
  { id: "d4", name: "Operator Onboarding Guide.pdf",       type: "pdf",  size: "1.2 MB", collection: "support",   added: "2026-05-18", status: "indexed",   chunks: 62, tags: ["onboarding","guide"] },
  { id: "d5", name: "Sales Playbook 2026.docx",            type: "docx", size: "450 KB", collection: "sales",     added: "2026-05-20", status: "processing", chunks: 0, tags: ["sales","playbook"]   },
  { id: "d6", name: "Compliance & Legal FAQ.pdf",          type: "pdf",  size: "190 KB", collection: "legal",     added: "2026-06-01", status: "indexed",   chunks: 22, tags: ["legal","compliance"]  },
];

const SEED_WEBSITES = [
  { id: "w1", url: "https://ooplix.com",            title: "Ooplix Homepage",       status: "indexed", lastCrawl: "2026-06-03", pages: 12  },
  { id: "w2", url: "https://docs.ooplix.com",       title: "Ooplix Documentation",  status: "indexed", lastCrawl: "2026-06-03", pages: 84  },
  { id: "w3", url: "https://blog.ooplix.com",       title: "Ooplix Blog",           status: "indexed", lastCrawl: "2026-06-02", pages: 31  },
  { id: "w4", url: "https://help.ooplix.com",       title: "Help Center",           status: "stale",   lastCrawl: "2026-05-20", pages: 47  },
];

const SEED_COLLECTIONS = [
  { id: "c1", name: "product",     label: "Product",      color: "var(--accent)",  count: 0 },
  { id: "c2", name: "sales",       label: "Sales",        color: "var(--warning)", count: 0 },
  { id: "c3", name: "engineering", label: "Engineering",  color: "var(--accent2)", count: 0 },
  { id: "c4", name: "support",     label: "Support",      color: "#52d68a",        count: 0 },
  { id: "c5", name: "legal",       label: "Legal",        color: "var(--danger)",  count: 0 },
];

const SEARCH_RESULTS = [
  { doc: "Operator Onboarding Guide.pdf", chunk: "Step 3: Connect WhatsApp by scanning the QR code in the Contacts tab. This links your number to the automation engine and enables outbound messaging.", score: 0.97 },
  { doc: "Technical Architecture.docx",   chunk: "The message queue uses a priority-first FIFO model. High-priority follow-ups are dispatched within 60 seconds of scheduling regardless of current queue depth.", score: 0.89 },
  { doc: "Product Roadmap Q3 2026.pdf",   chunk: "Q3 milestone: native WhatsApp Business API integration (bypassing QR-based session). Targets enterprise accounts with volume requirements above 1,000 messages/day.", score: 0.82 },
];

// ── Sub-components ────────────────────────────────────────────────────
function DocRow({ doc, onDelete }) {
  const { icon, color } = typeIcon(doc.type);
  return (
    <div className="kc-doc-row">
      <span className="kc-doc-type-badge" style={{ background: color + "22", color }}>{icon}</span>
      <div className="kc-doc-info">
        <span className="kc-doc-name">{doc.name}</span>
        <span className="kc-doc-meta">{doc.size} · {doc.chunks ? `${doc.chunks} chunks` : "processing…"} · {doc.added}</span>
      </div>
      <div className="kc-doc-tags">
        {doc.tags.map(t => <span key={t} className="kc-tag">{t}</span>)}
      </div>
      <span className={`kc-status kc-status--${doc.status}`}>{doc.status}</span>
      <button className="kc-del-btn" onClick={() => onDelete(doc.id)} title="Remove">✕</button>
    </div>
  );
}

function AddDocModal({ collections, onAdd, onClose }) {
  const [name, setName] = useState("");
  const [type, setType] = useState("pdf");
  const [col,  setCol]  = useState(collections[0]?.name || "product");
  const [tags, setTags] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    onAdd({
      id: `d${Date.now()}`, name: name.trim(), type,
      size: "—", collection: col, added: new Date().toISOString().slice(0,10),
      status: "processing", chunks: 0,
      tags: tags.split(",").map(t=>t.trim()).filter(Boolean),
    });
  };

  return (
    <div className="kc-modal-overlay" onClick={onClose}>
      <div className="kc-modal" onClick={e => e.stopPropagation()}>
        <h3 className="kc-modal-title">Add document</h3>
        <form onSubmit={handleSubmit} className="kc-modal-form">
          <label className="kc-form-label">Document name / filename</label>
          <input className="kc-form-input" value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Product Brief Q3.pdf" autoFocus />
          <label className="kc-form-label">Type</label>
          <select className="kc-form-select" value={type} onChange={e=>setType(e.target.value)}>
            {["pdf","docx","pptx","txt"].map(t=><option key={t} value={t}>{t.toUpperCase()}</option>)}
          </select>
          <label className="kc-form-label">Collection</label>
          <select className="kc-form-select" value={col} onChange={e=>setCol(e.target.value)}>
            {collections.map(c=><option key={c.name} value={c.name}>{c.label}</option>)}
          </select>
          <label className="kc-form-label">Tags (comma-separated)</label>
          <input className="kc-form-input" value={tags} onChange={e=>setTags(e.target.value)} placeholder="roadmap, product, q3" />
          <div className="kc-modal-actions">
            <button type="button" className="kc-modal-cancel" onClick={onClose}>Cancel</button>
            <button type="submit" className="kc-modal-save">Add document</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────
export default function KnowledgeCenter({ onNavigate }) {
  const [section,     setSection]     = useState("library");
  const [docs,        setDocs]        = useState(() => _load(DOCS_KEY, SEED_DOCS));
  const [websites,    setWebsites]    = useState(() => _load(WEBS_KEY, SEED_WEBSITES));
  const [collections, setCollections] = useState(() => _load(COLS_KEY, SEED_COLLECTIONS));
  const [filterCol,   setFilterCol]   = useState("all");
  const [filterType,  setFilterType]  = useState("all");
  const [showAdd,     setShowAdd]     = useState(false);
  const [searchQ,     setSearchQ]     = useState("");
  const [searched,    setSearched]    = useState(false);
  const [newWebUrl,   setNewWebUrl]   = useState("");
  const [toast,       setToast]       = useState(null);

  React.useEffect(() => { track.event("knowledge_center_viewed"); }, []);

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(null), 2600); };

  const handleAddDoc = useCallback((doc) => {
    const next = [doc, ...docs];
    _save(DOCS_KEY, next); setDocs(next);
    setShowAdd(false); showToast("Document added");
  }, [docs]);

  const handleDelDoc = useCallback((id) => {
    const next = docs.filter(d => d.id !== id);
    _save(DOCS_KEY, next); setDocs(next); showToast("Removed");
  }, [docs]);

  const handleAddWeb = (e) => {
    e.preventDefault();
    if (!newWebUrl.trim()) return;
    const w = { id: `w${Date.now()}`, url: newWebUrl.trim(), title: newWebUrl.trim(), status: "queued", lastCrawl: "—", pages: 0 };
    const next = [w, ...websites];
    _save(WEBS_KEY, next); setWebsites(next); setNewWebUrl(""); showToast("Website queued for crawl");
  };

  const handleDelWeb = (id) => {
    const next = websites.filter(w => w.id !== id);
    _save(WEBS_KEY, next); setWebsites(next); showToast("Removed");
  };

  const visibleDocs = docs.filter(d =>
    (filterCol  === "all" || d.collection === filterCol) &&
    (filterType === "all" || d.type       === filterType)
  );

  // Health stats
  const indexed   = docs.filter(d => d.status === "indexed").length;
  const stale     = websites.filter(w => w.status === "stale").length;
  const totalChunks = docs.reduce((s,d) => s + (d.chunks || 0), 0);
  const totalPages  = websites.reduce((s,w) => s + w.pages, 0);

  return (
    <div className="knowledge-center page-enter">
      <div className="coming-soon-banner">
        <span className="csb-icon">◎</span>
        <div className="csb-body">
          <span className="csb-title">Knowledge Base Engine <span className="csb-beta-badge">BETA</span></span>
          <span className="csb-sub">Semantic search and real document indexing require the KnowledgeBaseEngine (not yet built). Documents and websites below are stored locally — they will sync to the backend engine when available.</span>
        </div>
      </div>
      {toast && <div className="kc-toast">{toast}</div>}
      {showAdd && <AddDocModal collections={collections} onAdd={handleAddDoc} onClose={() => setShowAdd(false)} />}

      <div className="kc-header">
        <div>
          <h1 className="kc-title">Knowledge Center</h1>
          <p className="kc-subtitle">PDF, DOCX, PPT, and website knowledge — indexed for semantic search.</p>
        </div>
        <button className="kc-add-btn" onClick={() => setShowAdd(true)}>+ Add document</button>
      </div>

      {/* Health strip */}
      <div className="kc-health-strip">
        {[
          { label: "Documents",     value: docs.length,    color: "var(--accent)"  },
          { label: "Indexed",       value: indexed,        color: "var(--success)" },
          { label: "Total chunks",  value: totalChunks,    color: "var(--accent2)" },
          { label: "Websites",      value: websites.length,color: "var(--warning)" },
          { label: "Pages crawled", value: totalPages,     color: "var(--accent)"  },
          { label: "Stale sources", value: stale,          color: stale > 0 ? "var(--danger)" : "var(--success)" },
        ].map(s => (
          <div key={s.label} className="kc-health-tile">
            <span className="kc-health-value" style={{ color: s.color }}>{s.value}</span>
            <span className="kc-health-label">{s.label}</span>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="kc-tabs">
        {[
          { id: "library",     label: "Document Library" },
          { id: "websites",    label: "Website Knowledge" },
          { id: "collections", label: "Collections"       },
          { id: "search",      label: "Semantic Search"   },
          { id: "health",      label: "Health"            },
        ].map(t => (
          <button key={t.id} className={`kc-tab${section === t.id ? " kc-tab--active" : ""}`} onClick={() => setSection(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="kc-content" key={section}>

        {/* Document Library */}
        {section === "library" && (
          <div className="kc-library">
            <div className="kc-filters">
              <div className="kc-filter-chips">
                <button className={`kc-chip${filterCol === "all" ? " kc-chip--active" : ""}`} onClick={() => setFilterCol("all")}>All</button>
                {collections.map(c => (
                  <button key={c.name} className={`kc-chip${filterCol === c.name ? " kc-chip--active" : ""}`}
                    style={filterCol === c.name ? { color: c.color, borderColor: c.color+"44" } : {}}
                    onClick={() => setFilterCol(c.name)}>{c.label}</button>
                ))}
              </div>
              <div className="kc-filter-chips">
                {["all","pdf","docx","pptx"].map(t => (
                  <button key={t} className={`kc-chip${filterType === t ? " kc-chip--active" : ""}`} onClick={() => setFilterType(t)}>
                    {t === "all" ? "All types" : t.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            {visibleDocs.length === 0 ? (
              <div className="kc-empty">
                <span className="kc-empty-icon">◎</span>
                <p className="kc-empty-title">No documents match this filter</p>
                <button className="kc-empty-cta" onClick={() => setShowAdd(true)}>Add document →</button>
              </div>
            ) : (
              <div className="kc-doc-list">
                {visibleDocs.map(d => <DocRow key={d.id} doc={d} onDelete={handleDelDoc} />)}
              </div>
            )}
          </div>
        )}

        {/* Website Knowledge */}
        {section === "websites" && (
          <div className="kc-websites">
            <form className="kc-web-add-form" onSubmit={handleAddWeb}>
              <input className="kc-web-input" value={newWebUrl} onChange={e=>setNewWebUrl(e.target.value)} placeholder="https://your-site.com" />
              <button type="submit" className="kc-web-add-btn">Crawl site →</button>
            </form>
            <div className="kc-web-list">
              {websites.map(w => (
                <div key={w.id} className={`kc-web-row kc-web-row--${w.status}`}>
                  <div className="kc-web-icon">◎</div>
                  <div className="kc-web-info">
                    <span className="kc-web-title">{w.title}</span>
                    <span className="kc-web-url">{w.url}</span>
                  </div>
                  <span className="kc-web-pages">{w.pages} pages</span>
                  <span className="kc-web-crawl">Last crawl: {w.lastCrawl}</span>
                  <span className={`kc-status kc-status--${w.status}`}>{w.status}</span>
                  <button className="kc-del-btn" onClick={() => handleDelWeb(w.id)}>✕</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Collections */}
        {section === "collections" && (
          <div className="kc-collections-grid">
            {collections.map(c => {
              const colDocs = docs.filter(d => d.collection === c.name);
              const colChunks = colDocs.reduce((s,d) => s + (d.chunks||0), 0);
              return (
                <div key={c.id} className="kc-col-card" style={{ borderColor: c.color + "33" }}>
                  <div className="kc-col-header">
                    <span className="kc-col-dot" style={{ background: c.color }} />
                    <span className="kc-col-name" style={{ color: c.color }}>{c.label}</span>
                  </div>
                  <div className="kc-col-stats">
                    <span className="kc-col-stat"><strong>{colDocs.length}</strong> docs</span>
                    <span className="kc-col-stat"><strong>{colChunks}</strong> chunks</span>
                  </div>
                  <div className="kc-col-types">
                    {["pdf","docx","pptx","web"].map(t => {
                      const cnt = colDocs.filter(d => d.type === t).length;
                      if (!cnt) return null;
                      const { icon, color: ic } = typeIcon(t);
                      return <span key={t} className="kc-col-type-chip" style={{ color: ic }}>{icon} {cnt}</span>;
                    })}
                  </div>
                  <button className="kc-col-view-btn" onClick={() => { setFilterCol(c.name); setSection("library"); }}>
                    View collection →
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Semantic Search */}
        {section === "search" && (
          <div className="kc-search-section">
            <div className="kc-search-bar">
              <span className="kc-search-icon">⌕</span>
              <input
                className="kc-search-input"
                value={searchQ}
                onChange={e => setSearchQ(e.target.value)}
                placeholder="Ask a question across your knowledge base…"
                onKeyDown={e => { if (e.key === "Enter" && searchQ.trim()) { setSearched(true); track.event("knowledge_search", { q: searchQ }); }}}
              />
              <button className="kc-search-btn" onClick={() => { if (searchQ.trim()) { setSearched(true); track.event("knowledge_search", { q: searchQ }); }}}>
                Search
              </button>
            </div>
            {!searched && (
              <div className="kc-search-hints">
                <p className="kc-search-hint-label">Example queries</p>
                {[
                  "How does the WhatsApp automation flow work?",
                  "What are the Q3 product milestones?",
                  "What is included in the enterprise plan?",
                  "How do I handle compliance requirements?",
                ].map(q => (
                  <button key={q} className="kc-search-hint" onClick={() => { setSearchQ(q); setSearched(true); }}>{q}</button>
                ))}
              </div>
            )}
            {searched && (
              <div className="kc-search-results">
                <p className="kc-results-label">{SEARCH_RESULTS.length} results for "{searchQ}"</p>
                {SEARCH_RESULTS.map((r, i) => (
                  <div key={i} className="kc-result-card">
                    <div className="kc-result-header">
                      <span className="kc-result-doc">{r.doc}</span>
                      <span className="kc-result-score" style={{ color: r.score > 0.9 ? "var(--success)" : "var(--accent2)" }}>
                        {Math.round(r.score * 100)}% match
                      </span>
                    </div>
                    <p className="kc-result-chunk">"{r.chunk}"</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Health dashboard */}
        {section === "health" && (
          <div className="kc-health-section">
            <div className="kc-health-cards">
              {[
                { label: "Index coverage",  value: `${docs.length ? Math.round((indexed/docs.length)*100) : 0}%`, ok: indexed === docs.length, detail: `${indexed}/${docs.length} docs indexed` },
                { label: "Stale websites",  value: stale, ok: stale === 0, detail: stale ? `${stale} site(s) need re-crawl` : "All sites current" },
                { label: "Processing queue", value: docs.filter(d=>d.status==="processing").length, ok: docs.filter(d=>d.status==="processing").length === 0, detail: "Documents being chunked" },
                { label: "Total knowledge", value: `${totalChunks} chunks`, ok: true, detail: `Across ${docs.length} docs + ${totalPages} web pages` },
              ].map(h => (
                <div key={h.label} className={`kc-hcard kc-hcard--${h.ok ? "ok" : "warn"}`}>
                  <span className="kc-hcard-icon">{h.ok ? "✓" : "⚠"}</span>
                  <span className="kc-hcard-label">{h.label}</span>
                  <span className="kc-hcard-value">{h.value}</span>
                  <span className="kc-hcard-detail">{h.detail}</span>
                </div>
              ))}
            </div>
            <p className="kc-health-note">
              Knowledge health reflects local index state. Connect a vector database (Pinecone, Weaviate, pgvector) for production-scale semantic search.
            </p>
          </div>
        )}

      </div>
    </div>
  );
}
