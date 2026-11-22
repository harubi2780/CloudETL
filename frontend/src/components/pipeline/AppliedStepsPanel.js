import { useEffect, useRef, useState } from 'react';
import WorkflowStepConfig from './WorkflowStepConfig';
import { describeStep, operations } from '../../lib/pipeline/workflow';

export default function AppliedStepsPanel({
  steps,
  activeId,
  onSelect,
  onToggle,
  onRemove,
  onMove,
  onReorder,
  onChange,
  onSourceChange,
  schemas,
  sources,
  sourcesById = null,
  primaryId,
  capabilities,
  onPreviewSource,
  validation = [],
  disabled = false,
}) {
  const index = steps.findIndex((step) => step.id === activeId);
  const active = steps[index];
  const settingsHeading = useRef(null);
  const [dragIndex, setDragIndex] = useState(null);
  const [dropIndex, setDropIndex] = useState(null);

  useEffect(() => { settingsHeading.current?.focus(); }, [activeId]);

  const messages = validation.filter((message) => message.startsWith(`Step ${index + 1}:`));
  const canScopeSource = active && !['join', 'concat'].includes(active.type) && sources.length > 1;
  const sourceMap = sourcesById || Object.fromEntries((sources || []).map((item) => [item.id, item]));

  function handleDragStart(event, position, stepId) {
    if (disabled) return;
    setDragIndex(position);
    setDropIndex(position);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('application/x-cloudetl-drag', 'applied-step');
      event.dataTransfer.setData('text/plain', stepId);
    }
  }

  function handleDragOver(event, position) {
    if (disabled) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    if (dropIndex !== position) setDropIndex(position);
  }

  function handleDragLeave(event, position) {
    if (!event.currentTarget.contains(event.relatedTarget) && dropIndex === position) {
      setDropIndex(null);
    }
  }

  function handleDrop(event, position) {
    event.preventDefault();
    const dragKind = event.dataTransfer?.getData('application/x-cloudetl-drag');
    const transferredId = event.dataTransfer?.getData('text/plain');
    const isForeignDrag = Boolean(
      dragKind && dragKind !== 'applied-step'
      && (dragKind !== transferredId || ['source-tab', 'concat-append'].includes(dragKind)),
    );
    if (isForeignDrag) {
      setDragIndex(null);
      setDropIndex(null);
      return;
    }
    const fromIndex = dragIndex !== null
      ? dragIndex
      : steps.findIndex((item) => item.id === transferredId);
    setDragIndex(null);
    setDropIndex(null);
    if (!disabled && fromIndex >= 0 && fromIndex !== position) {
      if (onReorder) onReorder(fromIndex, position);
      else onMove?.(fromIndex, position - fromIndex);
    }
  }

  function handleDragEnd() {
    setDragIndex(null);
    setDropIndex(null);
  }

  return <aside className="workbook-inspector" aria-label="Pipeline settings">
    <section className="workbook-applied"><div className="workbook-panel-heading"><h2>Applied steps</h2><span>{steps.length}</span></div>
      {!steps.length && <p className="workbook-hint">Select columns in the sheet and choose a toolbar action. Each change becomes a step.</p>}
      <ol>{steps.map((step, position) => {
        const targetName = step.sourceId && step.sourceId !== primaryId
          ? sources.find((item) => item.id === step.sourceId)?.filename
          : '';
        const label = operations.find((item) => item.type === step.type)?.label || step.type;
        const stepErrors = validation.filter((message) => message.startsWith(`Step ${position + 1}:`));
        const summary = describeStep(step, sourceMap);
        const rowClass = [
          activeId === step.id && 'is-active',
          dragIndex === position && 'is-dragging',
          dropIndex === position && dragIndex !== position && 'is-drop-target',
          stepErrors.length > 0 && 'has-error',
        ].filter(Boolean).join(' ') || undefined;

        return <li
          key={step.id}
          className={rowClass}
          draggable={!disabled}
          onDragStart={(event) => handleDragStart(event, position, step.id)}
          onDragOver={(event) => handleDragOver(event, position)}
          onDragLeave={(event) => handleDragLeave(event, position)}
          onDrop={(event) => handleDrop(event, position)}
          onDragEnd={handleDragEnd}
        >
          <div className="workbook-step-row">
            <span className="workbook-drag-handle" aria-hidden="true" title="Drag to reorder">⋮⋮</span>
            <button className="workbook-step-name" type="button" aria-pressed={activeId === step.id} onClick={() => onSelect(step.id)}>
              <span>{position + 1}</span> {label}
              {targetName && <small className="workbook-step-source">{targetName}</small>}
              {stepErrors.length > 0 && (
                <span
                  className="workbook-step-error-badge"
                  title={stepErrors.map((msg) => msg.replace(/^Step \d+: /, '')).join(' ')}
                  aria-label={`${stepErrors.length} validation ${stepErrors.length === 1 ? 'error' : 'errors'}`}
                >
                  {stepErrors.length}
                </span>
              )}
              {!step.enabled && <small>Off</small>}
              <span className="workbook-step-summary">{summary}</span>
            </button>
          </div>
          {activeId === step.id && <div className="workbook-step-actions">
            <label><input type="checkbox" checked={step.enabled} disabled={disabled} onChange={() => onToggle(step.id)} />Enable step {position + 1}</label>
            <button type="button" disabled={disabled || position === 0} aria-label={`Move step ${position + 1} up`} onClick={() => (onMove ? onMove(position, -1) : onReorder?.(position, position - 1))}>↑</button>
            <button type="button" disabled={disabled || position === steps.length - 1} aria-label={`Move step ${position + 1} down`} onClick={() => (onMove ? onMove(position, 1) : onReorder?.(position, position + 1))}>↓</button>
            <button type="button" disabled={disabled} aria-label={`Remove step ${position + 1}`} onClick={() => onRemove(step.id)}>Remove</button>
          </div>}
        </li>;
      })}</ol>
    </section>
    <section className="workbook-step-settings" aria-label="Step settings">{active ? <>
      <h3 ref={settingsHeading} tabIndex={-1}>Configure step {index + 1}</h3>
      {!!messages.length && <ul className="workbook-step-errors">{messages.map((message) => <li key={message}>{message.replace(/^Step \d+: /, '')}</li>)}</ul>}
      {canScopeSource && <label className="etl-field">Target source
        <select value={active.sourceId || primaryId} disabled={disabled} onChange={(event) => onSourceChange?.(active.id, event.target.value === primaryId ? undefined : event.target.value)}>
          {sources.map((source) => (
            <option key={source.id} value={source.id}>
              {source.filename}{source.id === primaryId ? ' (Start)' : ''}
            </option>
          ))}
        </select>
      </label>}
      <WorkflowStepConfig
        key={active.id}
        step={active}
        columns={schemas.before[index]}
        sources={schemas.sourcesBefore?.[index] || sources}
        primaryId={primaryId}
        capabilities={capabilities}
        onPreviewSource={onPreviewSource}
        onChange={onChange}
        disabled={disabled}
      />
    </> : <p className="workbook-hint">Select an applied step to adjust its settings. Source previews show the original saved data.</p>}</section>
  </aside>;
}
