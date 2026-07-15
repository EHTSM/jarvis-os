#!/usr/bin/env node
"use strict";
/**
 * check-startup-env — validates required environment variables before server start.
 *
 * Exits 1 if any REQUIRED variable is missing in production mode.
 * Exits 0 with warnings if only optional variables are missing.
 *
 * Usage:
 *   node scripts/check-startup-env.cjs
 *   npm run env:check
 *
 * Add to CI or pre-start hook:
 *   "start": "node scripts/check-startup-env.cjs && node backend/server.js"
 */

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const isProd = process.env.NODE_ENV === "production";

// ── Required in production ────────────────────────────────────────────────────
const REQUIRED_PROD = [
    {
        key:  "JWT_SECRET",
        desc: "Signs operator session tokens. Generate: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
        fix:  "node scripts/generate-password-hash.cjs <password>  (also outputs JWT_SECRET)",
    },
    {
        key:  "OPERATOR_PASSWORD_HASH",
        desc: "Hashed operator login password (scrypt).",
        fix:  "node scripts/generate-password-hash.cjs <password>",
    },
];

// ── Required regardless of environment ───────────────────────────────────────
const REQUIRED_ALWAYS = [
    {
        key:  "GROQ_API_KEY",
        desc: "LLM inference key — required for /jarvis and /ai/chat routes.",
        fix:  "Get from console.groq.com",
    },
];

// ── Optional — features degrade gracefully ────────────────────────────────────
const OPTIONAL_GROUPS = [
    {
        label: "WhatsApp",
        // Each entry is a list of accepted aliases for the same setting — the
        // rest of the codebase (server.js, whatsappService.js, settings.js)
        // accepts either name, so the checker must too or it permanently
        // reports WhatsApp as unconfigured even when .env.example's names
        // (WHATSAPP_TOKEN / PHONE_NUMBER_ID) are filled in.
        varAliases: [["WA_TOKEN", "WHATSAPP_TOKEN"], ["WA_PHONE_ID", "PHONE_NUMBER_ID"]],
        note:  "WhatsApp send and inbound webhook disabled if missing",
    },
    {
        label: "Telegram",
        vars:  ["TELEGRAM_TOKEN"],
        note:  "Telegram bot and /telegram/send disabled if missing",
    },
    {
        label: "Razorpay",
        vars:  ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"],
        note:  "Payment link creation disabled if missing",
    },
    {
        label: "Razorpay Webhook",
        vars:  ["RAZORPAY_WEBHOOK_SECRET"],
        note:  "Webhooks rejected in production if missing",
    },
    {
        label: "Base URL",
        vars:  ["BASE_URL"],
        note:  "Razorpay callback uses localhost — payments silently broken in production",
    },
    {
        label: "CORS",
        vars:  ["ALLOWED_ORIGINS"],
        note:  "All cross-origin requests blocked if missing (not an issue for same-origin nginx setups)",
    },
];

// ── Check ─────────────────────────────────────────────────────────────────────
let failures  = 0;
let warnings  = 0;

console.log(`\n[check-startup-env] NODE_ENV=${process.env.NODE_ENV || "not set"}\n`);

// Required always
for (const { key, desc, fix } of REQUIRED_ALWAYS) {
    if (!process.env[key]) {
        failures++;
        console.error(`[MISSING REQUIRED] ${key}`);
        console.error(`  What:  ${desc}`);
        console.error(`  Fix:   ${fix}\n`);
    }
}

// Required in production
if (isProd) {
    for (const { key, desc, fix } of REQUIRED_PROD) {
        if (!process.env[key]) {
            failures++;
            console.error(`[MISSING REQUIRED (production)] ${key}`);
            console.error(`  What:  ${desc}`);
            console.error(`  Fix:   ${fix}\n`);
        }
    }
} else {
    console.log("[INFO] Non-production mode — JWT_SECRET and OPERATOR_PASSWORD_HASH optional (dev passthrough active)\n");
}

// Optional
const missingOptional = [];
for (const { label, vars, varAliases, note } of OPTIONAL_GROUPS) {
    // varAliases: each entry is a list of interchangeable env var names for one
    // setting — satisfied if ANY alias in the group is set. Plain `vars` still
    // supported for single-name settings with no alias.
    const groups  = varAliases || (vars || []).map(v => [v]);
    const missing = groups.filter(aliases => !aliases.some(k => process.env[k]));
    if (missing.length > 0) {
        warnings++;
        const names = missing.map(aliases => aliases.join("/")).join(", ");
        missingOptional.push(`  [OPTIONAL] ${label}: ${names} — ${note}`);
    }
}

if (missingOptional.length > 0) {
    console.log("[Optional variables not set — features disabled:]");
    missingOptional.forEach(m => console.log(m));
    console.log();
}

// ── Result ────────────────────────────────────────────────────────────────────
if (failures > 0) {
    console.error(`[FAIL] ${failures} required variable(s) missing.`);
    if (isProd) {
        console.error("[FAIL] Cannot start in production with missing required variables.");
        console.error("[FAIL] See docs/ENV_SETUP_REQUIREMENTS.md for setup instructions.");
        process.exit(1);
    } else {
        console.warn("[WARN] Missing required variables — some features will be broken.");
        process.exit(0);   // non-production: warn but don't block
    }
} else {
    console.log(`[PASS] All required variables set.${warnings > 0 ? ` (${warnings} optional group(s) disabled)` : ""}`);
    process.exit(0);
}
