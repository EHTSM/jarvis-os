import React, { useMemo } from "react";
import { useAnimatedValue } from "../hooks/useAnimatedValue";
import "./ExecutiveSummary.css";

// ── Animated number tile ─────────────────────────────────────────────
function ExecTile({ label, value, rawValue, unit = "", color, icon, sub, trend }) {
  const animated = useAnimatedValue(typeof rawValue === "number" ? rawValue : 0, 900);
  const display  = typeof rawValue === "number" ? animated : value;

  const trendClass = trend > 0 ? "exec-tile--up"
                   : trend < 0 ? "exec-tile--down"
                   : "";

  return (
    <div className={`exec-tile ${trendClass}`}>
      <div className="exec-tile-header">
        <span className="exec-tile-icon" aria-hidden="true">{icon}</span>
        <span className="exec-tile-label">{label}</span>
      </div>
      <div className="exec-tile-value">
        {unit === "prefix" ? (
          <>
            <span className="exec-tile-unit-prefix">₹</span>
            <span className="exec-tile-num" style={{ color }}>{display.toLocaleString("en-IN")}</span>
          </>
        ) : (
          <span className="exec-tile-num" style={{ color }}>{display}{unit}</span>
        )}
      </div>
      {sub && <span className="exec-tile-sub">{sub}</span>}
    </div>
  );
}

// ── Root ─────────────────────────────────────────────────────────────
export default function ExecutiveSummary({ stats, opsData, online }) {
  const revenue     = stats?.revenue   ?? 0;
  const leads       = stats?.total     ?? 0;
  const hot         = stats?.hot       ?? 0;
  const paid        = stats?.paid      ?? 0;

  const autoStats   = opsData?.automation || {};
  const totalSent   = useMemo(
    () => Object.values(autoStats).reduce((s, d) => s + (d.sent || 0), 0),
    [autoStats]
  );
  const activeSeqs  = Object.keys(autoStats).length;

  const status      = opsData?.status || (online ? "ok" : "offline");
  const uptime      = opsData?.uptime?.human || null;
  const errRate     = opsData?.errors?.errors_per_hour ?? 0;
  const qPending    = opsData?.queue?.counts?.pending ?? 0;
  const activeSys   = opsData?.services
    ? Object.values(opsData.services).filter(Boolean).length
    : 0;

  const healthColor = status === "ok"       ? "var(--success)"
                    : status === "degraded" ? "var(--warning)"
                    : status === "critical" ? "var(--danger)"
                    : "var(--text-faint)";

  const healthLabel = status === "ok"       ? "Healthy"
                    : status === "degraded" ? "Degraded"
                    : status === "critical" ? "Critical"
                    : "Offline";

  return (
    <div className="exec-summary animate-fade-up">
      <div className="exec-summary-bar">

        <ExecTile
          label="Revenue"
          rawValue={revenue}
          value={`₹${revenue.toLocaleString("en-IN")}`}
          unit="prefix"
          color="var(--success)"
          icon="✦"
          sub={paid > 0 ? `${paid} paid` : "No payments yet"}
        />

        <ExecTile
          label="Leads"
          rawValue={leads}
          value={String(leads)}
          color="var(--accent)"
          icon="◈"
          sub={hot > 0 ? `${hot} hot` : "Pipeline empty"}
        />

        <ExecTile
          label="Automations"
          rawValue={totalSent}
          value={String(totalSent)}
          color="var(--accent2)"
          icon="◎"
          sub={activeSeqs > 0 ? `${activeSeqs} sequence${activeSeqs !== 1 ? "s" : ""} active` : "None running"}
        />

        <ExecTile
          label="Runtime"
          value={healthLabel}
          color={healthColor}
          icon="◇"
          sub={uptime ? `Up ${uptime}` : online ? "Live" : "Offline"}
        />

        <ExecTile
          label="Systems"
          rawValue={activeSys}
          value={String(activeSys)}
          color={activeSys > 0 ? "var(--info)" : "var(--text-faint)"}
          icon="⊞"
          sub={errRate > 0 ? `${errRate} err/hr` : `${qPending} queued`}
        />

      </div>
    </div>
  );
}
