import React, { useMemo, useState } from 'react';
import { SearchableColumnSelect } from '../ColumnPicker';

const NUMERIC_TYPES = ['integer', 'float'];
const NUMERIC_STRATEGIES = ['mean', 'median'];
const STRATEGY_OPTIONS = [
  { value: 'drop', label: 'Drop row' },
  { value: 'mean', label: 'Fill with mean' },
  { value: 'median', label: 'Fill with median' },
  { value: 'mode', label: 'Fill with most frequent' },
  { value: 'custom', label: 'Fill with custom value' },
];

function normalizeStrategy(strategy) {
  return ({
    drop_row: 'drop',
    fill_mean: 'mean',
    fill_custom: 'custom',
  })[strategy] || strategy || 'drop';
}

function getRules(config) {
  if (Array.isArray(config.rules)) {
    return config.rules.map((rule) => ({ ...rule, strategy: normalizeStrategy(rule.strategy) }));
  }
  const legacyRules = config.column
    ? [{ column: config.column, strategy: config.strategy, customValue: config.customValue }]
    : [];
  return legacyRules.map((rule) => ({ ...rule, strategy: normalizeStrategy(rule.strategy) }));
}

export default function HandleNullConfig({ config, onChange, columns }) {
  const [showApplyAll, setShowApplyAll] = useState(false);
  const [applyAllStrategy, setApplyAllStrategy] = useState('drop');
  const rules = getRules(config);

  const updateRules = (nextRules) => {
    const nextConfig = { ...config, rules: nextRules };
    delete nextConfig.column;
    delete nextConfig.strategy;
    delete nextConfig.customValue;
    onChange(nextConfig);
  };

  const updateRule = (index, updates) => {
    updateRules(rules.map((rule, ruleIndex) => (
      ruleIndex === index ? { ...rule, ...updates } : rule
    )));
  };

  const configuredColumns = useMemo(
    () => new Set(rules.map((rule) => rule.column).filter(Boolean)),
    [rules]
  );
  const availableColumns = columns.filter((column) => !configuredColumns.has(column.name));

  const handleColumnChange = (index, columnName) => {
    const column = columns.find((item) => item.name === columnName);
    const rule = rules[index];
    const strategy = NUMERIC_STRATEGIES.includes(rule.strategy)
      && !NUMERIC_TYPES.includes(column?.type)
      ? 'drop'
      : rule.strategy;
    updateRule(index, { column: columnName, strategy });
  };

  const handleAddRule = () => {
    const nextColumn = availableColumns[0];
    if (!nextColumn) return;
    updateRules([...rules, { column: nextColumn.name, strategy: 'drop', customValue: '' }]);
  };

  const handleRemoveRule = (index) => {
    if (rules.length <= 1) return;
    updateRules(rules.filter((_, ruleIndex) => ruleIndex !== index));
  };

  const applyStrategyToRemainingColumns = () => {
    const targets = availableColumns.filter((column) => (
      !NUMERIC_STRATEGIES.includes(applyAllStrategy) || NUMERIC_TYPES.includes(column.type)
    ));
    if (targets.length === 0) return;
    updateRules([
      ...rules,
      ...targets.map((column) => ({
        column: column.name,
        strategy: applyAllStrategy,
        ...(applyAllStrategy === 'custom' ? { customValue: '' } : {}),
      })),
    ]);
  };

  return (
    <div className="config-form-section handle-null-config">
      <p className="config-help">
        Choose how each column handles missing values. A column can only have one rule.
      </p>

      <div className="null-rule-table-header" aria-hidden="true">
        <span>Column</span>
        <span>Strategy</span>
        <span>Value</span>
        <span />
      </div>

      <div className="null-rule-list">
        {rules.map((rule, index) => {
          const column = columns.find((item) => item.name === rule.column);
          const isNumeric = NUMERIC_TYPES.includes(column?.type);
          const disabledColumns = rules
            .filter((_, ruleIndex) => ruleIndex !== index)
            .map((item) => item.column)
            .filter(Boolean);

          return (
            <div className="null-rule-row" key={`null-rule-${index}`}>
              <div className="null-rule-column">
                <SearchableColumnSelect
                  columns={columns}
                  value={rule.column || ''}
                  disabledColumns={disabledColumns}
                  onChange={(columnName) => handleColumnChange(index, columnName)}
                  placeholder="Select column..."
                />
              </div>

              <div className="null-rule-strategy">
                <select
                  className="form-select"
                  aria-label={`Strategy for ${rule.column || `rule ${index + 1}`}`}
                  value={rule.strategy}
                  onChange={(event) => updateRule(index, { strategy: event.target.value })}
                >
                  {STRATEGY_OPTIONS.map((option) => {
                    const requiresNumeric = NUMERIC_STRATEGIES.includes(option.value);
                    return (
                      <option
                        key={option.value}
                        value={option.value}
                        disabled={requiresNumeric && !isNumeric}
                        title={requiresNumeric && !isNumeric ? 'Numeric columns only' : undefined}
                      >
                        {option.label}{requiresNumeric && !isNumeric ? ' (numeric columns only)' : ''}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div className="null-rule-value">
                {rule.strategy === 'custom' ? (
                  <input
                    type="text"
                    className="form-input"
                    aria-label={`Custom value for ${rule.column || `rule ${index + 1}`}`}
                    placeholder="Value"
                    value={rule.customValue || ''}
                    onChange={(event) => updateRule(index, { customValue: event.target.value })}
                  />
                ) : (
                  <span className="null-rule-value-empty" aria-hidden="true" />
                )}
              </div>

              <button
                type="button"
                className="row-delete-btn"
                onClick={() => handleRemoveRule(index)}
                disabled={rules.length <= 1}
                aria-label={`Remove rule for ${rule.column || `rule ${index + 1}`}`}
                title={rules.length <= 1 ? 'At least one rule is required' : 'Remove rule'}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      <div className="null-rule-actions">
        <button
          type="button"
          className="button button-secondary add-row-btn"
          onClick={handleAddRule}
          disabled={availableColumns.length === 0}
        >
          + Add rule
        </button>
        <button
          type="button"
          className="text-btn"
          onClick={() => setShowApplyAll((visible) => !visible)}
          disabled={availableColumns.length === 0}
          aria-expanded={showApplyAll}
        >
          Apply one strategy to all columns
        </button>
      </div>

      {showApplyAll && (
        <div className="null-apply-all">
          <label className="config-label" htmlFor="null-apply-all-strategy">Strategy</label>
          <select
            id="null-apply-all-strategy"
            className="form-select"
            value={applyAllStrategy}
            onChange={(event) => setApplyAllStrategy(event.target.value)}
          >
            {STRATEGY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <button
            type="button"
            className="button button-secondary add-row-btn"
            onClick={applyStrategyToRemainingColumns}
            disabled={!availableColumns.some((column) => (
              !NUMERIC_STRATEGIES.includes(applyAllStrategy) || NUMERIC_TYPES.includes(column.type)
            ))}
          >
            Apply
          </button>
          {NUMERIC_STRATEGIES.includes(applyAllStrategy) && (
            <span className="config-help">Only remaining numeric columns will be added.</span>
          )}
        </div>
      )}
    </div>
  );
}
