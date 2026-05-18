import { _fetch } from "./_client";

export async function getLeads() {
  try { return await _fetch("/crm"); }
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

export async function sendFollowUp(phone, message) {
  try {
    return await _fetch("/send-followup", {
      method: "POST",
      body:   JSON.stringify({ phone, message })
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
      body: JSON.stringify({ phone, message: message || "JARVIS connected. WhatsApp automation is active." })
    });
  } catch (err) { return { success: false, error: err.message }; }
}
