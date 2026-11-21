import React from 'react';
import {
  CAST_TYPES,
  dataType,
  defaultOperatorForType,
  filterOperatorsForType,
  normalizeCastType,
} from '../../lib/pipeline/workflow';

const known = {
  keep: ['first', 'last'],
  strategy: ['drop', 'mean', 'median', 'custom'],
  toType: CAST_TYPES,
  caseMode: ['none', 'upper', 'lower', 'title'],
  operator: [
    'greater_than', 'less_than', 'greater_or_equal', 'less_or_equal',
    'equals', 'not_equals', 'contains', 'starts_with', 'ends_with',
    'is_true', 'is_false', 'after', 'before',
  ],
  inputFormat: ['auto', 'YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY/MM/DD'],
  outputFormat: ['YYYY-MM-DD', 'YYYY-MM-DD HH:mm:ss', 'ISO_8601'],
  how: ['left', 'right', 'inner', 'outer'],
};
const optionLabels = {
  first: 'Keep first match', last: 'Keep last match',
  drop: 'Drop rows', mean: 'Fill with mean', median: 'Fill with median', custom: 'Fill with a value',
  str: 'Text (str)', int: 'Integer (int)', float: 'Decimal (float)', date: 'Date (date)',
  none: 'Keep case', upper: 'UPPERCASE', lower: 'lowercase', title: 'Title Case',
  auto: 'Auto-detect',
  greater_than: 'Greater than', less_than: 'Less than', greater_or_equal: 'Greater than or equal',
  less_or_equal: 'Less than or equal', equals: 'Equals', not_equals: 'Not equal (numeric)',
  contains: 'Contains text', starts_with: 'Starts with', ends_with: 'Ends with',
  is_true: 'Is true', is_false: 'Is false', after: 'After date', before: 'Before date',
  left: 'Keep every row from the current data', right: 'Keep every row from the added file',
  inner: 'Keep matching rows only', outer: 'Keep every row from both',
};
const numeric = (type) => /^(int|uint|float|double|decimal|number|numeric)/i.test(type || '');

function choices(capabilities, type, key) {
  const operation = capabilities?.operations?.[type];
  const rules = operation?.rules?.[0] || operation?.conversions?.[0] || operation?.conditions?.[0];
  const advertised = operation?.[key] || rules?.[key];
  if (!Array.isArray(advertised)) return known[key];
  const normalized = key === 'toType' ? advertised.map(normalizeCastType) : advertised;
  return known[key].filter((value) => normalized.includes(value));
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

  if (type === 'merge_columns') {
    return <>
      <ColumnChecks label="Columns to merge" columns={columns} selected={config.columns}
        onChange={(selected) => update({ columns: selected })} />
      <label className="etl-field">New column name
        <input type="text" maxLength={255} value={config.newColumnName ?? ''}
          onChange={(event) => update({ newColumnName: event.target.value })} />
      </label>
      <label className="etl-field">Separator
        <input type="text" maxLength={32} value={config.separator ?? ' '}
          onChange={(event) => update({ separator: event.target.value })} />
      </label>
      <p className="etl-muted">Choose at least two columns. Trimmed text values are combined into a new column.</p>
    </>;
  }

  if (type === 'replace_value') {
    return <><ColumnSelect label="Replace in column" value={config.column} columns={columns} onChange={(column) => update({ column })} />
      <ScalarInput label="Old value" value={config.oldValue} column={columnFor(config.column)} onChange={(oldValue) => update({ oldValue })} />
      <ScalarInput label="New value" value={config.newValue} column={columnFor(config.column)} onChange={(newValue) => update({ newValue })} />
      <p className="etl-muted">Matches are exact and case-sensitive. An empty replacement is allowed.</p></>;
  }

  if (type === 'format_datetime') {
    const dateColumns = columns.filter((column) => dataType(column.type) === 'datetime');
    const selectedIsDate = dateColumns.some((column) => column.name === config.column);
    return <><ColumnSelect label="Date column" value={selectedIsDate ? config.column : ''} columns={dateColumns} onChange={(column) => update({ column })} />
      {dateColumns.length === 0 ? (
        <p className="etl-muted">No date columns are available at this step.</p>
      ) : (config.column && !selectedIsDate) ? (
        <p className="etl-muted">Selected column is no longer a date column. Choose an available date column.</p>
      ) : null}
      <SelectField label="Date input format" value={config.inputFormat || 'auto'} values={options('inputFormat')}
        onChange={(inputFormat) => update({ inputFormat })} />
      <SelectField label="Date output format" value={config.outputFormat || 'YYYY-MM-DD'} values={options('outputFormat')}
        onChange={(outputFormat) => update({ outputFormat })} />
      <p className="etl-muted">Auto-detect parses mixed date formats. Choose an explicit input format if day and month order could be ambiguous. ISO output does not add a timezone.</p></>;
  }

  if (type === 'join') {
    const right = otherSources.find((source) => source.id === config.datasetId);
    const leftNames = new Set(columns.map((column) => column.name));
    const rightColumns = new Set((right?.columns || []).map((column) => column.name));
    const shared = columns.filter((column) => rightColumns.has(column.name));
    const rightUnique = (right?.columns || []).filter((column) => !leftNames.has(column.name)).map((column) => column.name);
    const overlapping = (right?.columns || []).filter((column) => leftNames.has(column.name) && column.name !== config.on).map((column) => column.name);
    return <>
      <SelectField label="File to join" value={config.datasetId} placeholder="Choose a file" values={otherSources.map((source) => ({ value: source.id, label: source.filename }))}
        onChange={(datasetId) => update({ datasetId, on: '' })} />
      {right && onPreviewSource && <button className="button button-secondary" type="button" onClick={() => onPreviewSource(right.id)}>Preview {right.filename}</button>}
      {right && shared.length === 0 && <p role="alert">There is no shared column name. A join needs one column with the same name in both datasets.</p>}
      <ColumnSelect label="Shared join column" value={config.on} columns={shared} onChange={(on) => update({ on })} />
      <SelectField label="Rows to retain" value={config.how || 'left'} values={options('how')} onChange={(how) => update({ how })} />
      {right && <p className="etl-muted">Shared keys: {shared.length ? shared.map((column) => column.name).join(', ') : 'none'}. Added columns: {rightUnique.length ? rightUnique.join(', ') : 'none'}{overlapping.length ? `. Renamed overlapping (_x/_y): ${overlapping.join(', ')}` : ''}.</p>}
      <p className="etl-muted">Matches use one shared column. Multiple matches can increase the row count. Columns with the same name receive _x and _y suffixes.</p>
    </>;
  }

  if (type === 'concat') {
    const selected = config.datasetIds || [];
    const added = selected.map((id) => otherSources.find((source) => source.id === id)).filter(Boolean);
    const all = [{ id: 'current', filename: 'Current data', columns }, ...added];
    const union = Array.from(new Set(all.flatMap((source) => (source.columns || []).map((column) => column.name))));
    const moveAppend = (index, delta) => {
      const next = [...selected];
      [next[index], next[index + delta]] = [next[index + delta], next[index]];
      update({ datasetIds: next });
    };
    return <><fieldset className="etl-options"><legend>Files to append</legend>
      {otherSources.length === 0 && <p className="etl-muted">Add another source file to append rows.</p>}
      {otherSources.map((source) => <div key={source.id}>
        <label className="etl-inline"><input type="checkbox" checked={selected.includes(source.id)} onChange={(event) => update({ datasetIds: event.target.checked
          ? [...selected, source.id] : selected.filter((id) => id !== source.id) })} />{source.filename}</label>
        {onPreviewSource && <button type="button" className="button button-secondary" onClick={() => onPreviewSource(source.id)}>Preview {source.filename}</button>}
      </div>)}
    </fieldset>
      {added.length > 1 && <ol className="etl-append-order" aria-label="Append order">
        {added.map((source, index) => <li key={source.id}><span>{index + 1}. {source.filename}</span>
          <button type="button" className="button button-secondary" disabled={index === 0}
            aria-label={`Move ${source.filename} up in append order`} onClick={() => moveAppend(index, -1)}>↑</button>
          <button type="button" className="button button-secondary" disabled={index === added.length - 1}
            aria-label={`Move ${source.filename} down in append order`} onClick={() => moveAppend(index, 1)}>↓</button>
        </li>)}
      </ol>}
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
  const defaultFilterOp = columns[0] ? defaultOperatorForType(columns[0].type, capabilities) : '';
  const defaults = {
    drop_duplicates: { allColumns: true, columns: [], keep: 'first' },
    handle_null: { column: firstColumn, strategy: 'drop', customValue: '' },
    cast_type: { column: firstColumn, toType: 'str' },
    string_transform: { column: firstColumn, trim: true, caseMode: 'none' },
    filter_rows: { column: firstColumn, operator: defaultFilterOp, value: ['is_true', 'is_false'].includes(defaultFilterOp) ? null : '' },
  };
  if (!defaults[type]) return <p role="alert">This operation is not available.</p>;

  return <>
    {type === 'filter_rows' && <p className="etl-muted">Every condition must match (AND). Comparison options match the selected column type.</p>}
    {rules.map((rule, index) => {
      const label = `Rule ${index + 1}`;
      const selectedCol = columnFor(rule.column);
      const castValue = type === 'cast_type' ? normalizeCastType(rule.toType) : '';
      const castValues = type === 'cast_type' ? options('toType') : [];
      const allowedByType = type === 'filter_rows' && selectedCol ? filterOperatorsForType(selectedCol.type, capabilities) : [];
      const advertisedOps = type === 'filter_rows' ? options('operator') : [];
      const operatorValues = type === 'filter_rows' ? allowedByType.filter((op) => advertisedOps.includes(op)) : [];
      return <fieldset className="etl-rule" key={index}><legend>{label}</legend>
        {type !== 'drop_duplicates' && <ColumnSelect label={`${label} column`} value={rule.column} columns={columns} onChange={(column) => {
          if (type !== 'filter_rows') {
            changeRule(index, { column });
            return;
          }
          const prevCol = columnFor(rule.column);
          const nextCol = columnFor(column);
          if (!nextCol) {
            changeRule(index, { column: '', operator: '', value: '' });
            return;
          }
          const nextAllowed = filterOperatorsForType(nextCol.type, capabilities);
          const nextOperator = nextAllowed.includes(rule.operator)
            ? rule.operator
            : defaultOperatorForType(nextCol.type, capabilities);
          const resetValue = nextOperator !== rule.operator || dataType(prevCol?.type) !== dataType(nextCol.type);
          const nextValue = resetValue ? (['is_true', 'is_false'].includes(nextOperator) ? null : '') : rule.value;
          changeRule(index, { column, operator: nextOperator, value: nextValue });
        }} />}
        {type === 'drop_duplicates' && <>
          <label className="etl-inline"><input type="checkbox" checked={Boolean(rule.allColumns)}
            onChange={(event) => changeRule(index, { allColumns: event.target.checked, columns: event.target.checked ? [] : (firstColumn ? [firstColumn] : []), keep: rule.keep || 'first' })} />{label}: compare all columns</label>
          {!rule.allColumns && <ColumnChecks label={`${label} comparison columns`} columns={columns} selected={rule.columns}
            onChange={(selected) => changeRule(index, { columns: selected, keep: rule.keep || 'first' })} />}
          <SelectField label={`${label} duplicate row to keep`} value={rule.keep || 'first'} values={options('keep')}
            onChange={(keep) => changeRule(index, { keep })} />
        </>}
        {type === 'handle_null' && <>
          <SelectField label={`${label} null handling`} value={rule.strategy} values={options('strategy')} onChange={(strategy) => changeRule(index, { strategy })} />
          {rule.strategy === 'custom' && <ScalarInput label={`${label} fill value`} value={rule.customValue} column={columnFor(rule.column)} onChange={(customValue) => changeRule(index, { customValue })} />}
          {['mean', 'median'].includes(rule.strategy) && <p className="etl-muted">Requires a numeric column. The {rule.strategy} is rounded to two decimal places.</p>}
        </>}
        {type === 'cast_type' && <><SelectField label={`${label} target type`}
          value={castValues.includes(castValue) ? castValue : ''}
          placeholder={!castValues.includes(castValue) ? 'Choose a type' : false}
          values={castValues} onChange={(toType) => changeRule(index, { toType })} />
          <p className="etl-muted">Invalid integers become zero; invalid decimal or date values become missing.</p></>}
        {type === 'string_transform' && <>
          <label className="etl-inline"><input type="checkbox" checked={Boolean(rule.trim)} onChange={(event) => changeRule(index, { trim: event.target.checked })} />{label}: trim outer whitespace</label>
          <SelectField label={`${label} letter case`} value={rule.caseMode || 'none'} values={options('caseMode')} onChange={(caseMode) => changeRule(index, { caseMode })} />
          {rule.caseMode && rule.caseMode !== 'none' && <p className="etl-muted">Letter-case transforms also trim outer whitespace.</p>}
        </>}
        {type === 'filter_rows' && <>
          {rule.column && !selectedCol && <p className="etl-muted">Selected column is unavailable at this step.</p>}
          <SelectField label={`${label} comparison`}
            value={operatorValues.includes(rule.operator) ? rule.operator : ''}
            placeholder={!selectedCol ? 'Choose a column first' : !operatorValues.includes(rule.operator) ? 'Choose a comparison' : false}
            values={operatorValues}
            onChange={(operator) => {
              const flag = ['is_true', 'is_false'].includes(operator);
              const textLike = ['contains', 'starts_with', 'ends_with', 'after', 'before'].includes(operator);
              changeRule(index, { operator, value: flag ? null : textLike ? String(rule.value ?? '') : (rule.value ?? '') });
            }} />
          {operatorValues.includes(rule.operator) && !['is_true', 'is_false'].includes(rule.operator) && <ScalarInput label={`${label} comparison value`} value={rule.value}
            column={rule.operator === 'equals' ? selectedCol : ['contains', 'starts_with', 'ends_with', 'after', 'before'].includes(rule.operator) ? undefined : { type: 'float' }}
            forceText={['contains', 'starts_with', 'ends_with', 'after', 'before'].includes(rule.operator)} onChange={(value) => changeRule(index, { value })} />}
          {(['after', 'before'].includes(rule.operator) || (rule.operator === 'equals' && dataType(selectedCol?.type) === 'datetime')) && <p className="etl-muted">Enter a date such as YYYY-MM-DD.</p>}
        </>}
        <button className="button button-secondary" type="button" onClick={() => setRules(rules.filter((_, position) => position !== index))}>Remove rule {index + 1}</button>
      </fieldset>;
    })}
    <button className="button button-secondary" type="button" disabled={rules.length >= maxRules}
      onClick={() => setRules([...rules, { ...defaults[type] }])}>Add rule</button>
    {rules.length === 0 && <p className="etl-muted">Add at least one rule to configure this step.</p>}
  </>;
}
