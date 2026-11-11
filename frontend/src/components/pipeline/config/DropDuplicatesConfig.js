import React from 'react';
import ColumnPicker, { SearchableColumnSelect } from '../ColumnPicker';

const ORDERABLE_TYPES = ['integer', 'float', 'datetime'];

function getRules(config) {
  if (Array.isArray(config.rules)) return config.rules;
  return [{
    allColumns: false,
    columns: config.subset || [],
    keep: config.keep || 'first',
    orderBy: '',
  }];
}

export default function DropDuplicatesConfig({ config, onChange, columns }) {
  const rules = getRules(config);

  const updateRules = (nextRules) => {
    const nextConfig = { ...config, rules: nextRules };
    delete nextConfig.subset;
    delete nextConfig.keep;
    onChange(nextConfig);
  };

  const updateRule = (index, updates) => {
    updateRules(rules.map((rule, ruleIndex) => (
      ruleIndex === index ? { ...rule, ...updates } : rule
    )));
  };

  const handleKeepChange = (index, keep) => {
    const rule = rules[index];
    const orderableColumns = columns.filter((column) => ORDERABLE_TYPES.includes(column.type));
    const orderBy = ['min', 'max'].includes(keep)
      ? (orderableColumns.some((column) => column.name === rule.orderBy)
        ? rule.orderBy
        : (orderableColumns[0] ? orderableColumns[0].name : ''))
      : '';
    updateRule(index, { keep, orderBy });
  };

  const handleAddRule = () => {
    updateRules([...rules, { allColumns: false, columns: [], keep: 'first', orderBy: '' }]);
  };

  const handleRemoveRule = (index) => {
    if (rules.length <= 1) return;
    updateRules(rules.filter((_, ruleIndex) => ruleIndex !== index));
  };

  return (
    <div className="config-form-section dedupe-config">
      <p className="config-help">
        Rules run from top to bottom. Each rule removes duplicate rows using its key columns.
      </p>

      <div className="dedupe-rules">
        {rules.map((rule, index) => {
          const usesOrderColumn = ['min', 'max'].includes(rule.keep);
          const orderableColumns = columns.filter((column) => ORDERABLE_TYPES.includes(column.type));

          return (
            <section className="dedupe-rule-card" key={`dedupe-rule-${index}`}>
              <div className="dedupe-rule-heading">
                <strong>Rule {index + 1}</strong>
                <button
                  type="button"
                  className="row-delete-btn"
                  onClick={() => handleRemoveRule(index)}
                  disabled={rules.length <= 1}
                  aria-label={`Remove rule ${index + 1}`}
                  title={rules.length <= 1 ? 'At least one rule is required' : 'Remove rule'}
                >
                  ×
                </button>
              </div>

              <div className="dedupe-rule-keys">
                <div className="config-field-header">
                  <label className="config-label">Key columns</label>
                  <label className="all-columns-option">
                    <input
                      type="checkbox"
                      checked={Boolean(rule.allColumns)}
                      onChange={(event) => updateRule(index, {
                        allColumns: event.target.checked,
                        columns: event.target.checked ? [] : rule.columns || [],
                      })}
                    />
                    <span>All columns</span>
                  </label>
                </div>

                {!rule.allColumns && (
                  <ColumnPicker
                    columns={columns}
                    selectedColumns={rule.columns || []}
                    onChange={(nextColumns) => updateRule(index, { columns: nextColumns })}
                    label=""
                  />
                )}
              </div>

              <div className="dedupe-rule-retention">
                <label className="config-label" htmlFor={`dedupe-keep-${index}`}>
                  When duplicates are found, keep
                </label>
                <select
                  id={`dedupe-keep-${index}`}
                  className="form-select"
                  value={rule.keep || 'first'}
                  onChange={(event) => handleKeepChange(index, event.target.value)}
                >
                  <option value="first">First occurrence</option>
                  <option value="last">Last occurrence</option>
                  <option value="min" disabled={orderableColumns.length === 0}>Row with the smallest value in…</option>
                  <option value="max" disabled={orderableColumns.length === 0}>Row with the largest value in…</option>
                </select>

                {usesOrderColumn && (
                  <SearchableColumnSelect
                    columns={columns}
                    filterType={ORDERABLE_TYPES}
                    value={rule.orderBy || ''}
                    onChange={(orderBy) => updateRule(index, { orderBy })}
                    placeholder="Select numeric or datetime column..."
                  />
                )}
              </div>
            </section>
          );
        })}
      </div>

      <button
        type="button"
        className="button button-secondary add-row-btn"
        onClick={handleAddRule}
      >
        + Add rule
      </button>
    </div>
  );
}
