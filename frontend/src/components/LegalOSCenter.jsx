"use strict";
// Pre-Burn-In Certification: Legal OS console — legalDocumentEngine.cjs
// (V6 Phase 6) was fully built (real AI-drafted NDA/DPA/MSA/SOW/offer/
// vendor generation, real status lifecycle) with zero frontend consumers.
import React, { useState, useEffect, useCallback } from "react";
import * as legalApi from "../legalApi";

const STATUS_COLOR = { draft: "#8994b0", under_review: "#f0b429", approved: "#5dc8f5", signed: "#52d68a", archived: "#666" };

export default function LegalOSCenter() {
  const [types, setTypes] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [form, setForm] = useState({ type: "", partyA: "", partyB: "" });
  const [busy, setBusy] = useState(null);

  const refresh = useCallback(() => {
    setLoading(true);
    Promise.all([
      legalApi.listDocumentTypes().catch(e => ({ ok: false, error: e.message })),
      legalApi.listDocuments({ limit: 50 }).catch(e => ({ ok: false, error: e.message })),
    ]).then(([t, d]) => {
      if (t?.ok !== false) { setTypes(t.types || []); if (!form.type && t.types?.[0]) setForm(f => ({ ...f, type: t.types[0].id })); }
      if (d?.ok !== false) setDocuments(d.documents || []);
      setError(t?.ok === false ? (t.error || "Failed to load document types") : null);
    }).finally(() => setLoading(false));
  }, []); // eslint-disable-line

  useEffect(() => { refresh(); }, [refresh]);

  const generate = async (e) => {
    e.preventDefault();
    if (!form.type) return;
    setGenerating(true);
    try {
      const r = await legalApi.generateDocument({ type: form.type, params: { partyA: form.partyA, partyB: form.partyB } });
      if (r.ok === false) { setError(r.error || "Generation failed"); return; }
      setForm(f => ({ ...f, partyA: "", partyB: "" }));
      refresh();
    } finally {
      setGenerating(false);
    }
  };

  const advance = async (docId, status) => {
    setBusy(docId);
    try { await legalApi.updateStatus(docId, status); refresh(); }
    finally { setBusy(null); }
  };

  if (loading && documents.length === 0 && types.length === 0) return <div style={{ padding: 24, color: "var(--text-dim, #8994b0)" }}>Loading Legal OS…</div>;

  return (
    <div style={{ padding: 20, maxWidth: 900, margin: "0 auto" }}>
      {/* Phase A.11.8 — page header recovered to the app-wide baseline, exactly
          as A.11.7 did for the identically-shaped CustomerSuccessCenter header
          in this same inline-styled family. Measured here before the fix:
          18px / 700 / normal tracking, no subtitle. The baseline measured across
          .oac-/.tw-/.ws-/.bd-/.launch-/.sc-/.mc-title is
          22px / 800 / -0.3px / var(--text) with a 13.5px var(--text-dim)
          subtitle. Values copied from that baseline; nothing redesigned. */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: "-0.3px", color: "var(--text)" }}>Legal OS</h2>
          <p style={{ margin: "4px 0 0", fontSize: 13.5, color: "var(--text-dim)" }}>
            Generate and track NDAs, DPAs, service agreements, and offer letters.
          </p>
        </div>
        <button onClick={refresh} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
      </div>

      {error && <div style={{ color: "#f55b5b", marginBottom: 12, fontSize: 12 }}>⚠ {error}</div>}

      <div style={{ fontSize: 11, color: "var(--text-dim, #8994b0)", marginBottom: 16, background: "rgba(240,180,41,0.08)", padding: "8px 10px", borderRadius: 5 }}>
        AI-drafted documents are a starting point, not legal advice — have a real lawyer review before use.
      </div>

      <form onSubmit={generate} style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
          {types.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <input placeholder="Party A" value={form.partyA} onChange={e => setForm(f => ({ ...f, partyA: e.target.value }))} />
        <input placeholder="Party B" value={form.partyB} onChange={e => setForm(f => ({ ...f, partyB: e.target.value }))} />
        <button type="submit" disabled={generating || !form.type}>{generating ? "Drafting…" : "Generate"}</button>
      </form>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {documents.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--text-dim, #8994b0)" }}>No documents yet.</div>
        ) : documents.map(d => (
          <div key={d.docId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", background: "rgba(255,255,255,0.03)", borderRadius: 5, fontSize: 12 }}>
            <span>{d.title || d.type}</span>
            <span style={{ color: STATUS_COLOR[d.status] || "#8994b0" }}>{d.status}</span>
            <div style={{ display: "flex", gap: 4 }}>
              {(d.status === "draft") && <button disabled={busy === d.docId} onClick={() => advance(d.docId, "under_review")}>Send for review</button>}
              {(d.status === "under_review") && <button disabled={busy === d.docId} onClick={() => advance(d.docId, "approved")}>Approve</button>}
              {(d.status === "approved") && <button disabled={busy === d.docId} onClick={() => advance(d.docId, "signed")}>Mark signed</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
