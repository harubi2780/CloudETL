import React from 'react';
import ColumnPicker from '../ColumnPicker';

export default function DropDuplicatesConfig({ config, onChange, columns }) {
  const subset = config.subset || [];
  const keep = config.keep || 'first';

  const handleSubsetChange = (nextSubset) => {
    onChange({
      ...config,
      subset: nextSubset,
    });
  };

  return (
    <div className="config-form-section">
      <ColumnPicker
        columns={columns}
        selectedColumns={subset}
        onChange={handleSubsetChange}
        label="Comparison Key Columns"
        helperText="Rows with identical values across all selected key columns will be considered duplicates."
      />

      <div className="config-field" style={{ marginTop: 20 }}>
        <label className="config-label">Retention Rule:</label>
        <div className="radio-group">
          <label className={`radio-label ${keep === 'first' ? 'selected' : ''}`}>
            <input
              type="radio"
              name="keepRule"
              value="first"
              checked={keep === 'first'}
              onChange={() => onChange({ ...config, keep: 'first' })}
            />
            <div>
              <strong>Keep First Occurrence</strong>
              <p className="radio-desc">Retain the first duplicate row found and drop subsequent ones.</p>
            </div>
          </label>
          <label className={`radio-label ${keep === 'last' ? 'selected' : ''}`}>
            <input
              type="radio"
              name="keepRule"
              value="last"
              checked={keep === 'last'}
              onChange={() => onChange({ ...config, keep: 'last' })}
            />
            <div>
              <strong>Keep Last Occurrence</strong>
              <p className="radio-desc">Retain the last duplicate row found and drop earlier ones.</p>
            </div>
          </label>
        </div>
      </div>
    </div>
  );
}
