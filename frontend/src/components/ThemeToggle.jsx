import React, { useEffect, useState } from "react";

const THEME_KEY = "ooplix_theme"; // "light" | "dark" — absent means "follow system"

function _applyTheme(mode) {
  const root = document.documentElement;
  if (mode === "light" || mode === "dark") root.setAttribute("data-theme", mode);
  else root.removeAttribute("data-theme");
}

function _systemPrefersLight() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches;
}

export function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  _applyTheme(saved);
}

export default function ThemeToggle({ compact = false }) {
  const [mode, setMode] = useState(() => localStorage.getItem(THEME_KEY) || null);

  useEffect(() => { _applyTheme(mode); }, [mode]);

  // Follow OS changes only while the user hasn't made an explicit choice.
  useEffect(() => {
    if (mode) return;
    const mq = window.matchMedia?.("(prefers-color-scheme: light)");
    if (!mq) return;
    const onChange = () => { /* no-op — CSS media query already handles this without JS */ };
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, [mode]);

  const effectiveIsLight = mode ? mode === "light" : _systemPrefersLight();

  function toggle() {
    const next = effectiveIsLight ? "dark" : "light";
    localStorage.setItem(THEME_KEY, next);
    setMode(next);
  }

  return (
    <button
      className={`theme-toggle-btn${compact ? " theme-toggle-btn--compact" : ""}`}
      onClick={toggle}
      aria-label={effectiveIsLight ? "Switch to dark mode" : "Switch to light mode"}
      title={effectiveIsLight ? "Switch to dark mode" : "Switch to light mode"}
    >
      <span aria-hidden="true">{effectiveIsLight ? "☾" : "☀"}</span>
      {!compact && <span>{effectiveIsLight ? "Dark" : "Light"}</span>}
    </button>
  );
}
