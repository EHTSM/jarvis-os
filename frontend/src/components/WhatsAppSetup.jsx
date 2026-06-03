import React, { useState, useMemo } from "react";
import { testWhatsAppSend } from "../crmApi";
import { saveWhatsAppCredentials } from "../settingsApi";
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

function CredentialStep({ token, phoneId, onTokenChange, onPhoneIdChange, onSaved }) {
  const [saving,   setSaving]   = useState(false);
  const [saveMsg,  setSaveMsg]  = useState(null);  // null | { ok, text }
  const isReady = token.trim().length > 10 && /^\d{10,20}$/.test(phoneId.trim());

  const handleSave = async () => {
    if (!isReady) return;
    setSaving(true);
    setSaveMsg(null);
    const res = await saveWhatsAppCredentials({ token: token.trim(), phoneId: phoneId.trim() });
    setSaving(false);
    if (res.success) {
      setSaveMsg({ ok: true, text: res.message || "Credentials saved — WhatsApp is now active." });
      onSaved?.();
    } else {
      setSaveMsg({ ok: false, text: res.error || "Failed to save. Check your credentials." });
    }
  };

  return (
    <div className="wz-cred-step">
      <p className="wz-cred-intro">
        Paste your credentials — Ooplix saves them instantly, no server restart needed.
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
          <span className="wz-field-hint">The numeric ID on the same page — not your actual phone number</span>
        </div>
      </div>

      <button
        className="wz-test-btn"
        onClick={handleSave}
        disabled={!isReady || saving}
        style={{ alignSelf: "flex-start", marginTop: 4 }}
      >
        {saving ? "Saving…" : isReady ? "Save Credentials →" : "Fill in both fields above"}
      </button>

      {saveMsg && (
        <div className={`wz-result wz-result--${saveMsg.ok ? "ok" : "fail"}`}>
          <span className="wz-result-icon">{saveMsg.ok ? "✓" : "✗"}</span>
          {saveMsg.text}
        </div>
      )}

      <details className="wz-cred-manual" style={{ marginTop: 12 }}>
        <summary style={{ fontSize: 12, color: "var(--text-faint, #4a5470)", cursor: "pointer" }}>
          Prefer to set manually via .env?
        </summary>
        <div style={{ marginTop: 8 }}>
          <div className="wz-code-block">
            <pre>{`WA_TOKEN=${token || "your_access_token_here"}\nWA_PHONE_ID=${phoneId || "your_phone_number_id_here"}`}</pre>
            <CopyButton text={`WA_TOKEN=${token || "your_access_token_here"}\nWA_PHONE_ID=${phoneId || "your_phone_number_id_here"}`} />
          </div>
          <p className="wz-cred-restart-label">Then restart: <code>pm2 restart jarvis-os</code></p>
        </div>
      </details>
    </div>
  );
}

export default function WhatsAppSetup({ connected, onBack, onCredentialsSaved }) {
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
          ? "Credentials not found. Complete steps 1–4 above, then restart Ooplix and try again."
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
          <span>WhatsApp is connected and active. Ooplix is sending follow-ups automatically.</span>
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
                  onSaved={onCredentialsSaved}
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
          After restarting Ooplix, enter your own number to confirm messages are sending.
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
