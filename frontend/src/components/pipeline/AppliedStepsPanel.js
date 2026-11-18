import { useEffect, useRef } from 'react';
import WorkflowStepConfig from './WorkflowStepConfig';
import { operations } from '../../lib/pipeline/workflow';

export default function AppliedStepsPanel({ steps, activeId, onSelect, onToggle, onRemove, onMove, onChange,
  schemas, sources, primaryId, capabilities, onPreviewSource, validation = [] }) {
  const index = steps.findIndex((step) => step.id === activeId);
  const active = steps[index];
  const settingsHeading = useRef(null);
  useEffect(() => { settingsHeading.current?.focus(); }, [activeId]);
  const messages = validation.filter((message) => message.startsWith(`Step ${index + 1}:`));
  return <aside className="workbook-inspector" aria-label="Pipeline settings">
    <section className="workbook-applied"><div className="workbook-panel-heading"><h2>Applied steps</h2><span>{steps.length}</span></div>
      {!steps.length && <p className="workbook-hint">Select columns in the sheet and choose a toolbar action. Each change becomes a step.</p>}
      <ol>{steps.map((step, position) => <li key={step.id} className={activeId === step.id ? 'is-active' : ''}>
        <button className="workbook-step-name" type="button" aria-pressed={activeId === step.id} onClick={() => onSelect(step.id)}>
          <span>{position + 1}</span>{operations.find((item) => item.type === step.type)?.label || step.type}{!step.enabled && <small>Off</small>}
        </button>
        {activeId === step.id && <div className="workbook-step-actions"><label><input type="checkbox" checked={step.enabled} onChange={() => onToggle(step.id)} />Enable step {position + 1}</label>
          <button type="button" disabled={position === 0} aria-label={`Move step ${position + 1} up`} onClick={() => onMove(position, -1)}>↑</button>
          <button type="button" disabled={position === steps.length - 1} aria-label={`Move step ${position + 1} down`} onClick={() => onMove(position, 1)}>↓</button>
          <button type="button" aria-label={`Remove step ${position + 1}`} onClick={() => onRemove(step.id)}>Remove</button>
        </div>}
      </li>)}</ol>
    </section>
    <section className="workbook-step-settings" aria-label="Step settings">{active ? <>
      <h3 ref={settingsHeading} tabIndex={-1}>Configure step {index + 1}</h3>
      {!!messages.length && <ul className="workbook-step-errors">{messages.map((message) => <li key={message}>{message.replace(/^Step \d+: /, '')}</li>)}</ul>}
      <WorkflowStepConfig step={active} columns={schemas.before[index]} sources={sources} primaryId={primaryId} capabilities={capabilities} onPreviewSource={onPreviewSource} onChange={onChange} />
    </> : <p className="workbook-hint">Select an applied step to adjust its settings. Source previews show the original saved data.</p>}</section>
  </aside>;
}
