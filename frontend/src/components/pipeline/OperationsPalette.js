import React from 'react';
import { OPERATION_DEFINITIONS } from '../../lib/mock/pipelineDefaults';

export default function OperationsPalette({ onAddStep, columns }) {
  return (
    <div className="pipeline-panel operations-palette-panel">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Operations</h2>
          <p className="panel-subtitle">Click an operation to add to pipeline</p>
        </div>
        <span className="badge-count">{OPERATION_DEFINITIONS.length}</span>
      </div>

      <div className="operations-list">
        {OPERATION_DEFINITIONS.map((op) => (
          <button
            key={op.type}
            type="button"
            className="operation-card"
            onClick={() => onAddStep(op.type, columns)}
            title={`Add ${op.label} step`}
          >
            <div className="op-card-top">
              <span className="op-badge">{op.badge}</span>
              <span className="op-add-icon">+</span>
            </div>
            <strong className="op-title">{op.label}</strong>
            <p className="op-desc">{op.shortDesc}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
