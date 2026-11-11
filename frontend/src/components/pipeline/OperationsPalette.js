import React from 'react';
import { OPERATION_DEFINITIONS } from '../../lib/mock/pipelineDefaults';

const OPERATION_ICONS = {
  select_columns: '▦',
  drop_duplicates: '≠',
  handle_null: '∅',
  cast_type: '↔',
  string_transform: 'Aa',
  filter_rows: '▽',
  replace_value: '⇄',
  format_datetime: '◷',
};

export default function OperationsPalette({ onAddStep, columns }) {
  return (
    <div className="pipeline-panel operations-palette-panel">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Operations</h2>
          <p className="panel-subtitle">Click to add a step</p>
        </div>
      </div>

      <div className="operations-list">
        {OPERATION_DEFINITIONS.map((op) => (
          <button
            key={op.type}
            type="button"
            className="operation-card"
            onClick={() => onAddStep(op.type, columns)}
            title={`${op.label}: ${op.shortDesc}`}
            aria-label={`Add ${op.label} step`}
          >
            <span className="op-icon" aria-hidden="true">{OPERATION_ICONS[op.type]}</span>
            <strong className="op-title">{op.label}</strong>
            <span className="op-add-icon" aria-hidden="true">+</span>
          </button>
        ))}
      </div>
    </div>
  );
}
