import React from "react";
import "./Legal.css";

const EFFECTIVE = "1 June 2026";
const COMPANY   = "ALWALIY TECHNOLOGIES PRIVATE LIMITED";
const EMAIL     = "billing@ooplix.com";

export default function RefundPolicy({ onBack }) {
  return (
    <div className="legal-page">
      <div className="legal-inner">
        <button className="legal-back" onClick={onBack}>← Back</button>
        <div className="legal-doc-header">
          <h1 className="legal-doc-title">Refund Policy</h1>
          <p className="legal-doc-meta">Effective: {EFFECTIVE} · {COMPANY}</p>
        </div>

        <div className="legal-section">
          <h2 className="legal-section-title">1. Free Trial</h2>
          <p className="legal-body">
            JARVIS offers a 7-day free trial with no credit card required. No charges are applied during
            the trial period. If you choose not to upgrade, your trial expires automatically with no action needed.
          </p>
        </div>

        <div className="legal-section">
          <h2 className="legal-section-title">2. Subscription Cancellation</h2>
          <p className="legal-body">
            You may cancel your subscription at any time from your account settings. Cancellation takes
            effect at the end of your current billing period. You retain access to the Service until that date.
            No partial refunds are issued for unused time within a billing period.
          </p>
        </div>

        <div className="legal-section">
          <h2 className="legal-section-title">3. Refund Eligibility</h2>
          <p className="legal-body">Refunds are considered in the following circumstances:</p>
          <ul className="legal-list">
            <li><strong>Duplicate charges</strong> — If you were charged twice for the same billing period, a full refund of the duplicate charge will be issued within 5 business days.</li>
            <li><strong>Service unavailability</strong> — If the Service was unavailable for more than 72 continuous hours in a billing month due to our infrastructure failure, a pro-rated credit will be applied to your next billing cycle.</li>
            <li><strong>Billing errors</strong> — If an incorrect amount was charged due to a system error, the difference will be refunded within 7 business days.</li>
          </ul>
        </div>

        <div className="legal-section">
          <h2 className="legal-section-title">4. Non-Refundable Situations</h2>
          <ul className="legal-list">
            <li>Change of mind after the trial period</li>
            <li>Failure to configure third-party integrations (WhatsApp, Razorpay)</li>
            <li>Account suspension due to Terms of Service violations</li>
            <li>Unused features or modules within a paid plan</li>
          </ul>
        </div>

        <div className="legal-section">
          <h2 className="legal-section-title">5. SaaS Billing Disclosure</h2>
          <div className="legal-highlight-box">
            <p className="legal-body">
              JARVIS is a Software-as-a-Service (SaaS) product. Subscriptions are recurring and will
              auto-renew at the end of each billing period unless cancelled. You will receive a reminder
              email before any renewal charge. The subscription fee is for access to the software
              platform — it does not include WhatsApp API usage fees, Razorpay transaction fees, or
              AI API costs, which are billed directly by the respective third-party providers.
            </p>
          </div>
        </div>

        <div className="legal-section">
          <h2 className="legal-section-title">6. Payment Processor</h2>
          <p className="legal-body">
            All subscription payments are processed by Razorpay. {COMPANY} does not store your payment
            card details. For disputes related to payment processing, contact Razorpay directly or
            reach us at <a href={`mailto:${EMAIL}`} className="legal-link">{EMAIL}</a>.
          </p>
        </div>

        <div className="legal-section">
          <h2 className="legal-section-title">7. How to Request a Refund</h2>
          <p className="legal-body">
            Email <a href={`mailto:${EMAIL}`} className="legal-link">{EMAIL}</a> with your account
            email, the charge date, and the reason for your request. We respond within 2 business days.
            Approved refunds are processed within 7–10 business days to your original payment method.
          </p>
        </div>

        <div className="legal-footer-note">
          &copy; {new Date().getFullYear()} {COMPANY}. All rights reserved.
        </div>
      </div>
    </div>
  );
}
