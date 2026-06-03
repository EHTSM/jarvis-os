import React from "react";
import "./Legal.css";

const EFFECTIVE = "1 June 2026";
const COMPANY   = "ALWALIY TECHNOLOGIES PRIVATE LIMITED";
const BRAND     = "Ooplix";
const EMAIL     = "legal@ooplix.com";

export default function TermsOfService({ onBack }) {
  return (
    <div className="legal-page">
      <div className="legal-inner">
        <button className="legal-back" onClick={onBack}>← Back</button>
        <div className="legal-doc-header">
          <h1 className="legal-doc-title">Terms of Service</h1>
          <p className="legal-doc-meta">Effective: {EFFECTIVE} · {COMPANY}</p>
        </div>

        <div className="legal-section">
          <h2 className="legal-section-title">1. Acceptance</h2>
          <p className="legal-body">
            By accessing or using Ooplix ("the Service"), operated by {COMPANY},
            you agree to be bound by these Terms of Service. If you do not agree, do not use the Service.
          </p>
        </div>

        <div className="legal-section">
          <h2 className="legal-section-title">2. Description of Service</h2>
          <p className="legal-body">
            Ooplix is an AI Operating System that provides CRM automation, WhatsApp
            follow-up management, payment link generation, and workflow execution tools. The Service is
            provided as-is on a subscription basis with a 7-day free trial.
          </p>
        </div>

        <div className="legal-section">
          <h2 className="legal-section-title">3. Eligibility</h2>
          <p className="legal-body">
            You must be at least 18 years of age and legally capable of entering into contracts to use
            the Service. By using the Service, you represent that you meet these requirements.
          </p>
        </div>

        <div className="legal-section">
          <h2 className="legal-section-title">4. Acceptable Use</h2>
          <p className="legal-body">You agree not to:</p>
          <ul className="legal-list">
            <li>Use the Service to send spam, unsolicited bulk messages, or content that violates WhatsApp Business Policy</li>
            <li>Use the Service for illegal, fraudulent, or deceptive purposes</li>
            <li>Attempt to reverse-engineer, copy, or resell the Service without permission</li>
            <li>Interfere with or disrupt the Service infrastructure</li>
            <li>Store sensitive personal data (Aadhaar, PAN, financial credentials) of third parties in the system</li>
          </ul>
        </div>

        <div className="legal-section">
          <h2 className="legal-section-title">5. WhatsApp Usage</h2>
          <p className="legal-body">
            Ooplix uses the Meta WhatsApp Business API. You are solely responsible for ensuring your
            messaging complies with Meta's Business Policy, WhatsApp's Terms of Service, and applicable
            laws (including the TCPA, GDPR, and India's IT Act). {COMPANY} is not liable for account
            suspension or penalties arising from your messaging practices.
          </p>
        </div>

        <div className="legal-section">
          <h2 className="legal-section-title">6. Payments and Billing</h2>
          <p className="legal-body">
            The Service is offered with a 7-day free trial. After the trial, continued use requires a
            paid subscription. All payments are processed via Razorpay. Subscription fees are billed
            monthly or annually as selected. See our Refund Policy for cancellation terms.
          </p>
        </div>

        <div className="legal-section">
          <h2 className="legal-section-title">7. Intellectual Property</h2>
          <p className="legal-body">
            Ooplix and all associated software, designs, and documentation are the intellectual
            property of {COMPANY}. You are granted a limited, non-exclusive, non-transferable licence
            to use the Service for your own business purposes.
          </p>
        </div>

        <div className="legal-section">
          <h2 className="legal-section-title">8. Data and Privacy</h2>
          <p className="legal-body">
            Your use of the Service is also governed by our Privacy Policy, incorporated herein by
            reference. You retain ownership of your business data. We process it only to deliver the Service.
          </p>
        </div>

        <div className="legal-section">
          <h2 className="legal-section-title">9. Limitation of Liability</h2>
          <p className="legal-body">
            TO THE MAXIMUM EXTENT PERMITTED BY LAW, {COMPANY.toUpperCase()} SHALL NOT BE LIABLE FOR
            ANY INDIRECT, INCIDENTAL, SPECIAL, OR CONSEQUENTIAL DAMAGES ARISING FROM YOUR USE OF THE
            SERVICE. OUR TOTAL LIABILITY SHALL NOT EXCEED THE AMOUNT PAID BY YOU IN THE PRECEDING
            THREE MONTHS.
          </p>
        </div>

        <div className="legal-section">
          <h2 className="legal-section-title">10. Termination</h2>
          <p className="legal-body">
            We reserve the right to suspend or terminate your account for violations of these Terms.
            You may cancel your subscription at any time from your account settings. Cancellation takes
            effect at the end of the current billing period.
          </p>
        </div>

        <div className="legal-section">
          <h2 className="legal-section-title">11. Governing Law</h2>
          <p className="legal-body">
            These Terms are governed by the laws of India. Disputes shall be subject to the exclusive
            jurisdiction of courts in India.
          </p>
        </div>

        <div className="legal-section">
          <h2 className="legal-section-title">12. Contact</h2>
          <p className="legal-body">
            Legal inquiries: <a href={`mailto:${EMAIL}`} className="legal-link">{EMAIL}</a><br />
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
