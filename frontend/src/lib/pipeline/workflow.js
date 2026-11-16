// Application schema and validation. Data transformations execute only in Django.
export const operations = [
  ['select_columns', 'Select columns'], ['drop_duplicates', 'Remove duplicates'],
  ['handle_null', 'Handle missing values'], ['cast_type', 'Convert data type'],
  ['string_transform', 'Clean text'], ['filter_rows', 'Filter rows'],
  ['replace_value', 'Replace values'], ['format_datetime', 'Format dates'],
  ['join', 'Join tables'], ['concat', 'Append rows'],
].map(([type, label]) => ({ type, label }));

export function dataType(type = '') {
  if (/bool/i.test(type)) return 'boolean';
  if (/int/i.test(type)) return 'integer';
  if (/float|double|decimal/i.test(type)) return 'float';
  if (/date|time/i.test(type)) return 'datetime';
  return 'string';
}

export function newStep(type, columns, sources, primaryId) {
  const column = columns[0]?.name || '';
  const other = sources.find((source) => source.id !== primaryId);
  const configs = {
    select_columns: { selectedColumns: columns.map((item) => item.name) },
    drop_duplicates: { rules: [{ allColumns: true, columns: [], keep: 'first' }] },
    handle_null: { rules: [{ column, strategy: 'drop' }] },
    cast_type: { conversions: [{ column, toType: 'string' }] },
    string_transform: { rules: [{ column, trim: true, caseMode: 'none' }] },
    filter_rows: { conditions: [{ column, operator: 'contains', value: '' }] },
    replace_value: { column, oldValue: '', newValue: '' },
    format_datetime: { column, inputFormat: 'auto', outputFormat: 'YYYY-MM-DD' },
    join: { datasetId: other?.id || '', on: columns.find((item) => other?.columns?.some((right) => right.name === item.name))?.name || '', how: 'left' },
    concat: { datasetIds: sources.filter((source) => source.id !== primaryId).map((source) => source.id) },
  };
  return { type, name: operations.find((op) => op.type === type)?.label || type, config: configs[type], enabled: true };
}

export function sourceIds(configuration, includeDisabled = false) {
  const ids = [configuration.datasetId];
  for (const step of configuration.steps || []) {
    if (!includeDisabled && step.enabled === false) continue;
    if (step.type === 'join') ids.push(step.config.datasetId);
    if (step.type === 'concat') ids.push(...(step.config.datasetIds || []));
  }
  return [...new Set(ids.filter(Boolean))];
}

export function nextSchema(schema, step, sources) {
  if (step.enabled === false) return schema;
  const config = step.config;
  if (step.type === 'select_columns') return (config.selectedColumns || []).map((name) => schema.find((col) => col.name === name)).filter(Boolean);
  if (step.type === 'cast_type') return schema.map((col) => ({ ...col, type: config.conversions?.find((item) => item.column === col.name)?.toType || col.type }));
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
      else if (existing.type !== col.type) combined[combined.indexOf(existing)] = { ...existing, type: [existing.type, col.type].every((type) => ['integer', 'float'].includes(type)) ? 'float' : 'string' };
    }
    return combined;
  }
  return schema;
}

export function schemasFor(primaryId, steps, sources) {
  let schema = sources.find((item) => item.id === primaryId)?.columns || [];
  const before = [];
  for (const step of steps) { before.push(schema); schema = nextSchema(schema, step, sources); }
  return { before, final: schema };
}

export function validateWorkflow(payload, sources, caps) {
  const errors = [];
  const limits = caps?.limits || {};
  if (!payload.name.trim() || payload.name.length > 120) errors.push('Enter a pipeline name up to 120 characters.');
  if (!sources.length || !sources.some((source) => source.id === payload.datasetId)) errors.push('Choose a starting dataset.');
  if (sources.length > (limits.maxSources || 6)) errors.push(`Select at most ${limits.maxSources || 6} sources.`);
  if (sources.reduce((sum, item) => sum + item.size_bytes, 0) > (limits.maxCombinedInputBytes || 26214400)) errors.push('The combined source size exceeds the processing limit.');
  if (sources.some((item) => item.status !== 'ready')) errors.push('Every selected source must have a successful preview before running.');
  if (payload.steps.length > (limits.maxSteps || 50)) errors.push('The pipeline has too many steps.');
  const used = sourceIds(payload);
  if (sources.some((source) => !used.includes(source.id))) errors.push('Some selected sources are unused. Add a Join or Append step, or remove them.');
  const schemas = schemasFor(payload.datasetId, payload.steps, sources);
  for (const [index, step] of payload.steps.entries()) {
    const prefix = `Step ${index + 1}: `;
    const config = step.config;
    const schema = schemas.before[index];
    const names = schema.map((col) => col.name);
    const required = [];
    if (!caps?.operations?.[step.type]) errors.push(prefix + 'this operation is unavailable.');
    if (step.type === 'select_columns') {
      if (!config.selectedColumns?.length) errors.push(prefix + 'select at least one column.');
      required.push(...(config.selectedColumns || []));
    } else if (step.type === 'join') {
      const right = sources.find((source) => source.id === config.datasetId);
      if (!right || !config.on || !right.columns?.some((col) => col.name === config.on)) errors.push(prefix + 'choose a source and a shared join column.');
      required.push(config.on);
    } else if (step.type === 'concat') {
      if (!config.datasetIds?.length || config.datasetIds.some((id) => !sources.some((source) => source.id === id))) errors.push(prefix + 'choose available files to append.');
    } else if (['replace_value', 'format_datetime'].includes(step.type)) required.push(config.column);
    else {
      const key = step.type === 'cast_type' ? 'conversions' : step.type === 'filter_rows' ? 'conditions' : 'rules';
      const rules = config[key] || [];
      if (!rules.length || rules.length > 50) errors.push(prefix + 'configure between 1 and 50 rules.');
      for (const rule of rules) {
        if (step.type === 'drop_duplicates') {
          if (!rule.allColumns && !rule.columns?.length) errors.push(prefix + 'choose comparison columns.');
          required.push(...(rule.columns || []));
        } else required.push(rule.column);
        if (step.type === 'handle_null' && rule.strategy === 'custom' && (rule.customValue === undefined || rule.customValue === null)) errors.push(prefix + 'enter a custom fill value.');
        if (step.type === 'filter_rows' && (rule.value === undefined || rule.value === null || rule.value === '' || (rule.operator !== 'contains' && !Number.isFinite(Number(rule.value))))) errors.push(prefix + 'enter a valid filter value.');
        if (step.enabled !== false && ((step.type === 'handle_null' && rule.strategy === 'mean') || (step.type === 'filter_rows' && rule.operator !== 'contains'))) {
          if (!['integer', 'float'].includes(schema.find((col) => col.name === rule.column)?.type)) errors.push(prefix + 'this operation needs a numeric column; convert it first.');
        }
      }
    }
    if (required.some((name) => !name || (step.enabled !== false && !names.includes(name)))) errors.push(prefix + 'a referenced column is missing or was removed earlier.');
    if (step.enabled !== false) {
      const after = nextSchema(schema, step, sources).map((col) => col.name);
      if (after.length !== new Set(after).size) errors.push(prefix + 'the result would contain duplicate column names.');
    }
  }
  if (new Blob([JSON.stringify(payload)]).size > 16384) errors.push('The pipeline configuration exceeds the 16 KiB request limit.');
  return [...new Set(errors)];
}
