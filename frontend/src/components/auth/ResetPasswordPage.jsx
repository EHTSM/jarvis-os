import React, { useState, useCallback, useMemo } from "react";
import { confirmPasswordReset } from "../../authApi";
import "./AuthCard.css";

function _strength(pw) {
  if (!pw) return 0;
  let s = 0;
  if (pw.length >= 8)            s++;
  if (pw.length >= 12)           s++;
  if (/[A-Z]/.test(pw))          s++;
  if (/[0-9!@#$%^&*]/.test(pw)) s++;
  return Math.min(s, 4);
}
const STRENGTH_LABELS = ["", "Weak", "Fair", "Good", "Strong"];

export default function ResetPasswordPage({ onDone }) {
  const token = useMemo(() => {
    try { return new URLSearchParams(window.location.search).get("token") || ""; }
    catch { return ""; }
  }, []);

  const [password, setPassword] = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [showPw,   setShowPw]   = useState(false);
  const [busy,     setBusy]     = useState(false);
  const [err,      setErr]      = useState("");
  const [done,     setDone]     = useState(false);
  const strength = _strength(password);

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!token) { setErr("This reset link is missing its token. Request a new one."); return; }
    if (password.length < 8) { setErr("Password must be at least 8 characters."); return; }
    if (password !== confirm) { setErr("Passwords do not match."); return; }

    setBusy(true);
    setErr("");
    const res = await confirmPasswordReset(token, password);
    setBusy(false);
    if (!res.success) {
      setErr(res.error || "This reset link is invalid or has expired.");
      return;
    }
    setDone(true);
  }, [busy, token, password, confirm]);

  if (!token) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <Brand />
          <div className="auth-error" role="alert" style={{ marginTop: 12 }}>
            <span className="auth-error-icon">✕</span> This link is missing its reset token.
          </div>
          <div className="auth-footer" style={{ marginTop: 20 }}>
            <button type="button" className="auth-btn" onClick={onDone}>← Back to sign in</button>
          </div>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <Brand />
          <div className="auth-success">
            <div className="auth-success-icon">✓</div>
            <div className="auth-success-title">Password updated</div>
            <div className="auth-success-sub">You can now sign in with your new password.</div>
          </div>
          <div className="auth-footer" style={{ marginTop: 20 }}>
            <button type="button" className="auth-btn" onClick={onDone}>Sign in →</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <Brand />
        <h1 className="auth-heading">Set a new password</h1>
        <p className="auth-sub">Choose a strong password for your account.</p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="auth-field">
            <label className="auth-label" htmlFor="rp-pw">New password</label>
            <div className="auth-pw-wrap">
              <input
                id="rp-pw" type={showPw ? "text" : "password"} className="auth-input"
                placeholder="Min. 8 characters"
                value={password} onChange={e => setPassword(e.target.value)}
                disabled={busy} autoComplete="new-password" autoFocus required
              />
              <button type="button" className="auth-pw-toggle"
                onClick={() => setShowPw(v => !v)} tabIndex={-1}
                aria-label={showPw ? "Hide password" : "Show password"}>
                {showPw ? "Hide" : "Show"}
              </button>
            </div>
            {password.length > 0 && (
              <div className="auth-pw-strength">
                <div className="auth-pw-bar">
                  <div className="auth-pw-bar-fill" data-strength={strength} />
                </div>
                <span className="auth-pw-label">{STRENGTH_LABELS[strength]}</span>
              </div>
            )}
          </div>

          <div className="auth-field">
            <label className="auth-label" htmlFor="rp-pw2">Confirm password</label>
            <input
              id="rp-pw2" type={showPw ? "text" : "password"} className="auth-input"
              placeholder="Re-enter password"
              value={confirm} onChange={e => setConfirm(e.target.value)}
              disabled={busy} autoComplete="new-password" required
            />
          </div>

          {err && (
            <div className="auth-error" role="alert">
              <span className="auth-error-icon">✕</span> {err}
            </div>
          )}

          <button type="submit" className="auth-btn" disabled={busy || !password || !confirm}>
            {busy ? <><span className="auth-spinner" /> Updating…</> : "Update password →"}
          </button>
        </form>

        <div className="auth-footer">
          <button type="button" className="auth-link" onClick={onDone} disabled={busy}>← Back to sign in</button>
        </div>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div className="auth-brand">
      <div className="auth-logo">O</div>
      <div className="auth-brand-text">
        <span className="auth-brand-name">Ooplix</span>
        <span className="auth-brand-sub">AI Operating System</span>
      </div>
    </div>
  );
}
