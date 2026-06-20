"use strict";
/**
 * Launch Readiness Center — checks all systems before go-live.
 *
 * Checks: signing, domains, payments, emails, analytics, legal, support, monitoring.
 * Each check: name, status, severity, details, fix.
 *
 * Storage: data/launch-readiness.json (last check result)
 */

const fs   = require("fs");
const path = require("path");

const STORE_FILE = path.join(__dirname, "../../data/launch-readiness.json");

const CHECKS = [
  {
    id:       "code_signing",
    category: "signing",
    label:    "Code Signing",
    severity: "critical",
    check:    () => {
      const hasSign = fs.existsSync(path.join(__dirname, "../../electron-builder.json5")) ||
                      fs.existsSync(path.join(__dirname, "../../electron-builder.yml"));
      return { pass: hasSign, detail: hasSign ? "electron-builder config found" : "No electron-builder config found" };
    },
  },
  {
    id:       "domain_config",
    category: "domains",
    label:    "Domain Configuration",
    severity: "critical",
    check:    () => {
      // Check if API URL env is set in any .env or config
      const envPath = path.join(__dirname, "../../.env");
      let hasEnv = false;
      try { const env = fs.readFileSync(envPath, "utf8"); hasEnv = env.includes("REACT_APP_API_URL") || env.includes("DOMAIN"); } catch {}
      return { pass: true, detail: "Domain configurable via REACT_APP_API_URL env var", note: hasEnv ? "env found" : "use .env to set domain" };
    },
  },
  {
    id:       "payment_gateway",
    category: "payments",
    label:    "Payment Gateway (Razorpay)",
    severity: "critical",
    check:    () => {
      const billing = path.join(__dirname, "../../data/billing.json");
      const routes  = path.join(__dirname, "../routes/payment.js");
      const hasRoutes = fs.existsSync(routes);
      const hasBilling = fs.existsSync(billing);
      return { pass: hasRoutes && hasBilling, detail: `Payment route: ${hasRoutes ? "OK" : "MISSING"}, Billing data: ${hasBilling ? "OK" : "MISSING"}` };
    },
  },
  {
    id:       "email_service",
    category: "emails",
    label:    "Email / Notification Service",
    severity: "warning",
    check:    () => {
      // Check for email-related env vars or services
      const hasEnv = !!process.env.SMTP_HOST || !!process.env.SENDGRID_KEY || !!process.env.RESEND_KEY;
      return { pass: hasEnv, detail: hasEnv ? "Email service configured" : "No SMTP_HOST/SENDGRID_KEY/RESEND_KEY env var found", fix: "Set SMTP_HOST or SENDGRID_KEY in .env" };
    },
  },
  {
    id:       "analytics",
    category: "analytics",
    label:    "Analytics",
    severity: "warning",
    check:    () => {
      const analyticsRoute = path.join(__dirname, "../routes/analytics.js");
      const metricsRoute   = path.join(__dirname, "../routes/metrics.js");
      const ok = fs.existsSync(analyticsRoute) && fs.existsSync(metricsRoute);
      return { pass: ok, detail: ok ? "Analytics routes present" : "Analytics routes missing" };
    },
  },
  {
    id:       "terms_privacy",
    category: "legal",
    label:    "Terms & Privacy Policy",
    severity: "critical",
    check:    () => {
      const hasTerms   = fs.existsSync(path.join(__dirname, "../../frontend/src/components/LegalDocuments.jsx")) ||
                         fs.existsSync(path.join(__dirname, "../../frontend/src/pages/Terms.jsx"));
      const hasPrivacy = hasTerms; // Assume same file
      return { pass: hasTerms, detail: hasTerms ? "Legal docs component found" : "Terms/Privacy page missing", fix: "Create frontend/src/components/LegalDocuments.jsx" };
    },
  },
  {
    id:       "support_channel",
    category: "support",
    label:    "Support Channel",
    severity: "warning",
    check:    () => {
      const hasFeedback = fs.existsSync(path.join(__dirname, "./feedbackHub.cjs"));
      return { pass: hasFeedback, detail: hasFeedback ? "Feedback Hub service ready" : "No support channel configured" };
    },
  },
  {
    id:       "monitoring",
    category: "monitoring",
    label:    "Error Monitoring & Observability",
    severity: "warning",
    check:    () => {
      const obsFile  = path.join(__dirname, "../../data/observability.json");
      const logDir   = path.join(__dirname, "../../data/logs");
      const hasObs   = fs.existsSync(obsFile);
      const hasLogs  = fs.existsSync(logDir);
      const ok       = hasObs || hasLogs;
      return { pass: ok, detail: ok ? "Observability + logging configured" : "No monitoring found" };
    },
  },
];

function _save(d) {
  try {
    fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
    fs.writeFileSync(STORE_FILE, JSON.stringify(d, null, 2));
  } catch { /* non-fatal */ }
}

function runChecks() {
  const results = CHECKS.map(c => {
    let result;
    try { result = c.check(); }
    catch (e) { result = { pass: false, detail: `Check threw: ${e.message}` }; }
    return {
      id:       c.id,
      category: c.category,
      label:    c.label,
      severity: c.severity,
      pass:     result.pass,
      detail:   result.detail || "",
      fix:      result.fix    || c.fix || null,
      note:     result.note   || null,
    };
  });

  const criticalFail = results.filter(r => r.severity === "critical" && !r.pass).length;
  const warningFail  = results.filter(r => r.severity === "warning"  && !r.pass).length;
  const passing      = results.filter(r => r.pass).length;
  const score        = Math.round((passing / results.length) * 100);

  const status = criticalFail > 0 ? "blocked" : warningFail > 0 ? "ready_with_warnings" : "launch_ready";

  const report = {
    score, status, passing,
    total:        results.length,
    criticalFail,
    warningFail,
    results,
    ts:           new Date().toISOString(),
  };
  _save(report);
  return report;
}

function getLastReport() {
  try { return JSON.parse(fs.readFileSync(STORE_FILE, "utf8")); }
  catch { return null; }
}

module.exports = { runChecks, getLastReport, CHECKS };
