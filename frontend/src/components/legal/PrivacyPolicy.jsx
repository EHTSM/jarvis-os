import React from "react";
import "./Legal.css";

const EFFECTIVE = "1 June 2026";
const COMPANY   = "ALWALIY TECHNOLOGIES PRIVATE LIMITED";
const EMAIL     = "privacy@ooplix.com";

export default function PrivacyPolicy({ onBack }) {
  return (
    <div className="legal-page">
      <div className="legal-inner">
        <button className="legal-back" onClick={onBack}>← Back</button>
        <div className="legal-doc-header">
          <h1 className="legal-doc-title">Privacy Policy</h1>
          <p className="legal-doc-meta">Effective: {EFFECTIVE} · {COMPANY}</p>
        </div>

        <div className="legal-section">
          <h2 className="legal-section-title">1. Overview</h2>
          <p className="legal-body">
            This Privacy Policy explains how {COMPANY} ("we", "our", "Ooplix") collects, uses, stores,
            and protects information when you use JARVIS ("the Service"). By using the Service, you agree
            to the practices described in this policy.
          </p>
        </div>

        <div className="legal-section">
          <h2 className="legal-section-title">2. Information We Collect</h2>
          <ul className="legal-list">
            <li><strong>Business profile data</strong> — business name, product description, and pricing entered during onboarding. Stored locally on your device.</li>
            <li><strong>Contact/lead data</strong> — names and WhatsApp numbers of your clients that you enter into the system. Stored on our servers and used solely to power your automations.</li>
            <li><strong>Usage data</strong> — tab navigation, feature usage, session timestamps. Used to improve the product.</li>
            <li><strong>Authentication credentials</strong> — hashed operator password. We never store plaintext passwords.</li>
            <li><strong>Payment metadata</strong> — amounts, timestamps, and Razorpay transaction IDs. We do not store card numbers or bank details.</li>
          </ul>
        </div>

        <div className="legal-section">
          <h2 className="legal-section-title">3. How We Use Your Data</h2>
          <ul className="legal-list">
            <li>To operate and deliver the JARVIS automation service</li>
            <li>To send WhatsApp follow-up messages on your behalf to your leads</li>
            <li>To generate and track payment links via Razorpay</li>
            <li>To provide system health monitoring and error diagnostics</li>
            <li>To improve product features based on aggregated usage patterns</li>
          </ul>
          <p className="legal-body">We do not sell, rent, or share your data with third parties for marketing purposes.</p>
        </div>

        <div className="legal-section">
          <h2 className="legal-section-title">4. Third-Party Services</h2>
          <p className="legal-body">JARVIS integrates with the following third-party services, each governed by their own privacy policies:</p>
          <ul className="legal-list">
            <li><strong>Meta (WhatsApp Business API)</strong> — for automated messaging</li>
            <li><strong>Razorpay</strong> — for payment link generation and collection</li>
            <li><strong>Groq / OpenAI</strong> — for AI language processing</li>
            <li><strong>Firebase</strong> — for mobile app authentication (if applicable)</li>
          </ul>
        </div>

        <div className="legal-section">
          <h2 className="legal-section-title">5. Data Storage and Security</h2>
          <p className="legal-body">
            Your data is stored on servers you control (self-hosted) or on Ooplix-managed infrastructure
            (SaaS plan). We use JWT-based session authentication, bcrypt password hashing, and encrypted
            backups. Access logs are maintained for all authenticated operator actions.
          </p>
        </div>

        <div className="legal-section">
          <h2 className="legal-section-title">6. Data Retention</h2>
          <p className="legal-body">
            Lead and contact data is retained as long as your account is active. You may delete individual
            records at any time from the Contacts tab. On account termination, all personal data is deleted
            within 30 days.
          </p>
        </div>

        <div className="legal-section">
          <h2 className="legal-section-title">7. Your Rights</h2>
          <ul className="legal-list">
            <li>Access the data we hold about you</li>
            <li>Request correction or deletion of your data</li>
            <li>Export your data in machine-readable format</li>
            <li>Withdraw consent for data processing</li>
          </ul>
          <p className="legal-body">To exercise these rights, contact us at <a href={`mailto:${EMAIL}`} className="legal-link">{EMAIL}</a>.</p>
        </div>

        <div className="legal-section">
          <h2 className="legal-section-title">8. Cookies and Local Storage</h2>
          <p className="legal-body">
            JARVIS uses browser localStorage to store your business profile, session state, and UI
            preferences. No cross-site tracking cookies are used. Session cookies are used for
            authentication only and expire when you sign out.
          </p>
        </div>

        <div className="legal-section">
          <h2 className="legal-section-title">9. Changes to This Policy</h2>
          <p className="legal-body">
            We may update this policy as the product evolves. Material changes will be communicated
            via the app or email. Continued use after notification constitutes acceptance.
          </p>
        </div>

        <div className="legal-section">
          <h2 className="legal-section-title">10. Contact</h2>
          <p className="legal-body">
            For privacy questions: <a href={`mailto:${EMAIL}`} className="legal-link">{EMAIL}</a><br />
            {COMPANY}, India
          </p>
        </div>

        <div className="legal-footer-note">
          &copy; {new Date().getFullYear()} {COMPANY}. All rights reserved.
        </div>
      </div>
    </div>
  );
}
