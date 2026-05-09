import React from "react";
import "./Landing.css";

export default function Landing({ onStart, onLogin }) {
  return (
    <div className="landing">
      <div className="landing-inner">

        <div className="landing-logo">J</div>

        <h1 className="landing-headline">
          Your AI sales team<br />on WhatsApp
        </h1>
        <p className="landing-sub">
          JARVIS follows up with every lead, sends payment links,
          and closes clients — automatically.
        </p>

        <ul className="landing-features">
          <li>Auto follow-ups to every lead</li>
          <li>Payment links in one tap</li>
          <li>Client pipeline built-in</li>
          <li>Works on WhatsApp &amp; Telegram</li>
        </ul>

        <div className="landing-actions">
          <button className="landing-btn-primary" onClick={onStart}>
            Start Free Trial
          </button>
          <button className="landing-btn-ghost" onClick={onLogin}>
            Already have an account? Login
          </button>
        </div>

        <p className="landing-trust">
          No credit card required &nbsp;·&nbsp; 7-day free trial
        </p>

      </div>
    </div>
  );
}
