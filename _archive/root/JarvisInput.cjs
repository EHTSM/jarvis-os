import React, { useState } from "react";

function JarvisInput() {
  const [command, setCommand] = useState("");
  const [history, setHistory] = useState([]);

  const handleSubmit = () => {
    if (command.trim() === "") return;

    // Store command in history
    setHistory([...history, command]);

    console.log("User Command:", command);

    // Clear input
    setCommand("");
  };

  return (
    <div style={{ padding: "20px" }}>
      <h2>🧠 JARVIS Command Center</h2>

      <input
        type="text"
        placeholder="Enter your command..."
        value={command}
        onChange={(e) => setCommand(e.target.value)}
        style={{ width: "300px", padding: "10px" }}
      />

      <button onClick={handleSubmit} style={{ marginLeft: "10px", padding: "10px" }}>
        Execute
      </button>

      <h3>📜 Command History</h3>
      <ul>
        {history.map((cmd, index) => (
          <li key={index}>{cmd}</li>
        ))}
      </ul>
    </div>
  );
}

export default JarvisInput;