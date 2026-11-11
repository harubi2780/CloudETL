import React, { useState } from 'react';
import { checkStepOrderHints, getStepDescription } from '../../lib/mock/pipelineDefaults';

export default function StepsList({
  steps,
  activeStepId,
  onSelectStep,
  onToggleStep,
  onRemoveStep,
  onReorderSteps,
  onMoveStep,
}) {
  const [draggedIndex, setDraggedIndex] = useState(null);
  const hints = checkStepOrderHints(steps);

  const handleDragStart = (e, index) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;
    onReorderSteps(draggedIndex, index);
    setDraggedIndex(index);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  return (
    <div className="pipeline-panel steps-list-panel">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Pipeline Steps</h2>
          <p className="panel-subtitle">Steps run sequentially from top to bottom</p>
        </div>
        <span className="badge-count">
          {steps.length} step{steps.length !== 1 ? 's' : ''}
        </span>
      </div>

      {hints.length > 0 && (
        <div className="pipeline-hints-container" role="status">
          {hints.map((hint) => (
            <div key={hint.id} className={`pipeline-hint-item ${hint.type}`}>
              <span className="hint-icon">💡</span>
              <p className="hint-text">{hint.message}</p>
            </div>
          ))}
        </div>
      )}

      {steps.length === 0 ? (
        <div className="empty-steps-state">
          <div className="empty-icon-box">📋</div>
          <h3>No Transform Steps</h3>
          <p>Click operations from the left panel to add transformation steps.</p>
        </div>
      ) : (
        <div className="steps-draggable-container">
          {steps.map((step, index) => {
            const isActive = step.id === activeStepId;
            const isFirst = index === 0;
            const isLast = index === steps.length - 1;
            const dynamicDesc = getStepDescription(step);

            return (
              <div
                key={step.id}
                className={`step-card ${isActive ? 'active' : ''} ${!step.enabled ? 'disabled' : ''} ${
                  draggedIndex === index ? 'dragging' : ''
                }`}
                draggable
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragEnd={handleDragEnd}
                onClick={() => onSelectStep(step.id)}
              >
                <div className="step-card-left">
                  <div className="drag-handle" title="Drag to reorder">
                    ⠿
                  </div>
                  <span className="step-number">{index + 1}</span>
                </div>

                <div className="step-card-main">
                  <div className="step-header-row">
                    <strong className="step-name">{step.name}</strong>
                    <label
                      className="step-toggle"
                      onClick={(e) => e.stopPropagation()}
                      title={step.enabled ? 'Disable this step' : 'Enable this step'}
                    >
                      <input
                        type="checkbox"
                        checked={step.enabled}
                        onChange={() => onToggleStep(step.id)}
                      />
                      <span className="toggle-slider" />
                    </label>
                  </div>

                  {/* Auto-generated description strictly from config without fake stats */}
                  <p className={`step-dynamic-desc ${dynamicDesc === 'Not configured' ? 'unconfigured' : ''}`}>
                    {dynamicDesc}
                  </p>
                </div>

                <div className="step-card-actions" onClick={(e) => e.stopPropagation()}>
                  <div className="reorder-btns">
                    <button
                      type="button"
                      className="step-icon-btn"
                      disabled={isFirst}
                      onClick={() => onMoveStep(index, -1)}
                      title="Move up"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      className="step-icon-btn"
                      disabled={isLast}
                      onClick={() => onMoveStep(index, 1)}
                      title="Move down"
                    >
                      ▼
                    </button>
                  </div>
                  <button
                    type="button"
                    className="step-icon-btn delete-btn"
                    onClick={() => onRemoveStep(step.id)}
                    title="Delete step"
                  >
                    ✕
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
