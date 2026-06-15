"use strict";
/**
 * Raw body capture middleware.
 * Extracted from server.js. Attaches req.rawBody (string) for Razorpay
 * HMAC verification — must be mounted BEFORE express.json().
 */
module.exports = function rawBody(req, res, next) {
    const url = req.url || "";
    if (
        url.includes("/webhook/razorpay") ||
        url.includes("/razorpay-webhook") ||
        url.includes("/whatsapp/webhook")
    ) {
        let raw = "";
        req.on("data", chunk => { raw += chunk; });
        req.on("end",  ()    => { req.rawBody = raw; next(); });
    } else {
        next();
    }
};
