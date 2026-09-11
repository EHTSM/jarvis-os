import React from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

const TABS = [
  { path: "/",       icon: "🏠", label: "Home"      },
  { path: "/tools",  icon: "🛠️", label: "Tools"     },
  // Mission 58: /dash (Insights) calls /stats and /ops, both backend
  // operatorOnly routes (Mission 55/56 findings) — no customer-accessible
  // equivalent exists. Gated below rather than removed, since it IS a real,
  // working feature for the accounts that can reach it.
  { path: "/dash",   icon: "📊", label: "Insights", operatorOnly: true },
  { path: "/profile",icon: "👤", label: "Profile"    }
];

export default function BottomNav() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { role } = useAuth();
  const visibleTabs = TABS.filter(t => !t.operatorOnly || role === "operator");

  return (
    <nav className="bottom-nav">
      {visibleTabs.map(t => {
        const active = pathname === t.path || (t.path !== "/" && pathname.startsWith(t.path));
        return (
          <button
            key={t.path}
            className={`nav-item ${active ? "active" : ""}`}
            onClick={() => navigate(t.path)}
          >
            <span className="nav-icon">{t.icon}</span>
            <span>{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
