const REQUIRED = ["TELEGRAM_TOKEN", "GROQ_API_KEY"];
const OPTIONAL = [
    "RAZORPAY_KEY", "RAZORPAY_SECRET",
    "WHATSAPP_TOKEN", "WA_PHONE_ID", "WA_TOKEN",
    "GOOGLE_API", "LINKEDIN_COOKIE", "LINKEDIN_PROXY_URL"
];

function checkEnv() {
    const missing = REQUIRED.filter(k => !process.env[k]);
    const absent  = OPTIONAL.filter(k => !process.env[k]);

    if (missing.length) {
        console.warn(`⚠️  Missing required env vars: ${missing.join(", ")}`);
        console.warn("   Add them to .env file to enable full functionality.");
    }
    if (absent.length) {
        console.log(`ℹ️  Optional env vars not set: ${absent.join(", ")}`);
    }

    return missing.length === 0;
}

module.exports = { checkEnv };
