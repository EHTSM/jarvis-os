import React, { useState, useEffect, useMemo } from "react";
import { track } from "../analytics";
import "./SuccessCenter.css";

// ── Persistence keys ────────────────────────────────────────────────────
const STORAGE_KEY = "ooplix_success_milestones";

function _loadMilestones() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); }
  catch { return {}; }
}

function _saveMilestone(key) {
  const m = _loadMilestones();
  if (!m[key]) {
    m[key] = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(m));
  }
}

// ── Milestone catalogue ─────────────────────────────────────────────────
// Each step: id, title, description, cta label, cta tab, how to detect completion
const MILESTONES = [
  {
    id:    "setup",
    icon:  "◎",
    title: "Complete setup",
    desc:  "Tell Ooplix about your business, product, and price. Takes 60 seconds.",
    ctaLabel: "Review setup",
    ctaTab:   null,
    detect:   (_, __)  => !!localStorage.getItem("jarvis_biz_profile"),
    reward:   "Ooplix now writes follow-ups in your voice.",
  },
  {
    id:    "contact",
    icon:  "◈",
    title: "Add your first contact",
    desc:  "Add a name and WhatsApp number. The first follow-up fires in 10 minutes — automatically.",
    ctaLabel: "Add contact",
    ctaTab:   "clients",
    detect:   (stats) => (stats?.total ?? 0) > 0,
    reward:   "Your first automated follow-up is now queued.",
  },
  {
    id:    "whatsapp",
    icon:  "◉",
    title: "Connect WhatsApp",
    desc:  "One-time QR scan. Every follow-up runs without you after this.",
    ctaLabel: "Connect WhatsApp",
    ctaTab:   "clients",
    detect:   (_, opsData) => !!(opsData?.services?.whatsapp),
    reward:   "Automations are live — messages will send on schedule.",
  },
  {
    id:    "automation",
    icon:  "⚡",
    title: "Run your first automation",
    desc:  "Ooplix sends a follow-up message automatically on your behalf.",
    ctaLabel: "View activity",
    ctaTab:   "activity",
    detect:   (_, opsData) => {
      const auto = opsData?.automation || {};
      return Object.values(auto).some(d => (d.sent || 0) > 0);
    },
    reward:   "First automation complete — the loop has started.",
  },
  {
    id:    "payment",
    icon:  "✦",
    title: "Collect your first payment",
    desc:  "Generate a Razorpay payment link and send it to a client.",
    ctaLabel: "Generate link",
    ctaTab:   "clients",
    detect:   (stats) => (stats?.paid ?? 0) > 0,
    reward:   "First payment collected. Revenue is tracking.",
  },
  {
    id:    "dispatch",
    icon:  "◇",
    title: "Run a task from Control Center",
    desc:  "Type a command in the Dispatch bar — run a workflow, check status, or ask a question.",
    ctaLabel: "Open Control Center",
    ctaTab:   "home",
    detect:   () => !!localStorage.getItem("ooplix_first_dispatch"),
    reward:   "The AI execution engine is active.",
  },
];

// ── Progress ring ────────────────────────────────────────────────────────
function ProgressRing({ pct, size = 60, stroke = 5 }) {
  const r    = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const fill = (pct / 100) * circ;
  const color = pct === 100 ? "var(--success)"
              : pct >= 50   ? "var(--accent2)"
              : "var(--accent)";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="sc-ring-svg">
      <circle cx={size/2} cy={size/2} r={r}
        fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={stroke} />
      <circle cx={size/2} cy={size/2} r={r}
        fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={`${fill} ${circ}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${size/2} ${size/2})`}
        style={{ transition: "stroke-dasharray 700ms var(--ease-out)" }}
      />
      <text
        x="50%" y="50%"
        dominantBaseline="middle" textAnchor="middle"
        fill={color}
        fontSize={size * 0.22}
        fontWeight="800"
        fontFamily="inherit"
      >{pct}%</text>
    </svg>
  );
}

// ── Single milestone row ─────────────────────────────────────────────────
function MilestoneRow({ m, done, reward, onNavigate, index }) {
  return (
    <div
      className={`sc-milestone${done ? " sc-milestone--done" : ""}`}
      style={{ animationDelay: `${index * 45}ms` }}
    >
      <div className="sc-ms-left">
        <div className={`sc-ms-icon${done ? " sc-ms-icon--done" : ""}`}>
          {done ? "✓" : m.icon}
        </div>
        <div className="sc-ms-spine" />
      </div>
      <div className="sc-ms-body">
        <div className="sc-ms-top">
          <span className="sc-ms-title">{m.title}</span>
          {done && reward && (
            <span className="sc-ms-reward">{reward}</span>
          )}
        </div>
        {!done && <p className="sc-ms-desc">{m.desc}</p>}
        {!done && m.ctaTab && (
          <button
            className="sc-ms-cta"
            onClick={() => { onNavigate?.(m.ctaTab); track.event("success_cta_clicked", { milestone: m.id }); }}
          >
            {m.ctaLabel} →
          </button>
        )}
      </div>
    </div>
  );
}

// ── Root ─────────────────────────────────────────────────────────────────
export default function SuccessCenter({ stats, opsData, billing, onNavigate, onUpgrade }) {
  const [milestones, setMilestones] = useState(_loadMilestones);

  // Re-evaluate completion on every render when live data changes
  useEffect(() => {
    let changed = false;
    const current = _loadMilestones();
    MILESTONES.forEach(m => {
      if (!current[m.id] && m.detect(stats, opsData)) {
        _saveMilestone(m.id);
        changed = true;
        track.event("milestone_completed", { milestone: m.id });
      }
    });
    if (changed) setMilestones(_loadMilestones());
  }, [stats, opsData]);

  const doneIds = Object.keys(milestones);
  const doneCount = MILESTONES.filter(m => doneIds.includes(m.id)).length;
  const pct = Math.round((doneCount / MILESTONES.length) * 100);
  const allDone = doneCount === MILESTONES.length;

  const daysLeft = billing?.daysLeft ?? null;
  const isTrial  = billing?.status === "trialing";

  return (
    <div className="success-center page-enter">

      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="sc-header">
        <div className="sc-header-left">
          <h1 className="sc-title">Getting Started</h1>
          <p className="sc-subtitle">
            {allDone
              ? "You've completed setup — Ooplix is running at full capacity."
              : `Complete these steps to get the most out of your ${isTrial ? "trial" : "plan"}.`}
          </p>
        </div>
        <div className="sc-header-right">
          <ProgressRing pct={pct} />
          <div className="sc-progress-meta">
            <span className="sc-progress-count">{doneCount} / {MILESTONES.length}</span>
            <span className="sc-progress-label">completed</span>
          </div>
        </div>
      </div>

      {/* ── Trial countdown ──────────────────────────────────────── */}
      {isTrial && daysLeft !== null && daysLeft <= 5 && (
        <div className={`sc-trial-bar sc-trial-bar--${daysLeft <= 1 ? "critical" : daysLeft <= 3 ? "warn" : "info"}`}>
          <span className="sc-trial-bar-text">
            {daysLeft === 0
              ? "Trial expires today."
              : `${daysLeft} day${daysLeft !== 1 ? "s" : ""} left on your trial.`}
            {" "}Complete setup to make the most of it.
          </span>
          <button className="sc-trial-bar-cta" onClick={() => { track.event("success_center_upgrade"); onUpgrade?.(); }}>
            Upgrade →
          </button>
        </div>
      )}

      {/* ── Milestone list ───────────────────────────────────────── */}
      <div className="sc-milestones">
        {MILESTONES.map((m, i) => (
          <MilestoneRow
            key={m.id}
            m={m}
            done={!!milestones[m.id]}
            reward={m.reward}
            onNavigate={onNavigate}
            index={i}
          />
        ))}
      </div>

      {/* ── Completion celebration ───────────────────────────────── */}
      {allDone && (
        <div className="sc-complete">
          <div className="sc-complete-icon">✦</div>
          <h2 className="sc-complete-title">Setup complete</h2>
          <p className="sc-complete-sub">
            Ooplix is running at full capacity. Every automation is active,
            your pipeline is live, and the AI execution engine is ready.
          </p>
          <div className="sc-complete-actions">
            <button className="sc-complete-cta" onClick={() => onNavigate?.("home")}>
              View Control Center →
            </button>
            <button className="sc-complete-secondary" onClick={() => onNavigate?.("activity")}>
              See live activity
            </button>
          </div>
        </div>
      )}

      {/* ── Quick links ──────────────────────────────────────────── */}
      <div className="sc-quick-links">
        <p className="sc-quick-label">Jump to</p>
        <div className="sc-quick-grid">
          {[
            { icon: "◎", label: "Control Center", tab: "home" },
            { icon: "◈", label: "Contacts",        tab: "clients" },
            { icon: "◉", label: "Pipeline",         tab: "insights" },
            { icon: "⚡", label: "Activity",         tab: "activity" },
            { icon: "◇", label: "Intelligence",     tab: "chat" },
            { icon: "✦", label: "Help & Guides",    tab: "help" },
          ].map(q => (
            <button
              key={q.tab}
              className="sc-quick-btn"
              onClick={() => onNavigate?.(q.tab)}
            >
              <span className="sc-quick-icon">{q.icon}</span>
              <span className="sc-quick-text">{q.label}</span>
            </button>
          ))}
        </div>
      </div>

    </div>
  );
}
