/**
 * Ooplix Firebase Service
 *
 * Provides Email/Password, Google Sign-In, and Phone OTP authentication.
 * All methods return { success, user?, idToken?, error? } — never throw.
 *
 * Graceful degradation: if REACT_APP_FIREBASE_API_KEY is not set, every
 * auth method returns { success: false, error: "firebase_not_configured" }
 * and the UI shows a "not available" state instead of crashing.
 *
 * Required env vars (add to frontend/.env.local):
 *   REACT_APP_FIREBASE_API_KEY
 *   REACT_APP_FIREBASE_AUTH_DOMAIN
 *   REACT_APP_FIREBASE_PROJECT_ID
 *   REACT_APP_FIREBASE_STORAGE_BUCKET
 *   REACT_APP_FIREBASE_MESSAGING_SENDER_ID
 *   REACT_APP_FIREBASE_APP_ID
 */

import { initializeApp, getApps } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  PhoneAuthProvider,
  RecaptchaVerifier,
  signInWithPopup,
  signInWithPhoneNumber,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
  linkWithCredential,
  fetchSignInMethodsForEmail,
  signOut as fbSignOut,
  onAuthStateChanged,
} from "firebase/auth";

// ── Config check ──────────────────────────────────────────────────────────────
const _configured = !!(
  process.env.REACT_APP_FIREBASE_API_KEY &&
  process.env.REACT_APP_FIREBASE_AUTH_DOMAIN &&
  process.env.REACT_APP_FIREBASE_PROJECT_ID
);

const _NOT_CONFIGURED = { success: false, error: "firebase_not_configured" };

// ── Electron detection ────────────────────────────────────────────────────────
// True when running inside the Electron BrowserWindow (preload sets isElectron).
// Google OAuth popups can't redirect to firebaseapp.com from file:// origin, so
// we surface a clear error rather than opening a broken popup.
function _isElectron() {
  return !!(window.electronAPI?.isElectron);
}

// ── Firebase init (idempotent) ────────────────────────────────────────────────
let _auth = null;

function _getAuth() {
  if (!_configured) return null;
  if (_auth) return _auth;

  const config = {
    apiKey:            process.env.REACT_APP_FIREBASE_API_KEY,
    authDomain:        process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
    projectId:         process.env.REACT_APP_FIREBASE_PROJECT_ID,
    storageBucket:     process.env.REACT_APP_FIREBASE_STORAGE_BUCKET     || "",
    messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID || "",
    appId:             process.env.REACT_APP_FIREBASE_APP_ID              || "",
  };

  const app = getApps().length ? getApps()[0] : initializeApp(config);
  _auth = getAuth(app);
  return _auth;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function _idToken(fbUser) {
  try { return await fbUser.getIdToken(); } catch { return null; }
}

function _normalize(fbUser) {
  return {
    uid:         fbUser.uid,
    email:       fbUser.email       || null,
    displayName: fbUser.displayName || null,
    phone:       fbUser.phoneNumber || null,
    photoURL:    fbUser.photoURL    || null,
    provider:    fbUser.providerData?.[0]?.providerId || "unknown",
  };
}

// ── Email / Password ──────────────────────────────────────────────────────────

/**
 * Create a new Firebase email account and return the user + ID token.
 * Does NOT call the backend /accounts/register — that stays as the source of truth
 * for trial creation. Call registerAccount() after this succeeds.
 */
export async function firebaseSignUpEmail(email, password, displayName) {
  const auth = _getAuth();
  if (!auth) return _NOT_CONFIGURED;
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    if (displayName) await updateProfile(cred.user, { displayName });
    const idToken = await _idToken(cred.user);
    return { success: true, user: _normalize(cred.user), idToken, isNew: true };
  } catch (err) {
    return { success: false, error: _mapError(err.code) };
  }
}

/**
 * Sign in with Firebase email + password.
 */
export async function firebaseSignInEmail(email, password) {
  const auth = _getAuth();
  if (!auth) return _NOT_CONFIGURED;
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    const idToken = await _idToken(cred.user);
    return { success: true, user: _normalize(cred.user), idToken };
  } catch (err) {
    return { success: false, error: _mapError(err.code) };
  }
}

/**
 * Send Firebase password reset email.
 */
export async function firebaseForgotPassword(email) {
  const auth = _getAuth();
  if (!auth) return _NOT_CONFIGURED;
  try {
    await sendPasswordResetEmail(auth, email);
    return { success: true };
  } catch (err) {
    // user-not-found must be passed back as a distinct code (not mapped message)
    // so ForgotPassword.jsx can treat it as success for anti-enumeration.
    if (err.code === "auth/user-not-found" || err.code === "auth/invalid-credential") {
      return { success: false, code: "user-not-found", error: _mapError("auth/user-not-found") };
    }
    return { success: false, error: _mapError(err.code) };
  }
}

// ── Google Sign-In ────────────────────────────────────────────────────────────

/**
 * Open Google Sign-In popup.
 * Returns { success, user, idToken, isNew } where isNew = first-time signup.
 */
export async function firebaseSignInGoogle() {
  const auth = _getAuth();
  if (!auth) return _NOT_CONFIGURED;

  // Google OAuth popup cannot complete inside Electron BrowserWindow —
  // the OAuth redirect back to firebaseapp.com is blocked by the file:// origin.
  // Surface a clear, actionable message instead of a broken popup.
  if (_isElectron()) {
    return {
      success: false,
      error: "Google Sign-In is not supported in the desktop app. Use email/password or open the web version at app.ooplix.com.",
    };
  }

  try {
    const provider = new GoogleAuthProvider();
    provider.addScope("email");
    provider.addScope("profile");
    provider.setCustomParameters({ prompt: "select_account" });

    const result    = await signInWithPopup(auth, provider);
    const idToken   = await _idToken(result.user);
    const isNew     = result._tokenResponse?.isNewUser ?? false;
    return { success: true, user: _normalize(result.user), idToken, isNew };
  } catch (err) {
    if (err.code === "auth/popup-closed-by-user" ||
        err.code === "auth/cancelled-popup-request") {
      return { success: false, error: "cancelled" };
    }
    return { success: false, error: _mapError(err.code) };
  }
}

// ── Phone OTP ─────────────────────────────────────────────────────────────────

// Module-level verifier so it's not recreated on every call
let _recaptchaVerifier = null;

/**
 * Set up invisible reCAPTCHA on a DOM element.
 * Call once per page load before sendPhoneOtp().
 * containerId: the DOM element id to attach reCAPTCHA to.
 */
export function setupRecaptcha(containerId = "recaptcha-container") {
  const auth = _getAuth();
  if (!auth) return null;

  if (_recaptchaVerifier) {
    try { _recaptchaVerifier.clear(); } catch (_) {}
  }

  _recaptchaVerifier = new RecaptchaVerifier(auth, containerId, {
    size: "invisible",
    callback: () => {},
    "expired-callback": () => {
      _recaptchaVerifier = null;
    },
  });
  return _recaptchaVerifier;
}

/**
 * Send OTP to phoneNumber (E.164 format: +919876543210).
 * Returns { success, confirmationResult } on success.
 */
export async function sendPhoneOtp(phoneNumber, containerId = "recaptcha-container") {
  const auth = _getAuth();
  if (!auth) return _NOT_CONFIGURED;
  try {
    if (!_recaptchaVerifier) setupRecaptcha(containerId);
    const confirmationResult = await signInWithPhoneNumber(auth, phoneNumber, _recaptchaVerifier);
    return { success: true, confirmationResult };
  } catch (err) {
    _recaptchaVerifier = null; // reset on failure so it can be retried
    return { success: false, error: _mapError(err.code) };
  }
}

/**
 * Verify OTP code. Pass the confirmationResult from sendPhoneOtp().
 * Returns { success, user, idToken, isNew }.
 */
export async function verifyPhoneOtp(confirmationResult, otpCode) {
  if (!confirmationResult) return { success: false, error: "No OTP session. Request a new code." };
  try {
    const result  = await confirmationResult.confirm(otpCode);
    const idToken = await _idToken(result.user);
    const isNew   = result._tokenResponse?.isNewUser ?? false;
    return { success: true, user: _normalize(result.user), idToken, isNew };
  } catch (err) {
    return { success: false, error: _mapError(err.code) };
  }
}

// ── Sign Out ──────────────────────────────────────────────────────────────────

export async function firebaseSignOut() {
  const auth = _getAuth();
  if (!auth) return { success: true }; // no-op when unconfigured
  try {
    await fbSignOut(auth);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ── Auth state listener ───────────────────────────────────────────────────────

/**
 * Subscribe to Firebase auth state changes.
 * Returns unsubscribe function.
 */
export function onFirebaseAuthState(callback) {
  const auth = _getAuth();
  if (!auth) { callback(null); return () => {}; }
  return onAuthStateChanged(auth, callback);
}

// ── Config status ─────────────────────────────────────────────────────────────

/** True if Firebase env vars are set. Use to gate UI options. */
export function isFirebaseConfigured() {
  return _configured;
}

/** True when running inside the Electron desktop shell. */
export function isElectronShell() {
  return _isElectron();
}

// ── Error message map ─────────────────────────────────────────────────────────

function _mapError(code) {
  const MAP = {
    "auth/invalid-email":                 "Please enter a valid email address.",
    "auth/user-disabled":                 "This account has been disabled.",
    "auth/user-not-found":                "No account found with this email.",
    "auth/wrong-password":                "Incorrect password. Please try again.",
    "auth/email-already-in-use":          "An account with this email already exists.",
    "auth/weak-password":                 "Password must be at least 6 characters.",
    "auth/network-request-failed":        "Network error. Check your connection.",
    "auth/too-many-requests":             "Too many attempts. Please wait and try again.",
    "auth/invalid-phone-number":          "Please enter a valid phone number with country code.",
    "auth/invalid-verification-code":     "Incorrect OTP code. Please check and retry.",
    "auth/code-expired":                  "OTP expired. Please request a new code.",
    "auth/account-exists-with-different-credential":
      "An account already exists with this email. Try signing in with email/password.",
    "auth/popup-blocked":                 "Popup was blocked. Please allow popups for this site.",
    "auth/operation-not-allowed":         "This sign-in method is not enabled. Contact support.",
    "auth/internal-error":                "An internal error occurred. Please try again.",
    "firebase_not_configured":            "Firebase is not configured on this server.",
  };
  return MAP[code] || "Authentication failed. Please try again.";
}
