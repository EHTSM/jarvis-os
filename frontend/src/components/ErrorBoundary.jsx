import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    const { fallback, label = "panel" } = this.props;
    if (fallback) return fallback;

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
        <div style={{ marginTop: 6, opacity: 0.7, wordBreak: "break-word" }}>
          {this.state.error.message}
        </div>
        <button
          style={{
            marginTop: 10, padding: "3px 8px",
            background: "transparent", border: "1px solid rgba(255,68,68,0.4)",
            color: "#f87171", borderRadius: 3, cursor: "pointer", fontSize: "0.7rem",
          }}
          onClick={() => this.setState({ error: null })}
        >
          Retry
        </button>
      </div>
    );
  }
}
