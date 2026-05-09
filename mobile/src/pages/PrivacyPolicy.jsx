import React from "react";
import { useNavigate } from "react-router-dom";

export default function PrivacyPolicy() {
  const navigate = useNavigate();

  return (
    <>
      <header className="mobile-header">
        <button
          onClick={() => navigate(-1)}
          style={{ color: "var(--accent)", fontWeight: 600, fontSize: 15 }}
        >
          ← Back
        </button>
        <span style={{ fontWeight: 700, fontSize: 16 }}>Privacy Policy</span>
        <span style={{ width: 60 }} />
      </header>

      <div className="app-screen">
        <div className="legal-page selectable">
          <h1>Privacy Policy</h1>
          <p className="updated">Last updated: May 2026</p>

          <p>
            JARVIS AI ("we", "our", or "us") operates the JARVIS AI mobile
            application (the "App"). This page explains how we collect, use, and
            protect your information.
          </p>

          <h2>1. Information We Collect</h2>
          <ul>
            <li>
              <strong>Account data:</strong> Email address and display name
              provided at registration, stored securely in Firebase Authentication.
            </li>
            <li>
              <strong>Chat history:</strong> Messages you send to JARVIS AI,
              stored in your private Firestore document accessible only to your
              account.
            </li>
            <li>
              <strong>Task data:</strong> AI-generated plans you choose to save,
              stored in your private Firestore collection.
            </li>
            <li>
              <strong>CRM data:</strong> Lead and customer information you enter
              into the business tools, processed by the JARVIS backend.
            </li>
          </ul>

          <h2>2. How We Use Your Information</h2>
          <ul>
            <li>To authenticate you and maintain your session.</li>
            <li>To personalise your AI responses and task history.</li>
            <li>To process payment link requests through Razorpay.</li>
            <li>To send WhatsApp follow-up messages you explicitly trigger.</li>
            <li>To improve the quality and accuracy of JARVIS AI.</li>
          </ul>

          <h2>3. Data Storage and Security</h2>
          <p>
            All data is stored on Google Firebase (Firebase Authentication and
            Cloud Firestore), which is protected by Google's enterprise-grade
            security infrastructure. Data is encrypted at rest and in transit.
            User data is logically isolated — you can only access your own records.
          </p>

          <h2>4. Third-Party Services</h2>
          <ul>
            <li>
              <strong>Firebase (Google):</strong> Authentication, database, and
              analytics. See{" "}
              <a
                href="https://firebase.google.com/support/privacy"
                target="_blank"
                rel="noreferrer"
              >
                Firebase Privacy Policy
              </a>
              .
            </li>
            <li>
              <strong>Razorpay:</strong> Payment processing. See{" "}
              <a
                href="https://razorpay.com/privacy/"
                target="_blank"
                rel="noreferrer"
              >
                Razorpay Privacy Policy
              </a>
              .
            </li>
            <li>
              <strong>Groq / OpenAI:</strong> AI inference for chat responses.
              Messages are sent to these APIs and subject to their respective
              privacy policies.
            </li>
          </ul>

          <h2>5. Permissions Used</h2>
          <ul>
            <li>
              <strong>INTERNET:</strong> Required to communicate with the JARVIS
              backend and Firebase services.
            </li>
            <li>
              <strong>ACCESS_NETWORK_STATE:</strong> Used to detect offline status
              and show an appropriate message.
            </li>
          </ul>
          <p>
            This app does <strong>not</strong> request access to your camera,
            microphone, contacts, location, files, or any system-level
            accessibility features.
          </p>

          <h2>6. Data Retention</h2>
          <p>
            Your data is retained as long as your account is active. You may
            request deletion of your account and all associated data at any time
            by contacting us.
          </p>

          <h2>7. Children's Privacy</h2>
          <p>
            JARVIS AI is not directed to children under 13. We do not knowingly
            collect personal information from children under 13.
          </p>

          <h2>8. Your Rights</h2>
          <p>
            You have the right to access, correct, or delete your personal data.
            To exercise these rights, contact us at the email below.
          </p>

          <h2>9. Contact</h2>
          <p>
            For privacy questions or data deletion requests, email:{" "}
            <a href="mailto:altamashjauhar@gmail.com">altamashjauhar@gmail.com</a>
          </p>

          <div style={{ height: 32 }} />
        </div>
      </div>
    </>
  );
}
