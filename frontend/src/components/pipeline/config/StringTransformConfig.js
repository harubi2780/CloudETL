import React from 'react';
import { SearchableColumnSelect } from '../ColumnPicker';

/**
 * Normalize Text Step Configuration Form
 * Config Structure:
 * {
 *   rules: [
 *     { column: string, trim: boolean, caseMode: 'none' | 'upper' | 'lower' | 'title' }
 *   ]
 * }
 */
export default function StringTransformConfig({ config, onChange, columns }) {
  const rules = config.rules || (config.columns || []).map((column) => ({
    column,
    trim: Boolean(config.trim),
    caseMode: config.caseMode || 'none',
  }));

  const handleUpdateRule = (index, field, value) => {
    const newRules = rules.map((r, i) => (i === index ? { ...r, [field]: value } : r));
    onChange({ ...config, rules: newRules });
  };

  const handleAddRule = () => {
    const available = columns.find((c) => !rules.some((r) => r.column === c.name) && c.type === 'string');
    const nextCol = available ? available.name : (columns[0] ? columns[0].name : '');
    onChange({
      ...config,
      rules: [...rules, { column: nextCol, trim: true, caseMode: 'title' }],
    });
  };

  const handleRemoveRule = (index) => {
    const newRules = rules.filter((_, i) => i !== index);
    onChange({ ...config, rules: newRules });
  };

  return (
    <div className="config-form-section">
      <div className="config-field-header">
        <label className="config-label">String Normalization Rules:</label>
        <span className="config-help">Configure trim and case per column.</span>
      </div>

      <div className="multi-row-list" style={{ marginTop: 12 }}>
        {rules.length === 0 ? (
          <div className="multi-row-empty">
            No rules added yet. Click <strong>+ Add rule</strong> to configure columns.
          </div>
        ) : (
          rules.map((rule, idx) => {
            return (
              <div key={idx} className="multi-row-card null-rule-card">
                {/* Column Selector */}
                <div className="row-col-selector">
                  <SearchableColumnSelect
                    columns={columns.filter((c) => c.type === 'string')}
                    value={rule.column}
                    onChange={(newCol) => handleUpdateRule(idx, 'column', newCol)}
                    placeholder="Select column..."
                  />
                </div>

                {/* Trim Checkbox */}
                <div className="row-col-selector" style={{ display: 'flex', alignItems: 'center' }}>
                  <label className="checkbox-label-block" style={{ margin: 0 }}>
                    <input
                      type="checkbox"
                      checked={rule.trim}
                      onChange={(e) => handleUpdateRule(idx, 'trim', e.target.checked)}
                    />
                    <span style={{ marginLeft: 4 }}>Trim whitespace</span>
                  </label>
                </div>

                {/* Case Mode */}
                <div className="row-col-selector">
                  <select
                    className="form-select row-select"
                    value={rule.caseMode}
                    onChange={(e) => handleUpdateRule(idx, 'caseMode', e.target.value)}
                  >
                    <option value="none">None</option>
                    <option value="upper">UPPERCASE</option>
                    <option value="lower">lowercase</option>
                    <option value="title">Title Case</option>
                  </select>
                </div>

                {/* Delete */}
                <div className="row-col-selector" style={{ textAlign: 'center' }}>
                  <button className="icon-button" onClick={() => handleRemoveRule(idx)} title="Remove rule">✕</button>
                </div>
              </div>
            );
          })
        )}
        <button className="btn btn-primary" style={{ marginTop: 8 }} onClick={handleAddRule}>+ Add rule</button>
      </div>
    </div>
  );
}
