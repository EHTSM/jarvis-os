/**
 * WelcomeFlow — first-launch experience for new Ooplix Desktop users.
 * Shown once on first app open. Presents project picker + progress tracker.
 * Dismissed permanently via localStorage flag.
 */
import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import "./WelcomeFlow.css";

const STEPS = [
  { id: "welcome",  label: "Welcome",         icon: "◎" },
  { id: "project",  label: "Open Project",    icon: "◈" },
  { id: "mission",  label: "First Mission",   icon: "✦" },
];

const QUICK_MISSIONS = [
  { id: "audit",   label: "Audit codebase",           icon: "◇", desc: "Scan for issues, dead code, and improvement areas" },
  { id: "readme",  label: "Generate README",           icon: "◉", desc: "Auto-write docs from your code structure" },
  { id: "test",    label: "Write tests",               icon: "⬡", desc: "Generate test coverage for existing modules" },
  { id: "refactor",label: "Refactor a module",         icon: "◈", desc: "Clean up and modernize a selected file" },
  { id: "deploy",  label: "Plan a deployment",         icon: "⚡", desc: "Build deployment checklist and risk analysis" },
  { id: "custom",  label: "Define my own goal",        icon: "◎", desc: "Start from scratch with any engineering objective" },
];

const STORAGE_KEY = "ooplix_welcome_done";

export function useWelcomeFlow() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Only on Desktop and only if not already completed
    const isDone = localStorage.getItem(STORAGE_KEY) === "1";
    const isDesktop = new URLSearchParams(window.location.search).get("desktop") === "1";
    if (isDesktop && !isDone) {
      // Small delay — let the app paint first
      const t = setTimeout(() => setShow(true), 600);
      return () => clearTimeout(t);
    }
  }, []);

  const dismiss = (completed = false) => {
    if (completed) {
      try { localStorage.setItem(STORAGE_KEY, "1"); } catch {}
    }
    setShow(false);
  };

  return { show, dismiss };
}

export default function WelcomeFlow({ onDismiss, onOpenFolder, onDispatchMission }) {
  const [step,      setStep]      = useState(0);
  const [missionId, setMissionId] = useState(null);
  const [folderSet, setFolderSet] = useState(false);

  const current = STEPS[step];

  const handleFolderPick = async () => {
    try {
      const result = await window.electronAPI?.fsShowOpenDialog({ properties: ["openDirectory"] });
      const p = result?.filePaths?.[0];
      if (p) setFolderSet(true);
    } catch {}
  };

  const handleFinish = () => {
    if (missionId && missionId !== "custom" && onDispatchMission) {
      const m = QUICK_MISSIONS.find(q => q.id === missionId);
      if (m) onDispatchMission(m.label);
    }
    onDismiss?.(true);
  };

  return (
    <motion.div
      className="wf-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
    >
      <motion.div
        className="wf-panel"
        initial={{ opacity: 0, y: 24, scale: 0.96 }}
        animate={{ opacity: 1, y: 0,  scale: 1    }}
        exit={{    opacity: 0, y: 12, scale: 0.97 }}
        transition={{ type: "spring", stiffness: 380, damping: 30 }}
      >
        {/* Progress steps */}
        <div className="wf-steps">
          {STEPS.map((s, i) => (
            <div
              key={s.id}
              className={`wf-step${i === step ? " wf-step--active" : ""}${i < step ? " wf-step--done" : ""}`}
            >
              <span className="wf-step-dot">{i < step ? "✓" : s.icon}</span>
              <span className="wf-step-label">{s.label}</span>
              {i < STEPS.length - 1 && <span className="wf-step-line" />}
            </div>
          ))}
        </div>

        {/* Step content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            className="wf-body"
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0  }}
            exit={{    opacity: 0, x: -16 }}
            transition={{ duration: 0.18 }}
          >
            {step === 0 && (
              <>
                <div className="wf-icon">◎</div>
                <h2 className="wf-title">Welcome to Ooplix</h2>
                <p className="wf-desc">
                  Your AI Engineering OS. Code, plan missions, run agents — all from one interface.
                  Let's get you set up in 60 seconds.
                </p>
                <ul className="wf-checklist">
                  <li><span>✓</span> CodeMirror 6 editor with AI right-click</li>
                  <li><span>✓</span> Visual Git with AI commit messages</li>
                  <li><span>✓</span> Mission engine with 8-stage autonomous pipeline</li>
                  <li><span>✓</span> Cmd+K to search everything</li>
                </ul>
              </>
            )}

            {step === 1 && (
              <>
                <div className="wf-icon">◈</div>
                <h2 className="wf-title">Open a Project</h2>
                <p className="wf-desc">Point Ooplix at a folder to unlock File Explorer, Visual Git, and AI-assisted coding.</p>
                <button
                  className={`wf-folder-btn${folderSet ? " wf-folder-btn--done" : ""}`}
                  onClick={handleFolderPick}
                >
                  {folderSet ? "✓ Project folder set" : "Choose project folder →"}
                </button>
                <p className="wf-skip-hint">or skip — you can open a folder anytime from the sidebar</p>
              </>
            )}

            {step === 2 && (
              <>
                <div className="wf-icon">✦</div>
                <h2 className="wf-title">Start Your First Mission</h2>
                <p className="wf-desc">Missions are AI-driven engineering objectives. Pick one to run immediately or define your own.</p>
                <div className="wf-missions">
                  {QUICK_MISSIONS.map(m => (
                    <button
                      key={m.id}
                      className={`wf-mission-btn${missionId === m.id ? " wf-mission-btn--selected" : ""}`}
                      onClick={() => setMissionId(m.id)}
                    >
                      <span className="wf-mission-icon">{m.icon}</span>
                      <div className="wf-mission-text">
                        <span className="wf-mission-label">{m.label}</span>
                        <span className="wf-mission-desc">{m.desc}</span>
                      </div>
                      {missionId === m.id && <span className="wf-mission-check">✓</span>}
                    </button>
                  ))}
                </div>
              </>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Footer actions */}
        <div className="wf-footer">
          <button className="wf-btn-ghost" onClick={() => onDismiss?.(false)}>
            Skip setup
          </button>
          <div className="wf-footer-right">
            {step > 0 && (
              <button className="wf-btn-ghost" onClick={() => setStep(s => s - 1)}>Back</button>
            )}
            {step < STEPS.length - 1 ? (
              <button className="wf-btn-primary" onClick={() => setStep(s => s + 1)}>
                {step === 1 ? "Next →" : "Continue →"}
              </button>
            ) : (
              <button className="wf-btn-primary" onClick={handleFinish}>
                {missionId ? "Launch Mission →" : "Enter Ooplix →"}
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
