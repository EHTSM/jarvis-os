import React from "react";
import "./ConnectBar.css";

function Pill({ label, connected, onSetup }) {
  return (
    <div className={`cb-pill ${connected ? "cb-pill--on" : "cb-pill--off"}`}>
      <span className="cb-dot" />
      <span className="cb-pill-label">{label}</span>
      {!connected && onSetup && (
        <button className="cb-setup-btn" onClick={onSetup}>Set up →</button>
      )}
    </div>
  );
}

export default function ConnectBar({ services = {}, onSetupWhatsApp }) {
  const { whatsapp = false, payments = false, ai = false, groq = false } = services;
  const aiOn = ai || groq;
  const allOn = whatsapp && payments && aiOn;

  if (allOn) {
    return (
      <div className="connect-bar connect-bar--all-on">
        <span className="cb-all-dot" />
        <span className="cb-all-label">All systems active</span>
      </div>
    );
  }

  // Only render a pill if it's connected (good feedback) or has a setup action.
  // Never show a disconnected pill with no action — it just looks broken.
  return (
    <div className="connect-bar">
      <Pill label="WhatsApp" connected={whatsapp} onSetup={onSetupWhatsApp} />
      {payments && <Pill label="Payments" connected={true} />}
      {aiOn     && <Pill label="AI"       connected={true} />}
    </div>
  );
}
