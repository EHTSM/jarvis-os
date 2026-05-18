import { _fetch } from "./_client";

export async function getAuthStatus() {
  try {
    const data = await _fetch("/auth/me");
    return data.user || null;
  } catch { return null; }
}

export async function loginOperator(password) {
  try {
    return await _fetch("/auth/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function logoutOperator() {
  try {
    return await _fetch("/auth/logout", { method: "POST", body: "{}" });
  } catch (err) { return { success: false, error: err.message }; }
}
