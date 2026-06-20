import React, { useState, useCallback, useEffect } from "react";
import { track } from "../analytics";
import "./ReferralEngine.css";

// ── Referral config ───────────────────────────────────────────────────
const REFERRAL_REWARDS = [
  {
    milestone: 1,
    label:     "First referral",
    reward:    "1 month free",
    desc:      "Get 1 month of your current plan free when your first referral signs up.",
    icon:      "✦",
    color:     "var(--accent2)",
  },
  {
    milestone: 3,
    label:     "3 referrals",
    reward:    "3 months free",
    desc:      "Refer 3 operators and get 3 months on us.",
    icon:      "◉",
    color:     "var(--accent)",
  },
  {
    milestone: 10,
    label:     "10 referrals",
    reward:    "1 year free + Growth plan",
    desc:      "Reach 10 successful referrals and get a full year of Growth plan at no cost.",
    icon:      "★",
    color:     "var(--warning)",
  },
  {
    milestone: 25,
    label:     "25 referrals",
    reward:    "Lifetime Growth access",
    desc:      "25 successful referrals earns you lifetime access to the Growth plan.",
    icon:      "⬟",
    color:     "var(--success)",
  },
];

// ── Sharing templates ─────────────────────────────────────────────────
const SHARE_TEMPLATES = [
  {
    id:       "whatsapp",
    channel:  "WhatsApp",
    icon:     "◉",
    color:    "#25d366",
    message:  "Hey — I've been using Ooplix for automated WhatsApp follow-ups and it's saved me hours every week. Thought you'd find it useful too.\n\nFree 7-day trial (no card): {{referral_link}}",
  },
  {
    id:       "linkedin",
    channel:  "LinkedIn",
    icon:     "in",
    color:    "#0a66c2",
    message:  "If you're running a business and manually following up with leads, there's a better way.\n\nI've been using Ooplix — an AI OS that automates WhatsApp sequences, generates Razorpay payment links, and runs everything in the background.\n\nFree trial: {{referral_link}}\n\n#automation #smallbusiness #India",
  },
  {
    id:       "twitter",
    channel:  "X / Twitter",
    icon:     "𝕏",
    color:    "#e7e9ea",
    message:  "Stopped manually following up with leads. Using Ooplix — it sends WhatsApp sequences automatically, collects payments, and runs workflows in the background.\n\n7-day free trial if you want to try it: {{referral_link}}",
  },
  {
    id:       "email",
    channel:  "Email",
    icon:     "✉",
    color:    "var(--warning)",
    message:  "Subject: Tool I've been using for lead follow-up\n\nHey,\n\nI've been using a tool called Ooplix that automates my entire WhatsApp follow-up sequence. Once I add a contact, it handles the greeting, the follow-up, the closing message — without me touching anything.\n\nThought it might be useful for you. There's a 7-day free trial, no card required:\n\n{{referral_link}}\n\nLet me know if you try it.",
  },
];

const BASE = process.env.REACT_APP_API_URL || "";
const _api = (path) => fetch(`${BASE}${path}`, { credentials: "include" }).then(r => r.json());
const _post = (path, body) => fetch(`${BASE}${path}`, {
  method: "POST", credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
}).then(r => r.json());

function CopyButton({ text, label = "Copy" }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      track.event("referral_link_copied", { context: label });
    });
  };
  return (
    <button className="ref-copy-btn" onClick={handleCopy}>
      {copied ? "✓ Copied!" : label}
    </button>
  );
}

export default function ReferralEngine({ onNavigate }) {
  const [section,     setSection]     = useState("link");
  const [copiedTpl,   setCopiedTpl]   = useState(null);
  const [dashboard,   setDashboard]   = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);

  const referralCode = dashboard?.code || "—";
  const referralLink = dashboard?.code
    ? `https://ooplix.com/?ref=${dashboard.code}`
    : "https://ooplix.com/?ref=loading…";

  useEffect(() => {
    track.event("referral_center_viewed");
    _api("/launch/referral").then(r => { if (r.ok) setDashboard(r.dashboard); });
    _api("/launch/referral/leaderboard").then(r => { if (r.ok) setLeaderboard(r.leaderboard || []); });
  }, []);

  const handleCopyTemplate = (id, text) => {
    navigator.clipboard.writeText(text.replace("{{referral_link}}", referralLink));
    setCopiedTpl(id);
    setTimeout(() => setCopiedTpl(null), 2000);
    track.event("referral_template_copied", { channel: id });
  };

  return (
    <div className="referral-engine page-enter">

      <div className="ref-header">
        <div>
          <h1 className="ref-title">Referral Engine</h1>
          <p className="ref-subtitle">Earn rewards for every operator you bring to Ooplix.</p>
        </div>
        <div className="ref-header-stat">
          <span className="ref-stat-num">0</span>
          <span className="ref-stat-label">Referrals</span>
        </div>
      </div>

      {/* Progress toward next reward */}
      <div className="ref-progress-bar-card">
        <div className="ref-pbcard-top">
          <span className="ref-pbcard-label">Progress to next reward</span>
          <span className="ref-pbcard-reward">1 referral → 1 month free</span>
        </div>
        <div className="ref-pbcard-track">
          <div className="ref-pbcard-fill" style={{ width: "0%" }} />
        </div>
        <span className="ref-pbcard-count">0 / 1 referrals</span>
      </div>

      {/* Tabs */}
      <div className="ref-tabs">
        {[
          { id: "link",        label: "Your Link"        },
          { id: "rewards",     label: "Rewards"          },
          { id: "templates",   label: "Sharing Templates"},
          { id: "leaderboard", label: "Leaderboard"      },
        ].map(t => (
          <button
            key={t.id}
            className={`ref-tab${section === t.id ? " ref-tab--active" : ""}`}
            onClick={() => setSection(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="ref-content" key={section}>

        {/* Referral link */}
        {section === "link" && (
          <div className="ref-link-section">
            <div className="ref-link-card">
              <p className="ref-link-intro">
                Share your unique referral link. When someone signs up through it and starts a trial,
                you earn rewards automatically.
              </p>
              <div className="ref-link-display">
                <span className="ref-link-text">{referralLink}</span>
                <CopyButton text={referralLink} label="Copy link" />
              </div>
              <div className="ref-code-row">
                <span className="ref-code-label">Referral code</span>
                <span className="ref-code-value">{referralCode}</span>
                <CopyButton text={referralCode} label="Copy code" />
              </div>
            </div>
            <div className="ref-how-it-works">
              <p className="ref-sub-label">How it works</p>
              <div className="ref-steps">
                {[
                  { n: "1", t: "Share your link",         d: "Send your referral link to anyone who runs a business and struggles with manual follow-up." },
                  { n: "2", t: "They sign up",             d: "They start a free 7-day trial through your link. No credit card required from them." },
                  { n: "3", t: "They activate a plan",     d: "When they upgrade from trial to a paid plan, you earn your reward." },
                  { n: "4", t: "Rewards stack",            d: "Every successful referral adds to your count. The more you refer, the bigger the reward." },
                ].map(s => (
                  <div key={s.n} className="ref-step">
                    <span className="ref-step-num">{s.n}</span>
                    <div className="ref-step-body">
                      <span className="ref-step-title">{s.t}</span>
                      <span className="ref-step-desc">{s.d}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Rewards tiers */}
        {section === "rewards" && (
          <div className="ref-rewards-list">
            {REFERRAL_REWARDS.map(r => (
              <div key={r.milestone} className="ref-reward-card">
                <span className="ref-reward-icon" style={{ color: r.color }}>{r.icon}</span>
                <div className="ref-reward-body">
                  <div className="ref-reward-top">
                    <span className="ref-reward-milestone">{r.label}</span>
                    <span className="ref-reward-value" style={{ color: r.color }}>{r.reward}</span>
                  </div>
                  <span className="ref-reward-desc">{r.desc}</span>
                </div>
                <div className="ref-reward-progress">
                  <span className="ref-reward-pct">0/{r.milestone}</span>
                  <div className="ref-reward-track">
                    <div className="ref-reward-fill" style={{ width: "0%", background: r.color }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Sharing templates */}
        {section === "templates" && (
          <div className="ref-templates-list">
            <p className="ref-templates-note">
              Click "Copy" to copy the message with your referral link already embedded.
            </p>
            {SHARE_TEMPLATES.map(t => (
              <div key={t.id} className="ref-template-card">
                <div className="ref-template-header">
                  <span className="ref-template-icon" style={{ color: t.color }}>{t.icon}</span>
                  <span className="ref-template-channel">{t.channel}</span>
                  <button
                    className={`ref-template-copy${copiedTpl === t.id ? " ref-template-copy--done" : ""}`}
                    onClick={() => handleCopyTemplate(t.id, t.message)}
                  >
                    {copiedTpl === t.id ? "✓ Copied" : "Copy"}
                  </button>
                </div>
                <pre className="ref-template-body">{t.message.replace("{{referral_link}}", referralLink)}</pre>
              </div>
            ))}
          </div>
        )}

        {/* Leaderboard */}
        {section === "leaderboard" && (
          <div className="ref-leaderboard">
            <p className="ref-lb-note">
              Top referrers this month. Leaderboard updates daily.
            </p>
            <div className="ref-lb-list">
              {leaderboard.length === 0 && (
                <div style={{ fontSize: 12, color: "#666", padding: "16px 0" }}>
                  No referrals yet. Share your link to appear on the leaderboard.
                </div>
              )}
              {leaderboard.map((entry, i) => (
                <div key={entry.accountId} className="ref-lb-row">
                  <span className="ref-lb-rank">#{i + 1}</span>
                  <span className="ref-lb-badge">{i === 0 ? "★" : i === 1 ? "◉" : "◎"}</span>
                  <span className="ref-lb-name">{entry.accountId?.slice(0, 8)}…</span>
                  <span className="ref-lb-referrals">{entry.invites} referrals</span>
                  <span className="ref-lb-reward">{entry.totalEarned} credits earned</span>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
