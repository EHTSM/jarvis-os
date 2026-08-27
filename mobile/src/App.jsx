import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import { AuthProvider, useAuth } from "./context/AuthContext.jsx";
import { ToastProvider }         from "./context/ToastContext.jsx";
import { endSession }            from "./api.js";
import { signOut }               from "./firebase.js";

import BottomNav     from "./components/BottomNav.jsx";
import ErrorBoundary  from "./components/ErrorBoundary.jsx";
import Login         from "./pages/Login.jsx";
import Signup        from "./pages/Signup.jsx";
import Home          from "./pages/Home.jsx";
import Tools         from "./pages/Tools.jsx";
import Dashboard     from "./pages/Dashboard.jsx";
import Profile       from "./pages/Profile.jsx";
import PrivacyPolicy from "./pages/PrivacyPolicy.jsx";
import Terms         from "./pages/Terms.jsx";

function LoadingScreen() {
  return (
    <div className="loading-screen">
      <div className="spinner" />
      <span style={{ color: "var(--text-dim)", fontSize: 14 }}>Loading…</span>
    </div>
  );
}

// Mission 45: shown when Firebase sign-in succeeded but the JARVIS backend
// session was denied (e.g. the org requires MFA the mobile app has no
// challenge UI for, or disallows this login provider). Per CLAUDE.md §18 —
// never indicate an authenticated/successful state before the backend has
// actually confirmed it — the app must not silently render as if signed in
// when every real API call would 401. Email/password remains a working
// fallback (per the same reasoning the web MFA certification documented).
function SessionDeniedScreen({ error, code, onSignOut }) {
  const message = code === "mfa_required"
    ? "Your organization requires multi-factor authentication, which this app does not yet support. Please sign in from the web app instead."
    : code === "provider_not_allowed"
    ? "Your organization does not allow this sign-in method on mobile."
    : (error || "Could not start a session with the server.");
  return (
    <div className="loading-screen">
      <span style={{ color: "var(--text-dim)", fontSize: 14, textAlign: "center", padding: "0 24px" }}>{message}</span>
      <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={onSignOut}>
        Back to sign in
      </button>
    </div>
  );
}

// Single router component — reads auth state, renders the right tree
function AppRouter() {
  const { user, sessionError } = useAuth();

  // Firebase auth still resolving — show full-screen loader
  if (user === undefined) return <LoadingScreen />;

  // Not signed in — only auth routes available
  if (user === null) {
    return (
      <Routes>
        <Route path="/login"  element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="*"       element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  // Firebase-signed-in but the backend refused a JARVIS session (MFA/provider
  // policy) — do not render the app as if authenticated; see SessionDeniedScreen.
  if (sessionError) {
    return (
      <SessionDeniedScreen
        error={sessionError.error}
        code={sessionError.code}
        onSignOut={async () => {
          await endSession().catch(() => {});
          await signOut().catch(() => {});
        }}
      />
    );
  }

  // Signed in — full app with bottom navigation
  return (
    <div className="app-shell">
      <Routes>
        <Route path="/"        element={<Home />} />
        <Route path="/tools"   element={<Tools />} />
        <Route path="/dash"    element={<Dashboard />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/privacy" element={<PrivacyPolicy />} />
        <Route path="/terms"   element={<Terms />} />
        <Route path="*"        element={<Navigate to="/" replace />} />
      </Routes>
      <BottomNav />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary label="app">
      <AuthProvider>
        <ToastProvider>
          <BrowserRouter>
            <AppRouter />
          </BrowserRouter>
        </ToastProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
