import { useState } from "react";

function App() {
  const [msg, setMsg] = useState("");
  const [reply, setReply] = useState("");

  const send = async () => {
    const res = await fetch("http://localhost:5050/jarvis", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ input: msg })
    });

    const data = await res.json();
    setReply(data.reply || data.message);
  };

  return (
    <div style={{ padding: 20 }}>
      <h2>Jarvis Chat</h2>
      <input
        value={msg}
        onChange={(e) => setMsg(e.target.value)}
      />
      <button onClick={send}>Send</button>
      <p>{reply}</p>
    </div>
  );
}

export default App;