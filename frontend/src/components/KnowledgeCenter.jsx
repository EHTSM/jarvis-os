import React, { useState, useEffect, useCallback } from "react";
import { track } from "../analytics";
import { _fetch } from "../_client";
import "./KnowledgeCenter.css";

// ── MASTER RESIDUAL CLOSURE (2026-08-15, C10-009) ──────────────────────────
// This file previously rendered an entirely fabricated document-library/
// website-crawler/vector-search UI: hardcoded seed documents ("Product
// Roadmap Q3 2026.pdf", fake chunk counts), hardcoded seed websites, and
// hardcoded semantic-search results — all persisted only to localStorage,
// zero network calls. It carried an honest "Coming Soon / BETA" banner for
// the vector-search half, but the document/website data itself was
// presented as real inventory.
//
// The real backend for "Knowledge" is genuinely different in kind:
// /org-graph/:orgId/* (orgKnowledgeGraph.cjs) is a real, tenant-isolated
// GRAPH of an org's own existing entities — CRM leads/opportunities/
// campaigns, connectors, automation rules, AI conversation history, and
// creative assets — with real impact analysis (what breaks if this node is
// removed). It is not a document upload/vector-search product; building
// that would be new architecture (document storage, PDF parsing, web
// crawling, embeddings) explicitly out of scope for a recovery pass.
//
// This rewrite surfaces the REAL graph: real per-type counts from a real
// /org-graph/:orgId/index + /org-graph/:orgId fetch, a real node browser,
// and real impact analysis on a selected node via
// /org-graph/:orgId/impact/:type/:id. No fabricated data of any kind — an
// org with nothing indexed yet sees an honest empty state, not invented
// documents. Tenant isolation is inherited directly from the real backend
// (orgKnowledgeGraph.cjs's own _assertMember + BELONGS_TO edge check,
// confirmed fixed for a real cross-tenant impact-analysis leak in an
// earlier pass today — see that file's own header comment).

const TYPE_LABELS = {
  lead: "Leads", opportunity: "Opportunities", campaign: "Campaigns",
  connector: "Connectors", automation_rule: "Automation Rules",
  ai_context: "AI Conversations", document: "Creative Assets",
};
const TYPE_COLORS = {
  lead: "var(--accent)", opportunity: "var(--warning)", campaign: "var(--accent2)",
  connector: "var(--success)", automation_rule: "var(--danger, var(--warning))",
  ai_context: "var(--accent)", document: "var(--accent2)",
};

function NodeRow({ type, node, onSelect, selected }) {
  const label = node.data?.name || node.data?.title || node.id;
  return (
    <button
      className={`kg-node-row${selected ? " kg-node-row--selected" : ""}`}
      onClick={() => onSelect(type, node.id)}
    >
      <span className="kg-node-dot" style={{ background: TYPE_COLORS[type] || "var(--text-dim)" }} />
      <span className="kg-node-label">{label}</span>
      <span className="kg-node-id">{node.id}</span>
    </button>
  );
}

export default function KnowledgeCenter({ onNavigate }) {
  const [orgId, setOrgId]         = useState(undefined); // undefined = loading, null = no org
  const [graph, setGraph]         = useState(null);
  const [loading, setLoading]     = useState(true);
  const [indexing, setIndexing]   = useState(false);
  const [error, setError]         = useState(null);
  const [filterType, setFilterType] = useState("all");
  const [selected, setSelected]   = useState(null); // { type, id }
  const [impact, setImpact]       = useState(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [impactError, setImpactError]     = useState(null);

  useEffect(() => { track.event("knowledge_center_viewed"); }, []);

  const loadGraph = useCallback((org) => {
    if (!org) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    _fetch(`/org-graph/${org}`).then(r => {
      if (r.ok === false) { setError(r.error || "Failed to load knowledge graph"); setGraph(null); }
      else setGraph(r);
    }).catch(e => setError(e.message || "Failed to load knowledge graph"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    _fetch("/orgs/me/context").then(r => {
      const id = r.ok !== false ? (r.primaryOrg?.orgId || null) : null;
      setOrgId(id);
      loadGraph(id);
    }).catch(() => { setOrgId(null); setLoading(false); });
  }, [loadGraph]);

  const handleReindex = useCallback(() => {
    if (!orgId) return;
    setIndexing(true);
    _fetch(`/org-graph/${orgId}/index`, { method: "POST" }).then(r => {
      if (r.ok === false) { setError(r.error || "Re-index failed"); return; }
      loadGraph(orgId);
      track.event("knowledge_reindex");
    }).catch(e => setError(e.message || "Re-index failed"))
      .finally(() => setIndexing(false));
  }, [orgId, loadGraph]);

  const handleSelect = useCallback((type, id) => {
    setSelected({ type, id });
    setImpact(null);
    setImpactError(null);
    setImpactLoading(true);
    _fetch(`/org-graph/${orgId}/impact/${type}/${encodeURIComponent(id)}`).then(r => {
      if (r.ok === false) { setImpactError(r.error || "Impact analysis unavailable"); return; }
      setImpact(r);
    }).catch(e => setImpactError(e.message || "Impact analysis unavailable"))
      .finally(() => setImpactLoading(false));
  }, [orgId]);

  const byType     = graph?.byType || {};
  const types      = Object.keys(byType);
  const totalNodes = graph?.totalNodes ?? 0;
  const visibleTypes = filterType === "all" ? types : types.filter(t => t === filterType);

  return (
    <div className="knowledge-center page-enter">
      <div className="kc-header">
        <div>
          <h1 className="kc-title">Knowledge Graph</h1>
          <p className="kc-subtitle">A real, tenant-scoped map of your organization's connected entities — leads, connectors, automations, AI conversations, and assets — with impact analysis.</p>
        </div>
        <button className="kc-add-btn" onClick={handleReindex} disabled={!orgId || indexing}>
          {indexing ? "Indexing…" : "Re-index now"}
        </button>
      </div>

      {orgId === null && (
        <div className="kc-empty">
          <span className="kc-empty-icon">◎</span>
          <p className="kc-empty-title">No organization context — join or create an organization to see your knowledge graph.</p>
        </div>
      )}

      {orgId && loading && (
        <div className="kc-empty">
          <span className="kc-empty-icon">◎</span>
          <p className="kc-empty-title">Loading your knowledge graph…</p>
        </div>
      )}

      {orgId && !loading && error && (
        <div className="kc-empty kc-empty--error">
          <span className="kc-empty-icon">⚠</span>
          <p className="kc-empty-title">{error}</p>
        </div>
      )}

      {orgId && !loading && !error && graph && (
        <>
          {/* Health strip — real counts only */}
          <div className="kc-health-strip">
            <div className="kc-health-tile">
              <span className="kc-health-value" style={{ color: "var(--accent)" }}>{totalNodes}</span>
              <span className="kc-health-label">Indexed entities</span>
            </div>
            {types.map(t => (
              <div key={t} className="kc-health-tile">
                <span className="kc-health-value" style={{ color: TYPE_COLORS[t] || "var(--text-dim)" }}>{byType[t].length}</span>
                <span className="kc-health-label">{TYPE_LABELS[t] || t}</span>
              </div>
            ))}
          </div>

          {totalNodes === 0 ? (
            <div className="kc-empty">
              <span className="kc-empty-icon">◎</span>
              <p className="kc-empty-title">Nothing indexed yet</p>
              <p className="kc-empty-sub">Your organization has no CRM records, connectors, automations, AI conversations, or assets indexed. Add some, then re-index — or re-index now if you believe this is stale.</p>
              <button className="kc-empty-cta" onClick={handleReindex} disabled={indexing}>{indexing ? "Indexing…" : "Re-index now →"}</button>
            </div>
          ) : (
            <div className="kc-graph-layout">
              <div className="kc-graph-browser">
                <div className="kc-filters">
                  <div className="kc-filter-chips">
                    <button className={`kc-chip${filterType === "all" ? " kc-chip--active" : ""}`} onClick={() => setFilterType("all")}>All</button>
                    {types.map(t => (
                      <button key={t} className={`kc-chip${filterType === t ? " kc-chip--active" : ""}`}
                        style={filterType === t ? { color: TYPE_COLORS[t], borderColor: (TYPE_COLORS[t] || "") + "44" } : {}}
                        onClick={() => setFilterType(t)}>{TYPE_LABELS[t] || t}</button>
                    ))}
                  </div>
                </div>
                <div className="kg-node-list">
                  {visibleTypes.map(t => byType[t].map(n => (
                    <NodeRow key={`${t}:${n.id}`} type={t} node={n} onSelect={handleSelect}
                      selected={selected?.type === t && selected?.id === n.id} />
                  )))}
                </div>
              </div>

              <div className="kg-impact-panel">
                {!selected && (
                  <div className="kc-empty">
                    <span className="kc-empty-icon">◎</span>
                    <p className="kc-empty-title">Select an entity to see what depends on it</p>
                  </div>
                )}
                {selected && impactLoading && (
                  <div className="kc-empty"><p className="kc-empty-title">Analyzing impact…</p></div>
                )}
                {selected && !impactLoading && impactError && (
                  <div className="kc-empty kc-empty--error"><p className="kc-empty-title">{impactError}</p></div>
                )}
                {selected && !impactLoading && impact && (
                  <div className="kg-impact-content">
                    <h3 className="kg-impact-title">Impact of {selected.type}/{selected.id}</h3>
                    <p className="kg-impact-count">{impact.affectedCount ?? 0} connected entities</p>
                    {Object.entries(impact.affected || {}).map(([t, nodes]) => nodes.length > 0 && (
                      <div key={t} className="kg-impact-group">
                        <span className="kg-impact-group-label" style={{ color: TYPE_COLORS[t] || "var(--text-dim)" }}>{TYPE_LABELS[t] || t}</span>
                        <ul className="kg-impact-list">
                          {nodes.map(n => <li key={n.id}>{n.data?.name || n.data?.title || n.id}</li>)}
                        </ul>
                      </div>
                    ))}
                    {(!impact.affected || Object.values(impact.affected).every(a => a.length === 0)) && (
                      <p className="kg-impact-none">Nothing else in the graph depends on this entity.</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
