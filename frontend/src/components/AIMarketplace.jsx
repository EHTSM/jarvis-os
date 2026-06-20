import React, { useState, useEffect, useCallback } from "react";
import "./AIMarketplace.css";

const BASE = process.env.REACT_APP_API_URL || "";

const CAP_ICONS = {
  chat:       "💬", code:      "⌨", vision:    "👁",
  image:      "🎨", video:     "🎬", voice:     "🎙",
  browser:    "🌐", reasoning: "🧠", embeddings:"⬡",
  speech:     "🔊", music:     "🎵", animation: "✨", "3d": "⬡",
};

const CAP_COLORS = {
  chat:       "#7c6fff", code:      "#06b6d4", vision:    "#f59e0b",
  image:      "#f43f5e", video:     "#8b5cf6", voice:     "#10b981",
  browser:    "#3b82f6", reasoning: "#a855f7", embeddings:"#0ea5e9",
  speech:     "#84cc16", music:     "#ec4899", animation: "#f97316", "3d": "#14b8a6",
};

function CapBadge({ cap, size = "sm" }) {
  const color = CAP_COLORS[cap] || "#64748b";
  const icon  = CAP_ICONS[cap]  || "◈";
  return (
    <span className={`am-cap-badge am-cap-badge--${size}`} style={{ background: `${color}1a`, color, borderColor: `${color}40` }}>
      {icon} {cap}
    </span>
  );
}

function QualityBar({ value, color }) {
  return (
    <div className="am-quality-wrap">
      <div className="am-quality-bar" style={{ width: `${Math.round(value * 100)}%`, background: color || "#7c6fff" }} />
      <span className="am-quality-val">{Math.round(value * 100)}</span>
    </div>
  );
}

function LatencyDot({ cls }) {
  const colors = { fast: "#4ade80", medium: "#f59e0b", slow: "#f87171" };
  return <span className="am-latency-dot" style={{ background: colors[cls] || "#64748b" }} title={cls} />;
}

function CostChip({ cost }) {
  const label = cost === 0 ? "Free" : cost < 0.001 ? `$${(cost * 1000).toFixed(2)}/M` : `$${cost.toFixed(3)}/1K`;
  const color = cost === 0 ? "#4ade80" : cost < 0.002 ? "#06b6d4" : cost < 0.01 ? "#f59e0b" : "#f87171";
  return <span className="am-cost-chip" style={{ color }}>{label}</span>;
}

function ProviderCard({ provider, selectedCap }) {
  const cap = provider.capabilities?.[selectedCap];
  if (!cap) return null;
  const color = CAP_COLORS[selectedCap] || "#7c6fff";
  return (
    <div className="am-provider-card" style={{ "--cap-color": color }}>
      <div className="am-pcard-header">
        <span className="am-pcard-name">{provider.name}</span>
        <span className={`am-pcard-type am-pcard-type--${provider.type}`}>{provider.type}</span>
      </div>
      <div className="am-pcard-models">
        {(cap.models || []).slice(0, 2).map(m => (
          <span key={m} className="am-pcard-model">{m}</span>
        ))}
        {(cap.models || []).length > 2 && <span className="am-pcard-more">+{cap.models.length - 2}</span>}
      </div>
      <div className="am-pcard-meta">
        <QualityBar value={cap.quality || 0} color={color} />
        <LatencyDot cls={cap.latencyClass} />
        <CostChip cost={cap.costPer1k || 0} />
      </div>
      {cap.contextWindow && (
        <div className="am-pcard-ctx">{(cap.contextWindow / 1000).toFixed(0)}K ctx</div>
      )}
    </div>
  );
}

function CapabilitySection({ item, onSelect, selected }) {
  const color  = CAP_COLORS[item.capability] || "#7c6fff";
  const icon   = CAP_ICONS[item.capability]  || "◈";
  const active = selected === item.capability;

  return (
    <div className={`am-cap-section${active ? " am-cap-section--active" : ""}`}
         onClick={() => onSelect(active ? null : item.capability)}
         style={{ "--cap-color": color }}>
      <div className="am-cap-header">
        <span className="am-cap-icon">{icon}</span>
        <span className="am-cap-label">{item.capability}</span>
        <span className="am-cap-count">{item.providerCount} providers</span>
        {item.best && <CostChip cost={item.best.costPer1k || 0} />}
        <span className="am-cap-chevron">{active ? "▲" : "▼"}</span>
      </div>
      {active && (
        <div className="am-cap-providers">
          {item.providers.map(p => (
            <div key={p.id} className="am-cap-prov-row">
              <span className="am-cap-prov-name">{p.name}</span>
              <span className={`am-cap-prov-type am-cap-prov-type--${p.type}`}>{p.type}</span>
              <span className="am-cap-prov-model">{p.model}</span>
              <QualityBar value={p.quality || 0} color={color} />
              <LatencyDot cls={p.latencyClass} />
              <CostChip cost={p.costPer1k || 0} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RoutePanel() {
  const [intent, setIntent]  = useState("");
  const [result, setResult]  = useState(null);
  const [loading, setLoading]= useState(false);

  const route = async () => {
    if (!intent.trim()) return;
    setLoading(true);
    try {
      const r = await fetch(`${BASE}/ai-ecosystem/route`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent }),
      });
      setResult(await r.json());
    } catch (e) { setResult({ error: e.message }); }
    finally { setLoading(false); }
  };

  return (
    <div className="am-route-panel">
      <div className="am-route-label">Route a request</div>
      <div className="am-route-row">
        <input className="am-route-input" placeholder="e.g. Generate an image of a sunset, Write code to sort a list..."
          value={intent} onChange={e => setIntent(e.target.value)}
          onKeyDown={e => e.key === "Enter" && route()} />
        <button className="am-route-btn" onClick={route} disabled={loading || !intent.trim()}>
          {loading ? "…" : "Route →"}
        </button>
      </div>
      {result && !result.error && (
        <div className="am-route-result">
          <CapBadge cap={result.capability} />
          <span className="am-route-arrow">→</span>
          <span className="am-route-provider">{result.providerName || result.primary}</span>
          <span className="am-route-model">{result.model}</span>
          <span className="am-route-reason">{result.reason}</span>
        </div>
      )}
      {result?.error && <div className="am-route-error">{result.error}</div>}
    </div>
  );
}

const TABS = [
  { id: "explore",  label: "Explore" },
  { id: "featured", label: "Featured" },
  { id: "route",    label: "Route" },
  { id: "local",    label: "Local" },
  { id: "creative", label: "Creative" },
];

export default function AIMarketplace() {
  const [tab, setTab]         = useState("explore");
  const [catalogue, setCat]   = useState([]);
  const [featured, setFeat]   = useState({});
  const [local, setLocal]     = useState(null);
  const [creative, setCreative]= useState(null);
  const [selectedCap, setSelCap]= useState(null);
  const [search, setSearch]   = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [catR, featR] = await Promise.all([
        fetch(`${BASE}/ai-ecosystem/ui/catalogue`, { credentials: "include" }).then(r => r.json()),
        fetch(`${BASE}/ai-ecosystem/marketplace/featured`, { credentials: "include" }).then(r => r.json()),
      ]);
      if (catR.catalogue) setCat(catR.catalogue);
      if (featR.featured) setFeat(featR.featured);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  const loadLocal = useCallback(async () => {
    try {
      const r = await fetch(`${BASE}/ai-ecosystem/local/health`, { credentials: "include" });
      setLocal(await r.json());
    } catch (e) { setLocal({ error: e.message }); }
  }, []);

  const loadCreative = useCallback(async () => {
    try {
      const r = await fetch(`${BASE}/ai-ecosystem/creative`, { credentials: "include" });
      setCreative(await r.json());
    } catch (e) { setCreative({ error: e.message }); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (tab === "local") loadLocal(); }, [tab, loadLocal]);
  useEffect(() => { if (tab === "creative") loadCreative(); }, [tab, loadCreative]);

  const filtered = catalogue.filter(item =>
    !search || item.capability.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="am-root">
      <div className="am-header">
        <span className="am-title">AI Marketplace</span>
        <span className="am-subtitle">Capability-first</span>
        <input className="am-search" placeholder="Search capabilities…" value={search}
          onChange={e => setSearch(e.target.value)} />
        <button className="am-refresh-btn" onClick={load} disabled={loading}>{loading ? "…" : "↻"}</button>
      </div>

      <div className="am-tabs">
        {TABS.map(t => (
          <button key={t.id} className={`am-tab${tab === t.id ? " am-tab--active" : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {error && <div className="am-error">{error}</div>}

      {tab === "explore" && (
        <div className="am-panel">
          {filtered.map(item => (
            <CapabilitySection key={item.capability} item={item}
              selected={selectedCap} onSelect={setSelCap} />
          ))}
        </div>
      )}

      {tab === "featured" && (
        <div className="am-panel">
          <div className="am-featured-grid">
            {Object.entries(featured).map(([cap, m]) => m && (
              <div key={cap} className="am-featured-card" style={{ "--cap-color": CAP_COLORS[cap] || "#7c6fff" }}>
                <div className="am-feat-cap"><CapBadge cap={cap} size="md" /></div>
                <div className="am-feat-provider">{m.providerName}</div>
                <div className="am-feat-model">{m.modelId}</div>
                <div className="am-feat-row">
                  <QualityBar value={m.quality || 0} color={CAP_COLORS[cap]} />
                  <CostChip cost={m.costPer1kInput || 0} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "route" && (
        <div className="am-panel">
          <RoutePanel />
        </div>
      )}

      {tab === "local" && (
        <div className="am-panel">
          {!local && <div className="am-empty">Probing local runtimes…</div>}
          {local?.error && <div className="am-error">{local.error}</div>}
          {local?.runtimes && local.runtimes.map(rt => (
            <div key={rt.id} className={`am-local-rt${rt.running ? " am-local-rt--on" : ""}`}>
              <div className="am-local-rt-header">
                <span className={`am-local-dot${rt.running ? " am-local-dot--on" : ""}`} />
                <span className="am-local-name">{rt.name}</span>
                {rt.port && <span className="am-local-port">:{rt.port}</span>}
                <span className="am-local-status">{rt.running ? "running" : "offline"}</span>
              </div>
              {rt.running && (rt.models || []).length > 0 && (
                <div className="am-local-models">
                  {rt.models.map((m, i) => (
                    <span key={i} className="am-local-model">{m.name || m.id}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
          {local?.sysinfo && (
            <div className="am-sysinfo">
              <div className="am-sysinfo-row"><span>CPU</span><span>{local.sysinfo.cpuModel} ({local.sysinfo.cpuCores} cores)</span></div>
              <div className="am-sysinfo-row"><span>RAM</span><span>{local.sysinfo.freeMemGB}GB free / {local.sysinfo.totalMemGB}GB total</span></div>
              <div className="am-sysinfo-row"><span>Platform</span><span>{local.sysinfo.platform} {local.sysinfo.cpuArch}</span></div>
            </div>
          )}
        </div>
      )}

      {tab === "creative" && (
        <div className="am-panel">
          {!creative && <div className="am-empty">Loading creative capabilities…</div>}
          {creative?.providers && Object.entries(creative.providers).map(([cap, provs]) => (
            <div key={cap} className="am-creative-section">
              <div className="am-creative-header">
                <CapBadge cap={cap} size="md" />
                <span className="am-creative-count">{provs.length} providers</span>
              </div>
              <div className="am-creative-prov-list">
                {provs.map(p => (
                  <div key={p.id} className="am-creative-prov">
                    <span className="am-creative-prov-name">{p.name}</span>
                    <span className={`am-cap-prov-type am-cap-prov-type--${p.type}`}>{p.type}</span>
                    {p.capDef && <CostChip cost={p.capDef.costPer1k || 0} />}
                    {p.capDef && <LatencyDot cls={p.capDef.latencyClass} />}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
