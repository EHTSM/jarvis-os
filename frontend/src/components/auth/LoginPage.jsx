import React, { useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import "./LoginPage.css";

export default function LoginPage() {
  const { login }   = useAuth();
  const [pw,  setPw]     = useState("");
  const [err, setErr]    = useState("");
  const [busy, setBusy]  = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!pw.trim() || busy) return;
    setBusy(true);
    setErr("");
    const result = await login(pw);
    if (!result.success) setErr(result.error || "Invalid password");
    setBusy(false);
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">J</div>
        <h1 className="login-title">JARVIS Runtime</h1>
        <p className="login-subtitle">Operator access required</p>
        <form className="login-form" onSubmit={handleSubmit}>
          <input
            type="password"
            className="login-input"
            placeholder="Operator password"
            value={pw}
            onChange={e => setPw(e.target.value)}
            autoFocus
            disabled={busy}
            autoComplete="current-password"
          />
          {err && <p className="login-error">{err}</p>}
          <button
            type="submit"
            className="login-btn"
            disabled={busy || !pw.trim()}
          >
            {busy ? "Authenticating…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
