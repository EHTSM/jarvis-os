"use strict";
const { load, flush, uid, NOW, securityLog, ok, fail, blocked } = require("./_securityStore.cjs");
const AGENT = "identityProtectionAgent";

const PASSWORD_COMMON = new Set(["password","123456","password123","admin","letmein","qwerty","123456789","12345678","1234567890","welcome","monkey","dragon","master","sunshine","princess"]);

const MFA_METHODS = {
    totp:    { name:"TOTP (Google Authenticator / Authy)", strength:"HIGH",   phishResistant:false },
    sms_otp: { name:"SMS OTP",                             strength:"MEDIUM", phishResistant:false, note:"SIM swap vulnerable" },
    email_otp:{ name:"Email OTP",                          strength:"MEDIUM", phishResistant:false },
    passkey: { name:"Passkey (FIDO2/WebAuthn)",            strength:"VERY_HIGH",phishResistant:true },
    hardware_key:{ name:"Hardware Security Key (YubiKey)", strength:"VERY_HIGH",phishResistant:true }
};

function assessPasswordStrength({ userId, password }) {
    if (!userId || !password) return fail(AGENT, "userId and password required");
    securityLog(AGENT, userId, "password_assessed", {}, "INFO");

    if (PASSWORD_COMMON.has(password.toLowerCase())) {
        return blocked(AGENT, "Password is in the list of most commonly compromised passwords — change immediately", "HIGH");
    }

    const checks = {
        minLength:       password.length >= 12,
        hasUppercase:    /[A-Z]/.test(password),
        hasLowercase:    /[a-z]/.test(password),
        hasNumbers:      /\d/.test(password),
        hasSymbols:      /[^a-zA-Z0-9]/.test(password),
        noRepeating:     !/(.)\1{2,}/.test(password),
        notTooLong:      password.length <= 128
    };

    const passed = Object.values(checks).filter(Boolean).length;
    const score  = Math.round(passed / Object.keys(checks).length * 100);
    const strength = score >= 90 ? "STRONG" : score >= 70 ? "MODERATE" : score >= 50 ? "WEAK" : "VERY_WEAK";

    return ok(AGENT, {
        strength,
        score,
        checks,
        failedChecks: Object.entries(checks).filter(([,v]) => !v).map(([k]) => k),
        recommendation: strength === "STRONG" ? "✓ Good password" : "Improve password: " + Object.entries(checks).filter(([,v]) => !v).map(([k]) => k.replace(/([A-Z])/g," $1").toLowerCase()).join(", ")
    });
}

function generatePassword({ userId, length = 16, includeSymbols = true }) {
    if (!userId) return fail(AGENT, "userId required");
    if (length < 12 || length > 128) return fail(AGENT, "Length must be 12-128");

    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789" + (includeSymbols ? "!@#$%^&*()-_=+" : "");
    let pwd = "";
    for (let i = 0; i < length; i++) pwd += chars[Math.floor(Math.random() * chars.length)];

    return ok(AGENT, { password: pwd, length, strength: "STRONG", note: "Use a password manager (Bitwarden, 1Password) to store this." });
}

function checkBreachExposure({ userId, email }) {
    if (!userId || !email) return fail(AGENT, "userId and email required");
    securityLog(AGENT, userId, "breach_check", { email: email.slice(0,3) + "***" }, "INFO");

    return ok(AGENT, {
        email,
        checkNote:    "Breach checking requires real-time API integration",
        services:     [
            { name:"HaveIBeenPwned", url:"haveibeenpwned.com/account/" + encodeURIComponent(email), free:true },
            { name:"Firefox Monitor",url:"monitor.firefox.com",                                     free:true },
            { name:"DeHashed",       url:"dehashed.com",                                            free:false }
        ],
        recommendation: "Check the above services. If breached: change password immediately, enable MFA, check other accounts using same password."
    });
}

function getMFARecommendation({ useCase = "general" }) {
    return ok(AGENT, {
        recommendation: "Use Passkeys (FIDO2) or Hardware Security Keys where possible — highest security and phishing-resistant.",
        methods:        Object.entries(MFA_METHODS).map(([k, v]) => ({ key: k, ...v })).sort((a, b) => b.strength.localeCompare(a.strength))
    });
}

module.exports = { assessPasswordStrength, generatePassword, checkBreachExposure, getMFARecommendation };
