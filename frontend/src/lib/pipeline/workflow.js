// Application schema and validation. Data transformations execute only in Django.
export const operations = [
  ['select_columns', 'Select columns'], ['merge_columns', 'Merge columns'], ['drop_duplicates', 'Remove duplicates'],
  ['handle_null', 'Handle missing values'], ['cast_type', 'Convert data type'],
  ['string_transform', 'Clean text'], ['filter_rows', 'Filter rows'],
  ['replace_value', 'Replace values'], ['format_datetime', 'Format dates'],
  ['join', 'Join tables'], ['concat', 'Append rows'],
].map(([type, label]) => ({ type, label }));

export function dataType(type = '') {
  if (/bool/i.test(type)) return 'boolean';
  if (/int/i.test(type)) return 'integer';
  if (/float|double|decimal/i.test(type)) return 'float';
  if (/date|time|^dtt$/i.test(type)) return 'datetime';
  return 'string';
}

export const CAST_TYPES = ['str', 'int', 'float', 'date'];
const CAST_TYPE_ALIASES = { string: 'str', integer: 'int', datetime: 'date', dtt: 'date' };

export function normalizeCastType(toType = '') {
  return CAST_TYPE_ALIASES[toType] || toType;
}

export const FILTER_OPERATORS_BY_TYPE = {
  integer: ['equals', 'not_equals', 'greater_than', 'less_than', 'greater_or_equal', 'less_or_equal'],
  float: ['equals', 'not_equals', 'greater_than', 'less_than', 'greater_or_equal', 'less_or_equal'],
  string: ['equals', 'contains', 'starts_with', 'ends_with'],
  datetime: ['after', 'before', 'equals'],
  boolean: ['is_true', 'is_false'],
};

export function filterOperatorsForType(type, caps) {
  if (!type) return [];
  const normalized = dataType(type);
  const advertisedByType = caps?.operations?.filter_rows?.operatorsByType?.[normalized];
  if (Array.isArray(advertisedByType)) return advertisedByType;
  const fallback = FILTER_OPERATORS_BY_TYPE[normalized] || FILTER_OPERATORS_BY_TYPE.string;
  const advertisedGlobal = caps?.operations?.filter_rows?.operator || caps?.operations?.filter_rows?.conditions?.[0]?.operator;
  return Array.isArray(advertisedGlobal) ? fallback.filter((op) => advertisedGlobal.includes(op)) : fallback;
}

export function defaultOperatorForType(type, caps) {
  return filterOperatorsForType(type, caps)[0] || '';
}

function uniqueColumnName(base, columns) {
  const names = new Set((columns || []).map((col) => col.name));
  if (!names.has(base)) return base;
  let index = 2;
  while (names.has(`${base}_${index}`)) index += 1;
  return `${base}_${index}`;
}

export function newStep(type, columns, sources, primaryId) {
  const column = columns[0]?.name || '';
  const dateColumn = (columns || []).find((item) => dataType(item.type) === 'datetime')?.name || '';
  const firstFilterOperator = columns?.[0] ? defaultOperatorForType(columns[0].type) : '';
  const other = sources.find((source) => source.id !== primaryId);
  const configs = {
    select_columns: { selectedColumns: columns.map((item) => item.name) },
    merge_columns: { columns: columns.slice(0, 2).map((item) => item.name), newColumnName: uniqueColumnName('merged_column', columns), separator: ' ' },
    drop_duplicates: { rules: [{ allColumns: true, columns: [], keep: 'first' }] },
    handle_null: { rules: [{ column, strategy: 'drop' }] },
    cast_type: { conversions: [{ column, toType: 'str' }] },
    string_transform: { rules: [{ column, trim: true, caseMode: 'none' }] },
    filter_rows: { conditions: [{ column, operator: firstFilterOperator, value: ['is_true', 'is_false'].includes(firstFilterOperator) ? null : '' }] },
    replace_value: { column, oldValue: '', newValue: '' },
    format_datetime: { column: dateColumn, inputFormat: 'auto', outputFormat: 'YYYY-MM-DD' },
    join: { datasetId: other?.id || '', on: columns.find((item) => other?.columns?.some((right) => right.name === item.name))?.name || '', how: 'left' },
    concat: { datasetIds: sources.filter((source) => source.id !== primaryId).map((source) => source.id) },
  };
  return { type, name: operations.find((op) => op.type === type)?.label || type, config: configs[type], enabled: true };
}

export function sourceIds(configuration, includeDisabled = false) {
  const ids = [configuration.datasetId];
  for (const step of configuration.steps || []) {
    if (!includeDisabled && step.enabled === false) continue;
    if (step.sourceId) ids.push(step.sourceId);
    if (step.type === 'join') ids.push(step.config.datasetId);
    if (step.type === 'concat') ids.push(...(step.config.datasetIds || []));
  }
  return [...new Set(ids.filter(Boolean))];
}

export function combinedSourceIds(configuration) {
  const ids = [configuration.datasetId];
  for (const step of configuration.steps || []) {
    if (step.enabled === false) continue;
    if (step.type === 'join') ids.push(step.config?.datasetId);
    if (step.type === 'concat') ids.push(...(step.config?.datasetIds || []));
  }
  return [...new Set(ids.filter(Boolean))];
}

export function nextSchema(schema, step, sources) {
  if (step.enabled === false) return schema;
  const config = step.config;
  if (step.type === 'select_columns') return (config.selectedColumns || []).map((name) => schema.find((col) => col.name === name)).filter(Boolean);
  if (step.type === 'merge_columns') return config.newColumnName?.trim() ? [...schema, { name: config.newColumnName, type: 'string' }] : schema;
  if (step.type === 'cast_type') {
    return schema.map((col) => {
      const conv = config.conversions?.find((item) => item.column === col.name);
      return conv ? { ...col, type: dataType(conv.toType) } : col;
    });
  }
  if (step.type === 'format_datetime') return schema.map((col) => col.name === config.column ? { ...col, type: 'string' } : col);
  if (step.type === 'string_transform') return schema.map((col) => config.rules?.some((rule) => rule.column === col.name && (rule.trim || (rule.caseMode && rule.caseMode !== 'none'))) ? { ...col, type: 'string' } : col);
  if (step.type === 'join') {
    const right = sources.find((item) => item.id === config.datasetId)?.columns || [];
    const overlap = new Set(schema.filter((left) => left.name !== config.on && right.some((col) => col.name === left.name)).map((col) => col.name));
    return [...schema.map((col) => ({ ...col, name: overlap.has(col.name) ? `${col.name}_x` : col.name })),
      ...right.filter((col) => col.name !== config.on).map((col) => ({ ...col, name: overlap.has(col.name) ? `${col.name}_y` : col.name }))];
  }
  if (step.type === 'concat') {
    const combined = [...schema];
    for (const id of config.datasetIds || []) for (const col of sources.find((item) => item.id === id)?.columns || []) {
      const existing = combined.find((item) => item.name === col.name);
      if (!existing) combined.push({ ...col });
      else if (dataType(existing.type) !== dataType(col.type)) {
        combined[combined.indexOf(existing)] = {
          ...existing,
          type: [existing.type, col.type].every((type) => ['integer', 'float'].includes(dataType(type))) ? 'float' : 'string',
        };
      }
    }
    return combined;
  }
  return schema;
}

export function schemasFor(primaryId, steps, sources) {
  const bySource = Object.fromEntries(sources.map((item) => [item.id, item.columns || []]));
  const before = [];
  const sourcesBefore = [];
  for (const step of steps) {
    const workingSources = sources.map((item) => ({ ...item, columns: bySource[item.id] ?? item.columns ?? [] }));
    sourcesBefore.push(workingSources);
    const isCombine = ['join', 'concat'].includes(step.type);
    const targetId = (!isCombine && step.sourceId) ? step.sourceId : primaryId;
    const current = bySource[targetId] || [];
    before.push(current);
    if (step.enabled !== false) {
      bySource[targetId] = nextSchema(current, step, workingSources);
    }
  }
  return { before, final: bySource[primaryId] || [], bySource, sourcesBefore };
}

export function validateWorkflow(payload, sources, caps) {
  const errors = [];
  const limits = caps?.limits || {};
  if (!payload.name.trim() || payload.name.length > 120) errors.push('Enter a pipeline name up to 120 characters.');
  if (!sources.length || !sources.some((source) => source.id === payload.datasetId)) errors.push('Choose a starting dataset.');
  if (sources.length > (limits.maxSources || 6)) errors.push(`Select at most ${limits.maxSources || 6} sources.`);
  if (sources.reduce((sum, item) => sum + item.size_bytes, 0) > (limits.maxCombinedInputBytes || 26214400)) errors.push('The combined source size exceeds the processing limit.');
  if (sources.some((item) => item.status !== 'ready')) errors.push('Every selected source must have a successful preview before running.');
  if (!Array.isArray(payload.steps) || !payload.steps.some((step) => step.enabled !== false)) {
    errors.push('Add at least one enabled transformation step before running the pipeline.');
  }
  if ((payload.steps || []).length > (limits.maxSteps || 50)) errors.push('The pipeline has too many steps.');
  const combined = combinedSourceIds(payload);
  if (sources.some((source) => !combined.includes(source.id))) errors.push('Some selected sources are unused. Add a Join or Append step, or remove them.');
  const schemas = schemasFor(payload.datasetId, payload.steps, sources);
  for (const [index, step] of payload.steps.entries()) {
    const prefix = `Step ${index + 1}: `;
    const config = step.config;
    const schema = schemas.before[index];
    const stepSources = schemas.sourcesBefore[index] || sources;
    const names = schema.map((col) => col.name);
    const required = [];
    if (!caps?.operations?.[step.type]) errors.push(prefix + 'this operation is unavailable.');
    if (step.sourceId) {
      if (['join', 'concat'].includes(step.type)) errors.push(prefix + 'combine steps always run on the starting dataset.');
      else if (!sources.some((source) => source.id === step.sourceId)) errors.push(prefix + 'choose a loaded source dataset.');
    }
    if (step.type === 'select_columns') {
      if (!config.selectedColumns?.length) errors.push(prefix + 'select at least one column.');
      required.push(...(config.selectedColumns || []));
    } else if (step.type === 'merge_columns') {
      if ((config.columns?.length || 0) < 2) errors.push(prefix + 'select at least two columns to merge.');
      if (!config.newColumnName?.trim() || config.newColumnName.length > 255) errors.push(prefix + 'enter a new column name up to 255 characters.');
      if (typeof (config.separator ?? ' ') !== 'string' || (config.separator ?? ' ').length > 32) errors.push(prefix + 'enter a separator up to 32 characters.');
      required.push(...(config.columns || []));
    } else if (step.type === 'join') {
      const right = stepSources.find((source) => source.id === config.datasetId);
      if (!right || !config.on || !right.columns?.some((col) => col.name === config.on)) errors.push(prefix + 'choose a source and a shared join column.');
      required.push(config.on);
    } else if (step.type === 'concat') {
      if (!config.datasetIds?.length || config.datasetIds.some((id) => !stepSources.some((source) => source.id === id))) errors.push(prefix + 'choose available files to append.');
    } else if (['replace_value', 'format_datetime'].includes(step.type)) required.push(config.column);
    else {
      const key = step.type === 'cast_type' ? 'conversions' : step.type === 'filter_rows' ? 'conditions' : 'rules';
      const rules = config[key] || [];
      if (!rules.length || rules.length > 50) errors.push(prefix + 'configure between 1 and 50 rules.');
      const numericOnlyOps = ['greater_than', 'less_than', 'greater_or_equal', 'less_or_equal', 'not_equals'];
      const textOps = ['contains', 'starts_with', 'ends_with'];
      const dateOps = ['after', 'before'];
      const flagOps = ['is_true', 'is_false'];
      for (const rule of rules) {
        if (step.type === 'drop_duplicates') {
          if (!rule.allColumns && !rule.columns?.length) errors.push(prefix + 'choose comparison columns.');
          required.push(...(rule.columns || []));
        } else required.push(rule.column);
        if (step.type === 'handle_null' && rule.strategy === 'custom' && (rule.customValue === undefined || rule.customValue === null)) errors.push(prefix + 'enter a custom fill value.');
        if (step.type === 'cast_type') {
          const canonical = normalizeCastType(rule.toType);
          const advertised = caps?.operations?.cast_type?.conversions?.[0]?.toType;
          const allowedCastTypes = Array.isArray(advertised)
            ? CAST_TYPES.filter((value) => advertised.map(normalizeCastType).includes(value))
            : CAST_TYPES;
          if (!CAST_TYPES.includes(canonical) || !allowedCastTypes.includes(canonical)) {
            errors.push(prefix + 'choose a supported target type (str, int, float, or date).');
          }
        }
        const col = schema.find((item) => item.name === rule.column);
        const colType = col ? dataType(col.type) : '';
        const isNumericCol = ['integer', 'float'].includes(colType);
        if (step.type === 'filter_rows' && !flagOps.includes(rule.operator)) {
          const empty = rule.value === undefined || rule.value === null || rule.value === '';
          const needsNumber = numericOnlyOps.includes(rule.operator) || (rule.operator === 'equals' && step.enabled !== false && isNumericCol);
          if (empty || (needsNumber && !Number.isFinite(Number(rule.value))) || (dateOps.includes(rule.operator) && !String(rule.value).trim()) || (textOps.includes(rule.operator) && typeof rule.value !== 'string')) {
            errors.push(prefix + 'enter a valid filter value.');
          }
        }
        if (step.enabled !== false && step.type === 'handle_null' && ['mean', 'median'].includes(rule.strategy) && !isNumericCol) {
          errors.push(prefix + 'this operation needs a numeric column; convert it first.');
        }
        if (step.enabled !== false && step.type === 'filter_rows' && col) {
          const allowedOps = filterOperatorsForType(colType, caps);
          if (!allowedOps.includes(rule.operator)) {
            if (numericOnlyOps.includes(rule.operator)) {
              errors.push(prefix + 'this operation needs a numeric column; convert it first.');
            } else {
              errors.push(prefix + `filter operator "${rule.operator || 'none'}" is not supported for ${colType} columns.`);
            }
          }
        }
      }
    }
    if (required.some((name) => !name || (step.enabled !== false && !names.includes(name)))) errors.push(prefix + 'a referenced column is missing or was removed earlier.');
    if (step.enabled !== false) {
      const after = nextSchema(schema, step, stepSources).map((col) => col.name);
      if (after.length !== new Set(after).size) errors.push(prefix + 'the result would contain duplicate column names.');
    }
  }
  if (new Blob([JSON.stringify(payload)]).size > 16384) errors.push('The pipeline configuration exceeds the 16 KiB request limit.');
  return [...new Set(errors)];
}

const FILTER_OPERATOR_PHRASES = {
  greater_than: '>',
  less_than: '<',
  greater_or_equal: '>=',
  less_or_equal: '<=',
  equals: '=',
  not_equals: '!=',
  contains: 'contains',
  starts_with: 'starts with',
  ends_with: 'ends with',
  is_true: 'is true',
  is_false: 'is false',
  after: 'after',
  before: 'before',
};

const NULL_STRATEGY_ALIASES = {
  drop_row: 'drop',
  fill_mean: 'mean',
  fill_median: 'median',
  fill_custom: 'custom',
};

const JOIN_HOW_LABELS = {
  left: 'Left',
  right: 'Right',
  inner: 'Inner',
  outer: 'Outer',
};

export function describeStep(step, sourcesMeta = {}) {
  if (!step) return 'Custom step';
  const c = step.config || {};
  const sourceLabel = (id) => sourcesMeta?.[id]?.filename || (id ? `dataset ${id.slice(0, 8)}` : 'selected dataset');

  if (step.type === 'select_columns') {
    const cols = c.selectedColumns || [];
    return cols.length ? `Keep ${cols.length} column${cols.length === 1 ? '' : 's'}: ${cols.join(', ')}` : 'Select columns';
  }
  if (step.type === 'merge_columns') {
    const cols = c.columns || [];
    return `Merge ${cols.join(', ')} into "${c.newColumnName || ''}" (separator: "${c.separator ?? ' '}")`;
  }
  if (step.type === 'drop_duplicates') {
    const rules = (c.rules || []).map((r) => `${r.allColumns ? 'all columns' : (r.columns || []).join(', ') || 'selected columns'} (keep ${r.keep || 'first'})`);
    return rules.length ? `Remove duplicates on ${rules.join('; ')}` : 'Remove duplicates';
  }
  if (step.type === 'handle_null') {
    const rules = (c.rules || []).map((r) => {
      const strategy = NULL_STRATEGY_ALIASES[r.strategy] || r.strategy;
      if (strategy === 'drop') return `drop missing ${r.column}`;
      if (strategy === 'mean') return `fill ${r.column} with mean`;
      if (strategy === 'median') return `fill ${r.column} with median`;
      if (strategy === 'custom') return `fill ${r.column} with ${JSON.stringify(r.customValue ?? '')}`;
      return `${r.column}: ${strategy || 'handle nulls'}`;
    });
    return rules.length ? `Missing values: ${rules.join('; ')}` : 'Handle missing values';
  }
  if (step.type === 'cast_type') {
    const conversions = (c.conversions || []).map((item) => `${item.column} → ${item.toType}`);
    return conversions.length ? `Convert ${conversions.join('; ')}` : 'Convert data type';
  }
  if (step.type === 'string_transform') {
    const rawRules = Array.isArray(c.rules)
      ? c.rules
      : (c.columns || []).map((column) => ({ column, trim: Boolean(c.trim), caseMode: c.caseMode || 'none' }));
    const formatted = rawRules.map((r) => {
      const parts = [
        r.trim ? 'trim whitespace' : '',
        r.caseMode && r.caseMode !== 'none' ? `case: ${r.caseMode}` : '',
      ].filter(Boolean);
      return `${r.column} (${parts.join(', ') || 'no changes'})`;
    });
    return formatted.length ? formatted.join('; ') : 'No text changes';
  }
  if (step.type === 'filter_rows') {
    const conditions = (c.conditions || []).map((cond) => {
      const op = FILTER_OPERATOR_PHRASES[cond.operator] || cond.operator || '=';
      if (['is_true', 'is_false'].includes(cond.operator)) return `${cond.column} ${op}`;
      return `${cond.column} ${op} ${JSON.stringify(cond.value ?? '')}`;
    });
    return conditions.length ? `Keep rows where ${conditions.join(' AND ')}` : 'Filter rows';
  }
  if (step.type === 'replace_value') {
    return `In ${c.column || 'column'}, replace ${JSON.stringify(c.oldValue ?? '')} with ${JSON.stringify(c.newValue ?? '')}`;
  }
  if (step.type === 'format_datetime') {
    return `Format ${c.column || 'column'} (${c.inputFormat || 'auto'} → ${c.outputFormat || 'YYYY-MM-DD'})`;
  }
  if (step.type === 'join') {
    const howLabel = JOIN_HOW_LABELS[c.how] || c.how || 'Left';
    return `${howLabel} join with ${sourceLabel(c.datasetId)} on "${c.on || ''}"`;
  }
  if (step.type === 'concat') {
    const list = (c.datasetIds || []).map(sourceLabel).join(', ');
    return `Append rows from ${list || 'selected files'}`;
  }
  return step.name || operations.find((op) => op.type === step.type)?.label || step.type || 'Custom step';
}

export function computeColumnDiff(originalCols = [], resultCols = []) {
  const origMap = new Map(originalCols.map((col) => [col.name, dataType(col.type)]));
  const resMap = new Map(resultCols.map((col) => [col.name, dataType(col.type)]));
  const added = resultCols.filter((col) => !origMap.has(col.name)).map((col) => col.name);
  const removed = originalCols.filter((col) => !resMap.has(col.name)).map((col) => col.name);
  const typeChanges = resultCols
    .filter((col) => origMap.has(col.name) && origMap.get(col.name) !== dataType(col.type))
    .map((col) => ({ name: col.name, from: origMap.get(col.name), to: dataType(col.type) }));
  return { added, removed, typeChanges };
}
