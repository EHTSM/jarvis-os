import React, { useState } from "react";
import { generatePaymentLink, sendFollowUp, getLeads } from "../api";
import "./PaymentPanel.css";

export default function PaymentPanel({ onMessage }) {
  const [form, setForm]     = useState({ name: "", phone: "", amount: "999", description: "JARVIS AI Access" });
  const [link, setLink]     = useState("");
  const [loading, setLoading] = useState(false);
  const [leads, setLeads]   = useState([]);
  const [leadsLoaded, setLeadsLoaded] = useState(false);
  const [followupPhone, setFollowupPhone] = useState("");
  const [followupMsg, setFollowupMsg]     = useState("Hey! Just following up — ready to automate your business?");

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleGenerate = async () => {
    if (!form.name || !form.amount) return onMessage("error", "Name and amount are required.");
    setLoading(true);
    setLink("");
    try {
      const res = await generatePaymentLink(form);
      if (res.success && res.link) {
        setLink(res.link);
        onMessage("system", `Payment link created: ${res.link}`);
      } else {
        onMessage("error", res.error || "Failed to generate link.");
      }
    } catch (err) {
      onMessage("error", err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleFollowup = async () => {
    if (!followupPhone) return onMessage("error", "Enter a phone number.");
    const res = await sendFollowUp(followupPhone, followupMsg);
    if (res.success) onMessage("system", `Follow-up sent to ${followupPhone}`);
    else              onMessage("error",  res.error || "Failed to send.");
  };

  const handleLoadLeads = async () => {
    const data = await getLeads();
    setLeads(Array.isArray(data) ? data : []);
    setLeadsLoaded(true);
  };

  return (
    <div className="payment-panel">

      {/* Payment link generator */}
      <section className="panel-section">
        <h3 className="section-heading">Generate Payment Link</h3>
        <div className="form-grid">
          <input className="p-input" placeholder="Customer name *" value={form.name}        onChange={e => set("name",        e.target.value)} />
          <input className="p-input" placeholder="Phone (with country code)" value={form.phone} onChange={e => set("phone",   e.target.value)} />
          <input className="p-input" placeholder="Amount (₹) *"  value={form.amount}       onChange={e => set("amount",       e.target.value)} type="number" />
          <input className="p-input" placeholder="Description"    value={form.description}  onChange={e => set("description", e.target.value)} />
        </div>
        <button className="p-btn primary" onClick={handleGenerate} disabled={loading}>
          {loading ? "Generating..." : "Generate Link"}
        </button>

        {link && (
          <div className="link-box">
            <span className="link-label">Payment Link:</span>
            <a href={link} target="_blank" rel="noreferrer" className="link-url">{link}</a>
            <button className="copy-btn" onClick={() => navigator.clipboard.writeText(link)}>Copy</button>
          </div>
        )}
      </section>

      {/* Follow-up sender */}
      <section className="panel-section">
        <h3 className="section-heading">Send WhatsApp Follow-up</h3>
        <div className="form-grid">
          <input className="p-input" placeholder="Phone number" value={followupPhone} onChange={e => setFollowupPhone(e.target.value)} />
          <input className="p-input" placeholder="Message"       value={followupMsg}  onChange={e => setFollowupMsg(e.target.value)} />
        </div>
        <button className="p-btn secondary" onClick={handleFollowup}>Send Follow-up</button>
      </section>

      {/* CRM leads */}
      <section className="panel-section">
        <div className="leads-header">
          <h3 className="section-heading" style={{ margin: 0 }}>CRM Leads</h3>
          <button className="p-btn outline" onClick={handleLoadLeads}>Load Leads</button>
        </div>

        {leadsLoaded && (
          leads.length === 0
            ? <p className="no-leads">No leads in CRM yet.</p>
            : (
              <table className="leads-table">
                <thead>
                  <tr><th>Name</th><th>Phone</th><th>Status</th><th>Created</th></tr>
                </thead>
                <tbody>
                  {leads.map((l, i) => (
                    <tr key={i}>
                      <td>{l.name || "—"}</td>
                      <td>{l.phone}</td>
                      <td><span className={`badge badge--${l.status}`}>{l.status}</span></td>
                      <td>{l.createdAt ? new Date(l.createdAt).toLocaleDateString() : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
        )}
      </section>

    </div>
  );
}
