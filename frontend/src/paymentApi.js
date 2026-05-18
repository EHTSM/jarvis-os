import { _fetch } from "./_client";

export async function generatePaymentLink({ amount, name, phone, description }) {
  try {
    return await _fetch("/payment/link", {
      method: "POST",
      body:   JSON.stringify({ amount, name, phone, description })
    });
  } catch (err) { return { success: false, error: err.message }; }
}
