import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import datasetsApi from '../api/datasets';
import etlApi from '../api/etl';
import { operations } from '../lib/pipeline/workflow';
import { navigate } from '../navigation';
import PipelinesPage from './PipelinesPage';

jest.mock('../api/datasets', () => ({ __esModule: true, default: { list: jest.fn() } }));
jest.mock('../api/etl', () => ({
  __esModule: true,
  default: { capabilities: jest.fn(), dataset: jest.fn(), preview: jest.fn(), submit: jest.fn(), getRun: jest.fn() },
}));
jest.mock('../navigation', () => ({ ...jest.requireActual('../navigation'), navigate: jest.fn() }));

const sourceId = '10000000-0000-0000-0000-000000000001';
const customerId = '10000000-0000-0000-0000-000000000002';
const thirdId = '10000000-0000-0000-0000-000000000003';
const storageId = '10000000-0000-0000-0000-000000000004';
const runId = '20000000-0000-0000-0000-000000000001';
const orders = { id: sourceId, filename: 'orders.csv', format: 'csv', size_bytes: 500, uploaded_at: '2026-11-15T00:00:00Z' };
const customers = { ...orders, id: customerId, filename: 'customers.tsv', format: 'tsv', size_bytes: 200 };
const third = { ...orders, id: thirdId, filename: 'extra.csv', size_bytes: 100 };
const storageOnly = { ...orders, id: storageId, filename: 'archive.json', format: 'json' };
const columns = [{ name: 'order_id', type: 'str' }, { name: 'city', type: 'str' }, { name: 'amount', type: 'float64' }];
const preview = {
  columns,
  rows: Array.from({ length: 10 }, (_, index) => ({ order_id: `ORD${index + 1}`, city: `City ${index + 1}`, amount: index * 100 })),
  final_rows: 12,
};
const capabilities = () => ({
  operations: Object.fromEntries(operations.map(({ type }) => [type, {}])),
  inputFormats: ['csv', 'tsv'], outputFormats: ['parquet', 'csv', 'tsv', 'json', 'xlsx'],
  limits: { maxSources: 6, maxSteps: 50, maxRules: 50, maxCombinedInputBytes: 26214400 },
});
const library = (datasets = [orders, customers, third, storageOnly], extra = {}) => ({
  datasets, page: 1, total_pages: 1, total_count: datasets.length, ...extra,
});
const sourceSearch = `?datasets=${sourceId}`;

function addOperation(type) {
  const group = ['select_columns', 'cast_type'].includes(type) ? 'Columns'
    : type === 'filter_rows' ? 'Filter' : ['join', 'concat'].includes(type) ? 'Combine' : 'Clean';
  fireEvent.click(screen.getByRole('button', { name: group, exact: true }));
  fireEvent.click(screen.getByRole('button', { name: `Add ${operations.find((operation) => operation.type === type).label} step` }));
}

function openLibrary() {
  fireEvent.click(screen.getByRole('button', { name: /^Sources \(/ }));
}

function selectStep(index, label) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${index}\\s*${label}`) }));
}

async function ready(search = sourceSearch) {
  const view = render(<PipelinesPage search={search} />);
  await screen.findByText(/First 10 of 12 rows · Original data/);
  await waitFor(() => expect(within(screen.getByRole('toolbar', { name: 'Transformations' })).getAllByRole('button')[0]).toBeEnabled());
  return view;
}

beforeEach(() => {
  jest.resetAllMocks();
  etlApi.capabilities.mockResolvedValue(capabilities());
  datasetsApi.list.mockResolvedValue(library());
  etlApi.dataset.mockImplementation(async (id) => ({ dataset: [orders, customers, third, storageOnly].find((item) => item.id === id) }));
  etlApi.preview.mockImplementation(async (id) => ({ preview: id === customerId
    ? { columns: [{ name: 'order_id', type: 'str' }, { name: 'customer_tier', type: 'str' }], rows: [{ order_id: 'ORD1', customer_tier: 'VIP' }], final_rows: 1 }
    : preview }));
  etlApi.submit.mockResolvedValue({ run: { id: runId, status: 'queued' } });
});

test('a selected numeric cell pre-fills a repeatable replacement without changing source rows', async () => {
  await ready();
  fireEvent.click(screen.getByRole('cell', { name: '0' }));
  addOperation('replace_value');
  expect(screen.getByRole('heading', { name: 'Configure step 1' })).toHaveFocus();
  expect(screen.getByLabelText('Replace in column')).toHaveValue('amount');
  expect(screen.getByLabelText('Old value')).toHaveValue(0);
  expect(screen.getByRole('cell', { name: '0' })).toBeInTheDocument();
  expect(etlApi.submit).not.toHaveBeenCalled();
});

test('extracts actual URL source metadata and shows ten original rows without simulated transformations', async () => {
  render(<PipelinesPage search={sourceSearch} />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading pipeline tools');
  expect(await screen.findByRole('heading', { name: 'Source preview: orders.csv' })).toBeInTheDocument();
  expect(await screen.findByRole('cell', { name: 'ORD10' })).toBeInTheDocument();
  expect(etlApi.dataset).toHaveBeenCalledWith(sourceId, { signal: expect.any(AbortSignal) });
  expect(etlApi.preview).toHaveBeenCalledWith(sourceId, { signal: expect.any(AbortSignal) });
  const table = screen.getByRole('table');
  expect(within(table).getAllByRole('row')).toHaveLength(11);
  expect(within(table).getByRole('columnheader', { name: /amount/ })).toHaveTextContent('float64');
  fireEvent.click(screen.getByText('Preview details'));
  expect(screen.getByText(/Data shown above is the original source/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Run pipeline' })).toBeEnabled();
});

test('loads the source selector and permits CSV/TSV while keeping other uploaded formats unavailable', async () => {
  let finishLibrary;
  datasetsApi.list.mockImplementationOnce(() => new Promise((resolve) => { finishLibrary = resolve; }));
  render(<PipelinesPage />);
  await screen.findByRole('button', { name: 'Sources (0)' });
  openLibrary();
  expect(screen.getByText('Loading saved datasets…')).toBeInTheDocument();
  await act(async () => { finishLibrary(library()); });
  expect(screen.getByRole('button', { name: 'Add source archive.json' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Add source orders.csv' }));
  expect(await screen.findByRole('cell', { name: 'ORD1' })).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Source library' })).not.toBeInTheDocument();
  expect(screen.getByText('Starting dataset')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Run pipeline' })).toBeEnabled();
  openLibrary();
  expect(screen.getByRole('button', { name: 'Add source orders.csv' })).toHaveTextContent('Selected');
});

test('dataset list errors can retry and paginated sources use the requested page', async () => {
  datasetsApi.list.mockRejectedValueOnce({ message: 'Dataset list unavailable.' });
  datasetsApi.list.mockResolvedValueOnce(library([orders], { total_pages: 2, total_count: 2 }));
  datasetsApi.list.mockResolvedValueOnce(library([customers], { page: 2, total_pages: 2, total_count: 2 }));
  render(<PipelinesPage />);
  await screen.findByRole('button', { name: 'Sources (0)' });
  openLibrary();
  expect(screen.getByRole('alert')).toHaveTextContent('Dataset list unavailable.');
  fireEvent.click(screen.getByRole('button', { name: 'Retry dataset list' }));
  expect(await screen.findByRole('button', { name: 'Add source orders.csv' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Next datasets' }));
  expect(await screen.findByRole('button', { name: 'Add source customers.tsv' })).toBeInTheDocument();
  expect(datasetsApi.list).toHaveBeenLastCalledWith(2, { signal: expect.any(AbortSignal) });
  expect(screen.getByRole('button', { name: 'Next datasets' })).toBeDisabled();
});

test('retrying the saved source library preserves the edited pipeline and steps', async () => {
  datasetsApi.list.mockRejectedValueOnce({ message: 'Dataset list unavailable.' }).mockResolvedValueOnce(library());
  await ready();
  fireEvent.change(screen.getByLabelText('Pipeline name'), { target: { value: 'Keep my draft' } });
  addOperation('drop_duplicates');
  openLibrary();
  fireEvent.click(screen.getByRole('button', { name: 'Retry dataset list' }));
  await screen.findByRole('button', { name: 'Add source customers.tsv' });
  expect(screen.getByLabelText('Pipeline name')).toHaveValue('Keep my draft');
  expect(screen.getByLabelText('Enable step 1')).toBeChecked();
  expect(etlApi.capabilities).toHaveBeenCalledTimes(1);
});

test('source preview failure blocks submission and retries extraction', async () => {
  etlApi.preview.mockRejectedValueOnce({ message: 'Source cannot be read.' });
  etlApi.preview.mockResolvedValueOnce({ preview });
  render(<PipelinesPage search={sourceSearch} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Source cannot be read.');
  expect(screen.getByRole('button', { name: 'Run pipeline' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Add Clean text step' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry preview' }));
  expect(await screen.findByRole('cell', { name: 'ORD10' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Run pipeline' })).toBeEnabled();
  expect(etlApi.preview).toHaveBeenCalledTimes(2);
});

test('capability loading failures retry and unauthorized requests expire the session', async () => {
  const expired = jest.fn();
  etlApi.capabilities.mockRejectedValueOnce({ status: 401, message: 'Please sign in.' });
  etlApi.capabilities.mockResolvedValueOnce(capabilities());
  render(<PipelinesPage search={sourceSearch} onSessionExpired={expired} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Please sign in.');
  expect(expired).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByRole('cell', { name: 'ORD1' })).toBeInTheDocument();
});

test('only server-advertised operations appear in the builder', async () => {
  const caps = capabilities();
  caps.operations = { string_transform: {}, select_columns: {} };
  etlApi.capabilities.mockResolvedValue(caps);
  await ready();
  expect(screen.getByRole('button', { name: 'Add Clean text step' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Add Remove duplicates step' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Columns', exact: true }));
  expect(screen.getByRole('button', { name: 'Add Select columns step' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Add Convert data type step' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Combine', exact: true }));
  expect(screen.queryByRole('button', { name: 'Add Join tables step' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Filter', exact: true }));
  expect(screen.queryByRole('button', { name: 'Add Filter rows step' })).not.toBeInTheDocument();
});

test('configures, reorders, disables and removes steps while submitting their actual configuration', async () => {
  await ready();
  addOperation('string_transform');
  fireEvent.change(screen.getByLabelText('Rule 1 column'), { target: { value: 'city' } });
  fireEvent.change(screen.getByLabelText('Rule 1 letter case'), { target: { value: 'lower' } });
  addOperation('replace_value');
  fireEvent.change(screen.getByLabelText('Replace in column'), { target: { value: 'city' } });
  fireEvent.change(screen.getByLabelText('Old value'), { target: { value: 'HCM' } });
  fireEvent.change(screen.getByLabelText('New value'), { target: { value: 'Ho Chi Minh' } });
  fireEvent.click(screen.getByRole('button', { name: 'Move step 2 up' }));
  expect(screen.getByRole('button', { name: /^1\s*Replace values/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^2\s*Clean text/ })).toBeInTheDocument();
  selectStep(2, 'Clean text');
  fireEvent.click(screen.getByLabelText('Enable step 2'));
  selectStep(1, 'Replace values');
  fireEvent.click(screen.getByRole('button', { name: 'Remove step 1' }));
  expect(within(screen.getByRole('complementary', { name: 'Pipeline settings' })).queryByRole('button', { name: /Replace values/ })).not.toBeInTheDocument();
  selectStep(1, 'Clean text');
  expect(screen.getByLabelText('Enable step 1')).not.toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Run pipeline' }));
  await waitFor(() => expect(etlApi.submit).toHaveBeenCalledTimes(1));
  expect(etlApi.submit).toHaveBeenCalledWith({
    schemaVersion: 1, name: 'Data cleaning pipeline', datasetId: sourceId,
    steps: [{ type: 'string_transform', enabled: false, config: { rules: [{ column: 'city', trim: true, caseMode: 'lower' }] } }],
  });
});

test('joins and appends selected files in one ordered JSON pipeline and navigates to the actual run ID', async () => {
  await ready(`?datasets=${sourceId},${customerId},${thirdId}`);
  fireEvent.change(screen.getByLabelText('Pipeline name'), { target: { value: 'Joined customer orders' } });
  addOperation('join');
  expect(screen.getByLabelText('File to join')).toHaveValue(customerId);
  expect(screen.getByLabelText('Shared join column')).toHaveValue('order_id');
  fireEvent.change(screen.getByLabelText('Rows to retain'), { target: { value: 'inner' } });
  addOperation('concat');
  const appendFiles = screen.getByRole('group', { name: 'Files to append' });
  fireEvent.click(within(appendFiles).getByLabelText('customers.tsv'));
  expect(within(appendFiles).getByLabelText('extra.csv')).toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Run pipeline' }));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith(`/dashboard/runs/${runId}`));
  expect(etlApi.submit).toHaveBeenCalledWith({ schemaVersion: 1, name: 'Joined customer orders', datasetId: sourceId,
    steps: [
      { type: 'join', enabled: true, config: { datasetId: customerId, on: 'order_id', how: 'inner' } },
      { type: 'concat', enabled: true, config: { datasetIds: [thirdId] } },
    ],
  });
});

test('selected files remain blocked until used by an enabled join or append step', async () => {
  await ready(`?datasets=${sourceId},${customerId}`);
  expect(screen.getByText('Some selected sources are unused. Add a Join or Append step, or remove them.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Run pipeline' })).toBeDisabled();
  addOperation('join');
  expect(screen.getByRole('button', { name: 'Run pipeline' })).toBeEnabled();
  fireEvent.click(screen.getByLabelText('Enable step 1'));
  expect(screen.getByRole('button', { name: 'Run pipeline' })).toBeDisabled();
  fireEvent.click(screen.getByRole('tab', { name: 'customers.tsv' }));
  fireEvent.click(screen.getByRole('button', { name: 'Remove source customers.tsv' }));
  expect(screen.getByRole('button', { name: 'Run pipeline' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Remove step 1' }));
  expect(screen.getByRole('button', { name: 'Run pipeline' })).toBeEnabled();
  expect(etlApi.submit).not.toHaveBeenCalled();
});

test('dropping a referenced column blocks submission until the dependent step moves before it', async () => {
  await ready();
  addOperation('select_columns');
  addOperation('string_transform');
  fireEvent.change(screen.getByLabelText('Rule 1 column'), { target: { value: 'city' } });
  selectStep(1, 'Select columns');
  fireEvent.click(within(screen.getByRole('group', { name: 'Columns to keep' })).getByLabelText('city'));
  expect(screen.getByText('Step 2: a referenced column is missing or was removed earlier.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Run pipeline' })).toBeDisabled();
  selectStep(2, 'Clean text');
  expect(within(screen.getByRole('region', { name: 'Step settings' })).getByText('a referenced column is missing or was removed earlier.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Move step 2 up' }));
  expect(screen.queryByText('Step 2: a referenced column is missing or was removed earlier.')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Run pipeline' })).toBeEnabled();
});

test('API rejection preserves the draft, shows field errors, and prevents duplicate submissions', async () => {
  let rejectFirst;
  etlApi.submit.mockImplementationOnce(() => new Promise((resolve, reject) => { rejectFirst = reject; }));
  etlApi.submit.mockResolvedValueOnce({ run: { id: runId, status: 'queued' } });
  await ready();
  fireEvent.change(screen.getByLabelText('Pipeline name'), { target: { value: 'Keep my draft' } });
  addOperation('replace_value');
  fireEvent.change(screen.getByLabelText('Replace in column'), { target: { value: 'city' } });
  fireEvent.change(screen.getByLabelText('Old value'), { target: { value: 'old' } });
  fireEvent.change(screen.getByLabelText('New value'), { target: { value: 'new' } });
  const submit = screen.getByRole('button', { name: 'Run pipeline' });
  fireEvent.click(submit);
  fireEvent.click(submit);
  expect(etlApi.submit).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Submitting pipeline…' })).toBeDisabled();
  await act(async () => { rejectFirst({ message: 'Pipeline rejected.', fields: { 'steps.0.config': ['Check the replacement.'] } }); });
  expect(screen.getByRole('alert')).toHaveTextContent('Pipeline rejected.');
  expect(screen.getByRole('alert')).toHaveTextContent('steps.0.config: Check the replacement.');
  expect(screen.getByLabelText('Pipeline name')).toHaveValue('Keep my draft');
  expect(screen.getByLabelText('Old value')).toHaveValue('old');
  expect(screen.getByLabelText('New value')).toHaveValue('new');
  expect(navigate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Run pipeline' }));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith(`/dashboard/runs/${runId}`));
  expect(etlApi.submit.mock.calls[1][0]).toEqual(etlApi.submit.mock.calls[0][0]);
});

test('reuses the saved configuration and loads sources referenced by disabled steps', async () => {
  const configuration = { schemaVersion: 1, name: 'Reusable draft', datasetId: sourceId, steps: [
    { type: 'join', config: { datasetId: customerId, on: 'order_id', how: 'left' }, enabled: false },
  ] };
  etlApi.getRun.mockResolvedValue({ run: { id: runId, configuration } });
  await ready(`?run=${runId}`);
  expect(etlApi.getRun).toHaveBeenCalledWith(runId, { signal: expect.any(AbortSignal) });
  expect(etlApi.dataset).toHaveBeenCalledWith(customerId, { signal: expect.any(AbortSignal) });
  expect(screen.getByLabelText('Pipeline name')).toHaveValue('Reusable draft');
  expect(screen.getByLabelText('Enable step 1')).not.toBeChecked();
  expect(screen.getByLabelText('Rows to retain')).toHaveValue('left');
});

test('rejects malformed dataset identifiers before requesting metadata', async () => {
  render(<PipelinesPage search="?datasets=../../private.csv" />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Choose valid datasets within the source limit.');
  expect(etlApi.dataset).not.toHaveBeenCalled();
  expect(etlApi.preview).not.toHaveBeenCalled();
});

test('aborts initial source extraction when the builder unmounts', async () => {
  let finishPreview;
  etlApi.preview.mockImplementationOnce(() => new Promise((resolve) => { finishPreview = resolve; }));
  const { unmount } = render(<PipelinesPage search={sourceSearch} />);
  await screen.findByText('Extracting the first ten rows…');
  const signal = etlApi.preview.mock.calls[0][1].signal;
  unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => { finishPreview({ preview }); });
});

test('a selected source column prefills a clean-text step without changing the source preview', async () => {
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Select column B: city' }));
  expect(screen.getByText('1 column selected')).toBeInTheDocument();
  addOperation('string_transform');
  expect(screen.getByLabelText('Rule 1 column')).toHaveValue('city');
  expect(screen.getByRole('cell', { name: 'City 1' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Run pipeline' }));
  await waitFor(() => expect(etlApi.submit).toHaveBeenCalledTimes(1));
  expect(etlApi.submit.mock.calls[0][0].steps).toEqual([
    { type: 'string_transform', enabled: true, config: { rules: [{ column: 'city', trim: true, caseMode: 'none' }] } },
  ]);
});

test('multiple selected columns prefill type conversion and column-selection steps', async () => {
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Select column B: city' }));
  fireEvent.click(screen.getByRole('button', { name: 'Select column C: amount' }), { ctrlKey: true });
  expect(screen.getByText('2 columns selected')).toBeInTheDocument();
  addOperation('cast_type');
  expect(screen.getByLabelText('Rule 1 column')).toHaveValue('city');
  expect(screen.getByLabelText('Rule 2 column')).toHaveValue('amount');
  addOperation('select_columns');
  const checks = screen.getByRole('group', { name: 'Columns to keep' });
  expect(within(checks).getByLabelText('city')).toBeChecked();
  expect(within(checks).getByLabelText('amount')).toBeChecked();
  expect(within(checks).getByLabelText('order_id')).not.toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Run pipeline' }));
  await waitFor(() => expect(etlApi.submit).toHaveBeenCalledTimes(1));
  expect(etlApi.submit.mock.calls[0][0].steps).toEqual([
    { type: 'cast_type', enabled: true, config: { conversions: [{ column: 'city', toType: 'string' }, { column: 'amount', toType: 'string' }] } },
    { type: 'select_columns', enabled: true, config: { selectedColumns: ['city', 'amount'] } },
  ]);
});

test('a stale header selection cannot reference a column dropped from the projected schema', async () => {
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Select column B: city' }));
  addOperation('select_columns');
  const checks = screen.getByRole('group', { name: 'Columns to keep' });
  fireEvent.click(within(checks).getByLabelText('city'));
  fireEvent.click(within(checks).getByLabelText('order_id'));
  addOperation('cast_type');
  expect(screen.getByLabelText('Rule 1 column')).toHaveValue('order_id');
  expect(screen.queryByLabelText('Rule 2 column')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Run pipeline' })).toBeEnabled();
});

test('without a header selection steps use valid starting schema defaults', async () => {
  await ready();
  addOperation('drop_duplicates');
  expect(screen.getByLabelText('Rule 1: compare all columns')).toBeChecked();
  addOperation('string_transform');
  expect(screen.getByLabelText('Rule 1 column')).toHaveValue('order_id');
});

test('source sheet keyboard navigation and starting-source selection update the submitted pipeline', async () => {
  await ready(`?datasets=${sourceId},${customerId},${thirdId}`);
  const orderTab = screen.getByRole('tab', { name: /orders.csv/ });
  const customerTab = screen.getByRole('tab', { name: 'customers.tsv' });
  const extraTab = screen.getByRole('tab', { name: 'extra.csv' });
  fireEvent.keyDown(orderTab, { key: 'ArrowRight' });
  expect(customerTab).toHaveFocus();
  expect(customerTab).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('heading', { name: 'Source preview: customers.tsv' })).toBeInTheDocument();
  fireEvent.keyDown(customerTab, { key: 'End' });
  expect(extraTab).toHaveFocus();
  fireEvent.keyDown(extraTab, { key: 'Home' });
  expect(orderTab).toHaveFocus();
  fireEvent.keyDown(orderTab, { key: 'ArrowLeft' });
  expect(extraTab).toHaveFocus();
  fireEvent.click(customerTab);
  fireEvent.click(screen.getByRole('button', { name: 'Use as starting dataset' }));
  expect(screen.getByText('Starting dataset')).toBeInTheDocument();
  expect(customerTab).toHaveAccessibleName(/Starting dataset/);
  addOperation('concat');
  fireEvent.click(screen.getByRole('button', { name: 'Run pipeline' }));
  await waitFor(() => expect(etlApi.submit).toHaveBeenCalledTimes(1));
  expect(etlApi.submit.mock.calls[0][0]).toMatchObject({ datasetId: customerId,
    steps: [{ type: 'concat', enabled: true, config: { datasetIds: [sourceId, thirdId] } }],
  });
});

test('Escape closes the source library and restores focus to its trigger', async () => {
  await ready();
  const trigger = screen.getByRole('button', { name: 'Sources (1)' });
  fireEvent.click(trigger);
  const library = screen.getByRole('region', { name: 'Source library' });
  expect(within(library).getByRole('heading', { name: 'Add saved datasets' })).toHaveFocus();
  fireEvent.keyDown(library, { key: 'Escape' });
  expect(screen.queryByRole('region', { name: 'Source library' })).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
});
