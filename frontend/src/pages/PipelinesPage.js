import React, { useState, useMemo } from 'react';
import { SAMPLE_DATASET } from '../lib/mock/datasets';
import { createStep, simulatePipeline } from '../lib/mock/pipelineDefaults';
import OperationsPalette from '../components/pipeline/OperationsPalette';
import StepsList from '../components/pipeline/StepsList';
import StepConfigPanel from '../components/pipeline/StepConfigPanel';
import DataPreviewTable from '../components/pipeline/DataPreviewTable';
import './PipelinesPage.css';

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

  const activeStepIndex = useMemo(() => {
    return steps.findIndex((s) => s.id === activeStepId);
  }, [steps, activeStepId]);

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
