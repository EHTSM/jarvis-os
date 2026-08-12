import React, { useState, useCallback, useEffect, useMemo } from "react";
import { track } from "../analytics";
import { listOAuthConnections, revokeOAuth, refreshOAuth, getOAuthUrl } from "../phase21Api";
import {
  getVaultDashboard, getCredentialTypes, getVaultSecrets, storeSecret, validateSecret,
  rotateSecret, deleteSecret, getVaultHistory,
  getAllIntegrations, checkIntegrationHealth, reconnectIntegration,
} from "../connectorApi";
import "./IntegrationCenter.css";

// ── Connector Center (Module 5) ──────────────────────────────────────────────
// Rebuilt on the real backend: founderVault.js (54 connectors, 12 credential
// types, operator-only) + integrations.js (live scan/probe, any authed user).
// Previously this component only covered 8 hardcoded OAuth-style connectors
// via phase21Api — the vault/integrations backends had no frontend at all.

// integrationConnectors.cjs's reconnect()/getHealth() only implement probe
// functions for these phases (see its `fns` dispatch map) — "email" connectors
// exist in the vault (credential storage, all 6 providers) but have no live
// probe function, so calling /integrations/:id/health for them throws
// "Unknown connector" server-side (500). Gate the call rather than let every
// email connector's detail panel fire a doomed request.
// "issue" (Jira/Linear) added — Phase 6 connector reachability audit found
// scanAllProjectManagementProviders()/reconnect()'s "issue" dispatch group
// already probe both connectJira()/connectLinear() for real, this set just
// hadn't been updated when that phase was added.
const HEALTH_PROBE_PHASES = new Set(["ai", "git", "infra", "pay", "msg", "auth", "prod", "commerce", "creative", "auto", "monitor", "issue"]);

const PHASE_LABEL = {
  ai: "AI Providers", auth: "Authentication", auto: "Automation", commerce: "Commerce",
  creative: "Creative", email: "Email", git: "Git", infra: "Infrastructure",
  monitor: "Monitoring", msg: "Messaging", pay: "Payments", prod: "Productivity",
  issue: "Project Management",
};

const CONNECTOR_NAME = {
  "ai:anthropic": "Anthropic", "ai:cohere": "Cohere", "ai:deepseek": "DeepSeek",
  "ai:fireworks": "Fireworks AI", "ai:gemini": "Google Gemini", "ai:grok": "Grok (x.ai)",
  "ai:groq": "Groq", "ai:nvidia": "NVIDIA NIM", "ai:openai": "OpenAI",
  "ai:openrouter": "OpenRouter", "ai:qwen": "Qwen (DashScope)", "ai:together": "Together AI",
  "auth:apple": "Sign in with Apple", "auth:discord": "Discord OAuth",
  "auth:github": "GitHub OAuth", "auth:google": "Google OAuth",
  "auth:linkedin": "LinkedIn OAuth", "auth:microsoft": "Microsoft OAuth",
  "auto:make": "Make (Integromat)", "auto:n8n": "n8n", "auto:zapier": "Zapier",
  "commerce:shopify": "Shopify", "commerce:woocommerce": "WooCommerce",
  "commerce:wordpress": "WordPress",
  "creative:canva": "Canva", "creative:figma": "Figma",
  "email:brevo": "Brevo", "email:mailgun": "Mailgun", "email:postmark": "Postmark",
  "email:resend": "Resend", "email:sendgrid": "SendGrid", "email:smtp": "SMTP",
  "git:bitbucket": "Bitbucket", "git:github": "GitHub", "git:gitlab": "GitLab",
  "infra:aws": "AWS", "infra:cloudflare": "Cloudflare", "infra:firebase": "Firebase",
  "infra:hostinger": "Hostinger", "infra:r2": "Cloudflare R2", "infra:supabase": "Supabase",
  "issue:jira": "Jira", "issue:linear": "Linear",
  "monitor:datadog": "Datadog", "monitor:sentry": "Sentry", "monitor:uptime": "UptimeRobot",
  "msg:discord": "Discord", "msg:slack": "Slack", "msg:teams": "Microsoft Teams",
  "msg:telegram": "Telegram", "msg:twilio": "Twilio", "msg:whatsapp": "WhatsApp Business",
  "pay:lemonsqueezy": "Lemon Squeezy", "pay:paddle": "Paddle",
  "pay:razorpay": "Razorpay", "pay:stripe": "Stripe",
  "prod:dropbox": "Dropbox", "prod:google_workspace": "Google Workspace",
  "prod:m365": "Microsoft 365", "prod:notion": "Notion",
};

function _label(connectorId) {
  return CONNECTOR_NAME[connectorId] || connectorId.split(":")[1]?.replace(/_/g, " ") || connectorId;
}
function _phaseOf(connectorId) { return connectorId.split(":")[0]; }
function _phaseLabel(connectorId) { return PHASE_LABEL[_phaseOf(connectorId)] || _phaseOf(connectorId); }

// getCredentialTypes() returns all 12 vault-wide credential types in a fixed
// order (oauth_token first) — that's not "the type this connector actually
// uses," it's just the vault's global catalog. Defaulting the setup form's
// dropdown to types[0] would silently default nearly every non-OAuth
// connector to "oauth_token", which is wrong. Best-effort guess from the
// connector id/phase instead; the dropdown remains fully overridable.
function _likelyCredentialType(connectorId) {
  const [phase, id] = connectorId.split(":");
  // auth:apple's ENV_MAP entry is auth:apple::ssh_key (APPLE_PRIVATE_KEY),
  // not oauth_token like its other auth: siblings.
  if (id === "apple") return "ssh_key";
  if (phase === "auth") return "oauth_token";
  if (id === "smtp") return "smtp_credentials";
  if (phase === "git" || phase === "creative" || id === "jira") return "personal_access_token";
  if (id === "google_workspace" || id === "firebase") return "service_account_json";
  return "api_key";
}

// OAuth-style connectors get the browser-redirect flow via phase21Api; everything
// else (API keys, tokens, SMTP creds etc.) gets the vault setup form.
// auth:discord and auth:apple were listed here but oauthIntegrationLayer.cjs's
// _cfg() has no "discord" or "apple" config block — it only implements
// google/github/slack/notion/microsoft/linkedin (see ExecutionConnectorCenter.jsx's
// CONNECTOR_META, which correctly covers exactly those 6). Both were dead ends:
// clicking "Connect" for auth:discord threw a 500 from getOAuthUrl("discord")
// (cfg.clientId reads off undefined), and auth:apple wasn't even in
// OAUTH_PROVIDER_ID below, so its button silently did nothing. Both connectors
// are real, though — connectDiscordAuth()/connectAppleAuth() in
// integrationConnectors.cjs verify DISCORD_CLIENT_ID/APPLE_TEAM_ID+co via live
// probes, and both have ENV_MAP entries in secretVault.cjs — they just need the
// vault SetupForm path (like auth:linkedin's siblings that aren't OAuth-login
// providers), not the OAuth-redirect path.
const OAUTH_CONNECTORS = new Set([
  "auth:google", "auth:github", "auth:linkedin", "auth:microsoft",
]);
// phase21Api's OAuth provider ids are unnamespaced (google, github, ...) — map both ways.
const OAUTH_PROVIDER_ID = { "auth:google": "google", "auth:github": "github", "auth:linkedin": "linkedin", "auth:microsoft": "microsoft" };

const STATUS_COLOR = { connected: "var(--success)", missing: "var(--text-faint)", expiring: "var(--warning)", overdue: "var(--danger)" };

function ConnectorCard({ connectorId, connected, health, onOpen, isSelected }) {
  const color = STATUS_COLOR[health || (connected ? "connected" : "missing")];
  return (
    <div
      className={`ic-card${connected ? " ic-card--connected" : ""}${isSelected ? " ic-card--selected" : ""}`}
      onClick={() => onOpen(connectorId)}
    >
      <div className="ic-card-header">
        <div className="ic-icon-wrap" style={{ background: color + "18", borderColor: color + "33" }}>
          <span className="ic-icon" style={{ color, fontSize: 13, fontWeight: 700 }}>
            {_label(connectorId).slice(0, 2).toUpperCase()}
          </span>
        </div>
        <div className="ic-card-meta">
          <span className="ic-card-name">{_label(connectorId)}</span>
          <span className="ic-card-category">{_phaseLabel(connectorId)}</span>
        </div>
        <span className="ic-status-dot" style={{ background: color }} title={connected ? "Connected" : "Not configured"} />
      </div>
      <div className="ic-card-footer">
        {connected ? (
          <span className="ic-sync-text" style={{ color: "var(--success)" }}>✓ Configured</span>
        ) : (
          <button className="ic-btn ic-btn--connect" onClick={e => { e.stopPropagation(); onOpen(connectorId); }}>
            Set up →
          </button>
        )}
      </div>
    </div>
  );
}

function SetupForm({ connectorId, credentialTypes, onSaved, onCancel, showToast }) {
  const [type, setType]   = useState(() => {
    const likely = _likelyCredentialType(connectorId);
    return credentialTypes.some(t => t.type === likely) ? likely : (credentialTypes[0]?.type || "api_key");
  });
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = useCallback(async () => {
    if (!value.trim()) return;
    setSaving(true);
    try {
      const res = await storeSecret(connectorId, type, value.trim());
      if (res.ok) {
        showToast(`${_label(connectorId)} credential saved`);
        onSaved();
      } else {
        showToast(res.error || "Save failed");
      }
    } finally {
      setSaving(false);
    }
  }, [connectorId, type, value, onSaved, showToast]);

  return (
    <div className="ic-detail-section">
      <p className="ic-detail-label">Add credential</p>
      <select className="ic-setup-select" value={type} onChange={e => setType(e.target.value)}>
        {credentialTypes.map(t => <option key={t.type} value={t.type}>{t.type.replace(/_/g, " ")}</option>)}
      </select>
      <textarea
        className="ic-setup-input"
        placeholder="Paste credential value…"
        value={value}
        onChange={e => setValue(e.target.value)}
        rows={3}
      />
      <div className="ic-detail-actions">
        <button className="ic-detail-btn ic-detail-btn--secondary" onClick={onCancel}>Cancel</button>
        <button className="ic-detail-btn ic-detail-btn--primary" disabled={saving || !value.trim()} onClick={submit}>
          {saving ? "Saving…" : "Save credential"}
        </button>
      </div>
    </div>
  );
}

function DetailPanel({ connectorId, connected, credentialTypes, canManageVault, onClose, showToast, onChanged }) {
  const [adding, setAdding]   = useState(false);
  const [busy, setBusy]       = useState(false);
  const [history, setHistory] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [storedType, setStoredType] = useState(null); // the actual credential type on file, if any
  const [storedRecord, setStoredRecord] = useState(null); // full record (rotationDueAt/lastValidatedAt/lastFailure) — metadata only, never a value
  const isOAuth = OAUTH_CONNECTORS.has(connectorId);

  const refetchStoredState = useCallback(() => {
    if (!canManageVault) return;
    getVaultHistory(connectorId).then(r => setHistory(r.ok !== false ? r.history : null));
    getVaultSecrets({ connectorId }).then(r => {
      const rec = r.ok !== false ? r.secrets?.[0] : null;
      setStoredType(rec ? rec.type : null);
      setStoredRecord(rec || null);
    });
  }, [connectorId, canManageVault]);

  useEffect(() => {
    setAdding(false);
    setMetrics(null);
    setStoredType(null);
    setStoredRecord(null);
    refetchStoredState();
    if (HEALTH_PROBE_PHASES.has(_phaseOf(connectorId))) {
      checkIntegrationHealth(connectorId).then(r => setMetrics(r.ok !== false ? r : null)).catch(() => {});
    }
  }, [connectorId, canManageVault, refetchStoredState]);

  const handleOAuthConnect = useCallback(async () => {
    const providerId = OAUTH_PROVIDER_ID[connectorId];
    if (!providerId) return;
    track.event("integration_connect_clicked", { id: connectorId });
    try {
      const res = await getOAuthUrl(providerId);
      if (res?.url) window.location.href = res.url;
      else showToast("OAuth not configured in .env for this provider");
    } catch { showToast("Connect failed"); }
  }, [connectorId, showToast]);

  const handleOAuthRefresh = useCallback(async () => {
    const providerId = OAUTH_PROVIDER_ID[connectorId];
    if (!providerId) return;
    setBusy(true);
    try {
      await refreshOAuth(providerId);
      showToast(`${_label(connectorId)} token refreshed`);
    } catch { showToast("Refresh failed — reconnect may be required"); }
    finally { setBusy(false); }
  }, [connectorId, showToast]);

  const handleOAuthDisconnect = useCallback(async () => {
    const providerId = OAUTH_PROVIDER_ID[connectorId];
    if (!providerId) return;
    setBusy(true);
    try {
      await revokeOAuth(providerId);
      showToast(`${_label(connectorId)} disconnected`);
      onChanged();
    } catch { showToast("Disconnect failed"); }
    finally { setBusy(false); }
  }, [connectorId, showToast, onChanged]);

  const handleValidate = useCallback(async () => {
    if (!storedType) return;
    setBusy(true);
    try {
      const res = await validateSecret(connectorId, storedType);
      showToast(res.valid ? "✓ Credential is valid" : (res.error || "Validation failed"));
    } finally { setBusy(false); }
  }, [connectorId, storedType, showToast]);

  const handleReconnect = useCallback(async () => {
    setBusy(true);
    try {
      const res = await reconnectIntegration(connectorId);
      showToast(res.ok !== false ? "Reconnected" : (res.error || "Reconnect failed"));
      onChanged();
    } finally { setBusy(false); }
  }, [connectorId, showToast, onChanged]);

  const handleDelete = useCallback(async (type) => {
    setBusy(true);
    try {
      await deleteSecret(connectorId, type);
      showToast(`${_label(connectorId)} credential removed`);
      refetchStoredState();
      onChanged();
    } finally { setBusy(false); }
  }, [connectorId, showToast, onChanged, refetchStoredState]);

  return (
    <div className="ic-detail">
      <div className="ic-detail-header">
        <div className="ic-icon-wrap ic-icon-wrap--lg">
          <span className="ic-icon ic-icon--lg">{_label(connectorId).slice(0, 2).toUpperCase()}</span>
        </div>
        <div>
          <h3 className="ic-detail-name">{_label(connectorId)}</h3>
          <span className={`ic-detail-status ic-detail-status--${connected ? "connected" : "disconnected"}`}>
            {connected ? "configured" : "not configured"}
          </span>
        </div>
        <button className="ic-detail-close" onClick={onClose}>✕</button>
      </div>

      <p className="ic-detail-desc">{_phaseLabel(connectorId)} · {connectorId}</p>

      {metrics && (
        <div className="ic-detail-section">
          <p className="ic-detail-label">Health</p>
          <div className="ic-sync-info">
            <span className={`ic-sync-badge ic-sync-badge--${metrics.status === "CONNECTED" ? "ok" : "warn"}`}>
              ● {metrics.status || "unknown"}
            </span>
            {metrics.syncCount != null && <span className="ic-sync-time">{metrics.syncCount} syncs</span>}
          </div>
        </div>
      )}
      {!HEALTH_PROBE_PHASES.has(_phaseOf(connectorId)) && (
        <div className="ic-detail-section">
          <p className="ic-detail-label">Health</p>
          <p className="ic-detail-sub">Live health checks aren't wired up for {_phaseLabel(connectorId)} connectors yet — credential status only.</p>
        </div>
      )}

      {canManageVault && storedRecord && (
        <div className="ic-detail-section">
          <p className="ic-detail-label">Credential status</p>
          <p className="ic-detail-sub">
            Last verified: {storedRecord.lastValidatedAt ? new Date(storedRecord.lastValidatedAt).toLocaleString() : "never"}
          </p>
          {storedRecord.rotationDueAt && (
            <p className="ic-detail-sub">
              Rotation due: {new Date(storedRecord.rotationDueAt).toLocaleDateString()}
              {new Date(storedRecord.rotationDueAt) < new Date() && <span style={{ color: 'var(--danger)', marginLeft: 6 }}>⚠ overdue</span>}
            </p>
          )}
          {storedRecord.lastFailure?.reason && (
            <p className="ic-detail-sub" style={{ color: 'var(--danger)' }}>
              Last failure: {storedRecord.lastFailure.reason} ({storedRecord.lastFailure.ts ? new Date(storedRecord.lastFailure.ts).toLocaleString() : ""})
            </p>
          )}
        </div>
      )}

      {canManageVault && history?.length > 0 && (
        <div className="ic-detail-section">
          <p className="ic-detail-label">Recent activity</p>
          {history.slice(0, 5).map((h, i) => (
            <p key={i} className="ic-detail-sub">{h.action} · {new Date(h.ts || h.timestamp).toLocaleString()}</p>
          ))}
        </div>
      )}

      <div className="ic-detail-actions">
        {isOAuth ? (
          connected ? (
            <>
              <button className="ic-detail-btn ic-detail-btn--secondary" disabled={busy} onClick={handleOAuthRefresh}>
                Refresh token
              </button>
              <button className="ic-detail-btn ic-detail-btn--danger" disabled={busy} onClick={handleOAuthDisconnect}>
                Disconnect
              </button>
            </>
          ) : (
            <button className="ic-detail-btn ic-detail-btn--primary" onClick={handleOAuthConnect}>
              Connect {_label(connectorId)} →
            </button>
          )
        ) : canManageVault ? (
          adding ? (
            <SetupForm
              connectorId={connectorId}
              credentialTypes={credentialTypes}
              onSaved={() => { setAdding(false); refetchStoredState(); onChanged(); }}
              onCancel={() => setAdding(false)}
              showToast={showToast}
            />
          ) : (
            <>
              {connected && storedType && (
                <button className="ic-detail-btn ic-detail-btn--secondary" disabled={busy} onClick={handleValidate}>
                  Validate
                </button>
              )}
              {connected && HEALTH_PROBE_PHASES.has(_phaseOf(connectorId)) && (
                <button className="ic-detail-btn ic-detail-btn--secondary" disabled={busy} onClick={handleReconnect}>
                  Check health
                </button>
              )}
              {connected && storedType && (
                <button
                  className="ic-detail-btn ic-detail-btn--danger"
                  disabled={busy}
                  onClick={() => handleDelete(storedType)}
                >
                  Remove
                </button>
              )}
              <button className="ic-detail-btn ic-detail-btn--primary" onClick={() => setAdding(true)}>
                {connected ? "Rotate / add credential" : "Set up"}
              </button>
            </>
          )
        ) : (
          <p className="ic-detail-sub">Credential management requires operator access.</p>
        )}
      </div>
    </div>
  );
}

export default function IntegrationCenter({ onNavigate }) {
  const [dashboard, setDashboard] = useState(null);
  const [credTypes, setCredTypes] = useState([]);
  const [liveStatus, setLiveStatus] = useState({});
  const [oauthConnected, setOauthConnected] = useState(new Set());
  const [canManageVault, setCanManageVault] = useState(true);
  const [phase, setPhase] = useState("all");
  const [selected, setSelected] = useState(null);
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(true);

  const showToast = useCallback((m) => { setToast(m); setTimeout(() => setToast(null), 2800); }, []);

  const load = useCallback(async () => {
    const [vd, ct, oauthConns, allInteg] = await Promise.all([
      getVaultDashboard(),
      getCredentialTypes(),
      listOAuthConnections().catch(() => null),
      getAllIntegrations().catch(() => null),
    ]);

    if (vd.status === 401 || vd.status === 403) {
      setCanManageVault(false);
      setDashboard(null);
    } else if (vd.ok !== false) {
      setDashboard(vd);
    }
    if (ct.ok !== false) setCredTypes(ct.types || []);

    const status = {};
    for (const c of allInteg?.connectors || []) status[c.id] = c.status;
    setLiveStatus(status);

    // OAuth "connected" means the current user completed authorization, not
    // just that the OAuth app has client id/secret configured — vault's
    // env-based check only proves the latter, so override with the real
    // per-user connection list for the 6 OAuth-flow connectors.
    const connectedProviders = new Set((oauthConns?.connections || []).map(c => c.provider));
    const oauthIds = new Set();
    for (const [connectorId, providerId] of Object.entries(OAUTH_PROVIDER_ID)) {
      if (connectedProviders.has(providerId)) oauthIds.add(connectorId);
    }
    setOauthConnected(oauthIds);

    track.event("integration_center_viewed");
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const allConnectorIds = useMemo(() => {
    if (!dashboard) return Object.keys(CONNECTOR_NAME).sort();
    return [...dashboard.connected, ...dashboard.missing].sort();
  }, [dashboard]);

  const connectedSet = useMemo(() => {
    const set = new Set(dashboard?.connected || []);
    // OAuth connectors: real per-user auth state wins over vault's "app configured" check.
    for (const id of Object.keys(OAUTH_PROVIDER_ID)) {
      if (oauthConnected.has(id)) set.add(id); else set.delete(id);
    }
    return set;
  }, [dashboard, oauthConnected]);

  const phases = useMemo(() => {
    const set = new Set(allConnectorIds.map(_phaseOf));
    return [{ id: "all", label: "All" }, ...[...set].sort().map(p => ({ id: p, label: PHASE_LABEL[p] || p }))];
  }, [allConnectorIds]);

  const visible = phase === "all" ? allConnectorIds : allConnectorIds.filter(id => _phaseOf(id) === phase);
  const connectedCount = connectedSet.size;

  return (
    <div className="integration-center page-enter">
      {toast && <div className="ic-toast">{toast}</div>}

      <div className="ic-header">
        <div>
          <h1 className="ic-title">Connector Center</h1>
          <p className="ic-subtitle">
            {canManageVault
              ? "Set up credentials, monitor health, and manage every connected service."
              : "Connector health overview. Credential management requires operator access."}
          </p>
        </div>
        <div className="ic-header-stat">
          <span className="ic-stat-num" style={{ color: connectedCount > 0 ? "var(--success)" : "var(--text-faint)" }}>
            {connectedCount}
          </span>
          <span className="ic-stat-label">of {allConnectorIds.length} configured</span>
        </div>
      </div>

      <div className="ic-cats">
        {phases.map(p => (
          <button
            key={p.id}
            className={`ic-cat${phase === p.id ? " ic-cat--active" : ""}`}
            onClick={() => setPhase(p.id)}
          >{p.label}</button>
        ))}
      </div>

      {!loading && dashboard?.health && (dashboard.health.overdue > 0 || dashboard.health.expiring > 0) && (
        <div className="ic-banner">
          <span className="ic-banner-icon">⚠</span>
          <div>
            <p className="ic-banner-title">Credential rotation needed</p>
            <p className="ic-banner-sub">
              {dashboard.health.overdue > 0 && `${dashboard.health.overdue} overdue`}
              {dashboard.health.overdue > 0 && dashboard.health.expiring > 0 && " · "}
              {dashboard.health.expiring > 0 && `${dashboard.health.expiring} expiring soon`}
            </p>
          </div>
        </div>
      )}

      <div className="ic-layout">
        <div className="ic-grid">
          {loading ? (
            <p className="ic-detail-sub">Loading connectors…</p>
          ) : visible.map(id => (
            <ConnectorCard
              key={id}
              connectorId={id}
              connected={connectedSet.has(id)}
              health={liveStatus[id]}
              isSelected={selected === id}
              onOpen={cid => setSelected(prev => prev === cid ? null : cid)}
            />
          ))}
        </div>

        {selected && (
          <DetailPanel
            connectorId={selected}
            connected={connectedSet.has(selected)}
            credentialTypes={credTypes}
            canManageVault={canManageVault}
            onClose={() => setSelected(null)}
            showToast={showToast}
            onChanged={load}
          />
        )}
      </div>
    </div>
  );
}
