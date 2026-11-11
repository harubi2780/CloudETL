import React from 'react';
import { SearchableColumnSelect } from '../ColumnPicker';

export default function DateTimeConfig({ config, onChange, columns }) {
  const currentColumn = config.column || '';
  const inputFormat = config.inputFormat || 'auto';
  const outputFormat = config.outputFormat || 'YYYY-MM-DD';

  const handleColumnChange = (newCol) => {
    onChange({
      ...config,
      column: newCol,
    });
  };

  return (
    <div className="config-form-section">
      <div className="config-field">
        <label className="config-label">Target DateTime Column:</label>
        <SearchableColumnSelect
          columns={columns}
          value={currentColumn}
          onChange={handleColumnChange}
          placeholder="Select datetime column..."
        />
        <p className="config-help">Select the date or timestamp column to standardize.</p>
      </div>

      <div className="config-field" style={{ marginTop: 16 }}>
        <label className="config-label" htmlFor="dt-in-fmt">Source Input Format:</label>
        <select
          id="dt-in-fmt"
          className="form-select"
          value={inputFormat}
          onChange={(e) => onChange({ ...config, inputFormat: e.target.value })}
        >
          <option value="auto">Auto-detect input pattern</option>
          <option value="YYYY-MM-DD">YYYY-MM-DD (e.g. 2023-11-20)</option>
          <option value="DD/MM/YYYY">DD/MM/YYYY (e.g. 20/11/2023)</option>
          <option value="MM-DD-YYYY">MM-DD-YYYY (e.g. 11-20-2023)</option>
          <option value="YYYY/MM/DD">YYYY/MM/DD (e.g. 2023/11/20)</option>
        </select>
      </div>

      <div className="config-field" style={{ marginTop: 16 }}>
        <label className="config-label" htmlFor="dt-out-fmt">Target Standardized Format:</label>
        <select
          id="dt-out-fmt"
          className="form-select"
          value={outputFormat}
          onChange={(e) => onChange({ ...config, outputFormat: e.target.value })}
        >
          <option value="YYYY-MM-DD">YYYY-MM-DD (Standard ISO Date, e.g. 2023-11-20)</option>
          <option value="YYYY-MM-DD HH:mm:ss">YYYY-MM-DD HH:mm:ss (e.g. 2023-11-20 14:30:00)</option>
          <option value="ISO_8601">ISO 8601 UTC (e.g. 2023-11-20T00:00:00.000Z)</option>
          <option value="DD/MM/YYYY">DD/MM/YYYY (e.g. 20/11/2023)</option>
        </select>
        <p className="config-help">
          Harmonizes heterogeneous date formats across rows into a clean, uniform standard.
        </p>
      </div>
    </div>
  );
}
