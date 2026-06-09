import React, { useState, useEffect, useCallback } from "react";
import { track } from "../analytics";
import { getSettingsStatus, saveWhatsAppCredentials } from "../settingsApi";
import "./WorkspaceSettings.css";

// ── Storage helpers ───────────────────────────────────────────────────
const BRAND_KEY    = "ooplix_ws_branding";
const SECURITY_KEY = "ooplix_ws_security";
const NOTIF_KEY    = "ooplix_ws_notifications";

function _load(key, fallback) {
  try { return { ...fallback, ...JSON.parse(localStorage.getItem(key) || "{}") }; }
  catch { return fallback; }
}
function _save(key, data) { localStorage.setItem(key, JSON.stringify(data)); }

// ── Integration definitions ───────────────────────────────────────────
const INTEGRATIONS = [
  {
    id:      "whatsapp",
    name:    "WhatsApp Business",
    icon:    "◉",
    color:   "#25d366",
    status:  "check",
    desc:    "Automated follow-up sequences and outbound messaging.",
    setup:   "Connected via QR scan. Re-scan in Contacts tab to refresh session.",
  },
  {
    id:      "razorpay",
    name:    "Razorpay",
    icon:    "◈",
    color:   "#3395ff",
    status:  "check",
    desc:    "Payment link generation and collection tracking.",
    setup:   "API key configured. Update in Contacts → Payment tab.",
  },
  {
    id:      "gmail",
    name:    "Gmail / Google Workspace",
    icon:    "✉",
    color:   "#ea4335",
    status:  "disconnected",
    desc:    "Send emails and sync contacts from Google Contacts.",
    setup:   "Connect via OAuth. Requires Google account.",
  },
  {
    id:      "slack",
    name:    "Slack",
    icon:    "◇",
    color:   "#4a154b",
    status:  "disconnected",
    desc:    "Post activity alerts and pipeline updates to a Slack channel.",
    setup:   "Add the Ooplix app to your Slack workspace.",
  },
  {
    id:      "zapier",
    name:    "Zapier",
    icon:    "⬟",
    color:   "#ff4a00",
    status:  "disconnected",
    desc:    "Connect Ooplix to 5,000+ apps via Zapier webhooks.",
    setup:   "Use the Ooplix webhook URL in your Zap trigger.",
  },
  {
    id:      "stripe",
    name:    "Stripe",
    icon:    "◎",
    color:   "#635bff",
    status:  "disconnected",
    desc:    "Accept international payments and subscriptions.",
    setup:   "Enter Stripe publishable key in billing settings.",
  },
];

function Toggle({ checked, onChange, label }) {
  return (
    <label className="ws-toggle-wrap">
      <button
        className={`ws-toggle${checked ? " ws-toggle--on" : ""}`}
        onClick={() => onChange(!checked)}
        role="switch"
        aria-checked={checked}
      >
        <span className="ws-toggle-thumb" />
      </button>
      {label && <span className="ws-toggle-label">{label}</span>}
    </label>
  );
}

function FieldRow({ label, hint, children }) {
  return (
    <div className="ws-field-row">
      <div className="ws-field-meta">
        <span className="ws-field-label">{label}</span>
        {hint && <span className="ws-field-hint">{hint}</span>}
      </div>
      <div className="ws-field-control">{children}</div>
    </div>
  );
}

export default function WorkspaceSettings({ onNavigate }) {
  const [section, setSection] = useState("branding");
  const [brand, setBrand] = useState(() => _load(BRAND_KEY, {
    workspaceName: "My Workspace",
    businessName:  "",
    tagline:       "",
    primaryColor:  "#7c6fff",
    accentColor:   "#4ecdc4",
    logoUrl:       "",
  }));
  const [security, setSecurity] = useState(() => _load(SECURITY_KEY, {
    twoFactor:        false,
    sessionTimeout:   "24h",
    ipAllowlist:      "",
    auditLog:         true,
    apiKeyVisible:    false,
  }));
  const [notifs, setNotifs] = useState(() => _load(NOTIF_KEY, {
    emailDigest:      true,
    taskAlerts:       true,
    billingAlerts:    true,
    weeklyReport:     false,
    teamActivity:     true,
  }));
  const [toast,         setToast]        = useState(null);
  const [apiKeyShown,   setApiKeyShown]   = useState(false);
  const [settingsStatus, setSettingsStatus] = useState(null);
  const [waForm,        setWaForm]        = useState({ token: "", phoneId: "", verifyToken: "", apiVersion: "v18.0" });
  const [waSaving,      setWaSaving]      = useState(false);

  useEffect(() => {
    track.event("workspace_settings_viewed");
    getSettingsStatus().then(s => { if (s && !s.error) setSettingsStatus(s); });
  }, []);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const saveBrand = () => {
    _save(BRAND_KEY, brand);
    showToast("Branding saved");
    track.event("ws_branding_saved");
  };

  const saveSecurity = () => {
    _save(SECURITY_KEY, security);
    showToast("Security settings saved");
    track.event("ws_security_saved");
  };

  const saveNotifs = () => {
    _save(NOTIF_KEY, notifs);
    showToast("Notification preferences saved");
  };

  const handleIntegrationAction = (integ) => {
    if (integ.id === "whatsapp") return; // handled by dedicated form below
    if (integ.status === "check") {
      showToast(`${integ.name} is connected`);
    } else {
      showToast(`${integ.name} setup: ${integ.setup}`);
    }
    track.event("integration_action", { id: integ.id, status: integ.status });
  };

  const handleSaveWhatsApp = useCallback(async () => {
    if (!waForm.token || !waForm.phoneId) { showToast("Token and Phone ID are required"); return; }
    setWaSaving(true);
    const res = await saveWhatsAppCredentials(waForm);
    setWaSaving(false);
    if (res?.success !== false) {
      showToast("WhatsApp credentials saved");
      track.event("ws_whatsapp_saved");
      getSettingsStatus().then(s => { if (s && !s.error) setSettingsStatus(s); });
    } else {
      showToast(res.error || "Failed to save WhatsApp credentials");
    }
  }, [waForm]);

  return (
    <div className="workspace-settings page-enter">
      {toast && <div className="ws-toast">{toast}</div>}

      <div className="ws-header">
        <div>
          <h1 className="ws-title">Workspace Settings</h1>
          <p className="ws-subtitle">Branding, team, billing, security, and integrations — all in one place.</p>
        </div>
      </div>

      <div className="ws-layout">

        {/* Sidebar nav */}
        <nav className="ws-sidenav">
          {[
            { id: "branding",      icon: "◎", label: "Branding"      },
            { id: "team",          icon: "◈", label: "Team"          },
            { id: "billing",       icon: "◉", label: "Billing"       },
            { id: "security",      icon: "⬟", label: "Security"      },
            { id: "notifications", icon: "✦", label: "Notifications" },
            { id: "integrations",  icon: "◇", label: "Integrations"  },
          ].map(s => (
            <button
              key={s.id}
              className={`ws-nav-item${section === s.id ? " ws-nav-item--active" : ""}`}
              onClick={() => setSection(s.id)}
            >
              <span className="ws-nav-icon">{s.icon}</span>
              <span className="ws-nav-label">{s.label}</span>
            </button>
          ))}
        </nav>

        {/* Content pane */}
        <div className="ws-pane" key={section}>

          {/* Branding */}
          {section === "branding" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Branding</h2>
              <p className="ws-section-desc">Customise your workspace identity. These settings personalise your experience within Ooplix.</p>
              <div className="ws-fields">
                <FieldRow label="Workspace name" hint="Shown in the header and reports">
                  <input className="ws-input" value={brand.workspaceName}
                    onChange={e => setBrand(b => ({ ...b, workspaceName: e.target.value }))}
                    placeholder="My Workspace" />
                </FieldRow>
                <FieldRow label="Business name" hint="Shown in email footers and outreach">
                  <input className="ws-input" value={brand.businessName}
                    onChange={e => setBrand(b => ({ ...b, businessName: e.target.value }))}
                    placeholder="Your Business Name" />
                </FieldRow>
                <FieldRow label="Tagline" hint="1-line description of what you do">
                  <input className="ws-input" value={brand.tagline}
                    onChange={e => setBrand(b => ({ ...b, tagline: e.target.value }))}
                    placeholder="E.g. Lead automation for consultants" />
                </FieldRow>
                <FieldRow label="Primary color" hint="Accent color for reports and exports">
                  <div className="ws-color-row">
                    <input type="color" className="ws-color-input" value={brand.primaryColor}
                      onChange={e => setBrand(b => ({ ...b, primaryColor: e.target.value }))} />
                    <input className="ws-input ws-input--mono" value={brand.primaryColor}
                      onChange={e => setBrand(b => ({ ...b, primaryColor: e.target.value }))}
                      placeholder="#7c6fff" />
                  </div>
                </FieldRow>
                <FieldRow label="Logo URL" hint="Link to your logo image (optional)">
                  <input className="ws-input" value={brand.logoUrl}
                    onChange={e => setBrand(b => ({ ...b, logoUrl: e.target.value }))}
                    placeholder="https://yoursite.com/logo.png" />
                </FieldRow>
              </div>
              <button className="ws-save-btn" onClick={saveBrand}>Save branding</button>
            </div>
          )}

          {/* Team */}
          {section === "team" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Team</h2>
              <p className="ws-section-desc">Manage team members and roles from the Team Workspace.</p>
              <div className="ws-team-shortcut">
                <div className="ws-ts-body">
                  <p className="ws-ts-title">Team Workspace</p>
                  <p className="ws-ts-sub">Invite members, assign roles (Owner → Viewer), and view workspace activity.</p>
                </div>
                <button className="ws-ts-btn" onClick={() => onNavigate && onNavigate("team")}>
                  Open Team Workspace →
                </button>
              </div>
              <div className="ws-fields ws-fields--top">
                <FieldRow label="Workspace plan" hint="Current team capacity">
                  <span className="ws-badge">Starter — up to 3 seats</span>
                </FieldRow>
                <FieldRow label="Default role" hint="Role assigned to new invited members">
                  <select className="ws-select">
                    <option value="operator">Operator</option>
                    <option value="viewer">Viewer</option>
                    <option value="manager">Manager</option>
                  </select>
                </FieldRow>
              </div>
            </div>
          )}

          {/* Billing */}
          {section === "billing" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Billing</h2>
              <p className="ws-section-desc">Manage your plan, payment method, and invoices.</p>
              <div className="ws-billing-summary">
                <div className="ws-bill-card">
                  <span className="ws-bill-label">Current plan</span>
                  <span className="ws-bill-value">Starter</span>
                  <span className="ws-bill-sub">₹999/month · Up to 100 leads</span>
                </div>
                <div className="ws-bill-card">
                  <span className="ws-bill-label">Next billing date</span>
                  <span className="ws-bill-value">—</span>
                  <span className="ws-bill-sub">Connect billing to track</span>
                </div>
                <div className="ws-bill-card">
                  <span className="ws-bill-label">Payment method</span>
                  <span className="ws-bill-value">—</span>
                  <span className="ws-bill-sub">Not configured</span>
                </div>
              </div>
              <div className="ws-billing-actions">
                <button className="ws-bill-cta" onClick={() => onNavigate && onNavigate("billing")}>
                  Manage billing →
                </button>
                <button className="ws-bill-secondary">Download invoices</button>
              </div>
              <div className="ws-billing-plans">
                <p className="ws-section-label">Upgrade options</p>
                {[
                  { name: "Starter",    price: "₹999/mo",  leads: "100 leads",  seats: "1 seat",  highlight: false },
                  { name: "Growth",     price: "₹2,499/mo", leads: "1,000 leads",seats: "5 seats", highlight: true  },
                  { name: "Scale",      price: "Custom",    leads: "Unlimited",  seats: "Unlimited", highlight: false },
                ].map(p => (
                  <div key={p.name} className={`ws-plan-row${p.highlight ? " ws-plan-row--current" : ""}`}>
                    <span className="ws-plan-name">{p.name}</span>
                    <span className="ws-plan-price">{p.price}</span>
                    <span className="ws-plan-feat">{p.leads}</span>
                    <span className="ws-plan-feat">{p.seats}</span>
                    {p.highlight
                      ? <span className="ws-plan-badge">Recommended</span>
                      : <button className="ws-plan-btn" onClick={() => onNavigate && onNavigate("billing")}>Select</button>
                    }
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Security */}
          {section === "security" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Security</h2>
              <p className="ws-section-desc">Protect your workspace with authentication and access controls.</p>
              <div className="ws-fields">
                <FieldRow label="Two-factor authentication" hint="Require 2FA for all team members">
                  <Toggle checked={security.twoFactor}
                    onChange={v => setSecurity(s => ({ ...s, twoFactor: v }))} />
                </FieldRow>
                <FieldRow label="Session timeout" hint="Auto-logout after inactivity">
                  <select className="ws-select" value={security.sessionTimeout}
                    onChange={e => setSecurity(s => ({ ...s, sessionTimeout: e.target.value }))}>
                    <option value="1h">1 hour</option>
                    <option value="8h">8 hours</option>
                    <option value="24h">24 hours</option>
                    <option value="7d">7 days</option>
                    <option value="never">Never</option>
                  </select>
                </FieldRow>
                <FieldRow label="Audit log" hint="Record all team actions (required for compliance)">
                  <Toggle checked={security.auditLog}
                    onChange={v => setSecurity(s => ({ ...s, auditLog: v }))} />
                </FieldRow>
                <FieldRow label="IP allowlist" hint="Restrict login to specific IP ranges (leave blank to allow all)">
                  <input className="ws-input ws-input--mono" value={security.ipAllowlist}
                    onChange={e => setSecurity(s => ({ ...s, ipAllowlist: e.target.value }))}
                    placeholder="e.g. 192.168.1.0/24, 10.0.0.1" />
                </FieldRow>
                <FieldRow label="API key" hint="Use to integrate Ooplix with external tools">
                  <div className="ws-api-key-row">
                    <span className="ws-api-key-val ws-input--mono">
                      {apiKeyShown ? "sk_ooplix_demo_••••••••••••••••••••••••••" : "••••••••••••••••••••••••••••••••••"}
                    </span>
                    <button className="ws-api-toggle" onClick={() => setApiKeyShown(v => !v)}>
                      {apiKeyShown ? "Hide" : "Show"}
                    </button>
                  </div>
                </FieldRow>
              </div>
              <button className="ws-save-btn" onClick={saveSecurity}>Save security settings</button>
              <div className="ws-security-note">
                <span className="ws-sec-icon">⬟</span>
                <span>For critical security events, contact <a className="ws-sec-link" href="mailto:security@ooplix.com">security@ooplix.com</a></span>
              </div>
            </div>
          )}

          {/* Notifications */}
          {section === "notifications" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Notifications</h2>
              <p className="ws-section-desc">Choose what Ooplix notifies you about and how.</p>
              <div className="ws-fields">
                {[
                  { key: "emailDigest",   label: "Daily email digest",       hint: "Summary of activity sent each morning"            },
                  { key: "taskAlerts",    label: "Task completion alerts",    hint: "Notified when an automated task completes"        },
                  { key: "billingAlerts", label: "Billing alerts",            hint: "Invoice receipts and payment failures"            },
                  { key: "weeklyReport",  label: "Weekly performance report", hint: "Revenue, leads, and activity summary every Monday"},
                  { key: "teamActivity",  label: "Team activity updates",     hint: "When team members join, leave, or change roles"   },
                ].map(n => (
                  <FieldRow key={n.key} label={n.label} hint={n.hint}>
                    <Toggle
                      checked={!!notifs[n.key]}
                      onChange={v => setNotifs(prev => ({ ...prev, [n.key]: v }))}
                    />
                  </FieldRow>
                ))}
              </div>
              <button className="ws-save-btn" onClick={saveNotifs}>Save preferences</button>
            </div>
          )}

          {/* Integrations */}
          {section === "integrations" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Integrations</h2>
              <p className="ws-section-desc">Connect Ooplix to the tools your business already uses.</p>
              <div className="ws-integrations-list">
                {INTEGRATIONS.map(integ => {
                  const liveConnected = integ.id === "whatsapp"
                    ? settingsStatus?.whatsapp?.configured
                    : integ.status === "check";
                  return (
                    <div key={integ.id} className={`ws-integ-card${liveConnected ? " ws-integ-card--connected" : ""}`}>
                      <span className="ws-integ-icon" style={{ color: integ.color }}>{integ.icon}</span>
                      <div className="ws-integ-info">
                        <div className="ws-integ-top">
                          <span className="ws-integ-name">{integ.name}</span>
                          <span className={`ws-integ-status ws-integ-status--${liveConnected ? "check" : "disconnected"}`}>
                            {liveConnected ? "Connected" : "Not connected"}
                          </span>
                        </div>
                        <span className="ws-integ-desc">{integ.desc}</span>
                        {integ.id === "whatsapp" && (
                          <div className="ws-wa-form">
                            <input className="ws-input ws-input--mono" placeholder="WA_TOKEN (Bearer token)"
                              value={waForm.token} onChange={e => setWaForm(f => ({ ...f, token: e.target.value }))} />
                            <input className="ws-input ws-input--mono" placeholder="Phone Number ID"
                              value={waForm.phoneId} onChange={e => setWaForm(f => ({ ...f, phoneId: e.target.value }))} />
                            <input className="ws-input ws-input--mono" placeholder="Verify Token (webhook)"
                              value={waForm.verifyToken} onChange={e => setWaForm(f => ({ ...f, verifyToken: e.target.value }))} />
                            <button className="ws-save-btn" onClick={handleSaveWhatsApp} disabled={waSaving}>
                              {waSaving ? "Saving…" : "Save WhatsApp credentials"}
                            </button>
                          </div>
                        )}
                        {integ.id !== "whatsapp" && !liveConnected && (
                          <span className="ws-integ-setup">{integ.setup}</span>
                        )}
                      </div>
                      {integ.id !== "whatsapp" && (
                        <button
                          className={`ws-integ-btn ws-integ-btn--${liveConnected ? "connected" : "connect"}`}
                          onClick={() => handleIntegrationAction(integ)}
                        >
                          {liveConnected ? "Manage" : "Connect"}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
