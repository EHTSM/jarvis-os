import React from "react";

// Shown whenever a panel is still displaying its illustrative seed data
// because the real backend endpoint returned nothing yet (fresh install,
// no deployments/alerts/cycles recorded) — without this, fabricated
// example rows (fake commit hashes, fake alert messages, fake execution
// chains) are visually indistinguishable from genuinely live data.
export default function SampleDataNotice({ label = "sample data" }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 12px",
        marginBottom: 10,
        borderRadius: 6,
        background: "rgba(240, 180, 41, 0.12)",
        border: "1px solid rgba(240, 180, 41, 0.35)",
        color: "#f0b429",
        fontSize: 12,
        fontWeight: 500,
      }}
    >
      <span aria-hidden="true">◐</span>
      <span>Showing {label} — no live records yet from your backend.</span>
    </div>
  );
}
