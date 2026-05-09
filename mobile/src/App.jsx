import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import { AuthProvider, useAuth } from "./context/AuthContext.jsx";
import { ToastProvider }         from "./context/ToastContext.jsx";

import BottomNav     from "./components/BottomNav.jsx";
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

// Single router component — reads auth state, renders the right tree
function AppRouter() {
  const { user } = useAuth();

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
    <AuthProvider>
      <ToastProvider>
        <BrowserRouter>
          <AppRouter />
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}
