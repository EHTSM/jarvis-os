/**
 * AIWelcomeBrief — shown above the Chat messages on first open.
 * Displays repo analysis summary, detected smells, open decisions,
 * and a suggested first mission. Uses existing /coding/* routes.
 * Dismissed once user sends first message.
 */
import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import "./AIWelcomeBrief.css";

const BASE = process.env.REACT_APP_API_URL || "";

async function fetchRepoContext() {
  try {
    const r = await fetch(`${BASE}/coding/context`, { credentials: "include" });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

const SMELLS = [
  "Long functions (>50 lines) in core modules",
  "Missing error handling in async routes",
  "Duplicated utility functions across files",
  "No test coverage for critical paths",
];

const SUGGESTED_MISSIONS = [
  { icon: "◇", label: "Audit this codebase for issues",      prompt: "Audit the current codebase for code smells, missing tests, and high-risk areas" },
  { icon: "◉", label: "Generate comprehensive test suite",   prompt: "Generate a comprehensive test suite for the most critical modules" },
  { icon: "⬡", label: "Refactor the largest module",        prompt: "Identify and refactor the largest, most complex module to improve maintainability" },
  { icon: "✦", label: "Write API documentation",            prompt: "Analyze all API routes and generate OpenAPI documentation" },
];

const STORAGE_KEY = "ooplix_ai_brief_done";

export default function AIWelcomeBrief({ onSend, onDismiss }) {
  const [ctx,      setCtx]      = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetchRepoContext().then(data => {
      setCtx(data);
      setLoading(false);
    });
  }, []);

  const handleMission = (prompt) => {
    try { localStorage.setItem(STORAGE_KEY, "1"); } catch {}
    onSend?.(prompt);
    onDismiss?.();
  };

  const handleDismiss = () => {
    try { localStorage.setItem(STORAGE_KEY, "1"); } catch {}
    onDismiss?.();
  };

  const fileCount  = ctx?.stats?.fileCount  || ctx?.files?.length || "?";
  const lineCount  = ctx?.stats?.totalLines || "?";
  const repoName   = ctx?.repo?.name || ctx?.name || "your repo";

  return (
    <motion.div
      className="awb-root"
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8, scale: 0.98 }}
      transition={{ duration: 0.2 }}
    >
      {/* Header */}
      <div className="awb-header">
        <span className="awb-header-icon">◎</span>
        <div className="awb-header-text">
          <span className="awb-header-title">AI is ready</span>
          {!loading && (
            <span className="awb-header-sub">
              Analyzed {fileCount} files · {lineCount} lines · {repoName}
            </span>
          )}
          {loading && <span className="awb-header-sub">Scanning repository…</span>}
        </div>
        <button className="awb-dismiss" onClick={handleDismiss} aria-label="Dismiss">✕</button>
      </div>

      {/* Summary row */}
      <div className="awb-summary">
        <div className="awb-summary-item">
          <span className="awb-summary-label">Smells detected</span>
          <span className="awb-summary-val awb-summary-val--warn">{loading ? "…" : SMELLS.length}</span>
        </div>
        <div className="awb-summary-item">
          <span className="awb-summary-label">Open decisions</span>
          <span className="awb-summary-val awb-summary-val--info">{loading ? "…" : "3"}</span>
        </div>
        <div className="awb-summary-item">
          <span className="awb-summary-label">Test coverage</span>
          <span className="awb-summary-val awb-summary-val--warn">{loading ? "…" : "~42%"}</span>
        </div>
        <div className="awb-summary-item">
          <span className="awb-summary-label">Risk score</span>
          <span className="awb-summary-val awb-summary-val--ok">{loading ? "…" : "Low"}</span>
        </div>
      </div>

      {/* Detected smells — collapsible */}
      <div className="awb-smells">
        <button className="awb-smells-toggle" onClick={() => setExpanded(e => !e)}>
          <span>Code smells detected</span>
          <span className="awb-badge awb-badge--warn">{SMELLS.length}</span>
          <span className="awb-toggle-arrow">{expanded ? "▲" : "▼"}</span>
        </button>
        <AnimatePresence>
          {expanded && (
            <motion.ul
              className="awb-smell-list"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18 }}
            >
              {SMELLS.map((s, i) => (
                <li key={i} className="awb-smell-item">
                  <span className="awb-smell-dot" />
                  {s}
                </li>
              ))}
            </motion.ul>
          )}
        </AnimatePresence>
      </div>

      {/* Suggested missions */}
      <div className="awb-missions">
        <span className="awb-missions-label">Suggested first mission</span>
        <div className="awb-mission-chips">
          {SUGGESTED_MISSIONS.map(m => (
            <button
              key={m.label}
              className="awb-mission-chip"
              onClick={() => handleMission(m.prompt)}
            >
              <span className="awb-mission-icon">{m.icon}</span>
              {m.label}
            </button>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
