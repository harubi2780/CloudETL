import React, { useMemo, useState } from 'react';

export default function ColumnsPanel({ columns = [], onColumnClick }) {
  const [searchQuery, setSearchQuery] = useState('');

  const visibleColumns = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return columns;
    return columns.filter((column) => column.name.toLowerCase().includes(query));
  }, [columns, searchQuery]);

  return (
    <div className="pipeline-panel columns-panel">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Columns</h2>
          <p className="panel-subtitle">Schema after the active step</p>
        </div>
        <span className="badge-count">{columns.length}</span>
      </div>

      <div className="columns-panel-search">
        <input
          type="search"
          className="form-input"
          aria-label="Search columns"
          placeholder="Search columns..."
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
        />
      </div>

      <div className="columns-panel-list">
        {visibleColumns.length === 0 ? (
          <p className="columns-panel-empty">No columns found</p>
        ) : (
          visibleColumns.map((column) => {
            const isDropped = column.status === 'dropped';
            const changeLabel = isDropped
              ? `dropped in step ${column.droppedInStep}`
              : column.status === 'changed'
                ? `changed in step ${column.changedInStep}`
                : null;

            return (
              <button
                key={column.name}
                type="button"
                className={`columns-panel-row ${isDropped ? 'dropped' : ''}`}
                onClick={() => onColumnClick(column.name)}
                aria-label={`${column.name}, ${column.type}${changeLabel ? `, ${changeLabel}` : ''}`}
                title="Click to update the active step configuration"
              >
                <span className="columns-panel-row-main">
                  <span className="columns-panel-name">{column.name}</span>
                  {changeLabel && (
                    <span className="columns-panel-status">{changeLabel}</span>
                  )}
                </span>
                <span className="col-type-badge">{column.type}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
