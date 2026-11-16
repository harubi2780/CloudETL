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
  await userEvent.click(screen.getByLabelText('customers.tsv'));
  expect(configuration()).toEqual({ datasetIds: ['next'] });
});

test('numeric null fill preserves zero as a number and supports an empty text fill', async () => {
  render(<Harness type="handle_null" config={{ rules: [{ column: 'amount', strategy: 'custom', customValue: '' }] }} />);
  fireEvent.change(screen.getByLabelText('Rule 1 fill value'), { target: { value: '0' } });
  expect(configuration().rules[0].customValue).toBe(0);
  await userEvent.selectOptions(screen.getByLabelText('Rule 1 column'), 'city');
  fireEvent.change(screen.getByLabelText('Rule 1 fill value'), { target: { value: '' } });
  expect(configuration().rules[0].customValue).toBe('');
  expect(screen.queryByRole('option', { name: /median/i })).not.toBeInTheDocument();
});

test('replacement preserves empty strings and numeric zero', () => {
  render(<Harness type="replace_value" config={{ column: 'amount', oldValue: 1, newValue: 2 }} />);
  fireEvent.change(screen.getByLabelText('Old value'), { target: { value: '0' } });
  fireEvent.change(screen.getByLabelText('New value'), { target: { value: '' } });
  expect(configuration()).toEqual({ column: 'amount', oldValue: 0, newValue: '' });
});

test('numeric comparisons use numbers and literal text contains keeps text', async () => {
  render(<Harness type="filter_rows" config={{ conditions: [{ column: 'amount', operator: 'greater_than', value: '' }] }} />);
  fireEvent.change(screen.getByLabelText('Rule 1 comparison value'), { target: { value: '0' } });
  expect(configuration().conditions[0].value).toBe(0);
  await userEvent.selectOptions(screen.getByLabelText('Rule 1 comparison'), 'contains');
  fireEvent.change(screen.getByLabelText('Rule 1 comparison value'), { target: { value: '[VIP]' } });
  expect(configuration().conditions[0].value).toBe('[VIP]');
  expect(screen.queryByRole('option', { name: /is true/i })).not.toBeInTheDocument();
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

test('type and string choices are filtered to backend capabilities', () => {
  const { unmount } = render(<Harness type="cast_type" config={{ conversions: [{ column: 'amount', toType: 'float' }] }}
    capabilities={{ operations: { cast_type: { conversions: [{ toType: ['float', 'string', 'boolean'] }] } } }} />);
  const target = screen.getByLabelText('Rule 1 target type');
  expect(within(target).getAllByRole('option').map((item) => item.value)).toEqual(['float', 'string']);
  unmount();
  render(<Harness type="string_transform" config={{ rules: [{ column: 'city', trim: true, caseMode: 'none' }] }} />);
  expect(within(screen.getByLabelText('Rule 1 letter case')).getAllByRole('option').map((item) => item.value)).toEqual(['none', 'upper', 'lower']);
});

test('legacy string configuration becomes canonical rules after an edit', async () => {
  render(<Harness type="string_transform" config={{ columns: ['city'], trim: true, caseMode: 'lower' }} />);
  await userEvent.click(screen.getByLabelText('Rule 1: trim outer whitespace'));
  expect(configuration()).toEqual({ rules: [{ column: 'city', trim: false, caseMode: 'lower' }] });
});

test('deduplication compares selected columns or all columns and only keeps first', async () => {
  render(<Harness type="drop_duplicates" config={{ rules: [{ allColumns: true, columns: [], keep: 'first' }] }} />);
  expect(screen.getByText('Keeps the first exact match.')).toBeInTheDocument();
  await userEvent.click(screen.getByLabelText('Rule 1: compare all columns'));
  await userEvent.click(screen.getByLabelText('amount'));
  expect(configuration().rules[0]).toEqual({ allColumns: false, columns: ['order_id', 'amount'], keep: 'first' });
  await userEvent.click(screen.getByLabelText('Rule 1: compare all columns'));
  expect(configuration().rules[0]).toEqual({ allColumns: true, columns: [], keep: 'first' });
});

test('column selection preserves output order and date format uses automatic parsing', async () => {
  const { unmount } = render(<Harness type="select_columns" config={{ selectedColumns: [] }} />);
  await userEvent.click(screen.getByLabelText('city'));
  await userEvent.click(screen.getByLabelText('order_id'));
  expect(configuration().selectedColumns).toEqual(['city', 'order_id']);
  unmount();
  render(<Harness type="format_datetime" config={{ column: 'city', inputFormat: 'auto', outputFormat: 'YYYY-MM-DD' }} />);
  await userEvent.selectOptions(screen.getByLabelText('Date output format'), 'ISO_8601');
  expect(configuration().inputFormat).toBe('auto');
  expect(configuration().outputFormat).toBe('ISO_8601');
  expect(screen.getByText(/Unrecognized dates become missing/)).toBeInTheDocument();
});
