import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import datasetsApi from '../api/datasets';
import etlApi from '../api/etl';
import { operations } from '../lib/pipeline/workflow';
import { navigate } from '../navigation';
import PipelinesPage from './PipelinesPage';

jest.mock('../api/datasets', () => ({ __esModule: true, default: { list: jest.fn() } }));
jest.mock('../api/etl', () => ({
  __esModule: true,
  default: {
    capabilities: jest.fn(), dataset: jest.fn(), preview: jest.fn(), submit: jest.fn(), getRun: jest.fn(),
    listPipelines: jest.fn(), getPipeline: jest.fn(), createPipeline: jest.fn(), updatePipeline: jest.fn(), deletePipeline: jest.fn(),
  },
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
  inputFormats: ['csv', 'tsv'], outputFormats: ['csv', 'tsv'],
  limits: { maxSources: 6, maxSteps: 50, maxRules: 50, maxCombinedInputBytes: 26214400 },
});
const library = (datasets = [orders, customers, third, storageOnly], extra = {}) => ({
  datasets, page: 1, total_pages: 1, total_count: datasets.length, ...extra,
});
const sourceSearch = `?datasets=${sourceId}`;

function addOperation(type) {
  const group = ['select_columns', 'merge_columns', 'cast_type'].includes(type) ? 'Columns'
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
  window.sessionStorage.clear();
  etlApi.capabilities.mockResolvedValue(capabilities());
  datasetsApi.list.mockResolvedValue(library());
  etlApi.dataset.mockImplementation(async (id) => ({ dataset: [orders, customers, third, storageOnly].find((item) => item.id === id) }));
  etlApi.preview.mockImplementation(async (id) => ({ preview: id === customerId
    ? { columns: [{ name: 'order_id', type: 'str' }, { name: 'customer_tier', type: 'str' }], rows: [{ order_id: 'ORD1', customer_tier: 'VIP' }], final_rows: 1 }
    : preview }));
  etlApi.submit.mockResolvedValue({ run: { id: runId, status: 'queued' } });
  etlApi.listPipelines.mockResolvedValue({ pipelines: [], page: 1, total_pages: 1, total_count: 0 });
  etlApi.createPipeline.mockResolvedValue({ pipeline: { id: '30000000-0000-0000-0000-000000000001', name: 'Data cleaning pipeline', configuration: {} } });
  etlApi.updatePipeline.mockResolvedValue({ pipeline: { id: '30000000-0000-0000-0000-000000000001', name: 'Data cleaning pipeline', configuration: {} } });
  etlApi.deletePipeline.mockResolvedValue({ deleted: true });
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
  expect(screen.getByRole('button', { name: 'Run pipeline' })).toBeDisabled();
  expect(screen.getByText('Add at least one enabled transformation step before running the pipeline.')).toBeVisible();
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
  expect(screen.getByRole('button', { name: 'Run pipeline' })).toBeDisabled();
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
  expect(screen.getByRole('button', { name: 'Add Clean text step' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Run pipeline' })).toBeDisabled();
  addOperation('string_transform');
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
  expect(screen.getByRole('button', { name: 'Run pipeline' })).toBeDisabled();
  fireEvent.click(screen.getByLabelText('Enable step 1'));
  expect(screen.getByRole('button', { name: 'Run pipeline' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Run pipeline' }));
  await waitFor(() => expect(etlApi.submit).toHaveBeenCalledTimes(1));
  expect(etlApi.submit).toHaveBeenCalledWith({
    schemaVersion: 1, name: 'Data cleaning pipeline', datasetId: sourceId,
    steps: [{ type: 'string_transform', enabled: true, config: { rules: [{ column: 'city', trim: true, caseMode: 'lower' }] } }],
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
  const customerTab = screen.getByRole('tab', { name: /customers\.tsv/ });
  expect(customerTab).toHaveTextContent('Unused');
  fireEvent.click(customerTab);
  fireEvent.click(screen.getByRole('button', { name: 'Remove source customers.tsv' }));
  expect(screen.getByRole('button', { name: 'Run pipeline' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Remove step 1' }));
  expect(screen.getByRole('button', { name: 'Run pipeline' })).toBeDisabled();
  expect(screen.getByText('Add at least one enabled transformation step before running the pipeline.')).toBeVisible();
  addOperation('string_transform');
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
    { type: 'cast_type', enabled: true, config: { conversions: [{ column: 'city', toType: 'str' }, { column: 'amount', toType: 'str' }] } },
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
  const orderTab = screen.getByRole('tab', { name: /orders\.csv/ });
  const customerTab = screen.getByRole('tab', { name: /customers\.tsv/ });
  const extraTab = screen.getByRole('tab', { name: /extra\.csv/ });
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

test('multi-select source picker adds multiple files and secondary tab supports pre-cleaning and quick combine', async () => {
  render(<PipelinesPage />);
  await screen.findByRole('button', { name: 'Sources (0)' });
  openLibrary();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select source orders.csv' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select source customers.tsv' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add selected (2)' }));
  await screen.findByRole('cell', { name: 'ORD1' });
  const customerTab = screen.getByRole('tab', { name: /customers\.tsv/ });
  expect(customerTab).toHaveTextContent('Unused');
  fireEvent.click(customerTab);
  await screen.findByRole('cell', { name: 'VIP' });
  addOperation('string_transform');
  fireEvent.click(screen.getByRole('button', { name: 'Join into start' }));
  expect(customerTab).toHaveTextContent('Used');
  fireEvent.click(screen.getByRole('button', { name: 'Run pipeline' }));
  await waitFor(() => expect(etlApi.submit).toHaveBeenCalledTimes(1));
  expect(etlApi.submit.mock.calls[0][0].steps).toEqual([
    { type: 'string_transform', enabled: true, sourceId: customerId, config: { rules: [{ column: 'order_id', trim: true, caseMode: 'none' }] } },
    { type: 'join', enabled: true, config: { datasetId: customerId, on: 'order_id', how: 'left' } },
  ]);
});

test('saves, updates, lists, opens, and deletes saved pipelines', async () => {
  const savedId = '30000000-0000-0000-0000-000000000001';
  etlApi.createPipeline.mockResolvedValueOnce({ pipeline: { id: savedId, name: 'Saved orders', configuration: { schemaVersion: 1, name: 'Saved orders', datasetId: sourceId, steps: [] } } });
  etlApi.updatePipeline.mockResolvedValueOnce({ pipeline: { id: savedId, name: 'Saved orders v2', configuration: { schemaVersion: 1, name: 'Saved orders v2', datasetId: sourceId, steps: [] } } });
  etlApi.listPipelines.mockResolvedValue({ pipelines: [{ id: savedId, name: 'Saved orders v2', source_count: 1, step_count: 0 }], page: 1, total_pages: 1, total_count: 1 });
  await ready();
  fireEvent.change(screen.getByLabelText('Pipeline name'), { target: { value: 'Saved orders' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save pipeline' }));
  await screen.findByText('Saved "Saved orders".');
  expect(etlApi.createPipeline).toHaveBeenCalledWith({ schemaVersion: 1, name: 'Saved orders', datasetId: sourceId, steps: [] });
  fireEvent.change(screen.getByLabelText('Pipeline name'), { target: { value: 'Saved orders v2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
  await screen.findByText('Saved "Saved orders v2".');
  expect(etlApi.updatePipeline).toHaveBeenCalledWith(savedId, { schemaVersion: 1, name: 'Saved orders v2', datasetId: sourceId, steps: [] });
  fireEvent.click(screen.getByRole('button', { name: 'Saved', exact: true }));
  expect(await screen.findByText('Saved orders v2')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  expect(navigate).toHaveBeenCalledWith(`/dashboard/pipelines?pipeline=${savedId}`);
  fireEvent.click(screen.getByRole('button', { name: 'Saved', exact: true }));
  await screen.findByText('Saved orders v2');
  fireEvent.click(screen.getByRole('button', { name: 'Delete saved pipeline Saved orders v2' }));
  await waitFor(() => expect(etlApi.deletePipeline).toHaveBeenCalledWith(savedId));
});

test('loads a saved pipeline via ?pipeline= query parameter', async () => {
  const savedId = '30000000-0000-0000-0000-000000000009';
  etlApi.getPipeline.mockResolvedValueOnce({
    pipeline: {
      id: savedId,
      name: 'Loaded saved pipeline',
      configuration: { schemaVersion: 1, name: 'Loaded saved pipeline', datasetId: sourceId, steps: [{ type: 'join', enabled: true, config: { datasetId: customerId, on: 'order_id', how: 'left' } }] },
    },
  });
  await ready(`?pipeline=${savedId}`);
  expect(etlApi.getPipeline).toHaveBeenCalledWith(savedId, { signal: expect.any(AbortSignal) });
  expect(screen.getByLabelText('Pipeline name')).toHaveValue('Loaded saved pipeline');
  expect(screen.getByRole('button', { name: 'Save as new' })).toBeInTheDocument();
});

test('preserves draft sources and steps across navigation, isolates per user, and clears on New draft or submit', async () => {
  const userA = { id: 101, username: 'alice' };
  const userB = { id: 202, username: 'bob' };
  const view = render(<PipelinesPage search={sourceSearch} user={userA} />);
  await screen.findByText(/First 10 of 12 rows · Original data/);
  fireEvent.change(screen.getByLabelText('Pipeline name'), { target: { value: 'Preserved draft' } });
  addOperation('string_transform');
  addOperation('merge_columns');
  view.unmount();

  // Different user does not see userA's draft
  const { unmount: unmountOther } = render(<PipelinesPage search="" user={userB} />);
  await screen.findByRole('button', { name: 'Sources (0)' });
  expect(screen.getByLabelText('Pipeline name')).toHaveValue('Data cleaning pipeline');
  unmountOther();

  // Returning as userA with empty search restores sources, name, and steps
  const { unmount: unmountRestored } = render(<PipelinesPage search="" user={userA} />);
  await screen.findByText(/First 10 of 12 rows · Original data/);
  expect(screen.getByLabelText('Pipeline name')).toHaveValue('Preserved draft');
  expect(screen.getByRole('button', { name: /^1\s*Clean text/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^2\s*Merge columns/ })).toBeInTheDocument();

  // Submitting clears the draft
  fireEvent.click(screen.getByRole('button', { name: 'Run pipeline' }));
  await waitFor(() => expect(etlApi.submit).toHaveBeenCalledTimes(1));
  unmountRestored();

  const { unmount: unmountAfterSubmit } = render(<PipelinesPage search="" user={userA} />);
  await screen.findByRole('button', { name: 'Sources (0)' });
  expect(screen.getByLabelText('Pipeline name')).toHaveValue('Data cleaning pipeline');

  // New draft button also clears an active draft
  unmountAfterSubmit();
  const { unmount: unmountLoadedAgain } = render(<PipelinesPage search={sourceSearch} user={userA} />);
  await screen.findByText(/First 10 of 12 rows · Original data/);
  fireEvent.click(screen.getByRole('button', { name: 'New draft' }));
  expect(screen.getByRole('button', { name: 'Sources (0)' })).toBeInTheDocument();
  unmountLoadedAgain();
  render(<PipelinesPage search="" user={userA} />);
  await screen.findByRole('button', { name: 'Sources (0)' });
});

test('side-by-side split view renders multiple datasets simultaneously and scopes steps to the clicked pane', async () => {
  await ready(`?datasets=${sourceId},${customerId},${thirdId}`);
  const splitButton = screen.getByRole('button', { name: 'Compare side-by-side' });
  fireEvent.click(splitButton);
  expect(splitButton).toHaveAttribute('aria-pressed', 'true');
  const comparison = screen.getByLabelText('Side-by-side source comparison');
  expect(within(comparison).getByRole('heading', { name: 'Source preview: orders.csv' })).toBeInTheDocument();
  expect(within(comparison).getByRole('heading', { name: 'Source preview: customers.tsv' })).toBeInTheDocument();

  // Switch right comparison dataset to extra.csv, then back to customers.tsv
  fireEvent.change(screen.getByLabelText('Compare dataset'), { target: { value: thirdId } });
  expect(within(comparison).getByRole('heading', { name: 'Source preview: extra.csv' })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Compare dataset'), { target: { value: customerId } });
  await within(comparison).findByRole('cell', { name: 'VIP' });

  // Clicking a header in the right pane targets customers.tsv
  fireEvent.click(within(comparison).getByRole('button', { name: 'Select column B: customer_tier' }));
  addOperation('string_transform');
  addOperation('join');
  addOperation('concat');
  const concatGroup = screen.getByRole('group', { name: 'Files to append' });
  fireEvent.click(within(concatGroup).getByLabelText('customers.tsv'));
  fireEvent.click(screen.getByRole('button', { name: 'Run pipeline' }));
  await waitFor(() => expect(etlApi.submit).toHaveBeenCalledTimes(1));
  expect(etlApi.submit.mock.calls[0][0].steps).toEqual([
    { type: 'string_transform', enabled: true, sourceId: customerId, config: { rules: [{ column: 'customer_tier', trim: true, caseMode: 'none' }] } },
    { type: 'join', enabled: true, config: { datasetId: customerId, on: 'order_id', how: 'left' } },
    { type: 'concat', enabled: true, config: { datasetIds: [thirdId] } },
  ]);
});

test('all eleven ETL operations can be added and configured in the pipeline workspace', async () => {
  etlApi.preview.mockImplementation(async (id) => ({
    preview: id === customerId
      ? { columns: [{ name: 'order_id', type: 'str' }, { name: 'customer_tier', type: 'str' }], rows: [{ order_id: 'ORD1', customer_tier: 'VIP' }], final_rows: 1 }
      : { ...preview, columns: [...columns, { name: 'order_date', type: 'datetime' }] },
  }));
  await ready(`?datasets=${sourceId},${customerId}`);
  for (const { type } of operations) {
    addOperation(type);
  }
  const inspector = screen.getByRole('complementary', { name: 'Pipeline settings' });
  expect(within(inspector).getAllByRole('button', { name: /^\d+\s/ })).toHaveLength(11);
  expect(screen.getByRole('group', { name: 'Files to append' })).toBeInTheDocument();
  selectStep(2, 'Merge columns');
  expect(screen.getByLabelText('New column name')).toHaveValue('merged_column');
  selectStep(10, 'Join tables');
  expect(screen.getByLabelText('Shared join column')).toHaveValue('order_id');
  selectStep(7, 'Filter rows');
  expect(screen.getByLabelText('Rule 1 comparison')).toBeInTheDocument();
});

test('R2–R4 in builder: conditional date formatting, cast_type restrictions, and type-aware filtering', async () => {
  etlApi.preview.mockImplementation(async (id) => ({
    preview: id === customerId
      ? { columns: [{ name: 'order_id', type: 'str' }, { name: 'joined_at', type: 'datetime' }], rows: [{ order_id: 'ORD1', joined_at: '2026-01-01' }], final_rows: 1 }
      : preview,
  }));
  await ready(`?datasets=${sourceId},${customerId}`);
  expect(screen.queryByRole('button', { name: 'Add Format dates step' })).not.toBeInTheDocument();

  // Switching to secondary tab with a date column reveals Format dates
  fireEvent.click(screen.getByRole('tab', { name: /customers\.tsv/ }));
  expect(screen.getByRole('button', { name: 'Add Format dates step' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: /orders\.csv/ }));
  expect(screen.queryByRole('button', { name: 'Add Format dates step' })).not.toBeInTheDocument();

  // Casting a column to date reveals Format dates; casting it back to str hides it
  addOperation('cast_type');
  const targetType = screen.getByLabelText('Rule 1 target type');
  expect(within(targetType).getAllByRole('option').map((opt) => opt.value)).toEqual(['str', 'int', 'float', 'date']);
  expect(within(targetType).queryByRole('option', { name: /boolean/i })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Rule 1 column'), { target: { value: 'city' } });
  fireEvent.change(targetType, { target: { value: 'date' } });
  fireEvent.click(screen.getByRole('button', { name: 'Clean', exact: true }));
  expect(screen.getByRole('button', { name: 'Add Format dates step' })).toBeInTheDocument();

  // Filtering adapts operators when switching between string and numeric columns
  addOperation('filter_rows');
  const opSelect = () => screen.getByLabelText('Rule 1 comparison');
  expect(within(opSelect()).getAllByRole('option').map((opt) => opt.value)).toEqual(['equals', 'contains', 'starts_with', 'ends_with']);
  fireEvent.change(screen.getByLabelText('Rule 1 column'), { target: { value: 'amount' } });
  expect(within(opSelect()).getAllByRole('option').map((opt) => opt.value)).toEqual([
    'equals', 'not_equals', 'greater_than', 'less_than', 'greater_or_equal', 'less_or_equal',
  ]);
  expect(within(opSelect()).queryByRole('option', { name: 'Contains text' })).not.toBeInTheDocument();

  // Switching cast_type back to str hides Format dates again
  selectStep(1, 'Convert data type');
  fireEvent.change(screen.getByLabelText('Rule 1 target type'), { target: { value: 'str' } });
  fireEvent.click(screen.getByRole('button', { name: 'Clean', exact: true }));
  expect(screen.queryByRole('button', { name: 'Add Format dates step' })).not.toBeInTheDocument();
});

test('dragging and dropping applied steps resolves column dependency errors and submits updated order', async () => {
  await ready();
  addOperation('select_columns');
  addOperation('string_transform');
  fireEvent.change(screen.getByLabelText('Rule 1 column'), { target: { value: 'city' } });
  selectStep(1, 'Select columns');
  fireEvent.click(within(screen.getByRole('group', { name: 'Columns to keep' })).getByLabelText('city'));
  expect(screen.getByText('Step 2: a referenced column is missing or was removed earlier.')).toBeInTheDocument();
  expect(screen.getByLabelText('1 validation error')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Run pipeline' })).toBeDisabled();

  const inspector = screen.getByRole('complementary', { name: 'Pipeline settings' });
  const rows = within(inspector).getAllByRole('listitem');
  fireEvent.dragStart(rows[1], { dataTransfer: { setData: jest.fn(), effectAllowed: 'move' } });
  fireEvent.dragOver(rows[0], { dataTransfer: { dropEffect: 'move' } });
  fireEvent.drop(rows[0], { dataTransfer: { getData: () => 'step-2' } });
  fireEvent.dragEnd(rows[0]);

  expect(screen.queryByText('Step 2: a referenced column is missing or was removed earlier.')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('1 validation error')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Run pipeline' })).toBeEnabled();

  fireEvent.click(screen.getByRole('button', { name: 'Run pipeline' }));
  await waitFor(() => expect(etlApi.submit).toHaveBeenCalledTimes(1));
  expect(etlApi.submit.mock.calls[0][0].steps.map((step) => step.type)).toEqual(['string_transform', 'select_columns']);
});

test('dragging and dropping source tabs persists reordered sourceIds in draft storage while keeping primaryId independent', async () => {
  const userA = { id: 777, username: 'reorder-user' };
  const view = render(<PipelinesPage search={`?datasets=${sourceId},${customerId}`} user={userA} />);
  await screen.findByText(/First 10 of 12 rows · Original data/);

  const tabs = screen.getAllByRole('tab');
  expect(tabs[0]).toHaveTextContent(/orders\.csv/);
  expect(tabs[1]).toHaveTextContent(/customers\.tsv/);

  fireEvent.dragStart(tabs[1], { dataTransfer: { setData: jest.fn(), effectAllowed: 'move' } });
  fireEvent.dragOver(tabs[0], { dataTransfer: { dropEffect: 'move' } });
  fireEvent.drop(tabs[0], { dataTransfer: { getData: () => customerId } });
  fireEvent.dragEnd(tabs[0]);

  const reorderedTabs = screen.getAllByRole('tab');
  expect(reorderedTabs[0]).toHaveTextContent(/customers\.tsv/);
  expect(reorderedTabs[1]).toHaveTextContent(/orders\.csv/);
  expect(reorderedTabs[1]).toHaveAccessibleName(/Starting dataset/);

  view.unmount();
  render(<PipelinesPage search="" user={userA} />);
  await screen.findByText(/First 10 of 12 rows · Original data/);
  const restoredTabs = screen.getAllByRole('tab');
  expect(restoredTabs[0]).toHaveTextContent(/customers\.tsv/);
  expect(restoredTabs[1]).toHaveTextContent(/orders\.csv/);
});

test('clicking outside source library or saved drawer dismisses it without stealing focus or disrupting pipeline state', async () => {
  await ready();
  fireEvent.change(screen.getByLabelText('Pipeline name'), { target: { value: 'Keep edits' } });
  addOperation('string_transform');

  openLibrary();
  const libraryPanel = screen.getByRole('region', { name: 'Source library' });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select source customers.tsv' }));

  // Clicking inside source library keeps it open
  fireEvent.mouseDown(libraryPanel);
  fireEvent.click(libraryPanel);
  expect(screen.getByRole('region', { name: 'Source library' })).toBeInTheDocument();

  // Clicking + Add source trigger does not falsely dismiss
  const addSourceTabBtn = screen.getByRole('button', { name: 'Add source sheet' });
  fireEvent.mouseDown(addSourceTabBtn);
  fireEvent.click(addSourceTabBtn);
  expect(screen.getByRole('region', { name: 'Source library' })).toBeInTheDocument();

  // Clicking outside dismisses without stealing focus from the clicked element
  const nameInput = screen.getByLabelText('Pipeline name');
  nameInput.focus();
  fireEvent.mouseDown(nameInput);
  fireEvent.click(nameInput);
  expect(screen.queryByRole('region', { name: 'Source library' })).not.toBeInTheDocument();
  expect(nameInput).toHaveFocus();
  expect(nameInput).toHaveValue('Keep edits');
  expect(screen.getByLabelText('Enable step 1')).toBeChecked();

  // Re-opening shows librarySelected was cleared
  openLibrary();
  expect(screen.getByRole('checkbox', { name: 'Select source customers.tsv' })).not.toBeChecked();

  // Escape works even when focus moved outside the source library
  nameInput.focus();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('region', { name: 'Source library' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Sources (1)' })).toHaveFocus();

  // Saved pipelines drawer also dismisses on outside click
  fireEvent.click(screen.getByRole('button', { name: 'Saved', exact: true }));
  expect(await screen.findByRole('region', { name: 'Saved pipelines' })).toBeInTheDocument();
  fireEvent.mouseDown(nameInput);
  fireEvent.click(nameInput);
  expect(screen.queryByRole('region', { name: 'Saved pipelines' })).not.toBeInTheDocument();
});

test('removing active middle step selects adjacent step and removing split-view right source cleanly resets view', async () => {
  await ready(`?datasets=${sourceId},${customerId}`);
  addOperation('string_transform');
  addOperation('replace_value');
  selectStep(1, 'Clean text');
  fireEvent.click(screen.getByRole('button', { name: 'Remove step 1' }));
  expect(screen.getByRole('heading', { name: 'Configure step 1' })).toBeInTheDocument();
  expect(screen.getByLabelText('Replace in column')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Compare side-by-side' }));
  const comparison = screen.getByLabelText('Side-by-side source comparison');
  fireEvent.click(within(comparison).getByRole('button', { name: 'Remove source customers.tsv' }));
  expect(screen.queryByLabelText('Side-by-side source comparison')).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Source preview: orders.csv' })).toBeInTheDocument();
});

test('cross-widget DnD between source tabs and concat append order does not collide', async () => {
  await ready(`?datasets=${sourceId},${customerId},${thirdId}`);
  addOperation('concat');

  const transferStore = {};
  const makeTransfer = () => ({
    effectAllowed: 'move',
    dropEffect: 'move',
    setData: (type, val) => { transferStore[type] = val; },
    getData: (type) => transferStore[type] || '',
  });

  const appendList = screen.getByRole('list', { name: 'Append order' });
  const appendItems = within(appendList).getAllByRole('listitem');
  const tabs = screen.getAllByRole('tab');

  // Drag concat item (customers.tsv) and drop onto SourceTabs[0] (orders.csv) -> SourceTabs unchanged
  fireEvent.dragStart(appendItems[0], { dataTransfer: makeTransfer() });
  fireEvent.drop(tabs[0], { dataTransfer: makeTransfer() });
  fireEvent.dragEnd(appendItems[0]);
  expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
    expect.stringContaining('orders.csv'),
    expect.stringContaining('customers.tsv'),
    expect.stringContaining('extra.csv'),
  ]);

  // Drag SourceTabs[2] (extra.csv) and drop onto concat appendItems[0] (customers.tsv) -> concat order unchanged
  fireEvent.dragStart(tabs[2], { dataTransfer: makeTransfer() });
  fireEvent.drop(appendItems[0], { dataTransfer: makeTransfer() });
  fireEvent.dragEnd(tabs[2]);
  expect(within(screen.getByRole('list', { name: 'Append order' })).getAllByRole('listitem')[0]).toHaveTextContent(/customers\.tsv/);
});

test('Escape closes nested DateTimeFilterInput popover before closing open source library', async () => {
  etlApi.preview.mockResolvedValue({
    preview: {
      columns: [{ name: 'order_date', type: 'datetime' }],
      rows: Array.from({ length: 10 }, () => ({ order_date: '2026-06-15' })),
      final_rows: 12,
    },
  });
  await ready();
  addOperation('filter_rows');

  openLibrary();
  expect(screen.getByRole('region', { name: 'Source library' })).toBeInTheDocument();

  const dtInput = screen.getByLabelText('Rule 1 comparison value');
  fireEvent.focus(dtInput);
  expect(screen.getByRole('dialog', { name: 'Choose date and time' })).toBeInTheDocument();

  // First Escape closes only the calendar dialog, leaving Source library open
  fireEvent.keyDown(dtInput, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: 'Choose date and time' })).not.toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Source library' })).toBeInTheDocument();

  // Second Escape closes Source library and restores focus to Sources (1)
  fireEvent.keyDown(dtInput, { key: 'Escape' });
  expect(screen.queryByRole('region', { name: 'Source library' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Sources (1)' })).toHaveFocus();
});
