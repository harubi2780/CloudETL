import React from 'react';
import { SearchableColumnSelect } from '../ColumnPicker';

/**
 * Filter Rows - Multi-row configuration
 * Each condition: { column: string, operator: string, value: string }
 */
export default function FilterRowsConfig({ config, onChange, columns }) {
  const conditions = config.conditions || (config.column ? [{ column: config.column, operator: config.operator || 'greater_than', value: config.value || '' }] : []);

  const handleUpdateRow = (index, field, val) => {
    const next = conditions.map((row, idx) => {
      if (idx === index) {
        return { ...row, [field]: val };
      }
      return row;
    });
    onChange({ ...config, conditions: next });
  };

  const handleAddCondition = () => {
    const defaultCol = columns[0] ? columns[0].name : '';
    onChange({
      ...config,
      conditions: [
        ...conditions,
        {
          column: defaultCol,
          operator: 'equals',
          value: '',
        },
      ],
    });
  };

  const handleRemoveCondition = (index) => {
    const next = conditions.filter((_, idx) => idx !== index);
    onChange({ ...config, conditions: next });
  };

  return (
    <div className="config-form-section">
      <div className="config-field-header">
        <label className="config-label">Filter Conditions:</label>
        <span className="config-help">All conditions are evaluated with AND logic</span>
      </div>

      <div className="multi-row-list" style={{ marginTop: 12 }}>
        {conditions.length === 0 ? (
          <div className="multi-row-empty">
            No filter conditions specified. Click <strong>+ Add condition</strong> below.
          </div>
        ) : (
          conditions.map((row, idx) => {
            const isFlag = row.operator === 'is_true' || row.operator === 'is_false';
            return (
              <div key={idx} className="multi-row-card condition-card">
                <div className="row-col-selector">
                  <SearchableColumnSelect
                    columns={columns}
                    value={row.column}
                    onChange={(newCol) => handleUpdateRow(idx, 'column', newCol)}
                    placeholder="Select column..."
                  />
                </div>

                <div className="row-op-selector">
                  <select
                    className="form-select row-select"
                    value={row.operator}
                    onChange={(e) => handleUpdateRow(idx, 'operator', e.target.value)}
                  >
                    <option value="equals">= (equals)</option>
                    <option value="greater_than">&gt; (greater than)</option>
                    <option value="less_than">&lt; (less than)</option>
                    <option value="contains">contains</option>
                    <option value="is_true">is TRUE</option>
                    <option value="is_false">is FALSE</option>
                  </select>
                </div>

                {!isFlag ? (
                  <div className="row-val-input">
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Value..."
                      value={row.value || ''}
                      onChange={(e) => handleUpdateRow(idx, 'value', e.target.value)}
                    />
                  </div>
                ) : (
                  <div className="row-val-placeholder">
                    <span className="flag-label">Flag Check</span>
                  </div>
                )}

                <button
                  type="button"
                  className="row-delete-btn"
                  onClick={() => handleRemoveCondition(idx)}
                  title="Remove this condition"
                >
                  ✕
                </button>
              </div>
            );
          })
        )}
      </div>

      <div style={{ marginTop: 14 }}>
        <button
          type="button"
          className="button button-secondary add-row-btn"
          onClick={handleAddCondition}
        >
          + Add condition
        </button>
      </div>

      <p className="config-help" style={{ marginTop: 12 }}>
        Only rows satisfying all active conditions will be included in the output dataset.
      </p>
    </div>
  );
}
