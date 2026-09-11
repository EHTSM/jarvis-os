import React, { useState, useEffect, useMemo } from "react";
import { confirmEmailVerification } from "../../authApi";
import "./AuthCard.css";

export default function VerifyEmailPage({ onDone }) {
  const token = useMemo(() => {
    try { return new URLSearchParams(window.location.search).get("token") || ""; }
    catch { return ""; }
  }, []);

  const [status, setStatus] = useState(token ? "verifying" : "missing"); // verifying | success | error | missing
  const [err,    setErr]    = useState("");

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      const res = await confirmEmailVerification(token);
      if (cancelled) return;
      if (res.success) setStatus("success");
      else { setStatus("error"); setErr(res.error || "This verification link is invalid or has expired."); }
    })();
    return () => { cancelled = true; };
  }, [token]);

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

        {status === "verifying" && (
          <div className="auth-success">
            <span className="auth-spinner" style={{ width: 28, height: 28 }} />
            <div className="auth-success-title" style={{ marginTop: 12 }}>Verifying your email…</div>
          </div>
        )}

        {status === "success" && (
          <div className="auth-success">
            <div className="auth-success-icon">✓</div>
            <div className="auth-success-title">Email verified</div>
            <div className="auth-success-sub">Your email address has been confirmed.</div>
          </div>
        )}

        {(status === "error" || status === "missing") && (
          <div className="auth-error" role="alert" style={{ marginTop: 12 }}>
            <span className="auth-error-icon">✕</span>
            {status === "missing" ? "This link is missing its verification token." : err}
          </div>
        )}

        <div className="auth-footer" style={{ marginTop: 20 }}>
          <button type="button" className="auth-btn" onClick={onDone}>Continue →</button>
        </div>
      </div>
    </div>
  );
}
