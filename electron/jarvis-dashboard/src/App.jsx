/**
 * electron/jarvis-dashboard/src/App.jsx — NOT the active UI.
 * Active frontend is /frontend on port 3000.
 */
import React from "react";
import "./App.css";

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
                <p style={{ color: "#8888aa" }}>
                    Active UI: <strong style={{ color: "#00d4ff" }}>http://localhost:3000</strong>
                </p>
            </div>
        </div>
    );
}
