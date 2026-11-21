import { useRef } from 'react';

export default function SourceTabs({
  sources, activeId, primaryId, combinedIds = [],
  splitView = false, canSplit = false, onToggleSplit, onSelect, onAdd,
}) {
  const tabs = useRef([]);
  function navigate(event, index) {
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % sources.length;
    if (event.key === 'ArrowLeft') next = (index - 1 + sources.length) % sources.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = sources.length - 1;
    if (next === undefined) return;
    event.preventDefault(); onSelect(sources[next].id); tabs.current[next]?.focus();
  }
  return <div className="workbook-sheet-tabs">
    <div role="tablist" aria-label="Source sheets">{sources.map((source, index) => {
      const isPrimary = source.id === primaryId;
      const isUsed = combinedIds.includes(source.id);
      const dims = source.status === 'ready' && source.preview
        ? ` (${source.preview.final_rows}×${source.preview.columns.length})`
        : '';
      return <button ref={(element) => { tabs.current[index] = element; }} key={source.id} type="button" role="tab"
        id={`source-tab-${source.id}`} aria-controls="workbook-sheet" aria-selected={activeId === source.id}
        tabIndex={activeId === source.id ? 0 : -1} onClick={() => onSelect(source.id)} onKeyDown={(event) => navigate(event, index)}>
        {source.filename}{dims && <span className="workbook-dim">{dims}</span>}
        {isPrimary
          ? <span className="workbook-primary-mark" aria-label="Starting dataset"> · Start</span>
          : <span className={`workbook-source-badge ${isUsed ? 'is-used' : 'is-unused'}`}> · {isUsed ? 'Used' : 'Unused'}</span>}
      </button>;
    })}</div>
    <div className="workbook-sheet-tab-actions">
      <button type="button" onClick={onAdd} aria-label="Add source sheet">+ Add source</button>
      {canSplit && <button type="button" className="workbook-split-toggle" aria-pressed={splitView} onClick={onToggleSplit}>Compare side-by-side</button>}
    </div>
  </div>;
}
