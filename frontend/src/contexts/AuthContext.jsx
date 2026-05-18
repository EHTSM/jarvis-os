import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { getAuthStatus, loginOperator, logoutOperator, setOn401 } from "../api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAuthStatus().then(u => {
      setUser(u || null);
      setLoading(false);
    });
  }, []);

  // Global 401 interceptor — any API call returning 401 clears the session.
  // Covers token expiry detected from any component, not just OperatorConsole.
  useEffect(() => {
    setOn401(() => setUser(null));
    return () => setOn401(null);
  }, []);

  const login = useCallback(async (password) => {
    const result = await loginOperator(password);
    if (result.success) setUser({ role: result.role || "operator" });
    return result;
  }, []);

  const logout = useCallback(async () => {
    await logoutOperator();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
