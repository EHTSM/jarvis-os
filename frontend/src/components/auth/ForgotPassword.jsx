import React, { useState, useCallback } from "react";
import { firebaseForgotPassword, isFirebaseConfigured } from "../../firebaseService";
import "./AuthCard.css";

export default function ForgotPassword({ onBack }) {
  const [email,   setEmail]   = useState("");
  const [busy,    setBusy]    = useState(false);
  const [err,     setErr]     = useState("");
  const [sent,    setSent]    = useState(false);

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!email.trim()) { setErr("Please enter your email address."); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim().toLowerCase())) {
      setErr("Please enter a valid email address.");
      return;
    }

    setBusy(true);
    setErr("");

    if (!isFirebaseConfigured()) {
      setErr("Password reset requires Firebase to be configured. Contact support@ooplix.com.");
      setBusy(false);
      return;
    }

    const res = await firebaseForgotPassword(email.trim().toLowerCase());
    if (!res.success) {
      // Treat user-not-found as success — prevent email enumeration
      if (res.code === "user-not-found") {
        setSent(true);
      } else {
        setErr(res.error || "Could not send reset email. Please try again.");
      }
    } else {
      setSent(true);
    }
    setBusy(false);
  }, [busy, email]);

  if (sent) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-brand">
            <div className="auth-logo">O</div>
            <div className="auth-brand-text">
              <span className="auth-brand-name">Ooplix</span>
              <span className="auth-brand-sub">AI Operating System</span>
            </div>
          </div>

          <div className="auth-success">
            <div className="auth-success-icon">✓</div>
            <div className="auth-success-title">Check your inbox</div>
            <div className="auth-success-sub">
              If an account exists for <strong>{email}</strong>, you'll receive a
              password reset link within a few minutes.
            </div>
          </div>

          <div className="auth-footer" style={{ marginTop: 28 }}>
            <button type="button" className="auth-btn" onClick={onBack}>
              ← Back to Sign in
            </button>
            <p className="auth-footer-text" style={{ marginTop: 12 }}>
              Didn't receive it? Check your spam folder or{" "}
              <button type="button" className="auth-link"
                onClick={() => { setSent(false); setEmail(""); }}>
                try again
              </button>.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="auth-logo">O</div>
          <div className="auth-brand-text">
            <span className="auth-brand-name">Ooplix</span>
            <span className="auth-brand-sub">AI Operating System</span>
          </div>
        </div>

        <h1 className="auth-heading">Reset your password</h1>
        <p className="auth-sub">
          Enter your email and we'll send a reset link.
        </p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="auth-field">
            <label className="auth-label" htmlFor="fp-email">Email address</label>
            <input
              id="fp-email" type="email" className="auth-input"
              placeholder="you@company.com"
              value={email} onChange={e => setEmail(e.target.value)}
              disabled={busy} autoComplete="email" inputMode="email" autoFocus
            />
          </div>

          {err && (
            <div className="auth-error" role="alert">
              <span className="auth-error-icon">✕</span> {err}
            </div>
          )}

          <button type="submit" className="auth-btn" disabled={busy || !email.trim()}>
            {busy ? <><span className="auth-spinner" /> Sending…</> : "Send reset link →"}
          </button>
        </form>

        <div className="auth-footer">
          <button type="button" className="auth-link" onClick={onBack} disabled={busy}>
            ← Back to Sign in
          </button>
          <p className="auth-footer-company">ALWALIY TECHNOLOGIES PRIVATE LIMITED</p>
        </div>
      </div>
    </div>
  );
}
