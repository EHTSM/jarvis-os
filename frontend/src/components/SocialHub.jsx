import React, { useState, useEffect } from "react";
import { track } from "../analytics";
import "./SocialHub.css";

// ── Channel catalogue ─────────────────────────────────────────────────
const CHANNELS = [
  {
    id:       "linkedin",
    name:     "LinkedIn",
    icon:     "in",
    color:    "#0a66c2",
    handle:   "@ooplix",
    status:   "not_connected",
    audience: null,
    lastPost: null,
    bestTime: "Tue–Thu, 9–11am IST",
    tips:     ["Stories outperform plain posts by 3×", "End with a question to drive comments", "Optimal length: 150–300 words"],
    setupUrl: "https://www.linkedin.com/company/setup",
  },
  {
    id:       "twitter",
    name:     "X / Twitter",
    icon:     "𝕏",
    color:    "#e7e9ea",
    handle:   "@ooplix",
    status:   "not_connected",
    audience: null,
    lastPost: null,
    bestTime: "Mon–Fri, 8–10am & 6–9pm IST",
    tips:     ["Threads get 4× more reach than single tweets", "Use 1-2 hashtags max", "Hook in the first 8 words"],
    setupUrl: "https://twitter.com/settings",
  },
  {
    id:       "facebook",
    name:     "Facebook",
    icon:     "f",
    color:    "#1877f2",
    handle:   "Ooplix",
    status:   "not_connected",
    audience: null,
    lastPost: null,
    bestTime: "Wed–Fri, 1–4pm IST",
    tips:     ["Video gets 6× more engagement than images", "Facebook Groups outperform Pages for reach", "Post 3–5× per week for algorithm favour"],
    setupUrl: "https://www.facebook.com/pages/create",
  },
  {
    id:       "instagram",
    name:     "Instagram",
    icon:     "◎",
    color:    "#e1306c",
    handle:   "@ooplix",
    status:   "not_connected",
    audience: null,
    lastPost: null,
    bestTime: "Mon, Wed, Fri 11am–1pm IST",
    tips:     ["Carousel posts get 3× more reach", "Reels still have the strongest algorithm boost", "Hashtags: 5–10 niche ones outperform 30 generic"],
    setupUrl: "https://www.instagram.com/accounts/emailsignup/",
  },
  {
    id:       "youtube",
    name:     "YouTube",
    icon:     "▶",
    color:    "#ff0000",
    handle:   "Ooplix",
    status:   "not_connected",
    audience: null,
    lastPost: null,
    bestTime: "Fri–Sun, 2–4pm IST",
    tips:     ["Shorts (under 60s) are the fastest path to subscribers", "Thumbnail + title drives 70% of clicks", "Post consistently: 1× per week beats 3× then nothing"],
    setupUrl: "https://www.youtube.com/create_channel",
  },
];

// ── Publishing checklist ──────────────────────────────────────────────
const PUBLISH_CHECKLIST = [
  { id: "copy",       label: "Content written and reviewed"             },
  { id: "visual",     label: "Visual asset prepared (image/video/card)" },
  { id: "cta",        label: "Clear CTA included"                       },
  { id: "tracking",   label: "UTM parameters added to links"            },
  { id: "schedule",   label: "Scheduled for best-engagement time"       },
  { id: "crosspost",  label: "Cross-posting plan in place"              },
];

// ── Content calendar (placeholder data) ─────────────────────────────
const CALENDAR_ITEMS = [
  { day: "Mon", channel: "linkedin",  topic: "Value post: cost of manual follow-up",   status: "plan"    },
  { day: "Tue", channel: "twitter",   topic: "Hook tweet: freelancer pain stat",         status: "plan"    },
  { day: "Wed", channel: "linkedin",  topic: "Story post: automation case study",        status: "plan"    },
  { day: "Thu", channel: "twitter",   topic: "Thread: 5-step WhatsApp automation setup", status: "plan"    },
  { day: "Fri", channel: "instagram", topic: "Carousel: Ooplix feature walkthrough",     status: "plan"    },
  { day: "Sat", channel: "youtube",   topic: "Short: 60-sec Ooplix demo",                status: "plan"    },
  { day: "Sun", channel: "facebook",  topic: "Community post: weekly automation tips",   status: "plan"    },
];

const STATUS_COLORS = {
  connected:     "var(--success)",
  not_connected: "var(--text-faint)",
  error:         "var(--danger)",
};

// ── Channel card ──────────────────────────────────────────────────────
function ChannelCard({ ch, onSetup }) {
  const [showTips, setShowTips] = useState(false);
  const connected = ch.status === "connected";
  return (
    <div className={`sh-channel-card${connected ? " sh-channel-card--connected" : ""}`}>
      <div className="sh-channel-header">
        <div className="sh-channel-icon" style={{ background: ch.color + "20", color: ch.color, border: `1px solid ${ch.color}30` }}>
          {ch.icon}
        </div>
        <div className="sh-channel-meta">
          <span className="sh-channel-name">{ch.name}</span>
          <span className="sh-channel-handle">{ch.handle}</span>
        </div>
        <div className="sh-channel-status-badge" style={{ color: STATUS_COLORS[ch.status] }}>
          <span className="sh-status-dot" style={{ background: STATUS_COLORS[ch.status] }} />
          {connected ? "Connected" : "Not set up"}
        </div>
      </div>

      <div className="sh-channel-stats">
        <div className="sh-channel-stat">
          <span className="sh-stat-label">Audience</span>
          <span className="sh-stat-val">{ch.audience ?? "—"}</span>
        </div>
        <div className="sh-channel-stat">
          <span className="sh-stat-label">Last post</span>
          <span className="sh-stat-val">{ch.lastPost ?? "Never"}</span>
        </div>
        <div className="sh-channel-stat">
          <span className="sh-stat-label">Best time</span>
          <span className="sh-stat-val">{ch.bestTime}</span>
        </div>
      </div>

      <div className="sh-channel-actions">
        <button className="sh-tips-btn" onClick={() => setShowTips(t => !t)}>
          {showTips ? "Hide tips" : "Posting tips"}
        </button>
        {!connected && (
          <a
            href={ch.setupUrl}
            target="_blank" rel="noopener noreferrer"
            className="sh-setup-btn"
            onClick={() => track.event("social_setup_clicked", { channel: ch.id })}
          >
            Set up {ch.name} ↗
          </a>
        )}
        {connected && (
          <button
            className="sh-post-btn"
            onClick={() => track.event("social_post_clicked", { channel: ch.id })}
          >
            Create post →
          </button>
        )}
      </div>

      {showTips && (
        <ul className="sh-tips-list">
          {ch.tips.map((t, i) => (
            <li key={i} className="sh-tip"><span className="sh-tip-dot">◎</span>{t}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Calendar row ──────────────────────────────────────────────────────
function CalendarRow({ item }) {
  const ch     = CHANNELS.find(c => c.id === item.channel);
  const color  = ch?.color || "var(--text-faint)";
  return (
    <div className="sh-cal-row">
      <span className="sh-cal-day">{item.day}</span>
      <span className="sh-cal-channel-dot" style={{ background: color }} />
      <span className="sh-cal-channel-name" style={{ color }}>{ch?.name}</span>
      <span className="sh-cal-topic">{item.topic}</span>
      <span className={`sh-cal-status sh-cal-status--${item.status}`}>{item.status}</span>
    </div>
  );
}

// ── Checklist ─────────────────────────────────────────────────────────
function PublishChecklist() {
  const [checked, setChecked] = useState({});
  const all = PUBLISH_CHECKLIST.every(c => checked[c.id]);
  return (
    <div className="sh-checklist">
      <p className="sh-sub-label">Pre-publish checklist</p>
      {PUBLISH_CHECKLIST.map(c => (
        <label key={c.id} className={`sh-check-item${checked[c.id] ? " sh-check-item--done" : ""}`}>
          <input
            type="checkbox"
            checked={!!checked[c.id]}
            onChange={() => setChecked(prev => ({ ...prev, [c.id]: !prev[c.id] }))}
            className="sh-checkbox"
          />
          <span className="sh-check-label">{c.label}</span>
        </label>
      ))}
      {all && <p className="sh-check-ready">✓ Ready to publish</p>}
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────
export default function SocialHub({ onNavigate }) {
  const [section, setSection] = useState("channels");

  useEffect(() => { track.event("social_hub_viewed"); }, []);

  return (
    <div className="social-hub page-enter">
      <div className="sh-header">
        <div>
          <h1 className="sh-title">Social Publishing Hub</h1>
          <p className="sh-subtitle">Manage, schedule, and publish across every channel.</p>
        </div>
        <button className="sh-content-btn" onClick={() => onNavigate?.("content")}>
          Open Content Engine →
        </button>
      </div>

      {/* Connected count */}
      <div className="sh-summary-strip">
        {[
          { label: "Channels",     val: CHANNELS.length               },
          { label: "Connected",    val: CHANNELS.filter(c=>c.status==="connected").length, color: "var(--success)" },
          { label: "Not set up",   val: CHANNELS.filter(c=>c.status==="not_connected").length, color: "var(--text-faint)" },
          { label: "This week",    val: CALENDAR_ITEMS.length + " posts planned" },
        ].map(s => (
          <div key={s.label} className="sh-summary-item">
            <span className="sh-summary-val" style={s.color ? { color: s.color } : {}}>{s.val}</span>
            <span className="sh-summary-label">{s.label}</span>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="sh-tabs">
        {[
          { id: "channels",  label: "Channels"       },
          { id: "calendar",  label: "Content Calendar"},
          { id: "checklist", label: "Publish Checklist"},
        ].map(t => (
          <button
            key={t.id}
            className={`sh-tab${section === t.id ? " sh-tab--active" : ""}`}
            onClick={() => setSection(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="sh-content" key={section}>

        {section === "channels" && (
          <div className="sh-channels-grid">
            {CHANNELS.map(ch => (
              <ChannelCard key={ch.id} ch={ch} />
            ))}
          </div>
        )}

        {section === "calendar" && (
          <div className="sh-calendar">
            <p className="sh-cal-note">
              Content calendar for this week. Update statuses as posts are published.
              Connect to a scheduling tool (Buffer, Later, Publer) for automation.
            </p>
            <div className="sh-cal-list">
              {CALENDAR_ITEMS.map((item, i) => (
                <CalendarRow key={i} item={item} />
              ))}
            </div>
          </div>
        )}

        {section === "checklist" && <PublishChecklist />}

      </div>
    </div>
  );
}
