import React, { useState, useEffect, useCallback } from "react";
import { track } from "../analytics";
import "./MarketplaceCenter.css";

const BASE = process.env.REACT_APP_API_URL || "";

async function get(path) {
  const r = await fetch(`${BASE}${path}`, { credentials: "include" });
  return r.json();
}
async function post(path, body = {}) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  return r.json();
}

const TAG_COLORS = { verified: "var(--accent2)", featured: "var(--success)" };

function ItemCard({ item, installed, installing, onInstall }) {
  return (
    <div className="mc-item-card">
      <div className="mc-item-header">
        <div className="mc-item-title-row">
          <span className="mc-item-name">{item.name}</span>
          {item.verified && <span className="mc-item-tag" style={{ color: TAG_COLORS.verified, borderColor: TAG_COLORS.verified + "33" }}>verified</span>}
          {item.featured && <span className="mc-item-tag" style={{ color: TAG_COLORS.featured, borderColor: TAG_COLORS.featured + "33" }}>featured</span>}
        </div>
        <span className="mc-item-author">by {item.author || "Unknown"}</span>
      </div>
      <p className="mc-item-desc">{item.description}</p>
      <div className="mc-item-footer">
        <span className="mc-item-stat"><span className="mc-item-sv">{(item.installCount || 0).toLocaleString("en-IN")}</span> installs</span>
        <span className="mc-item-stat"><span className="mc-item-sv" style={{ color: "var(--warning)" }}>{"★".repeat(Math.round(item.rating || 0))}</span> {item.rating ?? "—"}</span>
        <button className="mc-item-btn" disabled={installed || installing} onClick={() => onInstall(item)}>
          {installed ? "Installed" : installing ? "Installing…" : "Install"}
        </button>
      </div>
    </div>
  );
}

export default function MarketplaceCenter({ onNavigate }) {
  const [category, setCategory] = useState("all");
  const [search, setSearch]     = useState("");
  const [categories, setCategories] = useState([{ id: "all", label: "All", count: 0 }]);
  const [items, setItems]       = useState([]);
  const [installedIds, setInstalledIds] = useState(new Set());
  const [installingId, setInstallingId] = useState(null);
  const [loading, setLoading]   = useState(true);
  const [toast, setToast]       = useState(null);

  useEffect(() => { track.event("marketplace_viewed"); }, []);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cats, catalog] = await Promise.all([
        get("/marketplace/categories"),
        search.trim()
          ? get(`/marketplace/search?q=${encodeURIComponent(search)}${category !== "all" ? `&category=${category}` : ""}`)
          : get(`/marketplace/catalog${category !== "all" ? `?category=${category}` : ""}`),
      ]);
      if (Array.isArray(cats?.categories)) setCategories(cats.categories);
      const plugins = catalog?.plugins || [];
      setItems(plugins);
      setInstalledIds(new Set(plugins.filter(p => p.installed).map(p => p.id)));
    } catch {
      showToast("Marketplace unavailable — check server connection");
    } finally {
      setLoading(false);
    }
  }, [category, search, showToast]);

  useEffect(() => { load(); }, [load]);

  const handleInstall = useCallback(async (item) => {
    setInstallingId(item.id);
    track.event("marketplace_install", { id: item.id });
    try {
      const res = await post("/plugins/install", {
        id: item.id, name: item.name, version: item.version || "1.0.0",
        description: item.description, author: item.author || "Unknown",
        capabilities: item.capabilities || [],
      });
      if (res?.error) {
        showToast(res.error.includes("already installed") ? `${item.name} is already installed` : `Install failed: ${res.error}`);
      } else {
        setInstalledIds(prev => new Set([...prev, item.id]));
        showToast(`${item.name} installed`);
      }
    } catch {
      showToast("Install failed — check server connection");
    } finally {
      setInstallingId(null);
    }
  }, [showToast]);

  const totalCount = categories.find(c => c.id === "all")?.count || 0;

  return (
    <div className="marketplace-center page-enter">
      {toast && <div className="mc-toast">{toast}</div>}

      <div className="mc-header">
        <div>
          <h1 className="mc-title">Marketplace</h1>
          <p className="mc-subtitle">Browse and install plugins — capabilities, ratings, and reviews from the live catalog.</p>
        </div>
      </div>

      <div className="mc-summary-strip">
        {categories.filter(c => c.id !== "all").map(c => (
          <div key={c.id} className="mc-summary-tile">
            <span className="mc-sv">{c.count}</span>
            <span className="mc-sl">{c.label}</span>
          </div>
        ))}
        <div className="mc-summary-tile">
          <span className="mc-sv" style={{ color: "var(--warning)" }}>{totalCount}</span>
          <span className="mc-sl">Total plugins</span>
        </div>
      </div>

      <div className="mc-search-bar">
        <input
          className="mc-search-input"
          placeholder="Search marketplace…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {search && <button className="mc-search-clear" onClick={() => setSearch("")}>✕</button>}
      </div>

      <div className="mc-tabs">
        {categories.map(c => (
          <button key={c.id} className={`mc-tab${category === c.id ? " mc-tab--active" : ""}`} onClick={() => setCategory(c.id)}>
            {c.label}
            <span className="mc-tab-count">{c.count}</span>
          </button>
        ))}
      </div>

      <div className="mc-content">
        {loading ? (
          <div className="mc-empty">Loading…</div>
        ) : items.length === 0 ? (
          <div className="mc-empty">{search ? `No results for "${search}"` : "No plugins in this category yet."}</div>
        ) : (
          <div className="mc-grid">
            {items.map(item => (
              <ItemCard
                key={item.id}
                item={item}
                installed={installedIds.has(item.id)}
                installing={installingId === item.id}
                onInstall={handleInstall}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
