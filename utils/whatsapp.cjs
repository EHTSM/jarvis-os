"use strict";
/**
 * Central WhatsApp utility.
 * Reads both naming conventions so either set works:
 *   WA_TOKEN / WHATSAPP_TOKEN
 *   WA_PHONE_ID / PHONE_NUMBER_ID
 *   WA_API_VERSION (default v19.0)
 */

const axios = require("axios");

function _token()   { return process.env.WA_TOKEN   || process.env.WHATSAPP_TOKEN || ""; }
function _phoneId() { return process.env.WA_PHONE_ID || process.env.PHONE_NUMBER_ID || ""; }
function _ver()     { return process.env.WA_API_VERSION || "v19.0"; }

async function sendWhatsApp(phone, message, retries = 2) {
    const token   = _token();
    const phoneId = _phoneId();

    if (!token || !phoneId) {
        console.warn("[WA] Not configured — WA_TOKEN / PHONE_NUMBER_ID missing. Message NOT sent.");
        return false;
    }

    const to = String(phone).replace(/\D/g, "").replace(/^0+/, "");

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            await axios.post(
                `https://graph.facebook.com/${_ver()}/${phoneId}/messages`,
                {
                    messaging_product: "whatsapp",
                    to,
                    type: "text",
                    text: { body: String(message) }
                },
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "application/json"
                    },
                    timeout: 10000
                }
            );
            console.log(`[WA] Sent to ${to}`);
            return true;
        } catch (err) {
            const detail = err.response?.data?.error?.message || err.message;
            if (attempt < retries) {
                console.warn(`[WA] Attempt ${attempt + 1} failed (${detail}), retrying...`);
                await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
            } else {
                console.error(`[WA] All attempts failed: ${detail}`);
            }
        }
    }
    return false;
}

async function sendTemplate(phone, templateName, languageCode, components) {
    const token   = _token();
    const phoneId = _phoneId();
    if (!token || !phoneId) return false;

    const to = String(phone).replace(/\D/g, "").replace(/^0+/, "");
    try {
        await axios.post(
            `https://graph.facebook.com/${_ver()}/${phoneId}/messages`,
            {
                messaging_product: "whatsapp",
                to,
                type: "template",
                template: {
                    name: templateName,
                    language: { code: languageCode || "en" },
                    components: components || []
                }
            },
            {
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                timeout: 10000
            }
        );
        return true;
    } catch (err) {
        console.error(`[WA] Template send failed: ${err.response?.data?.error?.message || err.message}`);
        return false;
    }
}

module.exports = { sendWhatsApp, sendTemplate };
