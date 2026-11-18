import { useRef } from 'react';

export default function SourceTabs({ sources, activeId, primaryId, onSelect, onAdd }) {
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
    <div role="tablist" aria-label="Source sheets">{sources.map((source, index) =>
      <button ref={(element) => { tabs.current[index] = element; }} key={source.id} type="button" role="tab"
        id={`source-tab-${source.id}`} aria-controls="workbook-sheet" aria-selected={activeId === source.id}
        tabIndex={activeId === source.id ? 0 : -1} onClick={() => onSelect(source.id)} onKeyDown={(event) => navigate(event, index)}>
        {source.filename}{source.id === primaryId && <span className="workbook-primary-mark" aria-label="Starting dataset"> · Start</span>}
      </button>
    )}</div>
    <button type="button" onClick={onAdd} aria-label="Add source sheet">+ Add source</button>
  </div>;
}
