import { useState } from "react";
import { sendMessage } from "../api";

export default function ChatBox() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);

  const handleSend = async () => {
    if (!input) return;

    const newMessages = [...messages, { role: "user", text: input }];
    setMessages(newMessages);

    const res = await sendMessage(input);

    setMessages([
      ...newMessages,
      { role: "jarvis", text: res.reply || res.message },
    ]);

    setInput("");
  };

  return (
    <div className="chat">
      <h2>Jarvis AI</h2>

      <div className="chat-window">
        {messages.map((m, i) => (
          <div key={i} className={m.role}>
            {m.text}
          </div>
        ))}
      </div>

      <div className="input-box">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type: open youtube / buy / automation..."
        />
        <button onClick={handleSend}>Send</button>
      </div>
    </div>
  );
}