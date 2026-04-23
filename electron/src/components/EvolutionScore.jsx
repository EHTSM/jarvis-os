import React from 'react';
import './EvolutionScore.css';

function EvolutionScore({ score }) {
  const getScoreLabel = (score) => {
    if (score < 20) return 'Learning Phase';
    if (score < 40) return 'Building Patterns';
    if (score < 60) return 'Pattern Recognition';
    if (score < 80) return 'Optimal';
    return 'Highly Optimized';
  };

  const getScoreColor = (score) => {
    if (score < 20) return '#ffaa00';
    if (score < 40) return '#00d4ff';
    if (score < 60) return '#00ff88';
    if (score < 80) return '#00ff88';
    return '#00ff88';
  };

  return (
    <div className="evolution-score">
      <div className="score-container">
        <div className="score-label">Evolution Score</div>
        <div className="score-display">
          <svg className="score-ring" width="60" height="60" viewBox="0 0 60 60">
            <circle
              cx="30"
              cy="30"
              r="25"
              fill="none"
              stroke="var(--border)"
              strokeWidth="2"
            />
            <circle
              cx="30"
              cy="30"
              r="25"
              fill="none"
              stroke={getScoreColor(score)}
              strokeWidth="2.5"
              strokeDasharray={`${(score / 100) * 157} 157`}
              strokeLinecap="round"
              className="score-ring-progress"
            />
          </svg>
          <div className="score-value">{score}</div>
        </div>
        <div className="score-status">{getScoreLabel(score)}</div>
      </div>
    </div>
  );
}

export default EvolutionScore;
