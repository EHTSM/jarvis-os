import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth }           from "../context/AuthContext.jsx";
import { useToast }          from "../context/ToastContext.jsx";
import { signOut }           from "../firebase.js";

export default function Profile() {
  const { user }   = useAuth();
  const toast      = useToast();
  const navigate   = useNavigate();
  const [loading, setLoading] = useState(false);

  const initials = (user?.displayName || user?.email || "U")
    .split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);

  const handleSignOut = async () => {
    setLoading(true);
    try {
      await signOut();
      navigate("/login", { replace: true });
    } catch (err) {
      toast.show("Sign-out failed: " + err.message, "error");
      setLoading(false);
    }
  };

  const version = process.env.REACT_APP_VERSION || "1.0.0";

  return (
    <>
      <header className="mobile-header">
        <div className="brand">
          <span className="brand-name">Profile</span>
        </div>
      </header>

      <div className="app-screen">
        {/* Avatar + name */}
        <div className="profile-header">
          <div className="avatar">{initials}</div>
          <p className="profile-name">{user?.displayName || "JARVIS User"}</p>
          <p className="profile-email">{user?.email}</p>
        </div>

        {/* Account section */}
        <div className="setting-group">
          <p className="setting-group-title">Account</p>
          <div className="setting-item">
            <span className="setting-icon">✉</span>
            <span className="setting-label">Email</span>
            <span className="setting-value">{user?.email}</span>
          </div>
          <div className="setting-item">
            <span className="setting-icon">🔐</span>
            <span className="setting-label">Auth Provider</span>
            <span className="setting-value">Firebase</span>
          </div>
          <div className="setting-item">
            <span className="setting-icon">📋</span>
            <span className="setting-label">User ID</span>
            <span className="setting-value" style={{ fontSize: 10 }}>
              {user?.uid?.slice(0, 12)}…
            </span>
          </div>
        </div>

        {/* Legal section */}
        <div className="setting-group">
          <p className="setting-group-title">Legal</p>
          <Link to="/privacy" className="setting-item" style={{ display: "flex", textDecoration: "none" }}>
            <span className="setting-icon">🔒</span>
            <span className="setting-label">Privacy Policy</span>
            <span className="setting-arrow">›</span>
          </Link>
          <Link to="/terms" className="setting-item" style={{ display: "flex", textDecoration: "none" }}>
            <span className="setting-icon">📜</span>
            <span className="setting-label">Terms & Conditions</span>
            <span className="setting-arrow">›</span>
          </Link>
        </div>

        {/* About section */}
        <div className="setting-group">
          <p className="setting-group-title">About</p>
          <div className="setting-item">
            <span className="setting-icon">ℹ</span>
            <span className="setting-label">App Version</span>
            <span className="setting-value">v{version}</span>
          </div>
          <div className="setting-item">
            <span className="setting-icon">⬡</span>
            <span className="setting-label">JARVIS AI</span>
            <span className="setting-value">Business Assistant</span>
          </div>
        </div>

        {/* Sign out */}
        <div style={{ padding: "16px 16px 32px" }}>
          <button
            className="btn btn-danger"
            onClick={handleSignOut}
            disabled={loading}
          >
            {loading ? "Signing out…" : "Sign Out"}
          </button>
        </div>
      </div>
    </>
  );
}
