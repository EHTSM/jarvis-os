import React from "react";
import "./Legal.css";

const EFFECTIVE = "1 June 2026";
const COMPANY   = "ALWALIY TECHNOLOGIES PRIVATE LIMITED";
const EMAIL     = "privacy@ooplix.com";

export default function CookiePolicy({ onBack }) {
  return (
    <div className="legal-page">
      <div className="legal-inner">
        <button className="legal-back" onClick={onBack}>← Back</button>
        <div className="legal-doc-header">
          <h1 className="legal-doc-title">Cookie Policy</h1>
          <p className="legal-doc-meta">Effective: {EFFECTIVE} · {COMPANY}</p>
        </div>

        <div className="legal-section">
          <h2 className="legal-section-title">1. Overview</h2>
          <p className="legal-body">
            This Cookie Policy explains how {COMPANY} ("we", "our", "Ooplix") uses cookies and
            similar technologies when you visit or use Ooplix ("the Service"). By continuing to
            use the Service, you consent to the use of cookies as described in this policy.
          </p>
        </div>

        <div className="legal-section">
          <h2 className="legal-section-title">2. What Are Cookies?</h2>
          <p className="legal-body">
            Cookies are small text files placed on your device by a website or application.
            They help the service remember your preferences, maintain your session, and understand
            how you interact with the product. Ooplix also uses browser localStorage for certain
            persistent data; the same principles apply.
          </p>
        </div>

        <div className="legal-section">
          <h2 className="legal-section-title">3. Cookies We Use</h2>
          <ul className="legal-list">
            <li>
              <strong>Essential / Session cookies</strong> — Required for authentication and
              secure session management. These are set when you sign in and cleared when you sign
              out. The Service cannot function without them.
            </li>
            <li>
              <strong>Preference cookies</strong> — Store UI settings such as theme and sidebar
              state in localStorage so your preferences persist between sessions. No personal
              data is included.
            </li>
            <li>
              <strong>Security cookies</strong> — Short-lived tokens used to protect against
              cross-site request forgery (CSRF). Automatically cleared after each request cycle.
            </li>
          </ul>
        </div>

        <div className="legal-section">
          <h2 className="legal-section-title">4. Cookies We Do Not Use</h2>
          <p className="legal-body">
            Ooplix does <strong>not</strong> use:
          </p>
          <ul className="legal-list">
            <li>Third-party advertising or tracking cookies</li>
            <li>Cross-site behavioural tracking</li>
            <li>Analytics services that set persistent third-party cookies (e.g. Google Analytics)</li>
            <li>Social media tracking pixels</li>
          </ul>
        </div>

        <div className="legal-section">
          <h2 className="legal-section-title">5. localStorage and sessionStorage</h2>
          <p className="legal-body">
            Some data (business profile, onboarding state, mission cache) is stored in your
            browser's localStorage rather than in cookies. This data never leaves your device
            unless you explicitly sync it. You can clear it at any time via your browser settings
            or the Account → Data section within Ooplix.
          </p>
        </div>

        <div className="legal-section">
          <h2 className="legal-section-title">6. Managing Cookies</h2>
          <p className="legal-body">
            You can control and delete cookies through your browser settings. Disabling essential
            cookies will prevent you from signing in and using the Service. Preference cookies can
            be cleared without affecting access; your UI preferences will revert to defaults.
          </p>
        </div>

        <div className="legal-section">
          <h2 className="legal-section-title">7. Electron Desktop App</h2>
          <p className="legal-body">
            The Ooplix desktop application (Electron) uses Chromium's cookie and localStorage
            stores scoped to the application. Cookies do not persist across uninstall. The
            same cookie categories described above apply; no additional tracking is introduced
            by the desktop wrapper.
          </p>
        </div>

        <div className="legal-section">
          <h2 className="legal-section-title">8. Updates to This Policy</h2>
          <p className="legal-body">
            We may update this Cookie Policy when we introduce new features that change how
            data is stored locally. Material changes will be communicated via in-app notice at
            least 14 days before they take effect.
          </p>
        </div>

        <div className="legal-section">
          <h2 className="legal-section-title">9. Contact</h2>
          <p className="legal-body">
            Questions about our cookie practices? Email us at{" "}
            <a href={`mailto:${EMAIL}`} className="legal-link">{EMAIL}</a>.
          </p>
        </div>
      </div>
    </div>
  );
}
