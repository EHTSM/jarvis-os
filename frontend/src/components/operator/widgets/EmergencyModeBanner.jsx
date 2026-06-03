import React from "react";

export const EmergencyModeBanner = React.memo(({ rtStatus, degraded }) => {
  const emergency   = rtStatus?.emergency;
  const quarantine  = emergency?.quarantine;
  const isEmergency = emergency?.active;
  const isDegraded  = degraded;

  if (!isEmergency && !quarantine && !isDegraded) return null;

  if (isEmergency) {
    return (
      <div className="op-emergency-banner op-emergency-banner--critical">
        <span className="op-emergency-banner-icon">⛔</span>
        <span className="op-emergency-banner-text">
          EXECUTION HALTED
          {emergency.reason ? ` — ${emergency.reason}` : ""}
        </span>
        <span className="op-emergency-banner-hint">Resume from the Governor panel</span>
      </div>
    );
  }

  if (quarantine) {
    return (
      <div className="op-emergency-banner op-emergency-banner--warn">
        <span className="op-emergency-banner-icon">🔒</span>
        <span className="op-emergency-banner-text">
          QUARANTINE — new dispatches blocked
          {emergency?.quarantineReason ? ` (${emergency.quarantineReason})` : ""}
        </span>
        <span className="op-emergency-banner-hint">POST /runtime/quarantine/exit to resume</span>
      </div>
    );
  }

  if (isDegraded) {
    return (
      <div className="op-emergency-banner op-emergency-banner--info">
        <span className="op-emergency-banner-icon">⚠</span>
        <span className="op-emergency-banner-text">
          RUNTIME DEGRADED — high memory, non-critical events suppressed
        </span>
        <span className="op-emergency-banner-hint">Heap pressure will auto-resolve when memory drops</span>
      </div>
    );
  }

  return null;
});
