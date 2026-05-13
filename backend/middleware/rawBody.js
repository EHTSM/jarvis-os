"use strict";
/**
 * Raw body capture middleware.
 * Extracted from server.js. Attaches req.rawBody (string) for Razorpay
 * HMAC verification — must be mounted BEFORE express.json().
 */
module.exports = function rawBody(req, res, next) {
    if (req.url.includes("/webhook/razorpay") || req.url.includes("/razorpay-webhook")) {
        let raw = "";
        req.on("data", chunk => { raw += chunk; });
        req.on("end",  ()    => { req.rawBody = raw; next(); });
    } else {
        next();
    }
};
