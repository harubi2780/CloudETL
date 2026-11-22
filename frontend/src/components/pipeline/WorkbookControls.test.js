import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import AppliedStepsPanel from './AppliedStepsPanel';
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

test('combine tab shows accessible multi-file guidance and quick Add source button until 2+ sources are loaded', () => {
  const capabilities = { operations: Object.fromEntries(operations.map((operation) => [operation.type, {}])) };
  const onOpenSources = jest.fn();
  const { rerender } = render(
    <WorkbookToolbar capabilities={capabilities} sourceCount={1} onAddStep={jest.fn()} onOpenSources={onOpenSources} />,
  );

  fireEvent.click(screen.getByRole('button', { name: 'Combine' }));
  const joinBtn = screen.getByRole('button', { name: 'Add Join tables step' });
  const concatBtn = screen.getByRole('button', { name: 'Add Append rows step' });
  expect(joinBtn).toHaveAttribute('aria-describedby', 'combine-source-requirement');
  expect(concatBtn).toHaveAttribute('aria-describedby', 'combine-source-requirement');
  expect(screen.getByRole('status')).toHaveTextContent('Add another source file (at least 2 files required) to join tables or append rows.');

  const addSourceBtn = screen.getByRole('button', { name: 'Add source' });
  expect(addSourceBtn).toHaveAttribute('data-source-picker-trigger', 'true');
  fireEvent.click(addSourceBtn);
  expect(onOpenSources).toHaveBeenCalledTimes(1);

  rerender(<WorkbookToolbar capabilities={capabilities} sourceCount={2} onAddStep={jest.fn()} onOpenSources={onOpenSources} />);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add Join tables step' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Add Append rows step' })).toBeEnabled();
});

test('source tabs support HTML5 drag-and-drop and Alt+Arrow reordering with focus retention', () => {
  function ReorderableTabs({ disabled = false }) {
    const [tabSources, setTabSources] = useState([
      { id: 'one', filename: 'orders.csv' },
      { id: 'two', filename: 'people.tsv' },
      { id: 'three', filename: 'extra.csv' },
    ]);
    const handleReorder = (from, to) => {
      setTabSources((items) => {
        const next = [...items];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        return next;
      });
    };
    return (
      <SourceTabs
        sources={tabSources}
        activeId="one"
        primaryId="one"
        onSelect={jest.fn()}
        onAdd={jest.fn()}
        onReorder={handleReorder}
        disabled={disabled}
      />
    );
  }

  const { rerender } = render(<ReorderableTabs />);
  expect(screen.getByRole('button', { name: 'Add source sheet' })).toHaveAttribute('data-source-picker-trigger', 'true');

  const getTabs = () => screen.getAllByRole('tab');
  expect(getTabs()[0]).toHaveAttribute('draggable', 'true');

  fireEvent.dragStart(getTabs()[0], { dataTransfer: { setData: jest.fn(), effectAllowed: 'move' } });
  expect(getTabs()[0]).toHaveClass('is-dragging');
  fireEvent.dragOver(getTabs()[2], { dataTransfer: { dropEffect: 'move' } });
  expect(getTabs()[2]).toHaveClass('is-drop-target');
  fireEvent.drop(getTabs()[2], { dataTransfer: { getData: () => 'one' } });
  fireEvent.dragEnd(getTabs()[2]);

  expect(getTabs().map((tab) => tab.textContent)).toEqual([
    expect.stringContaining('people.tsv'),
    expect.stringContaining('extra.csv'),
    expect.stringContaining('orders.csv'),
  ]);

  const movedTab = screen.getByRole('tab', { name: /orders\.csv/ });
  movedTab.focus();
  fireEvent.keyDown(movedTab, { key: 'ArrowLeft', altKey: true });
  expect(getTabs().map((tab) => tab.textContent)).toEqual([
    expect.stringContaining('people.tsv'),
    expect.stringContaining('orders.csv'),
    expect.stringContaining('extra.csv'),
  ]);
  expect(screen.getByRole('tab', { name: /orders\.csv/ })).toHaveFocus();

  // Bounds guard at start
  fireEvent.keyDown(getTabs()[0], { key: 'ArrowLeft', altKey: true });
  expect(getTabs()[0]).toHaveTextContent(/people\.tsv/);

  // Disabled blocks drag and Alt+Arrow reorder, and still prevents default browser navigation
  rerender(<ReorderableTabs disabled />);
  expect(getTabs()[0]).toHaveAttribute('draggable', 'false');
  const blockedRight = fireEvent.keyDown(getTabs()[1], { key: 'ArrowRight', altKey: true });
  const blockedLeft = fireEvent.keyDown(getTabs()[1], { key: 'ArrowLeft', altKey: true });
  expect(blockedRight).toBe(false);
  expect(blockedLeft).toBe(false);
  expect(getTabs()[1]).toHaveTextContent(/orders\.csv/);
});

test('applied steps panel renders summaries, validation badges, and supports HTML5 drag-and-drop reordering', () => {
  const onReorder = jest.fn();
  const steps = [
    { id: 's1', type: 'select_columns', enabled: true, config: { selectedColumns: ['order_id'] } },
    { id: 's2', type: 'string_transform', enabled: true, config: { rules: [{ column: 'city', trim: true, caseMode: 'none' }] } },
  ];
  const schemas = {
    before: [
      [{ name: 'order_id', type: 'str' }, { name: 'city', type: 'str' }],
      [{ name: 'order_id', type: 'str' }],
    ],
    sourcesBefore: [sources, sources],
  };
  const validation = ['Step 2: a referenced column is missing or was removed earlier.'];

  const { rerender } = render(
    <AppliedStepsPanel
      steps={steps}
      activeId="s1"
      onSelect={jest.fn()}
      onToggle={jest.fn()}
      onRemove={jest.fn()}
      onMove={jest.fn()}
      onReorder={onReorder}
      onChange={jest.fn()}
      schemas={schemas}
      sources={sources}
      primaryId="one"
      capabilities={{ operations: { select_columns: {}, string_transform: {} }, limits: { maxRules: 50 } }}
      validation={validation}
    />,
  );

  expect(screen.getByText('Keep 1 column: order_id')).toBeInTheDocument();
  expect(screen.getByText('city (trim whitespace)')).toBeInTheDocument();
  expect(screen.getByLabelText('1 validation error')).toHaveTextContent('1');
  expect(screen.queryByText('Step 2: a referenced column is missing or was removed earlier.')).not.toBeInTheDocument();

  const inspector = screen.getByRole('complementary', { name: 'Pipeline settings' });
  const rows = within(inspector).getAllByRole('listitem');
  expect(rows[0]).toHaveAttribute('draggable', 'true');
  expect(rows[1]).toHaveAttribute('draggable', 'true');

  fireEvent.dragStart(rows[1], { dataTransfer: { setData: jest.fn(), effectAllowed: 'move' } });
  expect(rows[1]).toHaveClass('is-dragging');
  fireEvent.dragOver(rows[0], { dataTransfer: { dropEffect: 'move' } });
  expect(rows[0]).toHaveClass('is-drop-target');
  fireEvent.drop(rows[0], { dataTransfer: { getData: () => 's2' } });
  fireEvent.dragEnd(rows[0]);
  expect(onReorder).toHaveBeenCalledWith(1, 0);

  // Same-index drop does not fire onReorder
  onReorder.mockClear();
  fireEvent.dragStart(rows[0], { dataTransfer: { setData: jest.fn(), effectAllowed: 'move' } });
  fireEvent.drop(rows[0], { dataTransfer: { getData: () => 's1' } });
  expect(onReorder).not.toHaveBeenCalled();

  rerender(
    <AppliedStepsPanel
      steps={steps}
      activeId="s1"
      onSelect={jest.fn()}
      onToggle={jest.fn()}
      onRemove={jest.fn()}
      onMove={jest.fn()}
      onReorder={onReorder}
      onChange={jest.fn()}
      schemas={schemas}
      sources={sources}
      primaryId="one"
      capabilities={{ operations: { select_columns: {}, string_transform: {} }, limits: { maxRules: 50 } }}
      validation={validation}
      disabled
    />,
  );
  expect(within(inspector).getAllByRole('listitem')[0]).toHaveAttribute('draggable', 'false');
});

test('applied steps panel resets local step config state when switching steps and ignores foreign drag kinds', () => {
  const onReorder = jest.fn();
  const manyCols = Array.from({ length: 8 }, (_, idx) => ({ name: `col_${idx + 1}`, type: 'str' }));
  const steps = [
    { id: 's1', type: 'select_columns', enabled: true, config: { selectedColumns: [] } },
    { id: 's2', type: 'select_columns', enabled: true, config: { selectedColumns: ['col_1'] } },
    { id: 's3', type: 'filter_rows', enabled: true, config: { conditions: [{ column: 'order_date', operator: 'after', value: '2026-01-01' }] } },
    { id: 's4', type: 'filter_rows', enabled: true, config: { conditions: [{ column: 'order_date', operator: 'before', value: '2026-12-31' }] } },
  ];
  const colsWithDate = [...manyCols, { name: 'order_date', type: 'datetime' }];
  const schemas = {
    before: [colsWithDate, colsWithDate, colsWithDate, colsWithDate],
    sourcesBefore: [sources, sources, sources, sources],
  };

  function StepSwitcher() {
    const [activeId, setActiveId] = useState('s1');
    return (
      <AppliedStepsPanel
        steps={steps}
        activeId={activeId}
        onSelect={setActiveId}
        onToggle={jest.fn()}
        onRemove={jest.fn()}
        onMove={jest.fn()}
        onReorder={onReorder}
        onChange={jest.fn()}
        schemas={schemas}
        sources={sources}
        primaryId="one"
        capabilities={{ operations: { select_columns: {}, filter_rows: {} }, limits: { maxRules: 50 } }}
      />
    );
  }

  render(<StepSwitcher />);
  fireEvent.change(screen.getByLabelText('Filter Columns to keep'), { target: { value: 'col_7' } });
  expect(screen.queryByLabelText('col_2')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /^2\s*Select columns/ }));
  expect(screen.getByLabelText('Filter Columns to keep')).toHaveValue('');
  expect(screen.getByLabelText('col_2')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /^3\s*Filter rows/ }));
  fireEvent.change(screen.getByLabelText('Rule 1 comparison value'), { target: { value: 'bad' } });
  expect(screen.getByRole('status')).toHaveTextContent('Use the calendar');

  fireEvent.click(screen.getByRole('button', { name: /^4\s*Filter rows/ }));
  expect(screen.queryByRole('status')).not.toBeInTheDocument();

  // Foreign drag kind dropped onto an applied step is ignored
  const inspector = screen.getByRole('complementary', { name: 'Pipeline settings' });
  const rows = within(inspector).getAllByRole('listitem');
  fireEvent.drop(rows[0], {
    dataTransfer: {
      getData: (type) => (type === 'application/x-cloudetl-drag' ? 'source-tab' : 's2'),
    },
  });
  expect(onReorder).not.toHaveBeenCalled();
});
