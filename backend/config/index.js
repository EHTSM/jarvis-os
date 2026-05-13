"use strict";
/**
 * Centralized env config — single source of truth for all env var aliases.
 * All dual-naming (WA_TOKEN vs WHATSAPP_TOKEN, etc.) resolved here once.
 * Every service reads config.X() instead of process.env.X directly.
 */
module.exports = {
    waToken:        () => process.env.WA_TOKEN        || process.env.WHATSAPP_TOKEN      || "",
    waPhoneId:      () => process.env.WA_PHONE_ID     || process.env.PHONE_NUMBER_ID     || "",
    razorpayKey:    () => process.env.RAZORPAY_KEY    || process.env.RAZORPAY_KEY_ID     || "",
    razorpaySecret: () => process.env.RAZORPAY_SECRET || process.env.RAZORPAY_KEY_SECRET || "",
    telegramToken:  () => process.env.TELEGRAM_TOKEN  || "",
    groqKey:        () => process.env.GROQ_API_KEY    || "",
    baseUrl:        () => process.env.BASE_URL        || "http://localhost:5050",
    port:           () => parseInt(process.env.PORT)  || 5050,
    nodeEnv:        () => process.env.NODE_ENV        || "development",
    logLevel:       () => process.env.LOG_LEVEL       || "INFO",
    disableWA:      () => process.env.DISABLE_WHATSAPP === "true",
    disablePayments:() => process.env.DISABLE_PAYMENTS === "true",
};
