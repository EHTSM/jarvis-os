import React, { useState, useEffect, useCallback } from "react";
import { _fetch } from "../_client";
import { useConfirm } from "./ConfirmDialog";
import "./ConnectorSetupWizard.css";

// Real customer-facing connector setup — backed by /my-connectors/* (org-
// scoped secretVault storage), distinct from IntegrationCenter.jsx which
// manages the FOUNDER's own platform-wide connectors via operator-only
// /integrations/* and /vault/* routes. A customer's own WhatsApp/payment/
// email credentials are private to their organization.

// myConnectors.js's PROVIDERS also includes productivity (notion),
// project_management (jira, linear), and social (twitter) categories —
// these fell back to the raw category key as a section heading and a
// generic 🔌 icon since only the original 3 categories had labels here.
const CATEGORY_LABEL = {
  messaging: "Messaging", payments: "Payments", email: "Email",
  productivity: "Productivity", project_management: "Project Management", social: "Social",
};
const CATEGORY_ICON = {
  messaging: "💬", payments: "₹", email: "✉",
  productivity: "🗂", project_management: "📋", social: "📣",
};

function ProviderCard({ provider, onSave, onRemove, onToast }) {
  const [expanded, setExpanded] = useState(false);
  const [values, setValues] = useState({});
  const [busy, setBusy] = useState(false);

  const handleSave = async () => {
    const payload = {};
    for (const f of provider.fields) if (values[f.key]?.trim()) payload[f.key] = values[f.key].trim();
    if (!Object.keys(payload).length) { onToast?.("error", "Enter at least one credential"); return; }
    setBusy(true);
    const ok = await onSave(provider.id, payload);
    setBusy(false);
    if (ok) { setExpanded(false); setValues({}); }
  };

  return (
    <div className={`csw-card${provider.connected ? " csw-card--connected" : ""}`}>
      <div
        className="csw-card-header"
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={() => setExpanded(e => !e)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded(x => !x);
          }
        }}
      >
        <span className="csw-card-icon">{CATEGORY_ICON[provider.category] || "🔌"}</span>
        <div className="csw-card-info">
          <span className="csw-card-name">{provider.label}</span>
          <span className="csw-card-status">
            {provider.connected ? "✓ Connected" : "Not connected"}
          </span>
        </div>
        <button className="csw-card-toggle">{expanded ? "▲" : "▼"}</button>
      </div>

      {expanded && (
        <div className="csw-card-body">
          {provider.fields.map(f => (
            <div key={f.key} className="csw-field">
              <label className="csw-field-label">{f.label} {f.present && <span className="csw-field-set">✓ set</span>}</label>
              <input
                type={f.type}
                className="csw-input"
                placeholder={f.present ? "•••••••••• (leave blank to keep)" : `Enter ${f.label}`}
                value={values[f.key] || ""}
                onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
              />
            </div>
          ))}
          <div className="csw-card-actions">
            <button className="csw-btn primary" onClick={handleSave} disabled={busy}>
              {busy ? "Saving…" : provider.connected ? "Update" : "Connect"}
            </button>
            {provider.connected && (
              <button className="csw-btn danger" onClick={() => onRemove(provider.id, provider.label)}>Disconnect</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ConnectorSetupWizard({ onToast }) {
  const [providers, setProviders] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Phase A.11.7 — Disconnect permanently deletes this organization's stored
  // third-party credentials from the vault (DELETE /my-connectors/:id), for the
  // whole org, with no undo. Measured live: a single click removed a real
  // stored WhatsApp credential with `confirmDialog: false` and no native
  // dialog either. Every other destructive action in the app already routes
  // through this same shared hook — A.11.2 wired CRM's deletes, A.11.5 wired
  // OrgAdminCenter's five sites (replacing raw window.confirm). Reusing the
  // existing ConfirmDialog/useConfirm, not a new component.
  const [confirm, ConfirmUI] = useConfirm();

  const load = useCallback(async () => {
    setLoading(true);
    const r = await _fetch("/my-connectors").catch(e => ({ ok: false, error: e.message }));
    setLoading(false);
    if (r.ok === false) { setError(r.error || "Could not load connectors"); return; }
    setError("");
    setProviders(r.providers || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (providerId, payload) => {
    const r = await _fetch(`/my-connectors/${providerId}`, { method: "POST", body: JSON.stringify(payload) })
      .catch(e => ({ ok: false, error: e.message }));
    if (r.ok === false) { onToast?.("error", r.error || "Failed to save credentials"); return false; }
    onToast?.("success", "Connector saved");
    load();
    return true;
  };

  const handleRemove = async (providerId, providerLabel) => {
    const okToRemove = await confirm({
      title: `Disconnect ${providerLabel || providerId}?`,
      message: `This permanently removes your organization's stored ${providerLabel || providerId} credentials. Anything Ooplix runs through ${providerLabel || providerId} will stop working until you connect it again.`,
      danger: true,
      confirmLabel: "Disconnect",
    });
    if (!okToRemove) return;
    const r = await _fetch(`/my-connectors/${providerId}`, { method: "DELETE" }).catch(e => ({ ok: false, error: e.message }));
    if (r.ok === false) { onToast?.("error", r.error || "Failed to disconnect"); return; }
    onToast?.("success", "Disconnected");
    load();
  };

  if (loading) return <div className="connector-setup-wizard csw-loading">Loading connectors…</div>;

  if (error) {
    // Previously a dead end: no Retry affordance, unlike every other
    // error state in the app (BosError, CdErrorState, WorkspaceSettingsL2's
    // L2ErrorState, etc.) — a transient failure here permanently hid the
    // customer's own connector list until they navigated away and back.
    return (
      <div className="connector-setup-wizard">
        <div className="csw-empty">
          <p className="csw-empty-title">{error}</p>
          <button className="csw-btn primary" onClick={load}>Retry</button>
        </div>
      </div>
    );
  }

  const grouped = {};
  for (const p of providers || []) { (grouped[p.category] ||= []).push(p); }

  return (
    <div className="connector-setup-wizard page-enter">
      <div className="csw-header">
        <h1 className="csw-title">Connectors</h1>
        <p className="csw-subtitle">Connect your own WhatsApp, payment, and email accounts so Ooplix can act on your behalf.</p>
      </div>

      {Object.entries(grouped).map(([cat, list]) => (
        <div key={cat} className="csw-section">
          <h3 className="csw-section-title">{CATEGORY_LABEL[cat] || cat}</h3>
          <div className="csw-card-list">
            {list.map(p => (
              <ProviderCard key={p.id} provider={p} onSave={handleSave} onRemove={handleRemove} onToast={onToast} />
            ))}
          </div>
        </div>
      ))}
      {ConfirmUI}
    </div>
  );
}
