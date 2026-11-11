import React from 'react';
import SelectColumnsConfig from './config/SelectColumnsConfig';
import DropDuplicatesConfig from './config/DropDuplicatesConfig';
import HandleNullConfig from './config/HandleNullConfig';
import CastTypeConfig from './config/CastTypeConfig';
import StringTransformConfig from './config/StringTransformConfig';
import FilterRowsConfig from './config/FilterRowsConfig';
import ReplaceValueConfig from './config/ReplaceValueConfig';
import DateTimeConfig from './config/DateTimeConfig';

export default function StepConfigPanel({
  step,
  stepIndex,
  columns,
  onUpdateConfig,
  onToggleStep,
}) {
  if (!step) {
    return (
      <div className="pipeline-panel config-panel empty">
        <div className="panel-header">
          <h2 className="panel-title">Step Configuration</h2>
        </div>
        <div className="config-empty-state">
          <div className="empty-icon-box">⚙️</div>
          <h3>No Step Selected</h3>
          <p>Click on any step in the middle panel to configure its parameters and options.</p>
        </div>
      </div>
    );
  }

  const renderConfigComponent = () => {
    switch (step.type) {
      case 'select_columns':
        return (
          <SelectColumnsConfig
            config={step.config}
            onChange={onUpdateConfig}
            columns={columns}
          />
        );
      case 'drop_duplicates':
        return (
          <DropDuplicatesConfig
            config={step.config}
            onChange={onUpdateConfig}
            columns={columns}
          />
        );
      case 'handle_null':
        return (
          <HandleNullConfig
            config={step.config}
            onChange={onUpdateConfig}
            columns={columns}
          />
        );
      case 'cast_type':
        return (
          <CastTypeConfig
            config={step.config}
            onChange={onUpdateConfig}
            columns={columns}
          />
        );
      case 'string_transform':
        return (
          <StringTransformConfig
            config={step.config}
            onChange={onUpdateConfig}
            columns={columns}
          />
        );
      case 'filter_rows':
        return (
          <FilterRowsConfig
            config={step.config}
            onChange={onUpdateConfig}
            columns={columns}
          />
        );
      case 'replace_value':
        return (
          <ReplaceValueConfig
            config={step.config}
            onChange={onUpdateConfig}
            columns={columns}
          />
        );
      case 'format_datetime':
        return (
          <DateTimeConfig
            config={step.config}
            onChange={onUpdateConfig}
            columns={columns}
          />
        );
      default:
        return <p className="config-help">No configuration form available for this operation.</p>;
    }
  };

  return (
    <div className="pipeline-panel config-panel">
      <div className="panel-header">
        <div>
          <div className="config-header-meta">
            <span className="step-tag">Step {stepIndex + 1}</span>
            <span className="type-badge">{step.type}</span>
          </div>
          <h2 className="panel-title">{step.name}</h2>
        </div>

        <label className="step-toggle" title={step.enabled ? 'Disable this step' : 'Enable this step'}>
          <input
            type="checkbox"
            checked={step.enabled}
            onChange={() => onToggleStep(step.id)}
          />
          <span className="toggle-slider" />
        </label>
      </div>

      {!step.enabled && (
        <div className="step-disabled-banner">
          ⚠️ This step is currently disabled and excluded from pipeline execution.
        </div>
      )}

      <div className="config-body">{renderConfigComponent()}</div>
    </div>
  );
}
