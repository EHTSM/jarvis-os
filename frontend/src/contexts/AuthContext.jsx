import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { getAuthStatus, loginOperator, logoutOperator, setOn401 } from "../api";
import { loginWithEmail, refreshSession } from "../authApi";

const AuthContext = createContext(null);

// BroadcastChannel for multi-tab auth sync (login/logout mirrors instantly across tabs)
const _bc = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("jarvis_auth_sync") : null;

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [sessionExpiring, setSessionExpiring] = useState(false);
  const silentRetryRef = useRef(null);
  const expiryWarnRef  = useRef(null);

  const _setUserAndBroadcast = useCallback((u, event = "state") => {
    setUser(u);
    _bc?.postMessage({ event, user: u });
  }, []);

  // Silent re-auth check: verify session is still valid every 5 minutes
  // If 401 comes back, clears user — no hard redirect, just shows login overlay
  const silentCheck = useCallback(async () => {
    const u = await getAuthStatus();
    if (!u) {
      if (user) _setUserAndBroadcast(null, "expired");
      setSessionExpiring(false);
    } else {
      _setUserAndBroadcast(u, "login");
      setSessionExpiring(false);
    }
  }, [user, _setUserAndBroadcast]);

  useEffect(() => {
    getAuthStatus().then(u => {
      setUser(u || null);
      setLoading(false);
    });
  }, []);

  // Periodic silent check every 5 min
  useEffect(() => {
    if (!user) return;
    silentRetryRef.current = setInterval(silentCheck, 5 * 60_000);
    return () => clearInterval(silentRetryRef.current);
  }, [user, silentCheck]);

  // Session expiry warning: show banner 5 min before 8h session ends
  useEffect(() => {
    if (!user) { clearTimeout(expiryWarnRef.current); setSessionExpiring(false); return; }
    const SESSION_MS = 8 * 60 * 60 * 1000;
    const WARN_MS    = 5 * 60 * 1000;
    clearTimeout(expiryWarnRef.current);
    expiryWarnRef.current = setTimeout(() => setSessionExpiring(true), SESSION_MS - WARN_MS);
    return () => clearTimeout(expiryWarnRef.current);
  }, [user]);

  // Global 401 interceptor
  useEffect(() => {
    setOn401(() => { _setUserAndBroadcast(null, "expired"); });
    return () => setOn401(null);
  }, [_setUserAndBroadcast]);

  // Multi-tab sync: receive auth events from other tabs
  useEffect(() => {
    if (!_bc) return;
    const handler = (e) => {
      if (e.data?.event === "login")   setUser(e.data.user);
      if (e.data?.event === "logout")  setUser(null);
      if (e.data?.event === "expired") setUser(null);
    };
    _bc.addEventListener("message", handler);
    return () => _bc.removeEventListener("message", handler);
  }, []);

  // login(password) — legacy operator login
  // login(password, email) — per-user email+password login (P10)
  const login = useCallback(async (password, email) => {
    const result = email
      ? await loginWithEmail(email, password)
      : await loginOperator(password);
    if (result.success) {
      const u = { role: result.role || "user", email: result.email || null };
      _setUserAndBroadcast(u, "login");
    }
    return result;
  }, [_setUserAndBroadcast]);

  const logout = useCallback(async () => {
    await logoutOperator();
    _setUserAndBroadcast(null, "logout");
  }, [_setUserAndBroadcast]);

  const refresh = useCallback(async () => {
    const result = await refreshSession();
    if (result.success) {
      const u = await getAuthStatus();
      if (u) _setUserAndBroadcast(u, "login");
      setSessionExpiring(false);
    }
    return result;
  }, [_setUserAndBroadcast]);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refresh, sessionExpiring, silentCheck }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
