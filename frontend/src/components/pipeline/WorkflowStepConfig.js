import React, { useState } from 'react';
import {
  CAST_TYPES,
  dataType,
  defaultOperatorForType,
  filterOperatorsForType,
  normalizeCastType,
} from '../../lib/pipeline/workflow';
import DateTimeFilterInput from './DateTimeFilterInput';

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

function SelectField({ label, value, values, onChange, placeholder = false, disabled = false }) {
  return <label className="etl-field">{label}
    <select value={value ?? ''} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
      {placeholder && <option value="">{typeof placeholder === 'string' ? placeholder : 'Choose a column'}</option>}
      {values.map((item) => {
        const optionValue = typeof item === 'string' ? item : item.value;
        return <option key={optionValue} value={optionValue}>{typeof item === 'string' ? (optionLabels[item] || item) : item.label}</option>;
      })}
    </select>
  </label>;
}

function ColumnSelect({ label, value, columns, onChange, disabled = false }) {
  return <SelectField label={label} value={value} onChange={onChange} placeholder disabled={disabled}
    values={columns.map((column) => ({ value: column.name, label: column.name }))} />;
}

function ColumnChecks({ label, columns, selected = [], onChange, disabled = false }) {
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = normalizedQuery
    ? columns.filter((column) => column.name.toLowerCase().includes(normalizedQuery))
    : columns;
  const allFilteredSelected = filtered.length > 0 && filtered.every((column) => selected.includes(column.name));
  const anyFilteredSelected = filtered.some((column) => selected.includes(column.name));

  return <fieldset className="etl-options" disabled={disabled}>
    <legend>{label}</legend>
    {columns.length > 0 && (
      <div className="etl-column-checks-bar">
        <button
          type="button"
          className="button button-secondary"
          disabled={disabled || filtered.length === 0 || allFilteredSelected}
          onClick={() => onChange([
            ...selected,
            ...filtered.map((column) => column.name).filter((name) => !selected.includes(name)),
          ])}
        >
          Select all
        </button>
        <button
          type="button"
          className="button button-secondary"
          disabled={disabled || !anyFilteredSelected}
          onClick={() => onChange(selected.filter((name) => !filtered.some((column) => column.name === name)))}
        >
          Clear
        </button>
        {columns.length > 6 && (
          <input
            type="search"
            className="etl-column-search"
            aria-label={`Filter ${label}`}
            placeholder="Filter columns…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        )}
      </div>
    )}
    {columns.length === 0 && <p className="etl-muted">No columns available.</p>}
    {columns.length > 0 && filtered.length === 0 && (
      <p className="etl-muted">No columns match &ldquo;{query.trim()}&rdquo;.</p>
    )}
    {filtered.map((column) => <label key={column.name} className="etl-inline">
      <input type="checkbox" checked={selected.includes(column.name)} onChange={(event) => onChange(event.target.checked
        ? [...selected, column.name] : selected.filter((name) => name !== column.name))} />{column.name}
    </label>)}
  </fieldset>;
}

function ScalarInput({ label, value, column, onChange, forceText = false, disabled = false }) {
  const isNumber = !forceText && numeric(column?.type);
  return <label className="etl-field">{label}
    <input type={isNumber ? 'number' : 'text'} step={isNumber ? 'any' : undefined} value={value ?? ''} disabled={disabled}
      onChange={(event) => {
        const raw = event.target.value;
        onChange(isNumber && raw !== '' ? Number(raw) : raw);
      }} />
  </label>;
}

export default function WorkflowStepConfig({
  step,
  columns = [],
  sources = [],
  primaryId,
  onChange,
  capabilities,
  onPreviewSource,
  disabled = false,
}) {
  const [appendDragIndex, setAppendDragIndex] = useState(null);
  const [appendOverIndex, setAppendOverIndex] = useState(null);
  const [ruleResetEpoch, setRuleResetEpoch] = useState(0);

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
    return <><ColumnChecks label="Columns to keep" columns={columns} selected={config.selectedColumns} disabled={disabled}
      onChange={(selectedColumns) => update({ selectedColumns })} />
      <p className="etl-muted">Choose at least one column. Selected columns keep their selection order.</p></>;
  }

  if (type === 'merge_columns') {
    return <>
      <ColumnChecks label="Columns to merge" columns={columns} selected={config.columns} disabled={disabled}
        onChange={(selected) => update({ columns: selected })} />
      <label className="etl-field">New column name
        <input type="text" maxLength={255} value={config.newColumnName ?? ''} disabled={disabled}
          onChange={(event) => update({ newColumnName: event.target.value })} />
      </label>
      <label className="etl-field">Separator
        <input type="text" maxLength={32} value={config.separator ?? ' '} disabled={disabled}
          onChange={(event) => update({ separator: event.target.value })} />
      </label>
      <p className="etl-muted">Choose at least two columns. Trimmed text values are combined into a new column.</p>
    </>;
  }

  if (type === 'replace_value') {
    return <><ColumnSelect label="Replace in column" value={config.column} columns={columns} disabled={disabled} onChange={(column) => update({ column })} />
      <ScalarInput label="Old value" value={config.oldValue} column={columnFor(config.column)} disabled={disabled} onChange={(oldValue) => update({ oldValue })} />
      <ScalarInput label="New value" value={config.newValue} column={columnFor(config.column)} disabled={disabled} onChange={(newValue) => update({ newValue })} />
      <p className="etl-muted">Matches are exact and case-sensitive. An empty replacement is allowed.</p></>;
  }

  if (type === 'format_datetime') {
    const dateColumns = columns.filter((column) => dataType(column.type) === 'datetime');
    const selectedIsDate = dateColumns.some((column) => column.name === config.column);
    return <><ColumnSelect label="Date column" value={selectedIsDate ? config.column : ''} columns={dateColumns} disabled={disabled} onChange={(column) => update({ column })} />
      {dateColumns.length === 0 ? (
        <p className="etl-muted">No date columns are available at this step.</p>
      ) : (config.column && !selectedIsDate) ? (
        <p className="etl-muted">Selected column is no longer a date column. Choose an available date column.</p>
      ) : null}
      <SelectField label="Date input format" value={config.inputFormat || 'auto'} values={options('inputFormat')} disabled={disabled}
        onChange={(inputFormat) => update({ inputFormat })} />
      <SelectField label="Date output format" value={config.outputFormat || 'YYYY-MM-DD'} values={options('outputFormat')} disabled={disabled}
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
      <SelectField
        label="File to join"
        value={config.datasetId}
        placeholder="Choose a file"
        disabled={disabled || otherSources.length === 0}
        values={otherSources.map((source) => ({ value: source.id, label: source.filename }))}
        onChange={(datasetId) => update({ datasetId, on: '' })}
      />
      {otherSources.length === 0 && (
        <p className="etl-muted" role="status">Add another source file to select a file to join.</p>
      )}
      {right && onPreviewSource && <button className="button button-secondary" type="button" disabled={disabled} onClick={() => onPreviewSource(right.id)}>Preview {right.filename}</button>}
      {right && shared.length === 0 && <p role="alert">There is no shared column name. A join needs one column with the same name in both datasets.</p>}
      <ColumnSelect label="Shared join column" value={config.on} columns={shared} disabled={disabled} onChange={(on) => update({ on })} />
      <SelectField label="Rows to retain" value={config.how || 'left'} values={options('how')} disabled={disabled} onChange={(how) => update({ how })} />
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
      const target = index + delta;
      if (target < 0 || target >= added.length) return;
      reorderAppend(index, target);
    };
    const reorderAppend = (fromIndex, toIndex) => {
      if (
        disabled
        || !Number.isInteger(fromIndex) || !Number.isInteger(toIndex)
        || fromIndex < 0 || fromIndex >= added.length
        || toIndex < 0 || toIndex >= added.length
        || fromIndex === toIndex
      ) return;
      const fromId = added[fromIndex]?.id;
      const toId = added[toIndex]?.id;
      const selectedFrom = selected.indexOf(fromId);
      const selectedTo = selected.indexOf(toId);
      if (selectedFrom < 0 || selectedTo < 0 || selectedFrom === selectedTo) return;
      const next = [...selected];
      const [moved] = next.splice(selectedFrom, 1);
      next.splice(selectedTo, 0, moved);
      update({ datasetIds: next });
    };
    return <><fieldset className="etl-options" disabled={disabled}><legend>Files to append</legend>
      {otherSources.length === 0 && <p className="etl-muted">Add another source file to append rows.</p>}
      {otherSources.map((source) => <div key={source.id}>
        <label className="etl-inline"><input type="checkbox" checked={selected.includes(source.id)} onChange={(event) => update({ datasetIds: event.target.checked
          ? [...selected, source.id] : selected.filter((id) => id !== source.id) })} />{source.filename}</label>
        {onPreviewSource && <button type="button" className="button button-secondary" onClick={() => onPreviewSource(source.id)}>Preview {source.filename}</button>}
      </div>)}
    </fieldset>
      {added.length > 1 && <ol className="etl-append-order" aria-label="Append order">
        {added.map((source, index) => <li
          key={source.id}
          draggable={!disabled}
          className={[
            appendDragIndex === index && 'is-dragging',
            appendOverIndex === index && appendDragIndex !== index && 'is-drop-target',
          ].filter(Boolean).join(' ') || undefined}
          onDragStart={(event) => {
            if (disabled) return;
            setAppendDragIndex(index);
            setAppendOverIndex(index);
            if (event.dataTransfer) {
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('application/x-cloudetl-drag', 'concat-append');
              event.dataTransfer.setData('text/plain', source.id);
            }
          }}
          onDragOver={(event) => {
            if (disabled) return;
            event.preventDefault();
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
            if (appendOverIndex !== index) setAppendOverIndex(index);
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget) && appendOverIndex === index) {
              setAppendOverIndex(null);
            }
          }}
          onDrop={(event) => {
            event.preventDefault();
            const dragKind = event.dataTransfer?.getData('application/x-cloudetl-drag');
            const transferredId = event.dataTransfer?.getData('text/plain');
            const isForeignDrag = Boolean(
              dragKind && dragKind !== 'concat-append'
              && (dragKind !== transferredId || ['source-tab', 'applied-step'].includes(dragKind)),
            );
            if (isForeignDrag) {
              setAppendDragIndex(null);
              setAppendOverIndex(null);
              return;
            }
            const fromIndex = appendDragIndex !== null
              ? appendDragIndex
              : added.findIndex((item) => item.id === transferredId);
            setAppendDragIndex(null);
            setAppendOverIndex(null);
            reorderAppend(fromIndex, index);
          }}
          onDragEnd={() => {
            setAppendDragIndex(null);
            setAppendOverIndex(null);
          }}
        >
          <span className="workbook-drag-handle" aria-hidden="true" title="Drag to reorder">⋮⋮</span>
          <span>{index + 1}. {source.filename}</span>
          <button type="button" className="button button-secondary" disabled={disabled || index === 0}
            aria-label={`Move ${source.filename} up in append order`} onClick={() => moveAppend(index, -1)}>↑</button>
          <button type="button" className="button button-secondary" disabled={disabled || index === added.length - 1}
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
  const createDefaultRule = (ruleType) => {
    if (ruleType === 'drop_duplicates') return { allColumns: true, columns: [], keep: 'first' };
    if (ruleType === 'handle_null') return { column: firstColumn, strategy: 'drop', customValue: '' };
    if (ruleType === 'cast_type') return { column: firstColumn, toType: 'str' };
    if (ruleType === 'string_transform') return { column: firstColumn, trim: true, caseMode: 'none' };
    if (ruleType === 'filter_rows') {
      return {
        column: firstColumn,
        operator: defaultFilterOp,
        value: ['is_true', 'is_false'].includes(defaultFilterOp) ? null : '',
      };
    }
    return null;
  };
  if (!['drop_duplicates', 'handle_null', 'cast_type', 'string_transform', 'filter_rows'].includes(type)) {
    return <p role="alert">This operation is not available.</p>;
  }

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
      const isDateTimeFilter = ['after', 'before'].includes(rule.operator)
        || (rule.operator === 'equals' && dataType(selectedCol?.type) === 'datetime');
      return <fieldset className="etl-rule" key={`${ruleResetEpoch}-${index}`}><legend>{label}</legend>
        {type !== 'drop_duplicates' && <ColumnSelect label={`${label} column`} value={rule.column} columns={columns} disabled={disabled} onChange={(column) => {
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
          <label className="etl-inline"><input type="checkbox" checked={Boolean(rule.allColumns)} disabled={disabled}
            onChange={(event) => changeRule(index, { allColumns: event.target.checked, columns: event.target.checked ? [] : (firstColumn ? [firstColumn] : []), keep: rule.keep || 'first' })} />{label}: compare all columns</label>
          {!rule.allColumns && <ColumnChecks label={`${label} comparison columns`} columns={columns} selected={rule.columns} disabled={disabled}
            onChange={(selected) => changeRule(index, { columns: selected, keep: rule.keep || 'first' })} />}
          <SelectField label={`${label} duplicate row to keep`} value={rule.keep || 'first'} values={options('keep')} disabled={disabled}
            onChange={(keep) => changeRule(index, { keep })} />
        </>}
        {type === 'handle_null' && <>
          <SelectField label={`${label} null handling`} value={rule.strategy} values={options('strategy')} disabled={disabled} onChange={(strategy) => changeRule(index, { strategy })} />
          {rule.strategy === 'custom' && <ScalarInput label={`${label} fill value`} value={rule.customValue} column={columnFor(rule.column)} disabled={disabled} onChange={(customValue) => changeRule(index, { customValue })} />}
          {['mean', 'median'].includes(rule.strategy) && <p className="etl-muted">Requires a numeric column. The {rule.strategy} is rounded to two decimal places.</p>}
        </>}
        {type === 'cast_type' && <><SelectField label={`${label} target type`}
          value={castValues.includes(castValue) ? castValue : ''}
          placeholder={!castValues.includes(castValue) ? 'Choose a type' : false}
          values={castValues} disabled={disabled} onChange={(toType) => changeRule(index, { toType })} />
          <p className="etl-muted">Invalid integers become zero; invalid decimal or date values become missing.</p></>}
        {type === 'string_transform' && <>
          <label className="etl-inline"><input type="checkbox" checked={Boolean(rule.trim)} disabled={disabled} onChange={(event) => changeRule(index, { trim: event.target.checked })} />{label}: trim outer whitespace</label>
          <SelectField label={`${label} letter case`} value={rule.caseMode || 'none'} values={options('caseMode')} disabled={disabled} onChange={(caseMode) => changeRule(index, { caseMode })} />
          {rule.caseMode && rule.caseMode !== 'none' && <p className="etl-muted">Letter-case transforms also trim outer whitespace.</p>}
        </>}
        {type === 'filter_rows' && <>
          {rule.column && !selectedCol && <p className="etl-muted">Selected column is unavailable at this step.</p>}
          <SelectField label={`${label} comparison`}
            value={operatorValues.includes(rule.operator) ? rule.operator : ''}
            placeholder={!selectedCol ? 'Choose a column first' : !operatorValues.includes(rule.operator) ? 'Choose a comparison' : false}
            values={operatorValues}
            disabled={disabled}
            onChange={(operator) => {
              const flag = ['is_true', 'is_false'].includes(operator);
              const isDateOp = ['after', 'before'].includes(operator)
                || (operator === 'equals' && dataType(selectedCol?.type) === 'datetime');
              const textLike = ['contains', 'starts_with', 'ends_with'].includes(operator) || isDateOp;
              changeRule(index, { operator, value: flag ? null : textLike ? String(rule.value ?? '') : (rule.value ?? '') });
            }} />
          {operatorValues.includes(rule.operator) && !['is_true', 'is_false'].includes(rule.operator) && (
            isDateTimeFilter ? (
              <DateTimeFilterInput
                label={`${label} comparison value`}
                value={rule.value ?? ''}
                disabled={disabled}
                onChange={(value) => changeRule(index, { value })}
              />
            ) : (
              <ScalarInput
                label={`${label} comparison value`}
                value={rule.value}
                disabled={disabled}
                column={rule.operator === 'equals' ? selectedCol : ['contains', 'starts_with', 'ends_with'].includes(rule.operator) ? undefined : { type: 'float' }}
                forceText={['contains', 'starts_with', 'ends_with'].includes(rule.operator)}
                onChange={(value) => changeRule(index, { value })}
              />
            )
          )}
          {isDateTimeFilter && <p className="etl-muted">Select a date (YYYY-MM-DD) or date and time from the calendar.</p>}
        </>}
        <button className="button button-secondary" type="button" disabled={disabled} onClick={() => { setRuleResetEpoch((count) => count + 1); setRules(rules.filter((_, position) => position !== index)); }}>Remove rule {index + 1}</button>
      </fieldset>;
    })}
    <button className="button button-secondary" type="button" disabled={disabled || rules.length >= maxRules}
      onClick={() => {
        const nextRule = createDefaultRule(type);
        if (nextRule) setRules([...rules, nextRule]);
      }}>Add rule</button>
    {rules.length === 0 && <p className="etl-muted">Add at least one rule to configure this step.</p>}
  </>;
}
