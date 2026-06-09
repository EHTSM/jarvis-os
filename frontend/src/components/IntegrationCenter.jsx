import React, { useState, useCallback, useEffect } from "react";
import { track } from "../analytics";
import { getOAuthProviderStatus, listOAuthConnections, revokeOAuth, getOAuthUrl } from "../phase21Api";
import "./IntegrationCenter.css";

// ── Integration definitions ───────────────────────────────────────────
const INTEGRATIONS = [
  {
    id:       "gmail",
    name:     "Gmail",
    category: "communication",
    icon:     "G",
    color:    "#ea4335",
    desc:     "Read and send emails, sync contacts, trigger workflows from incoming mail.",
    status:   "disconnected",
    permissions: ["Read emails", "Send emails", "Manage contacts"],
    syncStatus:  null,
    health:   null,
    setupUrl: "https://console.cloud.google.com",
  },
  {
    id:       "gdrive",
    name:     "Google Drive",
    category: "storage",
    icon:     "▲",
    color:    "#fbbc04",
    desc:     "Access files and folders, read documents into the Knowledge Base, write reports.",
    status:   "disconnected",
    permissions: ["Read files", "Write files", "List folders"],
    syncStatus:  null,
    health:   null,
    setupUrl: "https://console.cloud.google.com",
  },
  {
    id:       "github",
    name:     "GitHub",
    category: "engineering",
    icon:     "◉",
    color:    "#e6edf3",
    desc:     "Access repositories, read issues and PRs, trigger CI workflows, post status checks.",
    status:   "connected",
    permissions: ["Read repos", "Read issues", "Read PRs", "Write comments"],
    syncStatus:  "synced",
    lastSync:    "2 hours ago",
    health:   "healthy",
    repoCount: 4,
  },
  {
    id:       "gitlab",
    name:     "GitLab",
    category: "engineering",
    icon:     "◈",
    color:    "#fc6d26",
    desc:     "Access GitLab projects, merge requests, pipelines, and CI/CD status.",
    status:   "disconnected",
    permissions: ["Read projects", "Read MRs", "Read pipelines"],
    syncStatus:  null,
    health:   null,
    setupUrl: "https://gitlab.com/-/profile/applications",
  },
  {
    id:       "notion",
    name:     "Notion",
    category: "knowledge",
    icon:     "N",
    color:    "#ffffff",
    desc:     "Sync pages and databases to the Knowledge Base. Write meeting notes and reports.",
    status:   "connected",
    permissions: ["Read pages", "Write pages", "Read databases"],
    syncStatus:  "synced",
    lastSync:    "1 hour ago",
    health:   "healthy",
    pageCount: 23,
  },
  {
    id:       "slack",
    name:     "Slack",
    category: "communication",
    icon:     "#",
    color:    "#4a154b",
    desc:     "Post alerts, pipeline updates, and task completions to Slack channels.",
    status:   "disconnected",
    permissions: ["Post messages", "Read channel list"],
    syncStatus:  null,
    health:   null,
    setupUrl: "https://api.slack.com/apps",
  },
  {
    id:       "outlook",
    name:     "Outlook",
    category: "communication",
    icon:     "O",
    color:    "#0078d4",
    desc:     "Read and send Outlook email, sync calendar events, manage contacts.",
    status:   "disconnected",
    permissions: ["Read mail", "Send mail", "Read calendar"],
    syncStatus:  null,
    health:   null,
    setupUrl: "https://portal.azure.com",
  },
  {
    id:       "telegram",
    name:     "Telegram",
    category: "communication",
    icon:     "✈",
    color:    "#2aabee",
    desc:     "Send notifications and workflow alerts via Telegram bot. Receive commands.",
    status:   "disconnected",
    permissions: ["Send messages", "Receive commands"],
    syncStatus:  null,
    health:   null,
    setupUrl: "https://t.me/BotFather",
  },
];

const CATEGORIES = [
  { id: "all",           label: "All"           },
  { id: "communication", label: "Communication" },
  { id: "engineering",   label: "Engineering"   },
  { id: "storage",       label: "Storage"       },
  { id: "knowledge",     label: "Knowledge"     },
];

const STATUS_COLORS = {
  connected:    "var(--success)",
  disconnected: "var(--text-faint)",
  error:        "var(--danger)",
  syncing:      "var(--warning)",
};

function IntegCard({ integ, onConnect, onDisconnect, onViewDetail, isSelected }) {
  const connected = integ.status === "connected";
  return (
    <div
      className={`ic-card${connected ? " ic-card--connected" : ""}${isSelected ? " ic-card--selected" : ""}`}
      onClick={() => onViewDetail(integ.id)}
    >
      <div className="ic-card-header">
        <div className="ic-icon-wrap" style={{ background: integ.color + "18", borderColor: integ.color + "33" }}>
          <span className="ic-icon" style={{ color: integ.color }}>{integ.icon}</span>
        </div>
        <div className="ic-card-meta">
          <span className="ic-card-name">{integ.name}</span>
          <span className="ic-card-category">{integ.category}</span>
        </div>
        <span className="ic-status-dot" style={{ background: STATUS_COLORS[integ.status] }} title={integ.status} />
      </div>
      <p className="ic-card-desc">{integ.desc}</p>
      <div className="ic-card-footer">
        {connected ? (
          <>
            <span className="ic-sync-text" style={{ color: "var(--success)" }}>
              ✓ {integ.lastSync ? `Synced ${integ.lastSync}` : "Connected"}
            </span>
            <button
              className="ic-btn ic-btn--disconnect"
              onClick={e => { e.stopPropagation(); onDisconnect(integ.id); }}
            >Disconnect</button>
          </>
        ) : (
          <button
            className="ic-btn ic-btn--connect"
            onClick={e => { e.stopPropagation(); onConnect(integ.id); }}
          >Connect →</button>
        )}
      </div>
    </div>
  );
}

function DetailPanel({ integ, onClose, onConnect, onDisconnect }) {
  const connected = integ.status === "connected";
  return (
    <div className="ic-detail">
      <div className="ic-detail-header">
        <div className="ic-icon-wrap ic-icon-wrap--lg" style={{ background: integ.color + "18", borderColor: integ.color + "33" }}>
          <span className="ic-icon ic-icon--lg" style={{ color: integ.color }}>{integ.icon}</span>
        </div>
        <div>
          <h3 className="ic-detail-name">{integ.name}</h3>
          <span className={`ic-detail-status ic-detail-status--${integ.status}`}>{integ.status}</span>
        </div>
        <button className="ic-detail-close" onClick={onClose}>✕</button>
      </div>

      <p className="ic-detail-desc">{integ.desc}</p>

      <div className="ic-detail-section">
        <p className="ic-detail-label">Permissions</p>
        <div className="ic-perms-list">
          {integ.permissions.map(p => (
            <span key={p} className="ic-perm-chip" style={{ borderColor: integ.color + "33", color: integ.color }}>✓ {p}</span>
          ))}
        </div>
      </div>

      {connected && (
        <div className="ic-detail-section">
          <p className="ic-detail-label">Sync status</p>
          <div className="ic-sync-info">
            <span className="ic-sync-badge ic-sync-badge--ok">● {integ.syncStatus}</span>
            {integ.lastSync && <span className="ic-sync-time">Last synced: {integ.lastSync}</span>}
            {integ.health && <span className="ic-health-badge ic-health-badge--ok">Health: {integ.health}</span>}
          </div>
          {integ.repoCount && <p className="ic-detail-sub">{integ.repoCount} repositories connected</p>}
          {integ.pageCount && <p className="ic-detail-sub">{integ.pageCount} pages indexed</p>}
        </div>
      )}

      {!connected && integ.setupUrl && (
        <div className="ic-detail-section">
          <p className="ic-detail-label">Setup</p>
          <p className="ic-detail-sub">OAuth credentials required. Generate them in your provider's developer console.</p>
        </div>
      )}

      <div className="ic-detail-actions">
        {connected ? (
          <>
            <button className="ic-detail-btn ic-detail-btn--secondary">Force re-sync</button>
            <button className="ic-detail-btn ic-detail-btn--danger" onClick={() => onDisconnect(integ.id)}>Disconnect</button>
          </>
        ) : (
          <button className="ic-detail-btn ic-detail-btn--primary" onClick={() => onConnect(integ.id)}>
            Connect {integ.name} →
          </button>
        )}
      </div>
    </div>
  );
}

export default function IntegrationCenter({ onNavigate }) {
  const [integs,    setInteg]    = useState(INTEGRATIONS);
  const [category,  setCategory] = useState("all");
  const [selected,  setSelected] = useState(null);
  const [toast,     setToast]    = useState(null);
  const [loading,   setLoading]  = useState(true);

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(null), 2600); };

  // Merge live OAuth status from backend over static definitions
  const _applyLiveStatus = useCallback((providerStatus, connections) => {
    setInteg(prev => prev.map(integ => {
      const pStatus = providerStatus?.[integ.id];
      const conn    = connections?.find(c => c.provider === integ.id);
      if (!pStatus && !conn) return integ;
      return {
        ...integ,
        status:     conn ? "connected" : (pStatus?.configured ? "disconnected" : "disconnected"),
        syncStatus: conn ? "synced" : null,
        lastSync:   conn?.updatedAt ? new Date(conn.updatedAt).toLocaleString() : null,
        health:     conn ? "healthy" : null,
      };
    }));
  }, []);

  useEffect(() => {
    track.event("integration_center_viewed");
    Promise.all([getOAuthProviderStatus(), listOAuthConnections()])
      .then(([ps, cs]) => {
        _applyLiveStatus(ps?.providers, cs?.connections);
      })
      .catch(() => {}) // backend may not have OAuth keys — fail silently, show static state
      .finally(() => setLoading(false));
  }, [_applyLiveStatus]);

  const handleConnect = useCallback(async (id) => {
    track.event("integration_connect_clicked", { id });
    try {
      const res = await getOAuthUrl(id);
      if (res?.url) {
        // Redirect to provider OAuth page; callback will return to app
        window.location.href = res.url;
      } else {
        // OAuth not configured — show instructional toast
        const name = INTEGRATIONS.find(i => i.id === id)?.name || id;
        showToast(`${name}: OAuth credentials not yet configured in .env`);
      }
    } catch {
      showToast("Connect failed — check server configuration");
    }
  }, []);

  const handleDisconnect = useCallback(async (id) => {
    try {
      await revokeOAuth(id);
    } catch {} // best-effort revoke
    setInteg(prev => prev.map(i => i.id === id
      ? { ...i, status: "disconnected", syncStatus: null, lastSync: null, health: null }
      : i
    ));
    setSelected(null);
    showToast(`${INTEGRATIONS.find(i=>i.id===id)?.name} disconnected`);
    track.event("integration_disconnected", { id });
  }, []);

  const visible = integs.filter(i => category === "all" || i.category === category);
  const connectedCount = integs.filter(i => i.status === "connected").length;
  const selectedInteg  = selected ? integs.find(i => i.id === selected) : null;

  return (
    <div className="integration-center page-enter">
      {toast && <div className="ic-toast">{toast}</div>}

      <div className="ic-header">
        <div>
          <h1 className="ic-title">Integration OS</h1>
          <p className="ic-subtitle">Connect external tools, manage permissions, and monitor sync health.</p>
        </div>
        <div className="ic-header-stat">
          <span className="ic-stat-num" style={{ color: connectedCount > 0 ? "var(--success)" : "var(--text-faint)" }}>
            {connectedCount}
          </span>
          <span className="ic-stat-label">Connected</span>
        </div>
      </div>

      {/* Category filter */}
      <div className="ic-cats">
        {CATEGORIES.map(c => (
          <button
            key={c.id}
            className={`ic-cat${category === c.id ? " ic-cat--active" : ""}`}
            onClick={() => setCategory(c.id)}
          >{c.label}</button>
        ))}
      </div>

      {/* Health banner when all disconnected */}
      {!loading && connectedCount === 0 && (
        <div className="ic-banner">
          <span className="ic-banner-icon">◎</span>
          <div>
            <p className="ic-banner-title">No integrations connected</p>
            <p className="ic-banner-sub">Connect tools to unlock automated syncing, knowledge ingestion, and cross-platform workflows.</p>
          </div>
        </div>
      )}

      <div className="ic-layout">
        {/* Grid */}
        <div className="ic-grid">
          {visible.map(i => (
            <IntegCard
              key={i.id}
              integ={i}
              isSelected={selected === i.id}
              onConnect={handleConnect}
              onDisconnect={handleDisconnect}
              onViewDetail={id => setSelected(prev => prev === id ? null : id)}
            />
          ))}
        </div>

        {/* Detail panel */}
        {selectedInteg && (
          <DetailPanel
            integ={selectedInteg}
            onClose={() => setSelected(null)}
            onConnect={handleConnect}
            onDisconnect={handleDisconnect}
          />
        )}
      </div>
    </div>
  );
}
