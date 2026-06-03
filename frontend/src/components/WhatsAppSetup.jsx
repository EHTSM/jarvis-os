import React, { useState, useMemo } from "react";
import { testWhatsAppSend } from "../crmApi";
import "./WhatsAppSetup.css";

function _loadProfile() {
  try { return JSON.parse(localStorage.getItem("jarvis_biz_profile") || "null"); }
  catch { return null; }
}

function MessagePreview() {
  const profile = useMemo(_loadProfile, []);
  const bizName = profile?.business || "your business";
  const product = profile?.product  || "our services";

  const messages = [
    {
      delay: "~10 minutes after adding",
      label: "First message",
      text: `Hi! I'm reaching out on behalf of ${bizName}. Thanks for your interest in ${product} — I'd love to learn more about what you're looking for. When's a good time to chat?`,
    },
    {
      delay: "6 hours later",
      label: "Same-day follow-up",
      text: `Just following up from ${bizName}! Happy to answer any questions about ${product}. Let me know whenever works for you.`,
    },
    {
      delay: "Next day",
      label: "24-hour check-in",
      text: `Hey! Checking back in from ${bizName}. Still interested in ${product}? I can send over more details or a pricing breakdown — just say the word.`,
    },
  ];

  return (
    <div className="wz-preview">
      <div className="wz-preview-header">
        <span className="wz-preview-badge">Preview</span>
        <span className="wz-preview-title">What your leads will receive</span>
      </div>
      <p className="wz-preview-sub">
        Based on your business profile — these exact messages go out automatically once WhatsApp is connected.
      </p>
      <div className="wz-preview-messages">
        {messages.map((m, i) => (
          <div key={i} className="wz-preview-msg">
            <div className="wz-preview-msg-meta">
              <span className="wz-preview-msg-label">{m.label}</span>
              <span className="wz-preview-msg-delay">{m.delay}</span>
            </div>
            <div className="wz-preview-bubble">{m.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const handle = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };
  return (
    <button className="wz-copy-btn" onClick={handle}>
      {copied ? "✓ Copied" : "Copy"}
    </button>
  );
}

function CredentialStep({ token, phoneId, onTokenChange, onPhoneIdChange }) {
  const envBlock = `WA_TOKEN=${token || "your_access_token_here"}\nWA_PHONE_ID=${phoneId || "your_phone_number_id_here"}`;
  const isReady  = token.trim().length > 10 && phoneId.trim().length > 5;

  return (
    <div className="wz-cred-step">
      <p className="wz-cred-intro">
        Paste your credentials here — Jarvis will build the exact config block for you to copy onto your server.
      </p>

      <div className="wz-cred-fields">
        <div className="wz-field">
          <label className="wz-field-label">Access Token</label>
          <input
            className="wz-input"
            type="text"
            placeholder="EAARxxx…"
            value={token}
            onChange={e => onTokenChange(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <span className="wz-field-hint">From WhatsApp → Getting Started → Temporary Access Token</span>
        </div>

        <div className="wz-field">
          <label className="wz-field-label">Phone Number ID</label>
          <input
            className="wz-input"
            type="text"
            placeholder="112345678901234"
            value={phoneId}
            onChange={e => onPhoneIdChange(e.target.value)}
            autoComplete="off"
            inputMode="numeric"
          />
          <span className="wz-field-hint">The numeric ID on the same page — not your phone number</span>
        </div>
      </div>

      <div className="wz-cred-output">
        <p className="wz-cred-output-label">
          {isReady ? "Copy this block onto your server (.env file):" : "Your .env block (fill in fields above):"}
        </p>
        <div className={`wz-code-block${isReady ? " wz-code-block--ready" : ""}`}>
          <pre>{envBlock}</pre>
          <CopyButton text={envBlock} />
        </div>
        <p className="wz-cred-restart-label">Then restart Jarvis:</p>
        <div className="wz-code-block">
          <pre>pm2 restart jarvis-os</pre>
          <CopyButton text="pm2 restart jarvis-os" />
        </div>
      </div>
    </div>
  );
}

export default function WhatsAppSetup({ connected, onBack }) {
  const [testPhone,  setTestPhone]  = useState("");
  const [testResult, setTestResult] = useState(null);
  const [testMsg,    setTestMsg]    = useState("");
  const [testing,    setTesting]    = useState(false);
  const [waToken,    setWaToken]    = useState("");
  const [waPhoneId,  setWaPhoneId]  = useState("");

  const handleTest = async () => {
    if (!testPhone.trim()) { setTestMsg("Enter a WhatsApp number to test."); return; }
    setTesting(true);
    setTestResult(null);
    setTestMsg("");
    const res = await testWhatsAppSend(testPhone.trim());
    setTesting(false);
    if (res.success) {
      setTestResult("ok");
      setTestMsg("Message delivered! WhatsApp is connected and working.");
    } else {
      setTestResult("fail");
      setTestMsg(
        res.error?.includes("not set") || res.error?.includes("401")
          ? "Credentials not found. Complete steps 1–4 above, then restart Jarvis and try again."
          : `Could not send: ${res.error || "Unknown error"}`
      );
    }
  };

  return (
    <div className="wz-wizard">

      <div className="wz-header">
        <button className="wz-back" onClick={onBack}>← Back to Clients</button>
        <h2 className="wz-title">Connect WhatsApp</h2>
        <p className="wz-sub">5 minutes · One-time setup · Free</p>
      </div>

      {connected && (
        <div className="wz-connected-banner">
          <span className="wz-conn-dot" />
          <span>WhatsApp is connected and active. Jarvis is sending follow-ups automatically.</span>
        </div>
      )}

      {!connected && <MessagePreview />}

      {!connected && (
        <div className="wz-steps">

          <div className="wz-step">
            <div className="wz-step-num">1</div>
            <div className="wz-step-body">
              <h3 className="wz-step-title">Create a Meta Developer Account</h3>
              <div className="wz-step-content">
                <p>Go to <strong>developers.facebook.com</strong> and log in with Facebook.</p>
                <p>Click <strong>My Apps → Create App → Business</strong>. Give it any name.</p>
              </div>
              <a href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer" className="wz-link-btn">
                Open Meta Developers ↗
              </a>
            </div>
          </div>

          <div className="wz-step">
            <div className="wz-step-num">2</div>
            <div className="wz-step-body">
              <h3 className="wz-step-title">Add WhatsApp to Your App</h3>
              <div className="wz-step-content">
                <p>Inside your app, click <strong>Add Product → WhatsApp</strong>.</p>
                <p>Go to <strong>WhatsApp → Getting Started</strong>. You'll see a Temporary Access Token — copy it.</p>
                <code className="wz-code">EAARxxx…very long string…xxx</code>
              </div>
            </div>
          </div>

          <div className="wz-step">
            <div className="wz-step-num">3</div>
            <div className="wz-step-body">
              <h3 className="wz-step-title">Copy Your Phone Number ID</h3>
              <div className="wz-step-content">
                <p>On the same <strong>Getting Started</strong> page, find the <strong>Phone Number ID</strong>.</p>
                <p>It's a long number like <code className="wz-code-inline">112345678901234</code> — not your actual phone number.</p>
              </div>
            </div>
          </div>

          <div className="wz-step">
            <div className="wz-step-num">4</div>
            <div className="wz-step-body">
              <h3 className="wz-step-title">Add Credentials to Your Server</h3>
              <div className="wz-step-content">
                <CredentialStep
                  token={waToken}
                  phoneId={waPhoneId}
                  onTokenChange={setWaToken}
                  onPhoneIdChange={setWaPhoneId}
                />
              </div>
            </div>
          </div>

        </div>
      )}

      <div className="wz-test-section">
        <h3 className="wz-test-title">
          {connected ? "Test Your Connection" : "Step 5 — Verify the Connection"}
        </h3>
        <p className="wz-test-desc">
          After restarting Jarvis, enter your own number to confirm messages are sending.
        </p>
        <div className="wz-test-row">
          <input
            className="wz-input"
            placeholder="Your WhatsApp number (e.g. 919876543210)"
            value={testPhone}
            onChange={e => setTestPhone(e.target.value)}
            inputMode="tel"
          />
          <button
            className="wz-test-btn"
            onClick={handleTest}
            disabled={testing || !testPhone.trim()}
          >
            {testing ? "Sending…" : "Send Test"}
          </button>
        </div>
        {testMsg && (
          <div className={`wz-result wz-result--${testResult}`}>
            {testResult === "ok"   && <span className="wz-result-icon">✓</span>}
            {testResult === "fail" && <span className="wz-result-icon">✗</span>}
            {testMsg}
          </div>
        )}
      </div>

    </div>
  );
}
