import React, { useState, useEffect, useRef } from 'react';
import './ChatPanel.css';

function ChatPanel({ messages, isLoading, onSendCommand, onClearChat, serverHealthy, messageInputRef, onAddMessage }) {
  const [input, setInput] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const messagesEndRef = useRef(null);
  const recognitionRef = useRef(null);

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Initialize speech recognition
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.lang = 'en-US';

      recognitionRef.current.onstart = () => {
        console.log('🎤 Speech recognition started');
        setIsListening(true);
      };

      recognitionRef.current.onresult = (event) => {
        console.log('🎤 Recognition result event fired, isFinal?', event.results[event.resultIndex]?.isFinal);
        let interimTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          console.log('  Transcript:', transcript, 'isFinal:', event.results[i].isFinal);
          if (event.results[i].isFinal) {
            console.log('✅ Final transcript:', transcript);
            setInput(transcript);
          } else {
            interimTranscript += transcript;
          }
        }
      };

      recognitionRef.current.onerror = (event) => {
        console.error('❌ SPEECH RECOGNITION ERROR:', event.error);
        console.error('   Error Type:', event.error);
        setIsListening(false);
        
        let userMessage = '🎤 Voice error: ';
        
        switch(event.error) {
          case 'no-speech':
            userMessage += 'No speech detected. Speak louder or closer to microphone.';
            break;
          case 'audio-capture':
            userMessage += 'Microphone not working. Check System Preferences → Sound.';
            break;
          case 'not-allowed':
          case 'permission-denied':
            userMessage += 'Microphone permission denied. Grant access in Mac Settings → Privacy & Security → Microphone → Electron.';
            break;
          case 'network':
            userMessage += 'Network error. Check internet connection and try again.';
            break;
          case 'service-not-allowed':
            userMessage += 'Speech recognition service not allowed. Try again or use typing.';
            break;
          default:
            userMessage += `${event.error}. Check console (Cmd+Option+I) for details.`;
        }
        
        if (onAddMessage) {
          onAddMessage({
            type: 'error',
            content: userMessage,
            timestamp: new Date()
          });
        }
      };

      recognitionRef.current.onend = () => {
        console.log('🎤 Speech recognition ended');
        setIsListening(false);
      };
    } else {
      console.warn('⚠️ Speech Recognition not supported in this browser');
    }
  }, [onAddMessage]);

  const handleSendCommand = () => {
    if (input.trim()) {
      onSendCommand(input);
      
      // 🧠 Smart command parsing - analyze the voice input
      analyzeCommand(input);
      
      setInput('');
      if (messageInputRef?.current) {
        messageInputRef.current.focus();
      }
    }
  };

  // 🧠 Analyze command using smart parser 
  const analyzeCommand = async (command) => {
    setIsAnalyzing(true);
    try {
      console.log('🎤 Sending to smart parser:', command);
      
      const response = await fetch('http://localhost:3000/parse-command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command })
      });
      
      if (!response.ok) {
        console.error('Parse response not ok:', response.status, response.statusText);
        throw new Error(`HTTP ${response.status}: Parse failed`);
      }
      
      const data = await response.json();
      console.log('✅ Smart Command Analysis:', data);

      // Show what JARVIS understood
      if (data.success && data.parsed) {
        const understood = `🧠 Understood: ${data.parsed.label || data.parsed.type}`;
        
        if (onAddMessage) {
          onAddMessage({
            type: 'system',
            content: understood,
            timestamp: new Date()
          });
        }

        // Show execution result
        if (data.result) {
          const resultMessage = data.result.success 
            ? `✅ ${data.result.message}`
            : `❌ ${data.result.message}`;

          if (onAddMessage) {
            setTimeout(() => {
              onAddMessage({
                type: data.result.success ? 'success' : 'error',
                content: resultMessage,
                timestamp: new Date()
              });
            }, 300);
          }
        }

        // 🗣️ JARVIS Voice Reply
        if (data.parsed.voiceReply) {
          console.log('🗣️ Voice reply:', data.parsed.voiceReply);
          try {
            const voiceResponse = await fetch('http://localhost:3000/voice/speak', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: data.parsed.voiceReply, rate: 1.0 })
            });
            
            if (voiceResponse.ok) {
              console.log('🔊 Voice spoken');
            } else {
              console.warn('⚠️ Voice response not ok:', voiceResponse.status);
            }
          } catch (voiceError) {
            console.warn('⚠️ Voice error:', voiceError.message);
          }
        }
      } else if (data.parsed) {
        // Handle parse response even if success is false
        const message = data.parsed.suggestion || data.parsed.label;
        if (onAddMessage) {
          onAddMessage({
            type: 'error',
            content: `⚠️ ${message}`,
            timestamp: new Date()
          });
        }
      }
    } catch (error) {
      console.error('❌ Command analysis error:', error);
      if (onAddMessage) {
        onAddMessage({
          type: 'error',
          content: `⚠️ Analysis error: ${error.message}`,
          timestamp: new Date()
        });
      }
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleVoiceInput = () => {
    if (!recognitionRef.current) {
      const msg = '🎤 Speech recognition not available. Please type manually.';
      console.error('❌', msg);
      if (onAddMessage) {
        onAddMessage({
          type: 'error',
          content: msg,
          timestamp: new Date()
        });
      }
      return;
    }

    try {
      if (isListening) {
        console.log('🎤 Stopping recognition...');
        recognitionRef.current.abort();
        setIsListening(false);
      } else {
        console.log('🎤 Starting voice recognition...');
        recognitionRef.current.start();
        // Show listening indicator
        if (onAddMessage) {
          onAddMessage({
            type: 'system',
            content: '🎤 Listening... speak now! (or click 🎤 again to stop)',
            timestamp: new Date()
          });
        }
      }
    } catch (error) {
      console.error('❌ Voice input error:', error.name, error.message);
      
      let errorMsg = '🎤 Voice error: ';
      
      // Provide specific error messages
      if (error.name === 'NotAllowedError') {
        errorMsg += 'Microphone access denied. Check Mac Settings → Privacy & Security → Microphone and enable Electron.';
      } else if (error.name === 'NetworkError') {
        errorMsg += 'Network error. Your speech API service may be down. Try typing instead.';
      } else if (error.name === 'SecurityError') {
        errorMsg += 'Security error: HTTPS required for voice. Using HTTP may block microphone.';
      } else {
        errorMsg += error.message;
      }
      
      if (onAddMessage) {
        onAddMessage({
          type: 'error',
          content: errorMsg,
          timestamp: new Date()
        });
      }
      setIsListening(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendCommand();
    }
  };

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
            {messages.map((msg, idx) => (
              <div key={msg.id} className={`message message-${msg.type} animation-slide-in`}>
                <div className="message-header">
                  <span className="message-type-icon">
                    {msg.type === 'user' && '👤'}
                    {msg.type === 'system' && '🤖'}
                    {msg.type === 'success' && '✅'}
                    {msg.type === 'error' && '❌'}
                  </span>
                  <span className="message-time">
                    {msg.timestamp.toLocaleTimeString()}
                  </span>
                </div>
                <div className="message-content">
                  {/* Support markdown-like formatting */}
                  {msg.content.split('\n').map((line, i) => (
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
                    <span className="dot"></span>
                    <span className="dot"></span>
                    <span className="dot"></span>
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
            ⚠️ Server is disconnected. Commands won't work until connection is restored.
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
              className={`voice-btn ${isListening ? 'listening' : ''}`}
              onClick={handleVoiceInput}
              disabled={!serverHealthy || isLoading}
              title="Voice input (click to toggle)"
            >
              🎤
            </button>
            
            <button
              className="send-btn"
              onClick={handleSendCommand}
              disabled={!input.trim() || !serverHealthy || isLoading || isAnalyzing}
              title="Send command (Enter)"
            >
              {isLoading || isAnalyzing ? '⏳' : '➤'}
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
