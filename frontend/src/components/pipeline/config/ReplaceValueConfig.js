import React from 'react';
import { SearchableColumnSelect } from '../ColumnPicker';

export default function ReplaceValueConfig({ config, onChange, columns }) {
  const currentColumn = config.column || '';
  const oldValue = config.oldValue || '';
  const newValue = config.newValue || '';

  const handleColumnChange = (newCol) => {
    onChange({
      ...config,
      column: newCol,
    });
  };

  return (
    <div className="config-form-section">
      <div className="config-field">
        <label className="config-label">Target Column:</label>
        <SearchableColumnSelect
          columns={columns}
          value={currentColumn}
          onChange={handleColumnChange}
          placeholder="Select target column..."
        />
        <p className="config-help">Select the column where values should be searched and replaced.</p>
      </div>

      <div className="replace-mapping-grid" style={{ marginTop: 16 }}>
        <div className="config-field">
          <label className="config-label" htmlFor="replace-old-val">Find value (old):</label>
          <input
            id="replace-old-val"
            type="text"
            className="form-input"
            placeholder="e.g. HANOI or canceled"
            value={oldValue}
            onChange={(e) => onChange({ ...config, oldValue: e.target.value })}
          />
        </div>

        <div className="replace-arrow">→</div>

        <div className="config-field">
          <label className="config-label" htmlFor="replace-new-val">Replace with (new):</label>
          <input
            id="replace-new-val"
            type="text"
            className="form-input"
            placeholder="e.g. Ha Noi or voided"
            value={newValue}
            onChange={(e) => onChange({ ...config, newValue: e.target.value })}
          />
        </div>
      </div>

      <p className="config-help" style={{ marginTop: 12 }}>
        All matching occurrences in <strong>{currentColumn || 'selected column'}</strong> will be updated to the new value.
      </p>
    </div>
  );
}
