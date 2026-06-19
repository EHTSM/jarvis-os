/**
 * MissionTemplates — quick-launch mission templates shown above CommandCenter dispatch.
 * One-click fires a pre-written goal into the mission engine (existing /missions route).
 */
import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import "./MissionTemplates.css";

const BASE = process.env.REACT_APP_API_URL || "";

const TEMPLATES = [
  { id: "audit",    icon: "◇", label: "Code Audit",         goal: "Audit the repository for code smells, dead code, and architectural risks. Generate a prioritized report.",           color: "#eab308" },
  { id: "tests",    icon: "⬡", label: "Write Tests",        goal: "Analyze all modules with <50% test coverage. Generate comprehensive unit and integration tests.",                      color: "#3b82f6" },
  { id: "refactor", icon: "◈", label: "Refactor",           goal: "Identify the top 3 most complex modules and refactor them for clarity and maintainability.",                           color: "#a855f7" },
  { id: "docs",     icon: "◉", label: "Generate Docs",      goal: "Read all public APIs and generate OpenAPI spec + inline JSDoc comments for every exported function.",                  color: "#22c55e" },
  { id: "security", icon: "✦", label: "Security Scan",      goal: "Scan all routes, inputs, and dependencies for OWASP Top 10 vulnerabilities. Generate a risk report.",                 color: "#ef4444" },
  { id: "perf",     icon: "⚡", label: "Performance",        goal: "Profile the most critical code paths for performance bottlenecks and generate an optimization plan.",                  color: "#f97316" },
];

async function launchMission(goal) {
  const r = await fetch(`${BASE}/missions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ title: goal.slice(0, 60), goal, priority: "high", source: "template" }),
  });
  if (!r.ok) throw new Error("Failed to create mission");
  return r.json();
}

export default function MissionTemplates({ onNavigate }) {
  const [launching, setLaunching] = useState(null);
  const [launched,  setLaunched]  = useState(null);
  const [error,     setError]     = useState(null);

  const handleLaunch = async (tpl) => {
    if (launching) return;
    setLaunching(tpl.id);
    setError(null);
    try {
      await launchMission(tpl.goal);
      setLaunched(tpl.id);
      setTimeout(() => {
        setLaunched(null);
        onNavigate?.("jarvisbrain");
      }, 1200);
    } catch (e) {
      setError(tpl.id);
      setTimeout(() => setError(null), 3000);
    } finally {
      setLaunching(null);
    }
  };

  return (
    <div className="mt-root">
      <div className="mt-header">
        <span className="section-label">Mission Templates</span>
        <button className="cmd-panel-link" onClick={() => onNavigate?.("jarvisbrain")}>
          All missions →
        </button>
      </div>
      <div className="mt-grid">
        {TEMPLATES.map(tpl => {
          const isLoading = launching === tpl.id;
          const isDone    = launched  === tpl.id;
          const isError   = error     === tpl.id;
          return (
            <motion.button
              key={tpl.id}
              className={`mt-card${isLoading ? " mt-card--loading" : ""}${isDone ? " mt-card--done" : ""}${isError ? " mt-card--error" : ""}`}
              onClick={() => handleLaunch(tpl)}
              disabled={!!launching}
              whileHover={{ y: -2, transition: { duration: 0.12 } }}
              whileTap={{ scale: 0.97 }}
            >
              <span className="mt-icon" style={{ color: isError ? "#ef4444" : isDone ? "#22c55e" : tpl.color }}>
                {isDone ? "✓" : isError ? "✕" : tpl.icon}
              </span>
              <span className="mt-label">{tpl.label}</span>
              {isLoading && <span className="mt-spinner" />}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
