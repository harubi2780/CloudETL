import etlApi from './etl';

beforeEach(() => { global.fetch = jest.fn(); });

test('uses the shared JSON request layer for versioned run and pagination requests', async () => {
  global.fetch.mockResolvedValue({ ok: true, json: async () => ({ runs: [] }) });
  await etlApi.listRuns({ page: 2, status: 'succeeded' });
  expect(global.fetch).toHaveBeenLastCalledWith('/api/etl/runs/?page=2&status=succeeded', expect.objectContaining({ credentials: 'same-origin' }));
  await etlApi.rows('owned-id', { page: 3, pageSize: 50 });
  expect(global.fetch).toHaveBeenLastCalledWith('/api/etl/runs/owned-id/rows/?page=3&page_size=50', expect.anything());
  await etlApi.submit({ name: 'Clean', datasetId: 'id', steps: [] });
  expect(global.fetch.mock.calls.at(-1)[1]).toMatchObject({ method: 'POST', body: '{"name":"Clean","datasetId":"id","steps":[]}' });
});

test('downloads a binary full file and releases the object URL', async () => {
  jest.useFakeTimers();
  const blob = new Blob(['id\n1\n2\n']);
  global.fetch.mockResolvedValue({ ok: true, blob: async () => blob });
  URL.createObjectURL = jest.fn(() => 'blob:test-download');
  URL.revokeObjectURL = jest.fn();
  const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
    expect(this.download).toBe('result-owned-id.csv');
    expect(this.href).toBe('blob:test-download');
  });
  try {
    await etlApi.download('owned-id', 'csv');
    expect(global.fetch).toHaveBeenCalledWith('/api/etl/runs/owned-id/download/?format=csv', { credentials: 'same-origin' });
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(document.querySelector('a[download]')).toBeNull();
    jest.runOnlyPendingTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-download');
  } finally { click.mockRestore(); jest.useRealTimers(); }
});

test('binary download errors expose safe messages and authentication status', async () => {
  global.fetch.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ error: { code: 'authentication_required', message: 'Please log in.' } }) });
  await expect(etlApi.download('id', 'csv')).rejects.toMatchObject({ status: 401, message: 'Please log in.' });
  global.fetch.mockResolvedValueOnce({ ok: false, status: 502, json: async () => { throw new Error('private proxy response'); } });
  await expect(etlApi.download('id', 'csv')).rejects.toMatchObject({ status: 502, message: 'Download failed. Please try again.' });
});
