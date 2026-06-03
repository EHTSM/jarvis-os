import React from "react";
import "./Legal.css";

const COMPANY = "ALWALIY TECHNOLOGIES PRIVATE LIMITED";

const CONTACTS = [
  { role: "General",  email: "hello@ooplix.com",   desc: "General enquiries and product questions" },
  { role: "Support",  email: "support@ooplix.com",  desc: "Technical support and onboarding help" },
  { role: "Billing",  email: "billing@ooplix.com",  desc: "Subscription, payments, and refund requests" },
  { role: "Legal",    email: "legal@ooplix.com",    desc: "Terms, compliance, and legal matters" },
  { role: "Privacy",  email: "privacy@ooplix.com",  desc: "Data requests and privacy questions" },
  { role: "Security", email: "security@ooplix.com", desc: "Responsible disclosure and security reports" },
];

export default function ContactPage({ onBack }) {
  return (
    <div className="legal-page">
      <div className="legal-inner">
        <button className="legal-back" onClick={onBack}>← Back</button>
        <div className="legal-doc-header">
          <h1 className="legal-doc-title">Contact Us</h1>
          <p className="legal-doc-meta">{COMPANY}</p>
        </div>

        <div className="legal-section">
          <h2 className="legal-section-title">Get in Touch</h2>
          <p className="legal-body">
            We're a small, focused team. Use the appropriate contact below — it gets your message to
            the right person faster.
          </p>
        </div>

        <div className="legal-section">
          <div className="legal-contact-grid">
            {CONTACTS.map(c => (
              <div key={c.role} className="legal-contact-card">
                <div className="legal-contact-role">{c.role}</div>
                <a href={`mailto:${c.email}`} className="legal-contact-email">{c.email}</a>
                <p className="legal-contact-desc">{c.desc}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="legal-section">
          <h2 className="legal-section-title">Company Details</h2>
          <div className="legal-company-card">
            <div className="legal-company-row">
              <span className="legal-company-label">Legal Name</span>
              <span className="legal-company-value">{COMPANY}</span>
            </div>
            <div className="legal-company-row">
              <span className="legal-company-label">Brand</span>
              <span className="legal-company-value">Ooplix</span>
            </div>
            <div className="legal-company-row">
              <span className="legal-company-label">Country</span>
              <span className="legal-company-value">India</span>
            </div>
          </div>
        </div>

        <div className="legal-section">
          <h2 className="legal-section-title">Response Times</h2>
          <ul className="legal-list">
            <li><strong>Support requests</strong> — within 1 business day during beta</li>
            <li><strong>Billing and refunds</strong> — within 2 business days</li>
            <li><strong>Legal and privacy requests</strong> — within 5 business days</li>
            <li><strong>Security reports</strong> — acknowledged within 24 hours</li>
          </ul>
        </div>

        <div className="legal-footer-note">
          &copy; {new Date().getFullYear()} {COMPANY}. All rights reserved.
        </div>
      </div>
    </div>
  );
}
