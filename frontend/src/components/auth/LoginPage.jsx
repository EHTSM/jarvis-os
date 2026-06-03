import React, { useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import "./LoginPage.css";

// onSuccess is optional — used when LoginPage is rendered as a full-screen gate.
// When omitted (RuntimeTab usage), AuthContext user state update re-renders parent.
export default function LoginPage({ onSuccess } = {}) {
  const { login } = useAuth();
  const [pw,   setPw]   = useState("");
  const [err,  setErr]  = useState("");
  const [busy, setBusy] = useState(false);

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
          <div className="login-logo">J</div>
          <div className="login-brand-text">
            <span className="login-brand-name">Ooplix</span>
            <span className="login-brand-by">AI Operating System</span>
          </div>
        </div>

        <h1 className="login-title">Welcome back</h1>
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
            Need access?{" "}
            <a href="mailto:support@ooplix.com" className="login-footer-link">
              Contact support
            </a>
          </p>
          <p className="login-footer-company">ALWALIY TECHNOLOGIES PRIVATE LIMITED</p>
        </div>

      </div>
    </div>
  );
}
