import React, { useState, useCallback } from "react";
import { track } from "../analytics";
import "./EmailMarketingOS.css";

// ── Storage ──────────────────────────────────────────────────────────
const CAMPAIGNS_KEY = "ooplix_email_campaigns";
const DRAFTS_KEY    = "ooplix_email_drafts";

function _load(key, fallback = []) {
  try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
  catch { return fallback; }
}
function _save(key, data) {
  localStorage.setItem(key, JSON.stringify(data));
}

// ── Audience segments ────────────────────────────────────────────────
const SEGMENTS = [
  { id: "all",         label: "All subscribers",    count: null, desc: "Everyone who opted in" },
  { id: "trial",       label: "Active trial",        count: null, desc: "Users currently in trial" },
  { id: "hot_leads",   label: "Hot leads",           count: null, desc: "Leads marked hot in pipeline" },
  { id: "paid",        label: "Paid customers",      count: null, desc: "Active subscribers" },
  { id: "churned",     label: "Churned",             count: null, desc: "Cancelled or expired" },
  { id: "no_activity", label: "No activity (7d)",    count: null, desc: "Signed up but haven't used the product" },
];

// ── Email templates ──────────────────────────────────────────────────
const EMAIL_TEMPLATES = [
  {
    id:      "welcome",
    label:   "Welcome email",
    subject: "Welcome to Ooplix — here's how to start",
    segment: "all",
    body: `Hi {{first_name}},

Welcome to Ooplix — your AI Operating System for business.

Here's what to do in the next 10 minutes:

1. Add your first contact (name + WhatsApp number)
   → Ooplix queues the first follow-up automatically.

2. Connect WhatsApp (one-time QR scan)
   → Every follow-up sends on schedule without you.

3. Open the Control Center
   → Watch everything run in real time.

That's it. The system handles the rest.

If you have questions, reply to this email — I read every one.

— The Ooplix Team`,
  },
  {
    id:      "trial_day3",
    label:   "Trial day 3 check-in",
    subject: "3 days in — have you tried this yet?",
    segment: "trial",
    body: `Hi {{first_name}},

You're 3 days into your Ooplix trial. Quick check-in.

Have you connected WhatsApp yet? That's the single action that unlocks everything — automated greetings, follow-ups, and closing messages run without you the moment it's set up.

If you haven't yet, it takes 2 minutes:
→ Contacts tab → Connect WhatsApp → scan the QR code.

If you have connected it — great. Check your Activity feed to see what's already been sent on your behalf.

Any questions? Just reply.

— Ooplix`,
  },
  {
    id:      "trial_expiry",
    label:   "Trial expiry (3 days before)",
    subject: "Your Ooplix trial ends in 3 days",
    segment: "trial",
    body: `Hi {{first_name}},

Your 7-day Ooplix trial ends on {{trial_end_date}}.

If you've added contacts and connected WhatsApp, your follow-up sequences are running right now. Upgrading keeps them running without interruption.

Starter plan: ₹999/month — up to 100 leads, 4 follow-up tiers.
Growth plan: ₹2,499/month — up to 1,000 leads, full feature access.

Upgrade in one click from the Billing tab in your account.

If you haven't had a chance to fully try the product and want a 3-day extension, just reply to this email.

— Ooplix`,
  },
  {
    id:      "win_back",
    label:   "Win-back (churned users)",
    subject: "What happened? (and a quick offer)",
    segment: "churned",
    body: `Hi {{first_name}},

We noticed you left Ooplix. That's okay — but we want to understand why.

Was it:
- The price?
- Missing a feature you needed?
- Didn't have time to set it up properly?
- Something else?

Reply and tell us. If it's something we can fix, we'll fix it — and offer you a free 14-day extension to try the product again properly.

We built Ooplix for operators who were losing leads to slow follow-up. If that's still a problem for you, we want to help solve it.

— Ooplix`,
  },
  {
    id:      "newsletter",
    label:   "Monthly newsletter",
    subject: "Ooplix Update — {{month}} {{year}}",
    segment: "all",
    body: `Hi {{first_name}},

Here's what's new at Ooplix this month.

──────────────────────────────────
WHAT'S NEW
──────────────────────────────────

[Feature 1 headline]
[1-2 sentence description of the feature and who it helps]

[Feature 2 headline]
[1-2 sentence description]

──────────────────────────────────
FROM THE OPERATOR COMMUNITY
──────────────────────────────────

[Quick win or use case from a real operator — anonymised with permission]

──────────────────────────────────
TIP OF THE MONTH
──────────────────────────────────

[One actionable tip for getting more from Ooplix — specific and short]

──────────────────────────────────

That's it for this month.

If there's something you'd like to see in Ooplix, just reply — product decisions are driven by operator feedback.

— The Ooplix Team`,
  },
];

// ── Pre-send checklist ───────────────────────────────────────────────
const SEND_CHECKLIST = [
  { id: "subject",    label: "Subject line written and tested (A/B if possible)"    },
  { id: "preview",    label: "Preview text set (first 90 chars after subject)"       },
  { id: "segment",    label: "Correct audience segment selected"                    },
  { id: "links",      label: "All links tested and working"                          },
  { id: "unsubscribe",label: "Unsubscribe link included (required by law)"           },
  { id: "plain_text", label: "Plain-text version provided"                           },
  { id: "test_send",  label: "Test email sent to yourself"                           },
  { id: "timing",     label: "Scheduled for best send time (Tue–Thu 9–11am IST)"    },
  { id: "from_name",  label: "From name is 'Ooplix' or personal name — not 'no-reply'" },
  { id: "gdpr",       label: "Recipients opted-in explicitly"                         },
];

// ── Performance placeholders ─────────────────────────────────────────
const PERF_METRICS = [
  { label: "Campaigns sent",    value: "—",    hint: "Connect ESP to track"  },
  { label: "Avg open rate",     value: "—",    hint: "Industry avg: 21%"     },
  { label: "Avg click rate",    value: "—",    hint: "Industry avg: 2.6%"    },
  { label: "Subscribers",       value: "—",    hint: "Add to ESP to track"   },
  { label: "Unsubscribe rate",  value: "—",    hint: "Keep below 0.5%"       },
  { label: "Best performing",   value: "—",    hint: "Track after 3+ sends"  },
];

// ── ESP integrations ──────────────────────────────────────────────────
const ESP_OPTIONS = [
  { name: "Mailchimp",       url: "https://mailchimp.com",        note: "Free up to 500 contacts"            },
  { name: "Brevo (Sendinblue)", url: "https://brevo.com",         note: "Free 300 emails/day"                },
  { name: "ConvertKit",      url: "https://convertkit.com",       note: "Best for creator/coach audiences"   },
  { name: "Mailmodo",        url: "https://mailmodo.com",         note: "India-first, AMP email support"     },
  { name: "Amazon SES",      url: "https://aws.amazon.com/ses/",  note: "₹0.10/1000 emails — lowest cost"   },
];

// ── Sub-components ────────────────────────────────────────────────────
function MetricTile({ m }) {
  return (
    <div className="em-metric-tile">
      <span className="em-metric-value">{m.value}</span>
      <span className="em-metric-label">{m.label}</span>
      <span className="em-metric-hint">{m.hint}</span>
    </div>
  );
}

function SegmentRow({ seg, selected, onSelect }) {
  return (
    <button
      className={`em-segment-row${selected ? " em-segment-row--active" : ""}`}
      onClick={() => onSelect(seg.id)}
    >
      <div className="em-segment-body">
        <span className="em-segment-label">{seg.label}</span>
        <span className="em-segment-desc">{seg.desc}</span>
      </div>
      <span className="em-segment-count">{seg.count ?? "—"}</span>
    </button>
  );
}

function SendChecklistPanel() {
  const [checked, setChecked] = useState({});
  const doneCount = Object.values(checked).filter(Boolean).length;
  const allDone   = doneCount === SEND_CHECKLIST.length;

  return (
    <div className="em-send-checklist">
      <div className="em-checklist-progress">
        <div className="em-checklist-bar">
          <div
            className="em-checklist-fill"
            style={{ width: `${(doneCount / SEND_CHECKLIST.length) * 100}%` }}
          />
        </div>
        <span className="em-checklist-count">{doneCount}/{SEND_CHECKLIST.length}</span>
      </div>
      {SEND_CHECKLIST.map(c => (
        <label key={c.id} className={`em-check-item${checked[c.id] ? " em-check-item--done" : ""}`}>
          <input
            type="checkbox"
            checked={!!checked[c.id]}
            onChange={() => setChecked(p => ({ ...p, [c.id]: !p[c.id] }))}
            className="em-checkbox"
          />
          <span className="em-check-label">{c.label}</span>
        </label>
      ))}
      {allDone && (
        <div className="em-checklist-ready">
          ✓ All checks complete — ready to send
        </div>
      )}
    </div>
  );
}

function DraftEditor({ draft, onChange, onSave, onBack }) {
  return (
    <div className="em-draft-editor">
      <div className="em-draft-editor-header">
        <button className="em-back-btn" onClick={onBack}>← Back</button>
        <button className="em-save-btn" onClick={onSave}>Save draft</button>
      </div>
      <div className="em-draft-field">
        <label className="em-field-label">Subject line</label>
        <input
          className="em-field-input"
          value={draft.subject}
          onChange={e => onChange({ ...draft, subject: e.target.value })}
          placeholder="Subject line…"
        />
      </div>
      <div className="em-draft-field">
        <label className="em-field-label">
          Segment
          <span className="em-field-hint"> — who receives this</span>
        </label>
        <select
          className="em-field-select"
          value={draft.segment}
          onChange={e => onChange({ ...draft, segment: e.target.value })}
        >
          {SEGMENTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </div>
      <div className="em-draft-field">
        <label className="em-field-label">Body</label>
        <textarea
          className="em-field-textarea"
          value={draft.body}
          onChange={e => onChange({ ...draft, body: e.target.value })}
          rows={22}
          spellCheck
        />
      </div>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────
export default function EmailMarketingOS({ onNavigate }) {
  const [section,       setSection]       = useState("overview");
  const [campaigns,     setCampaigns]     = useState(() => _load(CAMPAIGNS_KEY, []));
  const [drafts,        setDrafts]        = useState(() => _load(DRAFTS_KEY, []));
  const [editingDraft,  setEditingDraft]  = useState(null);
  const [selSegment,    setSelSegment]    = useState("all");

  React.useEffect(() => { track.event("email_os_viewed"); }, []);

  const handleNewDraft = useCallback((template) => {
    const d = {
      id:        `edraft_${Date.now()}`,
      subject:   template ? template.subject : "",
      body:      template ? template.body    : "",
      segment:   template ? template.segment : "all",
      status:    "draft",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setEditingDraft(d);
    track.event("email_draft_created", { template: template?.id || "blank" });
  }, []);

  const handleSaveDraft = useCallback(() => {
    if (!editingDraft) return;
    const updated = { ...editingDraft, updatedAt: new Date().toISOString() };
    const all = _load(DRAFTS_KEY, []);
    const idx = all.findIndex(d => d.id === updated.id);
    if (idx >= 0) all[idx] = updated; else all.unshift(updated);
    _save(DRAFTS_KEY, all.slice(0, 50));
    setDrafts(_load(DRAFTS_KEY, []));
    setEditingDraft(null);
    track.event("email_draft_saved");
  }, [editingDraft]);

  if (editingDraft) {
    return (
      <div className="email-os page-enter">
        <DraftEditor
          draft={editingDraft}
          onChange={setEditingDraft}
          onSave={handleSaveDraft}
          onBack={() => setEditingDraft(null)}
        />
      </div>
    );
  }

  return (
    <div className="email-os page-enter">

      {/* Header */}
      <div className="em-header">
        <div>
          <h1 className="em-title">Email Marketing OS</h1>
          <p className="em-subtitle">Campaigns, drafts, audience segments, and performance tracking.</p>
        </div>
        <button className="em-new-btn" onClick={() => handleNewDraft(null)}>
          + New Draft
        </button>
      </div>

      {/* Tabs */}
      <div className="em-tabs">
        {[
          { id: "overview",   label: "Overview"      },
          { id: "templates",  label: "Templates"     },
          { id: "drafts",     label: `Drafts (${drafts.length})` },
          { id: "segments",   label: "Segments"      },
          { id: "checklist",  label: "Send Checklist"},
          { id: "esp",        label: "ESP Setup"     },
        ].map(t => (
          <button
            key={t.id}
            className={`em-tab${section === t.id ? " em-tab--active" : ""}`}
            onClick={() => setSection(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="em-content" key={section}>

        {/* Overview — performance + quick actions */}
        {section === "overview" && (
          <div className="em-overview">
            <div className="em-perf-grid">
              {PERF_METRICS.map(m => <MetricTile key={m.label} m={m} />)}
            </div>
            <div className="em-overview-actions">
              <p className="em-sub-label">Quick actions</p>
              <div className="em-action-grid">
                <button className="em-action-card" onClick={() => handleNewDraft(null)}>
                  <span className="em-action-icon">✉</span>
                  <span className="em-action-label">New blank draft</span>
                </button>
                <button className="em-action-card" onClick={() => setSection("templates")}>
                  <span className="em-action-icon">◎</span>
                  <span className="em-action-label">Use a template</span>
                </button>
                <button className="em-action-card" onClick={() => setSection("segments")}>
                  <span className="em-action-icon">◈</span>
                  <span className="em-action-label">View segments</span>
                </button>
                <button className="em-action-card" onClick={() => setSection("checklist")}>
                  <span className="em-action-icon">✓</span>
                  <span className="em-action-label">Pre-send checklist</span>
                </button>
              </div>
            </div>
            <div className="em-esp-prompt">
              <span className="em-esp-prompt-icon">⚡</span>
              <div>
                <p className="em-esp-prompt-title">Connect an Email Service Provider</p>
                <p className="em-esp-prompt-sub">
                  Ooplix drafts your emails — an ESP (Mailchimp, Brevo, ConvertKit) sends them and tracks performance.
                  See the ESP Setup tab to get started.
                </p>
              </div>
              <button className="em-esp-prompt-btn" onClick={() => setSection("esp")}>
                Set up ESP →
              </button>
            </div>
          </div>
        )}

        {/* Templates */}
        {section === "templates" && (
          <div className="em-templates-list">
            {EMAIL_TEMPLATES.map(t => (
              <div key={t.id} className="em-template-card">
                <div className="em-template-body">
                  <span className="em-template-name">{t.label}</span>
                  <span className="em-template-subject">Subject: {t.subject}</span>
                  <span className="em-template-segment">
                    Segment: {SEGMENTS.find(s => s.id === t.segment)?.label}
                  </span>
                  <p className="em-template-preview">{t.body.slice(0, 120)}…</p>
                </div>
                <div className="em-template-actions">
                  <button className="em-template-use" onClick={() => handleNewDraft(t)}>
                    Use template →
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Drafts */}
        {section === "drafts" && (
          <div className="em-drafts-section">
            {drafts.length === 0 ? (
              <div className="em-empty">
                <span className="em-empty-icon">✉</span>
                <p className="em-empty-title">No drafts yet</p>
                <p className="em-empty-sub">Create a new draft or use a template to get started.</p>
                <button className="em-empty-cta" onClick={() => setSection("templates")}>
                  Browse templates →
                </button>
              </div>
            ) : (
              <div className="em-draft-list">
                {drafts.map(d => (
                  <button key={d.id} className="em-draft-row" onClick={() => setEditingDraft(d)}>
                    <div className="em-draft-info">
                      <span className="em-draft-subject">{d.subject || "(No subject)"}</span>
                      <span className="em-draft-meta">
                        {SEGMENTS.find(s => s.id === d.segment)?.label} ·{" "}
                        {new Date(d.updatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                      </span>
                    </div>
                    <span className={`em-draft-status em-draft-status--${d.status}`}>{d.status}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Segments */}
        {section === "segments" && (
          <div className="em-segments-section">
            <p className="em-segments-note">
              Segments are defined by user behaviour. Connect your ESP and sync your Ooplix user data to populate counts.
            </p>
            {SEGMENTS.map(seg => (
              <SegmentRow
                key={seg.id}
                seg={seg}
                selected={selSegment === seg.id}
                onSelect={setSelSegment}
              />
            ))}
          </div>
        )}

        {/* Checklist */}
        {section === "checklist" && <SendChecklistPanel />}

        {/* ESP Setup */}
        {section === "esp" && (
          <div className="em-esp-list">
            <p className="em-esp-intro">
              Choose an Email Service Provider (ESP) to send and track your campaigns.
              Ooplix handles drafts and templates — the ESP handles delivery, tracking, and compliance.
            </p>
            {ESP_OPTIONS.map(e => (
              <div key={e.name} className="em-esp-card">
                <div className="em-esp-info">
                  <span className="em-esp-name">{e.name}</span>
                  <span className="em-esp-note">{e.note}</span>
                </div>
                <a
                  href={e.url}
                  target="_blank" rel="noopener noreferrer"
                  className="em-esp-link"
                  onClick={() => track.event("esp_link_clicked", { esp: e.name })}
                >
                  Set up {e.name} ↗
                </a>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}
