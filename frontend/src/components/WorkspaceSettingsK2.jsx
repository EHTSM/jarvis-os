import React, { useState, useEffect, useCallback, useRef } from "react";
import { _fetch } from "../_client";
import { Toggle, FieldRow } from "./WorkspaceSettingsShared";

// ── K2 Security helpers ───────────────────────────────────────────
const SCORE_COLOR = s => s >= 85 ? "#52d68a" : s >= 70 ? "var(--warning)" : s >= 55 ? "#ffaa00" : "var(--error)";
function _fmtTs(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function _timeAgo(ts) {
  if (!ts) return "never";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
}

// ── K2 — Security Score ───────────────────────────────────────────
function SecurityScore({ score, grade, factors }) {
  if (!score) return null;
  const color = SCORE_COLOR(score);
  return (
    <div className="k2-score-card">
      <div className="k2-score-ring" style={{ "--score-color": color }}>
        <span className="k2-score-num" style={{ color }}>{score}</span>
        <span className="k2-score-grade" style={{ color }}>{grade}</span>
      </div>
      <div className="k2-score-factors">
        {[
          ["MFA enabled",     factors?.mfa],
          ["Audit log",       factors?.auditLog],
          ["Device trust",    factors?.deviceTrust],
          ["IP allowlist",    factors?.ipAllowlist],
          ["Short sessions",  factors?.shortSessions],
        ].map(([label, ok]) => (
          <span key={label} className={`k2-factor${ok ? " k2-factor--ok" : ""}`}>
            <span>{ok ? "✓" : "○"}</span> {label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── K2 — Sessions Panel ───────────────────────────────────────────
function SessionsPanel() {
  const [sessions, setSessions] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [toast,    setToast]    = useState(null);

  const doToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2800); };

  useEffect(() => {
    _fetch("/security/sessions").then(d => setSessions(d.sessions || [])).catch(() => {}).finally(() => setLoading(false));
  }, []);

  async function revoke(id) {
    try {
      await _fetch(`/security/session/${id}`, { method: "DELETE" });
      setSessions(s => s.filter(x => x.id !== id));
      doToast("Session revoked");
    } catch (e) { doToast(e.message || "Failed"); }
  }

  if (loading) return <div className="k2-loading">Loading sessions…</div>;
  return (
    <div className="k2-list">
      {toast && <div className="tw-toast">{toast}</div>}
      {sessions.length === 0 && <div className="k2-empty">No active sessions recorded.</div>}
      {sessions.map(s => (
        <div key={s.id} className={`k2-row${s.isCurrent ? " k2-row--current" : ""}`}>
          <span className="k2-row-icon">⬡</span>
          <div className="k2-row-meta">
            <span className="k2-row-title">{s.userAgent || "Unknown browser"} {s.isCurrent && <span className="k2-badge k2-badge--green">Current</span>}</span>
            <span className="k2-row-sub">IP: {s.ip || "—"} · Last seen: {_timeAgo(s.lastSeenAt)}</span>
          </div>
          {!s.isCurrent && (
            <button className="k2-revoke-btn" onClick={() => revoke(s.id)}>Revoke</button>
          )}
        </div>
      ))}
    </div>
  );
}

// ── K2 — Devices Panel ───────────────────────────────────────────
function DevicesPanel() {
  const [devices,  setDevices]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [toast,    setToast]    = useState(null);

  const doToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2800); };

  useEffect(() => {
    _fetch("/security/devices").then(d => setDevices(d.devices || [])).catch(() => {}).finally(() => setLoading(false));
  }, []);

  async function trust(id) {
    try {
      const d = await _fetch(`/security/device/${id}/trust`, { method: "PATCH" });
      setDevices(prev => prev.map(x => x.id === id ? d.device : x));
      doToast("Device trusted");
    } catch (e) { doToast(e.message || "Failed"); }
  }

  async function remove(id) {
    try {
      await _fetch(`/security/device/${id}`, { method: "DELETE" });
      setDevices(s => s.filter(x => x.id !== id));
      doToast("Device removed");
    } catch (e) { doToast(e.message || "Failed"); }
  }

  if (loading) return <div className="k2-loading">Loading devices…</div>;
  return (
    <div className="k2-list">
      {toast && <div className="tw-toast">{toast}</div>}
      {devices.length === 0 && <div className="k2-empty">No devices registered. Devices are registered on login.</div>}
      {devices.map(d => (
        <div key={d.id} className="k2-row">
          <span className="k2-row-icon">{d.trusted ? "◉" : "○"}</span>
          <div className="k2-row-meta">
            <span className="k2-row-title">{d.name} {d.trusted && <span className="k2-badge k2-badge--green">Trusted</span>}</span>
            <span className="k2-row-sub">Added {_fmtTs(d.createdAt)} · Last seen {_timeAgo(d.lastSeenAt)}</span>
          </div>
          <div className="k2-row-actions">
            {!d.trusted && <button className="k2-trust-btn" onClick={() => trust(d.id)}>Trust</button>}
            <button className="k2-revoke-btn" onClick={() => remove(d.id)}>Remove</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── K2 — Audit Log Panel ─────────────────────────────────────────
function AuditPanel() {
  const [log,     setLog]     = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    _fetch("/security/audit?limit=100").then(d => setLog(d.audit || [])).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const ACTION_COLOR = {
    "session":  "var(--accent)",
    "device":   "var(--accent2)",
    "token":    "var(--warning)",
    "policy":   "#52d68a",
    "workspace":"var(--text-dim)",
  };
  const color = (action) => {
    const key = Object.keys(ACTION_COLOR).find(k => action.startsWith(k));
    return key ? ACTION_COLOR[key] : "var(--text-faint)";
  };

  if (loading) return <div className="k2-loading">Loading audit log…</div>;
  return (
    <div className="k2-audit-list">
      {log.length === 0 && <div className="k2-empty">No audit events yet.</div>}
      {log.map((e, i) => (
        <div key={e.id || i} className="k2-audit-row">
          <span className="k2-audit-dot" style={{ background: color(e.action || "") }} />
          <span className="k2-audit-ts">{_timeAgo(e.ts)}</span>
          <span className="k2-audit-action" style={{ color: color(e.action || "") }}>{e.action}</span>
          {e.detail && <span className="k2-audit-detail">{e.detail}</span>}
          <span className={`k2-badge k2-badge--${e.outcome === "success" ? "green" : "red"}`}>{e.outcome}</span>
        </div>
      ))}
    </div>
  );
}

// ── K2 — API Tokens Panel ─────────────────────────────────────────
const TOKEN_SCOPES = ["read:all", "write:missions", "write:agents", "admin:workspace", "read:analytics"];

function TokensPanel() {
  const [tokens,     setTokens]     = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [creating,   setCreating]   = useState(false);
  const [newName,    setNewName]    = useState("");
  const [newType,    setNewType]    = useState("pat");
  const [newScopes,  setNewScopes]  = useState(["read:all"]);
  const [newExpiry,  setNewExpiry]  = useState(90);
  const [created,    setCreated]    = useState(null); // one-time secret reveal
  const [toast,      setToast]      = useState(null);

  const doToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2800); };

  const load = useCallback(() => {
    _fetch("/security/tokens").then(d => setTokens(d.tokens || [])).catch(() => {}).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function create() {
    try {
      const d = await _fetch("/security/tokens", {
        method: "POST",
        body: JSON.stringify({ name: newName, type: newType, scopes: newScopes, expiresInDays: newExpiry }),
      });
      setCreated(d.token);
      setCreating(false); setNewName(""); setNewScopes(["read:all"]); setNewType("pat");
      load();
    } catch (e) { doToast(e.message || "Failed to create token"); }
  }

  async function revoke(id) {
    try {
      await _fetch(`/security/tokens/${id}`, { method: "DELETE" });
      setTokens(t => t.filter(x => x.id !== id));
      doToast("Token revoked");
    } catch (e) { doToast(e.message || "Failed"); }
  }

  if (loading) return <div className="k2-loading">Loading tokens…</div>;
  return (
    <div className="k2-tokens-panel">
      {toast && <div className="tw-toast">{toast}</div>}
      {created && (
        <div className="k2-secret-reveal">
          <div className="k2-secret-header">
            <span className="k2-badge k2-badge--green">Token created</span>
            <span className="k2-secret-note">Copy this secret now — it won't be shown again.</span>
          </div>
          <code className="k2-secret-val">{created.secret}</code>
          <button className="k2-revoke-btn" onClick={() => setCreated(null)}>Dismiss</button>
        </div>
      )}

      <div className="k2-tokens-header">
        <span>{tokens.length} active token{tokens.length !== 1 ? "s" : ""}</span>
        <button className="k2-create-btn" onClick={() => setCreating(c => !c)}>＋ New token</button>
      </div>

      {creating && (
        <div className="k2-token-form">
          <input className="k2-form-input" placeholder="Token name…" value={newName} onChange={e => setNewName(e.target.value)} />
          <select className="k2-form-select" value={newType} onChange={e => setNewType(e.target.value)}>
            <option value="pat">Personal Access Token</option>
            <option value="service">Service Token</option>
          </select>
          <select className="k2-form-select" value={newExpiry} onChange={e => setNewExpiry(Number(e.target.value))}>
            <option value={30}>Expires in 30 days</option>
            <option value={90}>Expires in 90 days</option>
            <option value={180}>Expires in 180 days</option>
            <option value={365}>Expires in 1 year</option>
          </select>
          <div className="k2-scopes-row">
            {TOKEN_SCOPES.map(s => (
              <label key={s} className="k2-scope-chip">
                <input
                  type="checkbox" checked={newScopes.includes(s)}
                  onChange={e => setNewScopes(prev => e.target.checked ? [...prev, s] : prev.filter(x => x !== s))}
                />
                {s}
              </label>
            ))}
          </div>
          <div className="k2-form-actions">
            <button className="k2-cancel-btn" onClick={() => setCreating(false)}>Cancel</button>
            <button className="k2-create-confirm" onClick={create} disabled={!newName.trim()}>Create token</button>
          </div>
        </div>
      )}

      <div className="k2-list">
        {tokens.length === 0 && !creating && <div className="k2-empty">No active tokens. Create one to integrate external tools.</div>}
        {tokens.map(t => (
          <div key={t.id} className="k2-row">
            <span className="k2-row-icon">{t.type === "service" ? "◈" : "◎"}</span>
            <div className="k2-row-meta">
              <span className="k2-row-title">
                {t.name}
                <span className="k2-badge k2-badge--dim">{t.type}</span>
              </span>
              <span className="k2-row-sub">
                Hint: {t.secretHint} · Expires {_fmtTs(t.expiresAt)} · Last used: {_timeAgo(t.lastUsedAt)}
              </span>
            </div>
            <button className="k2-revoke-btn" onClick={() => revoke(t.id)}>Revoke</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── K2 — Policies Panel ───────────────────────────────────────────
function PoliciesPanel() {
  const [policies, setPolicies] = useState(null);
  const [score,    setScore]    = useState(null);
  const [saving,   setSaving]   = useState(false);
  const [toast,    setToast]    = useState(null);

  const doToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2800); };

  useEffect(() => {
    _fetch("/security/policies")
      .then(d => { setPolicies(d.policies); setScore(d.score); })
      .catch(() => {});
  }, []);

  async function save() {
    setSaving(true);
    try {
      const d = await _fetch("/security/policies", { method: "PATCH", body: JSON.stringify(policies) });
      setPolicies(d.policies);
      doToast("Policies saved");
    } catch (e) { doToast(e.message || "Save failed"); }
    setSaving(false);
  }

  if (!policies) return <div className="k2-loading">Loading policies…</div>;
  return (
    <div className="k2-policies-panel">
      {toast && <div className="tw-toast">{toast}</div>}
      {score && <SecurityScore {...score} />}
      <div className="ws-fields" style={{ marginTop: 16 }}>
        <FieldRow label="Require MFA" hint="All workspace members must use two-factor authentication">
          <Toggle checked={policies.requireMfa} onChange={v => setPolicies(p => ({ ...p, requireMfa: v }))} />
        </FieldRow>
        <FieldRow label="Session timeout" hint="Auto-logout inactive sessions">
          <select className="ws-select" value={policies.sessionTimeoutHours}
            onChange={e => setPolicies(p => ({ ...p, sessionTimeoutHours: Number(e.target.value) }))}>
            <option value={1}>1 hour</option>
            <option value={4}>4 hours</option>
            <option value={8}>8 hours</option>
            <option value={24}>24 hours</option>
            <option value={168}>7 days</option>
          </select>
        </FieldRow>
        <FieldRow label="Max sessions per user" hint="Revoke oldest when limit exceeded">
          <select className="ws-select" value={policies.maxSessionsPerUser}
            onChange={e => setPolicies(p => ({ ...p, maxSessionsPerUser: Number(e.target.value) }))}>
            {[1, 2, 3, 5, 10].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </FieldRow>
        <FieldRow label="Enforce device trust" hint="Block unrecognised devices until trusted by Admin">
          <Toggle checked={policies.enforceDeviceTrust} onChange={v => setPolicies(p => ({ ...p, enforceDeviceTrust: v }))} />
        </FieldRow>
        <FieldRow label="Audit log" hint="Record all security events (required for compliance)">
          <Toggle checked={policies.auditLogEnabled} onChange={v => setPolicies(p => ({ ...p, auditLogEnabled: v }))} />
        </FieldRow>
        <FieldRow label="Token expiry (days)" hint="Default expiry for new API tokens">
          <select className="ws-select" value={policies.tokenExpiryDays}
            onChange={e => setPolicies(p => ({ ...p, tokenExpiryDays: Number(e.target.value) }))}>
            {[30, 60, 90, 180, 365].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </FieldRow>
        <FieldRow label="IP allowlist" hint="Comma-separated CIDR ranges. Leave blank for no restriction.">
          <input className="ws-input ws-input--mono"
            placeholder="e.g. 192.168.1.0/24, 10.0.0.1"
            value={(policies.ipAllowlist || []).join(", ")}
            onChange={e => setPolicies(p => ({
              ...p, ipAllowlist: e.target.value.split(",").map(s => s.trim()).filter(Boolean)
            }))}
          />
        </FieldRow>
        <FieldRow label="Allowed email domains" hint="Only allow sign-in from these domains. Leave blank for any.">
          <input className="ws-input ws-input--mono"
            placeholder="e.g. company.com, partner.io"
            value={(policies.allowedDomains || []).join(", ")}
            onChange={e => setPolicies(p => ({
              ...p, allowedDomains: e.target.value.split(",").map(s => s.trim()).filter(Boolean)
            }))}
          />
        </FieldRow>
      </div>
      <button className="ws-save-btn" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save policies"}</button>
    </div>
  );
}


export { SecurityScore, SessionsPanel, DevicesPanel, AuditPanel, TokensPanel, PoliciesPanel };
