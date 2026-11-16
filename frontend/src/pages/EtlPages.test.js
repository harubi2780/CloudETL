import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import etlApi from '../api/etl';
import RunsPage from './RunsPage';
import RunDetailPage from './RunDetailPage';
import ResultsPage from './ResultsPage';
import ResultsDetailPage from './ResultsDetailPage';

jest.mock('../api/etl', () => ({
  __esModule: true,
  default: { listRuns: jest.fn(), getRun: jest.fn(), rows: jest.fn(), capabilities: jest.fn(), download: jest.fn() },
}));

const runId = '10000000-0000-0000-0000-000000000001';
const secondId = '10000000-0000-0000-0000-000000000002';
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

beforeEach(() => {
  jest.resetAllMocks();
  etlApi.listRuns.mockResolvedValue(listing());
  etlApi.getRun.mockResolvedValue({ run });
  etlApi.rows.mockResolvedValue(rowPage());
  etlApi.capabilities.mockResolvedValue({ outputFormats: ['parquet', 'csv', 'tsv', 'json', 'xlsx'] });
  etlApi.download.mockResolvedValue(undefined);
});

afterEach(() => {
  jest.useRealTimers();
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
  expect(screen.getByText('Waiting for a worker')).toBeInTheDocument();
  await act(async () => { jest.advanceTimersByTime(2000); });
  expect(screen.getByText('Running')).toBeInTheDocument();
  await act(async () => { jest.advanceTimersByTime(2000); });
  expect(screen.getByText('Result ready')).toBeInTheDocument();
  expect(screen.getByText('3s')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'View result' })).toHaveAttribute('href', `/dashboard/results/${runId}`);
  expect(screen.getByRole('link', { name: 'Edit and resubmit' })).toHaveAttribute('href', `/dashboard/pipelines?run=${runId}`);
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
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(await screen.findByRole('cell', { name: 'Bob' })).toBeInTheDocument();
  expect(screen.getByText('Rows 26–26 of 26. 5 columns.')).toBeInTheDocument();
  expect(etlApi.rows).toHaveBeenLastCalledWith(runId, { page: 2, pageSize: 25, signal: expect.any(AbortSignal) });
  fireEvent.change(screen.getByLabelText('Rows per page'), { target: { value: '50' } });
  expect(await screen.findByRole('cell', { name: 'Alice' })).toBeInTheDocument();
  expect(etlApi.rows).toHaveBeenLastCalledWith(runId, { page: 1, pageSize: 50, signal: expect.any(AbortSignal) });
});

test('downloads the complete file using advertised formats and prevents duplicate clicks', async () => {
  let finish;
  etlApi.capabilities.mockResolvedValue({ outputFormats: ['parquet', 'csv'] });
  etlApi.download.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  render(<ResultsDetailPage runId={runId} />);
  await screen.findByRole('cell', { name: 'Alice' });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Download full result' })).toBeEnabled());
  const formats = screen.getByLabelText('File format');
  expect(within(formats).getAllByRole('option')).toHaveLength(2);
  expect(within(formats).queryByRole('option', { name: 'XLSX' })).not.toBeInTheDocument();
  fireEvent.change(formats, { target: { value: 'csv' } });
  const download = screen.getByRole('button', { name: 'Download full result' });
  fireEvent.click(download);
  fireEvent.click(download);
  expect(etlApi.download).toHaveBeenCalledTimes(1);
  expect(etlApi.download).toHaveBeenCalledWith(runId, 'csv');
  expect(screen.getByRole('button', { name: 'Preparing download…' })).toBeDisabled();
  expect(screen.getByText('The selected format includes every output row, across all pages.')).toBeInTheDocument();
  await act(async () => { finish(); });
  expect(screen.getByText('The full-file download was handed to your browser.')).toBeInTheDocument();
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
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
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
