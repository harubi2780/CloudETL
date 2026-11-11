import React, { useState, useMemo, useRef, useEffect } from 'react';

/**
 * Multi-column picker with case-insensitive search, Select all/Clear
 * (applying specifically to visible filtered items), type badges, and filterType support.
 */
export default function ColumnPicker({
  columns = [],
  selectedColumns = [],
  onChange,
  filterType = null,
  allowedTypes = filterType,
  label = 'Target Columns',
  helperText = '',
}) {
  const [searchQuery, setSearchQuery] = useState('');

  const eligibleColumns = useMemo(() => {
    return columns.filter((col) => {
      if (col.status === 'dropped') return false;
      if (!allowedTypes) return true;
      if (Array.isArray(allowedTypes)) return allowedTypes.includes(col.type);
      return col.type === allowedTypes;
    });
  }, [columns, allowedTypes]);

  const visibleColumns = useMemo(() => {
    if (!searchQuery.trim()) return eligibleColumns;
    const q = searchQuery.toLowerCase().trim();
    return eligibleColumns.filter((col) => col.name.toLowerCase().includes(q));
  }, [eligibleColumns, searchQuery]);

  const handleToggle = (colName) => {
    if (!eligibleColumns.some((column) => column.name === colName)) return;
    const next = selectedColumns.includes(colName)
      ? selectedColumns.filter((c) => c !== colName)
      : [...selectedColumns, colName];
    onChange(next);
  };

  const handleSelectAllVisible = () => {
    const visibleNames = visibleColumns.map((c) => c.name);
    const combined = Array.from(new Set([...selectedColumns, ...visibleNames]));
    onChange(combined);
  };

  const handleClearVisible = () => {
    const visibleNames = new Set(visibleColumns.map((c) => c.name));
    const remaining = selectedColumns.filter((c) => !visibleNames.has(c));
    onChange(remaining);
  };
  const selectedVisibleCount = visibleColumns.filter((column) => selectedColumns.includes(column.name)).length;

  return (
    <div className="column-picker-container">
      <div className="config-field-header">
        <label className="config-label">{label}:</label>
        <div className="config-quick-actions">
          <button
            type="button"
            className="text-btn"
            onClick={handleSelectAllVisible}
            disabled={visibleColumns.length === 0}
          >
            Select all
          </button>
          <span className="divider">|</span>
          <button
            type="button"
            className="text-btn"
            onClick={handleClearVisible}
            disabled={selectedVisibleCount === 0}
          >
            Clear
          </button>
        </div>
      </div>

      {helperText && <p className="config-help">{helperText}</p>}

      <div className="column-picker-search-box">
        <input
          type="text"
          className="form-input search-input"
          placeholder="Search columns..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchQuery && (
          <button
            type="button"
            className="clear-search-btn"
            onClick={() => setSearchQuery('')}
            title="Clear search"
          >
            ✕
          </button>
        )}
      </div>

      <div className="columns-checkbox-list">
        {visibleColumns.length === 0 ? (
          <div className="columns-empty-match">
            No columns found
          </div>
        ) : (
          visibleColumns.map((col) => {
            const isChecked = selectedColumns.includes(col.name);
            return (
              <label
                key={col.name}
                className={`column-checkbox-item ${isChecked ? 'checked' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => handleToggle(col.name)}
                />
                <span className="col-name">{col.name}</span>
                <span className="col-type-badge">{col.type}</span>
              </label>
            );
          })
        )}
      </div>

      <div className="config-summary-note">
        Selected <strong>{selectedColumns.length}</strong> of {eligibleColumns.length} column{eligibleColumns.length !== 1 ? 's' : ''}
      </div>
    </div>
  );
}

/**
 * Searchable single-column dropdown select.
 * Used for single-column selections and multi-row builders (Filter Rows, Convert Data Type, etc.).
 */
export function SearchableColumnSelect({
  columns = [],
  value = '',
  onChange,
  filterType = null,
  placeholder = 'Select column...',
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapperRef = useRef(null);

  const eligibleColumns = useMemo(() => {
    return columns.filter((col) => {
      if (col.status === 'dropped') return false;
      if (!filterType) return true;
      if (Array.isArray(filterType)) return filterType.includes(col.type);
      return col.type === filterType;
    });
  }, [columns, filterType]);

  const visibleColumns = useMemo(() => {
    if (!search.trim()) return eligibleColumns;
    const q = search.toLowerCase().trim();
    return eligibleColumns.filter((col) => col.name.toLowerCase().includes(q));
  }, [eligibleColumns, search]);

  const selectedCol = eligibleColumns.find((c) => c.name === value);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="searchable-select-wrapper" ref={wrapperRef}>
      <button
        type="button"
        className={`searchable-select-trigger ${!value ? 'placeholder' : ''}`}
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <span className="trigger-label">
          {selectedCol ? (
            <>
              <strong>{selectedCol.name}</strong>
              <span className="col-type-badge">{selectedCol.type}</span>
            </>
          ) : (
            placeholder
          )}
        </span>
        <span className="dropdown-arrow">▾</span>
      </button>

      {isOpen && (
        <div className="searchable-select-menu">
          <div className="menu-search-box">
            <input
              type="text"
              className="menu-search-input"
              placeholder="Search column..."
              value={search}
              autoFocus
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="menu-options-list">
            {visibleColumns.length === 0 ? (
              <div className="menu-no-results">No columns found</div>
            ) : (
              visibleColumns.map((col) => (
                <button
                  key={col.name}
                  type="button"
                  className={`menu-option-item ${col.name === value ? 'selected' : ''}`}
                  onClick={() => {
                    onChange(col.name);
                    setIsOpen(false);
                    setSearch('');
                  }}
                >
                  <span className="col-name">{col.name}</span>
                  <span className="col-type-badge">{col.type}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
