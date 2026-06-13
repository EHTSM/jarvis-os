import { _fetch } from "./_client";

// Strips formatting, adds +92 country code if missing, rejects if not 10–15 digits.
function normalizePhone(raw) {
  if (!raw) throw new Error("Phone number is required");
  let digits = String(raw).replace(/[\s\-().+]/g, "");
  if (!/^\d+$/.test(digits)) throw new Error(`Invalid phone number: "${raw}"`);
  // Pakistani numbers: 11 digits starting with 0 → replace leading 0 with +92
  if (digits.length === 11 && digits.startsWith("0")) digits = "92" + digits.slice(1);
  // 10-digit local (no leading 0) → assume +92
  if (digits.length === 10) digits = "92" + digits;
  if (digits.length < 7 || digits.length > 15) throw new Error(`Phone number out of range: "${raw}"`);
  return "+" + digits;
}

export async function getLeads() {
  try { return await _fetch("/crm/leads"); }
  catch { return []; }
}

export async function createLead({ name, phone, service, dealValue, notes }) {
  try {
    const body = { name, phone };
    if (service)   body.service   = service;
    if (dealValue) body.dealValue = String(dealValue);
    if (notes)     body.notes     = notes;
    return await _fetch("/crm/lead", { method: "POST", body: JSON.stringify(body) });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function updateLead(phone, fields) {
  try {
    return await _fetch(`/crm/lead/${encodeURIComponent(phone)}`, {
      method: "PATCH",
      body:   JSON.stringify(fields),
    });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function sendFollowUp(phone, message) {
  try {
    const normalized = normalizePhone(phone);
    return await _fetch("/send-followup", {
      method: "POST",
      body:   JSON.stringify({ phone: normalized, message })
    });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function sendTelegram(chatId, message) {
  try {
    return await _fetch("/telegram/send", {
      method: "POST",
      body:   JSON.stringify({ chatId, message })
    });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function testWhatsAppSend(phone, message) {
  try {
    return await _fetch("/whatsapp/send", {
      method: "POST",
      body: JSON.stringify({ phone, message: message || "Ooplix connected. WhatsApp automation is active." })
    });
  } catch (err) { return { success: false, error: err.message }; }
}
