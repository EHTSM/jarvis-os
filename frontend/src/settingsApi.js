import { _fetch } from "./_client";

export async function getSettingsStatus() {
  try { return await _fetch("/settings/status"); }
  catch (err) { return { success: false, error: err.message }; }
}

export async function saveWhatsAppCredentials({ token, phoneId, verifyToken, apiVersion }) {
  try {
    return await _fetch("/settings/whatsapp", {
      method: "POST",
      body: JSON.stringify({ token, phoneId, verifyToken, apiVersion }),
    });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function saveRazorpayCredentials({ keyId, keySecret, webhookSecret }) {
  try {
    return await _fetch("/settings/razorpay", {
      method: "POST",
      body: JSON.stringify({ keyId, keySecret, webhookSecret }),
    });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function removeWhatsAppCredentials() {
  try {
    return await _fetch("/settings/whatsapp", { method: "DELETE", body: "{}" });
  } catch (err) { return { success: false, error: err.message }; }
}
