import React, { useState, useEffect } from "react";
import { _fetch } from "../_client";

// ── Shared panel constants ────────────────────────────────────────
const HEALTH_COLOR_SH = { ok: "#52d68a", degraded: "var(--warning)", error: "var(--error)", unknown: "var(--text-faint)" };
const DIAG_COLOR_SH   = { info: "var(--accent)", warn: "var(--warning)", error: "var(--error)" };

// ── L3 Extension Runtime Panels ──────────────────────────────────
const EXT_STATE_COLOR = {
  active:    "#52d68a",
  suspended: "var(--warning)",
  error:     "var(--error)",
  loaded:    "var(--accent)",
  unloaded:  "var(--text-faint)",
  installed: "var(--text-dim)",
};

function ExtRuntimePanel() {
  const [exts,    setExts]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy,    setBusy]    = useState(null);
  const [detail,  setDetail]  = useState(null);
  const [loadForm, setLoadForm] = useState(false);
  const [loadOpts, setLoadOpts] = useState({ extId: "", hooks: "", subscriptions: "", restartPolicy: "on_crash" });

  const reload = () => {
    setLoading(true);
    _fetch("/extensions/runtime").then(r => setExts(r.extensions || [])).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(reload, []);

  const action = async (endpoint, extId) => {
    setBusy(extId);
    await _fetch(endpoint, { method: "POST", body: JSON.stringify({ extId }) }).catch(() => {});
    setBusy(null); reload();
  };

  const handleLoad = async () => {
    setBusy("__load__");
    await _fetch("/extensions/load", {
      method: "POST",
      body: JSON.stringify({
        extId:         loadOpts.extId.trim(),
        hooks:         loadOpts.hooks.split(",").map(s => s.trim()).filter(Boolean),
        subscriptions: loadOpts.subscriptions.split(",").map(s => s.trim()).filter(Boolean),
        restartPolicy: loadOpts.restartPolicy,
      }),
    }).catch(() => {});
    setBusy(null); setLoadForm(false); reload();
  };

  const openDetail = (ext) => {
    _fetch(`/extensions/runtime/${ext.id}`).then(r => setDetail(r.extension || r)).catch(() => setDetail(ext));
  };

  if (loading) return <div className="k2-loading">Loading extension runtime…</div>;

  return (
    <div className="l3-panel">
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <button className="k2-form-btn" onClick={() => setLoadForm(f => !f)}>{loadForm ? "Cancel" : "+ Load Extension"}</button>
        <button className="k2-form-btn" style={{ background: "none", color: "var(--text-dim)" }} onClick={reload}>↺ Refresh</button>
      </div>

      {loadForm && (
        <div className="l1-install-form">
          <div className="k5-form-section-label">Load Extension into Runtime</div>
          {[
            ["Extension ID", "extId",         "my-plugin"],
            ["Hooks (CSV)",  "hooks",          "onLoad, onAgentTask"],
            ["Event Subs",   "subscriptions",  "automation_rule_fired, mission_complete"],
          ].map(([label, key, ph]) => (
            <div key={key} className="k2-form-row">
              <label className="k2-form-label">{label}</label>
              <input className="k2-form-input" value={loadOpts[key]} placeholder={ph}
                onChange={e => setLoadOpts(o => ({ ...o, [key]: e.target.value }))} />
            </div>
          ))}
          <div className="k2-form-row">
            <label className="k2-form-label">Restart Policy</label>
            <select className="k2-form-input" value={loadOpts.restartPolicy}
              onChange={e => setLoadOpts(o => ({ ...o, restartPolicy: e.target.value }))}>
              {["never", "on_crash", "always"].map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <button className="k2-form-btn" disabled={busy === "__load__" || !loadOpts.extId.trim()} onClick={handleLoad}>
            {busy === "__load__" ? "Loading…" : "Load"}
          </button>
        </div>
      )}

      {exts.length === 0 ? (
        <div className="k2-empty">No extensions in runtime. Load an installed plugin above.</div>
      ) : (
        <div className="l3-ext-list">
          {exts.map(ext => (
            <div key={ext.id} className="l3-ext-row" onClick={() => openDetail(ext)} style={{ cursor: "pointer" }}>
              <span className="l3-ext-dot" style={{ background: EXT_STATE_COLOR[ext.state] || "var(--text-faint)" }} />
              <div className="l3-ext-meta">
                <span className="l3-ext-name">{ext.id}</span>
                <span className="l3-ext-info">
                  {ext.hooks?.length > 0 && `hooks: ${ext.hooks.join(", ")} · `}
                  crashes: {ext.crashCount} · restarts: {ext.restartCount}
                </span>
              </div>
              <span className="l3-ext-state" style={{ color: EXT_STATE_COLOR[ext.state] }}>{ext.state}</span>
              <div className="l3-ext-actions" onClick={e => e.stopPropagation()}>
                {ext.state === "active"    && <button className="k5-toggle-btn" disabled={busy === ext.id} onClick={() => action("/extensions/suspend", ext.id)}>Suspend</button>}
                {ext.state === "suspended" && <button className="k5-toggle-btn k5-toggle-btn--on" disabled={busy === ext.id} onClick={() => action("/extensions/resume", ext.id)}>Resume</button>}
                {(ext.state === "error" || ext.state === "suspended") && <button className="k5-toggle-btn" disabled={busy === ext.id} onClick={() => action("/extensions/restart", ext.id)}>Restart</button>}
                {ext.state !== "unloaded" && <button className="k2-revoke-btn" disabled={busy === ext.id} onClick={() => action("/extensions/unload", ext.id)}>Unload</button>}
              </div>
            </div>
          ))}
        </div>
      )}

      {detail && (
        <div className="ws-modal-overlay" onClick={() => setDetail(null)}>
          <div className="ws-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 540, maxHeight: "80vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <strong style={{ fontSize: 15 }}>{detail.id}</strong>
              <button onClick={() => setDetail(null)} style={{ background: "none", border: "none", color: "var(--text-faint)", cursor: "pointer", fontSize: 18 }}>✕</button>
            </div>
            <div className="k6-stat-grid k6-stat-grid--sm" style={{ marginBottom: 10 }}>
              <div className="k6-stat-card"><span className="k6-stat-val" style={{ color: EXT_STATE_COLOR[detail.state] }}>{detail.state}</span><span className="k6-stat-label">state</span></div>
              <div className="k6-stat-card"><span className="k6-stat-val">{detail.crashCount}</span><span className="k6-stat-label">crashes</span></div>
              <div className="k6-stat-card"><span className="k6-stat-val">{detail.restartCount}</span><span className="k6-stat-label">restarts</span></div>
              <div className="k6-stat-card"><span className="k6-stat-val">{detail.hooks?.length || 0}</span><span className="k6-stat-label">hooks</span></div>
            </div>
            {detail.lastError && <div className="l1-err" style={{ marginBottom: 8 }}>{detail.lastError}</div>}
            {detail.events?.length > 0 && (
              <>
                <div className="k5-form-section-label">Events</div>
                {detail.events.map(ev => (
                  <div key={ev.id} className="l1-diag-row">
                    <span className="l1-diag-dot" style={{ background: DIAG_COLOR_SH[ev.level] || "var(--text-faint)" }} />
                    <span className="l1-diag-ts">{new Date(ev.ts).toLocaleTimeString()}</span>
                    <span className="l1-diag-msg">{ev.msg}</span>
                    <span className="l1-diag-lvl" style={{ color: DIAG_COLOR_SH[ev.level] }}>{ev.level}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ExtMetricsPanel() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    _fetch("/extensions/metrics").then(r => setData(r)).catch(() => {}).finally(() => setLoading(false));
  }, []);
  if (loading) return <div className="k2-loading">Loading metrics…</div>;
  if (!data)   return <div className="k2-empty">No metrics available.</div>;
  const { extensions, hooks, subs, crashes, restarts, eventBus } = data;
  return (
    <div className="l3-panel">
      <div className="k6-section-label">Extensions</div>
      <div className="k6-stat-grid">
        <K6Stat label="Total"       value={extensions?.total || 0} />
        {Object.entries(extensions?.byState || {}).map(([s, n]) => (
          <K6Stat key={s} label={s} value={n} color={EXT_STATE_COLOR[s]} />
        ))}
      </div>
      <div className="k6-section-label" style={{ marginTop: 10 }}>Hooks & Events</div>
      <div className="k6-stat-grid">
        <K6Stat label="Hooks Registered" value={hooks?.totalRegistered || 0} />
        <K6Stat label="Event Subs"        value={subs?.totalRegistered  || 0} />
        <K6Stat label="Total Crashes"     value={crashes?.total || 0} color={crashes?.total > 0 ? "var(--error)" : undefined} />
        <K6Stat label="Total Restarts"    value={restarts?.total || 0} />
      </div>
      {crashes?.perExtension?.filter(e => e.count > 0).length > 0 && (
        <>
          <div className="k6-section-label" style={{ marginTop: 10 }}>Crashes by Extension</div>
          <div className="k6-list">
            {crashes.perExtension.filter(e => e.count > 0).map(e => (
              <div key={e.id} className="k6-row">
                <span className="k6-row-name">{e.id}</span>
                <span className="k6-row-val" style={{ color: "var(--error)" }}>{e.count} crashes</span>
              </div>
            ))}
          </div>
        </>
      )}
      {eventBus && (
        <>
          <div className="k6-section-label" style={{ marginTop: 10 }}>Event Bus</div>
          <div className="k6-stat-grid k6-stat-grid--sm">
            {Object.entries(eventBus).filter(([k]) => typeof eventBus[k] === "number").map(([k, v]) => (
              <K6Stat key={k} label={k.replace(/_/g," ")} value={v} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ExtHooksPanel() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    _fetch("/extensions/hooks").then(r => setData(r)).catch(() => {}).finally(() => setLoading(false));
  }, []);
  if (loading) return <div className="k2-loading">Loading hooks…</div>;
  if (!data)   return <div className="k2-empty">No hooks registered.</div>;
  return (
    <div className="l3-panel">
      {data.total === 0 ? (
        <div className="k2-empty">No extensions have registered hooks. Load an extension first.</div>
      ) : (
        <>
          <div className="k6-section-label">{data.total} hook registration{data.total !== 1 ? "s" : ""}</div>
          <div className="k6-list">
            {data.hooks.map((h, i) => (
              <div key={i} className="k6-row">
                <span className="k6-row-name">{h.extId}</span>
                <span className="l1-cap-chip">{h.hookName}</span>
                <span className="k2-badge" style={{ color: EXT_STATE_COLOR[h.state] }}>{h.state}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ExtQuotasPanel() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    _fetch("/extensions/quotas").then(r => setData(r)).catch(() => {}).finally(() => setLoading(false));
  }, []);
  if (loading) return <div className="k2-loading">Loading quotas…</div>;
  if (!data)   return <div className="k2-empty">No quota data.</div>;
  const quotas = data.quotas || [];
  return (
    <div className="l3-panel">
      {quotas.length === 0 ? (
        <div className="k2-empty">No extensions in runtime.</div>
      ) : quotas.map(q => (
        <div key={q.extId} className="l3-quota-block">
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span className="l3-ext-dot" style={{ background: EXT_STATE_COLOR[q.state] || "var(--text-faint)" }} />
            <strong className="l3-ext-name">{q.extId}</strong>
            <span className="k2-badge" style={{ color: EXT_STATE_COLOR[q.state] }}>{q.state}</span>
            <span className="l2-card-author" style={{ marginLeft: "auto" }}>policy: {q.restartPolicy}</span>
          </div>
          <div className="k6-stat-grid k6-stat-grid--sm">
            <K6Stat label="Hook calls/min" value={`${q.usedQuota?.hookCallsThisMin || 0} / ${q.quota?.maxHookCallsPerMin}`} />
            <K6Stat label="Active subs"    value={`${q.usedQuota?.activeSubs || 0} / ${q.quota?.maxEventSubsPerExt}`} />
            <K6Stat label="Active hooks"   value={`${q.usedQuota?.activeHooks || 0} / ${q.quota?.maxHooksPerExt}`} />
            <K6Stat label="Crashes"        value={q.crashCount}  color={q.crashCount  > 0 ? "var(--error)"   : undefined} />
            <K6Stat label="Restarts"       value={q.restartCount} color={q.restartCount > 0 ? "var(--warning)" : undefined} />
            <K6Stat label="Recovery budget" value={`${q.restartCount} / ${q.quota?.maxCrashRecoveries}`} />
          </div>
        </div>
      ))}
    </div>
  );
}


export { HEALTH_COLOR_SH, DIAG_COLOR_SH, EXT_STATE_COLOR, ExtRuntimePanel, ExtMetricsPanel, ExtHooksPanel, ExtQuotasPanel };
