import React from "react";
import { useNavigate, useLocation } from "react-router-dom";

const TABS = [
  { path: "/",       icon: "🏠", label: "Home"      },
  { path: "/tools",  icon: "🛠️", label: "Tools"     },
  { path: "/dash",   icon: "📊", label: "Dashboard"  },
  { path: "/profile",icon: "👤", label: "Profile"    }
];

export default function BottomNav() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  return (
    <nav className="bottom-nav">
      {TABS.map(t => {
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
