import { useEffect, useRef, useState } from 'react';
import './DataTable.css';

export function columnLetter(index) {
  let letter = '';
  for (let position = index + 1; position > 0; position = Math.floor((position - 1) / 26)) {
    letter = String.fromCharCode(65 + ((position - 1) % 26)) + letter;
  }
  return letter;
}

function valueText(value, showEmptyMarker = false) {
  if (value === null) return 'NULL';
  if (value === undefined) return 'Missing';
  if (value === '') return showEmptyMarker ? 'Empty string' : '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function CellValue({ value }) {
  if (value === null) return <span className="sheet-null" aria-label="Null value">NULL</span>;
  if (value === undefined) return <span className="sheet-null" aria-label="Missing value">Missing</span>;
  if (value === '') return <span className="sheet-null" aria-label="Empty string">Empty string</span>;
  return valueText(value);
}

export default function DataTable({
  columns = [], rows = [], caption = 'Result rows', selectedColumns = [],
  onColumnSelectionChange, onCellSelect, rowOffset = 0, selectionKey, disabled = false,
}) {
  const [selection, setSelection] = useState(null);
  const [copyMessage, setCopyMessage] = useState('');
  const selectedCell = useRef(null);
  const mounted = useRef(true);
  const cellRefs = useRef([]);
  const columnAnchor = useRef(null);
  const selectCallback = useRef(onCellSelect);
  selectCallback.current = onCellSelect;
  // Compare contents rather than array identity: parent renders may recreate an
  // equivalent columns/rows array while updating a step or selected columns.
  const dataKey = JSON.stringify([selectionKey, rowOffset, columns.map(({ name, type }) => [name, type]), rows]);
  const current = selection?.key === dataKey ? selection : null;
  const columnNames = columns.map((column) => column.name);
  const highlighted = new Set(selectedColumns.filter((name) => columnNames.includes(name)));
  const address = current ? `${columnLetter(current.column)}${rowOffset + current.row + 1}` : '';
  const rawValue = current ? rows[current.row]?.[columns[current.column]?.name] : undefined;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    const hadSelection = selectedCell.current !== null;
    selectedCell.current = null;
    columnAnchor.current = null;
    setSelection(null);
    setCopyMessage('');
    if (hadSelection) selectCallback.current?.(null);
  }, [dataKey]);

  function selectCell(row, column, focus = false) {
    if (disabled || !rows[row] || !columns[column]) return;
    const previous = selectedCell.current;
    if (!previous || previous.key !== dataKey || previous.row !== row || previous.column !== column) {
      const next = { key: dataKey, row, column };
      selectedCell.current = next;
      setSelection(next);
      setCopyMessage('');
      selectCallback.current?.({ rowIndex: row, columnIndex: column, columnName: columns[column].name,
        address: `${columnLetter(column)}${rowOffset + row + 1}`, value: rows[row][columns[column].name] });
    }
    if (focus) {
      const cell = cellRefs.current[row * columns.length + column];
      cell?.focus({ preventScroll: true });
      cell?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
  }

  function copy(event, clipboardData = event.clipboardData) {
    if (disabled || !current || !clipboardData) return false;
    clipboardData.setData('text/plain', valueText(rawValue));
    event.preventDefault();
    setCopyMessage('Cell copied.');
    return true;
  }

  function keyDown(event, row, column) {
    if (disabled) return;
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key.toLowerCase() === 'c') {
      if (copy(event)) return;
      if (navigator.clipboard?.writeText) {
        event.preventDefault();
        const copiedSelection = selectedCell.current;
        try {
          Promise.resolve(navigator.clipboard.writeText(valueText(rows[row][columns[column].name]))).then(() => {
            if (mounted.current && selectedCell.current === copiedSelection) setCopyMessage('Cell copied.');
          }).catch(() => {
            if (mounted.current && selectedCell.current === copiedSelection) setCopyMessage('Use your browser’s Copy command to copy this cell.');
          });
        } catch {
          setCopyMessage('Use your browser’s Copy command to copy this cell.');
        }
      }
      // Without the Clipboard API, leave the native copy shortcut in place;
      // its copy event supplies clipboardData to the table's onCopy handler.
      return;
    }
    let nextRow = row;
    let nextColumn = column;
    if (event.key === 'ArrowRight') nextColumn = Math.min(columns.length - 1, column + 1);
    else if (event.key === 'ArrowLeft') nextColumn = Math.max(0, column - 1);
    else if (event.key === 'ArrowDown') nextRow = Math.min(rows.length - 1, row + 1);
    else if (event.key === 'ArrowUp') nextRow = Math.max(0, row - 1);
    else if (event.key === 'Home') { nextColumn = 0; if (modifier) nextRow = 0; }
    else if (event.key === 'End') { nextColumn = columns.length - 1; if (modifier) nextRow = rows.length - 1; }
    else if (event.key === 'Tab') {
      const next = row * columns.length + column + (event.shiftKey ? -1 : 1);
      // Let Tab leave the sheet at its edges, rather than trapping keyboard users.
      if (next < 0 || next >= rows.length * columns.length) return;
      nextRow = Math.floor(next / columns.length);
      nextColumn = next % columns.length;
    } else return;
    event.preventDefault();
    selectCell(nextRow, nextColumn, true);
  }

  function selectColumn(event, index) {
    if (disabled || !onColumnSelectionChange) return;
    const modifier = event.ctrlKey || event.metaKey;
    let next;
    if (event.shiftKey && columnAnchor.current !== null) {
      const start = Math.min(columnAnchor.current, index);
      const end = Math.max(columnAnchor.current, index);
      next = new Set(modifier ? highlighted : []);
      columnNames.slice(start, end + 1).forEach((name) => next.add(name));
    } else {
      next = new Set(modifier ? highlighted : []);
      const name = columnNames[index];
      if (modifier && next.has(name)) next.delete(name);
      else next.add(name);
      columnAnchor.current = index;
    }
    onColumnSelectionChange(columnNames.filter((name) => next.has(name)));
  }

  if (columns.length === 0) return <p className="sheet-empty">This result has no columns.</p>;
  return <div className="sheet" aria-disabled={disabled || undefined}>
    <div className="sheet-valuebar">
      <span className="sheet-address" aria-label="Selected cell address">{address || '—'}</span>
      <textarea className="sheet-value" aria-label="Selected cell value" readOnly disabled={disabled} rows={1} spellCheck={false}
        value={current ? valueText(rawValue, true) : ''} placeholder="Select a cell to view its full value" />
      <span className="sheet-readonly">Read only</span>
    </div>
    <div className="sheet-scroll" role="region" aria-label={caption}>
      <table className="sheet-table" style={{ width: `${48 + columns.length * 176}px` }} onCopy={copy}>
        <caption className="sheet-caption">{caption}</caption>
        <colgroup><col className="sheet-number-col" />{columns.map((column) => <col className="sheet-data-col" key={column.name} />)}</colgroup>
        <thead><tr><th className="sheet-corner" scope="col" aria-label="Row number">#</th>{columns.map((column, index) => {
          const content = <><span className="sheet-letter">{columnLetter(index)}</span><span className="sheet-column-name">{column.name}</span><span className="sheet-column-type">{column.type}</span></>;
          return <th key={column.name} scope="col" aria-selected={highlighted.has(column.name)} className={highlighted.has(column.name) ? 'sheet-column-selected' : ''}>
            {onColumnSelectionChange ? <button className="sheet-column-button" type="button" disabled={disabled}
              aria-label={`Select column ${columnLetter(index)}: ${column.name}`} aria-pressed={highlighted.has(column.name)}
              onClick={(event) => selectColumn(event, index)}>{content}</button> : <span className="sheet-column-label">{content}</span>}
          </th>;
        })}</tr></thead>
        <tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>
          <th className="sheet-row-number" scope="row">{rowOffset + rowIndex + 1}</th>
          {columns.map((column, columnIndex) => {
            const selected = current?.row === rowIndex && current?.column === columnIndex;
            const value = row[column.name];
            const className = ['sheet-cell', highlighted.has(column.name) ? 'sheet-column-selected' : '',
              selected ? 'sheet-cell-active' : '', typeof value === 'number' ? 'sheet-cell-number' : ''].filter(Boolean).join(' ');
            return <td key={column.name} ref={(cell) => { cellRefs.current[rowIndex * columns.length + columnIndex] = cell; }}
              className={className} aria-current={selected ? 'true' : undefined} tabIndex={disabled ? -1 : current ? selected ? 0 : -1 : rowIndex === 0 && columnIndex === 0 ? 0 : -1}
              onClick={() => selectCell(rowIndex, columnIndex, true)} onFocus={() => selectCell(rowIndex, columnIndex)}
              onKeyDown={(event) => keyDown(event, rowIndex, columnIndex)}>
              <span className="sheet-cell-text"><CellValue value={value} /></span>
            </td>;
          })}
        </tr>)}</tbody>
      </table>
      {rows.length === 0 && <p className="sheet-empty">No rows in this result.</p>}
    </div>
    <p className="sheet-help">{copyMessage || (onColumnSelectionChange ? 'Select columns by their headers. Ctrl/Cmd adds columns; Shift selects a range. ' : '') + 'Use arrow keys to inspect cells. Ctrl/Cmd+C copies the selected value.'}</p>
  </div>;
}
