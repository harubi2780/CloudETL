import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import datasetsApi from '../api/datasets';
import DatasetsPage from './DatasetsPage';

jest.mock('../api/datasets', () => ({
  __esModule: true,
  default: { list: jest.fn(), upload: jest.fn(), replace: jest.fn(), remove: jest.fn() },
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

test('excludes unsupported, empty, and oversized files with filename notices', async () => {
  render(<DatasetsPage />);
  await screen.findByText('No datasets yet');
  const tooLarge = new File(['content'], 'large.csv');
  Object.defineProperty(tooLarge, 'size', { value: limits.max_file_size_bytes + 1 });
  select([new File(['text'], 'notes.txt'), new File([], 'empty.csv'), tooLarge]);
  const notices = screen.getByRole('list', { name: 'Files not added' });
  expect(within(notices).getByText('notes.txt')).toBeInTheDocument();
  expect(within(notices).getByText(/File type not supported/)).toBeInTheDocument();
  expect(within(notices).getByText('empty.csv')).toBeInTheDocument();
  expect(within(notices).getByText('large.csv')).toBeInTheDocument();
  expect(screen.queryByRole('list', { name: 'Upload results' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Upload files' })).toBeDisabled();
  expect(datasetsApi.upload).not.toHaveBeenCalled();
});

test('enforces ten pending files across selections and preserves the existing queue', async () => {
  render(<DatasetsPage />);
  await screen.findByText('No datasets yet');
  act(() => {
    select(Array.from({ length: 8 }, (_, index) => new File(['value'], `${index}.csv`)));
    select(Array.from({ length: 3 }, (_, index) => new File(['value'], `extra-${index}.csv`)));
  });
  expect(screen.getByRole('alert')).toHaveTextContent('1 file was not added');
  const list = screen.getByRole('list', { name: 'Upload results' });
  expect(within(list).getAllByText('Ready to upload')).toHaveLength(10);
  select([new File(['value'], 'eleventh.csv')]);
  expect(screen.getByRole('alert')).toHaveTextContent('1 file was not added');
  expect(within(list).getAllByText('Ready to upload')).toHaveLength(10);
  expect(within(list).getByText('0.csv')).toBeInTheDocument();
  expect(within(list).getByText('extra-1.csv')).toBeInTheDocument();
  expect(datasetsApi.upload).not.toHaveBeenCalled();
});

test('appends picker selections, shows filename and size, and removes only the requested file', async () => {
  render(<DatasetsPage />);
  await screen.findByText('No datasets yet');
  const first = new File(['1'], 'first.csv', { lastModified: 1 });
  const second = new File(['two'], 'second.tsv', { lastModified: 2 });
  select([first]);
  select([second]);
  select([new File(['1'], 'first.csv', { lastModified: 1 })]);

  const list = screen.getByRole('list', { name: 'Upload results' });
  expect(within(list).getByText('first.csv')).toBeInTheDocument();
  expect(within(list).getByText('second.tsv')).toBeInTheDocument();
  expect(within(list).getByText('1 B')).toBeInTheDocument();
  expect(within(list).getByText('3 B')).toBeInTheDocument();
  expect(screen.getByText(/This file is already in the queue/)).toBeInTheDocument();
  expect(datasetsApi.upload).not.toHaveBeenCalled();

  await userEvent.click(within(list).getByRole('button', { name: 'Remove first.csv' }));
  expect(within(list).queryByText('first.csv')).not.toBeInTheDocument();
  expect(within(list).getByText('second.tsv')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Upload 1 file' })).toBeEnabled();
});

test('appends supported files from a mixed drop and reports excluded filenames', async () => {
  render(<DatasetsPage />);
  await screen.findByText('No datasets yet');
  const dropArea = screen.getByRole('region', { name: 'File drop area' });
  fireEvent.drop(dropArea, { dataTransfer: { files: [
    new File(['id'], 'dropped.csv'),
    new File(['x'], 'notes.txt'),
    new File([], 'empty.json'),
  ] } });

  const list = screen.getByRole('list', { name: 'Upload results' });
  expect(within(list).getByText('dropped.csv')).toBeInTheDocument();
  expect(within(list).getAllByText('Ready to upload')).toHaveLength(1);
  const notices = screen.getByRole('list', { name: 'Files not added' });
  expect(within(notices).getByText('notes.txt')).toBeInTheDocument();
  expect(within(notices).getByText(/File type not supported/)).toBeInTheDocument();
  expect(within(notices).getByText('empty.json')).toBeInTheDocument();
  expect(datasetsApi.upload).not.toHaveBeenCalled();
});

test('ignores drop and removal while an upload is in progress', async () => {
  let finishFirst;
  datasetsApi.upload.mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }));
  datasetsApi.upload.mockResolvedValueOnce({ dataset });
  render(<DatasetsPage />);
  await screen.findByText('No datasets yet');
  select([new File(['1'], 'one.csv'), new File(['2'], 'two.csv')]);
  const list = screen.getByRole('list', { name: 'Upload results' });
  fireEvent.click(screen.getByRole('button', { name: 'Upload 2 files' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Uploading files…' })).toBeDisabled());
  expect(within(list).getByRole('button', { name: 'Remove two.csv' })).toBeDisabled();
  fireEvent.drop(screen.getByRole('region', { name: 'File drop area' }), {
    dataTransfer: { files: [new File(['3'], 'three.csv')] },
  });
  expect(within(list).queryByText('three.csv')).not.toBeInTheDocument();
  expect(datasetsApi.upload).toHaveBeenCalledTimes(1);
  await act(async () => { finishFirst({ dataset }); });
  expect(await within(list).findAllByText('Uploaded')).toHaveLength(2);
  expect(datasetsApi.upload).toHaveBeenCalledTimes(2);
});

test('keeps recent upload results bounded as new batches are added', async () => {
  datasetsApi.upload.mockResolvedValue({ dataset });
  render(<DatasetsPage />);
  await screen.findByText('No datasets yet');

  for (let batch = 0; batch < 3; batch += 1) {
    const start = batch * 10;
    select(Array.from({ length: 10 }, (_, index) => new File(['x'], `batch-${start + index}.csv`)));
    await userEvent.click(screen.getByRole('button', { name: 'Upload 10 files' }));
    await screen.findByRole('button', { name: 'Upload files' });
  }

  const results = screen.getByRole('list', { name: 'Upload results' });
  expect(within(results).getAllByText('Uploaded')).toHaveLength(20);
  expect(within(results).queryByText('batch-0.csv')).not.toBeInTheDocument();
  expect(within(results).getByText('batch-10.csv')).toBeInTheDocument();
  expect(within(results).getByText('batch-29.csv')).toBeInTheDocument();
  expect(datasetsApi.upload).toHaveBeenCalledTimes(30);
});

test('accepts a supported uppercase extension', async () => {
  render(<DatasetsPage />);
  await screen.findByText('No datasets yet');
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
  expect(screen.getByText('source.csv')).toBeInTheDocument();
  expect(screen.getByText(/File exceeds the 5 B limit/)).toBeInTheDocument();
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

test('requires confirmation to replace, validates selection, and preserves the dataset identity', async () => {
  const replaced = { ...dataset, filename: 'updated.json', format: 'json' };
  datasetsApi.list.mockResolvedValueOnce(listResponse([dataset])).mockResolvedValueOnce(listResponse([replaced]));
  datasetsApi.replace.mockResolvedValue({ dataset: replaced, warning: 'Old file cleanup needs attention.' });
  render(<DatasetsPage />);
  await userEvent.click(await screen.findByRole('button', { name: 'Replace orders.csv' }));
  expect(datasetsApi.replace).not.toHaveBeenCalled();
  const picker = screen.getByLabelText('Replacement file');
  fireEvent.change(picker, { target: { files: [new File(['x'], 'bad.exe')] } });
  expect(screen.getByRole('alert')).toHaveTextContent('File type not supported');
  expect(screen.getByRole('button', { name: 'Confirm replacement' })).toBeDisabled();
  const file = new File(['[]'], 'updated.json');
  fireEvent.change(picker, { target: { files: [file] } });
  expect(datasetsApi.replace).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Confirm replacement' }));
  expect(await screen.findByRole('rowheader', { name: 'updated.json' })).toBeInTheDocument();
  expect(datasetsApi.replace).toHaveBeenCalledWith(dataset.id, file);
  expect(screen.getByText(/orders.csv replaced. Old file cleanup needs attention./)).toBeInTheDocument();
});

test('cancels replacement and deletion without sending requests', async () => {
  datasetsApi.list.mockResolvedValue(listResponse([dataset]));
  render(<DatasetsPage />);
  await userEvent.click(await screen.findByRole('button', { name: 'Replace orders.csv' }));
  fireEvent.change(screen.getByLabelText('Replacement file'), { target: { files: [new File(['id\n1'], 'new.csv')] } });
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByRole('button', { name: 'Replace orders.csv' })).toHaveFocus();
  await userEvent.click(screen.getByRole('button', { name: 'Delete orders.csv' }));
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByRole('button', { name: 'Delete orders.csv' })).toHaveFocus();
  expect(datasetsApi.replace).not.toHaveBeenCalled();
  expect(datasetsApi.remove).not.toHaveBeenCalled();
  expect(screen.getByRole('rowheader', { name: 'orders.csv' })).toBeInTheDocument();
});

test('deletes only after confirmation, prevents duplicate requests, and returns from an empty last page', async () => {
  let finishDelete;
  datasetsApi.remove.mockImplementation(() => new Promise((resolve) => { finishDelete = resolve; }));
  datasetsApi.list.mockResolvedValueOnce(listResponse([dataset], { total_pages: 2, total_count: 21 }))
    .mockResolvedValueOnce(listResponse([dataset], { page: 2, total_pages: 2, total_count: 21 }))
    .mockResolvedValueOnce(listResponse([{ ...dataset, id: 'remaining', filename: 'remaining.csv' }], { total_count: 20 }));
  render(<DatasetsPage />);
  await screen.findByRole('rowheader', { name: 'orders.csv' });
  await userEvent.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByText('Page 2 of 2');
  await userEvent.click(screen.getByRole('button', { name: 'Delete orders.csv' }));
  expect(datasetsApi.remove).not.toHaveBeenCalled();
  const confirm = screen.getByRole('button', { name: 'Confirm deletion' });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(datasetsApi.remove).toHaveBeenCalledTimes(1);
  expect(datasetsApi.remove).toHaveBeenCalledWith(dataset.id);
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
  await act(async () => { finishDelete({ deleted: true }); });
  expect(await screen.findByRole('rowheader', { name: 'remaining.csv' })).toBeInTheDocument();
  expect(datasetsApi.list).toHaveBeenLastCalledWith(1, { signal: expect.any(AbortSignal) });
  expect(screen.getByText('orders.csv deleted.')).toBeInTheDocument();
});

test.each(['replace', 'delete'])('shows %s failures without removing the dataset and permits retry', async (type) => {
  datasetsApi.list.mockResolvedValue(listResponse([dataset]));
  const action = type === 'replace' ? datasetsApi.replace : datasetsApi.remove;
  action.mockRejectedValueOnce(new Error('Storage unavailable.'));
  render(<DatasetsPage />);
  await userEvent.click(await screen.findByRole('button', { name: `${type === 'replace' ? 'Replace' : 'Delete'} orders.csv` }));
  if (type === 'replace') fireEvent.change(screen.getByLabelText('Replacement file'), { target: { files: [new File(['id\n1'], 'new.csv')] } });
  await userEvent.click(screen.getByRole('button', { name: type === 'replace' ? 'Confirm replacement' : 'Confirm deletion' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Storage unavailable.');
  expect(screen.getByRole('rowheader', { name: 'orders.csv' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: type === 'replace' ? 'Confirm replacement' : 'Confirm deletion' })).toBeEnabled();
  expect(datasetsApi.list).toHaveBeenCalledTimes(1);
});

test('keeps successful deletion distinct from refresh failure and removes the stale row', async () => {
  datasetsApi.list.mockResolvedValueOnce(listResponse([dataset])).mockRejectedValueOnce(new Error('Refresh unavailable.'));
  datasetsApi.remove.mockResolvedValue({ deleted: true });
  render(<DatasetsPage />);
  await userEvent.click(await screen.findByRole('button', { name: 'Delete orders.csv' }));
  await userEvent.click(screen.getByRole('button', { name: 'Confirm deletion' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not refresh datasets. Refresh unavailable.');
  expect(screen.getByText('orders.csv deleted.')).toBeInTheDocument();
  expect(screen.queryByRole('rowheader', { name: 'orders.csv' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Retry list' })).toBeEnabled();
});

test('notifies the session owner when a management request returns 401', async () => {
  const onSessionExpired = jest.fn();
  datasetsApi.list.mockResolvedValue(listResponse([dataset]));
  datasetsApi.remove.mockRejectedValue({ status: 401, message: 'Please sign in again.' });
  render(<DatasetsPage onSessionExpired={onSessionExpired} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Delete orders.csv' }));
  await userEvent.click(screen.getByRole('button', { name: 'Confirm deletion' }));
  await waitFor(() => expect(onSessionExpired).toHaveBeenCalledTimes(1));
});
