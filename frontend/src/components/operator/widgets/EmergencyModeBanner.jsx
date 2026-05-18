import React from "react";

export const EmergencyModeBanner = React.memo(({ rtStatus }) => {
  if (!rtStatus?.emergency?.active) return null;

  return (
    <div className="op-emergency-banner">
      <span className="op-emergency-banner-icon">⚠</span>
      <span className="op-emergency-banner-text">
        EXECUTION HALTED
        {rtStatus.emergency.reason ? ` — ${rtStatus.emergency.reason}` : ""}
      </span>
      <span className="op-emergency-banner-hint">Resume from the Governor panel</span>
    </div>
  );
});
