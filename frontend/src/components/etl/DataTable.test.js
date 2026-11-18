import { useState } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import DataTable, { columnLetter } from './DataTable';

const columns = [
  { name: 'name', type: 'string' }, { name: 'amount', type: 'integer' },
  { name: 'city', type: 'string' }, { name: 'paid', type: 'boolean' },
];
const rows = [
  { name: 'Alice', amount: 0, city: 'Hanoi', paid: false },
  { name: 'Bob', amount: 12, city: 'Danang', paid: true },
];
const cell = (name) => screen.getByRole('cell', { name: String(name) });
const headerButton = (letter, name) => screen.getByRole('button', { name: `Select column ${letter}: ${name}` });
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

afterEach(() => {
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else delete navigator.clipboard;
});

function SelectableTable({ onChange = jest.fn(), ...props }) {
  const [selected, setSelected] = useState([]);
  return <DataTable columns={columns} rows={rows} selectedColumns={selected}
    onColumnSelectionChange={(next) => { setSelected(next); onChange(next); }} {...props} />;
}

test('retains semantic table roles, named columns and numbered rows', () => {
  render(<DataTable columns={columns} rows={rows} caption="Source records" rowOffset={25} />);
  expect(screen.getByRole('table', { name: 'Source records' })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Source records' })).toBeInTheDocument();
  expect(screen.queryByRole('grid')).not.toBeInTheDocument();
  expect(screen.getAllByRole('row')).toHaveLength(3);
  expect(screen.getByRole('rowheader', { name: '26' })).toBeInTheDocument();
  expect(screen.getByRole('rowheader', { name: '27' })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: /amount/ })).toHaveTextContent('integer');
  expect(cell(0)).toHaveClass('sheet-cell-number');
  expect(cell('Alice')).not.toHaveClass('sheet-cell-number');
});

test('column letters continue after Z without changing original names', () => {
  const manyColumns = Array.from({ length: 28 }, (_, index) => ({ name: `field-${index}`, type: 'string' }));
  render(<DataTable columns={manyColumns} rows={[]} />);
  expect(columnLetter(0)).toBe('A');
  expect(columnLetter(25)).toBe('Z');
  expect(columnLetter(26)).toBe('AA');
  expect(columnLetter(27)).toBe('AB');
  expect(columnLetter(701)).toBe('ZZ');
  expect(columnLetter(702)).toBe('AAA');
  expect(within(screen.getByRole('columnheader', { name: /field-26/ })).getByText('AA')).toBeInTheDocument();
});

test('selecting a cell focuses it and exposes the full raw value and address', () => {
  const longValue = 'A long value with\na second line and more than one hundred characters: ' + 'detail '.repeat(30);
  const onCellSelect = jest.fn();
  render(<DataTable columns={columns} rows={[{ ...rows[0], city: longValue }]} rowOffset={25} onCellSelect={onCellSelect} />);
  fireEvent.click(screen.getByRole('cell', { name: /A long value with/ }));
  expect(screen.getByRole('cell', { name: /A long value with/ })).toHaveFocus();
  expect(screen.getByLabelText('Selected cell address')).toHaveTextContent('C26');
  expect(screen.getByLabelText('Selected cell value')).toHaveValue(longValue);
  expect(screen.getByLabelText('Selected cell value')).toHaveAttribute('readonly');
  expect(onCellSelect).toHaveBeenCalledTimes(1);
  expect(onCellSelect).toHaveBeenLastCalledWith({ rowIndex: 0, columnIndex: 2, columnName: 'city', address: 'C26', value: longValue });
});

test('null, missing, empty string, zero and false remain distinct', () => {
  const scalarColumns = ['null', 'missing', 'empty', 'zero', 'false'].map((name) => ({ name, type: 'string' }));
  render(<DataTable columns={scalarColumns} rows={[{ null: null, empty: '', zero: 0, false: false }]} />);
  expect(screen.getByLabelText('Null value')).toHaveTextContent('NULL');
  expect(screen.getByLabelText('Missing value')).toHaveTextContent('Missing');
  expect(screen.getByLabelText('Empty string')).toHaveTextContent('Empty string');
  for (const [display, value] of [['Null value', 'NULL'], ['Missing value', 'Missing'], ['Empty string', 'Empty string'], ['0', '0'], ['false', 'false']]) {
    fireEvent.click(cell(display));
    expect(screen.getByLabelText('Selected cell value')).toHaveValue(value);
  }
});

test('plain header selection replaces, Ctrl/Cmd toggles, and selected columns highlight', () => {
  const onChange = jest.fn();
  render(<SelectableTable onChange={onChange} />);
  fireEvent.click(headerButton('B', 'amount'));
  expect(onChange).toHaveBeenLastCalledWith(['amount']);
  expect(headerButton('B', 'amount')).toHaveAttribute('aria-pressed', 'true');
  expect(cell(0)).toHaveClass('sheet-column-selected');
  fireEvent.click(headerButton('D', 'paid'), { ctrlKey: true });
  expect(onChange).toHaveBeenLastCalledWith(['amount', 'paid']);
  fireEvent.click(headerButton('B', 'amount'), { metaKey: true });
  expect(onChange).toHaveBeenLastCalledWith(['paid']);
  fireEvent.click(headerButton('A', 'name'));
  expect(onChange).toHaveBeenLastCalledWith(['name']);
  expect(headerButton('D', 'paid')).toHaveAttribute('aria-pressed', 'false');
});

test('Shift selects a range from the last anchor and Ctrl+Shift adds a range', () => {
  const onChange = jest.fn();
  render(<SelectableTable onChange={onChange} />);
  fireEvent.click(headerButton('B', 'amount'));
  fireEvent.click(headerButton('D', 'paid'), { shiftKey: true });
  expect(onChange).toHaveBeenLastCalledWith(['amount', 'city', 'paid']);
  fireEvent.click(headerButton('A', 'name'), { ctrlKey: true });
  fireEvent.click(headerButton('B', 'amount'), { ctrlKey: true, shiftKey: true });
  expect(onChange).toHaveBeenLastCalledWith(['name', 'amount', 'city', 'paid']);
});

test('arrow keys use roving focus without crossing row or column bounds', () => {
  render(<DataTable columns={columns} rows={rows} />);
  expect(cell('Alice')).toHaveAttribute('tabindex', '0');
  expect(cell(0)).toHaveAttribute('tabindex', '-1');
  fireEvent.click(cell('Alice'));
  fireEvent.keyDown(cell('Alice'), { key: 'ArrowLeft' });
  expect(cell('Alice')).toHaveFocus();
  fireEvent.keyDown(cell('Alice'), { key: 'ArrowUp' });
  expect(cell('Alice')).toHaveFocus();
  fireEvent.keyDown(cell('Alice'), { key: 'ArrowRight' });
  expect(cell(0)).toHaveFocus();
  expect(cell(0)).toHaveAttribute('aria-current', 'true');
  expect(cell('Alice')).toHaveAttribute('tabindex', '-1');
  fireEvent.keyDown(cell(0), { key: 'ArrowDown' });
  expect(cell(12)).toHaveFocus();
  fireEvent.keyDown(cell(12), { key: 'ArrowDown' });
  expect(cell(12)).toHaveFocus();
});

test('Home/End and modified Home/End move to row and sheet edges', () => {
  render(<DataTable columns={columns} rows={rows} />);
  fireEvent.click(cell('Danang'));
  fireEvent.keyDown(cell('Danang'), { key: 'Home' });
  expect(cell('Bob')).toHaveFocus();
  fireEvent.keyDown(cell('Bob'), { key: 'End' });
  expect(cell(true)).toHaveFocus();
  fireEvent.keyDown(cell(true), { key: 'Home', ctrlKey: true });
  expect(cell('Alice')).toHaveFocus();
  fireEvent.keyDown(cell('Alice'), { key: 'End', metaKey: true });
  expect(cell(true)).toHaveFocus();
});

test('Tab and Shift+Tab traverse cells and permit leaving the sheet at its edges', () => {
  render(<DataTable columns={columns} rows={rows} />);
  fireEvent.click(cell(false));
  fireEvent.keyDown(cell(false), { key: 'Tab' });
  expect(cell('Bob')).toHaveFocus();
  fireEvent.keyDown(cell('Bob'), { key: 'Tab', shiftKey: true });
  expect(cell(false)).toHaveFocus();
  fireEvent.click(cell('Alice'));
  expect(fireEvent.keyDown(cell('Alice'), { key: 'Tab', shiftKey: true })).toBe(true);
  fireEvent.click(cell(true));
  expect(fireEvent.keyDown(cell(true), { key: 'Tab' })).toBe(true);
});

test('Ctrl/Cmd+C writes the actual scalar to the Clipboard API', async () => {
  const writeText = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  render(<DataTable columns={columns} rows={rows} />);
  fireEvent.click(cell(0));
  fireEvent.keyDown(cell(0), { key: 'c', ctrlKey: true });
  expect(writeText).toHaveBeenLastCalledWith('0');
  await screen.findByText('Cell copied.');
  fireEvent.click(cell(false));
  fireEvent.keyDown(cell(false), { key: 'C', metaKey: true });
  expect(writeText).toHaveBeenLastCalledWith('false');
  await screen.findByText('Cell copied.');
});

test('native copy events provide a clipboardData fallback and preserve an empty string', () => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  const setData = jest.fn();
  render(<DataTable columns={[{ name: 'value', type: 'string' }]} rows={[{ value: '' }]} />);
  fireEvent.click(cell('Empty string'));
  expect(fireEvent.keyDown(cell('Empty string'), { key: 'c', ctrlKey: true })).toBe(true);
  expect(fireEvent.copy(cell('Empty string'), { clipboardData: { setData } })).toBe(false);
  expect(setData).toHaveBeenCalledWith('text/plain', '');
});

test('clipboard failures do not falsely claim success or change the value', async () => {
  const writeText = jest.fn().mockRejectedValue(new Error('Denied'));
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  render(<DataTable columns={columns} rows={rows} />);
  fireEvent.click(cell('Alice'));
  fireEvent.keyDown(cell('Alice'), { key: 'c', ctrlKey: true });
  expect(await screen.findByText('Use your browser’s Copy command to copy this cell.')).toBeInTheDocument();
  expect(screen.queryByText('Cell copied.')).not.toBeInTheDocument();
  expect(cell('Alice')).toHaveTextContent('Alice');
});

test('equivalent fresh arrays keep cell focus while data/page/source changes reset selection', () => {
  const onCellSelect = jest.fn();
  const { rerender } = render(<DataTable columns={columns} rows={rows} onCellSelect={onCellSelect} selectionKey="source-one" />);
  fireEvent.click(cell('Hanoi'));
  rerender(<DataTable columns={columns.map((item) => ({ ...item }))} rows={rows.map((item) => ({ ...item }))} onCellSelect={onCellSelect} selectionKey="source-one" />);
  expect(screen.getByLabelText('Selected cell address')).toHaveTextContent('C1');
  expect(cell('Hanoi')).toHaveFocus();
  rerender(<DataTable columns={columns} rows={rows} onCellSelect={onCellSelect} selectionKey="source-one" rowOffset={25} />);
  expect(screen.getByLabelText('Selected cell value')).toHaveValue('');
  expect(onCellSelect).toHaveBeenLastCalledWith(null);
  fireEvent.click(cell('Hanoi'));
  expect(screen.getByLabelText('Selected cell address')).toHaveTextContent('C26');
  rerender(<DataTable columns={columns} rows={rows} onCellSelect={onCellSelect} selectionKey="source-two" rowOffset={25} />);
  expect(screen.getByLabelText('Selected cell value')).toHaveValue('');
  fireEvent.click(cell('Hanoi'));
  rerender(<DataTable columns={columns} rows={[{ ...rows[0], city: 'Hue' }, rows[1]]} onCellSelect={onCellSelect} selectionKey="source-two" rowOffset={25} />);
  expect(screen.getByLabelText('Selected cell value')).toHaveValue('');
});

test('switching column order resets the address and typing never edits or evaluates data', () => {
  const formula = '=SUM(1,2)';
  const formulaRows = [{ name: formula, amount: 0, city: 'Hanoi', paid: false }];
  const { rerender } = render(<DataTable columns={columns} rows={formulaRows} />);
  fireEvent.click(cell(formula));
  fireEvent.keyDown(cell(formula), { key: '9' });
  expect(cell(formula)).toHaveTextContent(formula);
  expect(formulaRows[0].name).toBe(formula);
  expect(screen.getByLabelText('Selected cell value')).toHaveValue(formula);
  rerender(<DataTable columns={[columns[1], columns[0], ...columns.slice(2)]} rows={formulaRows} />);
  expect(screen.getByLabelText('Selected cell value')).toHaveValue('');
});

test('disabled sheets do not focus cells, select columns or invoke callbacks', () => {
  const onCellSelect = jest.fn();
  const onColumnSelectionChange = jest.fn();
  render(<DataTable columns={columns} rows={rows} disabled onCellSelect={onCellSelect} onColumnSelectionChange={onColumnSelectionChange} />);
  fireEvent.click(cell('Alice'));
  fireEvent.keyDown(cell('Alice'), { key: 'ArrowRight' });
  fireEvent.click(headerButton('A', 'name'));
  expect(onCellSelect).not.toHaveBeenCalled();
  expect(onColumnSelectionChange).not.toHaveBeenCalled();
  expect(cell('Alice')).toHaveAttribute('tabindex', '-1');
  expect(headerButton('A', 'name')).toBeDisabled();
  expect(screen.getByLabelText('Selected cell value')).toBeDisabled();
});

test('empty tables keep the original empty messages', () => {
  const { rerender } = render(<DataTable columns={columns} rows={[]} />);
  expect(screen.getByText('No rows in this result.')).toBeInTheDocument();
  expect(screen.queryByRole('cell')).not.toBeInTheDocument();
  rerender(<DataTable columns={[]} rows={[]} />);
  expect(screen.getByText('This result has no columns.')).toBeInTheDocument();
});

test('clipboard completion after unmount is ignored', async () => {
  let complete;
  const writeText = jest.fn(() => new Promise((resolve) => { complete = resolve; }));
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  const { unmount } = render(<DataTable columns={columns} rows={rows} />);
  fireEvent.click(cell('Alice'));
  fireEvent.keyDown(cell('Alice'), { key: 'c', ctrlKey: true });
  unmount();
  await act(async () => { complete(); });
  expect(writeText).toHaveBeenCalledWith('Alice');
});
