import React from 'react';

const known = {
  strategy: ['drop', 'mean', 'custom'],
  toType: ['integer', 'float', 'string'],
  caseMode: ['none', 'upper', 'lower'],
  operator: ['greater_than', 'less_than', 'greater_or_equal', 'less_or_equal', 'equals', 'not_equals', 'contains'],
  outputFormat: ['YYYY-MM-DD', 'YYYY-MM-DD HH:mm:ss', 'ISO_8601'],
  how: ['left', 'right', 'inner', 'outer'],
};
const optionLabels = {
  drop: 'Drop rows', mean: 'Fill with mean', custom: 'Fill with a value',
  integer: 'Integer', float: 'Decimal number', string: 'Text',
  none: 'Keep case', upper: 'UPPERCASE', lower: 'lowercase',
  greater_than: 'Greater than', less_than: 'Less than', greater_or_equal: 'Greater than or equal',
  less_or_equal: 'Less than or equal', equals: 'Equals (numeric)', not_equals: 'Not equal (numeric)', contains: 'Contains text',
  left: 'Keep every row from the current data', right: 'Keep every row from the added file',
  inner: 'Keep matching rows only', outer: 'Keep every row from both',
};
const numeric = (type) => /^(int|uint|float|double|decimal|number|numeric)/i.test(type || '');

function choices(capabilities, type, key) {
  const operation = capabilities?.operations?.[type];
  const rules = operation?.rules?.[0] || operation?.conversions?.[0] || operation?.conditions?.[0];
  const advertised = operation?.[key] || rules?.[key];
  return Array.isArray(advertised) ? known[key].filter((value) => advertised.includes(value)) : known[key];
}

function SelectField({ label, value, values, onChange, placeholder = false }) {
  return <label className="etl-field">{label}
    <select value={value ?? ''} onChange={(event) => onChange(event.target.value)}>
      {placeholder && <option value="">{typeof placeholder === 'string' ? placeholder : 'Choose a column'}</option>}
      {values.map((item) => {
        const value = typeof item === 'string' ? item : item.value;
        return <option key={value} value={value}>{typeof item === 'string' ? (optionLabels[item] || item) : item.label}</option>;
      })}
    </select>
  </label>;
}

function ColumnSelect({ label, value, columns, onChange }) {
  return <SelectField label={label} value={value} onChange={onChange} placeholder
    values={columns.map((column) => ({ value: column.name, label: column.name }))} />;
}

function ColumnChecks({ label, columns, selected = [], onChange, disabled = false }) {
  return <fieldset className="etl-options" disabled={disabled}>
    <legend>{label}</legend>
    {columns.length === 0 && <p className="etl-muted">No columns available.</p>}
    {columns.map((column) => <label key={column.name} className="etl-inline">
      <input type="checkbox" checked={selected.includes(column.name)} onChange={(event) => onChange(event.target.checked
        ? [...selected, column.name] : selected.filter((name) => name !== column.name))} />{column.name}
    </label>)}
  </fieldset>;
}

function ScalarInput({ label, value, column, onChange, forceText = false }) {
  const isNumber = !forceText && numeric(column?.type);
  return <label className="etl-field">{label}
    <input type={isNumber ? 'number' : 'text'} step={isNumber ? 'any' : undefined} value={value ?? ''}
      onChange={(event) => {
        const raw = event.target.value;
        onChange(isNumber && raw !== '' ? Number(raw) : raw);
      }} />
  </label>;
}

export default function WorkflowStepConfig({ step, columns = [], sources = [], primaryId, onChange, capabilities, onPreviewSource }) {
  if (!step) return <p className="etl-muted">Add or select a step to configure it.</p>;
  const { type } = step;
  const config = step.config || {};
  const firstColumn = columns[0]?.name || '';
  const columnFor = (name) => columns.find((column) => column.name === name);
  const update = (changes) => onChange({ ...config, ...changes });
  const options = (key) => choices(capabilities, type, key);
  const otherSources = sources.filter((source) => source.id !== primaryId);
  const maxRules = Math.max(1, Math.min(50, capabilities?.limits?.maxRules || 50));

  if (type === 'select_columns') {
    return <><ColumnChecks label="Columns to keep" columns={columns} selected={config.selectedColumns}
      onChange={(selectedColumns) => update({ selectedColumns })} />
      <p className="etl-muted">Choose at least one column. Selected columns keep their selection order.</p></>;
  }

  if (type === 'replace_value') {
    return <><ColumnSelect label="Replace in column" value={config.column} columns={columns} onChange={(column) => update({ column })} />
      <ScalarInput label="Old value" value={config.oldValue} column={columnFor(config.column)} onChange={(oldValue) => update({ oldValue })} />
      <ScalarInput label="New value" value={config.newValue} column={columnFor(config.column)} onChange={(newValue) => update({ newValue })} />
      <p className="etl-muted">Matches are exact and case-sensitive. An empty replacement is allowed.</p></>;
  }

  if (type === 'format_datetime') {
    return <><ColumnSelect label="Date column" value={config.column} columns={columns} onChange={(column) => update({ column, inputFormat: 'auto' })} />
      <SelectField label="Date output format" value={config.outputFormat || 'YYYY-MM-DD'} values={options('outputFormat')}
        onChange={(outputFormat) => update({ inputFormat: 'auto', outputFormat })} />
      <p className="etl-muted">Dates are parsed automatically. Unrecognized dates become missing; mixed date formats may not all parse. ISO output does not add a timezone.</p></>;
  }

  if (type === 'join') {
    const right = otherSources.find((source) => source.id === config.datasetId);
    const rightColumns = new Set((right?.columns || []).map((column) => column.name));
    const shared = columns.filter((column) => rightColumns.has(column.name));
    return <>
      <SelectField label="File to join" value={config.datasetId} placeholder="Choose a file" values={otherSources.map((source) => ({ value: source.id, label: source.filename }))}
        onChange={(datasetId) => update({ datasetId, on: '' })} />
      {right && onPreviewSource && <button className="button button-secondary" type="button" onClick={() => onPreviewSource(right.id)}>Preview {right.filename}</button>}
      {right && shared.length === 0 && <p role="alert">There is no shared column name. A join needs one column with the same name in both datasets.</p>}
      <ColumnSelect label="Shared join column" value={config.on} columns={shared} onChange={(on) => update({ on })} />
      <SelectField label="Rows to retain" value={config.how || 'left'} values={options('how')} onChange={(how) => update({ how })} />
      <p className="etl-muted">Matches use one shared column. Multiple matches can increase the row count. Columns with the same name receive _x and _y suffixes.</p>
    </>;
  }

  if (type === 'concat') {
    const selected = config.datasetIds || [];
    const added = otherSources.filter((source) => selected.includes(source.id));
    const all = [{ id: 'current', filename: 'Current data', columns }, ...added];
    const union = Array.from(new Set(all.flatMap((source) => (source.columns || []).map((column) => column.name))));
    return <><fieldset className="etl-options"><legend>Files to append</legend>
      {otherSources.length === 0 && <p className="etl-muted">Add another source file to append rows.</p>}
      {otherSources.map((source) => <div key={source.id}>
        <label className="etl-inline"><input type="checkbox" checked={selected.includes(source.id)} onChange={(event) => update({ datasetIds: event.target.checked
          ? [...selected, source.id] : selected.filter((id) => id !== source.id) })} />{source.filename}</label>
        {onPreviewSource && <button type="button" className="button button-secondary" onClick={() => onPreviewSource(source.id)}>Preview {source.filename}</button>}
      </div>)}
    </fieldset>
      <p className="etl-muted">Rows are appended in the selected file order. Missing columns are filled with NULL.</p>
      {added.length > 0 && <ul>{all.map((source) => {
        const present = new Set((source.columns || []).map((column) => column.name));
        const missing = union.filter((name) => !present.has(name));
        return missing.length > 0 ? <li key={source.id}>{source.filename}: missing {missing.join(', ')}; these cells will be NULL.</li> : null;
      })}</ul>}
    </>;
  }

  const key = type === 'cast_type' ? 'conversions' : type === 'filter_rows' ? 'conditions' : 'rules';
  const legacyStrings = type === 'string_transform' && !config.rules
    ? (config.columns || []).map((column) => ({ column, trim: Boolean(config.trim), caseMode: config.caseMode || 'none' })) : null;
  const rules = config[key] || legacyStrings || [];
  const setRules = (next) => onChange({ [key]: next });
  const changeRule = (index, changes) => setRules(rules.map((rule, position) => position === index ? { ...rule, ...changes } : rule));
  const defaults = {
    drop_duplicates: { allColumns: true, columns: [], keep: 'first' },
    handle_null: { column: firstColumn, strategy: 'drop', customValue: '' },
    cast_type: { column: firstColumn, toType: 'string' },
    string_transform: { column: firstColumn, trim: true, caseMode: 'none' },
    filter_rows: { column: firstColumn, operator: 'greater_than', value: '' },
  };
  if (!defaults[type]) return <p role="alert">This operation is not available.</p>;

  return <>
    {type === 'filter_rows' && <p className="etl-muted">Every condition must match (AND). Numeric comparisons require a numeric column.</p>}
    {rules.map((rule, index) => {
      const label = `Rule ${index + 1}`;
      return <fieldset className="etl-rule" key={index}><legend>{label}</legend>
        {type !== 'drop_duplicates' && <ColumnSelect label={`${label} column`} value={rule.column} columns={columns} onChange={(column) => changeRule(index, { column })} />}
        {type === 'drop_duplicates' && <>
          <label className="etl-inline"><input type="checkbox" checked={Boolean(rule.allColumns)}
            onChange={(event) => changeRule(index, { allColumns: event.target.checked, columns: event.target.checked ? [] : (firstColumn ? [firstColumn] : []), keep: 'first' })} />{label}: compare all columns</label>
          {!rule.allColumns && <ColumnChecks label={`${label} comparison columns`} columns={columns} selected={rule.columns}
            onChange={(selected) => changeRule(index, { columns: selected, keep: 'first' })} />}
          <p className="etl-muted">Keeps the first exact match.</p>
        </>}
        {type === 'handle_null' && <>
          <SelectField label={`${label} null handling`} value={rule.strategy} values={options('strategy')} onChange={(strategy) => changeRule(index, { strategy })} />
          {rule.strategy === 'custom' && <ScalarInput label={`${label} fill value`} value={rule.customValue} column={columnFor(rule.column)} onChange={(customValue) => changeRule(index, { customValue })} />}
          {rule.strategy === 'mean' && <p className="etl-muted">Requires a numeric column. The mean is rounded to two decimal places.</p>}
        </>}
        {type === 'cast_type' && <><SelectField label={`${label} target type`} value={rule.toType} values={options('toType')} onChange={(toType) => changeRule(index, { toType })} />
          <p className="etl-muted">Invalid integers become zero; invalid decimal values become missing.</p></>}
        {type === 'string_transform' && <>
          <label className="etl-inline"><input type="checkbox" checked={Boolean(rule.trim)} onChange={(event) => changeRule(index, { trim: event.target.checked })} />{label}: trim outer whitespace</label>
          <SelectField label={`${label} letter case`} value={rule.caseMode || 'none'} values={options('caseMode')} onChange={(caseMode) => changeRule(index, { caseMode })} />
        </>}
        {type === 'filter_rows' && <>
          <SelectField label={`${label} comparison`} value={rule.operator} values={options('operator')} onChange={(operator) => changeRule(index, { operator, value: operator === 'contains' ? String(rule.value ?? '') : rule.value })} />
          <ScalarInput label={`${label} comparison value`} value={rule.value} column={rule.operator === 'contains' ? undefined : { type: 'float' }}
            forceText={rule.operator === 'contains'} onChange={(value) => changeRule(index, { value })} />
        </>}
        <button className="button button-secondary" type="button" onClick={() => setRules(rules.filter((_, position) => position !== index))}>Remove rule {index + 1}</button>
      </fieldset>;
    })}
    <button className="button button-secondary" type="button" disabled={rules.length >= maxRules}
      onClick={() => setRules([...rules, { ...defaults[type] }])}>Add rule</button>
    {rules.length === 0 && <p className="etl-muted">Add at least one rule to configure this step.</p>}
  </>;
}
