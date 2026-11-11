// Pipeline Operations catalog, dynamic config description generator, and preview simulation

export const OPERATION_DEFINITIONS = [
  {
    type: 'select_columns',
    label: 'Select Columns',
    shortDesc: 'Tick columns to keep; unchecked columns are excluded',
    category: 'Columns',
    badge: 'Columns',
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
    defaultConfig: (columns) => ({
      subset: columns && columns.length > 0 ? [columns[0].name] : [],
      keep: 'first', // 'first', 'last'
    }),
  },
  {
    type: 'handle_null',
    label: 'Handle NULL',
    shortDesc: 'Drop rows or fill missing values with mean or custom value',
    category: 'Clean',
    badge: 'Missing',
    defaultConfig: (columns) => ({
      rules: [
        {
          column: columns && columns.length > 0 ? columns[0].name : '',
          strategy: 'drop_row', // 'drop_row', 'fill_mean', 'fill_custom'
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
export function getStepDescription(step) {
  if (!step || !step.config) return 'Not configured';
  const { type, config } = step;

  if (type === 'string_transform') {
    const { columns = [], trim = false, caseMode = 'none' } = config;
    if (!columns || columns.length === 0) {
      return 'Not configured';
    }

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
    const subset = config.subset || [];
    if (subset.length === 0) return 'Not configured';
    return `Remove duplicates by ${subset.join(', ')} (keep ${config.keep || 'first'})`;
  }

  if (type === 'handle_null') {
    const rules = config.rules || [];
    if (rules.length > 0) {
      const validRules = rules.filter((r) => r.column);
      if (validRules.length === 0) return 'Not configured';
      return validRules
        .map((r) => {
          if (r.strategy === 'drop_row') return `${r.column} (drop)`;
          if (r.strategy === 'fill_mean') return `${r.column} (mean)`;
          if (r.strategy === 'fill_custom') return `${r.column} ("${r.customValue || 'N/A'}")`;
          return `${r.column}`;
        })
        .join(', ');
    }
    const { strategy, customValue } = config;
    const targetCols = config.columns || (config.column ? [config.column] : []);
    if (!targetCols || targetCols.length === 0) return 'Not configured';
    const colText = targetCols.join(', ');
    if (strategy === 'drop_row') return `Drop rows where ${colText} is NULL`;
    if (strategy === 'fill_mean') return `Fill NULLs in ${colText} with mean`;
    if (strategy === 'fill_custom') return `Fill NULLs in ${colText} with "${customValue || 'N/A'}"`;
    return `Handle NULLs on ${colText}`;
  }

  if (type === 'cast_type') {
    const conversions = config.conversions || (config.column ? [{ column: config.column, toType: config.toType }] : []);
    const valid = conversions.filter((c) => c.column && c.toType);
    if (valid.length === 0) return 'Not configured';
    return valid.map((c) => `${c.column} → ${c.toType}`).join(', ');
  }

  if (type === 'filter_rows') {
    const conditions = config.conditions || (config.column ? [{ column: config.column, operator: config.operator, value: config.value }] : []);
    const valid = conditions.filter((c) => c.column);
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
    if (!column) return 'Not configured';
    return `In ${column}: replace "${oldValue || ''}" → "${newValue || ''}"`;
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

  // 3. Hint: Check if a subsequent step targets a column dropped earlier
  const selectIndex = enabledSteps.findIndex((s) => s.type === 'select_columns');
  if (selectIndex !== -1 && selectIndex < enabledSteps.length - 1) {
    const selectStep = enabledSteps[selectIndex];
    const keptCols = selectStep.config?.selectedColumns || [];
    for (let i = selectIndex + 1; i < enabledSteps.length; i++) {
      const nextStep = enabledSteps[i];
      let targetCols = [];
      if (nextStep.config?.columns) targetCols = nextStep.config.columns;
      else if (nextStep.config?.column) targetCols = [nextStep.config.column];
      else if (nextStep.config?.subset) targetCols = nextStep.config.subset;
      else if (nextStep.config?.conversions) targetCols = nextStep.config.conversions.map((c) => c.column);
      else if (nextStep.config?.conditions) targetCols = nextStep.config.conditions.map((c) => c.column);
      else if (nextStep.config?.rules) targetCols = nextStep.config.rules.map((r) => r.column);

      const missing = targetCols.filter((c) => c && !keptCols.includes(c));
      if (missing.length > 0) {
        hints.push({
          id: `hint_col_dropped_${nextStep.id}`,
          type: 'warning',
          message: `Notice: Step "${nextStep.name}" (step ${i + 1}) operates on column(s) [${missing.join(', ')}] dropped in step ${selectIndex + 1}.`,
        });
      }
    }
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

    if (type === 'select_columns' && config.selectedColumns && config.selectedColumns.length > 0) {
      currentColumns = currentColumns.filter((c) => config.selectedColumns.includes(c.name));
      currentRows = currentRows.map((row) => {
        const newRow = {};
        for (const col of config.selectedColumns) {
          if (col in row) newRow[col] = row[col];
        }
        return newRow;
      });
    } else if (type === 'drop_duplicates') {
      const seen = new Set();
      const subset = config.subset && config.subset.length > 0 ? config.subset : currentColumns.map((c) => c.name);
      currentRows = currentRows.filter((r) => {
        const key = subset.map((k) => String(r[k] ?? '').trim().toLowerCase()).join('___');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    } else if (type === 'handle_null') {
      const rules = config.rules || [];
      if (rules.length > 0) {
        for (const rule of rules) {
          const { column: col, strategy, customValue } = rule;
          if (!col) continue;
          if (strategy === 'drop_row') {
            currentRows = currentRows.filter((r) => r[col] !== null && r[col] !== '' && r[col] !== undefined);
          } else if (strategy === 'fill_mean') {
            const numericValues = currentRows.map((r) => Number(r[col])).filter((v) => !isNaN(v) && v > 0);
            const mean = numericValues.length
              ? Math.round((numericValues.reduce((a, b) => a + b, 0) / numericValues.length) * 10) / 10
              : 0;
            currentRows = currentRows.map((r) => ({
              ...r,
              [col]: r[col] === null || r[col] === '' || r[col] === undefined ? mean : r[col],
            }));
          } else if (strategy === 'fill_custom') {
            const fillVal = customValue !== undefined && customValue !== '' ? customValue : 'N/A';
            currentRows = currentRows.map((r) => ({
              ...r,
              [col]: r[col] === null || r[col] === '' || r[col] === undefined ? fillVal : r[col],
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
      const targetCols = config.columns || (config.column ? [config.column] : []);
      const trim = Boolean(config.trim);
      const caseMode = config.caseMode || 'none';

      currentRows = currentRows.map((r) => {
        const updated = { ...r };
        for (const col of targetCols) {
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
