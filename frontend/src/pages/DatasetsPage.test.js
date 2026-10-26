import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import datasetsApi from '../api/datasets';
import DatasetsPage from './DatasetsPage';

jest.mock('../api/datasets', () => ({
  __esModule: true,
  default: { list: jest.fn(), upload: jest.fn() },
}));

const limits = { max_file_size_bytes: 25 * 1024 * 1024, extensions: ['csv', 'tsv', 'json', 'xlsx', 'parquet'] };
const dataset = { id: 'source-1', filename: 'orders.csv', format: 'csv', size_bytes: 2048, uploaded_at: '2026-10-24T10:00:00Z' };
const listResponse = (datasets = [], overrides = {}) => ({ datasets, page: 1, total_pages: 1, total_count: datasets.length, limits, ...overrides });

function select(files) {
  fireEvent.change(screen.getByLabelText('Choose files'), { target: { files } });
}

beforeEach(() => {
  jest.resetAllMocks();
  datasetsApi.list.mockResolvedValue(listResponse());
});

test('loads real metadata and paginates the dataset list', async () => {
  datasetsApi.list.mockResolvedValueOnce(listResponse([dataset], { total_pages: 2, total_count: 2 }));
  datasetsApi.list.mockResolvedValueOnce(listResponse([{ ...dataset, id: 'source-2', filename: 'people.tsv', format: 'tsv' }], { page: 2, total_pages: 2, total_count: 2 }));
  render(<DatasetsPage />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading datasets');
  expect(await screen.findByRole('rowheader', { name: 'orders.csv' })).toBeInTheDocument();
  expect(screen.getByRole('cell', { name: 'CSV' })).toBeInTheDocument();
  expect(screen.getByRole('cell', { name: '2.0 KB' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(await screen.findByRole('rowheader', { name: 'people.tsv' })).toBeInTheDocument();
  expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
  expect(datasetsApi.list).toHaveBeenLastCalledWith(2, { signal: expect.any(AbortSignal) });
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
});

test('uploads sequentially, prevents double submission, and preserves partial results', async () => {
  let finishFirst;
  datasetsApi.upload.mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }));
  datasetsApi.upload.mockRejectedValueOnce({ message: 'Invalid data.', fields: { file: ['The file could not be read.'] } });
  datasetsApi.list.mockResolvedValueOnce(listResponse()).mockResolvedValueOnce(listResponse([dataset]));
  render(<DatasetsPage />);
  await screen.findByText('No datasets yet');
  const first = new File(['order\n1'], 'orders.csv');
  const second = new File(['broken'], 'broken.json');
  select([first, second]);
  const upload = screen.getByRole('button', { name: 'Upload 2 files' });
  fireEvent.click(upload);
  fireEvent.click(upload);
  expect(datasetsApi.upload).toHaveBeenCalledTimes(1);
  expect(datasetsApi.upload).toHaveBeenCalledWith(first);
  expect(screen.getByRole('button', { name: 'Uploading files…' })).toBeDisabled();
  expect(screen.getByLabelText('Choose files')).toBeDisabled();
  expect(screen.getByText('Ready to upload')).toBeInTheDocument();
  await act(async () => { finishFirst({ dataset }); });
  const results = screen.getByRole('list', { name: 'Upload results' });
  expect(await within(results).findByText('Uploaded')).toBeInTheDocument();
  expect(await within(results).findByText('Failed — The file could not be read.')).toBeInTheDocument();
  expect(datasetsApi.upload.mock.calls.map(([file]) => file)).toEqual([first, second]);
  expect(await screen.findByRole('rowheader', { name: 'orders.csv' })).toBeInTheDocument();
  expect(datasetsApi.list).toHaveBeenCalledTimes(2);
  select([new File(['id\n3'], 'retry.csv')]);
  expect(within(results).getByText('Failed — The file could not be read.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Upload 1 file' })).toBeEnabled();
});

test('rejects unsupported, empty, and oversized files without sending them', async () => {
  render(<DatasetsPage />);
  await screen.findByText('No datasets yet');
  const tooLarge = new File(['content'], 'large.csv');
  Object.defineProperty(tooLarge, 'size', { value: limits.max_file_size_bytes + 1 });
  select([new File(['text'], 'notes.txt'), new File([], 'empty.csv'), tooLarge]);
  expect(screen.getByText('Failed — Unsupported file format.')).toBeInTheDocument();
  expect(screen.getByText('Failed — This file is empty.')).toBeInTheDocument();
  expect(screen.getByText('Failed — File exceeds the 25.0 MB limit.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Upload files' })).toBeDisabled();
  expect(datasetsApi.upload).not.toHaveBeenCalled();
});

test('rejects more than ten files and accepts a supported uppercase extension', async () => {
  render(<DatasetsPage />);
  await screen.findByText('No datasets yet');
  select(Array.from({ length: 11 }, (_, index) => new File(['value'], `${index}.csv`)));
  expect(screen.getByRole('alert')).toHaveTextContent('Choose up to 10 files at a time.');
  expect(screen.queryByRole('list', { name: 'Upload results' })).not.toBeInTheDocument();
  select([new File(['value'], 'SOURCE.CSV')]);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByText('Ready to upload')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Upload 1 file' })).toBeEnabled();
});

test('shows a list failure and retries instead of claiming the list is empty', async () => {
  datasetsApi.list.mockRejectedValueOnce(new Error('Service unavailable.')).mockResolvedValueOnce(listResponse([dataset]));
  render(<DatasetsPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load datasets. Service unavailable.');
  expect(screen.queryByText('No datasets yet')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Retry list' }));
  expect(await screen.findByRole('rowheader', { name: 'orders.csv' })).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('keeps a successful upload distinct from a list refresh failure', async () => {
  datasetsApi.upload.mockResolvedValue({ dataset });
  datasetsApi.list.mockResolvedValueOnce(listResponse()).mockRejectedValueOnce(new Error('Refresh unavailable.'));
  render(<DatasetsPage />);
  await screen.findByText('No datasets yet');
  select([new File(['id\n1'], 'orders.csv')]);
  await userEvent.click(screen.getByRole('button', { name: 'Upload 1 file' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not refresh datasets. Refresh unavailable.');
  expect(within(screen.getByRole('list', { name: 'Upload results' })).getByText('Uploaded')).toBeInTheDocument();
  expect(screen.queryByText('No datasets yet')).not.toBeInTheDocument();
  expect(datasetsApi.upload).toHaveBeenCalledTimes(1);
});

test('uses limits from the list response for validation and helper text', async () => {
  datasetsApi.list.mockResolvedValueOnce(listResponse([], { limits: { max_file_size_bytes: 5, extensions: ['csv'] } }));
  render(<DatasetsPage />);
  await screen.findByText('No datasets yet');
  expect(screen.getByText(/Up to 5 B per file/)).toBeInTheDocument();
  expect(screen.getByLabelText('Choose files')).toHaveAttribute('accept', '.csv');
  select([new File(['longer than five'], 'source.csv')]);
  expect(screen.getByText('Failed — File exceeds the 5 B limit.')).toBeInTheDocument();
  expect(datasetsApi.upload).not.toHaveBeenCalled();
});

test('notifies the session owner when the list returns 401', async () => {
  const onSessionExpired = jest.fn();
  datasetsApi.list.mockRejectedValueOnce({ status: 401, message: 'Please sign in again.' });
  render(<DatasetsPage onSessionExpired={onSessionExpired} />);
  await waitFor(() => expect(onSessionExpired).toHaveBeenCalledTimes(1));
});

test('stops remaining uploads on 401 and notifies the session owner once', async () => {
  const onSessionExpired = jest.fn();
  datasetsApi.upload.mockRejectedValueOnce({ status: 401, message: 'Please sign in again.' });
  render(<DatasetsPage onSessionExpired={onSessionExpired} />);
  await screen.findByText('No datasets yet');
  select([new File(['id'], 'one.csv'), new File(['id'], 'two.csv')]);
  await userEvent.click(screen.getByRole('button', { name: 'Upload 2 files' }));
  expect(await screen.findByText('Failed — Not uploaded. Sign in again to continue.')).toBeInTheDocument();
  expect(onSessionExpired).toHaveBeenCalledTimes(1);
  expect(datasetsApi.upload).toHaveBeenCalledTimes(1);
  expect(datasetsApi.list).toHaveBeenCalledTimes(1);
});
