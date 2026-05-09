import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { signIn, resetPassword } from "../firebase.js";
import { useToast } from "../context/ToastContext.jsx";

export default function Login() {
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");
  const navigate = useNavigate();
  const toast    = useToast();

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    if (!email.trim() || !password) { setError("Email and password are required."); return; }

    setLoading(true);
    try {
      await signIn(email.trim(), password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(_friendlyError(err.code));
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    if (!email.trim()) { setError("Enter your email to reset password."); return; }
    try {
      await resetPassword(email.trim());
      toast.show("Reset email sent — check your inbox.", "success");
    } catch (err) {
      setError(_friendlyError(err.code));
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-logo">J</div>
      <h1 className="auth-title">Welcome back</h1>
      <p className="auth-sub">Sign in to your JARVIS AI account</p>

      <form className="auth-form" onSubmit={handleLogin}>
        <div className="form-group">
          <label className="form-label">Email</label>
          <input
            className="input-field"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            autoComplete="email"
            inputMode="email"
          />
        </div>

        <div className="form-group">
          <label className="form-label">Password</label>
          <input
            className="input-field"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="current-password"
          />
          {error && <p className="form-error">{error}</p>}
        </div>

        <button className="btn btn-primary" type="submit" disabled={loading}>
          {loading ? "Signing in…" : "Sign In"}
        </button>

        <div style={{ textAlign: "right", marginTop: 12 }}>
          <button type="button" className="btn-ghost" onClick={handleReset}>
            Forgot password?
          </button>
        </div>
      </form>

      <p className="auth-footer">
        Don't have an account?{" "}
        <Link to="/signup" style={{ color: "var(--accent)", fontWeight: 600 }}>
          Sign up free
        </Link>
      </p>
    </div>
  );
}

function _friendlyError(code) {
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Invalid email or password.";
    case "auth/too-many-requests":
      return "Too many attempts. Try again later.";
    case "auth/user-disabled":
      return "Account disabled. Contact support.";
    case "auth/network-request-failed":
      return "Network error. Check your connection.";
    default:
      return "Sign-in failed. Please try again.";
  }
}
