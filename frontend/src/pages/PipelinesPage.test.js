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
  fireEvent.change(screen.getByLabelText('Add operation'), { target: { value: type } });
}

async function ready(search = sourceSearch) {
  const view = render(<PipelinesPage search={search} />);
  await screen.findByText('First 10 of 12 rows. Types are inferred; phone numbers may lose leading zeros and mixed dates may need review.');
  await waitFor(() => expect(screen.getByLabelText('Add operation')).toBeEnabled());
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
  expect(screen.getByText(/Data shown above is the original source/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Run pipeline' })).toBeEnabled();
});

test('loads the source selector and permits CSV/TSV while keeping other uploaded formats unavailable', async () => {
  let finishLibrary;
  datasetsApi.list.mockImplementationOnce(() => new Promise((resolve) => { finishLibrary = resolve; }));
  render(<PipelinesPage />);
  await screen.findByLabelText('Add operation');
  fireEvent.click(screen.getByText('Add saved datasets'));
  expect(screen.getByText('Loading saved datasets…')).toBeInTheDocument();
  await act(async () => { finishLibrary(library()); });
  expect(screen.getByRole('button', { name: 'Add source archive.json' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Add source orders.csv' }));
  expect(await screen.findByRole('cell', { name: 'ORD1' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add source orders.csv' })).toHaveTextContent('Selected');
  expect(screen.getByLabelText('Starting dataset')).toBeChecked();
  expect(screen.getByRole('button', { name: 'Run pipeline' })).toBeEnabled();
});

test('dataset list errors can retry and paginated sources use the requested page', async () => {
  datasetsApi.list.mockRejectedValueOnce({ message: 'Dataset list unavailable.' });
  datasetsApi.list.mockResolvedValueOnce(library([orders], { total_pages: 2, total_count: 2 }));
  datasetsApi.list.mockResolvedValueOnce(library([customers], { page: 2, total_pages: 2, total_count: 2 }));
  render(<PipelinesPage />);
  await screen.findByLabelText('Add operation');
  fireEvent.click(screen.getByText('Add saved datasets'));
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
  fireEvent.click(screen.getByText('Add saved datasets'));
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
  expect(screen.getByLabelText('Add operation')).toBeDisabled();
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
  const operation = screen.getByLabelText('Add operation');
  expect(within(operation).getAllByRole('option')).toHaveLength(3);
  expect(within(operation).getByRole('option', { name: 'Clean text' })).toBeInTheDocument();
  expect(within(operation).queryByRole('option', { name: 'Join tables' })).not.toBeInTheDocument();
  expect(within(operation).queryByRole('option', { name: 'Filter rows' })).not.toBeInTheDocument();
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
  expect(screen.getByRole('button', { name: '1. Replace values' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '2. Clean text' })).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('Enable step 2'));
  fireEvent.click(screen.getByRole('button', { name: 'Remove step 1' }));
  expect(screen.queryByRole('button', { name: /Replace values/ })).not.toBeInTheDocument();
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
  fireEvent.click(screen.getByRole('button', { name: '1. Select columns' }));
  fireEvent.click(within(screen.getByRole('group', { name: 'Columns to keep' })).getByLabelText('city'));
  expect(screen.getByText('Step 2: a referenced column is missing or was removed earlier.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Run pipeline' })).toBeDisabled();
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
