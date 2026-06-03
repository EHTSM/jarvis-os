import React, { useState, useEffect, useCallback } from 'react';
import './ChatPanel.css';

const WorkflowPanel = () => {
  const [workflows, setWorkflows] = useState([]);
  const [selectedWorkflow, setSelectedWorkflow] = useState(null);
  const [loading, setLoading] = useState(false);
  const [syncStatus, setSyncStatus] = useState('idle');
  const [newWorkflow, setNewWorkflow] = useState({
    name: '',
    steps: []
  });

  useEffect(() => {
    fetchWorkflows();
  }, []);

  // Fetch workflows from JARVIS backend with retry/cancel and reconnect safety
  const fetchWorkflows = useCallback(async () => {
    const controller = new AbortController();
    const signal = controller.signal;
    setLoading(true);
    let attempts = 0;
    const maxAttempts = 3;
    const baseDelay = 500;

    const attemptFetch = async (retryCount) => {
      try {
        const response = await fetch('http://localhost:3000/workflow/list', {
          signal,
          timeout: 8000 // 8 second timeout per attempt
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        if (data.success) {
          setWorkflows(data.workflows);
          return true;
        }
        throw new Error(data.error || 'Invalid response');
      } catch (error) {
        if (error.name === 'AbortError') {
          return false; // cancelled, don't retry
        }

        if (retryCount < maxAttempts) {
          // Exponential backoff with jitter
          const delay = baseDelay * Math.pow(2, retryCount) + Math.random() * 300;
          await new Promise(resolve => setTimeout(resolve, delay));
          return attemptFetch(retryCount + 1);
        }

        console.error('Error fetching workflows after retries:', error);
        return false;
      }
    };

    try {
      const success = await attemptFetch(0);
      if (!success && !loading) {
        // Only set error state if still loading (not cancelled)
        setWorkflows([]); // clear on persistent failure
      }
    } finally {
      // Always reset loading state unless explicitly cancelled
      if (!signal.aborted) {
        setLoading(false);
      }
    }

    // Return cleanup function
    return () => controller.abort();
  }, []);

  // Sync all workflows to N8N
  const syncToN8N = async () => {
    setSyncStatus('syncing');
    try {
      const response = await fetch('http://localhost:3000/workflow/sync-to-n8n', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ n8nUrl: 'http://host.docker.internal:5678' })
      });
      const data = await response.json();
      setSyncStatus(data.success ? 'success' : 'error');
      setTimeout(() => setSyncStatus('idle'), 3000);
    } catch (error) {
      console.error('Sync error:', error);
      setSyncStatus('error');
    }
  };

  // Execute a workflow
  const executeWorkflow = async (workflowId) => {
    try {
      const response = await fetch('http://localhost:3000/workflow/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowId })
      });
      const data = await response.json();
      alert(`Workflow executed!\n${JSON.stringify(data.results, null, 2)}`);
      fetchWorkflows(); // Refresh
    } catch (error) {
      console.error('Execution error:', error);
      alert('Error executing workflow');
    }
  };

  // Create new workflow
  const createWorkflow = async () => {
    if (!newWorkflow.name || newWorkflow.steps.length === 0) {
      alert('Please enter workflow name and at least one step');
      return;
    }

    try {
      const response = await fetch('http://localhost:3000/workflow/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newWorkflow.name,
          steps: newWorkflow.steps
        })
      });
      const data = await response.json();
      if (data.success) {
        setNewWorkflow({ name: '', steps: [] });
        fetchWorkflows();
        alert('Workflow created successfully!');
      }
    } catch (error) {
      console.error('Create error:', error);
      alert('Error creating workflow');
    }
  };

  const addStep = () => {
    setNewWorkflow({
      ...newWorkflow,
      steps: [...newWorkflow.steps, '']
    });
  };

  const updateStep = (index, value) => {
    const updatedSteps = [...newWorkflow.steps];
    updatedSteps[index] = value;
    setNewWorkflow({ ...newWorkflow, steps: updatedSteps });
  };

  const removeStep = (index) => {
    const updatedSteps = newWorkflow.steps.filter((_, i) => i !== index);
    setNewWorkflow({ ...newWorkflow, steps: updatedSteps });
  };

  return (
    <div style={{ padding: '15px', fontSize: '13px', color: '#e0e0e0' }}>
      <h3 style={{ marginBottom: '15px', borderBottom: '1px solid #444', paddingBottom: '10px' }}>
        🔄 Workflows
      </h3>

      {/* Sync Button */}
      <button
        onClick={syncToN8N}
        disabled={syncStatus === 'syncing'}
        style={{
          width: '100%',
          padding: '8px',
          marginBottom: '15px',
          background: syncStatus === 'success' ? '#4CAF50' : syncStatus === 'error' ? '#f44336' : '#2196F3',
          color: '#fff',
          border: 'none',
          borderRadius: '4px',
          cursor: syncStatus === 'syncing' ? 'wait' : 'pointer',
        }}
      >
        {syncStatus === 'syncing' ? '⏳ Syncing to N8N...' : syncStatus === 'success' ? '✅ Synced!' : syncStatus === 'error' ? '❌ Sync Failed' : '📤 Sync to N8N'}
      </button>

      {/* Workflows List */}
      <div style={{ marginBottom: '15px', maxHeight: '250px', overflowY: 'auto' }}>
        <h4>📋 Existing Workflows ({workflows.length})</h4>
        {loading ? (
          <p>Loading...</p>
        ) : workflows.length === 0 ? (
          <p style={{ color: '#888' }}>No workflows yet</p>
        ) : (
          workflows.map((wf) => (
            <div
              key={wf.id}
              onClick={() => setSelectedWorkflow(wf)}
              style={{
                padding: '8px',
                marginBottom: '8px',
                background: selectedWorkflow?.id === wf.id ? '#2a5f8f' : '#1e1e1e',
                border: '1px solid #444',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              <div style={{ fontWeight: 'bold' }}>{wf.name}</div>
              <div style={{ fontSize: '11px', color: '#aaa' }}>
                {wf.stepCount} steps • Runs: {wf.executionCount}
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  executeWorkflow(wf.id);
                }}
                style={{
                  marginTop: '5px',
                  padding: '4px 8px',
                  background: '#4CAF50',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '3px',
                  cursor: 'pointer',
                  fontSize: '11px'
                }}
              >
                ▶️ Execute
              </button>
            </div>
          ))
        )}
      </div>

      {/* Selected Workflow Details */}
      {selectedWorkflow && (
        <div style={{ background: '#1e1e1e', padding: '10px', borderRadius: '4px', marginBottom: '15px', border: '1px solid #444' }}>
          <h4>📌 {selectedWorkflow.name}</h4>
          <div style={{ fontSize: '12px', color: '#aaa', marginBottom: '10px' }}>
            Steps: {selectedWorkflow.stepCount} | Last run: {selectedWorkflow.lastExecutedAt === 'Never' ? 'Never' : new Date(selectedWorkflow.lastExecutedAt).toLocaleString()}
          </div>
          <button
            onClick={() => executeWorkflow(selectedWorkflow.id)}
            style={{
              width: '100%',
              padding: '6px',
              background: '#4CAF50',
              color: '#fff',
              border: 'none',
              borderRadius: '3px',
              cursor: 'pointer',
            }}
          >
            ▶️ Execute This Workflow
          </button>
        </div>
      )}

      {/* Create New Workflow */}
      <div style={{ background: '#1e1e1e', padding: '10px', borderRadius: '4px', border: '1px solid #444' }}>
        <h4>➕ Create New Workflow</h4>
        <input
          type="text"
          placeholder="Workflow name"
          value={newWorkflow.name}
          onChange={(e) => setNewWorkflow({ ...newWorkflow, name: e.target.value })}
          style={{
            width: '100%',
            padding: '6px',
            marginBottom: '8px',
            background: '#2a2a2a',
            border: '1px solid #444',
            color: '#fff',
            borderRadius: '3px',
            boxSizing: 'border-box',
          }}
        />

        <div style={{ maxHeight: '150px', overflowY: 'auto', marginBottom: '8px' }}>
          {newWorkflow.steps.map((step, idx) => (
            <div key={idx} style={{ marginBottom: '6px', display: 'flex', gap: '4px' }}>
              <input
                type="text"
                placeholder={`Step ${idx + 1}: command`}
                value={step}
                onChange={(e) => updateStep(idx, e.target.value)}
                style={{
                  flex: 1,
                  padding: '4px',
                  background: '#2a2a2a',
                  border: '1px solid #444',
                  color: '#fff',
                  borderRadius: '3px',
                }}
              />
              <button
                onClick={() => removeStep(idx)}
                style={{
                  padding: '4px 8px',
                  background: '#f44336',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '3px',
                  cursor: 'pointer',
                  fontSize: '11px'
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        <button
          onClick={addStep}
          style={{
            width: '100%',
            padding: '6px',
            marginBottom: '8px',
            background: '#2196F3',
            color: '#fff',
            border: 'none',
            borderRadius: '3px',
            cursor: 'pointer',
            fontSize: '12px'
          }}
        >
          + Add Step
        </button>

        <button
          onClick={createWorkflow}
          style={{
            width: '100%',
            padding: '8px',
            background: '#4CAF50',
            color: '#fff',
            border: 'none',
            borderRadius: '3px',
            cursor: 'pointer',
            fontWeight: 'bold'
          }}
        >
          ✅ Create Workflow
        </button>
      </div>
    </div>
  );
};

export default WorkflowPanel;
