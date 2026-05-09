import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { signUp } from "../firebase.js";
import { useToast } from "../context/ToastContext.jsx";

export default function Signup() {
  const [name,     setName]     = useState("");
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");
  const navigate = useNavigate();
  const toast    = useToast();

  const handleSignup = async (e) => {
    e.preventDefault();
    setError("");

    if (!name.trim())         { setError("Please enter your name.");       return; }
    if (!email.trim())        { setError("Please enter your email.");      return; }
    if (password.length < 8)  { setError("Password must be 8+ characters."); return; }
    if (password !== confirm) { setError("Passwords do not match.");       return; }

    setLoading(true);
    try {
      await signUp(email.trim(), password, name.trim());
      toast.show("Account created! Welcome to JARVIS.", "success");
      navigate("/", { replace: true });
    } catch (err) {
      setError(_friendlyError(err.code));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-logo">J</div>
      <h1 className="auth-title">Create account</h1>
      <p className="auth-sub">Start automating your business with JARVIS AI</p>

      <form className="auth-form" onSubmit={handleSignup}>
        <div className="form-group">
          <label className="form-label">Full Name</label>
          <input
            className="input-field"
            type="text"
            placeholder="Your name"
            value={name}
            onChange={e => setName(e.target.value)}
            autoComplete="name"
          />
        </div>

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
            placeholder="Min 8 characters"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="new-password"
          />
        </div>

        <div className="form-group">
          <label className="form-label">Confirm Password</label>
          <input
            className="input-field"
            type="password"
            placeholder="Repeat password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            autoComplete="new-password"
          />
          {error && <p className="form-error">{error}</p>}
        </div>

        <button className="btn btn-primary" type="submit" disabled={loading}>
          {loading ? "Creating account…" : "Create Account"}
        </button>

        <p style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center", marginTop: 12, lineHeight: 1.6 }}>
          By signing up you agree to our{" "}
          <Link to="/terms" style={{ color: "var(--accent)" }}>Terms</Link>{" "}
          and{" "}
          <Link to="/privacy" style={{ color: "var(--accent)" }}>Privacy Policy</Link>.
        </p>
      </form>

      <p className="auth-footer">
        Already have an account?{" "}
        <Link to="/login" style={{ color: "var(--accent)", fontWeight: 600 }}>
          Sign in
        </Link>
      </p>
    </div>
  );
}

function _friendlyError(code) {
  switch (code) {
    case "auth/email-already-in-use":  return "This email is already registered.";
    case "auth/invalid-email":         return "Invalid email address.";
    case "auth/weak-password":         return "Password is too weak. Use 8+ characters.";
    case "auth/network-request-failed":return "Network error. Check your connection.";
    default:                            return "Signup failed. Please try again.";
  }
}
