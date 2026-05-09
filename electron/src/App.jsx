/**
 * electron/src/App.jsx — NOT the active UI.
 * The active frontend is /frontend (runs on port 3000).
 * Electron loads http://localhost:3000 which serves /frontend.
 *
 * This file exists only so this directory compiles if accidentally started
 * (it runs on PORT=3001 per electron/package.json to avoid conflict).
 */
import React from "react";

export default function App() {
    return (
        <div style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            height: "100vh", background: "#0a0a0f", color: "#e0e0e0",
            fontFamily: "system-ui, sans-serif", textAlign: "center", padding: 20
        }}>
            <div>
                <div style={{ fontSize: 40, marginBottom: 12 }}>⬡</div>
                <h2 style={{ color: "#6c63ff", marginBottom: 8 }}>JARVIS AI</h2>
                <p style={{ color: "#8888aa", marginBottom: 4 }}>
                    Active UI: <strong style={{ color: "#00d4ff" }}>http://localhost:3000</strong>
                </p>
                <p style={{ color: "#555", fontSize: 12 }}>
                    Run <code style={{ background: "#1a1a26", padding: "2px 6px", borderRadius: 4 }}>npm run frontend</code> from the project root.
                </p>
            </div>
        </div>
    );
}
