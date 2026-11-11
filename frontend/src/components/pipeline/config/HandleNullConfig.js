import React from 'react';
import { SearchableColumnSelect } from '../ColumnPicker';

/**
 * Handle NULL - Multi-rule, per-column configuration.
 * Each column has its own customized strategy and default replacement value.
 * Config Structure:
 * {
 *   rules: [
 *     { column: string, strategy: "drop_row" | "fill_mean" | "fill_custom", customValue: string }
 *   ]
 * }
 */
export default function HandleNullConfig({ config, onChange, columns }) {
  const rules = config.rules || (config.column ? [{ column: config.column, strategy: config.strategy || 'drop_row', customValue: config.customValue || '' }] : []);

  const handleUpdateRule = (index, field, val) => {
    const next = rules.map((r, idx) => {
      if (idx === index) {
        return { ...r, [field]: val };
      }
      return r;
    });
    onChange({ ...config, rules: next });
  };

  const handleAddRule = () => {
    // Pick first column not already configured if possible
    const available = columns.find((c) => !rules.some((r) => r.column === c.name));
    const nextCol = available ? available.name : (columns[0] ? columns[0].name : '');
    onChange({
      ...config,
      rules: [
        ...rules,
        {
          column: nextCol,
          strategy: 'drop_row',
          customValue: '',
        },
      ],
    });
  };

  const handleRemoveRule = (index) => {
    const next = rules.filter((_, idx) => idx !== index);
    onChange({ ...config, rules: next });
  };

  return (
    <div className="config-form-section">
      <div className="config-field-header">
        <label className="config-label">Per-Column NULL Rules:</label>
        <span className="config-help">Configure customized resolution for each column</span>
      </div>

      <div className="multi-row-list" style={{ marginTop: 12 }}>
        {rules.length === 0 ? (
          <div className="multi-row-empty">
            No column rules added yet. Click <strong>+ Add rule</strong> below to specify how each column handles missing values.
          </div>
        ) : (
          rules.map((rule, idx) => {
            const colObj = columns.find((c) => c.name === rule.column);
            const isNumeric = colObj && (colObj.type === 'integer' || colObj.type === 'float');
            const showCustomInput = rule.strategy === 'fill_custom';

            return (
              <div key={idx} className="multi-row-card null-rule-card">
                {/* Column Search Dropdown */}
                <div className="row-col-selector">
                  <SearchableColumnSelect
                    columns={columns}
                    value={rule.column}
                    onChange={(newCol) => handleUpdateRule(idx, 'column', newCol)}
                    placeholder="Select column..."
                  />
                </div>

                {/* Strategy Radio Buttons */}
                <div className="row-op-selector" style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  <label className="radio-label">
                    <input
                      type="radio"
                      name={`strategy_${idx}`}
                      value="drop_row"
                      checked={rule.strategy === 'drop_row'}
                      onChange={(e) => handleUpdateRule(idx, 'strategy', e.target.value)}
                    />
                    Drop Row
                  </label>
                  <label className="radio-label">
                    <input
                      type="radio"
                      name={`strategy_${idx}`}
                      value="fill_mean"
                      disabled={!isNumeric && Boolean(colObj)}
                      checked={rule.strategy === 'fill_mean'}
                      onChange={(e) => handleUpdateRule(idx, 'strategy', e.target.value)}
                    />
                    Fill Mean{(!isNumeric && Boolean(colObj)) ? ' (numeric only)' : ''}
                  </label>
                  <label className="radio-label">
                    <input
                      type="radio"
                      name={`strategy_${idx}`}
                      value="fill_custom"
                      checked={rule.strategy === 'fill_custom'}
                      onChange={(e) => handleUpdateRule(idx, 'strategy', e.target.value)}
                    />
                    Custom Value
                  </label>
                </div>
                {/* Default value input for custom */}
                {rule.strategy === 'fill_custom' ? (
                  <div className="row-val-input" style={{ marginTop: '4px' }}>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. Unknown or 0"
                      value={rule.customValue || ''}
                      onChange={(e) => handleUpdateRule(idx, 'customValue', e.target.value)}
                    />
                  </div>
                ) : (
                  <div className="row-val-placeholder" style={{ marginTop: '4px' }}>
                    <span className="flag-label">
                      {rule.strategy === 'drop_row' ? 'Removes row' : 'Auto-computed'}
                    </span>
                  </div>
                )
                }

                {/* Delete rule button */}

                <button
                  type="button"
                  className="row-delete-btn"
                  onClick={() => handleRemoveRule(idx)}
                  title="Remove this rule"
                >

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
          onClick={handleAddRule}
        >
          + Add rule
        </button>
      </div>

      <p className="config-help" style={{ marginTop: 12 }}>
        Different columns can have different rules: critical keys (e.g. email) can drop the row, while metric columns (e.g. age) fill mean, and categorical columns fill defaults.
      </p>
    </div>
  );
}
