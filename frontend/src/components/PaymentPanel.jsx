import React, { useState, useEffect, useCallback } from "react";
import { generatePaymentLink, getLeads } from "../api";
import AddClientForm  from "./AddClientForm.jsx";
import WhatsAppSetup  from "./WhatsAppSetup.jsx";
import "./PaymentPanel.css";

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
      return { name: "", phone: "", amount: amt, description: "Jarvis Access" };
    } catch {
      return { name: "", phone: "", amount: "999", description: "Jarvis Access" };
    }
  });
  const [link,    setLink]    = useState(null);     // null | { url, name, phone }
  const [genLoad, setGenLoad] = useState(false);
  const [leads,   setLeads]   = useState(null);
  const [leadsLoading, setLeadsLoading] = useState(true);

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
        const msg = res.error || "Could not generate link. Check Razorpay credentials in .env";
        onMessage("error", msg);
        onToast?.("error", msg.slice(0, 72));
      }
    } catch (err) {
      onMessage("error", err.message);
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
              <p className="wa-banner-sub">Jarvis will automatically message your leads once WhatsApp is connected.</p>
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
              Add your first client above — Jarvis will start following up automatically.
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
