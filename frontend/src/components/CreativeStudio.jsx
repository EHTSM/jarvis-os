import React, { useState, useEffect, useCallback, useRef } from "react";
import "./CreativeStudio.css";

const BASE = process.env.REACT_APP_API_URL || "";

// ── Icons (text-based, no dependencies) ────────────────────────────
const ICONS = {
  image:   "◻",
  video:   "▶",
  voice:   "♫",
  brand:   "◈",
  social:  "◎",
  assets:  "⬢",
  workspace:"⬡",
  bench:   "◐",
};

const CAP_ICONS = {
  image_generate:       "✦",
  image_edit:           "✎",
  image_upscale:        "↑",
  background_remove:    "⊘",
  text_to_video:        "▶",
  image_to_video:       "⟳",
  voice_clone:          "♪",
  text_to_speech:       "♫",
  speech_to_text:       "◑",
  music_generate:       "♩",
  animation_generate:   "⚙",
  presentation_generate:"□",
  logo_generate:        "◈",
  banner_generate:      "▬",
  ad_generate:          "★",
};

const PLATFORMS = ["instagram","facebook","linkedin","pinterest","x","youtube","threads","blog","email","ads"];

async function apiPost(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function apiGet(path) {
  const r = await fetch(`${BASE}${path}`, { credentials: "include" });
  return r.json();
}

export default function CreativeStudio() {
  const [tab, setTab]         = useState("workspace");
  const [workspace, setWS]    = useState(null);
  const [caps, setCaps]       = useState([]);
  const [benchData, setBench] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const loadWorkspace = useCallback(async () => {
    try {
      const [ws, cr] = await Promise.all([
        apiGet("/creative/workspace"),
        apiGet("/creative/registry"),
      ]);
      if (ws.ok) setWS(ws);
      if (cr.ok) setCaps(cr.capabilities || []);
    } catch { setError("Failed to load workspace"); }
  }, []);

  useEffect(() => { loadWorkspace(); }, [loadWorkspace]);
  useEffect(() => { if (tab === "bench" && !benchData) loadBenchmark(); }, [tab]);

  async function loadBenchmark() {
    setLoading(true);
    try {
      const r = await apiGet("/creative/benchmark");
      if (r.ok) setBench(r);
    } catch { setError("Benchmark failed"); }
    finally { setLoading(false); }
  }

  const TABS = [
    { id: "workspace", label: "Workspace",   icon: ICONS.workspace },
    { id: "image",     label: "Images",      icon: ICONS.image },
    { id: "video",     label: "Video",       icon: ICONS.video },
    { id: "voice",     label: "Voice",       icon: ICONS.voice },
    { id: "brand",     label: "Brand",       icon: ICONS.brand },
    { id: "social",    label: "Social",      icon: ICONS.social },
    { id: "assets",    label: "Assets",      icon: ICONS.assets },
    { id: "bench",     label: "Benchmark",   icon: ICONS.bench },
  ];

  return (
    <div className="cs-root">
      <div className="cs-header">
        <h2 className="cs-title">Creative Studio</h2>
        <div className="cs-sub">AI Creative Operating System</div>
        <button className="cs-refresh" onClick={loadWorkspace} disabled={loading}>↻</button>
      </div>

      <div className="cs-tabs">
        {TABS.map(t => (
          <button key={t.id} className={`cs-tab${tab === t.id ? " active" : ""}`} onClick={() => setTab(t.id)}>
            <span className="cs-tab-icon">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {error && <div className="cs-error">{error} <button onClick={() => setError(null)}>✕</button></div>}

      <div className="cs-panel">
        {tab === "workspace" && <WorkspacePanel ws={workspace} caps={caps} />}
        {tab === "image"     && <ImageStudio onComplete={loadWorkspace} />}
        {tab === "video"     && <VideoStudio onComplete={loadWorkspace} />}
        {tab === "voice"     && <VoiceStudio onComplete={loadWorkspace} />}
        {tab === "brand"     && <BrandPanel onComplete={loadWorkspace} />}
        {tab === "social"    && <SocialPanel onComplete={loadWorkspace} />}
        {tab === "assets"    && <AssetsPanel />}
        {tab === "bench"     && <BenchPanel bench={benchData} onRun={loadBenchmark} loading={loading} />}
      </div>
    </div>
  );
}

// ── Workspace ─────────────────────────────────────────────────────

function WorkspacePanel({ ws, caps }) {
  if (!ws) return <div className="cs-empty">Loading workspace…</div>;
  return (
    <div className="cs-workspace">
      <div className="cs-stats-row">
        {statCard("Total Assets",   ws.assets?.total    || 0, "in library")}
        {statCard("Favorites",      ws.assets?.favorites || 0, "saved")}
        {statCard("Collections",    ws.assets?.folders   || 0, "folders")}
        {statCard("Jobs Running",   ws.jobs?.running     || 0, "active")}
        {statCard("Jobs Complete",  ws.jobs?.complete    || 0, "done")}
        {statCard("Brand Kits",     (ws.brandKits || []).length, "kits")}
      </div>

      {ws.recentJobs?.length > 0 && (
        <div className="cs-section">
          <div className="cs-section-title">Recent Jobs</div>
          <div className="cs-job-list">
            {ws.recentJobs.map(j => (
              <div key={j.id} className="cs-job-card">
                <div className="cs-job-cap">{CAP_ICONS[j.capability] || "◻"} {j.capability?.replace(/_/g," ")}</div>
                <div className="cs-job-prompt">{(j.prompt || "").slice(0, 60)}</div>
                <div className="cs-job-meta">
                  <span className={`cs-badge ${j.status}`}>{j.status}</span>
                  <span className="cs-job-time">{j.createdAt ? new Date(j.createdAt).toLocaleTimeString() : ""}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {ws.recentAssets?.length > 0 && (
        <div className="cs-section">
          <div className="cs-section-title">Recent Assets</div>
          <div className="cs-asset-grid">
            {ws.recentAssets.map(a => (
              <div key={a.id} className="cs-asset-thumb">
                <div className="cs-asset-type-badge">{a.type}</div>
                <div className="cs-asset-prompt">{(a.prompt || "").slice(0, 40)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="cs-section">
        <div className="cs-section-title">Capabilities ({caps.length})</div>
        <div className="cs-cap-grid">
          {caps.map(c => (
            <div key={c.id} className="cs-cap-card">
              <span className="cs-cap-icon">{CAP_ICONS[c.id] || "◻"}</span>
              <span className="cs-cap-label">{c.label}</span>
              <span className="cs-cap-providers">{c.providerCount}p · {c.minCredits}cr</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function statCard(label, value, sub) {
  return (
    <div key={label} className="cs-stat">
      <div className="cs-stat-val">{value}</div>
      <div className="cs-stat-label">{label}</div>
      <div className="cs-stat-sub">{sub}</div>
    </div>
  );
}

// ── Image Studio ──────────────────────────────────────────────────

function ImageStudio({ onComplete }) {
  const [action, setAction] = useState("generate");
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState(null);
  const [busy,   setBusy]   = useState(false);
  const [hist,   setHist]   = useState([]);

  useEffect(() => {
    apiGet("/creative/image/history").then(r => { if (r.ok) setHist(r.jobs || []); });
  }, [result]);

  const ACTIONS = [
    { id: "generate", label: "Generate", endpoint: "/creative/image/generate" },
    { id: "edit",     label: "Edit",     endpoint: "/creative/image/edit"     },
    { id: "logo",     label: "Logo",     endpoint: "/creative/image/logo"     },
    { id: "banner",   label: "Banner",   endpoint: "/creative/image/banner"   },
  ];

  async function run() {
    if (!prompt) return;
    setBusy(true);
    setResult(null);
    try {
      const ep = ACTIONS.find(a => a.id === action)?.endpoint || "/creative/image/generate";
      const r  = await apiPost(ep, { prompt, quality: "high" });
      setResult(r);
      if (r.ok && onComplete) onComplete();
    } catch (e) { setResult({ ok: false, error: e.message }); }
    finally { setBusy(false); }
  }

  return (
    <div className="cs-studio">
      <div className="cs-studio-actions">
        {ACTIONS.map(a => (
          <button key={a.id} className={`cs-action-btn${action === a.id ? " active" : ""}`} onClick={() => setAction(a.id)}>
            {a.label}
          </button>
        ))}
      </div>
      <PromptBox prompt={prompt} onChange={setPrompt} onRun={run} busy={busy} placeholder={`Describe your ${action}…`} />
      {result && <ResultCard result={result} />}
      {hist.length > 0 && <HistoryList items={hist} />}
    </div>
  );
}

// ── Video Studio ──────────────────────────────────────────────────

function VideoStudio({ onComplete }) {
  const [action, setAction] = useState("text-to-video");
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState(null);
  const [busy,   setBusy]   = useState(false);
  const [queue,  setQueue]  = useState(null);

  useEffect(() => {
    apiGet("/creative/video/queue").then(r => { if (r.ok) setQueue(r); });
  }, [result]);

  const ACTIONS = [
    { id: "text-to-video",  label: "Text → Video",    endpoint: "/creative/video/text-to-video"  },
    { id: "image-to-video", label: "Image → Video",   endpoint: "/creative/video/image-to-video", field: "imageUrl" },
    { id: "reel",           label: "Reel",             endpoint: "/creative/video/reel"           },
    { id: "short",          label: "Short",            endpoint: "/creative/video/short"          },
    { id: "animation",      label: "Animation",        endpoint: "/creative/video/animation"      },
  ];

  async function run() {
    if (!prompt) return;
    setBusy(true); setResult(null);
    try {
      const a  = ACTIONS.find(x => x.id === action);
      const ep = a?.endpoint || "/creative/video/text-to-video";
      const r  = await apiPost(ep, { prompt });
      setResult(r);
      if (r.ok && onComplete) onComplete();
    } catch (e) { setResult({ ok: false, error: e.message }); }
    finally { setBusy(false); }
  }

  return (
    <div className="cs-studio">
      <div className="cs-studio-actions">
        {ACTIONS.map(a => (
          <button key={a.id} className={`cs-action-btn${action === a.id ? " active" : ""}`} onClick={() => setAction(a.id)}>
            {a.label}
          </button>
        ))}
      </div>
      {queue && (
        <div className="cs-queue-bar">
          <span className="cs-badge running">{queue.summary?.running || 0} running</span>
          <span className="cs-badge queued">{queue.summary?.queued || 0} queued</span>
          <span className="cs-badge complete">{queue.summary?.complete || 0} done</span>
        </div>
      )}
      <PromptBox prompt={prompt} onChange={setPrompt} onRun={run} busy={busy} placeholder="Describe the video…" />
      {result && <ResultCard result={result} />}
    </div>
  );
}

// ── Voice Studio ──────────────────────────────────────────────────

function VoiceStudio({ onComplete }) {
  const [action, setAction] = useState("tts");
  const [prompt, setPrompt] = useState("");
  const [consent, setConsent] = useState(false);
  const [result, setResult]   = useState(null);
  const [busy,   setBusy]     = useState(false);

  const ACTIONS = [
    { id: "tts",   label: "Text → Speech", endpoint: "/creative/voice/tts"   },
    { id: "stt",   label: "Speech → Text", endpoint: "/creative/voice/stt",  field: "audioUrl" },
    { id: "music", label: "Music",         endpoint: "/creative/voice/music" },
    { id: "clone", label: "Voice Clone",   endpoint: "/creative/voice/clone", field: "sampleUrl" },
  ];

  async function run() {
    if (!prompt) return;
    setBusy(true); setResult(null);
    try {
      const a   = ACTIONS.find(x => x.id === action);
      const ep  = a?.endpoint;
      const body = action === "clone"
        ? { sampleUrl: prompt, consentConfirmed: consent }
        : { prompt };
      const r = await apiPost(ep, body);
      setResult(r);
      if (r.ok && onComplete) onComplete();
    } catch (e) { setResult({ ok: false, error: e.message }); }
    finally { setBusy(false); }
  }

  return (
    <div className="cs-studio">
      <div className="cs-studio-actions">
        {ACTIONS.map(a => (
          <button key={a.id} className={`cs-action-btn${action === a.id ? " active" : ""}`} onClick={() => setAction(a.id)}>
            {a.label}
          </button>
        ))}
      </div>
      {action === "clone" && (
        <div className="cs-consent-box">
          <label className="cs-consent-label">
            <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />
            &nbsp;I confirm I have explicit consent from the voice owner to clone this voice.
          </label>
        </div>
      )}
      <PromptBox
        prompt={prompt} onChange={setPrompt} onRun={run} busy={busy}
        placeholder={action === "clone" ? "Paste audio sample URL…" : action === "stt" ? "Paste audio URL to transcribe…" : "Enter text to speak or describe music…"}
      />
      {result && <ResultCard result={result} />}
    </div>
  );
}

// ── Brand Studio ──────────────────────────────────────────────────

function BrandPanel({ onComplete }) {
  const [kits,   setKits]   = useState([]);
  const [form,   setForm]   = useState({ name: "", industry: "", description: "" });
  const [active, setActive] = useState(null);
  const [result, setResult] = useState(null);
  const [busy,   setBusy]   = useState(false);

  const load = useCallback(() => {
    apiGet("/creative/brand").then(r => { if (r.ok) setKits(r.kits || []); });
  }, []);
  useEffect(load, [load]);

  async function create() {
    if (!form.name) return;
    const r = await apiPost("/creative/brand", form);
    if (r.ok) { setKits(prev => [r.kit, ...prev]); setForm({ name: "", industry: "", description: "" }); }
  }

  async function generate(kitId, what) {
    setBusy(true); setResult(null);
    try {
      const r = await apiPost(`/creative/brand/${kitId}/generate`, { what });
      setResult(r);
      if (r.ok && onComplete) onComplete();
    } finally { setBusy(false); }
  }

  return (
    <div className="cs-studio">
      <div className="cs-form">
        <input className="cs-input" placeholder="Brand name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
        <input className="cs-input" placeholder="Industry" value={form.industry} onChange={e => setForm(f => ({ ...f, industry: e.target.value }))} />
        <button className="cs-btn-primary" onClick={create}>Create Brand Kit</button>
      </div>

      {kits.length === 0 && <div className="cs-empty">No brand kits yet.</div>}

      <div className="cs-brand-list">
        {kits.map(kit => (
          <div key={kit.id} className={`cs-brand-card${active === kit.id ? " active" : ""}`} onClick={() => setActive(kit.id === active ? null : kit.id)}>
            <div className="cs-brand-name">{kit.name}</div>
            <div className="cs-brand-meta">{kit.industry || "—"}</div>
            <div className="cs-brand-colors">
              {Object.entries(kit.colors || {}).slice(0,4).map(([k,v]) => (
                <span key={k} className="cs-color-dot" style={{ background: v }} title={`${k}: ${v}`} />
              ))}
            </div>
            {active === kit.id && (
              <div className="cs-brand-actions">
                <button className="cs-action-btn" onClick={() => generate(kit.id, "logo")}   disabled={busy}>Generate Logo</button>
                <button className="cs-action-btn" onClick={() => generate(kit.id, "banner")} disabled={busy}>Generate Banner</button>
                <button className="cs-action-btn" onClick={() => generate(kit.id, "ad")}     disabled={busy}>Generate Ad</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {result && <ResultCard result={result} />}
    </div>
  );
}

// ── Social Content Engine ─────────────────────────────────────────

function SocialPanel({ onComplete }) {
  const [platform, setPlatform] = useState("instagram");
  const [brief,    setBrief]    = useState("");
  const [result,   setResult]   = useState(null);
  const [busy,     setBusy]     = useState(false);
  const [hist,     setHist]     = useState([]);

  useEffect(() => {
    apiGet("/creative/social/history?limit=10").then(r => { if (r.ok) setHist(r.history || []); });
  }, [result]);

  async function generate() {
    if (!brief) return;
    setBusy(true); setResult(null);
    try {
      const r = await apiPost("/creative/social/generate", { platform, brief });
      setResult(r);
      if (r.ok && onComplete) onComplete();
    } catch (e) { setResult({ ok: false, error: e.message }); }
    finally { setBusy(false); }
  }

  const platLabel = p => p.charAt(0).toUpperCase() + p.slice(1);

  return (
    <div className="cs-studio">
      <div className="cs-platform-picker">
        {PLATFORMS.map(p => (
          <button key={p} className={`cs-plat-btn${platform === p ? " active" : ""}`} onClick={() => setPlatform(p)}>
            {platLabel(p)}
          </button>
        ))}
      </div>

      <PromptBox
        prompt={brief} onChange={setBrief} onRun={generate} busy={busy}
        placeholder={`Describe your ${platLabel(platform)} content topic…`}
        btnLabel="Generate"
      />

      {result?.ok && result.result && (
        <div className="cs-social-result">
          <div className="cs-social-section">
            <div className="cs-section-title">Caption</div>
            <div className="cs-social-text">{result.result.caption}</div>
          </div>
          {result.result.hook && (
            <div className="cs-social-section">
              <div className="cs-section-title">Hook</div>
              <div className="cs-social-text cs-highlight">{result.result.hook}</div>
            </div>
          )}
          {result.result.hashtags?.length > 0 && (
            <div className="cs-social-section">
              <div className="cs-section-title">Hashtags</div>
              <div className="cs-hashtags">
                {result.result.hashtags.map((h, i) => <span key={i} className="cs-hashtag">{h}</span>)}
              </div>
            </div>
          )}
          {result.result.cta && (
            <div className="cs-social-section">
              <div className="cs-section-title">CTA</div>
              <div className="cs-social-text">{result.result.cta}</div>
            </div>
          )}
          {result.result.variations?.length > 0 && (
            <div className="cs-social-section">
              <div className="cs-section-title">Variations</div>
              {result.result.variations.map((v, i) => <div key={i} className="cs-variation">{v}</div>)}
            </div>
          )}
        </div>
      )}

      {result && !result.ok && <div className="cs-error-inline">{result.error}</div>}

      {hist.length > 0 && (
        <div className="cs-section" style={{ marginTop: 20 }}>
          <div className="cs-section-title">History</div>
          {hist.slice(0,5).map(h => (
            <div key={h.id} className="cs-hist-item">
              <span className="cs-badge">{h.platform}</span>
              <span className="cs-hist-brief">{(h.brief || "").slice(0,60)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Asset Library ─────────────────────────────────────────────────

function AssetsPanel() {
  const [filter,  setFilter]  = useState({ type: "", folder: "", search: "" });
  const [assetList, setList]  = useState([]);
  const [stats,   setStats]   = useState(null);
  const [folders, setFolders] = useState([]);
  const [busy,    setBusy]    = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    const qs = new URLSearchParams(Object.entries(filter).filter(([,v]) => v)).toString();
    const [a, s, f] = await Promise.all([
      apiGet(`/creative/assets${qs ? "?" + qs : ""}`),
      apiGet("/creative/assets"),
      apiGet("/creative/assets/folders"),
    ]);
    if (a.ok) setList(a.assets || []);
    if (s.ok) setStats(s.stats);
    if (f.ok) setFolders(f.folders || []);
    setBusy(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  async function toggleFav(id) {
    const r = await apiPost(`/creative/assets/${id}/favorite`, {});
    if (r.ok) load();
  }

  return (
    <div className="cs-studio">
      {stats && (
        <div className="cs-stats-row" style={{ marginBottom: 12 }}>
          {statCard("Total", stats.total, "assets")}
          {statCard("Favorites", stats.favorites, "saved")}
          {Object.entries(stats.byType || {}).slice(0,4).map(([t,n]) => statCard(t, n, "files"))}
        </div>
      )}

      <div className="cs-filter-row">
        <select className="cs-select" value={filter.type} onChange={e => setFilter(f => ({ ...f, type: e.target.value }))}>
          <option value="">All Types</option>
          {["image","video","audio","document","brand_kit","template"].map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="cs-select" value={filter.folder} onChange={e => setFilter(f => ({ ...f, folder: e.target.value }))}>
          <option value="">All Folders</option>
          {folders.map(f => <option key={f.name} value={f.name}>{f.name} ({f.count})</option>)}
        </select>
        <input className="cs-input cs-search" placeholder="Search…" value={filter.search}
          onChange={e => setFilter(f => ({ ...f, search: e.target.value }))} />
      </div>

      {busy && <div className="cs-empty">Loading…</div>}
      {!busy && assetList.length === 0 && <div className="cs-empty">No assets yet. Generate something!</div>}

      <div className="cs-asset-table">
        {assetList.map(a => (
          <div key={a.id} className="cs-asset-row">
            <div className="cs-asset-type-icon">{CAP_ICONS[a.capability] || "◻"}</div>
            <div className="cs-asset-info">
              <div className="cs-asset-row-prompt">{(a.prompt || "—").slice(0, 60)}</div>
              <div className="cs-asset-row-meta">
                <span className="cs-badge">{a.type}</span>
                <span className="cs-dim">{a.provider}</span>
                <span className="cs-dim">{a.folder}</span>
                <span className="cs-dim">{new Date(a.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
            <button className={`cs-fav-btn${a.favorite ? " active" : ""}`} onClick={() => toggleFav(a.id)}>
              {a.favorite ? "★" : "☆"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Benchmark ─────────────────────────────────────────────────────

function BenchPanel({ bench, onRun, loading }) {
  const score = bench?.score || 0;
  const color = s => s >= 80 ? "var(--success)" : s >= 60 ? "var(--warning)" : "var(--danger)";

  return (
    <div className="cs-studio">
      <div className="cs-bench-header">
        <div>
          <div className="cs-bench-score" style={{ color: color(score) }}>{score}%</div>
          <div className="cs-bench-readiness">{bench?.commercialReadiness || "—"}</div>
          {bench && (
            <div className="cs-bench-sub">
              {bench.passing}/{bench.total} checks ·
              Capabilities: {bench.capabilityCount} ·
              Regression: <strong style={{ color: bench.regressionPass ? "var(--success)" : "var(--danger)" }}>
                {bench.regressionPass ? "PASS" : "FAIL"}
              </strong>
            </div>
          )}
        </div>
        <button className="cs-btn-primary" onClick={onRun} disabled={loading}>
          {loading ? "Running…" : bench ? "Re-run" : "Run Benchmark"}
        </button>
      </div>

      {bench?.results && (
        <div className="cs-bench-list">
          {bench.results.map(r => (
            <div key={r.id} className={`cs-bench-row ${r.ok ? "ok" : "fail"}`}>
              <span className={`cs-bench-dot ${r.ok ? "ok" : "fail"}`} />
              <span className="cs-bench-label">{r.label}</span>
              <span className="cs-bench-detail">{r.details || r.error || ""}</span>
              {r.grossMargin && <span className="cs-bench-extra">Margin: {r.grossMargin}%</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Shared sub-components ──────────────────────────────────────────

function PromptBox({ prompt, onChange, onRun, busy, placeholder, btnLabel = "Generate" }) {
  return (
    <div className="cs-prompt-row">
      <textarea
        className="cs-prompt"
        value={prompt}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onRun(); }}
      />
      <button className="cs-btn-primary" onClick={onRun} disabled={busy || !prompt}>
        {busy ? "…" : btnLabel}
      </button>
    </div>
  );
}

function ResultCard({ result }) {
  if (!result) return null;
  if (!result.ok) return <div className="cs-result-error">{result.error || "Request failed"}</div>;
  return (
    <div className="cs-result-card">
      <div className="cs-result-row">
        <span className="cs-dim">Provider:</span> {result.decision?.providerName || result.decision?.provider || "—"}
        <span className="cs-dim" style={{ marginLeft: 12 }}>Credits:</span> {result.creditsUsed || "—"}
        <span className="cs-dim" style={{ marginLeft: 12 }}>Asset:</span> {result.asset?.id ? result.asset.id.slice(0,16)+"…" : "—"}
      </div>
      {result.output && typeof result.output === "object" && result.output.result && (
        <div className="cs-result-desc">{result.output.result}</div>
      )}
      {result.asset?.url && (
        <div className="cs-result-url">
          <a href={result.asset.url} target="_blank" rel="noreferrer">{result.asset.url.slice(0,60)}</a>
        </div>
      )}
    </div>
  );
}

function HistoryList({ items }) {
  if (!items?.length) return null;
  return (
    <div className="cs-section" style={{ marginTop: 16 }}>
      <div className="cs-section-title">History ({items.length})</div>
      {items.slice(0,8).map(j => (
        <div key={j.id} className="cs-hist-item">
          <span className={`cs-badge ${j.status}`}>{j.status}</span>
          <span className="cs-hist-brief">{(j.prompt || "").slice(0,60)}</span>
          <span className="cs-dim" style={{ marginLeft: "auto" }}>{j.provider}</span>
        </div>
      ))}
    </div>
  );
}
