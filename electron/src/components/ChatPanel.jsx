import React, { useState, useEffect, useRef } from "react";
import "./ChatPanel.css";
import { sendMessage } from "../api";

function ChatPanel({ messages, isLoading, onSendCommand, onClearChat, serverHealthy, messageInputRef, onAddMessage }) {
    const [input, setInput]           = useState("");
    const [isListening, setIsListening] = useState(false);
    const messagesEndRef              = useRef(null);
    const recognitionRef              = useRef(null);

    // Auto-scroll to latest message
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // Initialize speech recognition
    useEffect(() => {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) return;

        recognitionRef.current = new SpeechRecognition();
        recognitionRef.current.continuous      = false;
        recognitionRef.current.interimResults  = true;
        recognitionRef.current.lang            = "en-US";

        recognitionRef.current.onstart  = () => setIsListening(true);
        recognitionRef.current.onend    = () => setIsListening(false);

        recognitionRef.current.onresult = (event) => {
            for (let i = event.resultIndex; i < event.results.length; i++) {
                if (event.results[i].isFinal) {
                    setInput(event.results[i][0].transcript);
                }
            }
        };

        recognitionRef.current.onerror = (event) => {
            setIsListening(false);
            const errorMap = {
                "no-speech":         "No speech detected — speak louder or closer.",
                "audio-capture":     "Microphone not working — check system settings.",
                "not-allowed":       "Microphone permission denied — grant access in Settings.",
                "permission-denied": "Microphone permission denied — grant access in Settings.",
                "network":           "Network error — check your internet connection."
            };
            const msg = "🎤 " + (errorMap[event.error] || `Voice error: ${event.error}`);
            onAddMessage?.({ type: "error", content: msg });
        };
    }, [onAddMessage]);

    // ── Handlers ────────────────────────────────────────────────
    const handleSend = () => {
        if (!input.trim()) return;
        onSendCommand(input.trim());
        setInput("");
        messageInputRef?.current?.focus();
    };

    const handleKeyPress = (e) => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
    };

    const handleVoiceInput = () => {
        if (!recognitionRef.current) {
            onAddMessage?.({ type: "error", content: "🎤 Speech recognition not available — type instead." });
            return;
        }
        try {
            if (isListening) {
                recognitionRef.current.abort();
            } else {
                recognitionRef.current.start();
                onAddMessage?.({ type: "system", content: "🎤 Listening... speak now!" });
            }
        } catch (err) {
            setIsListening(false);
            onAddMessage?.({ type: "error", content: `🎤 ${err.message}` });
        }
    };

    // ── Render ───────────────────────────────────────────────────
    return (
        <div className="chat-panel">
            <div className="messages-container">
                {messages.length === 0 ? (
                    <div className="empty-state">
                        <div className="empty-icon">🤖</div>
                        <div className="empty-text">No messages yet</div>
                        <div className="empty-hint">Send a command to get started</div>
                    </div>
                ) : (
                    <div className="messages-list">
                        {messages.map((msg) => (
                            <div key={msg.id} className={`message message-${msg.type} animation-slide-in`}>
                                <div className="message-header">
                                    <span className="message-type-icon">
                                        {msg.type === "user"    && "👤"}
                                        {msg.type === "system"  && "🤖"}
                                        {msg.type === "success" && "✅"}
                                        {msg.type === "error"   && "❌"}
                                    </span>
                                    <span className="message-time">
                                        {msg.timestamp.toLocaleTimeString()}
                                    </span>
                                </div>
                                <div className="message-content">
                                    {msg.content.split("\n").map((line, i) => (
                                        <div key={i}>{line}</div>
                                    ))}
                                </div>
                            </div>
                        ))}

                        {isLoading && (
                            <div className="message message-system loading-message animation-slide-in">
                                <div className="message-header">
                                    <span className="message-type-icon">🤖</span>
                                    <span className="message-time">thinking...</span>
                                </div>
                                <div className="message-content">
                                    <div className="loading-dots">
                                        <span className="dot" />
                                        <span className="dot" />
                                        <span className="dot" />
                                    </div>
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>
                )}
            </div>

            <div className="chat-input-area">
                {!serverHealthy && (
                    <div className="server-alert">
                        ⚠️ Server disconnected — commands won't work until reconnected.
                    </div>
                )}

                <div className="input-controls">
                    <textarea
                        ref={messageInputRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyPress={handleKeyPress}
                        placeholder={isListening ? "🎤 Listening..." : "Type a command or press 🎤 to speak..."}
                        className="command-input"
                        disabled={!serverHealthy || isLoading}
                        rows={2}
                    />

                    <div className="input-buttons">
                        <button
                            className={`voice-btn ${isListening ? "listening" : ""}`}
                            onClick={handleVoiceInput}
                            disabled={!serverHealthy || isLoading}
                            title="Voice input"
                        >
                            🎤
                        </button>

                        <button
                            className="send-btn"
                            onClick={handleSend}
                            disabled={!input.trim() || !serverHealthy || isLoading}
                            title="Send (Enter)"
                        >
                            {isLoading ? "⏳" : "➤"}
                        </button>

                        <button
                            className="clear-btn"
                            onClick={onClearChat}
                            title="Clear chat"
                        >
                            🗑️
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default ChatPanel;
