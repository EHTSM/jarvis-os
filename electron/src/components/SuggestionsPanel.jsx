import React, { useState } from 'react';
import './SuggestionsPanel.css';

function SuggestionsPanel({ suggestions, onApproveSuggestion, isLoading }) {
  const [expandedId, setExpandedId] = useState(null);

  const getConfidenceBadge = (confidence) => {
    if (confidence > 0.8) return { color: 'high', label: 'High', icon: '🔴' };
    if (confidence > 0.6) return { color: 'medium', label: 'Medium', icon: '🟡' };
    return { color: 'low', label: 'Low', icon: '🟢' };
  };

  const getSuggestionIcon = (type) => {
    const icons = {
      'repetitive_app': '📱',
      'workflow_automation': '⚙️',
      'command_optimization': '⚡',
      'performance_enhancement': '🚀',
      'learning_gap': '📚'
    };
    return icons[type] || '💡';
  };

  return (
    <div className="suggestions-panel">
      {suggestions.length === 0 ? (
        <div className="empty-suggestions">
          <div className="empty-icon">💡</div>
          <div className="empty-text">No suggestions yet</div>
          <div className="empty-hint">
            Execute more commands to build patterns and generate suggestions
          </div>
        </div>
      ) : (
        <div className="suggestions-list">
          {suggestions.map((suggestion) => {
            const confidence = getConfidenceBadge(suggestion.confidence);
            const isExpanded = expandedId === suggestion.id;

            return (
              <div 
                key={suggestion.id} 
                className={`suggestion-card ${isExpanded ? 'expanded' : ''}`}
                onClick={() => setExpandedId(isExpanded ? null : suggestion.id)}
              >
                <div className="suggestion-header">
                  <div className="suggestion-title-area">
                    <span className="suggestion-icon">
                      {getSuggestionIcon(suggestion.category)}
                    </span>
                    <div className="suggestion-title">
                      <div className="title-text">{suggestion.suggestion}</div>
                      <div className="suggestion-type">{suggestion.type}</div>
                    </div>
                  </div>
                  <div className="suggestion-actions">
                    <div className={`confidence-badge ${confidence.color}`}>
                      <span className="confidence-icon">{confidence.icon}</span>
                      <span className="confidence-value">
                        {(suggestion.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                    <span className="expand-icon">
                      {isExpanded ? '▼' : '▶'}
                    </span>
                  </div>
                </div>

                {isExpanded && (
                  <div className="suggestion-details">
                    <div className="detail-section">
                      <div className="detail-label">Category</div>
                      <div className="detail-value">{suggestion.category}</div>
                    </div>

                    {suggestion.based_on && (
                      <div className="detail-section">
                        <div className="detail-label">Based on</div>
                        <div className="detail-value">{suggestion.based_on}</div>
                      </div>
                    )}

                    {suggestion.action && (
                      <div className="detail-section">
                        <div className="detail-label">Action</div>
                        <div className="detail-value">{suggestion.action}</div>
                      </div>
                    )}

                    {suggestion.approval_status && (
                      <div className="detail-section">
                        <div className="detail-label">Status</div>
                        <div className={`detail-value status-${suggestion.approval_status}`}>
                          {suggestion.approval_status}
                        </div>
                      </div>
                    )}

                    {suggestion.approval_status === 'pending' && (
                      <div className="approval-buttons">
                        <button
                          className="approve-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            onApproveSuggestion(suggestion.id);
                            setExpandedId(null);
                          }}
                          disabled={isLoading}
                        >
                          ✓ Approve
                        </button>
                        <button
                          className="reject-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedId(null);
                          }}
                        >
                          ✕ Dismiss
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default SuggestionsPanel;
