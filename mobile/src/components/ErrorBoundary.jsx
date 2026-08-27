import React from "react";
import "./ErrorBoundary.css";

// Mission 58: mobile had zero crash-reporting/error-boundary coverage
// (Mission 55 finding) — an uncaught render error anywhere below this
// boundary would previously white-screen the whole app with no recovery
// path. Adapted from frontend/src/components/ErrorBoundary.jsx (the web
// app's own, already-proven pattern) rather than pulling in a new
// dependency (Sentry/Crashlytics) — same local-only, no-network-call shape,
// re-themed to this app's own design tokens (mobile/src/styles/global.css)
// since the two apps don't share a token set. No window.electronAPI calls
// here (this is a Capacitor WebView, not Electron) — Try Again / Copy
// Details only.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, crashCount: 0, copied: false };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("[ErrorBoundary]", error, info.componentStack);
    this.setState(s => ({ crashCount: s.crashCount + 1 }));
  }

  _copy() {
    const detail = this.state.error?.stack || this.state.error?.message || "";
    navigator.clipboard?.writeText(detail).catch(() => {});
    this.setState({ copied: true });
    setTimeout(() => this.setState({ copied: false }), 2000);
  }

  render() {
    if (!this.state.error) return this.props.children;

    const { fallback, label = "screen" } = this.props;
    if (fallback) return fallback;

    const { crashCount, copied } = this.state;
    const msg = this.state.error?.message || "An unexpected error occurred.";

    return (
      <div className="eb-root" role="alert">
        <div className="eb-icon" aria-hidden="true">⚠</div>
        <div className="eb-body">
          <p className="eb-title">
            Something went wrong
            {crashCount > 1 && <span className="eb-crash-count"> (×{crashCount})</span>}
          </p>
          <p className="eb-subtitle">
            The <strong>{label}</strong> screen encountered an error.
          </p>
          <p className="eb-message">{msg}</p>
          <div className="eb-actions">
            <button className="eb-btn eb-btn--primary" onClick={() => this.setState({ error: null, crashCount: 0 })}>
              Try again
            </button>
            <button className="eb-btn eb-btn--ghost" onClick={() => this._copy()}>
              {copied ? "Copied!" : "Copy details"}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
