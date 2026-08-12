import React, { useState, useEffect, useCallback } from "react";
import { track } from "../analytics";
import { useAuth } from "../contexts/AuthContext";
import { getSettingsStatus, saveWhatsAppCredentials } from "../settingsApi";
import { getAllIntegrations } from "../connectorApi";
import ThemeToggle from "./ThemeToggle.jsx";
import { _fetch } from "../_client";
import "./WorkspaceSettings.css";
import { Toggle, FieldRow } from "./WorkspaceSettingsShared";
import { TeamDirectoryPanel, DepartmentsPanel, OrgProfilePanel, StatisticsPanel, QuotasPanel } from "./WorkspaceSettingsK3";
import { AutomationOverviewPanel, RuleBuilderPanel, TriggerLibraryPanel, AutoHistoryPanel, AutoStatsPanel } from "./WorkspaceSettingsK5";
import { ExtRuntimePanel, ExtMetricsPanel, ExtHooksPanel, ExtQuotasPanel } from "./WorkspaceSettingsL3";
import { MarketplaceCatalogPanel, MarketplaceFeaturedPanel, MarketplaceSearchPanel, MarketplaceRecsPanel } from "./WorkspaceSettingsL2";
import { PluginsPanel, PluginHealthPanel, PluginDiagPanel } from "./WorkspaceSettingsL1";
import { ExecutivePanel, WorkspaceHealthPanel, AutomationROIPanel, AIUtilizationPanel, RuntimeCapacityPanel, EnterpriseReportsPanel } from "./WorkspaceSettingsK6";
import { PolicyLibraryPanel, CompliancePanel, RiskMatrixPanel, GovernanceOverviewPanel, GovReportsPanel } from "./WorkspaceSettingsK4";
import { SessionsPanel, DevicesPanel, AuditPanel, TokensPanel, PoliciesPanel } from "./WorkspaceSettingsK2";
import { DesktopIntegrationsPanel } from "./WorkspaceSettingsDesktop";

// ── Storage helpers ───────────────────────────────────────────────────
const BRAND_KEY    = "ooplix_ws_branding";
const NOTIF_KEY    = "ooplix_ws_notifications";

function _load(key, fallback) {
  try { return { ...fallback, ...JSON.parse(localStorage.getItem(key) || "{}") }; }
  catch { return fallback; }
}
function _save(key, data) { localStorage.setItem(key, JSON.stringify(data)); }

// Branding has no backend — these settings are applied directly to the
// live DOM (CSS custom properties + document.title) so "Save" has a real,
// visible effect instead of silently writing to storage nothing else reads.
function _applyBranding(brand) {
  const root = document.documentElement.style;
  if (brand.primaryColor) root.setProperty("--accent", brand.primaryColor);
  if (brand.accentColor)  root.setProperty("--accent2", brand.accentColor);
  document.title = brand.workspaceName ? `${brand.workspaceName} — Ooplix` : "Ooplix";
}

// ── Integration definitions ───────────────────────────────────────────
// connectorId maps to the real integrationConnectors.cjs registry (checked
// via getAllIntegrations()) — everything except WhatsApp used to hardcode
// a fake status here (Razorpay always "Connected", the rest always "Not
// connected") regardless of what was actually configured.
const INTEGRATIONS = [
  {
    id:      "whatsapp",
    name:    "WhatsApp Business",
    icon:    "◉",
    color:   "#25d366",
    connectorId: null, // has its own dedicated real status check below (settingsStatus.whatsapp)
    desc:    "Automated follow-up sequences and outbound messaging.",
    setup:   "Connected via QR scan. Re-scan in Contacts tab to refresh session.",
  },
  {
    id:      "razorpay",
    name:    "Razorpay",
    icon:    "◈",
    color:   "#3395ff",
    connectorId: "pay:razorpay",
    desc:    "Payment link generation and collection tracking.",
    setup:   "API key configured. Update in Contacts → Payment tab.",
  },
  {
    id:      "gmail",
    name:    "Gmail / Google Workspace",
    icon:    "✉",
    color:   "#ea4335",
    connectorId: "prod:google_workspace",
    desc:    "Send emails and sync contacts from Google Contacts.",
    setup:   "Connect via OAuth. Requires Google account.",
  },
  {
    id:      "slack",
    name:    "Slack",
    icon:    "◇",
    color:   "#4a154b",
    connectorId: "msg:slack",
    desc:    "Post activity alerts and pipeline updates to a Slack channel.",
    setup:   "Add the Ooplix app to your Slack workspace.",
  },
  {
    id:      "zapier",
    name:    "Zapier",
    icon:    "⬟",
    color:   "#ff4a00",
    connectorId: "auto:zapier",
    desc:    "Connect Ooplix to 5,000+ apps via Zapier webhooks.",
    setup:   "Use the Ooplix webhook URL in your Zap trigger.",
  },
  {
    id:      "stripe",
    name:    "Stripe",
    icon:    "◎",
    color:   "#635bff",
    connectorId: "pay:stripe",
    desc:    "Accept international payments and subscriptions.",
    setup:   "Enter Stripe publishable key in billing settings.",
  },
];


export default function WorkspaceSettings({ onNavigate }) {
  const { user } = useAuth();
  const [section, setSection] = useState("branding");
  const [brand, setBrand] = useState(() => _load(BRAND_KEY, {
    workspaceName: "My Workspace",
    businessName:  "",
    tagline:       "",
    primaryColor:  "var(--accent)",
    accentColor:   "var(--accent2)",
    logoUrl:       "",
  }));
  const [notifs, setNotifs] = useState(() => _load(NOTIF_KEY, {
    emailDigest:      true,
    taskAlerts:       true,
    billingAlerts:    true,
    weeklyReport:     false,
    teamActivity:     true,
  }));
  const [toast,         setToast]        = useState(null);
  const [settingsStatus, setSettingsStatus] = useState(null);
  const [connectorStatus, setConnectorStatus] = useState({}); // connectorId -> real status record
  const [waForm,        setWaForm]        = useState({ token: "", phoneId: "", verifyToken: "", apiVersion: "v18.0" });
  const [waSaving,      setWaSaving]      = useState(false);

  useEffect(() => {
    track.event("workspace_settings_viewed");
    getSettingsStatus().then(s => { if (s && !s.error) setSettingsStatus(s); });
    // Workflow Coverage Completion finding: GET /integrations is
    // operatorOnly server-side — every non-operator founder who opened
    // Settings (a universal, non-operator-gated destination every account
    // visits) got a silent 403 here. connectorStatus only powers a
    // "Connected"/"Not connected" badge (falls back to "Not connected" for
    // everyone when empty — an honest, non-broken default), so gating the
    // call itself is safe: operators still see live status, non-operators
    // just don't fire a call they were never authorized to make. Matches
    // the same fix already applied to App.jsx's stats/ops polling and the
    // DevOps tab mount.
    if (user?.role === "operator") {
      getAllIntegrations().then(r => {
        if (r?.ok && Array.isArray(r.connectors)) {
          setConnectorStatus(Object.fromEntries(r.connectors.map(c => [c.id, c])));
        }
      });
    }
  }, [user]);

  useEffect(() => { _applyBranding(brand); }, [brand]);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const saveBrand = () => {
    _save(BRAND_KEY, brand);
    showToast("Branding saved");
    track.event("ws_branding_saved");
  };

  const resetBrand = () => {
    const defaults = {
      workspaceName: "My Workspace", businessName: "", tagline: "",
      primaryColor: "var(--accent)", accentColor: "var(--accent2)", logoUrl: "",
    };
    setBrand(defaults);
    _save(BRAND_KEY, defaults);
    showToast("Branding reset to defaults");
  };

  const saveNotifs = () => {
    _save(NOTIF_KEY, notifs);
    showToast("Notification preferences saved");
  };

  const handleIntegrationAction = (integ) => {
    if (integ.id === "whatsapp") return; // handled by dedicated form below
    // Real connect/manage flow already lives in the Connector Center
    // (IntegrationCenter.jsx) — this used to only pop a toast with setup
    // instructions and never actually connect anything.
    track.event("integration_action", { id: integ.id, connectorId: integ.connectorId });
    onNavigate?.("integrations");
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
      {toast && <div className="ws-toast" role="alert" aria-live="polite">{toast}</div>}

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
            { id: "policies",      icon: "⬡", label: "Policies"      },
            { id: "sessions",      icon: "▷", label: "Sessions"      },
            { id: "devices",       icon: "◇", label: "Devices"       },
            { id: "desktop",       icon: "🖥", label: "Desktop"       },
            { id: "tokens",        icon: "◎", label: "API Tokens"    },
            { id: "auditlog",      icon: "✦", label: "Audit Log"     },
            { id: "directory",     icon: "◈", label: "Team Directory" },
            { id: "departments",   icon: "⬡", label: "Departments"   },
            { id: "orgprofile",    icon: "◉", label: "Org Profile"   },
            { id: "statistics",    icon: "▷", label: "Statistics"    },
            { id: "quotas",        icon: "◎", label: "Quotas"        },
            { id: "governance",    icon: "⬟", label: "Governance"    },
            { id: "compliance",    icon: "◉", label: "Compliance"    },
            { id: "risk",          icon: "▷", label: "Risk Matrix"   },
            { id: "policylibrary", icon: "◈", label: "Policy Library"},
            { id: "govreports",    icon: "✦", label: "Gov Reports"   },
            { id: "automation",    icon: "▷", label: "Automation"    },
            { id: "autorules",     icon: "◈", label: "Rule Builder"  },
            { id: "autotemplates", icon: "◎", label: "Trigger Library"},
            { id: "autohistory",   icon: "⬟", label: "Auto History"  },
            { id: "autostats",     icon: "◉", label: "Auto Stats"    },
            { id: "analytics",     icon: "◎", label: "Analytics"     },
            { id: "wshealth",      icon: "⬟", label: "WS Health"     },
            { id: "autoROI",       icon: "◉", label: "Automation ROI"},
            { id: "aiutilization", icon: "▷", label: "AI Usage"      },
            { id: "capacity",      icon: "◈", label: "Capacity"      },
            { id: "entreports",    icon: "✦", label: "Ent. Reports"  },
            { id: "plugins",       icon: "◎", label: "Plugins"       },
            { id: "plughealth",    icon: "⬟", label: "Plugin Health" },
            { id: "plugdiag",      icon: "▷", label: "Diagnostics"   },
            { id: "marketplace",   icon: "◎", label: "Marketplace"   },
            { id: "mktfeatured",   icon: "✦", label: "Featured"      },
            { id: "mktsearch",     icon: "◈", label: "Search"        },
            { id: "mktrecs",       icon: "⬟", label: "Recommended"   },
            { id: "extruntime",    icon: "◎", label: "Ext. Runtime"  },
            { id: "extmetrics",    icon: "◉", label: "Ext. Metrics"  },
            { id: "exthooks",      icon: "▷", label: "Hooks"         },
            { id: "extquotas",     icon: "◈", label: "Quotas"        },
            { id: "notifications", icon: "✦", label: "Notifications" },
            { id: "integrations",  icon: "◇", label: "Integrations"  },
          ].map(s => (
            <button
              key={s.id}
              className={`ws-nav-item${section === s.id ? " ws-nav-item--active" : ""}`}
              onClick={() => setSection(s.id)}
              aria-current={section === s.id ? "page" : undefined}
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
              <p className="ws-section-desc">
                Local to this browser — there's no workspace branding backend yet, so these apply only on this
                device. Workspace name and colors take effect immediately as you edit; business name, tagline,
                and logo are saved for later use but nothing in the app displays them yet.
              </p>
              <div className="ws-fields">
                <FieldRow label="Theme" hint="Light or dark appearance for the whole app">
                  <ThemeToggle />
                </FieldRow>
                <FieldRow label="Workspace name" hint="Applied to the browser tab title, live">
                  <input className="ws-input" value={brand.workspaceName}
                    onChange={e => setBrand(b => ({ ...b, workspaceName: e.target.value }))}
                    placeholder="My Workspace" />
                </FieldRow>
                <FieldRow label="Business name" hint="Saved for future use — not shown anywhere yet">
                  <input className="ws-input" value={brand.businessName}
                    onChange={e => setBrand(b => ({ ...b, businessName: e.target.value }))}
                    placeholder="Your Business Name" />
                </FieldRow>
                <FieldRow label="Tagline" hint="Saved for future use — not shown anywhere yet">
                  <input className="ws-input" value={brand.tagline}
                    onChange={e => setBrand(b => ({ ...b, tagline: e.target.value }))}
                    placeholder="E.g. Lead automation for consultants" />
                </FieldRow>
                <FieldRow label="Primary color" hint="Applied to the app's accent color, live">
                  <div className="ws-color-row">
                    <input type="color" className="ws-color-input" value={brand.primaryColor}
                      onChange={e => setBrand(b => ({ ...b, primaryColor: e.target.value }))} />
                    <input className="ws-input ws-input--mono" value={brand.primaryColor}
                      onChange={e => setBrand(b => ({ ...b, primaryColor: e.target.value }))}
                      placeholder="var(--accent)" />
                  </div>
                </FieldRow>
                <FieldRow label="Secondary color" hint="Applied to the app's secondary accent, live">
                  <div className="ws-color-row">
                    <input type="color" className="ws-color-input" value={brand.accentColor}
                      onChange={e => setBrand(b => ({ ...b, accentColor: e.target.value }))} />
                    <input className="ws-input ws-input--mono" value={brand.accentColor}
                      onChange={e => setBrand(b => ({ ...b, accentColor: e.target.value }))}
                      placeholder="var(--accent2)" />
                  </div>
                </FieldRow>
                <FieldRow label="Logo URL" hint="Saved for future use — not shown anywhere yet">
                  <input className="ws-input" value={brand.logoUrl}
                    onChange={e => setBrand(b => ({ ...b, logoUrl: e.target.value }))}
                    placeholder="https://yoursite.com/logo.png" />
                </FieldRow>
              </div>
              <div className="ws-billing-actions">
                <button className="ws-save-btn" onClick={saveBrand}>Save branding</button>
                <button className="ws-bill-secondary" onClick={resetBrand}>Reset to defaults</button>
              </div>
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
                  <select className="ws-select" aria-label="Default role for new members" onChange={e => showToast(`Default role set to ${e.target.value}`)}>
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
                <button className="ws-bill-secondary" onClick={() => showToast("Invoice download: connect billing via Manage billing → to enable")}>Download invoices</button>
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
              <p className="ws-section-desc">
                Session timeout, audit logging, and IP allowlisting are real, enforced settings — configure them
                in <button className="ws-inline-link" onClick={() => setSection("policies")}>Policies</button>,
                which this page used to duplicate without actually saving anything. API tokens for integrating
                Ooplix with external tools live in <button className="ws-inline-link" onClick={() => setSection("tokens")}>API Tokens</button>.
              </p>
              <div className="ws-fields">
                <FieldRow label="Two-factor authentication" hint="Not available yet — login is single-password operator auth, no MFA enforcement exists in the backend">
                  <span className="ws-badge ws-badge--dim">Not available</span>
                </FieldRow>
              </div>
              <div className="ws-security-note">
                <span className="ws-sec-icon">⬟</span>
                <span>For critical security events, contact <a className="ws-sec-link" href="mailto:security@ooplix.com">security@ooplix.com</a></span>
              </div>
            </div>
          )}

          {/* K2 — Workspace Policies + Security Score */}
          {section === "policies" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Workspace Policies</h2>
              <p className="ws-section-desc">Fine-grained security rules for this workspace. Changes take effect immediately.</p>
              <PoliciesPanel />
            </div>
          )}

          {/* K2 — Active Sessions */}
          {section === "sessions" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Active Sessions</h2>
              <p className="ws-section-desc">All active login sessions across workspace members. Revoke any session instantly.</p>
              <SessionsPanel />
            </div>
          )}

          {/* K2 — Trusted Devices */}
          {section === "devices" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Trusted Devices</h2>
              <p className="ws-section-desc">Devices that have accessed this workspace. Require device trust in Policies to enforce this list.</p>
              <DevicesPanel />
            </div>
          )}

          {/* Desktop Integrations — recovered hidden capability: real Electron
              IPC handlers (print-to-PDF, scanner hand-off, native save dialog,
              folder sync) that had zero frontend caller. */}
          {section === "desktop" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Desktop Integrations</h2>
              <p className="ws-section-desc">Native OS capabilities available in the Ooplix desktop app — printing, scanning, file export, and local folder sync.</p>
              <DesktopIntegrationsPanel />
            </div>
          )}

          {/* K2 — API Tokens */}
          {section === "tokens" && (
            <div className="ws-section">
              <h2 className="ws-section-title">API Tokens</h2>
              <p className="ws-section-desc">Personal Access Tokens (PAT) and Service Tokens for API integrations. Secrets are shown only once on creation.</p>
              <TokensPanel />
            </div>
          )}

          {/* K2 — Security Audit Log */}
          {section === "auditlog" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Security Audit Log</h2>
              <p className="ws-section-desc">Immutable record of all security events — sessions, tokens, policy changes, device registrations.</p>
              <AuditPanel />
            </div>
          )}

          {/* K3 — Team Directory */}
          {section === "directory" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Team Directory</h2>
              <p className="ws-section-desc">All workspace members — lifecycle status, job titles, departments, and bulk management.</p>
              <TeamDirectoryPanel />
            </div>
          )}

          {/* K3 — Departments */}
          {section === "departments" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Departments</h2>
              <p className="ws-section-desc">Organise workspace members into departments for reporting and access management.</p>
              <DepartmentsPanel />
            </div>
          )}

          {/* K3 — Org Profile */}
          {section === "orgprofile" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Organisation Profile</h2>
              <p className="ws-section-desc">Public-facing details about your organisation. Used in reports and invoices.</p>
              <OrgProfilePanel />
            </div>
          )}

          {/* K3 — Statistics */}
          {section === "statistics" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Workspace Statistics</h2>
              <p className="ws-section-desc">Live snapshot of member activity, departments, and security health.</p>
              <StatisticsPanel />
            </div>
          )}

          {/* K3 — Quotas */}
          {section === "quotas" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Workspace Quotas</h2>
              <p className="ws-section-desc">Current usage against plan limits. Contact support to increase quotas.</p>
              <QuotasPanel />
            </div>
          )}

          {/* K4 — Governance Overview */}
          {section === "governance" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Governance</h2>
              <p className="ws-section-desc">Enterprise governance posture — compliance score, active policies, risk summary, and upcoming reviews.</p>
              <GovernanceOverviewPanel />
            </div>
          )}

          {/* K4 — Compliance */}
          {section === "compliance" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Compliance</h2>
              <p className="ws-section-desc">Configure active compliance frameworks, data classification, risk tolerance, and review cadence.</p>
              <CompliancePanel />
            </div>
          )}

          {/* K4 — Risk Matrix */}
          {section === "risk" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Risk Matrix</h2>
              <p className="ws-section-desc">5×5 risk matrix across access, data, deployment, compliance, and operational risk categories.</p>
              <RiskMatrixPanel />
            </div>
          )}

          {/* K4 — Policy Library */}
          {section === "policylibrary" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Policy Library</h2>
              <p className="ws-section-desc">Workspace governance policies and reusable templates (SOC 2, GDPR, HIPAA, ISO 27001, and custom).</p>
              <PolicyLibraryPanel />
            </div>
          )}

          {/* K4 — Governance Reports */}
          {section === "govreports" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Governance Reports</h2>
              <p className="ws-section-desc">Aggregated governance report — policy breakdown, audit event summary, member stats. No new log storage.</p>
              <GovReportsPanel />
            </div>
          )}

          {/* K5 — Automation Overview */}
          {section === "automation" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Automation</h2>
              <p className="ws-section-desc">Workspace automation overview — active rules, recent executions, and run statistics.</p>
              <AutomationOverviewPanel />
            </div>
          )}

          {/* K5 — Rule Builder */}
          {section === "autorules" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Rule Builder</h2>
              <p className="ws-section-desc">Create automation rules with triggers, conditions, actions, and approval gates. Use dry-run to preview before enabling.</p>
              <RuleBuilderPanel />
            </div>
          )}

          {/* K5 — Trigger Library */}
          {section === "autotemplates" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Trigger Library</h2>
              <p className="ws-section-desc">Built-in and custom rule templates. Apply a template to create a pre-configured rule instantly.</p>
              <TriggerLibraryPanel />
            </div>
          )}

          {/* K5 — Automation History */}
          {section === "autohistory" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Automation History</h2>
              <p className="ws-section-desc">Execution history for all automation rules — outcomes, detail messages, and dry-run results.</p>
              <AutoHistoryPanel />
            </div>
          )}

          {/* K5 — Automation Statistics */}
          {section === "autostats" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Automation Statistics</h2>
              <p className="ws-section-desc">Run counts, outcome distribution, trigger type breakdown, and top rules by activity.</p>
              <AutoStatsPanel />
            </div>
          )}

          {/* K6 Enterprise Analytics */}
          {section === "analytics" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Executive Analytics</h2>
              <p className="ws-section-desc">Top-level platform KPIs, health score, error rates, AI provider status, and intent distribution.</p>
              <ExecutivePanel />
            </div>
          )}
          {section === "wshealth" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Workspace Health</h2>
              <p className="ws-section-desc">Security score, compliance grade, team member status, and quota utilization aggregated from all enterprise layers.</p>
              <WorkspaceHealthPanel />
            </div>
          )}
          {section === "autoROI" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Automation ROI</h2>
              <p className="ws-section-desc">Estimated time saved, automation run success rate, outcome distribution, and top rules by activity.</p>
              <AutomationROIPanel />
            </div>
          )}
          {section === "aiutilization" && (
            <div className="ws-section">
              <h2 className="ws-section-title">AI Provider Utilization</h2>
              <p className="ws-section-desc">
                Call counts, availability, and latency for all configured AI providers (Groq, OpenRouter, OpenAI,
                Claude, Gemini, Ollama). To add, rotate, or remove a provider's API key, use{" "}
                <button className="ws-inline-link" onClick={() => onNavigate && onNavigate("integrations")}>Connector Center</button>{" "}
                — key management lives there, not here.
              </p>
              <AIUtilizationPanel />
            </div>
          )}
          {section === "capacity" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Runtime Capacity</h2>
              <p className="ws-section-desc">Process memory, task queue depth, graph execution stats, mission counts, and slow-task detection.</p>
              <RuntimeCapacityPanel />
            </div>
          )}
          {section === "entreports" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Enterprise Reports</h2>
              <p className="ws-section-desc">Full rolled-up enterprise report covering all analytics domains: executive, workspace, automation, security, governance, AI, and runtime.</p>
              <EnterpriseReportsPanel />
            </div>
          )}

          {/* L1 Plugin Manager */}
          {section === "plugins" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Installed Plugins</h2>
              <p className="ws-section-desc">Manage workspace plugins — install, enable, disable, configure. Each plugin extends platform capabilities.</p>
              <PluginsPanel />
            </div>
          )}
          {section === "plughealth" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Plugin Health</h2>
              <p className="ws-section-desc">Live health status for all installed plugins. Run a health check to refresh. Config schema validation and enabled-state checks.</p>
              <PluginHealthPanel />
            </div>
          )}
          {section === "plugdiag" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Plugin Diagnostics</h2>
              <p className="ws-section-desc">Last 50 diagnostic events per plugin — installs, upgrades, enable/disable, config changes, health checks.</p>
              <PluginDiagPanel />
            </div>
          )}

          {/* L2 Marketplace */}
          {section === "marketplace" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Capability Marketplace</h2>
              <p className="ws-section-desc">Discover and install plugins that extend your workspace capabilities. Browse by category, rating, and verification status.</p>
              <MarketplaceCatalogPanel />
            </div>
          )}
          {section === "mktfeatured" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Featured Plugins</h2>
              <p className="ws-section-desc">Curated, verified plugins with the highest ratings and install counts.</p>
              <MarketplaceFeaturedPanel />
            </div>
          )}
          {section === "mktsearch" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Search Marketplace</h2>
              <p className="ws-section-desc">Search by name, tag, capability, or author. Results ranked by rating and install count.</p>
              <MarketplaceSearchPanel />
            </div>
          )}
          {section === "mktrecs" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Recommended for You</h2>
              <p className="ws-section-desc">Plugins that fill capability gaps in your current workspace configuration.</p>
              <MarketplaceRecsPanel />
            </div>
          )}

          {/* L3 Extension Runtime */}
          {section === "extruntime" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Extension Runtime</h2>
              <p className="ws-section-desc">Lifecycle state for all loaded extensions — active, suspended, error, unloaded. Load, unload, suspend, resume, and restart from here.</p>
              <ExtRuntimePanel />
            </div>
          )}
          {section === "extmetrics" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Runtime Metrics</h2>
              <p className="ws-section-desc">Aggregate crash counts, restart counts, hook registrations, event bus stats, and state distribution.</p>
              <ExtMetricsPanel />
            </div>
          )}
          {section === "exthooks" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Registered Hooks</h2>
              <p className="ws-section-desc">All hooks registered by loaded extensions. Hook calls are rate-limited per extension per minute.</p>
              <ExtHooksPanel />
            </div>
          )}
          {section === "extquotas" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Extension Quotas</h2>
              <p className="ws-section-desc">Resource quota configuration and live usage per extension — hook calls, active subscriptions, crash recovery budget.</p>
              <ExtQuotasPanel />
            </div>
          )}

          {/* Notifications */}
          {section === "notifications" && (
            <div className="ws-section">
              <h2 className="ws-section-title">Notifications</h2>
              <p className="ws-section-desc">
                No notification-dispatch backend exists yet (no email/push sending gated on these flags) — your
                choices are saved locally as a statement of intent for when that capability ships, not enforced today.
              </p>
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
                  // A.6 fix: Razorpay's badge previously relied solely on
                  // connectorStatus, which only ever populates for operator
                  // accounts (see the operatorOnly-gated fetch above) — every
                  // regular founder saw "Not connected" right next to the
                  // static "API key configured..." setup text, a direct
                  // self-contradiction, even when RAZORPAY_KEY_ID/SECRET were
                  // genuinely set in .env. settingsStatus.razorpay.configured
                  // comes from GET /settings/status (requireAuth only, same
                  // non-operator-safe env check WhatsApp already uses below),
                  // so it reflects real credential presence for every account.
                  const liveConnected = integ.id === "whatsapp"
                    ? settingsStatus?.whatsapp?.configured
                    : integ.id === "razorpay"
                    ? (settingsStatus?.razorpay?.configured || connectorStatus[integ.connectorId]?.status === "CONNECTED")
                    : connectorStatus[integ.connectorId]?.status === "CONNECTED";
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
