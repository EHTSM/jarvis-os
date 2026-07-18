import React, { useState, useEffect, useMemo } from "react";
import { _fetch } from "../../_client";
import { useAuth } from "../../contexts/AuthContext";
import "./AuthCard.css";

// Landing page for an emailed workspace-invite link (workspaceService.
// sendInvitationEmail → /accept-invite?token=...). Shows who invited the
// user and to what, before requiring sign-in/signup to actually join —
// mirrors ResetPasswordPage/VerifyEmailPage's pattern for emailed deep links.

export default function AcceptInvitePage({ onDone, onSignup, onLogin }) {
  const { user } = useAuth();
  const token = useMemo(() => {
    try { return new URLSearchParams(window.location.search).get("token") || ""; }
    catch { return ""; }
  }, []);

  const [preview, setPreview] = useState(null);
  const [status, setStatus] = useState(token ? "loading" : "missing"); // loading | preview | joined | error | missing
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      const r = await _fetch(`/invite-preview/${token}`).catch(e => ({ error: e.message }));
      if (cancelled) return;
      if (r.error || !r.invitation) { setStatus("error"); setErr(r.error || "Invitation not found."); return; }
      if (r.invitation.used) { setStatus("error"); setErr("This invitation has already been used."); return; }
      if (r.invitation.expired) { setStatus("error"); setErr("This invitation has expired — ask for a new one."); return; }
      setPreview(r.invitation);
      setStatus("preview");
    })();
    return () => { cancelled = true; };
  }, [token]);

  const handleAccept = async () => {
    setBusy(true);
    const r = await _fetch("/workspace/accept-invite", {
      method: "POST",
      body: JSON.stringify({ token }),
    }).catch(e => ({ error: e.message }));
    setBusy(false);
    if (r.error) { setErr(r.error); setStatus("error"); return; }
    setStatus("joined");
  };

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

        {status === "loading" && (
          <div className="auth-success">
            <span className="auth-spinner" style={{ width: 28, height: 28 }} />
          </div>
        )}

        {status === "preview" && preview && (
          <>
            <h1 className="auth-heading">You're invited</h1>
            <p className="auth-sub">
              Join <strong>{preview.workspaceName}</strong> as <strong>{preview.role}</strong>.
            </p>
            {!user ? (
              <div className="auth-form" style={{ marginTop: 8 }}>
                <p className="auth-footer-text">Sign in or create an account with <strong>{preview.email}</strong> to accept.</p>
                <button className="auth-btn" onClick={onSignup}>Create account →</button>
                <button type="button" className="auth-link" style={{ alignSelf: "center", marginTop: 8 }} onClick={onLogin}>
                  Already have an account? Sign in
                </button>
              </div>
            ) : (
              <button className="auth-btn" style={{ marginTop: 8 }} onClick={handleAccept} disabled={busy}>
                {busy ? <><span className="auth-spinner" /> Joining…</> : "Accept invitation →"}
              </button>
            )}
          </>
        )}

        {status === "joined" && (
          <div className="auth-success">
            <div className="auth-success-icon">✓</div>
            <div className="auth-success-title">You're in</div>
            <div className="auth-success-sub">You've joined {preview?.workspaceName}.</div>
          </div>
        )}

        {(status === "error" || status === "missing") && (
          <div className="auth-error" role="alert" style={{ marginTop: 12 }}>
            <span className="auth-error-icon">✕</span>
            {status === "missing" ? "This link is missing its invitation token." : err}
          </div>
        )}

        {status !== "preview" && status !== "loading" && (
          <div className="auth-footer" style={{ marginTop: 20 }}>
            <button type="button" className="auth-btn" onClick={onDone}>Continue →</button>
          </div>
        )}
      </div>
    </div>
  );
}
