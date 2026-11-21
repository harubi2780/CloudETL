import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import etlApi from '../api/etl';
import RunsPage, { RunStatus } from './RunsPage';
import RunDetailPage from './RunDetailPage';
import ResultsPage from './ResultsPage';
import ResultsDetailPage from './ResultsDetailPage';

jest.mock('../api/etl', () => ({
  __esModule: true,
  default: {
    listRuns: jest.fn(),
    getRun: jest.fn(),
    rows: jest.fn(),
    runSourceRows: jest.fn(),
    capabilities: jest.fn(),
    download: jest.fn(),
    deleteResult: jest.fn(),
  },
}));

const runId = '10000000-0000-0000-0000-000000000001';
const secondId = '10000000-0000-0000-0000-000000000002';
const thirdId = '10000000-0000-0000-0000-000000000003';
const run = {
  id: runId, name: 'Customer cleanup', status: 'succeeded',
  created_at: '2026-11-15T10:00:00Z', started_at: '2026-11-15T10:00:02Z', finished_at: '2026-11-15T10:00:05Z',
  configuration: { datasetId: secondId, steps: [] },
  summary: { initial_rows: 3, final_rows: 2, dropped_rows: 1, added_rows: 0 }, error: null,
};
const listing = (runs = [], extra = {}) => ({ runs, page: 1, total_pages: 1, total_count: runs.length, ...extra });
const rowPage = (extra = {}) => ({
  rows: [{ name: 'Alice', amount: 0, paid: false, missing: null, empty: '' }],
  columns: [{ name: 'name', type: 'string' }, { name: 'amount', type: 'integer' }, { name: 'paid', type: 'boolean' }, { name: 'missing', type: 'string' }, { name: 'empty', type: 'string' }],
  page: 1, page_size: 25, total_pages: 1, total_count: 1, ...extra,
});
const sourceRowPage = (extra = {}) => ({
  dataset_id: secondId,
  filename: 'orders.csv',
  rows: [{ name: 'Raw Alice', amount: 10 }],
  columns: [{ name: 'name', type: 'str' }, { name: 'amount', type: 'int' }],
  page: 1, page_size: 25, total_pages: 1, total_count: 1, matches_snapshot: true, ...extra,
});

beforeEach(() => {
  jest.resetAllMocks();
  etlApi.listRuns.mockResolvedValue(listing());
  etlApi.getRun.mockResolvedValue({ run });
  etlApi.rows.mockResolvedValue(rowPage());
  etlApi.runSourceRows.mockResolvedValue(sourceRowPage());
  etlApi.capabilities.mockResolvedValue({ outputFormats: ['csv', 'tsv'] });
  etlApi.download.mockResolvedValue(undefined);
  etlApi.deleteResult.mockResolvedValue({ deleted: true });
});

afterEach(() => {
  jest.useRealTimers();
});

test('run status spins only while running and keeps queued and terminal states distinct', () => {
  const { rerender } = render(<RunStatus status="queued" />);
  expect(screen.getByText('Queued')).toBeInTheDocument();
  expect(screen.queryByTestId('status-spinner')).not.toBeInTheDocument();
  rerender(<RunStatus status="running" />);
  expect(screen.getByText('Running')).toBeInTheDocument();
  expect(screen.getByTestId('status-spinner')).toHaveAttribute('aria-hidden', 'true');
  for (const status of ['succeeded', 'failed']) {
    rerender(<RunStatus status={status} />);
    expect(screen.getByText(status === 'succeeded' ? 'Succeeded' : 'Failed')).toBeInTheDocument();
    expect(screen.queryByTestId('status-spinner')).not.toBeInTheDocument();
  }
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
});

test('loads real run history, pages it, and resets page when filtering', async () => {
  etlApi.listRuns.mockResolvedValueOnce(listing([run], { total_pages: 2, total_count: 2 }));
  etlApi.listRuns.mockResolvedValueOnce(listing([{ ...run, id: secondId, name: 'Second cleanup' }], { page: 2, total_pages: 2, total_count: 2 }));
  etlApi.listRuns.mockResolvedValueOnce(listing([]));
  render(<RunsPage />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading runs');
  expect(await screen.findByRole('rowheader', { name: 'Customer cleanup' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Customer cleanup' })).toHaveAttribute('href', `/dashboard/runs/${runId}`);
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(await screen.findByRole('rowheader', { name: 'Second cleanup' })).toBeInTheDocument();
  expect(etlApi.listRuns).toHaveBeenLastCalledWith({ page: 2, status: '', signal: expect.any(AbortSignal) });
  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'failed' } });
  expect(await screen.findByText('No runs with this status')).toBeInTheDocument();
  expect(etlApi.listRuns).toHaveBeenLastCalledWith({ page: 1, status: 'failed', signal: expect.any(AbortSignal) });
});

test('run history errors can retry and unauthorized responses expire the session', async () => {
  const expired = jest.fn();
  etlApi.listRuns.mockRejectedValueOnce({ message: 'Please sign in.', status: 401 });
  etlApi.listRuns.mockResolvedValueOnce(listing([run]));
  render(<RunsPage onSessionExpired={expired} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Please sign in.');
  expect(expired).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('rowheader', { name: 'Customer cleanup' })).toBeInTheDocument();
});

test('run history aborts pending requests and ignores late responses after unmount', async () => {
  let finish;
  etlApi.listRuns.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const { unmount } = render(<RunsPage />);
  const signal = etlApi.listRuns.mock.calls[0][0].signal;
  unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => { finish(listing([run])); });
});

test('result listing requests succeeded runs and exposes result links', async () => {
  etlApi.listRuns.mockResolvedValue(listing([run]));
  render(<ResultsPage />);
  expect(await screen.findByRole('rowheader', { name: 'Customer cleanup' })).toBeInTheDocument();
  expect(etlApi.listRuns).toHaveBeenCalledWith({ page: 1, status: 'succeeded', signal: expect.any(AbortSignal) });
  expect(screen.queryByLabelText('Status')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Customer cleanup' })).toHaveAttribute('href', `/dashboard/results/${runId}`);
});

test('empty completed results explain when results appear', async () => {
  render(<ResultsPage />);
  expect(await screen.findByText('No completed results yet')).toBeInTheDocument();
  expect(screen.getByText('Results appear here when a run succeeds.')).toBeInTheDocument();
});

test('polls queued and running runs and stops polling after success', async () => {
  jest.useFakeTimers();
  etlApi.getRun.mockResolvedValueOnce({ run: { ...run, status: 'queued', started_at: null, finished_at: null } });
  etlApi.getRun.mockResolvedValueOnce({ run: { ...run, status: 'running', finished_at: null } });
  etlApi.getRun.mockResolvedValueOnce({ run });
  const { unmount } = render(<RunDetailPage runId={runId} />);
  await screen.findByText('Queued');
  expect(screen.getByText('Queued')).toBeInTheDocument();
  expect(screen.queryByTestId('status-spinner')).not.toBeInTheDocument();
  expect(screen.getByText('Waiting for a worker')).toBeInTheDocument();
  await act(async () => { jest.advanceTimersByTime(2000); });
  expect(screen.getByText('Running')).toBeInTheDocument();
  expect(screen.getByTestId('status-spinner')).toBeInTheDocument();
  await act(async () => { jest.advanceTimersByTime(2000); });
  expect(screen.getByText('Result ready')).toBeInTheDocument();
  expect(screen.queryByTestId('status-spinner')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Submitted configuration')).not.toHaveAttribute('open');
  expect(screen.getByText('3s')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'View result' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Edit and resubmit' })).toHaveAttribute('href', `/dashboard/pipelines?run=${runId}`);
  expect(screen.getByRole('heading', { name: 'Pipeline steps' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Original vs. Result comparison' })).toBeInTheDocument();
  expect(await screen.findByRole('cell', { name: 'Alice' })).toBeInTheDocument();
  await act(async () => { jest.advanceTimersByTime(10000); });
  expect(etlApi.getRun).toHaveBeenCalledTimes(3);
  unmount();
});

test('pauses queued polling when hidden and resumes when visible', async () => {
  jest.useFakeTimers();
  etlApi.getRun.mockResolvedValue({ run: { ...run, status: 'queued', started_at: null, finished_at: null } });
  const original = Object.getOwnPropertyDescriptor(document, 'hidden');
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  const { unmount } = render(<RunDetailPage runId={runId} />);
  try {
    await screen.findByText('Queued');
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await act(async () => { jest.advanceTimersByTime(10000); });
    expect(etlApi.getRun).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(etlApi.getRun).toHaveBeenCalledTimes(2);
  } finally {
    unmount();
    if (original) Object.defineProperty(document, 'hidden', original);
    else delete document.hidden;
  }
});

test('failed run displays server error without polling or fabricated progress', async () => {
  jest.useFakeTimers();
  etlApi.getRun.mockResolvedValue({ run: { ...run, status: 'failed', summary: null, error: { code: 'invalid_column', message: 'A selected column is missing.' } } });
  const { unmount } = render(<RunDetailPage runId={runId} />);
  await screen.findByRole('alert');
  expect(screen.getByRole('alert')).toHaveTextContent('A selected column is missing.');
  expect(screen.getByRole('alert')).toHaveTextContent('invalid_column');
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  await act(async () => { jest.advanceTimersByTime(6000); });
  expect(etlApi.getRun).toHaveBeenCalledTimes(1);
  unmount();
});

test('a polling failure retains last status and pauses updates until retry', async () => {
  jest.useFakeTimers();
  etlApi.getRun.mockResolvedValueOnce({ run: { ...run, status: 'running', finished_at: null } });
  etlApi.getRun.mockRejectedValueOnce({ message: 'Connection lost.' });
  etlApi.getRun.mockResolvedValueOnce({ run });
  const { unmount } = render(<RunDetailPage runId={runId} />);
  await screen.findByText('Running');
  await act(async () => { jest.advanceTimersByTime(2000); });
  expect(screen.getByText('Running')).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Connection lost.');
  expect(screen.getByRole('status')).toHaveTextContent('Status updates are paused.');
  await act(async () => { jest.advanceTimersByTime(6000); });
  expect(etlApi.getRun).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name: 'Retry status' }));
  expect(await screen.findByText('Result ready')).toBeInTheDocument();
  unmount();
});

test('run status request errors offer retry and run changes abort old requests', async () => {
  etlApi.getRun.mockRejectedValueOnce({ message: 'Run unavailable.' });
  const { rerender } = render(<RunDetailPage runId={runId} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Run unavailable.');
  fireEvent.click(screen.getByRole('button', { name: 'Retry status' }));
  expect(await screen.findByText('Result ready')).toBeInTheDocument();
  const oldSignal = etlApi.getRun.mock.calls[1][1].signal;
  etlApi.getRun.mockResolvedValueOnce({ run: { ...run, id: secondId, name: 'Another run' } });
  rerender(<RunDetailPage runId={secondId} />);
  expect(await screen.findByRole('heading', { name: 'Another run' })).toBeInTheDocument();
  expect(oldSignal.aborted).toBe(true);
});

test('loads server-paginated result rows and distinguishes null, empty, zero and false', async () => {
  etlApi.rows.mockResolvedValueOnce(rowPage({ total_pages: 2, total_count: 26 }));
  etlApi.rows.mockResolvedValueOnce(rowPage({ rows: [{ name: 'Bob', amount: 3, paid: true, missing: null, empty: '' }], page: 2, total_pages: 2, total_count: 26 }));
  etlApi.rows.mockResolvedValueOnce(rowPage({ page_size: 50, total_count: 26 }));
  render(<ResultsDetailPage runId={runId} />);
  expect(await screen.findByRole('cell', { name: 'Alice' })).toBeInTheDocument();
  expect(screen.getByText('Rows 1–25 of 26. 5 columns.')).toBeInTheDocument();
  expect(screen.getByRole('cell', { name: '0' })).toBeInTheDocument();
  expect(screen.getByRole('cell', { name: 'false' })).toBeInTheDocument();
  expect(screen.getByLabelText('Null value')).toHaveTextContent('NULL');
  expect(screen.getByLabelText('Empty string')).toHaveTextContent('Empty string');
  expect(etlApi.rows).toHaveBeenCalledWith(runId, { page: 1, pageSize: 25, signal: expect.any(AbortSignal) });
  const resultNav = screen.getByRole('navigation', { name: 'Result row pages' });
  fireEvent.click(within(resultNav).getByRole('button', { name: 'Next' }));
  expect(await screen.findByRole('cell', { name: 'Bob' })).toBeInTheDocument();
  expect(screen.getByText('Rows 26–26 of 26. 5 columns.')).toBeInTheDocument();
  expect(etlApi.rows).toHaveBeenLastCalledWith(runId, { page: 2, pageSize: 25, signal: expect.any(AbortSignal) });
  fireEvent.change(screen.getByLabelText('Result rows per page'), { target: { value: '50' } });
  expect(await screen.findByRole('cell', { name: 'Alice' })).toBeInTheDocument();
  expect(etlApi.rows).toHaveBeenLastCalledWith(runId, { page: 1, pageSize: 50, signal: expect.any(AbortSignal) });
});

test('downloads the complete file using advertised formats and prevents duplicate clicks', async () => {
  let finish;
  etlApi.capabilities.mockResolvedValue({ outputFormats: ['csv', 'tsv'] });
  etlApi.download.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  render(<ResultsDetailPage runId={runId} />);
  await screen.findByRole('cell', { name: 'Alice' });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Download full result' })).toBeEnabled());
  const formats = screen.getByLabelText('File format');
  expect(formats).toHaveValue('csv');
  expect(within(formats).getAllByRole('option')).toHaveLength(2);
  expect(within(formats).queryByRole('option', { name: 'PARQUET' })).not.toBeInTheDocument();
  expect(within(formats).queryByRole('option', { name: 'XLSX' })).not.toBeInTheDocument();
  fireEvent.change(formats, { target: { value: 'tsv' } });
  const download = screen.getByRole('button', { name: 'Download full result' });
  fireEvent.click(download);
  fireEvent.click(download);
  expect(etlApi.download).toHaveBeenCalledTimes(1);
  expect(etlApi.download).toHaveBeenCalledWith(runId, 'tsv');
  expect(screen.getByRole('button', { name: 'Preparing download…' })).toBeDisabled();
  expect(screen.getByText('All rows, all pages.')).toBeInTheDocument();
  await act(async () => { finish(); });
  expect(screen.getByText('The full-file download was handed to your browser.')).toBeInTheDocument();
});

test('result download controls stay beside the heading instead of using a separate panel', async () => {
  render(<ResultsDetailPage runId={runId} />);
  await screen.findByRole('cell', { name: 'Alice' });
  const header = screen.getByLabelText('Result heading');
  expect(within(header).getByLabelText('File format')).toBeInTheDocument();
  expect(within(header).getByRole('button', { name: 'Download full result' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Download full result' })).not.toBeInTheDocument();
});

test('rows errors retry independently of available download formats', async () => {
  etlApi.rows.mockRejectedValueOnce({ message: 'Rows unavailable.' });
  etlApi.rows.mockResolvedValueOnce(rowPage());
  render(<ResultsDetailPage runId={runId} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Rows unavailable.');
  expect(screen.getByRole('button', { name: 'Download full result' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry rows' }));
  expect(await screen.findByRole('cell', { name: 'Alice' })).toBeInTheDocument();
});

test('format loading errors can retry and downloads report failures truthfully', async () => {
  etlApi.capabilities.mockRejectedValueOnce({ message: 'Formats unavailable.' });
  etlApi.capabilities.mockResolvedValueOnce({ outputFormats: ['csv'] });
  etlApi.download.mockRejectedValueOnce({ message: 'Download unavailable.' });
  render(<ResultsDetailPage runId={runId} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Formats unavailable.');
  expect(screen.getByRole('button', { name: 'Download full result' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry formats' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Download full result' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Download full result' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Download unavailable.');
  expect(screen.queryByText('The full-file download was handed to your browser.')).not.toBeInTheDocument();
});

test('incomplete results do not request rows or advertise download actions', async () => {
  etlApi.getRun.mockResolvedValue({ run: { ...run, status: 'failed', summary: null, error: { message: 'Source changed.' } } });
  render(<ResultsDetailPage runId={runId} />);
  expect(await screen.findByText('Result not ready')).toBeInTheDocument();
  expect(screen.getByText('Source changed.')).toBeInTheDocument();
  expect(etlApi.rows).not.toHaveBeenCalled();
  expect(etlApi.capabilities).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Download full result' })).not.toBeInTheDocument();
});

test('an empty successful result still offers full-file download and an honest empty table', async () => {
  etlApi.rows.mockResolvedValue(rowPage({ rows: [], total_count: 0 }));
  render(<ResultsDetailPage runId={runId} />);
  expect(await screen.findByText('No rows in this result.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Download full result' })).toBeEnabled();
  expect(within(screen.getByRole('navigation', { name: 'Result row pages' })).getByRole('button', { name: 'Next' })).toBeDisabled();
});

test('result changes abort old row requests and ignore a previous download completion', async () => {
  let finishDownload;
  etlApi.download.mockImplementationOnce(() => new Promise((resolve) => { finishDownload = resolve; }));
  const { rerender, unmount } = render(<ResultsDetailPage runId={runId} />);
  await screen.findByRole('cell', { name: 'Alice' });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Download full result' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Download full result' }));
  const oldRowsSignal = etlApi.rows.mock.calls[0][1].signal;
  etlApi.getRun.mockResolvedValueOnce({ run: { ...run, id: secondId, name: 'Another cleanup' } });
  etlApi.rows.mockResolvedValueOnce(rowPage({ rows: [{ name: 'Bob' }] }));
  rerender(<ResultsDetailPage runId={secondId} />);
  expect(await screen.findByRole('cell', { name: 'Bob' })).toBeInTheDocument();
  expect(oldRowsSignal.aborted).toBe(true);
  await act(async () => { finishDownload(); });
  expect(screen.queryByText('The full-file download was handed to your browser.')).not.toBeInTheDocument();
  unmount();
  expect(etlApi.rows.mock.calls[1][1].signal.aborted).toBe(true);
});

test('result file deletion requires confirmation and cancellation restores focus without deleting', async () => {
  render(<ResultsDetailPage runId={runId} />);
  await screen.findByRole('cell', { name: 'Alice' });
  const trigger = screen.getByRole('button', { name: 'Delete result file' });
  fireEvent.click(trigger);
  const confirmation = screen.getByRole('region', { name: 'Delete result file?' });
  expect(confirmation).toHaveTextContent('original source files remain saved');
  expect(etlApi.deleteResult).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Cancel deletion' })).toHaveFocus();
  expect(screen.getByRole('button', { name: 'Download full result' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel deletion' }));
  expect(screen.queryByRole('region', { name: 'Delete result file?' })).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  expect(etlApi.deleteResult).not.toHaveBeenCalled();
});

test('confirmed deletion prevents duplicate requests and removes only the result view', async () => {
  let finish;
  etlApi.deleteResult.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  render(<ResultsDetailPage runId={runId} />);
  await screen.findByRole('cell', { name: 'Alice' });
  const rowSignal = etlApi.rows.mock.calls[0][1].signal;
  fireEvent.click(screen.getByRole('button', { name: 'Delete result file' }));
  const confirm = screen.getByRole('button', { name: 'Confirm file deletion' });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(etlApi.deleteResult).toHaveBeenCalledTimes(1);
  expect(etlApi.deleteResult).toHaveBeenCalledWith(runId);
  expect(screen.getByRole('button', { name: 'Deleting result file…' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Cancel deletion' })).toBeDisabled();
  await act(async () => { finish({ deleted: true, warning: 'Stored file cleanup will be retried.' }); });
  expect(screen.getByRole('heading', { name: 'Result file removed' })).toHaveFocus();
  expect(screen.getByText('Result file deleted.')).toBeInTheDocument();
  expect(screen.getByText('Stored file cleanup will be retried.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Download full result' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Delete result file' })).not.toBeInTheDocument();
  expect(screen.queryByRole('cell', { name: 'Alice' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Run details' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Edit and resubmit' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Pipeline steps' })).toBeInTheDocument();
  expect(screen.getByText('Output rows')).toBeInTheDocument();
  expect(rowSignal.aborted).toBe(true);
});

test('deletion errors retain the file and confirmation for retry', async () => {
  etlApi.deleteResult.mockRejectedValueOnce({ message: 'Storage unavailable.' });
  render(<ResultsDetailPage runId={runId} />);
  await screen.findByRole('cell', { name: 'Alice' });
  fireEvent.click(screen.getByRole('button', { name: 'Delete result file' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm file deletion' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Storage unavailable.');
  expect(screen.getByRole('cell', { name: 'Alice' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Confirm file deletion' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm file deletion' }));
  expect(await screen.findByText('Result file deleted.')).toBeInTheDocument();
  expect(etlApi.deleteResult).toHaveBeenCalledTimes(2);
});

test('unauthorized deletion expires the session and does not report success', async () => {
  const expired = jest.fn();
  etlApi.deleteResult.mockRejectedValue({ status: 401, message: 'Please sign in again.' });
  render(<ResultsDetailPage runId={runId} onSessionExpired={expired} />);
  await screen.findByRole('cell', { name: 'Alice' });
  fireEvent.click(screen.getByRole('button', { name: 'Delete result file' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm file deletion' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Please sign in again.');
  expect(expired).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Result file deleted.')).not.toBeInTheDocument();
});

test('removed result metadata skips row and format requests but preserves summary and run links', async () => {
  etlApi.getRun.mockResolvedValue({ run: { ...run, result_available: false, download_url: null } });
  render(<ResultsDetailPage runId={runId} />);
  expect(await screen.findByRole('heading', { name: 'Result file removed' })).toBeInTheDocument();
  expect(etlApi.rows).not.toHaveBeenCalled();
  expect(etlApi.capabilities).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Download full result' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Delete result file' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Run details' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Edit and resubmit' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Pipeline steps' })).toBeInTheDocument();
  expect(screen.getByText('Output rows')).toBeInTheDocument();
});

test('removed outputs have unified run/result link and file-removed note in history', async () => {
  etlApi.listRuns.mockResolvedValue(listing([{ ...run, result_available: false }]));
  const { unmount } = render(<RunsPage />);
  await screen.findByRole('rowheader', { name: 'Customer cleanup' });
  expect(screen.getByText('File removed')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'View run & result' })).toHaveAttribute('href', `/dashboard/runs/${runId}`);
  expect(screen.queryByRole('link', { name: 'View result' })).not.toBeInTheDocument();
  unmount();
  render(<ResultsPage />);
  await screen.findByRole('rowheader', { name: 'Customer cleanup' });
  expect(screen.getByRole('link', { name: 'Customer cleanup' })).toHaveAttribute('href', `/dashboard/runs/${runId}`);
  expect(screen.getByRole('link', { name: 'View run & result' })).toHaveAttribute('href', `/dashboard/runs/${runId}`);
  expect(screen.queryByRole('link', { name: 'View result' })).not.toBeInTheDocument();
});

test('run detail preserves configuration and summary when its output is removed', async () => {
  etlApi.getRun.mockResolvedValue({ run: { ...run, result_available: false } });
  render(<RunDetailPage runId={runId} />);
  expect(await screen.findByRole('heading', { name: 'Result file removed' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'View result' })).not.toBeInTheDocument();
  expect(screen.getByLabelText('Submitted configuration')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Run summary' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Edit and resubmit' })).toBeInTheDocument();
  expect(etlApi.runSourceRows).not.toHaveBeenCalled();
});

test('an old deletion completion cannot remove a newly opened result', async () => {
  let finish;
  etlApi.deleteResult.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const { rerender } = render(<ResultsDetailPage runId={runId} />);
  await screen.findByRole('cell', { name: 'Alice' });
  fireEvent.click(screen.getByRole('button', { name: 'Delete result file' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm file deletion' }));
  etlApi.getRun.mockResolvedValueOnce({ run: { ...run, id: secondId, name: 'Another cleanup' } });
  etlApi.rows.mockResolvedValueOnce(rowPage({ rows: [{ name: 'Bob' }] }));
  rerender(<ResultsDetailPage runId={secondId} />);
  await screen.findByRole('cell', { name: 'Bob' });
  await act(async () => { finish({ deleted: true }); });
  expect(screen.queryByRole('heading', { name: 'Result file removed' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Delete result file' })).toBeEnabled();
});

test('unified RunDetailPage and ResultsDetailPage display ordered pipeline steps, disabled badge, delta summary, and normalized column diff', async () => {
  const richRun = {
    ...run,
    sources_meta: {
      [secondId]: { id: secondId, filename: 'orders.csv', format: 'csv', size_bytes: 200, available: true, matches_snapshot: true, is_primary: true },
      [thirdId]: { id: thirdId, filename: 'customers.tsv', format: 'tsv', size_bytes: 100, available: true, matches_snapshot: true, is_primary: false },
    },
    configuration: {
      datasetId: secondId,
      steps: [
        { type: 'cast_type', enabled: true, config: { conversions: [{ column: 'amount', toType: 'float' }] } },
        { type: 'string_transform', enabled: false, sourceId: thirdId, config: { rules: [{ column: 'tier', trim: true, caseMode: 'upper' }] } },
        { type: 'join', enabled: true, config: { datasetId: thirdId, on: 'name', how: 'inner' } },
      ],
    },
  };
  etlApi.getRun.mockResolvedValue({ run: richRun });
  etlApi.rows.mockResolvedValue(rowPage({
    columns: [{ name: 'name', type: 'string' }, { name: 'amount', type: 'float' }, { name: 'tier', type: 'string' }],
    rows: [{ name: 'Alice', amount: 12.5, tier: 'VIP' }],
  }));
  etlApi.runSourceRows.mockResolvedValue(sourceRowPage({
    columns: [{ name: 'name', type: 'str' }, { name: 'amount', type: 'int' }, { name: 'legacy_col', type: 'string' }],
    rows: [{ name: 'Raw Alice', amount: 12, legacy_col: 'x' }],
  }));

  const { unmount } = render(<ResultsDetailPage runId={runId} />);
  expect(await screen.findByText('3 steps')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '← All results' })).toHaveAttribute('href', '/dashboard/results');
  const stepsList = screen.getByRole('heading', { name: 'Pipeline steps' }).closest('section');
  expect(within(stepsList).getByText('Convert amount → float')).toBeInTheDocument();
  expect(within(stepsList).getByText('Disabled')).toBeInTheDocument();
  expect(within(stepsList).getByText('customers.tsv')).toBeInTheDocument();
  expect(within(stepsList).getByText('Inner join with customers.tsv on "name"')).toBeInTheDocument();
  expect(await screen.findByRole('cell', { name: 'Raw Alice' })).toBeInTheDocument();
  expect(screen.getByRole('cell', { name: 'Alice' })).toBeInTheDocument();
  const diffRegion = screen.getByLabelText('Column changes');
  expect(diffRegion).toHaveTextContent('Added columns: tier');
  expect(diffRegion).toHaveTextContent('Removed columns: legacy_col');
  expect(diffRegion).toHaveTextContent('Type changes: amount (integer → float)');
  expect(diffRegion).not.toHaveTextContent('name (');
  unmount();

  render(<RunDetailPage runId={runId} />);
  expect(await screen.findByRole('link', { name: '← All runs' })).toHaveAttribute('href', '/dashboard/runs');
  expect(await screen.findByRole('cell', { name: 'Raw Alice' })).toBeInTheDocument();
});

test('supports original pagination, view mode toggling, and multi-source switching with abort cleanup', async () => {
  const multiRun = {
    ...run,
    sources_meta: {
      [secondId]: { id: secondId, filename: 'orders.csv', format: 'csv', size_bytes: 200, available: true, matches_snapshot: true, is_primary: true },
      [thirdId]: { id: thirdId, filename: 'customers.tsv', format: 'tsv', size_bytes: 100, available: true, matches_snapshot: true, is_primary: false },
    },
    configuration: { datasetId: secondId, steps: [{ type: 'join', enabled: true, config: { datasetId: thirdId, on: 'id', how: 'left' } }] },
  };
  etlApi.getRun.mockResolvedValue({ run: multiRun });
  etlApi.runSourceRows
    .mockResolvedValueOnce(sourceRowPage({ total_pages: 2, total_count: 26 }))
    .mockResolvedValueOnce(sourceRowPage({ page: 2, total_pages: 2, total_count: 26, rows: [{ name: 'Raw Page 2', amount: 20 }] }))
    .mockResolvedValueOnce(sourceRowPage({ dataset_id: thirdId, filename: 'customers.tsv', rows: [{ name: 'Customer Row', amount: 30 }] }));

  render(<RunDetailPage runId={runId} />);
  expect(await screen.findByRole('cell', { name: 'Raw Alice' })).toBeInTheDocument();
  expect(etlApi.runSourceRows).toHaveBeenCalledWith(runId, { page: 1, pageSize: 25, datasetId: secondId, signal: expect.any(AbortSignal) });

  const originalNav = screen.getByRole('navigation', { name: 'Original row pages' });
  fireEvent.click(within(originalNav).getByRole('button', { name: 'Next' }));
  expect(await screen.findByRole('cell', { name: 'Raw Page 2' })).toBeInTheDocument();
  expect(etlApi.runSourceRows).toHaveBeenLastCalledWith(runId, { page: 2, pageSize: 25, datasetId: secondId, signal: expect.any(AbortSignal) });

  fireEvent.change(screen.getByLabelText('Original source dataset'), { target: { value: thirdId } });
  expect(await screen.findByRole('cell', { name: 'Customer Row' })).toBeInTheDocument();
  expect(etlApi.runSourceRows).toHaveBeenLastCalledWith(runId, { page: 1, pageSize: 25, datasetId: thirdId, signal: expect.any(AbortSignal) });

  fireEvent.click(screen.getByRole('button', { name: 'Result only' }));
  expect(screen.queryByRole('heading', { name: /Original data/ })).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Result rows' })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Original only' }));
  expect(screen.getByRole('heading', { name: /Original data/ })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Result rows' })).not.toBeInTheDocument();
});

test('degrades gracefully when original source is deleted, modified, or errors', async () => {
  // Deleted via sources_meta.available === false
  etlApi.getRun.mockResolvedValueOnce({
    run: {
      ...run,
      sources_meta: {
        [secondId]: { id: secondId, filename: 'orders.csv', format: 'csv', size_bytes: 200, available: false, matches_snapshot: false, is_primary: true },
      },
    },
  });
  const { unmount } = render(<RunDetailPage runId={runId} />);
  expect(await screen.findByText(/Original source unavailable/)).toBeInTheDocument();
  expect(await screen.findByRole('cell', { name: 'Alice' })).toBeInTheDocument();
  expect(etlApi.runSourceRows).not.toHaveBeenCalled();
  unmount();

  // Modified via sources_meta.matches_snapshot === false
  etlApi.getRun.mockResolvedValueOnce({
    run: {
      ...run,
      sources_meta: {
        [secondId]: { id: secondId, filename: 'orders.csv', format: 'csv', size_bytes: 200, available: true, matches_snapshot: false, is_primary: true },
      },
    },
  });
  const { unmount: unmountModified } = render(<RunDetailPage runId={runId} />);
  expect(await screen.findByText(/Original source changed after this run/)).toBeInTheDocument();
  expect(etlApi.runSourceRows).not.toHaveBeenCalled();
  unmountModified();

  // Transient error + retry + 409 fallback
  etlApi.getRun.mockResolvedValue({ run });
  etlApi.runSourceRows
    .mockRejectedValueOnce({ status: 500, message: 'Original rows temporary error.' })
    .mockResolvedValueOnce(sourceRowPage());
  render(<RunDetailPage runId={runId} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Original rows temporary error.');
  expect(await screen.findByRole('cell', { name: 'Alice' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry original rows' }));
  expect(await screen.findByRole('cell', { name: 'Raw Alice' })).toBeInTheDocument();
});
