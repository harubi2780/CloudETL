import React, { useState, useMemo } from 'react';
import { SAMPLE_DATASET } from '../lib/mock/datasets';
import { checkStepOrderHints, createStep, simulatePipeline } from '../lib/mock/pipelineDefaults';
import OperationsPalette from '../components/pipeline/OperationsPalette';
import StepsList from '../components/pipeline/StepsList';
import ColumnsPanel from '../components/pipeline/ColumnsPanel';
import StepConfigPanel from '../components/pipeline/StepConfigPanel';
import DataPreviewTable from '../components/pipeline/DataPreviewTable';
import { computeSchemaAtStep, getActiveColumns, getWarningsForStep } from '../lib/pipeline/schema';
import { applyToSchema } from '../lib/mock/pipelineDefaults';
import './PipelinesPage.css';



export default function PipelinesPage() {
  const [pipelineName, setPipelineName] = useState('Data Cleaning Pipeline');
  const [selectedDataset] = useState(SAMPLE_DATASET);
  const [activeStepId, setActiveStepId] = useState('step-init-1');
  const [notification, setNotification] = useState(null);
  const [dismissedWarning, setDismissedWarning] = useState(null);

  // Initial clean pipeline steps (no fake stats)
  const [steps, setSteps] = useState([
    {
      id: 'step-init-1',
      type: 'string_transform',
      name: 'Normalize Text',
      config: {
        columns: ['full_name', 'email'],
        trim: true,
        caseMode: 'title',
      },
      enabled: true,
    },
    {
      id: 'step-init-2',
      type: 'handle_null',
      name: 'Handle NULL',
      config: {
        rules: [
          { column: 'age', strategy: 'drop_row', customValue: '' },
          { column: 'amount', strategy: 'fill_custom', customValue: '0' },
        ],
      },
      enabled: true,
    },
    {
      id: 'step-init-3',
      type: 'drop_duplicates',
      name: 'Remove Duplicates',
      config: {
        subset: ['email'],
        keep: 'first',
      },
      enabled: true,
    },
  ]);

  const activeStep = useMemo(() => {
    return steps.find((s) => s.id === activeStepId) || null;
  }, [steps, activeStepId]);

  // Index of the active step for convenience
  const activeStepIndex = useMemo(() => steps.findIndex((s) => s.id === activeStepId), [steps, activeStepId]);

  const baseSchema = useMemo(
    () => selectedDataset.columns.map((column) => ({ name: column.name, type: column.type })),
    [selectedDataset]
  );

  // Compute schema before the active step (used by configuration controls).
  const schemaBeforeActiveStep = useMemo(() => {
    if (activeStepIndex < 0) return [];
    return getActiveColumns(computeSchemaAtStep(baseSchema, steps, activeStepIndex - 1));
  }, [baseSchema, steps, activeStepIndex]);

  // Compute schema after the active step (used by the Columns panel).
  const schemaAfterActiveStep = useMemo(() => {
    const index = activeStepIndex < 0 ? steps.length - 1 : activeStepIndex;
    return computeSchemaAtStep(baseSchema, steps, index);
  }, [baseSchema, steps, activeStepIndex]);

  // Compute warnings for each step
  const stepWarnings = useMemo(() => {
    const warningsMap = {};
    let schemaSoFar = baseSchema;
    steps.forEach((step, idx) => {
      const warnings = getWarningsForStep(schemaSoFar, step, idx);
      if (warnings.length) warningsMap[step.id] = warnings;
      // update schemaSoFar for next step
      schemaSoFar = applyToSchema(schemaSoFar, step, idx);
    });
    return warningsMap;
  }, [baseSchema, steps]);

  const pipelineWarningText = useMemo(() => {
    const warningsByGroup = new Map();
    Object.values(stepWarnings).flat().forEach((warning) => {
      const key = `${warning.type}:${warning.column}:${warning.previousStep}`;
      if (!warningsByGroup.has(key)) warningsByGroup.set(key, { ...warning, steps: [] });
      warningsByGroup.get(key).steps.push(warning.step);
    });

    const messages = Array.from(warningsByGroup.values()).map((warning) => {
      const usedSteps = Array.from(new Set(warning.steps)).sort((a, b) => a - b);
      const stepLabel = usedSteps.length === 1 ? 'step' : 'steps';
      const usage = `${stepLabel} ${usedSteps.join(', ')}`;
      if (warning.type === 'dropped') {
        return `${warning.column} was dropped in step ${warning.previousStep} but is used in ${usage}`;
      }
      return `${warning.column} was changed in step ${warning.previousStep} but is used in ${usage}`;
    });

    checkStepOrderHints(steps).forEach((hint) => messages.push(hint.message));
    return messages.join('. ');
  }, [stepWarnings, steps]);

  const handleColumnClick = (colName) => {
    if (!activeStep) return;
    const { type, config } = activeStep;
    const newConfig = { ...config };
    const toggleColumn = (columns = []) => (
      columns.includes(colName)
        ? columns.filter((column) => column !== colName)
        : [...columns, colName]
    );

    switch (type) {
      case 'select_columns':
        newConfig.selectedColumns = toggleColumn(config.selectedColumns);
        break;
      case 'drop_duplicates':
        {
          const rules = Array.isArray(config.rules)
            ? config.rules
            : [{ allColumns: false, columns: config.subset || [], keep: config.keep || 'first' }];
          const firstRule = rules[0] || { allColumns: false, columns: [], keep: 'first' };
          newConfig.rules = [
            { ...firstRule, allColumns: false, columns: toggleColumn(firstRule.columns || []) },
            ...rules.slice(1),
          ];
          delete newConfig.subset;
          delete newConfig.keep;
        }
        break;
      case 'string_transform':
        if (Array.isArray(config.rules)) {
          newConfig.rules = config.rules.some((rule) => rule.column === colName)
            ? config.rules.filter((rule) => rule.column !== colName)
            : [...config.rules, { column: colName, trim: true, caseMode: 'title' }];
        } else {
          newConfig.columns = toggleColumn(config.columns);
        }
        break;
      case 'cast_type':
        newConfig.conversions = (config.conversions || []).some((conversion) => conversion.column === colName)
          ? config.conversions.filter((conversion) => conversion.column !== colName)
          : [...(config.conversions || []), { column: colName, toType: 'string' }];
        break;
      case 'format_datetime':
      case 'replace_value':
        newConfig.column = config.column === colName ? '' : colName;
        break;
      case 'handle_null':
        {
          const rules = Array.isArray(config.rules)
            ? config.rules
            : (config.column ? [{
              column: config.column,
              strategy: config.strategy || 'drop',
              customValue: config.customValue || '',
            }] : []);
          const hasColumn = rules.some((rule) => rule.column === colName);
          const nextRules = hasColumn
            ? rules.filter((rule) => rule.column !== colName)
            : [...rules, { column: colName, strategy: 'drop', customValue: '' }];
          newConfig.rules = nextRules.length
            ? nextRules
            : [{ column: '', strategy: 'drop', customValue: '' }];
          delete newConfig.column;
          delete newConfig.strategy;
          delete newConfig.customValue;
        }
        break;
      case 'filter_rows':
        newConfig.conditions = (config.conditions || []).some((condition) => condition.column === colName)
          ? config.conditions.filter((condition) => condition.column !== colName)
          : [...(config.conditions || []), { column: colName, operator: 'equals', value: '' }];
        break;
      default:
        // other steps ignore column clicks
        return;
    }
    handleUpdateConfig(newConfig);
  };



  const handleAddStep = (type, cols) => {
    const newStep = createStep(type, cols || selectedDataset.columns);
    setSteps((prev) => [...prev, newStep]);
    setActiveStepId(newStep.id);
    showNotice(`Added step "${newStep.name}" to pipeline.`, 'success');
  };

  const handleUpdateConfig = (newConfig) => {
    if (!activeStepId) return;
    setSteps((prev) =>
      prev.map((s) => (s.id === activeStepId ? { ...s, config: newConfig } : s))
    );
  };

  const handleToggleStep = (stepId) => {
    setSteps((prev) =>
      prev.map((s) => (s.id === stepId ? { ...s, enabled: !s.enabled } : s))
    );
  };

  const handleRemoveStep = (stepId) => {
    setSteps((prev) => {
      const next = prev.filter((s) => s.id !== stepId);
      if (activeStepId === stepId) {
        setActiveStepId(next.length > 0 ? next[0].id : null);
      }
      return next;
    });
    showNotice('Step removed from pipeline.', 'info');
  };

  const handleReorderSteps = (sourceIdx, targetIdx) => {
    setSteps((prev) => {
      const result = Array.from(prev);
      const [removed] = result.splice(sourceIdx, 1);
      result.splice(targetIdx, 0, removed);
      return result;
    });
  };

  const handleMoveStep = (index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= steps.length) return;
    handleReorderSteps(index, target);
  };

  const showNotice = (msg, type = 'success') => {
    setNotification({ msg, type });
    setTimeout(() => {
      setNotification((curr) => (curr?.msg === msg ? null : curr));
    }, 3500);
  };

  const handleSave = () => {
    const pipelinePayload = {
      name: pipelineName,
      datasetId: selectedDataset.id,
      steps: steps.map(({ id, type, name, config, enabled }) => ({
        id,
        type,
        name,
        config,
        enabled,
      })),
      updatedAt: new Date().toISOString(),
    };
    console.log('[Pipeline Save Payload]:', JSON.stringify(pipelinePayload, null, 2));
    showNotice(`Pipeline "${pipelineName}" saved successfully!`, 'success');
  };

  const beforePreview = useMemo(() => {
    return {
      columns: selectedDataset.columns,
      rows: selectedDataset.beforeRows,
    };
  }, [selectedDataset]);

  const afterPreview = useMemo(() => {
    return simulatePipeline(selectedDataset, steps, activeStepId);
  }, [selectedDataset, steps, activeStepId]);

  return (
    <div className="pipeline-builder-page">
      {/* Kept for accessibility and App.test.js requirement */}
      <h1 className="sr-only">Pipelines</h1>

      {/* Top Header Toolbar - only Pipeline Name input and Save button */}
      <header className="pipeline-top-header">
        <div className="pipeline-title-group">
          <label className="sr-only" htmlFor="pipeline-name-input">
            Pipeline Name
          </label>
          <input
            id="pipeline-name-input"
            type="text"
            className="pipeline-name-input"
            value={pipelineName}
            onChange={(e) => setPipelineName(e.target.value)}
            placeholder="Enter pipeline name..."
          />
        </div>

        <div className="pipeline-actions-group">
          <button
            type="button"
            className="button button-primary save-btn"
            onClick={handleSave}
          >
            Save
          </button>
        </div>
      </header>

      {/* Toast Notification */}
      {notification && (
        <div className={`pipeline-toast-notification ${notification.type}`} role="alert">
          <span>{notification.type === 'success' ? '✓' : 'ℹ'}</span>
          <span>{notification.msg}</span>
        </div>
      )}

      {/* Pipeline workbench */}
      <section className="pipeline-columns-grid">
        <OperationsPalette
          onAddStep={handleAddStep}
          columns={selectedDataset.columns}
        />

        <StepsList
          steps={steps}
          columns={schemaBeforeActiveStep}
          activeStepId={activeStepId}
          onSelectStep={setActiveStepId}
          onToggleStep={handleToggleStep}
          onRemoveStep={handleRemoveStep}
          onReorderSteps={handleReorderSteps}
          onMoveStep={handleMoveStep}
          stepWarnings={stepWarnings}
          warningMessage={pipelineWarningText !== dismissedWarning ? pipelineWarningText : ''}
          onDismissWarning={() => setDismissedWarning(pipelineWarningText)}
        />

        <ColumnsPanel
          columns={schemaAfterActiveStep}
          onColumnClick={handleColumnClick}
        />

        <StepConfigPanel
          step={activeStep}
          stepIndex={activeStepIndex}
          columns={schemaBeforeActiveStep}
          schemaAfterActiveStep={schemaAfterActiveStep}
          onColumnClick={handleColumnClick}
          onUpdateConfig={handleUpdateConfig}
          onToggleStep={handleToggleStep}
        />
      </section>

      {/* Bottom Sample Preview Section */}
      <section className="pipeline-preview-section">
        <DataPreviewTable
          dataset={selectedDataset}
          beforeData={beforePreview}
          afterData={afterPreview}
          activeStep={activeStep}
          stepIndex={activeStepIndex}
        />
      </section>
    </div>
  );
}
