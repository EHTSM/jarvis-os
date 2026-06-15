import React, { useState, useEffect, useCallback } from "react";
import { _fetch } from "../_client";

// ── K5 Automation helpers ─────────────────────────────────────────
const TRIGGER_TYPES   = ["schedule","event","threshold","manual","webhook","approval"];
const ACTION_TYPES_K5 = ["queue_task","emit_event","notify","set_policy","escalate"];
const OUTCOME_COLOR   = { success:"#52d68a", failed:"var(--error)", skipped:"var(--text-faint)", pending_approval:"var(--warning)", dry_run:"var(--accent2)" };

function _autoFmtTs(ts) {
  if (!ts) return "never";
  const d = new Date(ts);
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)    return `${s}s ago`;
  if (s < 3600)  return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return d.toLocaleDateString();
}

// ── K5 — Automation Overview ──────────────────────────────────────
function AutomationOverviewPanel() {
  const [stats,   setStats]   = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    _fetch("/automation/statistics").then(r => setStats(r)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="k2-loading">Loading automation overview…</div>;
  if (!stats)  return <div className="k2-empty">No automation data yet.</div>;

  const { rules, history } = stats;
  return (
    <div className="k5-overview-panel">
      <div className="k4-overview-cards">
        <div className="k4-ov-card">
          <span className="k4-ov-value" style={{ color: "var(--accent)" }}>{rules?.active || 0}</span>
          <span className="k4-ov-label">Active Rules</span>
          <span className="k4-ov-sub">{rules?.total || 0} total</span>
        </div>
        <div className="k4-ov-card">
          <span className="k4-ov-value" style={{ color: "#52d68a" }}>{history?.last24h || 0}</span>
          <span className="k4-ov-label">Runs (24h)</span>
          <span className="k4-ov-sub">{history?.last7d || 0} this week</span>
        </div>
        <div className="k4-ov-card">
          <span className="k4-ov-value" style={{ color: OUTCOME_COLOR.success }}>{history?.byOutcome?.success || 0}</span>
          <span className="k4-ov-label">Successful</span>
          <span className="k4-ov-sub">{history?.byOutcome?.failed || 0} failed</span>
        </div>
        <div className="k4-ov-card">
          <span className="k4-ov-value" style={{ color: "var(--warning)" }}>{history?.byOutcome?.pending_approval || 0}</span>
          <span className="k4-ov-label">Pending Approval</span>
          <span className="k4-ov-sub">{history?.byOutcome?.skipped || 0} skipped</span>
        </div>
      </div>

      {stats.topRules?.length > 0 && (
        <>
          <div className="k4-section-label" style={{ marginTop: 16 }}>Most Active Rules</div>
          <div className="k5-top-rules">
            {stats.topRules.map(r => (
              <div key={r.id} className="k5-top-rule-row">
                <span className="k5-rule-name">{r.name}</span>
                <span className="k5-rule-runs">{r.runCount} runs</span>
                <span className="k5-rule-outcome" style={{ color: OUTCOME_COLOR[r.lastOutcome] || "var(--text-faint)" }}>
                  {r.lastOutcome || "—"}
                </span>
                <span className="k5-rule-ts">{_autoFmtTs(r.lastRunAt)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {rules?.byTrigger && Object.keys(rules.byTrigger).length > 0 && (
        <>
          <div className="k4-section-label" style={{ marginTop: 14 }}>Rules by Trigger</div>
          <div className="k4-report-grid">
            {Object.entries(rules.byTrigger).map(([type, n]) => (
              <div key={type} className="k4-report-cell">
                <span className="k4-report-cell-val">{n}</span>
                <span className="k4-report-cell-key">{type}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── K5 — Rule Builder Panel ───────────────────────────────────────
function RuleBuilderPanel() {
  const [rules,    setRules]    = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [creating, setCreating] = useState(false);
  const [dryResult,setDryResult]= useState(null);
  const [toast,    setToast]    = useState(null);
  const [form, setForm] = useState({
    name: "", description: "", enabled: true,
    trigger: { type: "manual" },
    conditions: [],
    action: { type: "queue_task", input: "" },
    approvalGate: null,
  });

  const doToast = msg => { setToast(msg); setTimeout(() => setToast(null), 2800); };

  const load = useCallback(() => {
    setLoading(true);
    _fetch("/automation/rules").then(r => setRules(r.rules || [])).catch(() => {}).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!form.name.trim()) { doToast("Rule name required"); return; }
    try {
      await _fetch("/automation/rules", { method: "POST", body: JSON.stringify(form) });
      doToast("Rule created"); setCreating(false);
      setForm({ name: "", description: "", enabled: true, trigger: { type: "manual" }, conditions: [], action: { type: "queue_task", input: "" }, approvalGate: null });
      load();
    } catch (e) { doToast(e.message || "Failed"); }
  }

  async function runDryRun() {
    try {
      const r = await _fetch("/automation/dry-run", { method: "POST", body: JSON.stringify({ ruleData: form, context: {} }) });
      setDryResult(r.result);
    } catch (e) { doToast(e.message || "Dry run failed"); }
  }

  async function toggleRule(id, enabled) {
    try {
      await _fetch(`/automation/rules/${id}`, { method: "PATCH", body: JSON.stringify({ enabled }) });
      doToast(enabled ? "Rule enabled" : "Rule disabled"); load();
    } catch (e) { doToast(e.message || "Failed"); }
  }

  async function archiveRule(id) {
    try {
      await _fetch(`/automation/rules/${id}`, { method: "PATCH", body: JSON.stringify({ status: "archived" }) });
      doToast("Rule archived"); load();
    } catch (e) { doToast(e.message || "Failed"); }
  }

  if (loading) return <div className="k2-loading">Loading rules…</div>;

  return (
    <div className="k5-rules-panel">
      {toast && <div className="tw-toast">{toast}</div>}

      <div className="k4-list-header">
        <span className="k4-list-count">{rules.length} rule{rules.length !== 1 ? "s" : ""}</span>
        <button className="k2-create-btn" onClick={() => { setCreating(c => !c); setDryResult(null); }}>
          {creating ? "Cancel" : "＋ New rule"}
        </button>
      </div>

      {creating && (
        <div className="k5-rule-form">
          <input className="k2-form-input" placeholder="Rule name…" value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))} autoFocus />
          <input className="k2-form-input" placeholder="Description (optional)" value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />

          <div className="k5-form-section-label">Trigger</div>
          <div className="k4-form-row">
            <select className="k2-form-select" value={form.trigger.type}
              onChange={e => setForm(f => ({ ...f, trigger: { ...f.trigger, type: e.target.value } }))}>
              {TRIGGER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            {form.trigger.type === "schedule" && (
              <input className="k2-form-input k2-form-input--mono" placeholder="Cron (e.g. 0 8 * * *)"
                value={form.trigger.cron || ""}
                onChange={e => setForm(f => ({ ...f, trigger: { ...f.trigger, cron: e.target.value } }))} />
            )}
            {form.trigger.type === "event" && (
              <input className="k2-form-input" placeholder="Event name (e.g. mission_completed)"
                value={form.trigger.eventName || ""}
                onChange={e => setForm(f => ({ ...f, trigger: { ...f.trigger, eventName: e.target.value } }))} />
            )}
            {form.trigger.type === "threshold" && (
              <>
                <input className="k2-form-input" placeholder="Metric name" style={{ flex: 1 }}
                  value={form.trigger.metric || ""}
                  onChange={e => setForm(f => ({ ...f, trigger: { ...f.trigger, metric: e.target.value } }))} />
                <select className="k2-form-select" value={form.trigger.operator || "gt"}
                  onChange={e => setForm(f => ({ ...f, trigger: { ...f.trigger, operator: e.target.value } }))}>
                  {["gt","lt","gte","lte","eq"].map(o => <option key={o} value={o}>{o}</option>)}
                </select>
                <input className="k2-form-input" placeholder="Value" type="number" style={{ width: 70 }}
                  value={form.trigger.value || ""}
                  onChange={e => setForm(f => ({ ...f, trigger: { ...f.trigger, value: Number(e.target.value) } }))} />
              </>
            )}
          </div>

          <div className="k5-form-section-label">Action</div>
          <div className="k4-form-row">
            <select className="k2-form-select" value={form.action.type}
              onChange={e => setForm(f => ({ ...f, action: { type: e.target.value } }))}>
              {ACTION_TYPES_K5.map(t => <option key={t} value={t}>{t.replace("_"," ")}</option>)}
            </select>
          </div>
          {form.action.type === "queue_task" && (
            <input className="k2-form-input" placeholder="Task input (supports {{variable}})"
              value={form.action.input || ""}
              onChange={e => setForm(f => ({ ...f, action: { ...f.action, input: e.target.value } }))} />
          )}
          {(form.action.type === "notify" || form.action.type === "escalate") && (
            <input className="k2-form-input" placeholder="Message…"
              value={form.action.message || ""}
              onChange={e => setForm(f => ({ ...f, action: { ...f.action, message: e.target.value } }))} />
          )}
          {form.action.type === "emit_event" && (
            <input className="k2-form-input" placeholder="Event name to emit"
              value={form.action.eventName || ""}
              onChange={e => setForm(f => ({ ...f, action: { ...f.action, eventName: e.target.value } }))} />
          )}

          <div className="k5-form-section-label">Options</div>
          <label className="k5-enabled-toggle">
            <input type="checkbox" checked={form.enabled} onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))} />
            Enable rule immediately
          </label>

          {dryResult && (
            <div className="k5-dry-result" style={{ borderColor: (OUTCOME_COLOR[dryResult.outcome] || "var(--border)") + "60" }}>
              <span className="k5-dry-label">Dry run:</span>
              <span className="k5-dry-outcome" style={{ color: OUTCOME_COLOR[dryResult.outcome] }}>{dryResult.outcome}</span>
              <span className="k5-dry-detail">{dryResult.detail}</span>
            </div>
          )}

          <div className="k2-form-actions">
            <button className="k2-cancel-btn" onClick={runDryRun}>▷ Dry run</button>
            <button className="k2-cancel-btn" onClick={() => setCreating(false)}>Cancel</button>
            <button className="k2-create-confirm" onClick={save} disabled={!form.name.trim()}>Create rule</button>
          </div>
        </div>
      )}

      <div className="k4-list">
        {rules.length === 0 && !creating && <div className="k2-empty">No automation rules yet. Create one or use a template.</div>}
        {rules.map(r => (
          <div key={r.id} className={`k5-rule-row${r.enabled ? "" : " k5-rule-row--disabled"}`}>
            <div className="k5-rule-meta">
              <span className="k5-rule-name-sm">{r.name}</span>
              <span className="k5-rule-trigger">{r.trigger?.type || "manual"}</span>
              {r.description && <span className="k5-rule-desc">{r.description}</span>}
            </div>
            <div className="k5-rule-badges">
              {r.action?.type && <span className="k5-action-badge">{r.action.type.replace("_"," ")}</span>}
              {r.approvalGate && <span className="k5-gate-badge">gate</span>}
            </div>
            {r.lastOutcome && <span className="k5-last-outcome" style={{ color: OUTCOME_COLOR[r.lastOutcome] }}>{r.lastOutcome}</span>}
            <span className="k5-rule-ts">{_autoFmtTs(r.lastRunAt)}</span>
            <button className={`k5-toggle-btn${r.enabled ? " k5-toggle-btn--on" : ""}`}
              onClick={() => toggleRule(r.id, !r.enabled)}>
              {r.enabled ? "Disable" : "Enable"}
            </button>
            <button className="k2-revoke-btn" onClick={() => archiveRule(r.id)}>Archive</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── K5 — Trigger Library (Templates) Panel ───────────────────────
function TriggerLibraryPanel() {
  const [templates, setTemplates] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [toast,     setToast]     = useState(null);

  const doToast = msg => { setToast(msg); setTimeout(() => setToast(null), 2800); };

  useEffect(() => {
    _fetch("/automation/templates").then(r => setTemplates(r.templates || [])).catch(() => {}).finally(() => setLoading(false));
  }, []);

  async function applyTemplate(tpl) {
    try {
      const rule = tpl.rule || {};
      await _fetch("/automation/rules", { method: "POST", body: JSON.stringify({
        name:        tpl.name,
        description: tpl.description || "",
        trigger:     rule.trigger    || { type: "manual" },
        conditions:  rule.conditions || [],
        action:      rule.action     || { type: "notify", message: "Template action" },
        approvalGate: rule.approvalGate || null,
        enabled:     true,
      }) });
      doToast(`Rule created from "${tpl.name}"`);
    } catch (e) { doToast(e.message || "Failed"); }
  }

  if (loading) return <div className="k2-loading">Loading templates…</div>;
  const categories = [...new Set(templates.map(t => t.category))];

  return (
    <div className="k5-templates-panel">
      {toast && <div className="tw-toast">{toast}</div>}
      {categories.map(cat => (
        <div key={cat} className="k5-tpl-category">
          <div className="k4-section-label">{cat}</div>
          {templates.filter(t => t.category === cat).map(t => (
            <div key={t.id} className="k5-tpl-card">
              <div className="k5-tpl-card-top">
                <span className="k5-tpl-name">{t.name}</span>
                {!t.custom && <span className="k2-badge k2-badge--dim">Built-in</span>}
                {t.custom  && <span className="k2-badge k2-badge--green">Custom</span>}
              </div>
              {t.description && <span className="k5-tpl-desc">{t.description}</span>}
              {t.rule?.trigger && (
                <div className="k5-tpl-details">
                  <span className="k5-tpl-chip">trigger: {t.rule.trigger.type}{t.rule.trigger.cron ? ` ${t.rule.trigger.cron}` : ""}</span>
                  {t.rule.action && <span className="k5-tpl-chip">action: {t.rule.action.type?.replace("_"," ")}</span>}
                  {t.rule.approvalGate && <span className="k5-tpl-chip k5-tpl-chip--gate">approval gate</span>}
                </div>
              )}
              <button className="k2-create-btn" style={{ marginTop: 6 }} onClick={() => applyTemplate(t)}>
                Apply template →
              </button>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── K5 — Automation History Panel ────────────────────────────────
function AutoHistoryPanel() {
  const [history,  setHistory]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [filterOut,setFilterOut]= useState("");

  useEffect(() => {
    _fetch("/automation/history?limit=100").then(r => setHistory(r.history || [])).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const filtered = filterOut ? history.filter(h => h.outcome !== filterOut) : history;

  if (loading) return <div className="k2-loading">Loading history…</div>;

  return (
    <div className="k5-history-panel">
      <div className="k4-list-header">
        <span className="k4-list-count">{history.length} runs</span>
        <select className="k3-filter" value={filterOut} onChange={e => setFilterOut(e.target.value)}>
          <option value="">All outcomes</option>
          {["success","failed","skipped","pending_approval","dry_run"].map(o => (
            <option key={o} value={o}>{o.replace("_"," ")}</option>
          ))}
        </select>
      </div>
      {filtered.length === 0 && <div className="k2-empty">No automation history yet.</div>}
      <div className="k5-history-list">
        {filtered.map(h => (
          <div key={h.id} className="k5-history-row">
            <span className="k5-hist-dot" style={{ background: OUTCOME_COLOR[h.outcome] || "var(--text-faint)" }} />
            <span className="k5-hist-ts">{_autoFmtTs(h.ts)}</span>
            <span className="k5-hist-rule">{h.ruleName}</span>
            <span className="k5-hist-outcome" style={{ color: OUTCOME_COLOR[h.outcome] }}>{h.outcome.replace("_"," ")}</span>
            {h.detail && <span className="k5-hist-detail">{h.detail}</span>}
            {h.dryRun && <span className="k2-badge k2-badge--dim">dry</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── K5 — Automation Statistics Panel ─────────────────────────────
function AutoStatsPanel() {
  const [stats,   setStats]   = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    _fetch("/automation/statistics").then(r => setStats(r)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="k2-loading">Loading statistics…</div>;
  if (!stats)  return <div className="k2-empty">No statistics yet.</div>;

  const { rules, history } = stats;

  return (
    <div className="k5-stats-panel">
      <div className="k4-section-label">Execution outcomes</div>
      <div className="k4-report-grid">
        {Object.entries(history?.byOutcome || {}).map(([k, v]) => (
          <div key={k} className="k4-report-cell">
            <span className="k4-report-cell-val" style={{ color: OUTCOME_COLOR[k] || "var(--text)" }}>{v}</span>
            <span className="k4-report-cell-key">{k.replace("_"," ")}</span>
          </div>
        ))}
      </div>

      <div className="k4-section-label" style={{ marginTop: 14 }}>Rules by trigger type</div>
      <div className="k4-report-grid">
        {Object.entries(rules?.byTrigger || {}).map(([k, v]) => (
          <div key={k} className="k4-report-cell">
            <span className="k4-report-cell-val">{v}</span>
            <span className="k4-report-cell-key">{k}</span>
          </div>
        ))}
      </div>

      {stats.topRules?.length > 0 && (
        <>
          <div className="k4-section-label" style={{ marginTop: 14 }}>Top rules by run count</div>
          <div className="k5-history-list">
            {stats.topRules.map(r => (
              <div key={r.id} className="k5-history-row">
                <span className="k5-hist-rule" style={{ flex: 1 }}>{r.name}</span>
                <span className="k5-hist-outcome" style={{ color: OUTCOME_COLOR[r.lastOutcome] || "var(--text-faint)" }}>{r.lastOutcome || "—"}</span>
                <span className="k5-rule-runs">{r.runCount} runs</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export { AutomationOverviewPanel, RuleBuilderPanel, TriggerLibraryPanel, AutoHistoryPanel, AutoStatsPanel };
