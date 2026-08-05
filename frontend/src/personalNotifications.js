"use strict";
// V6 Phase 8 (Personal JARVIS): bridges real founder-assistant events
// (overdue tasks, pending twin decisions) to the already-real Electron
// native notification channel (electron/main.cjs "show-notification" IPC,
// exposed as window.electronAPI.showNotification — confirmed real and
// working, but never called from anywhere in the frontend until this).
import { getAgenda } from "./planningApi";
import { _isElectron } from "./_client";

const POLL_MS = 5 * 60_000; // 5 min — matches the same cadence as other founder-home pulses
const SEEN_KEY = "ooplix_notified_task_ids";

function _loadSeen() {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || "[]")); }
  catch { return new Set(); }
}
function _saveSeen(set) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...set].slice(-500))); } catch { /* non-fatal */ }
}

function _notify(title, body) {
  if (!_isElectron() || !window.electronAPI?.showNotification) return;
  window.electronAPI.showNotification({ title, body });
  window.electronAPI.dockBounce?.({ type: "informational" });
}

// Reflects the same overdue+dueToday+pending-decision count used for
// notifications onto the real OS dock badge (macOS) / taskbar overlay
// (Windows) — taskbar-badge was already implemented in electron/main.cjs
// and exposed via preload, but nothing ever called it.
function _updateBadge(count) {
  if (!_isElectron() || !window.electronAPI?.taskbarBadge) return;
  window.electronAPI.taskbarBadge({ count });
}

/**
 * Real check: pulls the live agenda (already-real dailyPlanningEngine
 * composing missions + twin), fires a native notification for anything
 * newly overdue or due today that hasn't already been notified this
 * session/browser (tracked in localStorage, not re-notified on every poll).
 */
async function _checkAndNotify() {
  let agenda;
  try { agenda = await getAgenda(); } catch { return; }
  if (agenda?.ok === false) return;

  const seen = _loadSeen();
  const overdue = agenda?.tasks?.overdue || [];
  const dueToday = agenda?.tasks?.dueToday || [];

  for (const t of overdue) {
    if (seen.has(t.id)) continue;
    _notify("Overdue task", t.title);
    seen.add(t.id);
  }
  for (const t of dueToday) {
    if (seen.has(t.id)) continue;
    _notify("Due today", t.title);
    seen.add(t.id);
  }

  const pending = agenda?.founderContext?.pendingDecisions;
  if (typeof pending === "number" && pending > 0) {
    const key = `decisions_${new Date().toISOString().slice(0, 10)}`;
    if (!seen.has(key) && pending >= 50) {
      _notify("Digital Twin", `${pending} decisions are waiting for your input.`);
      seen.add(key);
    }
  }

  _saveSeen(seen);
  _updateBadge(overdue.length + dueToday.length);
}

let _timer = null;

/**
 * Starts polling. Only does real work inside Electron (native notifications
 * have no meaning in a browser tab) — a no-op elsewhere, matching the same
 * _isElectron() gating used throughout the codebase (e.g. firebaseService.js).
 */
export function startPersonalNotifications() {
  if (!_isElectron() || _timer) return;
  _checkAndNotify();
  _timer = setInterval(_checkAndNotify, POLL_MS);
}

export function stopPersonalNotifications() {
  if (_timer) { clearInterval(_timer); _timer = null; }
  _updateBadge(0);
}
