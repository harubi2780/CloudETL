// Pipeline Operations catalog, dynamic config description generator, and preview simulation

const cloneSchema = (schema) => schema.map((column) => ({ ...column }));

const applySelectColumnsToSchema = (schema, config, stepIndex = 0) => {
  const selected = new Set(config.selectedColumns || []);
  return cloneSchema(schema).map((column) => {
    if (!selected.has(column.name) && column.status !== 'dropped') {
      return { ...column, status: 'dropped', droppedInStep: stepIndex + 1 };
    }
    return column;
  });
};

const applyCastTypeToSchema = (schema, config, stepIndex = 0) => {
  const conversions = new Map(
    (config.conversions || [])
      .filter((conversion) => conversion.column && conversion.toType)
      .map((conversion) => [conversion.column, conversion.toType])
  );
  return cloneSchema(schema).map((column) => {
    if (conversions.has(column.name) && column.status !== 'dropped') {
      return {
        ...column,
        type: conversions.get(column.name),
        status: 'changed',
        changedInStep: stepIndex + 1,
      };
    }
    return column;
  });
};

const applyDateTimeToSchema = (schema, config, stepIndex = 0) => {
  return cloneSchema(schema).map((column) => {
    if (column.name === config.column && column.status !== 'dropped') {
      return {
        ...column,
        type: 'datetime',
        status: 'changed',
        changedInStep: stepIndex + 1,
      };
    }
    return column;
  });
};

const preserveSchema = (schema) => cloneSchema(schema);

export const OPERATION_DEFINITIONS = [
  {
    type: 'select_columns',
    label: 'Select Columns',
    shortDesc: 'Tick columns to keep; unchecked columns are excluded',
    category: 'Columns',
    badge: 'Columns',
    applyToSchema: applySelectColumnsToSchema,
    defaultConfig: (columns) => ({
      selectedColumns: columns && columns.length > 0 ? columns.map((c) => c.name) : [],
    }),
  },
  {
    type: 'drop_duplicates',
    label: 'Remove Duplicates',
    shortDesc: 'Remove duplicate rows based on selected comparison columns',
    category: 'Rows',
    badge: 'Deduplicate',
    applyToSchema: preserveSchema,
    defaultConfig: (columns) => ({
      rules: [{
        allColumns: false,
        columns: columns && columns.length > 0 ? [columns[0].name] : [],
        keep: 'first',
        orderBy: '',
      }],
    }),
  },
  {
    type: 'handle_null',
    label: 'Handle NULL',
    shortDesc: 'Drop rows or fill missing values with mean or custom value',
    category: 'Clean',
    badge: 'Missing',
    applyToSchema: preserveSchema,
    defaultConfig: (columns) => ({
      rules: [
        {
          column: columns && columns.length > 0 ? columns[0].name : '',
          strategy: 'drop',
          customValue: '',
        },
      ],
    }),
  },
  {
    type: 'cast_type',
    label: 'Convert Data Type',
    shortDesc: 'Cast column types (integer, float, string, boolean)',
    category: 'Type',
    badge: 'Cast',
    applyToSchema: applyCastTypeToSchema,
    defaultConfig: (columns) => ({
      conversions: [
        {
          column: columns && columns.length > 0 ? columns[0].name : '',
          toType: 'string',
        },
      ],
    }),
  },
  {
    type: 'string_transform',
    label: 'Normalize Text',
    shortDesc: 'Trim whitespace and format letter case across string columns',
    category: 'String',
    badge: 'Text',
    applyToSchema: preserveSchema,
    defaultConfig: (columns) => {
      const strCols = columns ? columns.filter((c) => c.type === 'string').map((c) => c.name) : [];
      return {
        columns: strCols.length > 0 ? [strCols[0]] : [],
        trim: true,
        caseMode: 'title', // 'none', 'upper', 'lower', 'title'
      };
    },
  },
  {
    type: 'filter_rows',
    label: 'Filter Rows',
    shortDesc: 'Filter rows by numeric comparison, flags, or text matching',
    category: 'Filter',
    badge: 'Filter',
    applyToSchema: preserveSchema,
    defaultConfig: (columns) => ({
      conditions: [
        {
          column: columns && columns.length > 0 ? columns[0].name : '',
          operator: 'greater_than',
          value: '',
        },
      ],
    }),
  },
  {
    type: 'replace_value',
    label: 'Replace Values',
    shortDesc: 'Search for target values and replace them with new values',
    category: 'Transform',
    badge: 'Replace',
    applyToSchema: preserveSchema,
    defaultConfig: (columns) => ({
      column: columns && columns.length > 0 ? columns[0].name : '',
      oldValue: '',
      newValue: '',
    }),
  },
  {
    type: 'format_datetime',
    label: 'Normalize Datetime',
    shortDesc: 'Parse irregular date formats into standard output format',
    category: 'DateTime',
    badge: 'DateTime',
    applyToSchema: applyDateTimeToSchema,
    defaultConfig: (columns) => {
      const dateCols = columns ? columns.filter((c) => c.type === 'datetime' || c.name.includes('date')).map((c) => c.name) : [];
      return {
        column: dateCols.length > 0 ? dateCols[0] : (columns && columns[0] ? columns[0].name : ''),
        inputFormat: 'auto',
        outputFormat: 'YYYY-MM-DD',
      };
    },
  },
];

let stepCounter = 1;

/**
 * Creates a clean PipelineStep instance without any mock stats.
 * Type PipelineStep: { id, type, name, config, enabled }
 */
export function applyToSchema(schema, step, stepIdx = 0) {
  if (!step.enabled) return cloneSchema(schema);
  const operation = OPERATION_DEFINITIONS.find((item) => item.type === step.type);
  return operation
    ? operation.applyToSchema(schema, step.config || {}, stepIdx)
    : cloneSchema(schema);
}

export function createStep(type, columns = []) {
  const op = OPERATION_DEFINITIONS.find((o) => o.type === type);
  const id = `step_${Date.now()}_${stepCounter++}`;
  const config = op ? op.defaultConfig(columns) : {};
  return {
    id,
    type,
    name: op ? op.label : 'Operation',
    config,
    enabled: true,
  };
}

/**
 * Auto-generates a dynamic description strictly from the step's config.
 * When unconfigured or incomplete, returns "Not configured".
 */
export function getStepDescription(step, columns = []) {
  if (!step || !step.config) return 'Not configured';
  const { type, config } = step;

  if (type === 'string_transform') {
    if (Array.isArray(config.rules)) {
      const validRules = config.rules.filter((rule) => rule.column);
      if (validRules.length === 0) return 'Not configured';
      return validRules.map((rule) => {
        const actions = [];
        if (rule.trim) actions.push('Trim');
        if (rule.caseMode === 'upper') actions.push('UPPERCASE');
        else if (rule.caseMode === 'lower') actions.push('lowercase');
        else if (rule.caseMode === 'title') actions.push('Title Case');
        return `${actions.length ? actions.join(' + ') : 'No changes'} on ${rule.column}`;
      }).join(', ');
    }

    const { columns = [], trim = false, caseMode = 'none' } = config;
    if (columns.length === 0) return 'Not configured';

    const actions = [];
    if (trim) actions.push('Trim');
    if (caseMode === 'upper') actions.push('UPPERCASE');
    else if (caseMode === 'lower') actions.push('lowercase');
    else if (caseMode === 'title') actions.push('Title Case');

    const actionText = actions.length > 0 ? actions.join(' + ') : 'None';
    return `${actionText} on ${columns.join(', ')}`;
  }

  if (type === 'select_columns') {
    const cols = config.selectedColumns || [];
    if (cols.length === 0) return 'Not configured';
    return `Keep columns: ${cols.join(', ')}`;
  }

  if (type === 'drop_duplicates') {
    const rules = Array.isArray(config.rules)
      ? config.rules
      : [{
        allColumns: false,
        columns: config.subset || [],
        keep: config.keep || 'first',
      }];
    const descriptions = rules.filter((rule) => (
      rule.allColumns || (Array.isArray(rule.columns) && rule.columns.length > 0)
    )).map((rule) => {
      const keys = rule.allColumns ? 'all columns' : rule.columns.join(', ');
      if (rule.keep === 'min' && rule.orderBy) {
        return `${keys} (keep smallest ${rule.orderBy})`;
      }
      if (rule.keep === 'max' && rule.orderBy) {
        const orderColumn = columns.find((column) => column.name === rule.orderBy);
        const latest = orderColumn?.type === 'datetime';
        return `${keys} (keep ${latest ? 'latest' : 'largest'} ${rule.orderBy})`;
      }
      if (['min', 'max'].includes(rule.keep)) return null;
      return `${keys} (keep ${rule.keep === 'last' ? 'last' : 'first'})`;
    }).filter(Boolean);
    return descriptions.length > 0 ? `Dedupe by ${descriptions.join('; ')}` : 'Not configured';
  }

  if (type === 'handle_null') {
    const rules = Array.isArray(config.rules)
      ? config.rules
      : (config.column ? [{
        column: config.column,
        strategy: config.strategy,
        customValue: config.customValue,
      }] : []);
    if (rules.length > 0) {
      const validRules = rules.filter((rule) => (
        rule.column
        && (
          (rule.strategy !== 'custom' && rule.strategy !== 'fill_custom')
          || String(rule.customValue || '').length > 0
        )
      ));
      if (validRules.length === 0) return 'Not configured';
      return validRules
        .map((rule) => {
          const strategy = ({ drop_row: 'drop', fill_mean: 'mean', fill_custom: 'custom' })[rule.strategy] || rule.strategy;
          if (strategy === 'drop') return `${rule.column} (drop row)`;
          if (strategy === 'mean') return `${rule.column} (mean)`;
          if (strategy === 'median') return `${rule.column} (median)`;
          if (strategy === 'mode') return `${rule.column} (most frequent)`;
          if (strategy === 'custom') return `${rule.column} ('${rule.customValue}')`;
          return null;
        })
        .filter(Boolean)
        .join(', ');
    }
    return 'Not configured';
  }

  if (type === 'cast_type') {
    const conversions = config.conversions || (config.column ? [{ column: config.column, toType: config.toType }] : []);
    const valid = conversions.filter((c) => c.column && c.toType);
    if (valid.length === 0) return 'Not configured';
    return valid.map((c) => `${c.column} → ${c.toType}`).join(', ');
  }

  if (type === 'filter_rows') {
    const conditions = config.conditions || (config.column ? [{ column: config.column, operator: config.operator, value: config.value }] : []);
    const valid = conditions.filter((condition) => (
      condition.column
      && (['is_true', 'is_false'].includes(condition.operator) || String(condition.value || '').length > 0)
    ));
    if (valid.length === 0) return 'Not configured';
    return valid
      .map((c) => {
        if (c.operator === 'is_true') return `${c.column} is TRUE`;
        if (c.operator === 'is_false') return `${c.column} is FALSE`;
        const symbol = c.operator === 'greater_than' ? '>' : c.operator === 'less_than' ? '<' : c.operator === 'equals' ? '=' : c.operator;
        return `${c.column} ${symbol} ${c.value ? `"${c.value}"` : ''}`.trim();
      })
      .join(' AND ');
  }

  if (type === 'replace_value') {
    const { column, oldValue, newValue } = config;
    if (!column || !oldValue || !newValue) return 'Not configured';
    return `In ${column}: replace "${oldValue}" → "${newValue}"`;
  }

  if (type === 'format_datetime') {
    const { column, outputFormat } = config;
    if (!column) return 'Not configured';
    return `Normalize ${column} to ${outputFormat || 'YYYY-MM-DD'}`;
  }

  return 'Not configured';
}

// Order recommendation rules (non-blocking suggestions)
export function checkStepOrderHints(steps) {
  const hints = [];
  const enabledSteps = steps.filter((s) => s.enabled);

  // 1. Hint: Normalize Text should run before Remove Duplicates
  const strIndex = enabledSteps.findIndex((s) => s.type === 'string_transform');
  const dedupIndex = enabledSteps.findIndex((s) => s.type === 'drop_duplicates');
  if (dedupIndex !== -1 && strIndex !== -1 && strIndex > dedupIndex) {
    hints.push({
      id: 'hint_str_before_dedup',
      type: 'warning',
      message: 'Suggestion: Place "Normalize Text" before "Remove Duplicates" to avoid missing duplicate rows due to irregular whitespace or letter casing.',
    });
  }

  // 2. Hint: Handle NULL should run before Convert Data Type
  const nullIndex = enabledSteps.findIndex((s) => s.type === 'handle_null');
  const castIndex = enabledSteps.findIndex((s) => s.type === 'cast_type');
  if (castIndex !== -1 && nullIndex !== -1 && nullIndex > castIndex) {
    hints.push({
      id: 'hint_null_before_cast',
      type: 'info',
      message: 'Suggestion: Place "Handle NULL" before "Convert Data Type" to prevent casting errors on empty cells.',
    });
  }

  return hints;
}

// Preview Data Simulator (operates on sample rows without mock total counts)
export function simulatePipeline(dataset, steps, upToStepId = null) {
  if (!dataset) return { columns: [], rows: [] };

  let currentColumns = [...dataset.columns];
  let currentRows = dataset.beforeRows.map((r) => ({ ...r }));

  for (const step of steps) {
    if (!step.enabled) continue;

    const { type, config } = step;

    if (type === 'select_columns' && Array.isArray(config.selectedColumns)) {
      currentColumns = currentColumns.filter((c) => config.selectedColumns.includes(c.name));
      currentRows = currentRows.map((row) => {
        const newRow = {};
        for (const col of config.selectedColumns) {
          if (col in row) newRow[col] = row[col];
        }
        return newRow;
      });
    } else if (type === 'drop_duplicates') {
      const rules = Array.isArray(config.rules)
        ? config.rules
        : [{
          allColumns: !(config.subset && config.subset.length > 0),
          columns: config.subset || [],
          keep: config.keep || 'first',
        }];

      for (const rule of rules) {
        const keyColumns = rule.allColumns
          ? currentColumns.map((column) => column.name)
          : (rule.columns || []);
        if (keyColumns.length === 0) continue;

        const groups = new Map();
        currentRows.forEach((row, index) => {
          const key = JSON.stringify(keyColumns.map((column) => (
            String(row[column] ?? '').trim().toLowerCase()
          )));
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push({ row, index });
        });

        const selectedRows = [];
        for (const group of groups.values()) {
          if (['min', 'max'].includes(rule.keep) && rule.orderBy) {
            const orderColumn = currentColumns.find((column) => column.name === rule.orderBy);
            const getOrderValue = ({ row }) => {
              const value = row[rule.orderBy];
              if (value === null || value === undefined || value === '') return Number.NaN;
              return orderColumn?.type === 'datetime' ? Date.parse(value) : Number(value);
            };
            const validRows = group.filter((row) => Number.isFinite(getOrderValue(row)));
            if (validRows.length === 0) {
              selectedRows.push(group[0]);
              continue;
            }
            const selected = validRows.reduce((best, row) => {
              const currentValue = getOrderValue(row);
              const bestValue = getOrderValue(best);
              if (rule.keep === 'min' ? currentValue < bestValue : currentValue > bestValue) return row;
              return best;
            });
            selectedRows.push(selected);
          } else {
            selectedRows.push(rule.keep === 'last' ? group[group.length - 1] : group[0]);
          }
        }
        currentRows = selectedRows
          .sort((left, right) => left.index - right.index)
          .map(({ row }) => row);
      }
    } else if (type === 'handle_null') {
      const rules = Array.isArray(config.rules)
        ? config.rules
        : (config.column ? [{
          column: config.column,
          strategy: config.strategy,
          customValue: config.customValue,
        }] : []);
      if (rules.length > 0) {
        for (const rule of rules) {
          const { column: col, customValue } = rule;
          const strategy = ({ drop_row: 'drop', fill_mean: 'mean', fill_custom: 'custom' })[rule.strategy] || rule.strategy;
          if (!col) continue;
          if (strategy === 'drop') {
            currentRows = currentRows.filter((r) => r[col] !== null && r[col] !== '' && r[col] !== undefined);
          } else if (['mean', 'median'].includes(strategy)) {
            const numericValues = currentRows
              .map((row) => Number(row[col]))
              .filter(Number.isFinite)
              .sort((a, b) => a - b);
            const middle = Math.floor(numericValues.length / 2);
            const fillValue = strategy === 'mean'
              ? (numericValues.length
                ? numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length
                : 0)
              : (numericValues.length
                ? (numericValues.length % 2
                  ? numericValues[middle]
                  : (numericValues[middle - 1] + numericValues[middle]) / 2)
                : 0);
            currentRows = currentRows.map((r) => ({
              ...r,
              [col]: r[col] === null || r[col] === '' || r[col] === undefined ? fillValue : r[col],
            }));
          } else if (strategy === 'mode') {
            const frequencies = new Map();
            currentRows.forEach((row) => {
              const value = row[col];
              if (value === null || value === undefined || value === '') return;
              const key = String(value);
              const entry = frequencies.get(key) || { value, count: 0 };
              entry.count += 1;
              frequencies.set(key, entry);
            });
            const mostFrequent = Array.from(frequencies.values())
              .reduce((best, item) => (!best || item.count > best.count ? item : best), null)?.value;
            currentRows = currentRows.map((r) => ({
              ...r,
              [col]: r[col] === null || r[col] === '' || r[col] === undefined
                ? (mostFrequent === undefined ? r[col] : mostFrequent)
                : r[col],
            }));
          } else if (strategy === 'custom') {
            currentRows = currentRows.map((r) => ({
              ...r,
              [col]: r[col] === null || r[col] === '' || r[col] === undefined
                ? customValue
                : r[col],
            }));
          }
        }
      } else {
        const targetCols = config.columns || (config.column ? [config.column] : []);
        if (targetCols.length > 0) {
          if (config.strategy === 'drop_row') {
            currentRows = currentRows.filter((r) =>
              targetCols.every((c) => r[c] !== null && r[c] !== '' && r[c] !== undefined)
            );
          } else if (config.strategy === 'fill_mean') {
            for (const col of targetCols) {
              const numericValues = currentRows.map((r) => Number(r[col])).filter((v) => !isNaN(v) && v > 0);
              const mean = numericValues.length
                ? Math.round((numericValues.reduce((a, b) => a + b, 0) / numericValues.length) * 10) / 10
                : 0;
              currentRows = currentRows.map((r) => ({
                ...r,
                [col]: r[col] === null || r[col] === '' || r[col] === undefined ? mean : r[col],
              }));
            }
          } else if (config.strategy === 'fill_custom') {
            const fillVal = config.customValue || 'N/A';
            for (const col of targetCols) {
              currentRows = currentRows.map((r) => ({
                ...r,
                [col]: r[col] === null || r[col] === '' || r[col] === undefined ? fillVal : r[col],
              }));
            }
          }
        }
      }
    } else if (type === 'string_transform') {
      const rules = Array.isArray(config.rules)
        ? config.rules
        : (config.columns || (config.column ? [config.column] : [])).map((column) => ({
          column,
          trim: config.trim,
          caseMode: config.caseMode,
        }));

      currentRows = currentRows.map((r) => {
        const updated = { ...r };
        for (const rule of rules) {
          const { column: col, trim, caseMode = 'none' } = rule;
          let val = updated[col];
          if (typeof val === 'string') {
            if (trim) {
              val = val.trim().replace(/\s+/g, ' ');
            }
            if (caseMode === 'upper') {
              val = val.toUpperCase();
            } else if (caseMode === 'lower') {
              val = val.toLowerCase();
            } else if (caseMode === 'title') {
              val = val
                .split(' ')
                .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
                .join(' ');
            }
            updated[col] = val;
          }
        }
        return updated;
      });
    } else if (type === 'cast_type') {
      const conversions = config.conversions || (config.column ? [{ column: config.column, toType: config.toType }] : []);
      for (const { column, toType } of conversions) {
        if (!column) continue;
        currentRows = currentRows.map((r) => {
          let val = r[column];
          if (val !== null && val !== undefined) {
            if (toType === 'integer') val = parseInt(val, 10) || 0;
            else if (toType === 'float') val = parseFloat(val) || 0.0;
            else if (toType === 'string') val = String(val);
            else if (toType === 'boolean') val = Boolean(val);
          }
          return { ...r, [column]: val };
        });
        currentColumns = currentColumns.map((c) => (c.name === column ? { ...c, type: toType } : c));
      }
    } else if (type === 'filter_rows') {
      const conditions = config.conditions || (config.column ? [{ column: config.column, operator: config.operator, value: config.value }] : []);
      for (const { column, operator, value } of conditions) {
        if (!column) continue;
        currentRows = currentRows.filter((r) => {
          const itemVal = r[column];
          if (operator === 'greater_than') return Number(itemVal) > Number(value || 0);
          if (operator === 'less_than') return Number(itemVal) < Number(value || 0);
          if (operator === 'equals') return String(itemVal).toLowerCase() === String(value || '').toLowerCase();
          if (operator === 'contains') return String(itemVal).toLowerCase().includes(String(value || '').toLowerCase());
          if (operator === 'is_true') return itemVal === true || itemVal === 'true' || itemVal === 1;
          if (operator === 'is_false') return itemVal === false || itemVal === 'false' || itemVal === 0;
          return true;
        });
      }
    } else if (type === 'replace_value') {
      const { column, oldValue, newValue } = config;
      if (column) {
        currentRows = currentRows.map((r) => {
          if (String(r[column]).trim().toLowerCase() === String(oldValue).trim().toLowerCase()) {
            return { ...r, [column]: newValue };
          }
          return r;
        });
      }
    } else if (type === 'format_datetime') {
      const col = config.column;
      const outFmt = config.outputFormat || 'YYYY-MM-DD';
      if (col) {
        currentRows = currentRows.map((r) => {
          let val = r[col];
          if (val) {
            if (outFmt === 'YYYY-MM-DD') val = '2023-05-15';
            else if (outFmt === 'YYYY-MM-DD HH:mm:ss') val = '2023-05-15 00:00:00';
            else if (outFmt === 'ISO_8601') val = '2023-05-15T00:00:00.000Z';
          }
          return { ...r, [col]: val };
        });
      }
    }

    if (upToStepId && step.id === upToStepId) {
      break;
    }
  }

  return {
    columns: currentColumns,
    rows: currentRows,
  };
}
