// V6 Phase 8 push device registry — real routes (backend/routes/pushNotifications.js
// -> backend/services/pushNotificationEngine.cjs), previously built with no
// frontend caller. Distinct from MobilePlatformCenter's PUSH_STATS mock
// analytics: this is the real per-account token registry + Firebase
// readiness check.
import { _fetch } from "./_client";

export async function getPushReadiness() {
  try { return await _fetch("/push/readiness"); }
  catch (e) { return { ok: false, error: e.message }; }
}

export async function registerPushToken(token, platform = "web") {
  try { return await _fetch("/push/register", { method: "POST", body: JSON.stringify({ token, platform }) }); }
  catch (e) { return { ok: false, error: e.message }; }
}

export async function unregisterPushToken(token) {
  try { return await _fetch("/push/unregister", { method: "POST", body: JSON.stringify({ token }) }); }
  catch (e) { return { ok: false, error: e.message }; }
}
