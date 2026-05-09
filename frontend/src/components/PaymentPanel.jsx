import React, { useState, useEffect, useCallback } from "react";
import { generatePaymentLink, sendFollowUp, getLeads } from "../api";
import AddClientForm  from "./AddClientForm.jsx";
import WhatsAppSetup  from "./WhatsAppSetup.jsx";
import "./PaymentPanel.css";

const STATUS_LABEL = {
  new:       "New",
  hot:       "Hot",
  paid:      "Paid",
  onboarded: "Active",
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
          <p className="pls-title">Payment link ready for {name}</p>
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

export default function Clients({ onMessage, whatsappConnected }) {
  const [view,    setView]    = useState("main");   // "main" | "setup"
  const [form,    setForm]    = useState({ name: "", phone: "", amount: "999", description: "JARVIS AI Access" });
  const [link,    setLink]    = useState(null);     // null | { url, name, phone }
  const [genLoad, setGenLoad] = useState(false);
  const [leads,   setLeads]   = useState(null);
  const [leadsLoading, setLeadsLoading] = useState(true);
  const [followupPhone, setFollowupPhone] = useState("");
  const [followupMsg,   setFollowupMsg]   = useState("Hey! Just checking in — ready to get started with JARVIS AI?");
  const [fuLoad,  setFuLoad]  = useState(false);

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
      } else {
        onMessage("error", res.error || "Could not generate link. Check that payments are configured.");
      }
    } catch (err) {
      onMessage("error", err.message);
    } finally {
      setGenLoad(false);
    }
  };

  const handleFollowup = async () => {
    if (!followupPhone) { onMessage("error", "Enter a phone number."); return; }
    setFuLoad(true);
    try {
      const res = await sendFollowUp(followupPhone, followupMsg);
      if (res.success) {
        onMessage("system", `Follow-up sent to ${followupPhone}`);
        setFollowupPhone("");
      } else {
        onMessage("error", res.error || "Failed to send. Check WhatsApp is connected.");
      }
    } catch (err) {
      onMessage("error", err.message);
    } finally {
      setFuLoad(false);
    }
  };

  const handleQuickFollowup = (phone) => {
    setFollowupPhone(phone);
    document.getElementById("followup-phone")?.focus();
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
            <span className="wa-banner-icon">📵</span>
            <div>
              <p className="wa-banner-title">WhatsApp not connected</p>
              <p className="wa-banner-sub">Auto follow-ups won't send until WhatsApp is set up.</p>
            </div>
          </div>
          <button className="wa-banner-btn" onClick={() => setView("setup")}>
            Set up →
          </button>
        </div>
      )}

      {/* ── Payment link generator ────────────────────────────────── */}
      <section className="panel-section">
        <h3 className="section-heading">Generate Payment Link</h3>
        <div className="form-grid">
          <input className="p-input" placeholder="Customer name *" value={form.name}
            onChange={e => set("name", e.target.value)} />
          <input className="p-input" placeholder="Phone (with country code)" value={form.phone}
            onChange={e => set("phone", e.target.value)} />
          <input className="p-input" placeholder="Amount (₹) *" value={form.amount}
            onChange={e => set("amount", e.target.value)} type="number" />
          <input className="p-input" placeholder="Description" value={form.description}
            onChange={e => set("description", e.target.value)} />
        </div>
        <button className="p-btn primary" onClick={handleGenerate} disabled={genLoad}>
          {genLoad ? "Creating link…" : "Generate Link"}
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

      {/* ── WhatsApp follow-up ────────────────────────────────────── */}
      <section className="panel-section">
        <h3 className="section-heading">Send WhatsApp Follow-up</h3>
        <div className="form-grid">
          <input
            id="followup-phone"
            className="p-input"
            placeholder="Phone with country code (e.g. 919876543210)"
            value={followupPhone}
            onChange={e => setFollowupPhone(e.target.value)}
          />
          <input className="p-input" placeholder="Message"
            value={followupMsg} onChange={e => setFollowupMsg(e.target.value)} />
        </div>
        <button className="p-btn secondary" onClick={handleFollowup} disabled={fuLoad || !followupPhone}>
          {fuLoad ? "Sending…" : "Send Follow-up"}
        </button>
      </section>

      {/* ── Client list ───────────────────────────────────────────── */}
      <section className="panel-section">
        <div className="leads-header">
          <h3 className="section-heading" style={{ margin: 0 }}>Your Clients</h3>
          <button className="p-btn outline" onClick={loadLeads} disabled={leadsLoading}>
            {leadsLoading ? "…" : "Refresh"}
          </button>
        </div>

        {leadsLoading ? (
          <p className="no-leads">Loading clients…</p>
        ) : leads === null || leads.length === 0 ? (
          <div className="leads-empty">
            <span className="leads-empty-icon">📭</span>
            <p className="leads-empty-title">No clients yet</p>
            <p className="leads-empty-sub">
              Add a client above — JARVIS will automatically follow up with them on WhatsApp.
            </p>
          </div>
        ) : (
          <table className="leads-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Status</th>
                <th>Added</th>
                <th></th>
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
                  <td>
                    {l.phone && l.status !== "paid" && l.status !== "onboarded" && (
                      <button className="fu-btn" onClick={() => handleQuickFollowup(l.phone)}>
                        Follow up
                      </button>
                    )}
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
