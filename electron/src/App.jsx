import React, { useState, useEffect, useRef } from 'react';
import './App.css';
import ChatPanel from './components/ChatPanel';
import SuggestionsPanel from './components/SuggestionsPanel';
import LogsPanel from './components/LogsPanel';
import StatusBar from './components/StatusBar';
import EvolutionScore from './components/EvolutionScore';
import WorkflowPanel from './components/WorkflowPanel';

function App() {
  const [messages, setMessages] = useState([
    {
      id: 1,
      type: 'system',
      content: '👋 Welcome to JARVIS - Your AI Assistant',
      timestamp: new Date()
    }
  ]);
  const [suggestions, setSuggestions] = useState([]);
  const [logs, setLogs] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [serverHealthy, setServerHealthy] = useState(true);
  const [activeTab, setActiveTab] = useState('chat'); // chat, suggestions, logs
  const [score, setScore] = useState(50);
  const messageInputRef = useRef(null);

  // Log electron API availability
  useEffect(() => {
    console.log('[JARVIS-APP] Mount check - window.electronAPI:', window.electronAPI ? '✅ AVAILABLE' : '❌ NOT AVAILABLE');
    if (window.electronAPI) {
      console.log('[JARVIS-APP] electronAPI methods:', Object.keys(window.electronAPI));
    }
  }, []);

  // Check server health on mount
  useEffect(() => {
    checkServerHealth();
    const healthInterval = setInterval(checkServerHealth, 5000);
    return () => clearInterval(healthInterval);
  }, []);

  // Listen for server disconnection
  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.onServerDisconnected(() => {
        setServerHealthy(false);
        addSystemMessage('❌ Server disconnected. Attempting to reconnect...');
      });
    }
    return () => {
      if (window.electronAPI) {
        window.electronAPI.removeServerDisconnectedListener();
      }
    };
  }, []);

  // Fetch suggestions and score periodically
  useEffect(() => {
    const fetchData = async () => {
      if (serverHealthy) {
        await fetchSuggestions();
        await fetchEvolutionScore();
      }
    };

    const interval = setInterval(fetchData, 3000);
    fetchData();
    return () => clearInterval(interval);
  }, [serverHealthy]);

  const checkServerHealth = async () => {
    if (!window.electronAPI) return;
    
    try {
      const result = await window.electronAPI.getServerHealth();
      if (result.success && result.isHealthy) {
        if (!serverHealthy) {
          setServerHealthy(true);
          addSystemMessage('✅ Server connected');
        }
      }
    } catch (error) {
      setServerHealthy(false);
    }
  };

  const fetchSuggestions = async () => {
    if (!window.electronAPI) return;
    
    try {
      const result = await window.electronAPI.getSuggestions();
      if (result.success && result.data.suggestions) {
        setSuggestions(result.data.suggestions);
      }
    } catch (error) {
      console.error('Error fetching suggestions:', error);
    }
  };

  const fetchEvolutionScore = async () => {
    if (!window.electronAPI) return;
    
    try {
      const result = await window.electronAPI.getEvolutionScore();
      if (result.success && result.data.optimization_score !== undefined) {
        setScore(Math.round(result.data.optimization_score));
      }
    } catch (error) {
      console.error('Error fetching score:', error);
    }
  };

  const addSystemMessage = (content) => {
    setMessages(prev => [...prev, {
      id: prev.length + 1,
      type: 'system',
      content,
      timestamp: new Date()
    }]);
  };

  // Generic message handler for any type
  const addMessage = (messageObj) => {
    setMessages(prev => [...prev, {
      ...messageObj,
      id: prev.length + 1,
      timestamp: messageObj.timestamp || new Date()
    }]);
  };

  const addLog = (action, details, status = 'pending') => {
    const logEntry = {
      id: logs.length + 1,
      action,
      details,
      status,
      timestamp: new Date()
    };
    setLogs(prev => [...prev, logEntry]);
    return logEntry.id;
  };

  const updateLog = (logId, status, details = null) => {
    setLogs(prev => prev.map(log => 
      log.id === logId 
        ? { ...log, status, details: details || log.details }
        : log
    ));
  };

  const handleSendCommand = async (command) => {
    if (!command.trim()) return;
    if (!serverHealthy) {
      addSystemMessage('❌ Server is not connected');
      return;
    }

    // Add user message
    setMessages(prev => [...prev, {
      id: prev.length + 1,
      type: 'user',
      content: command,
      timestamp: new Date()
    }]);

    setIsLoading(true);
    const logId = addLog('Command', command);

    try {
      if (!window.electronAPI) {
        throw new Error('Electron API not available');
      }

      const result = await window.electronAPI.sendCommand(command);
      
      if (result.success && result.data) {
        const data = result.data;
        
        // Parse tasks and results from the /jarvis endpoint
        let responseMessage = '';
        
        // Add task information
        if (data.tasks && data.tasks.length > 0) {
          const taskLabels = data.tasks.map(t => t.label || t.type).join(', ');
          responseMessage += `📋 Tasks: ${taskLabels}\n`;
        }
        
        // Add result information
        if (data.results && data.results.length > 0) {
          const resultTexts = data.results
            .map(r => r.result?.result || r.result?.message || 'Executed')
            .join('\n');
          responseMessage += `✅ ${resultTexts}`;
        } else {
          responseMessage += '✅ Command executed';
        }
        
        if (responseMessage) {
          addSystemMessage(responseMessage);
        }
        
        // Add suggestions if available
        if (data.suggestions && data.suggestions.length > 0) {
          const suggestionTexts = data.suggestions
            .map(s => typeof s === 'string' ? s : (s.suggestion || s))
            .join('\n');
          addSystemMessage(`💡 Suggestions:\n${suggestionTexts}`);
        }
        
        // Add logs if available
        if (data.logs && data.logs.length > 0) {
          addSystemMessage(`📝 Logs: ${data.logs.slice(0, 3).join(' → ')}`);
        }

        // Update log
        updateLog(logId, 'success', `Tasks: ${data.tasks?.length || 0} executed`);
      } else {
        const errorMsg = result.error || 'Command failed';
        addSystemMessage(`❌ ${errorMsg}`);
        updateLog(logId, 'error', errorMsg);
      }
    } catch (error) {
      const errorMsg = error.message || 'Fatal error';
      addSystemMessage(`❌ ${errorMsg}`);
      updateLog(logId, 'error', errorMsg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleApproveSuggestion = async (suggestionId) => {
    if (!window.electronAPI) return;

    try {
      const result = await window.electronAPI.approveSuggestion(suggestionId);
      if (result.success) {
        addSystemMessage(`✅ Suggestion approved: ${result.data.message}`);
        await fetchSuggestions();
      }
    } catch (error) {
      addSystemMessage(`❌ Error approving suggestion: ${error.message}`);
    }
  };

  const handleToggleFloatingWindow = () => {
    if (window.electronAPI) {
      window.electronAPI.createFloatingWindow();
    }
  };

  const handleClearChat = () => {
    setMessages([{
      id: 1,
      type: 'system',
      content: '👋 Chat cleared',
      timestamp: new Date()
    }]);
  };

  return (
    <div className="app-container">
      <div className="app-header">
        <div className="app-title">
          <span className="jarvis-logo">🤖 JARVIS</span>
          <span className="subtitle">Self-Evolving AI Assistant</span>
        </div>
        <EvolutionScore score={score} />
      </div>

      <div className="app-content">
        <div className="main-panel">
          <div className="tab-buttons">
            <button 
              className={`tab-btn ${activeTab === 'chat' ? 'active' : ''}`}
              onClick={() => setActiveTab('chat')}
            >
              💬 Chat
            </button>
            <button 
              className={`tab-btn ${activeTab === 'workflows' ? 'active' : ''}`}
              onClick={() => setActiveTab('workflows')}
            >
              🔄 Workflows
            </button>
            <button 
              className={`tab-btn ${activeTab === 'suggestions' ? 'active' : ''}`}
              onClick={() => setActiveTab('suggestions')}
            >
              💡 Suggestions ({suggestions.length})
            </button>
            <button 
              className={`tab-btn ${activeTab === 'logs' ? 'active' : ''}`}
              onClick={() => setActiveTab('logs')}
            >
              📋 Logs ({logs.length})
            </button>
          </div>

          {activeTab === 'chat' && (
            <ChatPanel 
              messages={messages} 
              isLoading={isLoading}
              onSendCommand={handleSendCommand}
              onClearChat={handleClearChat}
              serverHealthy={serverHealthy}
              messageInputRef={messageInputRef}
              onAddMessage={addMessage}
            />
          )}

          {activeTab === 'workflows' && (
            <WorkflowPanel />
          )}

          {activeTab === 'suggestions' && (
            <SuggestionsPanel 
              suggestions={suggestions}
              onApproveSuggestion={handleApproveSuggestion}
              isLoading={isLoading}
            />
          )}

          {activeTab === 'logs' && (
            <LogsPanel logs={logs} />
          )}
        </div>
      </div>

      <StatusBar 
        serverHealthy={serverHealthy}
        onToggleFloatingWindow={handleToggleFloatingWindow}
      />
    </div>
  );
}

export default App;
