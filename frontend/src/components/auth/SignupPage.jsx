import React, { useState, useCallback, useEffect, useRef } from "react";
import { registerAccount, firebaseSession } from "../../authApi";
import {
  firebaseSignUpEmail,
  firebaseSignInGoogle,
  sendPhoneOtp,
  verifyPhoneOtp,
  setupRecaptcha,
  isFirebaseConfigured,
  isElectronShell,
} from "../../firebaseService";
import { track } from "../../analytics";
import { useAuth } from "../../contexts/AuthContext";
import "./AuthCard.css";

// ── Password strength ─────────────────────────────────────────────────────────
function _strength(pw) {
  if (!pw) return 0;
  let s = 0;
  if (pw.length >= 8)              s++;
  if (pw.length >= 12)             s++;
  if (/[A-Z]/.test(pw))           s++;
  if (/[0-9!@#$%^&*]/.test(pw))  s++;
  return Math.min(s, 4);
}
const STRENGTH_LABELS = ["", "Weak", "Fair", "Good", "Strong"];

// ── Email validation ──────────────────────────────────────────────────────────
function _validateEmail(email, password, name) {
  if (!name.trim())  return "Please enter your name.";
  if (!email.trim()) return "Please enter your email address.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim().toLowerCase()))
    return "Please enter a valid email address.";
  if (password.length < 8) return "Password must be at least 8 characters.";
  return null;
}

// ── Google SVG icon ───────────────────────────────────────────────────────────
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

// ── Phone icon ────────────────────────────────────────────────────────────────
function PhoneIcon() {
  return (
    <svg className="auth-social-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.61 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.18 6.18l.96-.85a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
    </svg>
  );
}

// ── Email Signup form ─────────────────────────────────────────────────────────
function EmailSignupForm({ onSuccess, onLogin, busy, setBusy }) {
  const { login } = useAuth();
  const [name,     setName]     = useState("");
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [showPw,   setShowPw]   = useState(false);
  const [err,      setErr]      = useState("");
  const strength = _strength(password);

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    if (busy) return;
    const vErr = _validateEmail(email, password, name);
    if (vErr) { setErr(vErr); return; }

    setBusy(true);
    setErr("");

    // Attempt Firebase account creation — non-blocking.
    // If Firebase is unconfigured, unreachable, or returns a non-fatal error
    // we fall through to the backend (source of truth for trial + billing).
    // The only hard stop is a definitive duplicate-email error from Firebase.
    if (isFirebaseConfigured()) {
      const fbRes = await firebaseSignUpEmail(email.trim().toLowerCase(), password, name.trim());
      if (!fbRes.success &&
          fbRes.error !== "firebase_not_configured" &&
          !fbRes.error?.includes("Network error") &&
          !fbRes.error?.includes("internal error")) {
        if (fbRes.error?.includes("already exists")) {
          setErr("An account with this email already exists. Sign in instead?");
          setBusy(false);
          return;
        }
        // For all other Firebase errors (weak password etc.) surface them
        setErr(fbRes.error);
        setBusy(false);
        return;
      }
    }

    // Always create backend account (source of truth for trial + billing)
    const reg = await registerAccount({
      email:    email.trim().toLowerCase(),
      password,
      name:     name.trim(),
    });
    if (!reg?.success) {
      setErr(reg?.error || "Could not create account. Please try again.");
      setBusy(false);
      return;
    }

    // Auto-login via AuthContext (sets user state + broadcasts to other tabs)
    const loggedIn = await login(password, email.trim().toLowerCase());
    if (!loggedIn?.success) {
      setErr("Account created — please sign in.");
      setBusy(false);
      onLogin?.();
      return;
    }
    track.event("signup_completed_with_account", { method: "email" });
    setBusy(false);
    onSuccess?.();
  }, [busy, email, password, name, login, onSuccess, onLogin, setBusy]);

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <div className="auth-field">
        <label className="auth-label" htmlFor="su-name">Full name</label>
        <input
          id="su-name" type="text" className="auth-input"
          placeholder="Aarav Shah"
          value={name} onChange={e => setName(e.target.value)}
          disabled={busy} autoComplete="name" autoCapitalize="words" autoFocus required
        />
      </div>

      <div className="auth-field">
        <label className="auth-label" htmlFor="su-email">Work email</label>
        <input
          id="su-email" type="email" className="auth-input"
          placeholder="you@company.com"
          value={email} onChange={e => setEmail(e.target.value)}
          disabled={busy} autoComplete="email" inputMode="email" required
        />
      </div>

      <div className="auth-field">
        <label className="auth-label" htmlFor="su-pw">Password</label>
        <div className="auth-pw-wrap">
          <input
            id="su-pw" type={showPw ? "text" : "password"} className="auth-input"
            placeholder="Min. 8 characters"
            value={password} onChange={e => setPassword(e.target.value)}
            disabled={busy} autoComplete="new-password" required
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

      {err && (
        <div className="auth-error" role="alert">
          <span className="auth-error-icon">✕</span> {err}
        </div>
      )}

      <button type="submit" className="auth-btn"
        disabled={busy || !email.trim() || !password || !name.trim()}>
        {busy ? <><span className="auth-spinner" /> Creating account…</> : "Start free trial →"}
      </button>
    </form>
  );
}

// ── Google Signup ─────────────────────────────────────────────────────────────
function GoogleSignupButton({ onSuccess, onLogin, busy, setBusy }) {
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
        ℹ Google Sign-Up is not available in the desktop app. Use the web version at{" "}
        <strong>app.ooplix.com</strong> or sign up with email.
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

    const { user: fbUser, idToken } = fbRes;

    // Exchange Firebase token for a backend session cookie.
    // /auth/firebase-session auto-registers the account on first login.
    const sessionRes = await firebaseSession({
      idToken,
      email:    fbUser.email,
      name:     fbUser.displayName || fbUser.email.split("@")[0],
      provider: "google",
    });
    if (!sessionRes.success) {
      setErr(sessionRes.error || "Sign-up failed. Please try again.");
      setBusy(false);
      return;
    }
    await silentCheck();
    track.event("signup_completed_with_account", { method: "google" });
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

// ── Phone OTP Signup ──────────────────────────────────────────────────────────
function PhoneSignupForm({ onSuccess, busy, setBusy }) {
  const { silentCheck } = useAuth();
  const [phone,       setPhone]       = useState("");
  const [otp,         setOtp]         = useState(["", "", "", "", "", ""]);
  const [step,        setStep]        = useState("phone"); // phone | otp
  const [confirmation, setConfirmation] = useState(null);
  const [err,         setErr]         = useState("");
  const [sending,     setSending]     = useState(false);
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
        ℹ Phone Sign-Up is not available in the desktop app. Use the web version at{" "}
        <strong>app.ooplix.com</strong> or sign up with email.
      </div>
    );
  }

  const handleSendOtp = async () => {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) { setErr("Please enter a valid 10-digit mobile number."); return; }
    setSending(true);
    setErr("");
    const fullPhone = `+91${digits}`;
    const res = await sendPhoneOtp(fullPhone, "recaptcha-container");
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
    if (e.key === "Backspace" && !otp[idx] && idx > 0) {
      otpRefs.current[idx - 1]?.focus();
    }
  };

  const handleVerify = async () => {
    const code = otp.join("");
    if (code.length < 6) { setErr("Please enter the 6-digit OTP."); return; }
    setBusy(true);
    setErr("");

    const res = await verifyPhoneOtp(confirmation, code);
    if (!res.success) { setErr(res.error); setBusy(false); return; }

    const { user: fbUser, idToken: phoneIdToken } = res;

    // Exchange Firebase token for backend session cookie (auto-registers on first login)
    const sessionRes = await firebaseSession({
      idToken:  phoneIdToken,
      email:    `phone_${fbUser.uid}@ooplix.app`,
      name:     fbUser.phone || fbUser.uid.slice(0, 8),
      provider: "phone",
    });
    if (!sessionRes.success) {
      setErr(sessionRes.error || "Could not create account. Please try again.");
      setBusy(false);
      return;
    }
    await silentCheck();
    track.event("signup_completed_with_account", { method: "phone" });
    setBusy(false);
    onSuccess?.();
  };

  if (step === "otp") {
    return (
      <div className="auth-form">
        <div className="auth-phone-step">
          <button type="button" className="auth-phone-back" onClick={() => { setStep("phone"); setOtp(["","","","","",""]); }}>
            ← Back
          </button>
          <span>OTP sent to +91-{phone}</span>
        </div>
        <p className="auth-sub" style={{ marginBottom: 12 }}>
          Enter the 6-digit code sent to your number.
        </p>
        <div className="auth-otp-group">
          {otp.map((v, i) => (
            <input
              key={i}
              ref={el => otpRefs.current[i] = el}
              type="text" inputMode="numeric"
              className="auth-otp-input"
              maxLength={1} value={v}
              onChange={e => handleOtpChange(i, e.target.value)}
              onKeyDown={e => handleOtpKey(i, e)}
              disabled={busy}
            />
          ))}
        </div>
        {err && <div className="auth-error" role="alert"><span className="auth-error-icon">✕</span> {err}</div>}
        <button className="auth-btn" onClick={handleVerify} disabled={busy || otp.join("").length < 6} type="button">
          {busy ? <><span className="auth-spinner" /> Verifying…</> : "Verify & Continue →"}
        </button>
        <button type="button" className="auth-link" style={{ alignSelf: "center", marginTop: 4 }}
          onClick={handleSendOtp} disabled={sending}>
          Resend OTP
        </button>
      </div>
    );
  }

  return (
    <div className="auth-form">
      <div className="auth-field">
        <label className="auth-label" htmlFor="su-phone">Mobile number</label>
        <div className="auth-phone-wrap">
          <div className="auth-phone-prefix">+91</div>
          <input
            id="su-phone" type="tel" className="auth-input auth-phone-input"
            placeholder="9876543210"
            value={phone} onChange={e => setPhone(e.target.value.replace(/\D/g, "").slice(0,10))}
            inputMode="numeric" autoComplete="tel-national"
            disabled={sending || busy} autoFocus
          />
        </div>
      </div>
      {err && <div className="auth-error" role="alert"><span className="auth-error-icon">✕</span> {err}</div>}
      <button className="auth-btn" type="button" onClick={handleSendOtp}
        disabled={phone.length < 10 || sending || busy}>
        {sending ? <><span className="auth-spinner" /> Sending OTP…</> : "Send OTP →"}
      </button>
    </div>
  );
}

// ── Root SignupPage ────────────────────────────────────────────────────────────
export default function SignupPage({ onSuccess, onLogin, onLegal }) {
  const inElectron = isElectronShell();
  // In Electron: lock to email — Google/Phone OAuth cannot complete inside BrowserWindow
  const [method, setMethod] = useState("email"); // email | google | phone
  const [busy,   setBusy]   = useState(false);

  return (
    <div className="auth-page">
      {/* Invisible reCAPTCHA mount point */}
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

        <h1 className="auth-heading">Create your account</h1>
        <p className="auth-sub">7-day free trial · No credit card required</p>

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

        {/* Method panel */}
        {method === "email"  && <EmailSignupForm  onSuccess={onSuccess} onLogin={onLogin} busy={busy} setBusy={setBusy} onLegal={onLegal} />}
        {method === "google" && !inElectron && <GoogleSignupButton onSuccess={onSuccess} onLogin={onLogin} busy={busy} setBusy={setBusy} />}
        {method === "phone"  && !inElectron && <PhoneSignupForm  onSuccess={onSuccess} busy={busy} setBusy={setBusy} />}

        {/* Electron-only notice: steer users to web for social signup */}
        {inElectron && (
          <div className="auth-not-configured" style={{ marginTop: 12 }}>
            Google &amp; Phone sign-up are available on the web version at{" "}
            <strong>app.ooplix.com</strong>
          </div>
        )}

        {/* Trust strip */}
        <div className="auth-trust">
          <span className="auth-trust-item"><span className="auth-trust-check">✓</span> 7-day free trial</span>
          <span className="auth-trust-sep">·</span>
          <span className="auth-trust-item"><span className="auth-trust-check">✓</span> No credit card</span>
          <span className="auth-trust-sep">·</span>
          <span className="auth-trust-item"><span className="auth-trust-check">✓</span> Cancel anytime</span>
        </div>

        {/* Footer */}
        <div className="auth-footer">
          <p className="auth-footer-text">
            Already have an account?{" "}
            <button type="button" className="auth-link" onClick={onLogin} disabled={busy}>
              Sign in →
            </button>
          </p>
          <p className="auth-footer-text" style={{ fontSize: 11 }}>
            By signing up you agree to our{" "}
            <button type="button" className="auth-link" style={{ fontSize: 11 }} onClick={() => onLegal?.("terms")}>Terms</button>
            {" "}and{" "}
            <button type="button" className="auth-link" style={{ fontSize: 11 }} onClick={() => onLegal?.("privacy")}>Privacy Policy</button>.
          </p>
          <p className="auth-footer-company">ALWALIY TECHNOLOGIES PRIVATE LIMITED</p>
        </div>
      </div>
    </div>
  );
}
