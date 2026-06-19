import React, { useState, useEffect } from "react";
import "./DevHUD.css";

const BASE = process.env.REACT_APP_API_URL || "";

export default function DevHUD({ online, onNavigate }) {
  const [branch, setBranch] = useState(null);
  const [memory, setMemory] = useState(null);

  useEffect(() => {
    fetch(`${BASE}/coding/context`, { credentials: "include" })
      .then(r => r.json())
      .then(d => { if (d.branch) setBranch(d.branch); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const update = () => {
      const mem = performance?.memory;
      if (mem) setMemory(Math.round(mem.usedJSHeapSize / 1048576));
    };
    update();
    const t = setInterval(update, 10000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="hud-bar">
      <button
        className="hud-item"
        onClick={() => onNavigate?.("jarvisbrain")}
        title="AI Chat"
      >
        <span className={`hud-dot${online ? " hud-dot--ok" : " hud-dot--off"}`} />
        <span className="hud-label">AI</span>
      </button>

      {branch && (
        <button className="hud-item" onClick={() => onNavigate?.("git")} title="Git">
          <span className="hud-icon">⎇</span>
          <span className="hud-label">
            {branch.length > 16 ? branch.slice(0, 14) + "…" : branch}
          </span>
        </button>
      )}

      <button
        className="hud-item"
        onClick={() => onNavigate?.("execution")}
        title="Pipeline"
      >
        <span className="hud-icon">⬡</span>
        <span className="hud-label">Pipeline</span>
      </button>

      <div className="hud-spacer" />

      {memory && (
        <span className="hud-item hud-item--passive" title="JS Heap">
          <span className="hud-icon">◈</span>
          <span className="hud-label">{memory}MB</span>
        </span>
      )}

      <button
        className="hud-item"
        onClick={() => onNavigate?.("reliability")}
        title="Health"
      >
        <span className={`hud-dot${online ? " hud-dot--ok" : " hud-dot--warn"}`} />
        <span className="hud-label">Health</span>
      </button>
    </div>
  );
}
