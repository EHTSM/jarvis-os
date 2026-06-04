import React, { useState } from "react";
import { track } from "../analytics";
import "./HelpHub.css";

// ── Quick-start guides ───────────────────────────────────────────────
const GUIDES = [
  {
    id:      "whatsapp-setup",
    icon:    "◉",
    title:   "Connect WhatsApp",
    time:    "5 min",
    steps: [
      { title: "Open the Contacts tab", desc: "Click 'Contacts' in the main navigation." },
      { title: "Click 'Connect WhatsApp'", desc: "A QR code appears — this links your WhatsApp Business number." },
      { title: "Scan with WhatsApp",   desc: "Open WhatsApp → Settings → Linked Devices → Link a Device. Scan the QR code." },
      { title: "Confirm connection",   desc: "The status indicator turns green. All follow-ups will now send automatically." },
    ],
    note: "WhatsApp Business API uses your existing number. No new number needed.",
  },
  {
    id:      "first-lead",
    icon:    "◈",
    title:   "Add your first lead",
    time:    "2 min",
    steps: [
      { title: "Go to Contacts",      desc: "Click the Contacts tab in the top navigation." },
      { title: "Click 'Add Contact'", desc: "Enter the person's name and WhatsApp number (include country code, e.g. +91)." },
      { title: "Save",               desc: "Ooplix immediately queues the first follow-up. Nothing else to do." },
      { title: "Watch the feed",     desc: "Check Activity → the first message appears within 10 minutes." },
    ],
    note: "The follow-up sequence runs fully automatically after this step.",
  },
  {
    id:      "payment-link",
    icon:    "✦",
    title:   "Collect a payment",
    time:    "3 min",
    steps: [
      { title: "Configure Razorpay (once)", desc: "Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to your server .env file. Restart Ooplix." },
      { title: "Open Contacts",            desc: "Find the client you want to charge." },
      { title: "Generate payment link",    desc: "Click the payment icon next to the contact. Enter the amount." },
      { title: "Send the link",            desc: "Copy and paste into WhatsApp, or let Ooplix send it automatically." },
    ],
    note: "Razorpay charges ~2% per transaction. No monthly fee for the payment service itself.",
  },
  {
    id:      "run-command",
    icon:    "◇",
    title:   "Run your first command",
    time:    "1 min",
    steps: [
      { title: "Open Control Center",  desc: "Click 'Control Center' (the default home tab)." },
      { title: "Find the Dispatch bar", desc: "The input field at the bottom of the page." },
      { title: "Type a command",       desc: "Try: \"Show my pipeline summary\" or \"Run pm2 list\"." },
      { title: "Press Run →",          desc: "The result appears immediately below the input." },
    ],
    note: "Quick-chips above the input give you one-click access to the most common commands.",
  },
  {
    id:      "automation-sequence",
    icon:    "⚡",
    title:   "Understand the follow-up sequence",
    time:    "4 min",
    steps: [
      { title: "Immediate greeting (10 min)",   desc: "Sent 10 minutes after you add a contact. Warm, personal introduction." },
      { title: "Same-day follow-up (6 hr)",     desc: "Checks in later the same day." },
      { title: "Next-day touchpoint (24 hr)",   desc: "Gentle reminder if no response yet." },
      { title: "3-day closing sequence (3 day)", desc: "Stronger close for contacts that haven't replied." },
      { title: "Upsell nudge",                   desc: "Triggered for contacts marked as paid — suggests a repeat purchase or upgrade." },
    ],
    note: "All messages are personalised using your business type, product, and price from setup.",
  },
  {
    id:      "cmd-palette",
    icon:    "⌕",
    title:   "Use the Command Palette",
    time:    "1 min",
    steps: [
      { title: "Press ⌘K (Mac) or Ctrl+K (Windows)", desc: "The command palette opens from anywhere in the app." },
      { title: "Type to search",  desc: "Navigate to any section, trigger an action, or ask Ooplix a question." },
      { title: "Use arrow keys",  desc: "↑↓ to move, Enter to select, Escape to close." },
    ],
    note: "The Command Palette is the fastest way to navigate — you never need to use the mouse.",
  },
];

// ── FAQ ──────────────────────────────────────────────────────────────
const FAQ = [
  {
    q: "Why isn't WhatsApp sending messages?",
    a: "Usually one of two things: (1) WhatsApp is not connected — go to Contacts → Connect WhatsApp and scan the QR code. (2) The QR code session expired — disconnect and reconnect. WhatsApp sessions expire after ~14 days of inactivity.",
  },
  {
    q: "My pipeline shows 0 leads even though I added contacts. Why?",
    a: "Pull-to-refresh or wait for the 8-second poll cycle. If it still shows 0, check the backend is online (status dot in the header). If the backend is offline, contact data may not have saved — try adding the contact again.",
  },
  {
    q: "How do I change the default payment amount?",
    a: "Go to Getting Started (More → Getting Started) and update your price in the setup profile. Alternatively, when you generate a link, you can override the amount per-contact in the link dialog.",
  },
  {
    q: "Can I customise the follow-up messages?",
    a: "Ooplix personalises messages using your business type, product, and price from setup. To change the tone or content, update your profile (More → Getting Started → setup step). Full custom message templates are available on the Growth plan.",
  },
  {
    q: "What happens to my data if I cancel?",
    a: "Your leads, contacts, and payment history are retained for 30 days after cancellation. You can export at any time from the Contacts tab. After 30 days, all data is permanently deleted.",
  },
  {
    q: "How do I stop a follow-up from being sent?",
    a: "Go to Contacts, find the lead, and mark them as 'Closed' or 'Paid'. Ooplix stops sending follow-ups to closed and paid contacts automatically.",
  },
  {
    q: "Is there a way to see what messages were sent?",
    a: "Yes — open the Activity tab (More → History). Every message sent, along with its tier and timestamp, is logged there in real time.",
  },
  {
    q: "Why am I seeing a 'Backend offline' message?",
    a: "The Ooplix backend server is not reachable. If you're running locally: check that the backend is running (`pm2 list`). If you're on the hosted version: this usually resolves within 30–60 seconds — a health check poll runs every 8 seconds.",
  },
];

// ── Troubleshooting ───────────────────────────────────────────────────
const TROUBLESHOOT = [
  {
    problem: "WhatsApp not connected",
    steps: [
      "Go to Contacts tab",
      "Click 'Connect WhatsApp'",
      "If already connected: click Disconnect, then reconnect",
      "Scan the new QR code within 60 seconds",
      "Status should turn green",
    ],
    severity: "warn",
  },
  {
    problem: "Backend offline / can't connect",
    steps: [
      "Check the red dot in the header — backend is offline",
      "If self-hosted: SSH in and run `pm2 list` to check the process",
      "Run `pm2 restart jarvis-backend` if the process is stopped",
      "If hosted on Ooplix: wait 60 seconds — it auto-restarts",
    ],
    severity: "error",
  },
  {
    problem: "Payments not working",
    steps: [
      "Check .env for RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET",
      "Ensure keys are from the correct mode (test vs live)",
      "Restart the backend after changing .env",
      "Try generating a payment link from the Contacts tab",
    ],
    severity: "warn",
  },
  {
    problem: "Messages sending to the wrong person",
    steps: [
      "Check the phone number format — must include country code (+91 for India)",
      "Remove spaces, dashes, and brackets from the number",
      "Go to Contacts and edit the contact's number",
    ],
    severity: "warn",
  },
];

// ── Video placeholder ─────────────────────────────────────────────────
function VideoCard({ title, duration, desc }) {
  return (
    <div className="hh-video-card">
      <div className="hh-video-thumb" aria-label={`Video: ${title}`}>
        <div className="hh-video-play">▶</div>
        <div className="hh-video-duration">{duration}</div>
      </div>
      <div className="hh-video-meta">
        <p className="hh-video-title">{title}</p>
        <p className="hh-video-desc">{desc}</p>
      </div>
    </div>
  );
}

// ── Guide card ────────────────────────────────────────────────────────
function GuideCard({ guide, onOpen, open }) {
  return (
    <div className={`hh-guide-card${open ? " hh-guide-card--open" : ""}`}>
      <button
        className="hh-guide-header"
        onClick={() => onOpen(open ? null : guide.id)}
        aria-expanded={open}
      >
        <span className="hh-guide-icon">{guide.icon}</span>
        <span className="hh-guide-title">{guide.title}</span>
        <span className="hh-guide-time">{guide.time}</span>
        <span className="hh-guide-chevron" aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="hh-guide-body animate-fade-up">
          <ol className="hh-guide-steps">
            {guide.steps.map((s, i) => (
              <li key={i} className="hh-guide-step">
                <span className="hh-guide-step-num">{i + 1}</span>
                <div className="hh-guide-step-body">
                  <span className="hh-guide-step-title">{s.title}</span>
                  <span className="hh-guide-step-desc">{s.desc}</span>
                </div>
              </li>
            ))}
          </ol>
          {guide.note && <p className="hh-guide-note">💡 {guide.note}</p>}
        </div>
      )}
    </div>
  );
}

// ── FAQ item ──────────────────────────────────────────────────────────
function FaqItem({ item, open, onToggle }) {
  return (
    <div className={`hh-faq-item${open ? " hh-faq-item--open" : ""}`}>
      <button
        className="hh-faq-q"
        onClick={onToggle}
        aria-expanded={open}
      >
        {item.q}
        <span className="hh-faq-chevron" aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      {open && <p className="hh-faq-a animate-fade-up">{item.a}</p>}
    </div>
  );
}

// ── Troubleshoot row ──────────────────────────────────────────────────
function TroubleshootRow({ item, open, onToggle }) {
  return (
    <div className={`hh-ts-row${open ? " hh-ts-row--open" : ""}`}>
      <button
        className={`hh-ts-problem hh-ts-problem--${item.severity}`}
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className="hh-ts-icon">{item.severity === "error" ? "✗" : "⚠"}</span>
        {item.problem}
        <span className="hh-ts-chevron" aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <ol className="hh-ts-steps animate-fade-up">
          {item.steps.map((s, i) => (
            <li key={i} className="hh-ts-step">{s}</li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────
export default function HelpHub({ onNavigate }) {
  const [tab,         setTab]         = useState("guides");
  const [openGuide,   setOpenGuide]   = useState(null);
  const [openFaq,     setOpenFaq]     = useState(null);
  const [openTs,      setOpenTs]      = useState(null);

  const handleTabChange = (t) => {
    setTab(t);
    track.event("help_tab_changed", { tab: t });
  };

  const VIDEOS = [
    { title: "Getting started in 5 minutes", duration: "5:12", desc: "Complete walkthrough from setup to first automation." },
    { title: "WhatsApp automation deep dive", duration: "8:30", desc: "Every follow-up tier explained with live examples." },
    { title: "Control Center & AI commands",  duration: "4:45", desc: "Run commands, dispatch tasks, read reports." },
    { title: "Pipeline & revenue tracking",   duration: "6:20", desc: "Hot leads, conversion tracking, payment collection." },
  ];

  return (
    <div className="help-hub page-enter">

      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="hh-header">
        <div className="hh-header-copy">
          <h1 className="hh-title">Help & Guides</h1>
          <p className="hh-subtitle">Everything you need to get the most out of Ooplix.</p>
        </div>
        <a
          href="mailto:support@ooplix.com"
          className="hh-contact-btn"
          onClick={() => track.event("help_contact_support")}
        >
          Contact support →
        </a>
      </div>

      {/* ── Tab nav ─────────────────────────────────────────────── */}
      <div className="hh-tabs" role="tablist">
        {[
          { id: "guides",         label: "Quick-Start Guides" },
          { id: "videos",         label: "Videos" },
          { id: "faq",            label: "FAQ" },
          { id: "troubleshoot",   label: "Troubleshooting" },
        ].map(t => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`hh-tab${tab === t.id ? " hh-tab--active" : ""}`}
            onClick={() => handleTabChange(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Content ─────────────────────────────────────────────── */}
      <div className="hh-content" key={tab}>

        {/* Quick-start guides */}
        {tab === "guides" && (
          <div className="hh-guides">
            {GUIDES.map(g => (
              <GuideCard
                key={g.id}
                guide={g}
                open={openGuide === g.id}
                onOpen={id => { setOpenGuide(id); if (id) track.event("help_guide_opened", { guide: id }); }}
              />
            ))}
          </div>
        )}

        {/* Videos */}
        {tab === "videos" && (
          <div className="hh-videos-section">
            <p className="hh-videos-coming">
              Video walkthroughs are coming soon. In the meantime, use the Quick-Start Guides above.
            </p>
            <div className="hh-videos-grid">
              {VIDEOS.map(v => (
                <VideoCard key={v.title} {...v} />
              ))}
            </div>
          </div>
        )}

        {/* FAQ */}
        {tab === "faq" && (
          <div className="hh-faq">
            {FAQ.map((item, i) => (
              <FaqItem
                key={i}
                item={item}
                open={openFaq === i}
                onToggle={() => {
                  const next = openFaq === i ? null : i;
                  setOpenFaq(next);
                  if (next !== null) track.event("help_faq_opened", { index: i });
                }}
              />
            ))}
          </div>
        )}

        {/* Troubleshooting */}
        {tab === "troubleshoot" && (
          <div className="hh-troubleshoot">
            <p className="hh-ts-intro">
              Select a problem below for a step-by-step fix. If none of these apply,{" "}
              <a href="mailto:support@ooplix.com" className="hh-ts-link">
                contact support
              </a>.
            </p>
            {TROUBLESHOOT.map((item, i) => (
              <TroubleshootRow
                key={i}
                item={item}
                open={openTs === i}
                onToggle={() => {
                  const next = openTs === i ? null : i;
                  setOpenTs(next);
                  if (next !== null) track.event("help_troubleshoot_opened", { problem: item.problem });
                }}
              />
            ))}
          </div>
        )}

      </div>

      {/* ── Footer links ─────────────────────────────────────────── */}
      <div className="hh-footer">
        <button className="hh-footer-link" onClick={() => onNavigate?.("success")}>
          Getting Started checklist
        </button>
        <span className="hh-footer-sep">·</span>
        <a href="mailto:support@ooplix.com" className="hh-footer-link">
          support@ooplix.com
        </a>
        <span className="hh-footer-sep">·</span>
        <button className="hh-footer-link" onClick={() => onNavigate?.("billing")}>
          Billing & plans
        </button>
      </div>

    </div>
  );
}
