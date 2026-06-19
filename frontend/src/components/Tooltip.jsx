import React, { useState, useRef, useCallback } from "react";
import "./Tooltip.css";

export default function Tooltip({ children, label, placement = "bottom", delay = 400 }) {
  const [visible, setVisible] = useState(false);
  const timer = useRef(null);

  const show = useCallback(() => {
    timer.current = setTimeout(() => setVisible(true), delay);
  }, [delay]);

  const hide = useCallback(() => {
    clearTimeout(timer.current);
    setVisible(false);
  }, []);

  if (!label) return children;

  return (
    <span className="tt-wrap" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      {children}
      {visible && (
        <span className={`tt-tip tt-tip--${placement}`} role="tooltip">
          {label}
        </span>
      )}
    </span>
  );
}
