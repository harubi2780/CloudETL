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
  onOpenSources,
}) {
  const [group, setGroup] = useState('Clean');
  const selectedGroup = operationGroups.find((item) => item.name === group);
  const showDateFormat = typeof hasDateColumns === 'boolean'
    ? hasDateColumns
    : columns.some((col) => dataType(col.type) === 'datetime');
  const combineLocked = selectedGroup.name === 'Combine' && sourceCount < 2;
  const hasCombineOps = selectedGroup.types.some((type) => Boolean(capabilities?.operations?.[type]));

  return <div className="workbook-ribbon">
    <nav className="workbook-ribbon-tabs" aria-label="Transformation groups">{operationGroups.map((item) =>
      <button key={item.name} type="button" aria-pressed={group === item.name} onClick={() => setGroup(item.name)}>{item.name}</button>
    )}<span className="workbook-selection">{selectedColumns.length ? `${selectedColumns.length} column${selectedColumns.length === 1 ? '' : 's'} selected` : 'Select a column, then choose an action'}</span></nav>
    <div className="workbook-commands" role="toolbar" aria-label="Transformations">{selectedGroup.types.map((type) => {
      const operation = operations.find((item) => item.type === type);
      if (!capabilities?.operations?.[type]) return null;
      if (type === 'format_datetime' && !showDateFormat) return null;
      const requiresMoreSources = ['join', 'concat'].includes(type) && sourceCount < 2;
      return <button key={type} type="button" disabled={disabled || requiresMoreSources}
        aria-describedby={requiresMoreSources ? 'combine-source-requirement' : undefined}
        title={requiresMoreSources ? 'Add another source file to enable' : undefined}
        onClick={() => onAddStep(type)} aria-label={`Add ${operation.label} step`}>{operation.label}</button>;
    })}
    {combineLocked && hasCombineOps && (
      <div className="workbook-combine-guidance">
        <p id="combine-source-requirement" className="workbook-combine-hint" role="status">
          Add another source file (at least 2 files required) to join tables or append rows.
        </p>
        {onOpenSources && (
          <button type="button" className="workbook-combine-add" data-source-picker-trigger="true" onClick={onOpenSources}>
            Add source
          </button>
        )}
      </div>
    )}
    </div>
  </div>;
}
