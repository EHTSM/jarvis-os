import React, { useState, useEffect, useCallback } from "react";
import { _fetch } from "../_client";
import "./ConnectorSetupWizard.css";

// Real customer-facing connector setup — backed by /my-connectors/* (org-
// scoped secretVault storage), distinct from IntegrationCenter.jsx which
// manages the FOUNDER's own platform-wide connectors via operator-only
// /integrations/* and /vault/* routes. A customer's own WhatsApp/payment/
// email credentials are private to their organization.

const CATEGORY_LABEL = { messaging: "Messaging", payments: "Payments", email: "Email" };
const CATEGORY_ICON  = { messaging: "💬", payments: "₹", email: "✉" };

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
      <div className="csw-card-header" onClick={() => setExpanded(e => !e)}>
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
              <button className="csw-btn danger" onClick={() => onRemove(provider.id)}>Disconnect</button>
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

  const handleRemove = async (providerId) => {
    const r = await _fetch(`/my-connectors/${providerId}`, { method: "DELETE" }).catch(e => ({ ok: false, error: e.message }));
    if (r.ok === false) { onToast?.("error", r.error || "Failed to disconnect"); return; }
    onToast?.("success", "Disconnected");
    load();
  };

  if (loading) return <div className="connector-setup-wizard csw-loading">Loading connectors…</div>;

  if (error) {
    return (
      <div className="connector-setup-wizard">
        <div className="csw-empty">
          <p className="csw-empty-title">{error}</p>
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
    </div>
  );
}
