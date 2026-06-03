import React, { useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import "./LoginPage.css";

// onSuccess is optional — used when LoginPage is rendered as a full-screen gate.
// When omitted (RuntimeTab usage), AuthContext user state update re-renders parent.
// context: "fresh" shown when user just completed onboarding (clearer UX bridge)
export default function LoginPage({ onSuccess, context } = {}) {
  const { login } = useAuth();
  const [pw,   setPw]   = useState("");
  const [err,  setErr]  = useState("");
  const [busy, setBusy] = useState(false);

  const isFresh = context === "fresh";

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!pw.trim() || busy) return;
    setBusy(true);
    setErr("");
    const result = await login(pw);
    if (!result.success) {
      setErr(result.error === "Auth not configured — OPERATOR_PASSWORD_HASH missing"
        ? "Server not configured. Set OPERATOR_PASSWORD_HASH in your .env file."
        : result.error || "Incorrect password. Please try again.");
    } else {
      onSuccess?.();
    }
    setBusy(false);
  };

  return (
    <div className="login-page">
      <div className="login-card">

        <div className="login-brand">
          <div className="login-logo">O</div>
          <div className="login-brand-text">
            <span className="login-brand-name">Ooplix</span>
            <span className="login-brand-by">AI Operating System</span>
          </div>
        </div>

        {isFresh ? (
          <>
            <div className="login-fresh-banner">
              <span className="login-fresh-icon">✓</span>
              <div>
                <p className="login-fresh-title">Your workspace is ready.</p>
                <p className="login-fresh-sub">Sign in with the password set up by your Ooplix administrator to access the system.</p>
              </div>
            </div>
            <h1 className="login-title">Access your workspace</h1>
          </>
        ) : (
          <h1 className="login-title">Welcome back</h1>
        )}

        <p className="login-subtitle">Enter your access password to continue</p>

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="login-field">
            <label className="login-label" htmlFor="login-pw">Password</label>
            <input
              id="login-pw"
              type="password"
              className="login-input"
              placeholder="Your access password"
              value={pw}
              onChange={e => setPw(e.target.value)}
              autoFocus
              disabled={busy}
              autoComplete="current-password"
            />
          </div>

          {err && (
            <div className="login-error" role="alert">
              <span className="login-error-icon">✕</span>
              {err}
            </div>
          )}

          <button
            type="submit"
            className="login-btn"
            disabled={busy || !pw.trim()}
          >
            {busy ? "Signing in…" : "Sign in →"}
          </button>
        </form>

        <div className="login-footer">
          <p className="login-footer-text">
            No password?{" "}
            <a href="mailto:support@ooplix.com" className="login-footer-link">
              Contact support ↗
            </a>
          </p>
          <p className="login-footer-company">ALWALIY TECHNOLOGIES PRIVATE LIMITED</p>
        </div>

      </div>
    </div>
  );
}
