import React from "react";
import "./ProgressBar.css";

/**
 * Thin indeterminate progress bar shown at the top of the viewport while loading.
 */
export default function ProgressBar({ visible }) {
  if (!visible) return null;
  return (
    <div className="progress-bar" role="progressbar" aria-label="Loading" aria-busy="true">
      <div className="progress-bar-fill" />
    </div>
  );
}
