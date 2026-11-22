import { useEffect, useRef, useState } from 'react';

export default function SourceTabs({
  sources, activeId, primaryId, combinedIds = [],
  splitView = false, canSplit = false, onToggleSplit, onSelect, onAdd, onReorder, disabled = false,
}) {
  const tabs = useRef([]);
  const pendingFocusId = useRef('');
  const [dragIndex, setDragIndex] = useState(null);
  const [dropIndex, setDropIndex] = useState(null);

  useEffect(() => {
    tabs.current = tabs.current.slice(0, sources.length);
    if (!pendingFocusId.current) return;
    const nextIndex = sources.findIndex((item) => item.id === pendingFocusId.current);
    pendingFocusId.current = '';
    if (nextIndex >= 0) tabs.current[nextIndex]?.focus();
  }, [sources]);

  function navigate(event, index) {
    if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
      if (disabled || !onReorder || sources.length < 2) return;
      const target = event.key === 'ArrowLeft' ? index - 1 : index + 1;
      if (target < 0 || target >= sources.length) return;
      pendingFocusId.current = sources[index].id;
      onReorder(index, target);
      return;
    }
    if (event.altKey) return;
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % sources.length;
    if (event.key === 'ArrowLeft') next = (index - 1 + sources.length) % sources.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = sources.length - 1;
    if (next === undefined) return;
    event.preventDefault(); onSelect(sources[next].id); tabs.current[next]?.focus();
  }

  function handleDragStart(event, index, sourceId) {
    if (disabled) return;
    setDragIndex(index);
    setDropIndex(index);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('application/x-cloudetl-drag', 'source-tab');
      event.dataTransfer.setData('text/plain', sourceId);
    }
  }

  function handleDragOver(event, index) {
    if (disabled) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    if (dropIndex !== index) setDropIndex(index);
  }

  function handleDragLeave(event, index) {
    if (!event.currentTarget.contains(event.relatedTarget) && dropIndex === index) {
      setDropIndex(null);
    }
  }

  function handleDrop(event, index) {
    event.preventDefault();
    const dragKind = event.dataTransfer?.getData('application/x-cloudetl-drag');
    const transferredId = event.dataTransfer?.getData('text/plain');
    const isForeignDrag = Boolean(
      dragKind && dragKind !== 'source-tab'
      && (dragKind !== transferredId || ['concat-append', 'applied-step'].includes(dragKind)),
    );
    if (isForeignDrag) {
      setDragIndex(null);
      setDropIndex(null);
      return;
    }
    const fromIndex = dragIndex !== null
      ? dragIndex
      : sources.findIndex((item) => item.id === transferredId);
    setDragIndex(null);
    setDropIndex(null);
    if (!disabled && fromIndex >= 0 && fromIndex !== index) {
      onReorder?.(fromIndex, index);
    }
  }

  function handleDragEnd() {
    setDragIndex(null);
    setDropIndex(null);
  }

  return <div className="workbook-sheet-tabs">
    <div role="tablist" aria-label="Source sheets">{sources.map((source, index) => {
      const isPrimary = source.id === primaryId;
      const isUsed = combinedIds.includes(source.id);
      const dims = source.status === 'ready' && source.preview
        ? ` (${source.preview.final_rows}×${source.preview.columns.length})`
        : '';
      const tabClass = [
        dragIndex === index && 'is-dragging',
        dropIndex === index && dragIndex !== index && 'is-drop-target',
      ].filter(Boolean).join(' ') || undefined;

      return <button
        ref={(element) => { tabs.current[index] = element; }}
        key={source.id}
        type="button"
        role="tab"
        id={`source-tab-${source.id}`}
        className={tabClass}
        aria-controls="workbook-sheet"
        aria-selected={activeId === source.id}
        tabIndex={activeId === source.id ? 0 : -1}
        draggable={!disabled}
        onClick={() => onSelect(source.id)}
        onKeyDown={(event) => navigate(event, index)}
        onDragStart={(event) => handleDragStart(event, index, source.id)}
        onDragOver={(event) => handleDragOver(event, index)}
        onDragLeave={(event) => handleDragLeave(event, index)}
        onDrop={(event) => handleDrop(event, index)}
        onDragEnd={handleDragEnd}
      >
        {source.filename}{dims && <span className="workbook-dim">{dims}</span>}
        {isPrimary
          ? <span className="workbook-primary-mark" aria-label="Starting dataset"> · Start</span>
          : <span className={`workbook-source-badge ${isUsed ? 'is-used' : 'is-unused'}`}> · {isUsed ? 'Used' : 'Unused'}</span>}
      </button>;
    })}</div>
    <div className="workbook-sheet-tab-actions">
      <button type="button" data-source-picker-trigger="true" onClick={onAdd} aria-label="Add source sheet">+ Add source</button>
      {canSplit && <button type="button" className="workbook-split-toggle" aria-pressed={splitView} onClick={onToggleSplit}>Compare side-by-side</button>}
    </div>
  </div>;
}
