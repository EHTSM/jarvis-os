import React from "react";
import "./Legal.css";

const COMPANY = "ALWALIY TECHNOLOGIES PRIVATE LIMITED";

const TRUST_ITEMS = [
  {
    icon: "🔒",
    title: "End-to-End Security",
    points: [
      "Passwords hashed with bcrypt (12 rounds) — never stored in plaintext",
      "JWT session tokens with short-lived expiry and silent refresh",
      "All authenticated routes require a valid session token",
      "HTTPS enforced in production — no plaintext HTTP",
      "Operator audit log records every authenticated action with IP and timestamp",
    ],
  },
  {
    icon: "💳",
    title: "Payment Security",
    points: [
      "Payments processed by Razorpay — PCI-DSS Level 1 certified",
      "We never store card numbers, CVVs, or bank account details",
      "Payment webhook signatures verified with HMAC-SHA256",
      "All payment links are unique, time-bound, and non-guessable",
    ],
  },
  {
    icon: "📱",
    title: "WhatsApp Compliance",
    points: [
      "Uses official Meta WhatsApp Business API — no unofficial clients",
      "Webhook signature validation prevents spoofed incoming messages",
      "Replay attack detection on all webhook events",
      "Message rate-limiting to stay within Meta's API quotas",
    ],
  },
  {
    icon: "🗄️",
    title: "Data Handling",
    points: [
      "Business and lead data stored on infrastructure you control (self-hosted) or Ooplix-managed servers",
      "Automated encrypted backups with AES-256 passphrase protection",
      "Data deletion available at any time from the Contacts tab",
      "Full account data deletion within 30 days of cancellation",
    ],
  },
  {
    icon: "🧱",
    title: "Infrastructure",
    points: [
      "Rate limiting on all API endpoints to prevent abuse",
      "Request ID tracing for full auditability of every API call",
      "Dead letter queue for failed automation tasks — no silent drops",
      "Health monitoring with configurable alerting",
    ],
  },
  {
    icon: "⚖️",
    title: "Legal & Compliance",
    points: [
      "Governed by the laws of India",
      "Compliant with India's Information Technology Act, 2000",
      "Data processing is purpose-limited — only used to deliver the Service",
      "No data sold or shared with third parties for advertising",
      "Privacy Policy and Terms of Service available in plain language",
    ],
  },
];

export default function TrustCompliance({ onBack }) {
  return (
    <div className="legal-page">
      <div className="legal-inner">
        <button className="legal-back" onClick={onBack}>← Back</button>
        <div className="legal-doc-header">
          <h1 className="legal-doc-title">Trust & Compliance</h1>
          <p className="legal-doc-meta">Security, data, and compliance practices · {COMPANY}</p>
        </div>

        <div className="legal-section">
          <p className="legal-body">
            We build JARVIS with the assumption that your business data is sensitive and that your
            clients trust you. These are the practices we hold ourselves to.
          </p>
        </div>

        <div className="trust-grid">
          {TRUST_ITEMS.map(item => (
            <div key={item.title} className="trust-card">
              <div className="trust-card-header">
                <span className="trust-icon" aria-hidden="true">{item.icon}</span>
                <h3 className="trust-title">{item.title}</h3>
              </div>
              <ul className="trust-list">
                {item.points.map((p, i) => (
                  <li key={i} className="trust-item">
                    <span className="trust-check" aria-hidden="true">✓</span>
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="legal-section">
          <h2 className="legal-section-title">Report a Security Issue</h2>
          <p className="legal-body">
            If you discover a security vulnerability, please disclose it responsibly to{" "}
            <a href="mailto:security@ooplix.com" className="legal-link">security@ooplix.com</a>.
            We acknowledge reports within 24 hours and aim to resolve critical issues within 72 hours.
            We do not pursue legal action against good-faith security researchers.
          </p>
        </div>

        <div className="legal-footer-note">
          &copy; {new Date().getFullYear()} {COMPANY}. All rights reserved.
        </div>
      </div>
    </div>
  );
}
