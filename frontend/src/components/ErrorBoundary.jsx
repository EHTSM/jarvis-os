import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, crashCount: 0 };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("[ErrorBoundary]", error, info.componentStack);
    this.setState(s => ({ crashCount: s.crashCount + 1 }));

    // Report to Electron main for persistent crash log
    window.electronAPI?.reportCrash?.({
      source:  this.props.label || "unknown",
      message: error.message,
      stack:   error.stack,
      url:     window.location.href,
    }).catch?.(() => {});
  }

  render() {
    if (!this.state.error) return this.props.children;

    const { fallback, label = "panel" } = this.props;
    if (fallback) return fallback;

    const { crashCount } = this.state;

    return (
      <div style={{
        padding: "1rem",
        background: "rgba(255,68,68,0.07)",
        border: "1px solid rgba(255,68,68,0.25)",
        borderRadius: 4,
        color: "#f87171",
        fontFamily: "monospace",
        fontSize: "0.75rem",
      }}>
        <strong>{label} crashed</strong>
        {crashCount > 1 && (
          <span style={{ marginLeft: 8, opacity: 0.5, fontSize: "0.65rem" }}>
            ×{crashCount}
          </span>
        )}
        <div style={{ marginTop: 6, opacity: 0.7, wordBreak: "break-word" }}>
          {this.state.error.message}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button
            style={{
              padding: "3px 8px",
              background: "transparent", border: "1px solid rgba(255,68,68,0.4)",
              color: "#f87171", borderRadius: 3, cursor: "pointer", fontSize: "0.7rem",
            }}
            onClick={() => this.setState({ error: null })}
          >
            Retry
          </button>
          <button
            style={{
              padding: "3px 8px",
              background: "transparent", border: "1px solid #374151",
              color: "#6b7280", borderRadius: 3, cursor: "pointer", fontSize: "0.7rem",
            }}
            onClick={() => {
              const detail = `${this.state.error?.stack || this.state.error?.message || ''}`;
              window.electronAPI?.clipboardWrite?.(detail);
            }}
            title="Copy error to clipboard"
            aria-label="Copy error details to clipboard"
          >
            Copy
          </button>
        </div>
      </div>
    );
  }
}
