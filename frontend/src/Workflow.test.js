import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { operations } from './lib/pipeline/workflow';

const ordersId = '10000000-0000-0000-0000-000000000001';
const customersId = '10000000-0000-0000-0000-000000000002';
const runId = '20000000-0000-0000-0000-000000000001';
const sources = [
  { id: ordersId, filename: 'orders.csv', format: 'csv', size_bytes: 200, uploaded_at: '2026-11-15T00:00:00Z' },
  { id: customersId, filename: 'customers.tsv', format: 'tsv', size_bytes: 100, uploaded_at: '2026-11-15T00:00:00Z' },
];
const columns = [{ name: 'order_id', type: 'str' }];
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });

test('follows the real app/API adapters from source selection through join, run, result pages and full download', async () => {
  let submitted;
  const blob = new Blob(['order_id\n' + Array.from({ length: 26 }, (_, index) => `ORD${index + 1}`).join('\n')]);
  window.history.replaceState(null, '', '/dashboard/datasets');
  window.scrollTo = jest.fn();
  URL.createObjectURL = jest.fn(() => 'blob:complete-result');
  URL.revokeObjectURL = jest.fn();
  const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  global.fetch = jest.fn(async (url, options = {}) => {
    if (url === '/api/auth/csrf/') return response({ csrfToken: 'workflow-csrf' });
    if (url === '/api/auth/me/') return response({ user: { id: 1, username: 'worker', email: 'test@example.com' } });
    if (url.startsWith('/api/datasets/?')) return response({ datasets: sources, page: 1, total_pages: 1, total_count: 2,
      limits: { max_file_size_bytes: 26214400, extensions: ['csv', 'tsv', 'json', 'xlsx', 'parquet'] } });
    if (url === '/api/etl/capabilities/') return response({ operations: Object.fromEntries(operations.map(({ type }) => [type, {}])),
      inputFormats: ['csv', 'tsv'], outputFormats: ['parquet', 'csv', 'tsv', 'json', 'xlsx'],
      limits: { maxSources: 6, maxSteps: 50, maxCombinedInputBytes: 26214400 } });
    for (const dataset of sources) {
      if (url === `/api/etl/datasets/${dataset.id}/`) return response({ dataset });
      if (url === `/api/etl/datasets/${dataset.id}/preview/`) return response({ preview: { columns,
        final_rows: 26, rows: Array.from({ length: 10 }, (_, index) => ({ order_id: `ORD${index + 1}` })) } });
    }
    if (url === '/api/etl/runs/' && options.method === 'POST') {
      submitted = JSON.parse(options.body);
      return response({ run: { id: runId, status: 'queued' } }, 202);
    }
    if (url === `/api/etl/runs/${runId}/`) return response({ run: {
      id: runId, name: submitted.name, status: 'succeeded', configuration: submitted,
      created_at: '2026-11-15T00:00:00Z', finished_at: '2026-11-15T00:00:02Z',
      summary: { final_rows: 26, columns }, error: null,
    } });
    if (url.includes(`/api/etl/runs/${runId}/rows/`)) {
      const page = Number(new URL(url, window.location.origin).searchParams.get('page'));
      const start = (page - 1) * 25;
      return response({ page, page_size: 25, total_pages: 2, total_count: 26, columns,
        rows: Array.from({ length: page === 1 ? 25 : 1 }, (_, index) => ({ order_id: `ORD${start + index + 1}` })) });
    }
    if (url === `/api/etl/runs/${runId}/download/?format=csv`) return { ok: true, blob: async () => blob };
    throw new Error(`Unexpected workflow request: ${url}`);
  });
  try {
    render(<App />);
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Select orders.csv for pipeline' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select customers.tsv for pipeline' }));
    await userEvent.click(screen.getByRole('button', { name: 'Create pipeline' }));
    expect(await screen.findByRole('heading', { name: 'Source preview: orders.csv' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Combine', exact: true }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add Join tables step' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Add Join tables step' }));
    await userEvent.click(screen.getByRole('button', { name: 'Run pipeline' }));
    expect(await screen.findByText('Result ready')).toBeInTheDocument();
    expect(window.location.pathname).toBe(`/dashboard/runs/${runId}`);
    expect(submitted.steps).toEqual([{ type: 'join', enabled: true, config: { datasetId: customersId, on: 'order_id', how: 'left' } }]);
    expect(global.fetch.mock.calls.find(([url, options]) => url === '/api/etl/runs/' && options.method === 'POST')[1].headers['X-CSRFToken']).toBe('workflow-csrf');
    await userEvent.click(screen.getByRole('link', { name: 'View result' }));
    expect(await screen.findByRole('cell', { name: 'ORD25' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByRole('cell', { name: 'ORD26' })).toBeInTheDocument();
    expect(screen.queryByRole('cell', { name: 'ORD1' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('File format'), { target: { value: 'csv' } });
    await userEvent.click(screen.getByRole('button', { name: 'Download full result' }));
    await screen.findByText('The full-file download was handed to your browser.');
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(click).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls.filter(([url]) => url.startsWith('/api/auth/'))).toHaveLength(2);
  } finally { click.mockRestore(); }
});
