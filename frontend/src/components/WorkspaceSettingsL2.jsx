import React, { useState, useEffect, useCallback } from "react";
import { _fetch } from "../_client";

// ── L2 Marketplace Panels ─────────────────────────────────────────
const STAR_COLOR = "#f5a623";

function StarRating({ rating }) {
  const full  = Math.floor(rating);
  const half  = rating - full >= 0.5 ? 1 : 0;
  const empty = 5 - full - half;
  return (
    <span className="l2-stars" title={`${rating}/5`}>
      {"★".repeat(full)}{"½".repeat(half)}{"☆".repeat(empty)}
    </span>
  );
}

function PluginCard({ plugin, onInstall, onDetail }) {
  return (
    <div className="l2-card" onClick={() => onDetail?.(plugin)}>
      <div className="l2-card-header">
        <span className="l2-card-name">{plugin.name}</span>
        <div className="l2-card-badges">
          {plugin.verified && <span className="l2-badge l2-badge--verified">✓ Verified</span>}
          {plugin.installed && <span className="l2-badge l2-badge--installed">Installed</span>}
        </div>
      </div>
      <span className="l2-card-author">{plugin.author} · v{plugin.version}</span>
      <p className="l2-card-desc">{plugin.description}</p>
      <div className="l2-card-caps">
        {(plugin.capabilities || []).slice(0, 3).map(c => (
          <span key={c} className="l1-cap-chip">{c}</span>
        ))}
        {plugin.capabilities?.length > 3 && <span className="l2-cap-more">+{plugin.capabilities.length - 3}</span>}
      </div>
      <div className="l2-card-footer">
        <div className="l2-card-meta">
          <StarRating rating={plugin.rating || 0} />
          <span className="l2-card-rating">{plugin.rating}</span>
          <span className="l2-card-installs">{(plugin.installCount || 0).toLocaleString()} installs</span>
        </div>
        {!plugin.installed && (
          <button className="k2-form-btn" style={{ padding: "4px 14px", fontSize: 11 }}
            onClick={e => { e.stopPropagation(); onInstall?.(plugin); }}>
            Install
          </button>
        )}
      </div>
    </div>
  );
}

function PluginDetail({ plugin, onClose, onInstall }) {
  const [reviews, setReviews] = useState([]);
  const [changelog, setChangelog] = useState([]);
  const [newRating, setNewRating] = useState(5);
  const [newBody, setNewBody] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!plugin) return;
    _fetch(`/marketplace/plugin/${plugin.id}`).then(r => {
      setReviews(r.plugin?.reviews || []);
    }).catch(() => {});
    _fetch(`/marketplace/changelog/${plugin.id}`).then(r => {
      setChangelog(r.changelog || []);
    }).catch(() => {});
  }, [plugin?.id]);

  const submitReview = async () => {
    if (!newBody.trim()) return;
    setSubmitting(true);
    await _fetch(`/marketplace/plugin/${plugin.id}/review`, {
      method: "POST",
      body: JSON.stringify({ rating: newRating, body: newBody }),
    }).catch(() => {});
    setNewBody(""); setSubmitting(false);
    _fetch(`/marketplace/plugin/${plugin.id}`).then(r => setReviews(r.plugin?.reviews || [])).catch(() => {});
  };

  if (!plugin) return null;
  return (
    <div className="ws-modal-overlay" onClick={onClose}>
      <div className="ws-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 600, maxHeight: "85vh", overflowY: "auto" }}>
        <div className="l2-detail-header">
          <div>
            <div className="l2-detail-name">{plugin.name}</div>
            <div className="l2-detail-meta">{plugin.author} · v{plugin.version} · {plugin.category}</div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {plugin.verified && <span className="l2-badge l2-badge--verified">✓ Verified</span>}
            {!plugin.installed && <button className="k2-form-btn" onClick={() => onInstall?.(plugin)}>Install</button>}
            {plugin.installed && <span className="l2-badge l2-badge--installed">Installed</span>}
            <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-faint)", cursor: "pointer", fontSize: 18 }}>✕</button>
          </div>
        </div>
        <p className="l2-detail-desc">{plugin.description}</p>

        <div className="k5-form-section-label" style={{ marginTop: 12 }}>Capabilities</div>
        <div className="l1-caps" style={{ marginBottom: 10 }}>
          {(plugin.capabilities || []).map(c => <span key={c} className="l1-cap-chip">{c}</span>)}
        </div>

        <div className="k5-form-section-label">Permissions Required</div>
        <div className="l1-caps" style={{ marginBottom: 10 }}>
          {(plugin.permissions || []).map(p => <span key={p} className="l2-perm-chip">{p}</span>)}
        </div>

        {changelog.length > 0 && (
          <>
            <div className="k5-form-section-label">Changelog</div>
            <div className="l2-changelog">
              {changelog.map(c => (
                <div key={c.version} className="l2-changelog-row">
                  <span className="l2-cl-ver">v{c.version}</span>
                  <span className="l2-cl-date">{c.date}</span>
                  <span className="l2-cl-notes">{c.notes}</span>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="k5-form-section-label" style={{ marginTop: 12 }}>Reviews ({reviews.length})</div>
        {reviews.length === 0 ? (
          <div className="k2-empty" style={{ fontSize: 12 }}>No reviews yet.</div>
        ) : reviews.map(r => (
          <div key={r.id} className="l2-review-row">
            <div className="l2-review-header">
              <StarRating rating={r.rating} />
              <span className="l2-review-author">{r.author}</span>
              <span className="l2-review-ts">{new Date(r.ts).toLocaleDateString()}</span>
            </div>
            <p className="l2-review-body">{r.body}</p>
          </div>
        ))}

        <div className="k5-form-section-label" style={{ marginTop: 12 }}>Write a Review</div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
          {[1,2,3,4,5].map(n => (
            <button key={n} onClick={() => setNewRating(n)}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: n <= newRating ? STAR_COLOR : "var(--border)" }}>★</button>
          ))}
          <span className="l2-card-rating">{newRating}/5</span>
        </div>
        <textarea className="k2-form-input" rows={3} placeholder="Share your experience…"
          value={newBody} onChange={e => setNewBody(e.target.value)}
          style={{ resize: "vertical", minHeight: 64 }} />
        <button className="k2-form-btn" style={{ marginTop: 6 }} disabled={submitting || !newBody.trim()} onClick={submitReview}>
          {submitting ? "Submitting…" : "Submit Review"}
        </button>
      </div>
    </div>
  );
}

function useMarketplaceInstall(reload) {
  const [installing, setInstalling] = useState(null);
  const doInstall = async (plugin) => {
    setInstalling(plugin.id);
    try {
      await _fetch("/plugins/install", {
        method: "POST",
        body: JSON.stringify({
          id: plugin.id, name: plugin.name, version: plugin.version,
          description: plugin.description, author: plugin.author,
          capabilities: plugin.capabilities, permissions: plugin.permissions,
          dependencies: plugin.dependencies, category: plugin.category,
          tags: plugin.tags, minSDKVersion: plugin.minSDKVersion || "1.0.0",
        }),
      });
    } catch {}
    setInstalling(null);
    reload?.();
  };
  return { installing, doInstall };
}

function MarketplaceCatalogPanel() {
  const [data,      setData]      = useState(null);
  const [cats,      setCats]      = useState([]);
  const [activeCat, setActiveCat] = useState("all");
  const [loading,   setLoading]   = useState(true);
  const [detail,    setDetail]    = useState(null);

  const reload = useCallback(() => {
    const url = activeCat && activeCat !== "all" ? `/marketplace/catalog?category=${activeCat}` : "/marketplace/catalog";
    _fetch(url).then(r => setData(r)).catch(() => {}).finally(() => setLoading(false));
  }, [activeCat]);

  useEffect(() => {
    _fetch("/marketplace/categories").then(r => setCats(r.categories || [])).catch(() => {});
  }, []);
  useEffect(() => { setLoading(true); reload(); }, [reload]);

  const { installing, doInstall } = useMarketplaceInstall(reload);

  if (loading) return <div className="k2-loading">Loading marketplace…</div>;

  return (
    <div className="l2-panel">
      <div className="l2-cat-bar">
        {cats.map(c => (
          <button key={c.id} className={`l2-cat-btn${activeCat === c.id ? " l2-cat-btn--active" : ""}`}
            onClick={() => setActiveCat(c.id)}>
            {c.icon} {c.label} <span className="l2-cat-count">{c.count}</span>
          </button>
        ))}
      </div>
      {(!data?.plugins?.length) ? (
        <div className="k2-empty">No plugins in this category.</div>
      ) : (
        <div className="l2-grid">
          {data.plugins.map(p => (
            <PluginCard key={p.id} plugin={{ ...p, installing: installing === p.id }}
              onInstall={doInstall} onDetail={setDetail} />
          ))}
        </div>
      )}
      {detail && <PluginDetail plugin={detail} onClose={() => setDetail(null)} onInstall={p => { doInstall(p); setDetail(null); }} />}
    </div>
  );
}

function MarketplaceFeaturedPanel() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [detail,  setDetail]  = useState(null);

  const reload = () => {
    setLoading(true);
    _fetch("/marketplace/featured").then(r => setData(r)).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(reload, []);
  const { installing, doInstall } = useMarketplaceInstall(reload);

  if (loading) return <div className="k2-loading">Loading featured plugins…</div>;
  return (
    <div className="l2-panel">
      <div className="l2-grid">
        {(data?.plugins || []).map(p => (
          <PluginCard key={p.id} plugin={{ ...p, installing: installing === p.id }}
            onInstall={doInstall} onDetail={setDetail} />
        ))}
      </div>
      {detail && <PluginDetail plugin={detail} onClose={() => setDetail(null)} onInstall={p => { doInstall(p); setDetail(null); }} />}
    </div>
  );
}

function MarketplaceSearchPanel() {
  const [query,   setQuery]   = useState("");
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [detail,  setDetail]  = useState(null);

  const doSearch = useCallback(() => {
    if (!query.trim()) { setResults(null); return; }
    setLoading(true);
    _fetch(`/marketplace/search?q=${encodeURIComponent(query)}`).then(r => setResults(r)).catch(() => setResults(null)).finally(() => setLoading(false));
  }, [query]);

  useEffect(() => {
    const t = setTimeout(doSearch, 300);
    return () => clearTimeout(t);
  }, [doSearch]);

  const { installing, doInstall } = useMarketplaceInstall(() => doSearch());

  return (
    <div className="l2-panel">
      <input className="k2-form-input" placeholder="Search by name, capability, tag, author…"
        value={query} onChange={e => setQuery(e.target.value)} autoFocus />
      {loading && <div className="k2-loading">Searching…</div>}
      {!loading && results && results.total === 0 && <div className="k2-empty">No results for "{query}".</div>}
      {!loading && results?.plugins?.length > 0 && (
        <>
          <div className="l2-search-meta">{results.total} result{results.total !== 1 ? "s" : ""} for "{results.query}"</div>
          <div className="l2-grid">
            {results.plugins.map(p => (
              <PluginCard key={p.id} plugin={{ ...p, installing: installing === p.id }}
                onInstall={doInstall} onDetail={setDetail} />
            ))}
          </div>
        </>
      )}
      {!query && <div className="k2-empty">Start typing to search the marketplace.</div>}
      {detail && <PluginDetail plugin={detail} onClose={() => setDetail(null)} onInstall={p => { doInstall(p); setDetail(null); }} />}
    </div>
  );
}

function MarketplaceRecsPanel() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [detail,  setDetail]  = useState(null);

  const reload = () => {
    setLoading(true);
    _fetch("/marketplace/recommendations").then(r => setData(r)).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(reload, []);
  const { installing, doInstall } = useMarketplaceInstall(reload);

  if (loading) return <div className="k2-loading">Computing recommendations…</div>;

  return (
    <div className="l2-panel">
      {(!data?.recommendations?.length) ? (
        <div className="k2-empty">All recommended plugins are already installed — great coverage!</div>
      ) : (
        <div className="l2-grid">
          {data.recommendations.map(p => (
            <div key={p.id}>
              {p.newCapabilities?.length > 0 && (
                <div className="l2-rec-badge">Adds: {p.newCapabilities.slice(0,3).join(", ")}</div>
              )}
              <PluginCard plugin={{ ...p, installing: installing === p.id }}
                onInstall={doInstall} onDetail={setDetail} />
            </div>
          ))}
        </div>
      )}
      {detail && <PluginDetail plugin={detail} onClose={() => setDetail(null)} onInstall={p => { doInstall(p); setDetail(null); }} />}
    </div>
  );
}


export { StarRating, PluginCard, PluginDetail, useMarketplaceInstall, MarketplaceCatalogPanel, MarketplaceFeaturedPanel, MarketplaceSearchPanel, MarketplaceRecsPanel };
