import React, { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WorkflowStepConfig from './WorkflowStepConfig';

const columns = [{ name: 'order_id', type: 'str' }, { name: 'amount', type: 'float64' }, { name: 'city', type: 'str' }];
const sources = [
  { id: 'main', filename: 'orders.csv', columns },
  { id: 'customers', filename: 'customers.tsv', columns: [{ name: 'order_id', type: 'str' }, { name: 'phone', type: 'str' }] },
  { id: 'next', filename: 'next.csv', columns: [{ name: 'order_id', type: 'str' }, { name: 'amount', type: 'float64' }] },
];

function Harness({ type, config, ...props }) {
  const [value, setValue] = useState(config);
  return <><WorkflowStepConfig step={{ id: 'test', type, enabled: true, config: value }} columns={columns} sources={sources}
    primaryId="main" onChange={setValue} {...props} /><output data-testid="configuration">{JSON.stringify(value)}</output></>;
}
const configuration = () => JSON.parse(screen.getByTestId('configuration').textContent);

test('join offers shared keys only, source preview, and supported retention choices', async () => {
  const preview = jest.fn();
  render(<Harness type="join" config={{ datasetId: '', on: '', how: 'left' }} onPreviewSource={preview} />);
  expect(within(screen.getByLabelText('File to join')).queryByRole('option', { name: 'orders.csv' })).not.toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText('File to join'), 'customers');
  const key = screen.getByLabelText('Shared join column');
  expect(within(key).getByRole('option', { name: 'order_id' })).toBeInTheDocument();
  expect(within(key).queryByRole('option', { name: 'amount' })).not.toBeInTheDocument();
  await userEvent.selectOptions(key, 'order_id');
  await userEvent.selectOptions(screen.getByLabelText('Rows to retain'), 'inner');
  expect(configuration()).toEqual({ datasetId: 'customers', on: 'order_id', how: 'inner' });
  expect(screen.getByText(/Shared keys: order_id/)).toBeInTheDocument();
  expect(screen.getByText(/Added columns: phone/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Preview customers.tsv' }));
  expect(preview).toHaveBeenCalledWith('customers');
  expect(screen.getByText(/Multiple matches can increase/)).toBeInTheDocument();
});

test('join with no common key explains why it cannot be configured', () => {
  render(<Harness type="join" config={{ datasetId: 'other' }} sources={[{ id: 'other', filename: 'other.csv', columns: [{ name: 'unrelated' }] }]} />);
  expect(screen.getByRole('alert')).toHaveTextContent('There is no shared column name');
  expect(within(screen.getByLabelText('Shared join column')).getAllByRole('option')).toHaveLength(1);
});

test('append lists column differences and preserves selected file order without duplicates', async () => {
  render(<Harness type="concat" config={{ datasetIds: [] }} />);
  await userEvent.click(screen.getByLabelText('customers.tsv'));
  await userEvent.click(screen.getByLabelText('next.csv'));
  expect(configuration()).toEqual({ datasetIds: ['customers', 'next'] });
  expect(screen.getByText('Current data: missing phone; these cells will be NULL.')).toBeInTheDocument();
  expect(screen.getByText('customers.tsv: missing amount, city; these cells will be NULL.')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Move next.csv up in append order' }));
  expect(configuration()).toEqual({ datasetIds: ['next', 'customers'] });
  await userEvent.click(screen.getByLabelText('customers.tsv'));
  expect(configuration()).toEqual({ datasetIds: ['next'] });
});

test('numeric null fill preserves zero as a number and supports median and empty text fill', async () => {
  render(<Harness type="handle_null" config={{ rules: [{ column: 'amount', strategy: 'custom', customValue: '' }] }} />);
  fireEvent.change(screen.getByLabelText('Rule 1 fill value'), { target: { value: '0' } });
  expect(configuration().rules[0].customValue).toBe(0);
  await userEvent.selectOptions(screen.getByLabelText('Rule 1 column'), 'city');
  fireEvent.change(screen.getByLabelText('Rule 1 fill value'), { target: { value: '' } });
  expect(configuration().rules[0].customValue).toBe('');
  expect(screen.getByRole('option', { name: /median/i })).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText('Rule 1 null handling'), 'median');
  expect(configuration().rules[0].strategy).toBe('median');
});

test('replacement preserves empty strings and numeric zero', () => {
  render(<Harness type="replace_value" config={{ column: 'amount', oldValue: 1, newValue: 2 }} />);
  fireEvent.change(screen.getByLabelText('Old value'), { target: { value: '0' } });
  fireEvent.change(screen.getByLabelText('New value'), { target: { value: '' } });
  expect(configuration()).toEqual({ column: 'amount', oldValue: 0, newValue: '' });
});

test('filter controls show only type-relevant operators and reset incompatible operators on column change', async () => {
  const typedColumns = [
    { name: 'amount', type: 'float64' },
    { name: 'city', type: 'str' },
    { name: 'paid', type: 'bool' },
    { name: 'order_date', type: 'datetime' },
  ];
  render(<Harness type="filter_rows" columns={typedColumns}
    config={{ conditions: [{ column: 'amount', operator: 'greater_than', value: '' }] }} />);
  const opSelect = () => screen.getByLabelText('Rule 1 comparison');
  expect(within(opSelect()).getAllByRole('option').map((item) => item.value)).toEqual([
    'equals', 'not_equals', 'greater_than', 'less_than', 'greater_or_equal', 'less_or_equal',
  ]);
  expect(within(opSelect()).queryByRole('option', { name: 'Contains text' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Rule 1 comparison value'), { target: { value: '0' } });
  expect(configuration().conditions[0].value).toBe(0);

  await userEvent.selectOptions(screen.getByLabelText('Rule 1 column'), 'city');
  expect(opSelect()).toHaveValue('equals');
  expect(configuration().conditions[0]).toEqual({ column: 'city', operator: 'equals', value: '' });
  expect(within(opSelect()).getAllByRole('option').map((item) => item.value)).toEqual([
    'equals', 'contains', 'starts_with', 'ends_with',
  ]);
  await userEvent.selectOptions(opSelect(), 'contains');
  fireEvent.change(screen.getByLabelText('Rule 1 comparison value'), { target: { value: '[VIP]' } });
  expect(configuration().conditions[0].value).toBe('[VIP]');

  await userEvent.selectOptions(screen.getByLabelText('Rule 1 column'), 'paid');
  expect(opSelect()).toHaveValue('is_true');
  expect(within(opSelect()).getAllByRole('option').map((item) => item.value)).toEqual(['is_true', 'is_false']);
  expect(configuration().conditions[0]).toEqual({ column: 'paid', operator: 'is_true', value: null });
  expect(screen.queryByLabelText('Rule 1 comparison value')).not.toBeInTheDocument();

  await userEvent.selectOptions(screen.getByLabelText('Rule 1 column'), 'order_date');
  expect(opSelect()).toHaveValue('after');
  expect(within(opSelect()).getAllByRole('option').map((item) => item.value)).toEqual(['after', 'before', 'equals']);
  fireEvent.change(screen.getByLabelText('Rule 1 comparison value'), { target: { value: '2026-01-01' } });
  expect(configuration().conditions[0]).toEqual({ column: 'order_date', operator: 'after', value: '2026-01-01' });

  await userEvent.click(screen.getByRole('button', { name: 'Add rule' }));
  expect(screen.getByLabelText('Rule 2 column')).toHaveValue('amount');
  expect(screen.getByLabelText('Rule 2 comparison')).toHaveValue('equals');
});

test('filter controls warn when a referenced column is unavailable at the step', () => {
  render(<Harness type="filter_rows" config={{ conditions: [{ column: 'removed_col', operator: 'equals', value: 'x' }] }} />);
  expect(screen.getByText('Selected column is unavailable at this step.')).toBeInTheDocument();
});

test('rule controls add uniquely labelled fields and respect the advertised rule limit', async () => {
  render(<Harness type="cast_type" config={{ conversions: [] }} capabilities={{ limits: { maxRules: 2 } }} />);
  await userEvent.click(screen.getByRole('button', { name: 'Add rule' }));
  await userEvent.click(screen.getByRole('button', { name: 'Add rule' }));
  expect(screen.getByLabelText('Rule 1 column')).toBeInTheDocument();
  expect(screen.getByLabelText('Rule 2 column')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add rule' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Remove rule 1' }));
  expect(configuration().conversions).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Add rule' })).toBeEnabled();
});

test('type and string choices allow only str, int, float, date and never boolean', () => {
  const { unmount } = render(<Harness type="cast_type" config={{ conversions: [{ column: 'amount', toType: 'float' }] }} />);
  const defaultTarget = screen.getByLabelText('Rule 1 target type');
  expect(within(defaultTarget).getAllByRole('option').map((item) => item.value)).toEqual(['str', 'int', 'float', 'date']);
  expect(within(defaultTarget).queryByRole('option', { name: /boolean/i })).not.toBeInTheDocument();
  unmount();

  const { unmount: unmountFiltered } = render(<Harness type="cast_type" config={{ conversions: [{ column: 'amount', toType: 'float' }] }}
    capabilities={{ operations: { cast_type: { conversions: [{ toType: ['float', 'string', 'boolean', 'unknown_type'] }] } } }} />);
  const target = screen.getByLabelText('Rule 1 target type');
  expect(within(target).getAllByRole('option').map((item) => item.value)).toEqual(['str', 'float']);
  expect(within(target).queryByRole('option', { name: /boolean/i })).not.toBeInTheDocument();
  unmountFiltered();

  render(<Harness type="string_transform" config={{ rules: [{ column: 'city', trim: true, caseMode: 'none' }] }} />);
  expect(within(screen.getByLabelText('Rule 1 letter case')).getAllByRole('option').map((item) => item.value)).toEqual(['none', 'upper', 'lower', 'title']);
});

test('legacy string configuration becomes canonical rules after an edit', async () => {
  render(<Harness type="string_transform" config={{ columns: ['city'], trim: true, caseMode: 'lower' }} />);
  await userEvent.click(screen.getByLabelText('Rule 1: trim outer whitespace'));
  expect(configuration()).toEqual({ rules: [{ column: 'city', trim: false, caseMode: 'lower' }] });
});

test('deduplication compares selected columns or all columns and supports keep first or last', async () => {
  render(<Harness type="drop_duplicates" config={{ rules: [{ allColumns: true, columns: [], keep: 'first' }] }} />);
  await userEvent.selectOptions(screen.getByLabelText('Rule 1 duplicate row to keep'), 'last');
  expect(configuration().rules[0]).toEqual({ allColumns: true, columns: [], keep: 'last' });
  await userEvent.click(screen.getByLabelText('Rule 1: compare all columns'));
  await userEvent.click(screen.getByLabelText('amount'));
  expect(configuration().rules[0]).toEqual({ allColumns: false, columns: ['order_id', 'amount'], keep: 'last' });
  await userEvent.click(screen.getByLabelText('Rule 1: compare all columns'));
  expect(configuration().rules[0]).toEqual({ allColumns: true, columns: [], keep: 'last' });
});

test('column selection preserves output order and date format restricts picker to date columns', async () => {
  const { unmount } = render(<Harness type="select_columns" config={{ selectedColumns: [] }} />);
  await userEvent.click(screen.getByLabelText('city'));
  await userEvent.click(screen.getByLabelText('order_id'));
  expect(configuration().selectedColumns).toEqual(['city', 'order_id']);
  unmount();

  const { unmount: unmountDate } = render(<Harness type="format_datetime"
    columns={[...columns, { name: 'order_date', type: 'datetime' }]}
    config={{ column: 'order_date', inputFormat: 'auto', outputFormat: 'YYYY-MM-DD' }} />);
  const dateSelect = screen.getByLabelText('Date column');
  expect(within(dateSelect).getAllByRole('option').map((item) => item.value)).toEqual(['', 'order_date']);
  expect(within(dateSelect).queryByRole('option', { name: 'city' })).not.toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText('Date input format'), 'DD/MM/YYYY');
  await userEvent.selectOptions(screen.getByLabelText('Date output format'), 'ISO_8601');
  expect(configuration().inputFormat).toBe('DD/MM/YYYY');
  expect(configuration().outputFormat).toBe('ISO_8601');
  expect(screen.getByText(/Auto-detect parses mixed date formats/)).toBeInTheDocument();
  unmountDate();

  render(<Harness type="format_datetime" config={{ column: 'city', inputFormat: 'auto', outputFormat: 'YYYY-MM-DD' }} />);
  expect(screen.getByText('No date columns are available at this step.')).toBeInTheDocument();
});

test('merge columns configures selected columns, new name, and separator', async () => {
  render(<Harness type="merge_columns" config={{ columns: ['order_id'], newColumnName: 'label', separator: ' ' }} />);
  await userEvent.click(screen.getByLabelText('city'));
  fireEvent.change(screen.getByLabelText('New column name'), { target: { value: 'order_city' } });
  fireEvent.change(screen.getByLabelText('Separator'), { target: { value: ' - ' } });
  expect(configuration()).toEqual({ columns: ['order_id', 'city'], newColumnName: 'order_city', separator: ' - ' });
});

test('join with a single loaded source disables file selection and instructs the user to add another file', () => {
  render(<Harness type="join" config={{ datasetId: '', on: '', how: 'left' }} sources={[sources[0]]} />);
  expect(screen.getByLabelText('File to join')).toBeDisabled();
  expect(screen.getByText('Add another source file to select a file to join.')).toHaveAttribute('role', 'status');
});

test('concat append order supports HTML5 drag-and-drop reordering', () => {
  render(<Harness type="concat" config={{ datasetIds: ['customers', 'next'] }} />);
  const orderList = screen.getByRole('list', { name: 'Append order' });
  const items = within(orderList).getAllByRole('listitem');
  expect(items[0]).toHaveAttribute('draggable', 'true');
  fireEvent.dragStart(items[0], { dataTransfer: { setData: jest.fn(), effectAllowed: 'move' } });
  fireEvent.dragOver(items[1], { dataTransfer: { dropEffect: 'move' } });
  fireEvent.drop(items[1], { dataTransfer: { getData: () => 'customers' } });
  fireEvent.dragEnd(items[0]);
  expect(configuration()).toEqual({ datasetIds: ['next', 'customers'] });
});

test('datetime filter opens calendar dialog for after, before, and equals while rejecting arbitrary text', async () => {
  const typedColumns = [{ name: 'order_date', type: 'datetime' }];
  render(<Harness type="filter_rows" columns={typedColumns}
    config={{ conditions: [{ column: 'order_date', operator: 'after', value: '2026-06-01' }] }} />);
  const valueInput = screen.getByLabelText('Rule 1 comparison value');
  await userEvent.click(valueInput);
  const dialog = screen.getByRole('dialog', { name: 'Choose date and time' });
  await userEvent.click(within(dialog).getByRole('button', { name: '12' }));
  expect(configuration().conditions[0].value).toBe('2026-06-12');

  await userEvent.selectOptions(screen.getByLabelText('Rule 1 comparison'), 'equals');
  await userEvent.type(screen.getByLabelText('Rule 1 comparison value'), 'bad');
  expect(configuration().conditions[0].value).toBe('2026-06-12');
  expect(screen.getByText('Use the calendar or enter YYYY-MM-DD or YYYY-MM-DD HH:mm:ss.')).toHaveAttribute('role', 'status');
});

test('column checks provide Select all, Clear, and search filter when more than 6 columns exist', async () => {
  const manyCols = Array.from({ length: 8 }, (_, idx) => ({ name: `col_${idx + 1}`, type: 'str' }));
  render(<Harness type="select_columns" columns={manyCols} config={{ selectedColumns: [] }} />);
  const searchInput = screen.getByLabelText('Filter Columns to keep');
  await userEvent.type(searchInput, 'col_7');
  expect(screen.getByLabelText('col_7')).toBeInTheDocument();
  expect(screen.queryByLabelText('col_1')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Select all' }));
  expect(configuration().selectedColumns).toEqual(['col_7']);
  await userEvent.clear(searchInput);
  await userEvent.click(screen.getByRole('button', { name: 'Select all' }));
  expect(configuration().selectedColumns).toHaveLength(8);
  await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
  expect(configuration().selectedColumns).toEqual([]);
});

test('adding multiple drop_duplicates rules creates independent rule objects', async () => {
  render(<Harness type="drop_duplicates" config={{ rules: [{ allColumns: true, columns: [], keep: 'first' }] }} />);
  await userEvent.click(screen.getByRole('button', { name: 'Add rule' }));
  await userEvent.selectOptions(screen.getByLabelText('Rule 2 duplicate row to keep'), 'last');
  await userEvent.click(screen.getByLabelText('Rule 2: compare all columns'));
  expect(configuration().rules[0]).toEqual({ allColumns: true, columns: [], keep: 'first' });
  expect(configuration().rules[1]).toEqual({ allColumns: false, columns: ['order_id'], keep: 'last' });
});

test('column checks disables Select all when search matches zero columns', async () => {
  const manyCols = Array.from({ length: 8 }, (_, idx) => ({ name: `col_${idx + 1}`, type: 'str' }));
  render(<Harness type="select_columns" columns={manyCols} config={{ selectedColumns: [] }} />);
  const searchInput = screen.getByLabelText('Filter Columns to keep');

  await userEvent.type(searchInput, 'nonexistent');
  expect(screen.getByText('No columns match “nonexistent”.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Select all' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();

  await userEvent.clear(searchInput);
  expect(screen.getByRole('button', { name: 'Select all' })).toBeEnabled();
});

test('removing rule 1 in filter_rows does not leak datetime rejection hint onto shifted rule 2', async () => {
  const typedColumns = [{ name: 'order_date', type: 'datetime' }];
  render(
    <Harness
      type="filter_rows"
      columns={typedColumns}
      config={{
        conditions: [
          { column: 'order_date', operator: 'after', value: '' },
          { column: 'order_date', operator: 'before', value: '' },
        ],
      }}
    />,
  );

  await userEvent.type(screen.getByLabelText('Rule 1 comparison value'), 'bad');
  expect(screen.getByText('Use the calendar or enter YYYY-MM-DD or YYYY-MM-DD HH:mm:ss.')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Remove rule 1' }));
  expect(screen.queryByText('Use the calendar or enter YYYY-MM-DD or YYYY-MM-DD HH:mm:ss.')).not.toBeInTheDocument();
});
