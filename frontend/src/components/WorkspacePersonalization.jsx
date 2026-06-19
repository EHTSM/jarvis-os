import React, { useState } from "react";
import "./WorkspacePersonalization.css";

const PREFS_KEY = "ooplix_workspace_prefs";

function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY) || "{}"); } catch { return {}; }
}
function savePrefs(p) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch {}
}

export function usePinnedTabs() {
  const [pinned, setPinned] = useState(() => loadPrefs().pinnedTabs || []);
  const toggle = (tabId) => {
    setPinned(prev => {
      const next = prev.includes(tabId) ? prev.filter(x => x !== tabId) : [...prev, tabId];
      savePrefs({ ...loadPrefs(), pinnedTabs: next });
      return next;
    });
  };
  return { pinned, toggle };
}

export function useFavoriteMissions() {
  const [favs, setFavs] = useState(() => loadPrefs().favMissions || []);
  const toggle = (missionId, title) => {
    setFavs(prev => {
      const exists = prev.find(m => m.id === missionId);
      const next = exists ? prev.filter(m => m.id !== missionId) : [...prev, { id: missionId, title, ts: Date.now() }];
      savePrefs({ ...loadPrefs(), favMissions: next });
      return next;
    });
  };
  return { favs, toggle };
}

export default function WorkspacePersonalization({ onNavigate }) {
  const [prefs]  = useState(loadPrefs);
  const [tab, setTab] = useState("tabs");

  const pinnedTabs  = prefs.pinnedTabs  || [];
  const favMissions = prefs.favMissions || [];
  const favProjects = prefs.favProjects || [];

  const TAB_LABELS = { tabs: "Pinned Tabs", missions: "Fav Missions", projects: "Fav Projects" };

  return (
    <div className="wp-root">
      <div className="wp-header">
        <span className="section-label">Personalization</span>
      </div>
      <div className="wp-tabs">
        {Object.keys(TAB_LABELS).map(t => (
          <button
            key={t}
            className={`wp-tab${tab === t ? " wp-tab--active" : ""}`}
            onClick={() => setTab(t)}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {tab === "tabs" && (
        <div className="wp-list">
          {pinnedTabs.length === 0
            ? <div className="wp-empty">No pinned tabs. Right-click any tab to pin it.</div>
            : pinnedTabs.map(id => (
              <button key={id} className="wp-item" onClick={() => onNavigate?.(id)}>
                <span className="wp-item-icon">📌</span>
                <span className="wp-item-label">{id}</span>
              </button>
            ))
          }
        </div>
      )}

      {tab === "missions" && (
        <div className="wp-list">
          {favMissions.length === 0
            ? <div className="wp-empty">No favorite missions yet. Star a mission to save it here.</div>
            : favMissions.map(m => (
              <button key={m.id} className="wp-item" onClick={() => onNavigate?.("execution")}>
                <span className="wp-item-icon">✦</span>
                <span className="wp-item-label">{m.title}</span>
              </button>
            ))
          }
        </div>
      )}

      {tab === "projects" && (
        <div className="wp-list">
          {favProjects.length === 0
            ? <div className="wp-empty">No favorite projects. Open a folder and click ★ to pin it.</div>
            : favProjects.map(p => (
              <button key={p.path} className="wp-item">
                <span className="wp-item-icon">📁</span>
                <span className="wp-item-label">{p.name}</span>
              </button>
            ))
          }
        </div>
      )}
    </div>
  );
}
