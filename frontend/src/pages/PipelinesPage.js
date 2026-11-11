import React, { useState, useMemo } from 'react';
import { SAMPLE_DATASET } from '../lib/mock/datasets';
import { createStep, simulatePipeline } from '../lib/mock/pipelineDefaults';
import OperationsPalette from '../components/pipeline/OperationsPalette';
import StepsList from '../components/pipeline/StepsList';
import StepConfigPanel from '../components/pipeline/StepConfigPanel';
import DataPreviewTable from '../components/pipeline/DataPreviewTable';
import { computeSchemaAtStep, getWarningsForStep } from '../lib/pipeline/schema';
import { applyToSchema } from '../lib/mock/pipelineDefaults';



export default function PipelinesPage() {
  const [pipelineName, setPipelineName] = useState('Data Cleaning Pipeline');
  const [dataset] = useState(SAMPLE_DATASET);
  const [activeStepId, setActiveStepId] = useState('step-init-1');
  const [notification, setNotification] = useState(null);

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

  // Compute schema before the active step (used by ColumnPicker)
  const schemaBeforeActiveStep = useMemo(() => {
    if (!activeStepIndex || activeStepIndex < 0) return [];
    const baseSchema = dataset.columns.map(col => ({ name: col.name, type: col.type }));
    return computeSchemaAtStep(baseSchema, steps, activeStepIndex - 1);
  }, [dataset.columns, steps, activeStepIndex]);

  // Compute full schema after all steps (used for Columns panel)
  const schemaAfterAllSteps = useMemo(() => {
    const baseSchema = dataset.columns.map(col => ({ name: col.name, type: col.type }));
    return computeSchemaAtStep(baseSchema, steps, steps.length - 1);
  }, [dataset.columns, steps]);

  // Compute warnings for each step
  const stepWarnings = useMemo(() => {
    const warningsMap = {};
    const baseSchema = dataset.columns.map(col => ({ name: col.name, type: col.type }));
    let schemaSoFar = baseSchema;
    steps.forEach((step, idx) => {
      const warnings = getWarningsForStep(schemaSoFar, step);
      if (warnings.length) warningsMap[step.id] = warnings;
      // update schemaSoFar for next step
      schemaSoFar = applyToSchema(schemaSoFar, step, idx);
    });
    return warningsMap;
  }, [dataset.columns, steps]);

  const handleColumnClick = (colName) => {
    if (!activeStep) return;
    const { type, config } = activeStep;
    let newConfig = { ...config };
    switch (type) {
      case 'select_columns':
        // toggle column in selectedColumns array
        const sel = new Set(newConfig.selectedColumns || []);
        if (sel.has(colName)) sel.delete(colName); else sel.add(colName);
        newConfig.selectedColumns = Array.from(sel);
        break;
      case 'cast_type':
        // add or update conversion for this column to a default type (string)
        const convs = newConfig.conversions || [];
        const existing = convs.find(c => c.column === colName);
        if (existing) {
          existing.toType = existing.toType === 'string' ? 'integer' : 'string';
        } else {
          convs.push({ column: colName, toType: 'string' });
        }
        newConfig.conversions = convs;
        break;
      case 'format_datetime':
        newConfig.column = colName;
        break;
      default:
        // other steps ignore column clicks
        return;
    }
    handleUpdateConfig(newConfig);
  };



  const handleAddStep = (type, cols) => {
    const newStep = createStep(type, cols || dataset.columns);
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
      datasetId: dataset.id,
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
      columns: dataset.columns,
      rows: dataset.beforeRows,
    };
  }, [dataset]);

  const afterPreview = useMemo(() => {
    return simulatePipeline(dataset, steps, activeStepId);
  }, [dataset, steps, activeStepId]);

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

      {/* 3-Column Layout */}
      <section className="pipeline-columns-grid">
        {/* Column 1: Operations */}
        <OperationsPalette
          onAddStep={handleAddStep}
          columns={dataset.columns}
        />

        {/* Column 2: Selected Steps */}
        <StepsList
          steps={steps}
          activeStepId={activeStepId}
          onSelectStep={setActiveStepId}
          onToggleStep={handleToggleStep}
          onRemoveStep={handleRemoveStep}
          onReorderSteps={handleReorderSteps}
          onMoveStep={handleMoveStep}
        />

        {/* Column 3: Step Configuration */}
        <StepConfigPanel
          step={activeStep}
          stepIndex={activeStepIndex}
          columns={dataset.columns}
          onUpdateConfig={handleUpdateConfig}
          onToggleStep={handleToggleStep}
        />
      </section>

      {/* Bottom Sample Preview Section */}
      <section className="pipeline-preview-section">
        <DataPreviewTable
          dataset={dataset}
          beforeData={beforePreview}
          afterData={afterPreview}
          activeStep={activeStep}
          stepIndex={activeStepIndex}
        />
      </section>
    </div>
  );
}
