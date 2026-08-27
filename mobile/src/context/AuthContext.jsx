import React, { createContext, useContext, useState, useEffect } from "react";
import { onAuth } from "../firebase";
import { establishSession, clearSession } from "../api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user,        setUser]        = useState(undefined); // undefined = loading
  const [profile,     setProfile]     = useState(null);
  const [sessionError, setSessionError] = useState(null); // { error, code } | null
  // Mission 58: /api/auth/firebase-session already returns the account's
  // real backend role (operator | user) — previously discarded by
  // establishSession(). Surfaced here so screens can gate operator-only
  // features (CRM, Insights dashboard — see Mission 55/56) up front instead
  // of only discovering the 403 after a failed request.
  const [role, setRole] = useState(null);

  useEffect(() => {
    // Mission 45: onAuth fires whenever Firebase's own auth state changes —
    // sign-in, sign-up, sign-out, and a restored session on app launch all
    // land here, which makes this the single choke point to also establish
    // (or tear down) the JARVIS backend session that every API call in
    // api.js now depends on, instead of duplicating the exchange call in
    // Login.jsx/Signup.jsx separately.
    const unsub = onAuth(async u => {
      setUser(u || null);
      if (u) {
        setSessionError(null);
        const result = await establishSession(u);
        if (!result.success) {
          // A denied org policy (e.g. mfa_required, provider_not_allowed)
          // must not be silently swallowed — the user is Firebase-signed-in
          // but has no working JARVIS session, so every API call would 401.
          // Surface it via sessionError rather than pretending sign-in
          // succeeded; the app has no MFA-challenge UI of its own (that is
          // out of scope for this mission), so this is disclosed, not hidden.
          setSessionError({ error: result.error, code: result.code });
          setRole(null);
        } else {
          setRole(result.role || null);
        }
      } else {
        clearSession();
        setSessionError(null);
        setRole(null);
      }
    });
    return unsub;
  }, []);

  return (
    <AuthContext.Provider value={{ user, profile, setProfile, sessionError, role }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
