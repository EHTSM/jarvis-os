import React, { useState } from "react";

const RELEASE_NOTES = {
  version: "v3.0",
  date: "2026-05",
  highlights: [
    "Keyboard-first operator flow — Ctrl+D, Ctrl+L, Ctrl+H, Ctrl+M, Ctrl+R, Ctrl+1–9, ⌘K",
    "Command palette with fuzzy search across macros, history, and quick actions",
    "Workflow template packs — Beginner, Developer, Automation, Browser, Productivity",
    "Inline macro rename, clone-all snapshot, batch-clear with confirmation gate",
    "Dry-run mode — preview any command before executing",
    "Execution completion feedback — 5s/10s auto-dismiss with duration and status",
    "Readiness badge — live READY / EXECUTING / DRY RUN / CONFIRM REQ. state in header",
    "Contextual hints — tip/warn/info based on current panel state",
    "Rollback confidence badge — safe/caution/risky from last backup age",
    "Recovery wizard — step-by-step guided troubleshooting for reconnect issues",
    "Reconnect UX — calmer language, 3s 'Reconnected!' flash, guided steps at attempt 5+",
    "Long-session comfort — animation suspension after 30min, idle focus mode",
    "Low-memory warning — Electron IPC signal triggers amber dismissable banner",
    "Startup corruption recovery — detects and prunes broken localStorage entries",
    "Real-user friction instrumentation — hesitation, abandonment, reconnect confusion tracked",
    "Productivity analytics — per-session dispatch count, success rate, peak latency",
    "Local diagnostics bundle — works fully offline, includes all friction and telemetry",
    "Windowed execution log — 60-row DOM cap with load-more sentinel",
    "Saved filters and bookmarks — persistent across sessions",
    "16-gate beta-candidate readiness check in RuntimeHealthCard",
    "Help panel — inline documentation, no external links",
  ],
  knownLimitations: [
    "Template pack macros are stubs — some commands (e.g. scrape-page-data) require plugin setup",
    "Workflow share links (jarvis://) require both parties to be on the same build",
    "Browser automation macros require Playwright or Puppeteer installed separately",
    "pm2 commands require pm2 to be globally installed: npm install -g pm2",
    "Electron low-memory signal only fires on supported desktop builds",
  ],
  rollbackInstructions: [
    "Your macros and history are stored in localStorage — they survive reinstalls",
    "To export before rolling back: Workflow panel → 📤 Export → save the .json file",
    "To restore after rollback: Workflow panel → 📥 Import → select your saved .json file",
    "Diagnostics bundle: Feedback → 📦 Diagnostics — download before reporting issues",
  ],
};

const GUIDES = [
  {
    id: "quickstart",
    title: "Quick Start",
    icon: "🚀",
    sections: [
      {
        heading: "First steps",
        content: [
          "Type a command or task in the Workflow panel and press Ctrl+D (or the ⚡ Dispatch button).",
          "Use ⌘K to open the command palette and search for saved macros or recent commands.",
          "Install a template pack from the Workflow panel → ▼ Install Template Pack to get pre-built shortcuts.",
          "Press Ctrl+H to view your dispatch history. Use ↑/↓ arrows in the input to cycle through it.",
        ],
      },
      {
        heading: "Keyboard shortcuts",
        content: [
          "Ctrl+D — Dispatch the current command",
          "Ctrl+L — Clear the input (counts as abandonment for analytics)",
          "Ctrl+H — Toggle dispatch history",
          "Ctrl+M — Toggle macro editor",
          "Ctrl+R — Reload last dispatched command",
          "Ctrl+1–9 — Quick-load macro by index",
          "⌘K — Open command palette",
          "Ctrl+F — Toggle focus mode (dims sidebars)",
        ],
      },
    ],
  },
  {
    id: "recovery",
    title: "Recovery Guide",
    icon: "🛡️",
    sections: [
      {
        heading: "Stream disconnected (yellow banner)",
        content: [
          "The yellow reconnecting banner means Jarvis lost its live connection. This is normal after sleep/wake or network changes.",
          "Wait up to 60 seconds — Jarvis reconnects automatically with exponential backoff.",
          "If the banner persists, check the Stream Status card on the right — it shows retry count and next attempt time.",
          "After 5 failed attempts, guided recovery steps appear: check pm2 list, then pm2 restart jarvis-backend.",
        ],
      },
      {
        heading: "Execution failed",
        content: [
          "Failed commands show a plain-English error in the result strip (e.g., 'Can't reach the backend. Check that the server is running').",
          "If you see 'Permission denied' — the command needs elevated access. Check your environment setup.",
          "Timeout errors: the command ran longer than the timeout setting. Increase timeout in the input controls.",
          "Use Dry Run mode (🔬) to preview what a command would do before committing.",
        ],
      },
      {
        heading: "Dangerous command blocked",
        content: [
          "Commands containing rm -rf, drop table, shutdown, etc. require explicit confirmation before executing.",
          "After confirming a dangerous command, a 5-second cooldown prevents accidental re-dispatch.",
          "The risk badge (SAFE / OPERATIONAL / ELEVATED / DANGEROUS) appears above the input for every command.",
        ],
      },
    ],
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting",
    icon: "🔧",
    sections: [
      {
        heading: "Backend unreachable",
        content: [
          "Error: 'Can't reach the backend' — run: npm run server",
          "Check backend status: pm2 list",
          "View recent logs: pm2 logs jarvis-backend --lines 30",
          "Restart backend: pm2 restart jarvis-backend",
          "If pm2 is not installed: npm install -g pm2",
        ],
      },
      {
        heading: "App not loading",
        content: [
          "Hard-refresh: Ctrl+Shift+R (or Cmd+Shift+R on Mac)",
          "If localStorage is corrupted — open DevTools → Application → Storage → Clear site data",
          "Reinstalling does not delete saved macros (they persist in localStorage unless manually cleared).",
          "If the screen is blank, check DevTools Console for red errors and export diagnostics.",
        ],
      },
      {
        heading: "Commands not executing",
        content: [
          "Check that you are not in Dry Run mode (🔬 button shows amber when active).",
          "Verify the task queue is not full: see Queue card on the right sidebar.",
          "If the runtime is in DEGRADED mode, heavy execution is suppressed. Wait for memory to drop below 400MB.",
          "Look at the Execution Log panel for previous results — filter by 'Failed' to isolate issues.",
        ],
      },
    ],
  },
  {
    id: "diagnostics",
    title: "Diagnostics Export",
    icon: "📦",
    sections: [
      {
        heading: "How to export a diagnostics bundle",
        content: [
          "Click the Feedback button (top toolbar) → then 📦 Diagnostics.",
          "The bundle downloads as a .json file. It works even when the backend is offline.",
          "The bundle includes: session analytics, friction signals, connection history, localStorage state, and telemetry.",
          "No personal data is included — only runtime metrics, command timing, and error counts.",
        ],
      },
      {
        heading: "What the bundle contains",
        content: [
          "productivity: dispatch counts, success rate, average latency, peak latency, abandonments",
          "friction: hesitation count, reconnect confusions, onboarding drop-offs",
          "confusionPatterns: detected real-user confusion signals (rapid friction, reconnect panic, onboarding bounce)",
          "telemetry: last 20 SSE events with timestamps",
          "localStorage: all jarvis_* keys (macros, history, analytics, filters, bookmarks)",
        ],
      },
      {
        heading: "Sending a support report",
        content: [
          "1. Export diagnostics bundle using the Feedback → 📦 Diagnostics button",
          "2. Choose 'Recovery issue' or 'Crash' category and describe what happened",
          "3. Attach the downloaded .json file to your support message",
          "4. Include the pm2 logs output if the backend crashed: pm2 logs --lines 50",
        ],
      },
    ],
  },
  {
    id: "workflows",
    title: "Workflow Guide",
    icon: "⚡",
    sections: [
      {
        heading: "Saving macros",
        content: [
          "Type a command → click 💾 SAVE MACRO → give it a name → it appears in the macro list.",
          "Macros persist across sessions in localStorage. Export them weekly using 📤 Export.",
          "Use the ✎ rename button on any macro to rename it inline. Press Enter to commit, Escape to cancel.",
          "Ctrl+1–9 quick-loads the first 9 macros by index — no mouse required.",
        ],
      },
      {
        heading: "Template packs",
        content: [
          "Click ▼ Install Template Pack in the Workflow panel to browse 5 built-in starter packs.",
          "Packs: Beginner Starter · Developer Pack · Automation Pack · Browser Automation · Productivity Pack",
          "Installing a pack merges its macros into your existing list — no duplicates are created.",
          "You can share macros with teammates: click 🔗 Share to copy a jarvis://macros/ link to clipboard.",
        ],
      },
      {
        heading: "Sequential workflows",
        content: [
          "Select multiple macros using the checkboxes, then click ⛓ Run Workflow to execute them in sequence.",
          "The workflow progress badge (WORKFLOW N/M) appears in the panel header while running.",
          "Use the Cancel button to abort mid-workflow. The current step completes before stopping.",
          "Failed steps stop the workflow immediately — check the Execution Log for the failure reason.",
        ],
      },
    ],
  },
  {
    id: "shortcuts",
    title: "Shortcuts",
    icon: "⌨",
    sections: [
      {
        heading: "Workflow panel",
        content: [
          "Ctrl+D — Dispatch the current command immediately",
          "Ctrl+L — Clear the input (recorded as abandonment for analytics)",
          "Ctrl+H — Toggle dispatch history panel",
          "Ctrl+M — Toggle macro editor",
          "Ctrl+R — Reload last dispatched command into input",
          "Ctrl+1 through Ctrl+9 — Quick-load macro by index (1 = first macro in list)",
          "↑ / ↓ — Cycle through dispatch history while input is focused",
        ],
      },
      {
        heading: "Global",
        content: [
          "⌘K (or Ctrl+K) — Open command palette (search macros, history, actions)",
          "Ctrl+F — Toggle focus mode (dims non-critical side panels)",
          "Escape — Close command palette, preferences, feedback, or help panel",
        ],
      },
      {
        heading: "Execution log",
        content: [
          "Enter on Load More — Load 60 more log entries (keyboard accessible)",
          "Tab — Navigate between filter chips and action buttons",
        ],
      },
      {
        heading: "Command palette",
        content: [
          "↑ / ↓ — Navigate palette items",
          "Enter — Execute selected item",
          "Escape — Close palette without selecting",
          "Type to filter — Fuzzy search across macros, history, and quick actions",
        ],
      },
    ],
  },
];

const RELNOTES_SECTIONS = [
  { title: "What's new",          items: RELEASE_NOTES.highlights,           colorCls: "green" },
  { title: "Known limitations",   items: RELEASE_NOTES.knownLimitations,     colorCls: "amber" },
  { title: "Rollback & recovery", items: RELEASE_NOTES.rollbackInstructions, colorCls: "accent" },
];

function ReleaseNotesTab() {
  return (
    <div className="op-help-relnotes">
      <div className="op-help-relnotes-header">
        <span className="op-help-relnotes-title">📋 Release Notes</span>
        <span className="op-help-relnotes-ver">{RELEASE_NOTES.version}</span>
        <span className="op-help-relnotes-date">{RELEASE_NOTES.date}</span>
      </div>
      {RELNOTES_SECTIONS.map((section, si) => (
        <div key={si} className="op-help-relnotes-section">
          <div className={`op-help-relnotes-label`} style={{ color: `var(--op-${section.colorCls})` }}>
            {section.title}
          </div>
          {section.items.map((item, ii) => (
            <div key={ii} className="op-help-relnotes-item">{item}</div>
          ))}
        </div>
      ))}
    </div>
  );
}

export const HelpPanel = React.memo(({ onClose }) => {
  const [activeGuide, setActiveGuide] = useState("quickstart");
  const guide = GUIDES.find(g => g.id === activeGuide) || GUIDES[0];

  return (
    <div className="op-help-backdrop" onClick={onClose}>
      <div className="op-help-card" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="op-help-header">
          <div className="op-help-title-row">
            <span className="op-help-title">Jarvis Help</span>
            <span className="op-help-version">v3.0</span>
          </div>
          <button className="op-help-close" onClick={onClose} aria-label="Close help">×</button>
        </div>

        <div className="op-help-body">
          {/* Guide nav */}
          <nav className="op-help-nav" aria-label="Help sections">
            {GUIDES.map(g => (
              <button
                key={g.id}
                className={`op-help-nav-btn${activeGuide === g.id ? " active" : ""}`}
                onClick={() => setActiveGuide(g.id)}
              >
                <span>{g.icon}</span>
                <span>{g.title}</span>
              </button>
            ))}
            <button
              className={`op-help-nav-btn release${activeGuide === "release" ? " active-release" : ""}`}
              onClick={() => setActiveGuide("release")}
            >
              <span>📋</span>
              <span>Release Notes</span>
            </button>
          </nav>

          {/* Content */}
          {activeGuide === "release" ? <ReleaseNotesTab /> : (
            <div className="op-help-content">
              <div className="op-help-guide-title">{guide.icon} {guide.title}</div>
              {guide.sections.map((section, si) => (
                <div key={si} className="op-help-section">
                  <div className="op-help-section-heading">{section.heading}</div>
                  {section.content.map((line, li) => (
                    <div key={li} className="op-help-line">{line}</div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
});
