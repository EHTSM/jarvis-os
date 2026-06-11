import React, { useState, useCallback, useEffect, useRef } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { loginWithEmail, firebaseSession } from "../../authApi";
import {
  firebaseSignInEmail,
  firebaseSignInGoogle,
  sendPhoneOtp,
  verifyPhoneOtp,
  setupRecaptcha,
  isFirebaseConfigured,
  isElectronShell,
} from "../../firebaseService";
import { track } from "../../analytics";
import "./AuthCard.css";

// ── Google SVG ────────────────────────────────────────────────────────────────
function GoogleIcon() {
  return (
    <svg className="auth-social-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  );
}

// ── Phone SVG ─────────────────────────────────────────────────────────────────
function PhoneIcon() {
  return (
    <svg className="auth-social-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.61 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.18 6.18l.96-.85a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
    </svg>
  );
}

// ── Email Login Form ──────────────────────────────────────────────────────────
function EmailLoginForm({ onSuccess, onSignup, onForgot, busy, setBusy }) {
  const { login } = useAuth();
  const [email,  setEmail]  = useState("");
  const [pw,     setPw]     = useState("");
  const [showPw, setShowPw] = useState(false);
  const [err,    setErr]    = useState("");

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!pw.trim()) { setErr("Please enter your password."); return; }
    setBusy(true);
    setErr("");

    const result = email.trim()
      ? await login(pw, email.trim().toLowerCase())
      : await login(pw); // legacy operator fallback

    if (!result.success) {
      setErr(
        result.error === "Auth not configured — OPERATOR_PASSWORD_HASH missing"
          ? "Server auth not configured. Contact your administrator."
          : result.error || "Incorrect email or password."
      );
    } else {
      track.login("email");
      onSuccess?.();
    }
    setBusy(false);
  }, [busy, email, pw, login, onSuccess, setBusy]);

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <div className="auth-field">
        <label className="auth-label" htmlFor="li-email">Email</label>
        <input
          id="li-email" type="email" className="auth-input"
          placeholder="you@company.com"
          value={email} onChange={e => setEmail(e.target.value)}
          disabled={busy} autoComplete="email" inputMode="email" autoFocus
        />
      </div>

      <div className="auth-field">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <label className="auth-label" htmlFor="li-pw">Password</label>
          <button type="button" className="auth-link" style={{ fontSize: 11 }}
            onClick={onForgot} disabled={busy} tabIndex={-1}>
            Forgot password?
          </button>
        </div>
        <div className="auth-pw-wrap">
          <input
            id="li-pw" type={showPw ? "text" : "password"} className="auth-input"
            placeholder="Your password"
            value={pw} onChange={e => setPw(e.target.value)}
            disabled={busy} autoComplete="current-password"
          />
          <button type="button" className="auth-pw-toggle"
            onClick={() => setShowPw(v => !v)} tabIndex={-1}
            aria-label={showPw ? "Hide password" : "Show password"}>
            {showPw ? "Hide" : "Show"}
          </button>
        </div>
      </div>

      {err && (
        <div className="auth-error" role="alert">
          <span className="auth-error-icon">✕</span> {err}
        </div>
      )}

      <button type="submit" className="auth-btn" disabled={busy || !pw.trim()}>
        {busy ? <><span className="auth-spinner" /> Signing in…</> : "Sign in →"}
      </button>
    </form>
  );
}

// ── Google Login ──────────────────────────────────────────────────────────────
function GoogleLoginButton({ onSuccess, busy, setBusy }) {
  const { silentCheck } = useAuth();
  const [err, setErr] = useState("");

  if (!isFirebaseConfigured()) {
    return (
      <div className="auth-not-configured">
        ⚠ Google Sign-In requires Firebase setup. See .env.local for required keys.
      </div>
    );
  }

  if (isElectronShell()) {
    return (
      <div className="auth-not-configured">
        ℹ Google Sign-In is not available in the desktop app. Use the web version at{" "}
        <strong>app.ooplix.com</strong> or sign in with email.
      </div>
    );
  }

  const handleGoogle = async () => {
    if (busy) return;
    setBusy(true);
    setErr("");

    const fbRes = await firebaseSignInGoogle();
    if (!fbRes.success) {
      if (fbRes.error !== "cancelled") setErr(fbRes.error);
      setBusy(false);
      return;
    }

    const { user: fbUser } = fbRes;
    const idToken = await fbUser.getIdToken();
    const sessionRes = await firebaseSession({
      idToken,
      email:    fbUser.email,
      name:     fbUser.displayName || fbUser.email.split("@")[0],
      provider: "google",
    });
    if (!sessionRes.success) {
      setErr(sessionRes.error || "Sign-in failed. Please try again.");
      setBusy(false);
      return;
    }
    await silentCheck();
    track.login("google");
    setBusy(false);
    onSuccess?.();
  };

  return (
    <>
      {err && (
        <div className="auth-error" role="alert">
          <span className="auth-error-icon">✕</span> {err}
        </div>
      )}
      <button className="auth-social-btn" onClick={handleGoogle} disabled={busy} type="button">
        {busy ? <span className="auth-spinner" /> : <GoogleIcon />}
        Continue with Google
      </button>
    </>
  );
}

// ── Phone Login ───────────────────────────────────────────────────────────────
function PhoneLoginForm({ onSuccess, busy, setBusy }) {
  const { silentCheck } = useAuth();
  const [phone,        setPhone]        = useState("");
  const [otp,          setOtp]          = useState(["", "", "", "", "", ""]);
  const [step,         setStep]         = useState("phone");
  const [confirmation, setConfirmation] = useState(null);
  const [err,          setErr]          = useState("");
  const [sending,      setSending]      = useState(false);
  const otpRefs = useRef([]);

  useEffect(() => {
    if (isFirebaseConfigured()) setupRecaptcha("recaptcha-container");
  }, []);

  if (!isFirebaseConfigured()) {
    return (
      <div className="auth-not-configured">
        ⚠ Phone Sign-In requires Firebase setup. See .env.local for required keys.
      </div>
    );
  }

  if (isElectronShell()) {
    return (
      <div className="auth-not-configured">
        ℹ Phone Sign-In is not available in the desktop app. Use the web version at{" "}
        <strong>app.ooplix.com</strong> or sign in with email.
      </div>
    );
  }

  const handleSend = async () => {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) { setErr("Please enter a valid 10-digit number."); return; }
    setSending(true);
    setErr("");
    const res = await sendPhoneOtp(`+91${digits}`, "recaptcha-container");
    if (!res.success) { setErr(res.error); setSending(false); return; }
    setConfirmation(res.confirmationResult);
    setStep("otp");
    setSending(false);
    setTimeout(() => otpRefs.current[0]?.focus(), 100);
  };

  const handleOtpChange = (idx, val) => {
    const cleaned = val.replace(/\D/g, "").slice(0, 1);
    const next = [...otp];
    next[idx] = cleaned;
    setOtp(next);
    if (cleaned && idx < 5) otpRefs.current[idx + 1]?.focus();
  };

  const handleOtpKey = (idx, e) => {
    if (e.key === "Backspace" && !otp[idx] && idx > 0) otpRefs.current[idx - 1]?.focus();
  };

  const handleVerify = async () => {
    const code = otp.join("");
    if (code.length < 6) { setErr("Please enter the 6-digit OTP."); return; }
    setBusy(true);
    setErr("");

    const res = await verifyPhoneOtp(confirmation, code);
    if (!res.success) { setErr(res.error); setBusy(false); return; }

    const { user: fbUser, idToken: phoneIdToken } = res;
    const sessionRes = await firebaseSession({
      idToken:  phoneIdToken,
      email:    `phone_${fbUser.uid}@ooplix.app`,
      name:     fbUser.phone || fbUser.uid.slice(0, 8),
      provider: "phone",
    });
    if (!sessionRes.success) {
      setErr(sessionRes.error || "Sign-in failed. Please try again.");
      setBusy(false);
      return;
    }
    await silentCheck();
    track.login("phone");
    setBusy(false);
    onSuccess?.();
  };

  if (step === "otp") {
    return (
      <div className="auth-form">
        <div className="auth-phone-step">
          <button type="button" className="auth-phone-back"
            onClick={() => { setStep("phone"); setOtp(["","","","","",""]); }}>
            ← Back
          </button>
          <span>OTP sent to +91-{phone}</span>
        </div>
        <div className="auth-otp-group">
          {otp.map((v, i) => (
            <input key={i} ref={el => otpRefs.current[i] = el}
              type="text" inputMode="numeric" className="auth-otp-input"
              maxLength={1} value={v}
              onChange={e => handleOtpChange(i, e.target.value)}
              onKeyDown={e => handleOtpKey(i, e)}
              disabled={busy}
            />
          ))}
        </div>
        {err && <div className="auth-error" role="alert"><span className="auth-error-icon">✕</span> {err}</div>}
        <button className="auth-btn" type="button" onClick={handleVerify}
          disabled={busy || otp.join("").length < 6}>
          {busy ? <><span className="auth-spinner" /> Verifying…</> : "Verify & Sign in →"}
        </button>
        <button type="button" className="auth-link" style={{ alignSelf: "center", marginTop: 4 }}
          onClick={handleSend} disabled={sending}>
          Resend OTP
        </button>
      </div>
    );
  }

  return (
    <div className="auth-form">
      <div className="auth-field">
        <label className="auth-label" htmlFor="li-phone">Mobile number</label>
        <div className="auth-phone-wrap">
          <div className="auth-phone-prefix">+91</div>
          <input
            id="li-phone" type="tel" className="auth-input auth-phone-input"
            placeholder="9876543210"
            value={phone} onChange={e => setPhone(e.target.value.replace(/\D/g, "").slice(0,10))}
            inputMode="numeric" autoComplete="tel-national"
            disabled={sending || busy} autoFocus
          />
        </div>
      </div>
      {err && <div className="auth-error" role="alert"><span className="auth-error-icon">✕</span> {err}</div>}
      <button className="auth-btn" type="button" onClick={handleSend}
        disabled={phone.length < 10 || sending || busy}>
        {sending ? <><span className="auth-spinner" /> Sending OTP…</> : "Send OTP →"}
      </button>
    </div>
  );
}

// ── Root LoginPage ────────────────────────────────────────────────────────────
export default function LoginPage({ onSuccess, onSignup, onForgot, context } = {}) {
  const inElectron = isElectronShell();
  // In Electron: lock to email — Google/Phone OAuth cannot complete inside BrowserWindow
  const [method, setMethod] = useState("email");
  const [busy,   setBusy]   = useState(false);

  const isFresh = context === "fresh";

  return (
    <div className="auth-page">
      <div id="recaptcha-container" />

      <div className="auth-card">
        {/* Brand */}
        <div className="auth-brand">
          <div className="auth-logo">O</div>
          <div className="auth-brand-text">
            <span className="auth-brand-name">Ooplix</span>
            <span className="auth-brand-sub">AI Operating System</span>
          </div>
        </div>

        {isFresh ? (
          <>
            <div style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "10px 12px", borderRadius: 8, marginBottom: 12,
              background: "rgba(82,214,138,0.07)",
              border: "1px solid rgba(82,214,138,0.20)",
            }}>
              <span style={{ color: "#52d68a", fontSize: 13 }}>✓</span>
              <span style={{ fontSize: 12.5, color: "#dde2ec" }}>Account created — sign in to access your workspace.</span>
            </div>
            <h1 className="auth-heading">Sign in</h1>
          </>
        ) : (
          <h1 className="auth-heading">Welcome back</h1>
        )}

        <p className="auth-sub">Sign in to your Ooplix workspace</p>

        {/* Method tabs — Google and Phone hidden in Electron (OAuth popups unsupported) */}
        <div className="auth-tabs" role="tablist">
          <button
            className={`auth-tab${method === "email" ? " auth-tab--active" : ""}`}
            onClick={() => setMethod("email")} disabled={busy}
            role="tab" aria-selected={method === "email"}>
            ✉ Email
          </button>
          {!inElectron && (
            <button
              className={`auth-tab${method === "google" ? " auth-tab--active" : ""}`}
              onClick={() => setMethod("google")} disabled={busy}
              role="tab" aria-selected={method === "google"}>
              <GoogleIcon /> Google
            </button>
          )}
          {!inElectron && (
            <button
              className={`auth-tab${method === "phone" ? " auth-tab--active" : ""}`}
              onClick={() => setMethod("phone")} disabled={busy}
              role="tab" aria-selected={method === "phone"}>
              <PhoneIcon /> Phone
            </button>
          )}
        </div>

        {method === "email"  && (
          <EmailLoginForm
            onSuccess={onSuccess}
            onSignup={onSignup}
            onForgot={onForgot}
            busy={busy}
            setBusy={setBusy}
          />
        )}
        {method === "google" && !inElectron && <GoogleLoginButton onSuccess={onSuccess} busy={busy} setBusy={setBusy} />}
        {method === "phone"  && !inElectron && <PhoneLoginForm    onSuccess={onSuccess} busy={busy} setBusy={setBusy} />}

        {/* Electron-only notice: steer users to web for social login */}
        {inElectron && (
          <div className="auth-not-configured" style={{ marginTop: 12 }}>
            Google &amp; Phone sign-in are available on the web version at{" "}
            <strong>app.ooplix.com</strong>
          </div>
        )}

        {/* Footer */}
        <div className="auth-footer">
          {onSignup && (
            <p className="auth-footer-text">
              No account?{" "}
              <button type="button" className="auth-link" onClick={onSignup} disabled={busy}>
                Create one free →
              </button>
            </p>
          )}
          <p className="auth-footer-text">
            Need help?{" "}
            <a href="mailto:support@ooplix.com" className="auth-link">
              support@ooplix.com
            </a>
          </p>
          <p className="auth-footer-company">ALWALIY TECHNOLOGIES PRIVATE LIMITED</p>
        </div>
      </div>
    </div>
  );
}
