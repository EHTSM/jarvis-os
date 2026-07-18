import { _fetch } from "./_client";

export async function getAuthStatus() {
  try {
    const data = await _fetch("/auth/me");
    return data.user || null;
  } catch { return null; }
}

// Legacy operator password login (single shared password)
export async function loginOperator(password) {
  try {
    return await _fetch("/auth/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    });
  } catch (err) { return { success: false, error: err.message }; }
}

// Per-user email + password login (P10 identity system)
export async function loginWithEmail(email, password) {
  try {
    return await _fetch("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function logoutOperator() {
  try {
    return await _fetch("/auth/logout", { method: "POST", body: "{}" });
  } catch (err) { return { success: false, error: err.message }; }
}

// Self-serve registration
export async function registerAccount({ email, password, name }) {
  try {
    return await _fetch("/accounts/register", {
      method: "POST",
      body: JSON.stringify({ email, password, name }),
    });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function getMyAccount() {
  try { return await _fetch("/accounts/me"); }
  catch (err) { return { success: false, error: err.message }; }
}

export async function getBillingStatus() {
  try { return await _fetch("/billing/status"); }
  catch (err) { return { success: false, error: err.message }; }
}

export async function upgradeAccount(plan) {
  try {
    return await _fetch("/billing/upgrade", {
      method: "POST",
      body: JSON.stringify({ plan }),
    });
  } catch (err) { return { success: false, error: err.message }; }
}

// Exchange a Firebase ID token for a backend session cookie.
// Works for Google, Phone, and Email OAuth flows.
export async function firebaseSession({ idToken, email, name, provider }) {
  try {
    return await _fetch("/auth/firebase-session", {
      method: "POST",
      body: JSON.stringify({ idToken, email, name, provider }),
    });
  } catch (err) { return { success: false, error: err.message }; }
}

// Re-issue a fresh session cookie for an already-authenticated user.
export async function refreshSession() {
  try {
    return await _fetch("/auth/refresh", { method: "POST", body: "{}" });
  } catch (err) { return { success: false, error: err.message }; }
}

// Backend password reset (works for email/password accounts, not just Firebase).
// Always returns success:true to avoid leaking whether an email is registered.
export async function requestPasswordReset(email) {
  try {
    return await _fetch("/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function confirmPasswordReset(token, password) {
  try {
    return await _fetch("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token, password }),
    });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function confirmEmailVerification(token) {
  try {
    return await _fetch(`/auth/verify-email?token=${encodeURIComponent(token)}`);
  } catch (err) { return { success: false, error: err.message }; }
}

export async function resendVerificationEmail() {
  try {
    return await _fetch("/accounts/resend-verification", { method: "POST", body: "{}" });
  } catch (err) { return { success: false, error: err.message }; }
}
