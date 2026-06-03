import React, { useState, useEffect, useCallback } from "react";
import { generatePaymentLink, getLeads } from "../api";
import AddClientForm  from "./AddClientForm.jsx";
import WhatsAppSetup  from "./WhatsAppSetup.jsx";
import "./PaymentPanel.css";

function PaymentSetupGuide({ onDismiss }) {
  return (
    <div className="pay-setup-guide">
      <div className="pay-setup-guide-header">
        <span className="pay-setup-guide-icon">💳</span>
        <div>
          <p className="pay-setup-guide-title">Set up Razorpay to collect payments</p>
          <p className="pay-setup-guide-sub">Free account · Takes 5 minutes · ₹0 until you charge someone</p>
        </div>
        <button className="pay-setup-guide-dismiss" onClick={onDismiss}>✕</button>
      </div>
      <div className="pay-setup-guide-steps">
        <div className="pay-setup-guide-step">
          <span className="pay-setup-step-num">1</span>
          <div>
            <p className="pay-setup-step-title">Create a free Razorpay account</p>
            <p className="pay-setup-step-desc">Sign up at razorpay.com — you can test in sandbox mode immediately, no business verification needed to start.</p>
            <a href="https://dashboard.razorpay.com/signup" target="_blank" rel="noreferrer" className="pay-setup-step-link">
              Create Razorpay account ↗
            </a>
          </div>
        </div>
        <div className="pay-setup-guide-step">
          <span className="pay-setup-step-num">2</span>
          <div>
            <p className="pay-setup-step-title">Copy your API keys</p>
            <p className="pay-setup-step-desc">Dashboard → Settings → API Keys → Generate Test Key. You'll get a Key ID (starts with <code>rzp_test_</code>) and Key Secret.</p>
          </div>
        </div>
        <div className="pay-setup-guide-step">
          <span className="pay-setup-step-num">3</span>
          <div>
            <p className="pay-setup-step-title">Add keys to your server .env</p>
            <p className="pay-setup-step-desc">On your server, add these two lines then restart JARVIS:</p>
            <div className="pay-setup-code">
              <code>RAZORPAY_KEY_ID=rzp_test_your_key_here</code>
              <code>RAZORPAY_KEY_SECRET=your_secret_here</code>
              <code>pm2 restart jarvis-os</code>
            </div>
          </div>
        </div>
      </div>
      <p className="pay-setup-guide-note">
        Test mode links are real Razorpay links — you can test the full payment flow without charging anyone.
        Switch to live keys when you're ready to collect real payments.
      </p>
    </div>
  );
}

const STATUS_LABEL = {
  new:       "New lead",
  hot:       "Hot",
  paid:      "Paid",
  onboarded: "Onboarded",
};

function PayLinkSuccess({ link, name, phone, onDismiss }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const waText = encodeURIComponent(`Hi ${name}! Here's your payment link: ${link}`);
  const waUrl  = `https://wa.me/${phone}?text=${waText}`;

  return (
    <div className="pls-card">
      <div className="pls-top">
        <span className="pls-check">✓</span>
        <div>
          <p className="pls-title">Checkout link ready for {name}</p>
          <p className="pls-sub">Share it via WhatsApp or copy the link below.</p>
        </div>
        <button className="pls-dismiss" onClick={onDismiss}>✕</button>
      </div>
      <div className="pls-link-row">
        <span className="pls-link-text">{link}</span>
        <button className="pls-copy-btn" onClick={handleCopy}>
          {copied ? "✓ Copied" : "Copy"}
        </button>
      </div>
      <div className="pls-actions">
        {phone && (
          <a
            href={waUrl}
            target="_blank"
            rel="noreferrer"
            className="pls-wa-btn"
          >
            Share on WhatsApp ↗
          </a>
        )}
      </div>
    </div>
  );
}

export default function Clients({ onMessage, onToast, whatsappConnected }) {
  const [view,    setView]    = useState("main");   // "main" | "setup"
  const [form,    setForm]    = useState(() => {
    try {
      const p = JSON.parse(localStorage.getItem("jarvis_biz_profile") || "null");
      const amt = p?.price?.replace(/[^\d]/g, "") || "999";
      // Use the user's own product name as description — not Jarvis branding
      return { name: "", phone: "", amount: amt, description: p?.product || "" };
    } catch {
      return { name: "", phone: "", amount: "999", description: "" };
    }
  });
  const [link,         setLink]         = useState(null);
  const [genLoad,      setGenLoad]      = useState(false);
  const [leads,        setLeads]        = useState(null);
  const [leadsLoading, setLeadsLoading] = useState(true);
  const [showPaySetup, setShowPaySetup] = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const loadLeads = useCallback(async () => {
    setLeadsLoading(true);
    try {
      const data = await getLeads();
      setLeads(Array.isArray(data) ? data : []);
    } catch {
      setLeads([]);
    } finally {
      setLeadsLoading(false);
    }
  }, []);

  useEffect(() => { loadLeads(); }, [loadLeads]);

  const handleGenerate = async () => {
    if (!form.name || !form.amount) {
      onMessage("error", "Customer name and amount are required.");
      return;
    }
    setGenLoad(true);
    setLink(null);
    try {
      const res = await generatePaymentLink(form);
      if (res.success && res.link) {
        setLink({ url: res.link, name: form.name, phone: form.phone });
        setForm(f => ({ ...f, name: "", phone: "" }));
        onToast?.("success", `Checkout link created for ${form.name}`);
      } else {
        const rawErr = res.error || "";
        const msg = /unauthorized|forbidden|401|403/i.test(rawErr)
          ? "Session expired — please refresh the page and sign in again."
          : /razorpay|credentials|key|not configured|disabled/i.test(rawErr)
          ? (() => { setShowPaySetup(true); return "Payments not configured — see setup guide below."; })()
          : rawErr || "Could not generate link. Please try again.";
        onMessage("error", msg);
        onToast?.("error", msg.slice(0, 72));
      }
    } catch (err) {
      const msg = /unauthorized|forbidden/i.test(err.message)
        ? "Session expired — please refresh the page and sign in again."
        : err.message;
      onMessage("error", msg);
    } finally {
      setGenLoad(false);
    }
  };


  // ── WhatsApp setup view ───────────────────────────────────────────
  if (view === "setup") {
    return (
      <WhatsAppSetup
        connected={whatsappConnected}
        onBack={() => setView("main")}
      />
    );
  }

  // ── Main view ─────────────────────────────────────────────────────
  return (
    <div className="payment-panel">

      {/* ── Add client form ───────────────────────────────────────── */}
      <AddClientForm
        whatsappConnected={whatsappConnected}
        onSuccess={loadLeads}
      />

      {/* ── WhatsApp not connected banner ─────────────────────────── */}
      {!whatsappConnected && (
        <div className="wa-setup-banner">
          <div className="wa-banner-left">
            <span className="wa-banner-icon">✉️</span>
            <div>
              <p className="wa-banner-title">Connect WhatsApp to enable follow-ups</p>
              <p className="wa-banner-sub">JARVIS will automatically message your leads once WhatsApp is connected.</p>
            </div>
          </div>
          <button className="wa-banner-btn" onClick={() => setView("setup")}>
            Connect WhatsApp
          </button>
        </div>
      )}

      {/* ── Payment link generator ────────────────────────────────── */}
      <section className="panel-section">
        <h3 className="section-heading">Send a payment link</h3>
        <div className="form-grid">
          <input className="p-input" placeholder="Customer Name *" value={form.name}
            onChange={e => set("name", e.target.value)} />
          <input className="p-input" placeholder="WhatsApp Number (with country code)" value={form.phone}
            onChange={e => set("phone", e.target.value)} />
          <input className="p-input" placeholder="Amount (₹) *" value={form.amount}
            onChange={e => set("amount", e.target.value)} type="number" />
          <input className="p-input" placeholder="Description" value={form.description}
            onChange={e => set("description", e.target.value)} />
        </div>
        <button className="p-btn primary" onClick={handleGenerate} disabled={genLoad}>
          {genLoad ? "Creating link…" : "Create Link"}
        </button>

        {link && (
          <PayLinkSuccess
            link={link.url}
            name={link.name}
            phone={link.phone}
            onDismiss={() => setLink(null)}
          />
        )}

        {showPaySetup && (
          <PaymentSetupGuide onDismiss={() => setShowPaySetup(false)} />
        )}
      </section>


      {/* ── Client list ───────────────────────────────────────────── */}
      <section className="panel-section">
        <div className="leads-header">
          <h3 className="section-heading" style={{ margin: 0 }}>
            Your Clients
            {leads && leads.length > 0 && (
              <span className="section-count">{leads.length}</span>
            )}
          </h3>
          <button className="p-btn outline" onClick={loadLeads} disabled={leadsLoading}>
            {leadsLoading ? "…" : "Refresh"}
          </button>
        </div>

        {leadsLoading ? (
          <div className="leads-loading">
            <div className="leads-skeleton" />
            <div className="leads-skeleton leads-skeleton--sm" />
            <div className="leads-skeleton" />
          </div>
        ) : leads === null || leads.length === 0 ? (
          <div className="leads-empty">
            <span className="leads-empty-icon">📭</span>
            <p className="leads-empty-title">No clients yet</p>
            <p className="leads-empty-sub">
              Add your first client above — JARVIS will start following up automatically.
            </p>
          </div>
        ) : (
          <table className="leads-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>WhatsApp Number</th>
                <th>Status</th>
                <th>Date Added</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l, i) => (
                <tr key={i}>
                  <td>{l.name || "—"}</td>
                  <td className="td-phone">{l.phone || "—"}</td>
                  <td>
                    <span className={`badge badge--${l.status}`}>
                      {STATUS_LABEL[l.status] || l.status || "new"}
                    </span>
                  </td>
                  <td className="td-date">
                    {l.createdAt
                      ? new Date(l.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>


    </div>
  );
}
