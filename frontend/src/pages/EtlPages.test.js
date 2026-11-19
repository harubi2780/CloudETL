import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import etlApi from '../api/etl';
import RunsPage, { RunStatus } from './RunsPage';
import RunDetailPage from './RunDetailPage';
import ResultsPage from './ResultsPage';
import ResultsDetailPage from './ResultsDetailPage';

jest.mock('../api/etl', () => ({
  __esModule: true,
  default: { listRuns: jest.fn(), getRun: jest.fn(), rows: jest.fn(), capabilities: jest.fn(), download: jest.fn(), deleteResult: jest.fn() },
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
  expect(screen.getByRole('link', { name: 'Run details' })).toHaveAttribute('href', `/dashboard/runs/${runId}`);
  expect(screen.getByRole('link', { name: 'Edit and resubmit' })).toBeInTheDocument();
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
  expect(screen.getByRole('link', { name: 'Run details' })).toBeInTheDocument();
  expect(screen.getByText('Output rows')).toBeInTheDocument();
});

test('removed outputs have no view-result links in run or result history', async () => {
  etlApi.listRuns.mockResolvedValue(listing([{ ...run, result_available: false }]));
  const { unmount } = render(<RunsPage />);
  await screen.findByRole('rowheader', { name: 'Customer cleanup' });
  expect(screen.getByText('File removed')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'View result' })).not.toBeInTheDocument();
  unmount();
  render(<ResultsPage />);
  await screen.findByRole('rowheader', { name: 'Customer cleanup' });
  expect(screen.getByRole('link', { name: 'Customer cleanup' })).toHaveAttribute('href', `/dashboard/runs/${runId}`);
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
