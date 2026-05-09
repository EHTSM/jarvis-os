import React, { useState } from "react";
import { testWhatsAppSend } from "../api";
import "./WhatsAppSetup.css";

const STEPS = [
  {
    num: 1,
    title: "Create a Meta Developer Account",
    body: (
      <>
        <p>Go to <strong>developers.facebook.com</strong> and log in with your Facebook account.</p>
        <p>Click <strong>"My Apps"</strong> → <strong>"Create App"</strong> → choose <strong>"Business"</strong> type.</p>
        <p>Give your app a name (e.g. "My Business Bot") and click <strong>Create App</strong>.</p>
      </>
    ),
    action: {
      label: "Open Meta Developers ↗",
      href:  "https://developers.facebook.com/apps",
    }
  },
  {
    num: 2,
    title: "Set Up WhatsApp in Your App",
    body: (
      <>
        <p>Inside your app dashboard, click <strong>"Add Product"</strong> and select <strong>WhatsApp</strong>.</p>
        <p>Go to <strong>WhatsApp → Getting Started</strong>.</p>
        <p>You'll see a <strong>Temporary Access Token</strong> — copy it. It looks like:</p>
        <code className="wz-code">EAARxxx...very long string...xxx</code>
        <p style={{ marginTop: 10 }}>
          For production, generate a <strong>Permanent Token</strong> via System Users in Business Manager.
        </p>
      </>
    ),
  },
  {
    num: 3,
    title: "Get Your Phone Number ID",
    body: (
      <>
        <p>On the same <strong>Getting Started</strong> page, find the <strong>Phone Number ID</strong>.</p>
        <p>It's a long number, e.g. <code className="wz-code-inline">112345678901234</code></p>
        <p>This is different from your actual WhatsApp number — it's the identifier Meta uses.</p>
      </>
    ),
  },
  {
    num: 4,
    title: "Add Credentials to Your Server",
    body: (
      <>
        <p>On your server, edit your <code className="wz-code-inline">.env</code> file and add:</p>
        <div className="wz-code-block">
          <pre>{`WA_TOKEN=your_access_token_here\nWA_PHONE_ID=your_phone_number_id_here`}</pre>
          <CopyButton text={"WA_TOKEN=your_access_token_here\nWA_PHONE_ID=your_phone_number_id_here"} />
        </div>
        <p style={{ marginTop: 10 }}>Then restart JARVIS:</p>
        <div className="wz-code-block">
          <pre>pm2 restart jarvis-os</pre>
          <CopyButton text="pm2 restart jarvis-os" />
        </div>
      </>
    ),
  },
];

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

export default function WhatsAppSetup({ connected, onBack }) {
  const [testPhone,  setTestPhone]  = useState("");
  const [testResult, setTestResult] = useState(null);  // null | "ok" | "fail"
  const [testMsg,    setTestMsg]    = useState("");
  const [testing,    setTesting]    = useState(false);

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
          ? "Credentials not found. Follow steps 1–4 above, then restart JARVIS."
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

      {/* ── Already connected state ─────────────────────────────── */}
      {connected && (
        <div className="wz-connected-banner">
          <span className="wz-conn-dot" />
          <span>WhatsApp is connected and active. JARVIS is sending follow-ups automatically.</span>
        </div>
      )}

      {/* ── Steps ──────────────────────────────────────────────── */}
      {!connected && (
        <div className="wz-steps">
          {STEPS.map((step, i) => (
            <div key={i} className="wz-step">
              <div className="wz-step-num">{step.num}</div>
              <div className="wz-step-body">
                <h3 className="wz-step-title">{step.title}</h3>
                <div className="wz-step-content">{step.body}</div>
                {step.action && (
                  <a
                    href={step.action.href}
                    target="_blank"
                    rel="noreferrer"
                    className="wz-link-btn"
                  >
                    {step.action.label}
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Test connection ─────────────────────────────────────── */}
      <div className="wz-test-section">
        <h3 className="wz-test-title">
          {connected ? "Test Your Connection" : "Step 5 — Test the Connection"}
        </h3>
        <p className="wz-test-desc">
          Enter your own WhatsApp number to confirm everything is working.
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
            {testResult === "ok" && <span className="wz-result-icon">✓</span>}
            {testResult === "fail" && <span className="wz-result-icon">✗</span>}
            {testMsg}
          </div>
        )}
      </div>

    </div>
  );
}
