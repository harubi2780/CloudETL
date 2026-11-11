import React from 'react';
import { SearchableColumnSelect } from '../ColumnPicker';

/**
 * Convert Data Type (Cast Type) - Multi-row configuration
 * Each row: { column: string, toType: string }
 */
export default function CastTypeConfig({ config, onChange, columns }) {
  const conversions = config.conversions || (config.column ? [{ column: config.column, toType: config.toType || 'string' }] : []);

  const handleUpdateRow = (index, field, val) => {
    const next = conversions.map((row, idx) => {
      if (idx === index) {
        return { ...row, [field]: val };
      }
      return row;
    });
    onChange({ ...config, conversions: next });
  };

  const handleAddRow = () => {
    const available = columns.find((c) => !conversions.some((r) => r.column === c.name));
    const nextCol = available ? available.name : (columns[0] ? columns[0].name : '');
    onChange({
      ...config,
      conversions: [
        ...conversions,
        {
          column: nextCol,
          toType: 'string',
        },
      ],
    });
  };

  const handleRemoveRow = (index) => {
    const next = conversions.filter((_, idx) => idx !== index);
    onChange({ ...config, conversions: next });
  };

  return (
    <div className="config-form-section">
      <div className="config-field-header">
        <label className="config-label">Type Conversions:</label>
        <span className="config-help">Cast multiple columns to destination types</span>
      </div>

      <div className="multi-row-list" style={{ marginTop: 12 }}>
        {conversions.length === 0 ? (
          <div className="multi-row-empty">
            No columns configured for casting. Click <strong>+ Add column</strong> below.
          </div>
        ) : (
          conversions.map((row, idx) => (
            <div key={idx} className="multi-row-card">
              <div className="row-col-selector">
                <SearchableColumnSelect
                  columns={columns}
                  value={row.column}
                  onChange={(newCol) => handleUpdateRow(idx, 'column', newCol)}
                  placeholder="Select column..."
                />
              </div>

              <span className="row-arrow">→</span>

              <div className="row-type-selector">
                <select
                  className="form-select row-select"
                  value={row.toType}
                  onChange={(e) => handleUpdateRow(idx, 'toType', e.target.value)}
                >
                  <option value="integer">integer</option>
                  <option value="float">float</option>
                  <option value="string">string</option>
                  <option value="boolean">boolean</option>
                </select>
              </div>

              <button
                type="button"
                className="row-delete-btn"
                onClick={() => handleRemoveRow(idx)}
                title="Remove this conversion"
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>

      <div style={{ marginTop: 14 }}>
        <button
          type="button"
          className="button button-secondary add-row-btn"
          onClick={handleAddRow}
        >
          + Add column
        </button>
      </div>

      <p className="config-help" style={{ marginTop: 12 }}>
        Each specified column will be cast to its destination data type during pipeline execution.
      </p>
    </div>
  );
}
