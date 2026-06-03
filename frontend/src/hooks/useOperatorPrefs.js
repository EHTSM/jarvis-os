import { useState, useEffect, useCallback } from "react";

const PREFS_KEY = "jarvis_operator_prefs";
const DEFAULTS = {
  compactMode:    false,
  notifSound:     false,
  notifMinLevel:  "info",   // info | warn | crit
  showTimestamps: true,
  autoScroll:     true,
};

function _load() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch { return DEFAULTS; }
}

function _save(prefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {}
}

export function useOperatorPrefs() {
  const [prefs, setPrefs] = useState(_load);

  const set = useCallback((key, value) => {
    setPrefs(prev => {
      const next = { ...prev, [key]: value };
      _save(next);
      return next;
    });
  }, []);

  const toggle = useCallback((key) => {
    setPrefs(prev => {
      const next = { ...prev, [key]: !prev[key] };
      _save(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setPrefs(DEFAULTS);
    _save(DEFAULTS);
  }, []);

  // Apply compact mode to body class for CSS targeting
  useEffect(() => {
    document.body.classList.toggle("op-compact", !!prefs.compactMode);
    return () => document.body.classList.remove("op-compact");
  }, [prefs.compactMode]);

  return { prefs, set, toggle, reset };
}
