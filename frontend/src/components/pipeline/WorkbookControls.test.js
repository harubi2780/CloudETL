import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import SourceTabs from './SourceTabs';
import WorkbookToolbar from './WorkbookToolbar';
import { operations } from '../../lib/pipeline/workflow';

const sources = [{ id: 'one', filename: 'orders.csv' }, { id: 'two', filename: 'people.tsv' }];

test('source tabs keep the starting file identifiable and support arrow/Home/End navigation', () => {
  function Sheets() {
    const [activeId, setActive] = useState('one');
    return <SourceTabs sources={sources} activeId={activeId} primaryId="one" onSelect={setActive} onAdd={() => {}} />;
  }
  render(<Sheets />);
  const first = screen.getByRole('tab', { name: /orders.csv/ });
  const second = screen.getByRole('tab', { name: /people\.tsv/ });
  expect(second).toHaveTextContent('Unused');
  expect(first).toHaveAttribute('aria-selected', 'true');
  expect(within(first).getByLabelText('Starting dataset')).toBeInTheDocument();
  first.focus();
  fireEvent.keyDown(first, { key: 'ArrowRight' });
  expect(second).toHaveFocus();
  expect(second).toHaveAttribute('aria-selected', 'true');
  fireEvent.keyDown(second, { key: 'Home' });
  expect(first).toHaveFocus();
  fireEvent.keyDown(first, { key: 'End' });
  expect(second).toHaveFocus();
  fireEvent.keyDown(second, { key: 'ArrowRight' });
  expect(first).toHaveFocus();
});

test('add source action is separate from source tabs and split toggle fires when enabled', () => {
  const add = jest.fn();
  const toggleSplit = jest.fn();
  render(<SourceTabs sources={sources} activeId="one" primaryId="one" canSplit splitView={false} onToggleSplit={toggleSplit} onSelect={jest.fn()} onAdd={add} />);
  fireEvent.click(screen.getByRole('button', { name: 'Add source sheet' }));
  expect(add).toHaveBeenCalledTimes(1);
  const splitButton = screen.getByRole('button', { name: 'Compare side-by-side' });
  expect(splitButton).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(splitButton);
  expect(toggleSplit).toHaveBeenCalledTimes(1);
});

test('ribbon actions are grouped, capability constrained, and disabled until source requirements are met', () => {
  const onAddStep = jest.fn();
  const capabilities = { operations: Object.fromEntries(operations.map((operation) => [operation.type, {}])) };
  const { rerender } = render(<WorkbookToolbar capabilities={capabilities} sourceCount={1} onAddStep={onAddStep} selectedColumns={['city']} />);
  expect(screen.getByText('1 column selected')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Add Clean text step' }));
  expect(onAddStep).toHaveBeenCalledWith('string_transform');
  fireEvent.click(screen.getByRole('button', { name: 'Combine' }));
  expect(screen.getByRole('button', { name: 'Add Join tables step' })).toBeDisabled();
  rerender(<WorkbookToolbar capabilities={capabilities} sourceCount={2} onAddStep={onAddStep} />);
  fireEvent.click(screen.getByRole('button', { name: 'Add Join tables step' }));
  expect(onAddStep).toHaveBeenLastCalledWith('join');
  rerender(<WorkbookToolbar capabilities={{ operations: { concat: {} } }} sourceCount={2} onAddStep={onAddStep} disabled />);
  expect(screen.queryByRole('button', { name: 'Add Join tables step' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add Append rows step' })).toBeDisabled();
});

test('date formatting action is hidden unless a date column is available', () => {
  const capabilities = { operations: Object.fromEntries(operations.map((operation) => [operation.type, {}])) };
  const { rerender } = render(<WorkbookToolbar capabilities={capabilities} sourceCount={1} onAddStep={jest.fn()}
    columns={[{ name: 'order_id', type: 'string' }, { name: 'amount', type: 'float' }]} />);
  expect(screen.queryByRole('button', { name: 'Add Format dates step' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add Clean text step' })).toBeInTheDocument();

  rerender(<WorkbookToolbar capabilities={capabilities} sourceCount={1} onAddStep={jest.fn()}
    columns={[{ name: 'order_id', type: 'string' }, { name: 'order_date', type: 'datetime' }]} />);
  expect(screen.getByRole('button', { name: 'Add Format dates step' })).toBeInTheDocument();

  rerender(<WorkbookToolbar capabilities={capabilities} sourceCount={1} onAddStep={jest.fn()} hasDateColumns={false} />);
  expect(screen.queryByRole('button', { name: 'Add Format dates step' })).not.toBeInTheDocument();
});
