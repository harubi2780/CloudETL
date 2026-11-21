import { useState } from 'react';
import { dataType, operations } from '../../lib/pipeline/workflow';

export const operationGroups = [
  { name: 'Columns', types: ['select_columns', 'merge_columns', 'cast_type'] },
  { name: 'Clean', types: ['drop_duplicates', 'handle_null', 'string_transform', 'replace_value', 'format_datetime'] },
  { name: 'Filter', types: ['filter_rows'] },
  { name: 'Combine', types: ['join', 'concat'] },
];

export default function WorkbookToolbar({
  capabilities,
  onAddStep,
  disabled,
  sourceCount,
  selectedColumns = [],
  hasDateColumns,
  columns = [],
}) {
  const [group, setGroup] = useState('Clean');
  const selectedGroup = operationGroups.find((item) => item.name === group);
  const showDateFormat = typeof hasDateColumns === 'boolean'
    ? hasDateColumns
    : columns.some((col) => dataType(col.type) === 'datetime');

  return <div className="workbook-ribbon">
    <nav className="workbook-ribbon-tabs" aria-label="Transformation groups">{operationGroups.map((item) =>
      <button key={item.name} type="button" aria-pressed={group === item.name} onClick={() => setGroup(item.name)}>{item.name}</button>
    )}<span className="workbook-selection">{selectedColumns.length ? `${selectedColumns.length} column${selectedColumns.length === 1 ? '' : 's'} selected` : 'Select a column, then choose an action'}</span></nav>
    <div className="workbook-commands" role="toolbar" aria-label="Transformations">{selectedGroup.types.map((type) => {
      const operation = operations.find((item) => item.type === type);
      if (!capabilities?.operations?.[type]) return null;
      if (type === 'format_datetime' && !showDateFormat) return null;
      return <button key={type} type="button" disabled={disabled || (['join', 'concat'].includes(type) && sourceCount < 2)}
        onClick={() => onAddStep(type)} aria-label={`Add ${operation.label} step`}>{operation.label}</button>;
    })}</div>
  </div>;
}
