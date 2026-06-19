/**
 * WorkspaceTemplates — shown when no project is open in ElectronWorkspace.
 * One-click to clone/scaffold a template repo into a temp folder and open it.
 */
import React, { useState } from "react";
import { motion } from "framer-motion";
import "./WorkspaceTemplates.css";

const TEMPLATES = [
  {
    id: "react",    label: "React App",        icon: "⚛",  color: "#61dafb",
    desc: "Vite + React 18 + TypeScript",
    cmd: "npx create-vite@latest . --template react-ts",
  },
  {
    id: "next",     label: "Next.js",          icon: "▲",  color: "#fff",
    desc: "Next.js 14 App Router + TypeScript",
    cmd: "npx create-next-app@latest . --typescript --tailwind --app",
  },
  {
    id: "node",     label: "Node API",         icon: "⬡",  color: "#68a063",
    desc: "Express 5 + TypeScript + Jest",
    cmd: "npx express-generator-typescript .",
  },
  {
    id: "electron", label: "Electron App",     icon: "⚡",  color: "#9feaf9",
    desc: "Electron + Vite + React",
    cmd: "npx create-electron-vite@latest .",
  },
  {
    id: "flutter",  label: "Flutter",          icon: "◈",  color: "#54c5f8",
    desc: "Flutter 3 cross-platform app",
    cmd: "flutter create .",
  },
  {
    id: "express",  label: "Express REST",     icon: "◉",  color: "#4db33d",
    desc: "Express 5 REST API + Prisma",
    cmd: "npx create-express-api .",
  },
];

export default function WorkspaceTemplates({ onOpenFolder, onDismiss }) {
  const [launching, setLaunching] = useState(null);
  const [done,      setDone]      = useState(null);

  const handleTemplate = async (tpl) => {
    if (!window.electronAPI?.fsShowOpenDialog) return;
    const result = await window.electronAPI.fsShowOpenDialog({ properties: ["openDirectory", "createDirectory"] });
    const folder = result?.filePaths?.[0];
    if (!folder) return;

    setLaunching(tpl.id);
    // Scaffold via shell-exec (uses existing SafeExec on the backend)
    try {
      await window.electronAPI.shellExec?.({ command: tpl.cmd, cwd: folder });
    } catch {}

    setDone(tpl.id);
    setLaunching(null);
    setTimeout(() => {
      onOpenFolder?.(folder);
      onDismiss?.();
    }, 800);
  };

  return (
    <div className="wt-root">
      <div className="wt-header">
        <span className="wt-header-icon">◎</span>
        <div>
          <h2 className="wt-title">Start a new project</h2>
          <p className="wt-sub">Choose a template or open an existing folder</p>
        </div>
      </div>

      <div className="wt-grid">
        {TEMPLATES.map((tpl, i) => (
          <motion.button
            key={tpl.id}
            className={`wt-card${launching === tpl.id ? " wt-card--loading" : ""}${done === tpl.id ? " wt-card--done" : ""}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04, duration: 0.18 }}
            onClick={() => handleTemplate(tpl)}
            disabled={!!launching}
          >
            <span className="wt-card-icon" style={{ color: tpl.color }}>{tpl.icon}</span>
            <span className="wt-card-label">{tpl.label}</span>
            <span className="wt-card-desc">{tpl.desc}</span>
            {launching === tpl.id && <span className="wt-card-spinner" />}
            {done === tpl.id && <span className="wt-card-check">✓</span>}
          </motion.button>
        ))}
      </div>

      <div className="wt-footer">
        <button className="wt-open-btn" onClick={async () => {
          const result = await window.electronAPI?.fsShowOpenDialog({ properties: ["openDirectory"] });
          const p = result?.filePaths?.[0];
          if (p) { onOpenFolder?.(p); onDismiss?.(); }
        }}>
          Open existing folder →
        </button>
        {onDismiss && (
          <button className="wt-skip-btn" onClick={onDismiss}>
            Skip
          </button>
        )}
      </div>
    </div>
  );
}
