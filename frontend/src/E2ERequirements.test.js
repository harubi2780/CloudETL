import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';

const DS_ORDERS = '10000000-0000-0000-0000-000000000001';
const DS_CUSTOMERS = '10000000-0000-0000-0000-000000000002';
const DS_NODATE = '10000000-0000-0000-0000-000000000003';
const DS_UPLOADED = '10000000-0000-0000-0000-000000000004';
const PIPE_1 = '30000000-0000-0000-0000-000000000001';
const RUN_1 = '20000000-0000-0000-0000-000000000001';

const NUMERIC_OPS = ['equals', 'not_equals', 'greater_than', 'less_than', 'greater_or_equal', 'less_or_equal'];
const STRING_OPS = ['equals', 'contains', 'starts_with', 'ends_with'];
const DATETIME_OPS = ['after', 'before', 'equals'];
const BOOLEAN_OPS = ['is_true', 'is_false'];

const CANONICAL_CAPABILITIES = {
  schemaVersion: 1,
  inputFormats: ['csv', 'tsv'],
  outputFormats: ['csv', 'tsv'],
  operations: {
    select_columns: { selectedColumns: 'non-empty column list' },
    drop_duplicates: { rules: [{ allColumns: 'boolean', columns: 'column list', keep: ['first', 'last'] }] },
    handle_null: { rules: [{ column: 'column', strategy: ['drop', 'mean', 'median', 'custom'], customValue: 'scalar' }] },
    cast_type: { conversions: [{ column: 'column', toType: ['str', 'int', 'float', 'date'] }] },
    string_transform: { rules: [{ column: 'column', trim: 'boolean', caseMode: ['none', 'upper', 'lower', 'title'] }] },
    replace_value: { column: 'column', oldValue: 'scalar', newValue: 'scalar' },
    format_datetime: {
      column: 'column',
      inputFormat: ['auto', 'YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY/MM/DD'],
      outputFormat: ['YYYY-MM-DD', 'YYYY-MM-DD HH:mm:ss', 'ISO_8601'],
    },
    filter_rows: {
      conditions: [{
        column: 'column',
        operator: [
          'greater_than', 'less_than', 'greater_or_equal', 'less_or_equal',
          'equals', 'not_equals', 'contains', 'starts_with', 'ends_with',
          'is_true', 'is_false', 'after', 'before',
        ],
        value: '...',
      }],
      operatorsByType: {
        integer: NUMERIC_OPS,
        float: NUMERIC_OPS,
        string: STRING_OPS,
        datetime: DATETIME_OPS,
        boolean: BOOLEAN_OPS,
      },
    },
    merge_columns: { columns: 'column list', newColumnName: 'column', separator: 'string' },
    join: { datasetId: 'dataset UUID', on: 'column', how: ['left', 'right', 'inner', 'outer'] },
    concat: { datasetIds: 'dataset UUID list' },
  },
  limits: {
    maxSteps: 50,
    maxSources: 6,
    maxCombinedInputBytes: 26214400,
    maxResultBytes: 26214400,
    maxRows: 500000,
    maxColumns: 2048,
    maxCells: 1000000,
    previewRows: 10,
  },
};

const ORDERS_COLUMNS = [
  { name: 'order_id', type: 'string' },
  { name: 'city', type: 'string' },
  { name: 'quantity', type: 'integer' },
  { name: 'total_amount', type: 'float' },
  { name: 'order_date', type: 'datetime' },
  { name: 'is_paid', type: 'boolean' },
];

const ORDERS_ROWS = [
  { order_id: 'ORD01', city: 'Hanoi', quantity: 2, total_amount: 1500000.0, order_date: '2026-10-01', is_paid: true },
  { order_id: 'ORD02', city: 'Danang', quantity: 1, total_amount: 450000.0, order_date: '2026-10-02', is_paid: false },
  { order_id: 'ORD03', city: 'Saigon', quantity: 5, total_amount: 950000.0, order_date: '2026-10-03', is_paid: true },
];

const NODATE_COLUMNS = [
  { name: 'item_id', type: 'integer' },
  { name: 'raw_date', type: 'string' },
  { name: 'amount', type: 'string' },
];

const NODATE_ROWS = [
  { item_id: 1, raw_date: '2026-10-01', amount: '1200' },
  { item_id: 2, raw_date: '2026-10-02', amount: '800' },
];

const CUSTOMERS_COLUMNS = [
  { name: 'order_id', type: 'string' },
  { name: 'customer_tier', type: 'string' },
];

const CUSTOMERS_ROWS = [
  { order_id: 'ORD01', customer_tier: 'VIP' },
  { order_id: 'ORD02', customer_tier: 'Standard' },
  { order_id: 'ORD03', customer_tier: 'VIP' },
];

function makeDataset(id, filename, format, columns, rows, overrides = {}) {
  return {
    id,
    filename,
    format,
    size_bytes: 2048,
    uploaded_at: '2026-11-15T10:00:00Z',
    columns,
    rows,
    ...overrides,
  };
}

function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  };
}

function paginateRows(columns, rows, page, pageSize) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeSize = Math.max(1, Number(pageSize) || 25);
  const totalCount = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / safeSize));
  const start = (safePage - 1) * safeSize;
  return {
    columns,
    rows: rows.slice(start, start + safeSize),
    page: safePage,
    page_size: safeSize,
    total_count: totalCount,
    total_pages: totalPages,
  };
}

function createFetchMock({
  datasets = [],
  pipelines = [],
  runs = [],
  runPollSequences = {},
  capabilities = CANONICAL_CAPABILITIES,
  uploadDataset = null,
  replaceHandler = null,
  datasetRowsHandler = null,
  runSourceRowsHandler = null,
  runResultRowsHandler = null,
  downloadBlobText = 'order_id,total_amount\nORD01,1500000\n',
} = {}) {
  const state = {
    datasets: datasets.map((d) => ({ ...d })),
    pipelines: pipelines.map((p) => ({ ...p })),
    runs: runs.map((r) => ({ ...r })),
    submittedRuns: [],
    savedPipelines: [],
    requests: [],
    csrfToken: 'e2e-csrf-token',
    downloadBlob: new Blob([downloadBlobText], { type: 'text/csv' }),
  };

  const fetchMock = jest.fn(async (url, options = {}) => {
    const parsed = new URL(url, window.location.origin);
    const { pathname, searchParams } = parsed;
    const method = (options.method || 'GET').toUpperCase();
    state.requests.push({ method, pathname, search: parsed.search, headers: options.headers || {}, body: options.body });

    if (pathname === '/api/auth/csrf/' && method === 'GET') {
      return jsonResponse({ csrfToken: state.csrfToken });
    }
    if (pathname === '/api/auth/me/' && method === 'GET') {
      return jsonResponse({ user: { id: 1, username: 'alice', email: 'alice@example.com' } });
    }

    if (pathname === '/api/datasets/' && method === 'GET') {
      const page = Number(searchParams.get('page') || 1);
      const pageSize = 25;
      const start = (page - 1) * pageSize;
      const slice = state.datasets.slice(start, start + pageSize).map(({ columns, rows, ...meta }) => meta);
      return jsonResponse({
        datasets: slice,
        page,
        total_pages: Math.max(1, Math.ceil(state.datasets.length / pageSize)),
        total_count: state.datasets.length,
        limits: { max_file_size_bytes: 26214400, extensions: ['csv', 'tsv'] },
        storage: { used_bytes: 4096, quota_bytes: 104857600 },
      });
    }

    if (pathname === '/api/datasets/' && method === 'POST') {
      const created = uploadDataset
        ? { ...uploadDataset }
        : makeDataset(DS_UPLOADED, 'uploaded.csv', 'csv', ORDERS_COLUMNS, ORDERS_ROWS);
      state.datasets.unshift(created);
      const { columns, rows, ...meta } = created;
      return jsonResponse({ dataset: meta }, 201);
    }

    const replaceMatch = pathname.match(/^\/api\/datasets\/([^/]+)\/replace\/$/);
    if (replaceMatch && method === 'POST') {
      const id = replaceMatch[1];
      const idx = state.datasets.findIndex((d) => d.id === id);
      if (idx === -1) return jsonResponse({ error: { code: 'not_found', message: 'Dataset not found.' } }, 404);
      const updated = replaceHandler ? replaceHandler(state.datasets[idx]) : {
        ...state.datasets[idx],
        size_bytes: state.datasets[idx].size_bytes + 128,
      };
      state.datasets[idx] = updated;
      const { columns, rows, ...meta } = updated;
      return jsonResponse({ dataset: meta });
    }

    const deleteDatasetMatch = pathname.match(/^\/api\/datasets\/([^/]+)\/$/);
    if (deleteDatasetMatch && method === 'DELETE') {
      const id = deleteDatasetMatch[1];
      state.datasets = state.datasets.filter((d) => d.id !== id);
      return jsonResponse({ deleted: true });
    }

    if (pathname === '/api/etl/capabilities/' && method === 'GET') {
      return jsonResponse(capabilities);
    }

    const etlDatasetMatch = pathname.match(/^\/api\/etl\/datasets\/([^/]+)\/$/);
    if (etlDatasetMatch && method === 'GET') {
      const ds = state.datasets.find((d) => d.id === etlDatasetMatch[1]);
      if (!ds) return jsonResponse({ error: { code: 'not_found', message: 'Dataset not found.' } }, 404);
      const { columns, rows, ...meta } = ds;
      return jsonResponse({ dataset: meta });
    }

    const etlPreviewMatch = pathname.match(/^\/api\/etl\/datasets\/([^/]+)\/preview\/$/);
    if (etlPreviewMatch && method === 'GET') {
      const ds = state.datasets.find((d) => d.id === etlPreviewMatch[1]);
      if (!ds) return jsonResponse({ error: { code: 'not_found', message: 'Dataset not found.' } }, 404);
      return jsonResponse({
        preview: {
          initial_rows: null,
          final_rows: ds.rows.length,
          dropped_rows: 0,
          added_rows: 0,
          columns: ds.columns,
          rows: ds.rows.slice(0, 10),
        },
      });
    }

    const etlDatasetRowsMatch = pathname.match(/^\/api\/etl\/datasets\/([^/]+)\/rows\/$/);
    if (etlDatasetRowsMatch && method === 'GET') {
      const id = etlDatasetRowsMatch[1];
      const page = Number(searchParams.get('page') || 1);
      const pageSize = Number(searchParams.get('page_size') || 25);
      if (datasetRowsHandler) {
        const custom = datasetRowsHandler(id, { page, pageSize, state });
        if (custom) return custom;
      }
      const ds = state.datasets.find((d) => d.id === id);
      if (!ds) return jsonResponse({ error: { code: 'dataset_not_found', message: 'Dataset not found.' } }, 404);
      return jsonResponse(paginateRows(ds.columns, ds.rows, page, pageSize));
    }

    if (pathname === '/api/etl/pipelines/' && method === 'GET') {
      const page = Number(searchParams.get('page') || 1);
      return jsonResponse({
        pipelines: state.pipelines,
        page,
        total_pages: 1,
        total_count: state.pipelines.length,
      });
    }

    if (pathname === '/api/etl/pipelines/' && method === 'POST') {
      const body = JSON.parse(options.body);
      state.savedPipelines.push({ body, headers: options.headers || {} });
      const created = {
        id: PIPE_1,
        name: body.name,
        dataset_id: body.datasetId,
        step_count: body.steps.length,
        source_count: 1,
        configuration: body,
      };
      state.pipelines.push(created);
      return jsonResponse({ pipeline: created }, 201);
    }

    const pipelineDetailMatch = pathname.match(/^\/api\/etl\/pipelines\/([^/]+)\/$/);
    if (pipelineDetailMatch) {
      const id = pipelineDetailMatch[1];
      if (method === 'GET') {
        const p = state.pipelines.find((item) => item.id === id);
        if (!p) return jsonResponse({ error: { code: 'not_found', message: 'Pipeline not found.' } }, 404);
        return jsonResponse({ pipeline: p });
      }
      if (method === 'PUT') {
        const body = JSON.parse(options.body);
        state.savedPipelines.push({ body, headers: options.headers || {} });
        const idx = state.pipelines.findIndex((item) => item.id === id);
        const updated = {
          id,
          name: body.name,
          dataset_id: body.datasetId,
          step_count: body.steps.length,
          source_count: 1,
          configuration: body,
        };
        if (idx >= 0) state.pipelines[idx] = updated;
        return jsonResponse({ pipeline: updated });
      }
      if (method === 'DELETE') {
        state.pipelines = state.pipelines.filter((item) => item.id !== id);
        return jsonResponse({ deleted: true });
      }
    }

    if (pathname === '/api/etl/runs/' && method === 'GET') {
      const page = Number(searchParams.get('page') || 1);
      const statusFilter = searchParams.get('status') || '';
      const filtered = statusFilter ? state.runs.filter((r) => r.status === statusFilter) : state.runs;
      return jsonResponse({
        runs: filtered,
        page,
        total_pages: 1,
        total_count: filtered.length,
      });
    }

    if (pathname === '/api/etl/runs/' && method === 'POST') {
      const body = JSON.parse(options.body);
      state.submittedRuns.push({ body, headers: options.headers || {} });
      const primaryDs = state.datasets.find((d) => d.id === body.datasetId);
      const resultCols = primaryDs ? primaryDs.columns : ORDERS_COLUMNS;
      const resultRows = primaryDs ? primaryDs.rows.slice(0, 1) : ORDERS_ROWS.slice(0, 1);
      const newRun = {
        id: RUN_1,
        name: body.name,
        status: runPollSequences[RUN_1] ? runPollSequences[RUN_1][0] : 'succeeded',
        created_at: '2026-11-15T10:01:00Z',
        started_at: '2026-11-15T10:01:01Z',
        finished_at: '2026-11-15T10:01:03Z',
        configuration: body,
        summary: {
          initial_rows: primaryDs ? primaryDs.rows.length : resultRows.length,
          final_rows: resultRows.length,
          dropped_rows: primaryDs ? Math.max(0, primaryDs.rows.length - resultRows.length) : 0,
          added_rows: 0,
          columns: resultCols,
        },
        error: null,
        result_available: true,
        download_url: `/api/etl/runs/${RUN_1}/download/`,
        sources_meta: primaryDs ? {
          [primaryDs.id]: {
            id: primaryDs.id,
            filename: primaryDs.filename,
            format: primaryDs.format,
            size_bytes: primaryDs.size_bytes,
            available: true,
            matches_snapshot: true,
            is_primary: true,
          },
        } : {},
        resultColumns: resultCols,
        resultRows,
      };
      const existingIdx = state.runs.findIndex((r) => r.id === RUN_1);
      if (existingIdx >= 0) state.runs[existingIdx] = newRun;
      else state.runs.unshift(newRun);
      return jsonResponse({
        run: {
          id: newRun.id,
          name: newRun.name,
          status: 'queued',
          created_at: newRun.created_at,
          started_at: null,
          finished_at: null,
          summary: null,
          error: null,
          result_available: false,
          download_url: null,
        },
      }, 202);
    }

    const runDetailMatch = pathname.match(/^\/api\/etl\/runs\/([^/]+)\/$/);
    if (runDetailMatch && method === 'GET') {
      const id = runDetailMatch[1];
      const run = state.runs.find((r) => r.id === id);
      if (!run) return jsonResponse({ error: { code: 'not_found', message: 'Run not found.' } }, 404);
      if (runPollSequences[id] && runPollSequences[id].length > 0) {
        const nextStatus = runPollSequences[id].shift();
        run.status = nextStatus;
        if (nextStatus === 'queued') {
          return jsonResponse({
            run: {
              ...run,
              status: 'queued',
              started_at: null,
              finished_at: null,
              summary: null,
              result_available: false,
              download_url: null,
            },
          });
        }
        if (nextStatus === 'running') {
          return jsonResponse({
            run: {
              ...run,
              status: 'running',
              finished_at: null,
              summary: null,
              result_available: false,
              download_url: null,
            },
          });
        }
      }
      const { resultColumns, resultRows, ...publicRun } = run;
      return jsonResponse({ run: publicRun });
    }

    const runRowsMatch = pathname.match(/^\/api\/etl\/runs\/([^/]+)\/rows\/$/);
    if (runRowsMatch && method === 'GET') {
      const id = runRowsMatch[1];
      const page = Number(searchParams.get('page') || 1);
      const pageSize = Number(searchParams.get('page_size') || 25);
      if (runResultRowsHandler) {
        const custom = runResultRowsHandler(id, { page, pageSize, state });
        if (custom) return custom;
      }
      const run = state.runs.find((r) => r.id === id);
      if (!run) return jsonResponse({ error: { code: 'not_found', message: 'Run not found.' } }, 404);
      const cols = run.resultColumns || run.summary?.columns || ORDERS_COLUMNS;
      const rowsData = run.resultRows || ORDERS_ROWS;
      return jsonResponse(paginateRows(cols, rowsData, page, pageSize));
    }

    const runSourceRowsMatch = pathname.match(/^\/api\/etl\/runs\/([^/]+)\/source-rows\/$/);
    if (runSourceRowsMatch && method === 'GET') {
      const id = runSourceRowsMatch[1];
      const page = Number(searchParams.get('page') || 1);
      const pageSize = Number(searchParams.get('page_size') || 25);
      const datasetId = searchParams.get('dataset_id') || '';
      if (runSourceRowsHandler) {
        const custom = runSourceRowsHandler(id, { page, pageSize, datasetId, state });
        if (custom) return custom;
      }
      const run = state.runs.find((r) => r.id === id);
      if (!run) return jsonResponse({ error: { code: 'not_found', message: 'Run not found.' } }, 404);
      const targetDsId = datasetId || run.configuration?.datasetId || Object.keys(run.sources_meta || {})[0];
      const ds = state.datasets.find((d) => d.id === targetDsId);
      if (!ds) {
        return jsonResponse({ error: { code: 'dataset_not_found', message: 'Original dataset is no longer available.' } }, 404);
      }
      const meta = run.sources_meta?.[ds.id];
      if (meta && meta.matches_snapshot === false) {
        return jsonResponse({ error: { code: 'source_modified', message: 'Original dataset has been modified since this run.' } }, 409);
      }
      return jsonResponse({
        dataset_id: ds.id,
        filename: ds.filename,
        ...paginateRows(ds.columns, ds.rows, page, pageSize),
        matches_snapshot: true,
      });
    }

    const runDownloadMatch = pathname.match(/^\/api\/etl\/runs\/([^/]+)\/download\/$/);
    if (runDownloadMatch && method === 'GET') {
      return { ok: true, status: 200, blob: async () => state.downloadBlob };
    }

    const runDeleteResultMatch = pathname.match(/^\/api\/etl\/runs\/([^/]+)\/result\/$/);
    if (runDeleteResultMatch && method === 'DELETE') {
      const id = runDeleteResultMatch[1];
      const run = state.runs.find((r) => r.id === id);
      if (run) run.result_available = false;
      return jsonResponse({ deleted: true });
    }

    throw new Error(`Unhandled fetch route in E2ERequirements: ${method} ${pathname}${parsed.search}`);
  });

  fetchMock.state = state;
  return fetchMock;
}

function renderAt(route, fetchConfig) {
  const fetchMock = createFetchMock(fetchConfig);
  global.fetch = fetchMock;
  window.history.replaceState(null, '', route);
  const view = render(<App />);
  return { fetchMock, state: fetchMock.state, ...view };
}

async function waitForPipelineReady() {
  await screen.findByRole('heading', { name: /Source preview:/i });
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Add Clean text step' })).toBeEnabled();
  });
}

function getOptionValues(select) {
  return Array.from(select.options).map((o) => o.value);
}

function buildSucceededRun({
  id = RUN_1,
  name = 'Orders cleanup',
  datasetId = DS_ORDERS,
  steps = [
    { type: 'cast_type', enabled: true, config: { conversions: [{ column: 'total_amount', toType: 'int' }] } },
    { type: 'filter_rows', enabled: true, config: { conditions: [{ column: 'is_paid', operator: 'is_true', value: null }] } },
  ],
  sourceDataset = makeDataset(DS_ORDERS, 'orders.csv', 'csv', ORDERS_COLUMNS, ORDERS_ROWS),
  resultColumns = [
    { name: 'order_id', type: 'string' },
    { name: 'total_amount', type: 'integer' },
  ],
  resultRows = [
    { order_id: 'ORD01_OUT', total_amount: 1500000 },
    { order_id: 'ORD03_OUT', total_amount: 950000 },
  ],
  sourcesMeta = null,
  status = 'succeeded',
  error = null,
  resultAvailable = true,
} = {}) {
  return {
    id,
    name,
    status,
    created_at: '2026-11-15T10:00:00Z',
    started_at: '2026-11-15T10:00:01Z',
    finished_at: status === 'queued' || status === 'running' ? null : '2026-11-15T10:00:03Z',
    configuration: {
      schemaVersion: 1,
      name,
      datasetId,
      steps,
    },
    summary: status === 'succeeded' ? {
      initial_rows: sourceDataset.rows.length,
      final_rows: resultRows.length,
      dropped_rows: Math.max(0, sourceDataset.rows.length - resultRows.length),
      added_rows: 0,
      columns: resultColumns,
    } : null,
    error,
    result_available: status === 'succeeded' ? resultAvailable : false,
    download_url: status === 'succeeded' && resultAvailable ? `/api/etl/runs/${id}/download/` : null,
    sources_meta: sourcesMeta || {
      [sourceDataset.id]: {
        id: sourceDataset.id,
        filename: sourceDataset.filename,
        format: sourceDataset.format,
        size_bytes: sourceDataset.size_bytes,
        available: true,
        matches_snapshot: true,
        is_primary: true,
      },
    },
    resultColumns,
    resultRows,
  };
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.scrollTo = jest.fn();
  URL.createObjectURL = jest.fn(() => 'blob:e2e-download');
  URL.revokeObjectURL = jest.fn();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  delete global.fetch;
});

// =============================================================================
// TIER 1 — Isolated Requirement Coverage (18 Frontend Tests: 3 per Req R1–R6)
// =============================================================================

describe('Tier 1 — Isolated Requirement Coverage (R1–R6)', () => {
  test('T1-R1-F1: blocks running a 0-step pipeline and shows visible inline feedback without expanding details', async () => {
    const orders = makeDataset(DS_ORDERS, 'orders.csv', 'csv', ORDERS_COLUMNS, ORDERS_ROWS);
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, { datasets: [orders] });
    await waitForPipelineReady();

    const runButton = screen.getByRole('button', { name: 'Run pipeline' });
    expect(runButton).toBeDisabled();
    expect(runButton).toHaveAccessibleDescription(/step|transformation/i);
    expect(screen.getByText(/at least one.*(step|transformation)/i)).toBeVisible();
  });

  test('T1-R1-F2: adding 1 enabled step enables Run pipeline, submits POST /api/etl/runs/, and navigates to /dashboard/runs/:id', async () => {
    const orders = makeDataset(DS_ORDERS, 'orders.csv', 'csv', ORDERS_COLUMNS, ORDERS_ROWS);
    const { state } = renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, { datasets: [orders] });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Add Clean text step' }));

    const runButton = screen.getByRole('button', { name: 'Run pipeline' });
    expect(runButton).toBeEnabled();
    expect(runButton).toHaveAccessibleDescription(/Ready to run/i);

    await userEvent.click(runButton);
    await waitFor(() => expect(window.location.pathname).toBe(`/dashboard/runs/${RUN_1}`));
    expect(state.submittedRuns).toHaveLength(1);
    expect(state.submittedRuns[0].body.steps).toHaveLength(1);
    expect(state.submittedRuns[0].body.steps[0].type).toBe('string_transform');
    expect(state.submittedRuns[0].body.steps[0].enabled).toBe(true);
  });

  test('T1-R1-F3: allows saving a 0-step pipeline draft via Save pipeline', async () => {
    const orders = makeDataset(DS_ORDERS, 'orders.csv', 'csv', ORDERS_COLUMNS, ORDERS_ROWS);
    const { state } = renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, { datasets: [orders] });
    await waitForPipelineReady();

    const saveButton = screen.getByRole('button', { name: 'Save pipeline' });
    expect(saveButton).toBeEnabled();
    await userEvent.click(saveButton);

    await screen.findByText(/Saved "/i);
    expect(state.savedPipelines).toHaveLength(1);
    expect(state.savedPipelines[0].body.steps).toEqual([]);
  });

  test('T1-R2-F1: displays Format dates button on Clean tab when dataset contains a datetime column', async () => {
    const orders = makeDataset(DS_ORDERS, 'orders.csv', 'csv', ORDERS_COLUMNS, ORDERS_ROWS);
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, { datasets: [orders] });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Clean', exact: true }));
    expect(screen.getByRole('button', { name: /Format dates/i })).toBeInTheDocument();
  });

  test('T1-R2-F2: hides Format dates button on Clean tab when dataset has no datetime columns', async () => {
    const nodate = makeDataset(DS_NODATE, 'nodate.csv', 'csv', NODATE_COLUMNS, NODATE_ROWS);
    renderAt(`/dashboard/pipelines?datasets=${DS_NODATE}`, { datasets: [nodate] });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Clean', exact: true }));
    expect(screen.queryByRole('button', { name: /Format dates/i })).not.toBeInTheDocument();
  });

  test('T1-R2-F3: Date column picker in Format dates offers datetime columns and excludes non-date columns', async () => {
    const orders = makeDataset(DS_ORDERS, 'orders.csv', 'csv', ORDERS_COLUMNS, ORDERS_ROWS);
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, { datasets: [orders] });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Clean', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Format dates step' }));

    const dateSelect = screen.getByLabelText(/Date column/i);
    const values = getOptionValues(dateSelect).filter(Boolean);
    expect(values).toContain('order_date');
    expect(values).not.toContain('city');
    expect(values).not.toContain('quantity');
  });

  test('T1-R3-F1: Convert data type exposes only str, int, float, date and excludes boolean', async () => {
    const orders = makeDataset(DS_ORDERS, 'orders.csv', 'csv', ORDERS_COLUMNS, ORDERS_ROWS);
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, { datasets: [orders] });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Columns', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Convert data type step' }));

    const targetSelect = screen.getByLabelText(/Rule 1 target type/i);
    expect(getOptionValues(targetSelect)).toEqual(['str', 'int', 'float', 'date']);
    expect(Array.from(targetSelect.options).some((o) => /bool/i.test(o.value) || /bool/i.test(o.textContent))).toBe(false);
  });

  test('T1-R3-F2: allows selecting each canonical cast_type (str, int, float, date) and submits canonical toType', async () => {
    const nodate = makeDataset(DS_NODATE, 'nodate.csv', 'csv', NODATE_COLUMNS, NODATE_ROWS);
    const { state } = renderAt(`/dashboard/pipelines?datasets=${DS_NODATE}`, { datasets: [nodate] });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Columns', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Convert data type step' }));
    await userEvent.selectOptions(screen.getByLabelText('Rule 1 column'), 'amount');

    const targetSelect = screen.getByLabelText(/Rule 1 target type/i);
    for (const typeChoice of ['str', 'float', 'date', 'int']) {
      await userEvent.selectOptions(targetSelect, typeChoice);
      expect(targetSelect.value).toBe(typeChoice);
      expect(screen.getByRole('button', { name: 'Run pipeline' })).toHaveAccessibleDescription(/Ready to run/i);
    }

    await userEvent.click(screen.getByRole('button', { name: 'Run pipeline' }));
    await waitFor(() => expect(state.submittedRuns).toHaveLength(1));
    expect(state.submittedRuns[0].body.steps[0].config.conversions[0].toType).toBe('int');
  });

  test('T1-R3-F3: renders canonical cast_type options without console warnings or fallback to boolean', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const orders = makeDataset(DS_ORDERS, 'orders.csv', 'csv', ORDERS_COLUMNS, ORDERS_ROWS);
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, { datasets: [orders] });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Columns', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Convert data type step' }));

    const targetSelect = screen.getByLabelText(/Rule 1 target type/i);
    expect(getOptionValues(targetSelect)).toEqual(['str', 'int', 'float', 'date']);
    expect(targetSelect.value).not.toMatch(/bool/i);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('T1-R4-F1: Filter rows shows only numeric operators when an integer column is selected', async () => {
    const orders = makeDataset(DS_ORDERS, 'orders.csv', 'csv', ORDERS_COLUMNS, ORDERS_ROWS);
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, { datasets: [orders] });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Filter', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Filter rows step' }));
    await userEvent.selectOptions(screen.getByLabelText('Rule 1 column'), 'quantity');

    const opSelect = screen.getByLabelText('Rule 1 comparison');
    const ops = getOptionValues(opSelect);
    expect(new Set(ops)).toEqual(new Set(NUMERIC_OPS));
    expect(ops).toHaveLength(NUMERIC_OPS.length);
  });

  test('T1-R4-F2: Filter rows shows only string operators when a string column is selected', async () => {
    const orders = makeDataset(DS_ORDERS, 'orders.csv', 'csv', ORDERS_COLUMNS, ORDERS_ROWS);
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, { datasets: [orders] });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Filter', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Filter rows step' }));
    await userEvent.selectOptions(screen.getByLabelText('Rule 1 column'), 'city');

    const opSelect = screen.getByLabelText('Rule 1 comparison');
    const ops = getOptionValues(opSelect);
    expect(new Set(ops)).toEqual(new Set(STRING_OPS));
    expect(ops).toHaveLength(STRING_OPS.length);
  });

  test('T1-R4-F3: Filter rows shows only datetime operators for date columns and boolean operators (without value input) for boolean columns', async () => {
    const orders = makeDataset(DS_ORDERS, 'orders.csv', 'csv', ORDERS_COLUMNS, ORDERS_ROWS);
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, { datasets: [orders] });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Filter', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Filter rows step' }));

    await userEvent.selectOptions(screen.getByLabelText('Rule 1 column'), 'order_date');
    const opSelect = screen.getByLabelText('Rule 1 comparison');
    expect(new Set(getOptionValues(opSelect))).toEqual(new Set(DATETIME_OPS));
    expect(getOptionValues(opSelect)).toHaveLength(DATETIME_OPS.length);

    await userEvent.selectOptions(screen.getByLabelText('Rule 1 column'), 'is_paid');
    expect(new Set(getOptionValues(opSelect))).toEqual(new Set(BOOLEAN_OPS));
    expect(getOptionValues(opSelect)).toHaveLength(BOOLEAN_OPS.length);
    expect(screen.queryByLabelText('Rule 1 comparison value')).not.toBeInTheDocument();
  });

  test('T1-R5-F1: on /dashboard/datasets, clicking Review data on an uploaded queue item fetches /rows/ and displays DataTable', async () => {
    const uploaded = makeDataset(DS_UPLOADED, 'fresh_orders.csv', 'csv', ORDERS_COLUMNS, ORDERS_ROWS);
    const { state } = renderAt('/dashboard/datasets', { datasets: [], uploadDataset: uploaded });
    await screen.findByText('No datasets yet');

    const file = new File(['order_id,city\nORD01,Hanoi\n'], 'fresh_orders.csv', { type: 'text/csv' });
    fireEvent.change(screen.getByLabelText('Choose files'), { target: { files: [file] } });
    await userEvent.click(screen.getByRole('button', { name: 'Upload 1 file' }));

    const uploadResults = await screen.findByRole('list', { name: 'Upload results' });
    await within(uploadResults).findByText(/Uploaded/i);

    await userEvent.click(within(uploadResults).getByRole('button', { name: /Review data/i }));
    expect(await screen.findByRole('cell', { name: 'ORD01' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Hanoi' })).toBeInTheDocument();
    expect(state.requests.some((r) => r.method === 'GET' && r.pathname === `/api/etl/datasets/${DS_UPLOADED}/rows/`)).toBe(true);
  });

  test('T1-R5-F2: on /dashboard/datasets, clicking Review data on an existing dataset table row renders DataTable and Pagination', async () => {
    const orders = makeDataset(DS_ORDERS, 'orders.csv', 'csv', ORDERS_COLUMNS, ORDERS_ROWS);
    renderAt('/dashboard/datasets', { datasets: [orders] });

    await screen.findByRole('rowheader', { name: 'orders.csv' });
    const row = screen.getByRole('row', { name: /orders\.csv/i });
    await userEvent.click(within(row).getByRole('button', { name: /Review data/i }));

    expect(await screen.findByRole('cell', { name: 'ORD01' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Danang' })).toBeInTheDocument();
    const reviewNav = screen.getAllByRole('navigation').find((nav) => !['Workspace', 'Dataset pages'].includes(nav.getAttribute('aria-label')));
    expect(reviewNav).toBeDefined();
    expect(reviewNav).toHaveTextContent(/Page 1 of 1/i);
  });

  test('T1-R5-F3: paginates Next page and updates page_size inside the dataset review panel', async () => {
    const manyRows = Array.from({ length: 30 }, (_, idx) => ({
      order_id: `ORD${String(idx + 1).padStart(2, '0')}`,
      city: idx < 25 ? 'CityPage1' : 'CityPage2',
      quantity: idx + 1,
      total_amount: 1000,
      order_date: '2026-10-01',
      is_paid: true,
    }));
    const bigDs = makeDataset(DS_ORDERS, 'big_orders.csv', 'csv', ORDERS_COLUMNS, manyRows);
    const { state } = renderAt('/dashboard/datasets', { datasets: [bigDs] });

    await screen.findByRole('rowheader', { name: 'big_orders.csv' });
    const row = screen.getByRole('row', { name: /big_orders\.csv/i });
    await userEvent.click(within(row).getByRole('button', { name: /Review data/i }));
    expect(await screen.findByRole('cell', { name: 'ORD01' })).toBeInTheDocument();

    const reviewNav = screen.getAllByRole('navigation').find((nav) => !['Workspace', 'Dataset pages'].includes(nav.getAttribute('aria-label')));
    await userEvent.click(within(reviewNav).getByRole('button', { name: /Next/i }));
    expect(await screen.findByRole('cell', { name: 'ORD26' })).toBeInTheDocument();
    expect(screen.queryByRole('cell', { name: 'ORD01' })).not.toBeInTheDocument();

    const pageSizeSelect = screen.getByLabelText(/Rows per page|Page size/i);
    await userEvent.selectOptions(pageSizeSelect, '50');
    await waitFor(() => {
      expect(state.requests.some((r) => r.pathname === `/api/etl/datasets/${DS_ORDERS}/rows/` && r.search.includes('page_size=50'))).toBe(true);
    });
    expect(await screen.findByRole('cell', { name: 'ORD30' })).toBeInTheDocument();
  });

  test('T1-R6-F1: /dashboard/runs/:id renders unified run summary, readable pipeline steps, original vs result comparison, and download controls', async () => {
    const orders = makeDataset(DS_ORDERS, 'orders.csv', 'csv', ORDERS_COLUMNS, ORDERS_ROWS);
    const run = buildSucceededRun({ sourceDataset: orders });
    renderAt(`/dashboard/runs/${RUN_1}`, { datasets: [orders], runs: [run] });

    expect(await screen.findByRole('heading', { name: /Pipeline steps/i })).toBeInTheDocument();
    expect(screen.getByText(/Convert data type/i)).toBeInTheDocument();
    expect(screen.getByText(/Filter rows/i)).toBeInTheDocument();
    expect(screen.getAllByText(/total_amount/i).length).toBeGreaterThanOrEqual(1);

    expect(await screen.findByRole('cell', { name: 'ORD01' })).toBeInTheDocument();
    expect(await screen.findByRole('cell', { name: 'ORD01_OUT' })).toBeInTheDocument();
    expect(screen.getByLabelText(/File format/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Download full result/i })).toBeInTheDocument();
  });

  test('T1-R6-F2: /dashboard/results/:id renders the same unified view with steps, original-vs-result comparison, and download/delete', async () => {
    const orders = makeDataset(DS_ORDERS, 'orders.csv', 'csv', ORDERS_COLUMNS, ORDERS_ROWS);
    const run = buildSucceededRun({ sourceDataset: orders });
    renderAt(`/dashboard/results/${RUN_1}`, { datasets: [orders], runs: [run] });

    expect(await screen.findByRole('heading', { name: /Pipeline steps/i })).toBeInTheDocument();
    expect(await screen.findByRole('cell', { name: 'ORD01' })).toBeInTheDocument();
    expect(await screen.findByRole('cell', { name: 'ORD01_OUT' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Download full result/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Delete result file/i })).toBeInTheDocument();
  });

  test('T1-R6-F3: /dashboard/runs shows a unified link to the combined run/result detail view instead of split Run details + View result links', async () => {
    const orders = makeDataset(DS_ORDERS, 'orders.csv', 'csv', ORDERS_COLUMNS, ORDERS_ROWS);
    const run = buildSucceededRun({ sourceDataset: orders });
    renderAt('/dashboard/runs', { datasets: [orders], runs: [run] });

    await screen.findByRole('rowheader', { name: 'Orders cleanup' });
    const row = screen.getByRole('row', { name: /Orders cleanup/i });
    const actionLinks = within(row).getAllByRole('link').filter((link) => !/Orders cleanup/i.test(link.textContent));
    expect(actionLinks).toHaveLength(1);
    expect(actionLinks[0]).toHaveAttribute('href', expect.stringMatching(new RegExp(`/dashboard/(runs|results)/${RUN_1}`)));
    expect(actionLinks[0].textContent).toMatch(/view/i);
  });
});

// =============================================================================
// TIER 2 — Boundary, Negative & Corner Cases (19 Frontend Tests)
// =============================================================================

describe('Tier 2 — Boundary, Negative & Corner Cases (R1–R6)', () => {
  test('T2-R1-F1: unchecking Enable step 1 disables Run pipeline and surfaces step-requirement feedback', async () => {
    const orders = makeDataset(DS_ORDERS, 'orders.csv', 'csv', ORDERS_COLUMNS, ORDERS_ROWS);
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, { datasets: [orders] });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Add Clean text step' }));
    expect(screen.getByRole('button', { name: 'Run pipeline' })).toBeEnabled();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Enable step 1' }));
    expect(screen.getByRole('button', { name: 'Run pipeline' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Run pipeline' })).toHaveAccessibleDescription(/step|transformation|enabled/i);
  });

  test('T2-R1-F2: re-enabling then removing step 1 disables Run pipeline again and re-displays validation error', async () => {
    const orders = makeDataset(DS_ORDERS, 'orders.csv', 'csv', ORDERS_COLUMNS, ORDERS_ROWS);
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, { datasets: [orders] });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Add Clean text step' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Enable step 1' }));
    expect(screen.getByRole('button', { name: 'Run pipeline' })).toBeDisabled();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Enable step 1' }));
    expect(screen.getByRole('button', { name: 'Run pipeline' })).toBeEnabled();

    await userEvent.click(screen.getByRole('button', { name: 'Remove step 1' }));
    expect(screen.getByRole('button', { name: 'Run pipeline' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Run pipeline' })).toHaveAccessibleDescription(/step|transformation/i);
  });

  test('T2-R1-F3: loading a saved 0-step draft via ?pipeline=<id> loads cleanly with Run pipeline disabled', async () => {
    const orders = makeDataset(DS_ORDERS, 'orders.csv', 'csv', ORDERS_COLUMNS, ORDERS_ROWS);
    const draft = {
      id: PIPE_1,
      name: 'Empty draft',
      dataset_id: DS_ORDERS,
      step_count: 0,
      source_count: 1,
      configuration: { schemaVersion: 1, name: 'Empty draft', datasetId: DS_ORDERS, steps: [] },
    };
    renderAt(`/dashboard/pipelines?pipeline=${PIPE_1}`, { datasets: [orders], pipelines: [draft] });
    await waitForPipelineReady();

    expect(screen.getByLabelText(/Pipeline name/i)).toHaveValue('Empty draft');
    expect(screen.getByRole('button', { name: 'Run pipeline' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Run pipeline' })).toHaveAccessibleDescription(/step|transformation/i);
  });

  test('T2-R2-F1: Format dates dynamically appears after cast_type converts a string column to date', async () => {
    const nodate = makeDataset(DS_NODATE, 'nodate.csv', 'csv', NODATE_COLUMNS, NODATE_ROWS);
    renderAt(`/dashboard/pipelines?datasets=${DS_NODATE}`, { datasets: [nodate] });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Clean', exact: true }));
    expect(screen.queryByRole('button', { name: /Format dates/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Columns', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Convert data type step' }));
    await userEvent.selectOptions(screen.getByLabelText('Rule 1 column'), 'raw_date');
    await userEvent.selectOptions(screen.getByLabelText(/Rule 1 target type/i), 'date');

    await userEvent.click(screen.getByRole('button', { name: 'Clean', exact: true }));
    const formatBtn = screen.getByRole('button', { name: /Format dates/i });
    expect(formatBtn).toBeInTheDocument();

    await userEvent.click(formatBtn);
    const dateColValues = getOptionValues(screen.getByLabelText(/Date column/i)).filter(Boolean);
    expect(dateColValues).toContain('raw_date');
    expect(dateColValues).not.toContain('item_id');
  });

  test('T2-R2-F2: Format dates dynamically disappears when the only date column is cast to str', async () => {
    const orders = makeDataset(DS_ORDERS, 'orders.csv', 'csv', ORDERS_COLUMNS, ORDERS_ROWS);
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, { datasets: [orders] });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Clean', exact: true }));
    expect(screen.getByRole('button', { name: /Format dates/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Columns', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Convert data type step' }));
    await userEvent.selectOptions(screen.getByLabelText('Rule 1 column'), 'order_date');
    await userEvent.selectOptions(screen.getByLabelText(/Rule 1 target type/i), 'str');

    await userEvent.click(screen.getByRole('button', { name: 'Clean', exact: true }));
    expect(screen.queryByRole('button', { name: /Format dates/i })).not.toBeInTheDocument();
  });

  test('T2-R2-F3: Format dates disappears when select_columns projects out the date column', async () => {
    const orders = makeDataset(DS_ORDERS, 'orders.csv', 'csv', ORDERS_COLUMNS, ORDERS_ROWS);
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, { datasets: [orders] });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Columns', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Select columns step' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'order_date' }));

    await userEvent.click(screen.getByRole('button', { name: 'Clean', exact: true }));
    expect(screen.queryByRole('button', { name: /Format dates/i })).not.toBeInTheDocument();
  });

  test('T2-R2-F4: Format dates toggles visibility when switching active source tab between date and non-date sources', async () => {
    const orders = makeDataset(DS_ORDERS, 'orders.csv', 'csv', ORDERS_COLUMNS, ORDERS_ROWS);
    const nodate = makeDataset(DS_NODATE, 'nodate.csv', 'csv', NODATE_COLUMNS, NODATE_ROWS);
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS},${DS_NODATE}`, { datasets: [orders, nodate] });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Clean', exact: true }));
    expect(screen.getByRole('button', { name: /Format dates/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: /nodate\.csv/i }));
    expect(screen.queryByRole('button', { name: /Format dates/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: /orders\.csv/i }));
    expect(screen.getByRole('button', { name: /Format dates/i })).toBeInTheDocument();
  });

  test('T2-R3-F1: loading a saved pipeline with legacy cast_type toType=boolean flags validation error and disables Run pipeline', async () => {
    const orders = makeDataset(DS_ORDERS, 'orders.csv', 'csv', ORDERS_COLUMNS, ORDERS_ROWS);
    const legacyPipe = {
      id: PIPE_1,
      name: 'Legacy boolean cast',
      dataset_id: DS_ORDERS,
      step_count: 1,
      source_count: 1,
      configuration: {
        schemaVersion: 1,
        name: 'Legacy boolean cast',
        datasetId: DS_ORDERS,
        steps: [{ type: 'cast_type', enabled: true, config: { conversions: [{ column: 'city', toType: 'boolean' }] } }],
      },
    };
    renderAt(`/dashboard/pipelines?pipeline=${PIPE_1}`, { datasets: [orders], pipelines: [legacyPipe] });
    await waitForPipelineReady();

    expect(screen.getByRole('button', { name: 'Run pipeline' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Run pipeline' })).toHaveAccessibleDescription(/boolean|target type|conversion|str.*int.*float.*date/i);
  });

  test('T2-R3-F2: Rule 1 target type option values are strictly [str, int, float, date] with zero boolean options', async () => {
    const orders = makeDataset(DS_ORDERS, 'orders.csv', 'csv', ORDERS_COLUMNS, ORDERS_ROWS);
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, { datasets: [orders] });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Columns', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Convert data type step' }));

    const select = screen.getByLabelText(/Rule 1 target type/i);
    expect(getOptionValues(select)).toEqual(['str', 'int', 'float', 'date']);
    expect(screen.queryByRole('option', { name: /bool/i })).toBeNull();
  });

  test('T2-R3-F3: multi-rule cast_type step restricts both Rule 1 and Rule 2 target types to str, int, float, date', async () => {
    const orders = makeDataset(DS_ORDERS, 'orders.csv', 'csv', ORDERS_COLUMNS, ORDERS_ROWS);
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, { datasets: [orders] });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Columns', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Convert data type step' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add rule' }));

    expect(getOptionValues(screen.getByLabelText(/Rule 1 target type/i))).toEqual(['str', 'int', 'float', 'date']);
    expect(getOptionValues(screen.getByLabelText(/Rule 2 target type/i))).toEqual(['str', 'int', 'float', 'date']);
  });

  test('T2-R4-F1: switching filter_rows column from integer to string auto-resets incompatible operator and clears value', async () => {
    const orders = makeDataset(DS_ORDERS, 'orders.csv', 'csv', ORDERS_COLUMNS, ORDERS_ROWS);
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, { datasets: [orders] });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Filter', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Filter rows step' }));

    const colSelect = screen.getByLabelText('Rule 1 column');
    const opSelect = screen.getByLabelText('Rule 1 comparison');

    await userEvent.selectOptions(colSelect, 'quantity');
    await userEvent.selectOptions(opSelect, 'greater_than');
    await userEvent.type(screen.getByLabelText('Rule 1 comparison value'), '5');

    await userEvent.selectOptions(colSelect, 'city');
    expect(STRING_OPS).toContain(opSelect.value);
    expect(opSelect.value).not.toBe('greater_than');
    expect(screen.getByLabelText('Rule 1 comparison value')).toHaveValue('');
  });

  test('T2-R4-F2: switching filter_rows column across string -> datetime -> boolean resets operator and hides value for boolean', async () => {
    const orders = makeDataset(DS_ORDERS, 'orders.csv', 'csv', ORDERS_COLUMNS, ORDERS_ROWS);
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, { datasets: [orders] });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Filter', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Filter rows step' }));

    const colSelect = screen.getByLabelText('Rule 1 column');
    const opSelect = screen.getByLabelText('Rule 1 comparison');

    await userEvent.selectOptions(colSelect, 'city');
    await userEvent.selectOptions(opSelect, 'contains');
    await userEvent.type(screen.getByLabelText('Rule 1 comparison value'), 'Hanoi');

    await userEvent.selectOptions(colSelect, 'order_date');
    expect(DATETIME_OPS).toContain(opSelect.value);
    expect(screen.getByLabelText('Rule 1 comparison value')).toHaveValue('');

    await userEvent.selectOptions(colSelect, 'is_paid');
    expect(BOOLEAN_OPS).toContain(opSelect.value);
    expect(screen.queryByLabelText('Rule 1 comparison value')).not.toBeInTheDocument();
  });

  test('T2-R4-F3: loading a pipeline with cross-type filter_rows operator flags validation error and disables Run pipeline', async () => {
    const orders = makeDataset(DS_ORDERS, 'orders.csv', 'csv', ORDERS_COLUMNS, ORDERS_ROWS);
    const badFilterPipe = {
      id: PIPE_1,
      name: 'Invalid filter op',
      dataset_id: DS_ORDERS,
      step_count: 1,
      source_count: 1,
      configuration: {
        schemaVersion: 1,
        name: 'Invalid filter op',
        datasetId: DS_ORDERS,
        steps: [{ type: 'filter_rows', enabled: true, config: { conditions: [{ column: 'city', operator: 'greater_than', value: 5 }] } }],
      },
    };
    renderAt(`/dashboard/pipelines?pipeline=${PIPE_1}`, { datasets: [orders], pipelines: [badFilterPipe] });
    await waitForPipelineReady();

    expect(screen.getByRole('button', { name: 'Run pipeline' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Run pipeline' })).toHaveAccessibleDescription(/operator|comparison|numeric|type|compatible/i);
  });

  test('T2-R5-F1: Review data displays accessible alert and Retry recovers after 503 error', async () => {
    const orders = makeDataset(DS_ORDERS, 'orders.csv', 'csv', ORDERS_COLUMNS, ORDERS_ROWS);
    let attempts = 0;
    renderAt('/dashboard/datasets', {
      datasets: [orders],
      datasetRowsHandler: () => {
        attempts += 1;
        if (attempts === 1) {
          return jsonResponse({ error: { code: 'service_unavailable', message: 'Preview service temporarily unavailable.' } }, 503);
        }
        return null;
      },
    });

    await screen.findByRole('rowheader', { name: 'orders.csv' });
    const row = screen.getByRole('row', { name: /orders\.csv/i });
    await userEvent.click(within(row).getByRole('button', { name: /Review data/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/unavailable/i);
    const retryBtn = screen.getByRole('button', { name: /Retry/i });
    await userEvent.click(retryBtn);

    expect(await screen.findByRole('cell', { name: 'ORD01' })).toBeInTheDocument();
  });

  test('T2-R5-F2: deleting the dataset currently open in Review data clears/closes the review panel', async () => {
    const orders = makeDataset(DS_ORDERS, 'orders.csv', 'csv', ORDERS_COLUMNS, ORDERS_ROWS);
    renderAt('/dashboard/datasets', { datasets: [orders] });

    await screen.findByRole('rowheader', { name: 'orders.csv' });
    const row = screen.getByRole('row', { name: /orders\.csv/i });
    await userEvent.click(within(row).getByRole('button', { name: /Review data/i }));
    expect(await screen.findByRole('cell', { name: 'ORD01' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Delete orders.csv' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Confirm deletion' }));

    await screen.findByText(/orders\.csv deleted/i);
    expect(screen.queryByRole('cell', { name: 'ORD01' })).not.toBeInTheDocument();
  });

  test('T2-R5-F3: replacing the dataset currently open in Review data clears stale v1 rows or refreshes with v2 rows', async () => {
    const ordersV1 = makeDataset(DS_ORDERS, 'orders.csv', 'csv', [{ name: 'order_id', type: 'string' }], [{ order_id: 'OLD_V1_ROW' }]);
    renderAt('/dashboard/datasets', {
      datasets: [ordersV1],
      replaceHandler: (ds) => ({
        ...ds,
        filename: 'orders.csv',
        rows: [{ order_id: 'NEW_V2_ROW' }],
      }),
    });

    await screen.findByRole('rowheader', { name: 'orders.csv' });
    const row = screen.getByRole('row', { name: /orders\.csv/i });
    await userEvent.click(within(row).getByRole('button', { name: /Review data/i }));
    expect(await screen.findByRole('cell', { name: 'OLD_V1_ROW' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Replace orders.csv' }));
    const replacementInput = await screen.findByLabelText('Replacement file');
    const fileV2 = new File(['order_id\nNEW_V2_ROW\n'], 'orders_v2.csv', { type: 'text/csv' });
    fireEvent.change(replacementInput, { target: { files: [fileV2] } });
    await userEvent.click(screen.getByRole('button', { name: 'Confirm replacement' }));

    await screen.findByText(/orders\.csv replaced/i);
    await waitFor(() => {
      expect(screen.queryByRole('cell', { name: 'OLD_V1_ROW' })).not.toBeInTheDocument();
    });
  });

  test('T2-R6-F1: /dashboard/runs/:id displays pipeline steps immediately while polling queued -> running -> succeeded, then loads comparison tables', async () => {
    jest.useFakeTimers();
    const orders = makeDataset(DS_ORDERS, 'orders.csv', 'csv', ORDERS_COLUMNS, ORDERS_ROWS);
    const run = buildSucceededRun({ sourceDataset: orders });

    renderAt(`/dashboard/runs/${RUN_1}`, {
      datasets: [orders],
      runs: [run],
      runPollSequences: { [RUN_1]: ['queued', 'running', 'succeeded'] },
    });

    expect((await screen.findAllByText('Queued')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('heading', { name: /Pipeline steps/i })).toBeInTheDocument();

    await act(async () => { jest.advanceTimersByTime(2000); });
    expect(screen.getAllByText('Running').length).toBeGreaterThanOrEqual(1);

    await act(async () => { jest.advanceTimersByTime(2000); });
    expect(await screen.findByRole('cell', { name: 'ORD01' })).toBeInTheDocument();
    expect(await screen.findByRole('cell', { name: 'ORD01_OUT' })).toBeInTheDocument();
  });

  test('T2-R6-F2: failed run displays error alert and pipeline steps without result table or download controls', async () => {
    const orders = makeDataset(DS_ORDERS, 'orders.csv', 'csv', ORDERS_COLUMNS, ORDERS_ROWS);
    const failedRun = buildSucceededRun({
      sourceDataset: orders,
      status: 'failed',
      error: { code: 'invalid_column_type', message: 'Cannot apply numeric comparison to text column.' },
      resultAvailable: false,
    });

    renderAt(`/dashboard/runs/${RUN_1}`, { datasets: [orders], runs: [failedRun] });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Cannot apply numeric comparison to text column/i);
    expect(screen.getByRole('heading', { name: /Pipeline steps/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Download full result/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('cell', { name: 'ORD01_OUT' })).not.toBeInTheDocument();
  });

  test('T2-R6-F2b: succeeded run with deleted original dataset (404) shows graceful comparison fallback while keeping result table & download', async () => {
    const orders = makeDataset(DS_ORDERS, 'orders.csv', 'csv', ORDERS_COLUMNS, ORDERS_ROWS);
    const run = buildSucceededRun({
      sourceDataset: orders,
      sourcesMeta: {
        [DS_ORDERS]: {
          id: DS_ORDERS,
          filename: 'orders.csv',
          format: 'csv',
          size_bytes: 2048,
          available: false,
          matches_snapshot: false,
          is_primary: true,
        },
      },
    });
    renderAt(`/dashboard/runs/${RUN_1}`, {
      datasets: [],
      runs: [run],
      runSourceRowsHandler: () => jsonResponse({
        error: { code: 'dataset_not_found', message: 'Original dataset was deleted.' },
      }, 404),
    });

    expect(await screen.findByRole('cell', { name: 'ORD01_OUT' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Download full result/i })).toBeEnabled();
    expect(screen.getByText(/deleted|unavailable|no longer available|not found/i)).toBeInTheDocument();
  });
});

// =============================================================================
// TIER 3 — Cross-Feature Combination Workflows (4 Frontend Tests)
// =============================================================================

describe('Tier 3 — Cross-Feature Combinations (Frontend)', () => {
  test('T3-5 (R5+R2+R1+R3): upload -> Review data -> pipeline builder -> cast text date to date -> Format dates appears -> Run pipeline', async () => {
    const uploaded = makeDataset(DS_NODATE, 'events.csv', 'csv', NODATE_COLUMNS, NODATE_ROWS);
    const { state } = renderAt('/dashboard/datasets', { datasets: [], uploadDataset: uploaded });
    await screen.findByText('No datasets yet');

    const file = new File(['item_id,raw_date,amount\n1,2026-10-01,1200\n'], 'events.csv', { type: 'text/csv' });
    fireEvent.change(screen.getByLabelText('Choose files'), { target: { files: [file] } });
    await userEvent.click(screen.getByRole('button', { name: 'Upload 1 file' }));

    const uploadResults = await screen.findByRole('list', { name: 'Upload results' });
    await within(uploadResults).findByText(/Uploaded/i);
    await userEvent.click(within(uploadResults).getByRole('button', { name: /Review data/i }));
    expect(await screen.findByRole('cell', { name: '2026-10-01' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Use uploaded files' }));
    await waitForPipelineReady();

    expect(screen.getByRole('button', { name: 'Run pipeline' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Clean', exact: true }));
    expect(screen.queryByRole('button', { name: /Format dates/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Columns', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Convert data type step' }));
    const targetTypeSelect = screen.getByLabelText(/Rule 1 target type/i);
    expect(getOptionValues(targetTypeSelect)).toEqual(['str', 'int', 'float', 'date']);
    await userEvent.selectOptions(screen.getByLabelText('Rule 1 column'), 'raw_date');
    await userEvent.selectOptions(targetTypeSelect, 'date');

    await userEvent.click(screen.getByRole('button', { name: 'Clean', exact: true }));
    const formatDatesBtn = screen.getByRole('button', { name: /Format dates/i });
    expect(formatDatesBtn).toBeInTheDocument();
    await userEvent.click(formatDatesBtn);
    await userEvent.selectOptions(screen.getByLabelText(/Date column/i), 'raw_date');

    await userEvent.click(screen.getByRole('button', { name: 'Run pipeline' }));
    await waitFor(() => expect(window.location.pathname).toBe(`/dashboard/runs/${RUN_1}`));
    expect(state.submittedRuns[0].body.steps.map((s) => s.type)).toEqual(['cast_type', 'format_datetime']);
  });

  test('T3-6 (R3+R4+R2): dynamic schema propagation across cast_type -> filter_rows -> select_columns -> Format dates -> step toggle', async () => {
    const schemaCols = [
      { name: 'order_date', type: 'datetime' },
      { name: 'amount', type: 'string' },
    ];
    const ds = makeDataset(DS_ORDERS, 'dynamic.csv', 'csv', schemaCols, [
      { order_date: '2026-10-01', amount: '1500' },
    ]);
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, { datasets: [ds] });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Columns', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Convert data type step' }));
    await userEvent.selectOptions(screen.getByLabelText('Rule 1 column'), 'amount');
    await userEvent.selectOptions(screen.getByLabelText(/Rule 1 target type/i), 'int');

    await userEvent.click(screen.getByRole('button', { name: 'Filter', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Filter rows step' }));
    await userEvent.selectOptions(screen.getByLabelText('Rule 1 column'), 'amount');
    expect(new Set(getOptionValues(screen.getByLabelText('Rule 1 comparison')))).toEqual(new Set(NUMERIC_OPS));
    await userEvent.selectOptions(screen.getByLabelText('Rule 1 comparison'), 'greater_than');
    await userEvent.type(screen.getByLabelText('Rule 1 comparison value'), '100');

    await userEvent.click(screen.getByRole('button', { name: 'Columns', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Select columns step' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'order_date' }));

    await userEvent.click(screen.getByRole('button', { name: 'Clean', exact: true }));
    expect(screen.queryByRole('button', { name: /Format dates/i })).not.toBeInTheDocument();

    for (const stepLabel of [/^1\s*Convert data type/i, /^2\s*Filter rows/i, /^3\s*Select columns/i]) {
      await userEvent.click(screen.getByRole('button', { name: stepLabel }));
      const idx = stepLabel.source.match(/\d/)[0];
      await userEvent.click(screen.getByRole('checkbox', { name: `Enable step ${idx}` }));
    }
    expect(screen.getByRole('button', { name: 'Run pipeline' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: /^1\s*Convert data type/i }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Enable step 1' }));
    expect(screen.getByRole('button', { name: 'Run pipeline' })).toBeEnabled();
  });

  test('T3-7 (R1+R6): save 0-step draft, keep Run blocked while step disabled, enable + run, inspect unified view steps & comparison', async () => {
    const orders = makeDataset(DS_ORDERS, 'orders.csv', 'csv', ORDERS_COLUMNS, ORDERS_ROWS);
    const { state } = renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, { datasets: [orders] });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Save pipeline' }));
    await screen.findByText(/Saved "/i);
    expect(state.savedPipelines[0].body.steps).toEqual([]);

    await userEvent.click(screen.getByRole('button', { name: 'Add Clean text step' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Enable step 1' }));
    expect(screen.getByRole('button', { name: 'Run pipeline' })).toBeDisabled();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Enable step 1' }));
    await userEvent.click(screen.getByRole('button', { name: 'Filter', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Filter rows step' }));
    await userEvent.selectOptions(screen.getByLabelText('Rule 1 column'), 'quantity');
    await userEvent.selectOptions(screen.getByLabelText('Rule 1 comparison'), 'greater_than');
    await userEvent.type(screen.getByLabelText('Rule 1 comparison value'), '1');

    await userEvent.click(screen.getByRole('button', { name: 'Run pipeline' }));
    await waitFor(() => expect(window.location.pathname).toBe(`/dashboard/runs/${RUN_1}`));

    expect(await screen.findByRole('heading', { name: /Pipeline steps/i })).toBeInTheDocument();
    expect(screen.getAllByText(/Clean text/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Filter rows/i).length).toBeGreaterThanOrEqual(1);
    expect((await screen.findAllByRole('cell', { name: 'ORD01' })).length).toBeGreaterThanOrEqual(1);
  });

  test('T3-8 (R5+R6): snapshot-modified warning (409) in unified run view + Review data shows replaced v2 rows in DatasetsPage', async () => {
    const ordersV2 = makeDataset(DS_ORDERS, 'orders.csv', 'csv', [{ name: 'order_id', type: 'string' }], [{ order_id: 'V2_REPLACED_ROW' }]);
    const run = buildSucceededRun({
      sourceDataset: ordersV2,
      resultColumns: [{ name: 'order_id', type: 'string' }],
      resultRows: [{ order_id: 'V1_RESULT_ROW' }],
      sourcesMeta: {
        [DS_ORDERS]: {
          id: DS_ORDERS,
          filename: 'orders.csv',
          format: 'csv',
          size_bytes: 2048,
          available: true,
          matches_snapshot: false,
          is_primary: true,
        },
      },
    });

    renderAt(`/dashboard/runs/${RUN_1}`, {
      datasets: [ordersV2],
      runs: [run],
      runSourceRowsHandler: () => jsonResponse({
        error: { code: 'source_modified', message: 'The original dataset was replaced after this run.' },
      }, 409),
    });

    expect(await screen.findByRole('cell', { name: 'V1_RESULT_ROW' })).toBeInTheDocument();
    expect(screen.getByText(/modified|replaced|snapshot/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Download full result/i })).toBeEnabled();

    await userEvent.click(screen.getByRole('link', { name: 'Datasets' }));
    await screen.findByRole('rowheader', { name: 'orders.csv' });
    const row = screen.getByRole('row', { name: /orders\.csv/i });
    await userEvent.click(within(row).getByRole('button', { name: /Review data/i }));
    expect(await screen.findByRole('cell', { name: 'V2_REPLACED_ROW' })).toBeInTheDocument();
  });
});

// =============================================================================
// TIER 4 — Real-World End-to-End Browser Scenarios (3 Frontend Tests)
// =============================================================================

describe('Tier 4 — Real-World Application Scenarios (Frontend)', () => {
  test('T4-4: E-Commerce Orders end-to-end journey (upload -> Review data -> build -> poll -> unified compare -> CSV download)', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const anchorClickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const orders = makeDataset(DS_ORDERS, 'orders.csv', 'csv', ORDERS_COLUMNS, ORDERS_ROWS);

    try {
      const { state } = renderAt('/dashboard/datasets', {
        datasets: [],
        uploadDataset: orders,
        runPollSequences: { [RUN_1]: ['queued', 'running', 'succeeded'] },
      });
      await screen.findByText('No datasets yet');

      const csvFile = new File(['order_id,city,quantity,total_amount,order_date,is_paid\nORD01,Hanoi,2,1500000,2026-10-01,true\n'], 'orders.csv', { type: 'text/csv' });
      fireEvent.change(screen.getByLabelText('Choose files'), { target: { files: [csvFile] } });
      await userEvent.click(screen.getByRole('button', { name: 'Upload 1 file' }));

      const uploadList = await screen.findByRole('list', { name: 'Upload results' });
      await within(uploadList).findByText(/Uploaded/i);
      await userEvent.click(within(uploadList).getByRole('button', { name: /Review data/i }));
      expect(await screen.findByRole('cell', { name: 'ORD01' })).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Use uploaded files' }));
      await waitForPipelineReady();

      await userEvent.click(screen.getByRole('button', { name: 'Clean', exact: true }));
      expect(screen.getByRole('button', { name: /Format dates/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Run pipeline' })).toBeDisabled();

      await userEvent.click(screen.getByRole('button', { name: 'Add Format dates step' }));
      await userEvent.selectOptions(screen.getByLabelText(/Date column/i), 'order_date');

      await userEvent.click(screen.getByRole('button', { name: 'Columns', exact: true }));
      await userEvent.click(screen.getByRole('button', { name: 'Add Convert data type step' }));
      expect(getOptionValues(screen.getByLabelText(/Rule 1 target type/i))).toEqual(['str', 'int', 'float', 'date']);
      await userEvent.selectOptions(screen.getByLabelText('Rule 1 column'), 'quantity');
      await userEvent.selectOptions(screen.getByLabelText(/Rule 1 target type/i), 'int');

      await userEvent.click(screen.getByRole('button', { name: 'Filter', exact: true }));
      await userEvent.click(screen.getByRole('button', { name: 'Add Filter rows step' }));
      await userEvent.selectOptions(screen.getByLabelText('Rule 1 column'), 'total_amount');
      expect(new Set(getOptionValues(screen.getByLabelText('Rule 1 comparison')))).toEqual(new Set(NUMERIC_OPS));
      await userEvent.selectOptions(screen.getByLabelText('Rule 1 comparison'), 'greater_or_equal');
      await userEvent.type(screen.getByLabelText('Rule 1 comparison value'), '800000');

      jest.useFakeTimers();
      await userEvent.click(screen.getByRole('button', { name: 'Run pipeline' }));
      await waitFor(() => expect(window.location.pathname).toBe(`/dashboard/runs/${RUN_1}`));
      expect(state.submittedRuns[0].headers['X-CSRFToken']).toBe('e2e-csrf-token');

      expect((await screen.findAllByText('Queued')).length).toBeGreaterThanOrEqual(1);
      await act(async () => { jest.advanceTimersByTime(2000); });
      expect(screen.getAllByText('Running').length).toBeGreaterThanOrEqual(1);
      await act(async () => { jest.advanceTimersByTime(2000); });
      jest.useRealTimers();

      expect(await screen.findByRole('heading', { name: /Pipeline steps/i })).toBeInTheDocument();
      expect((await screen.findAllByRole('cell', { name: 'ORD01' })).length).toBeGreaterThanOrEqual(1);

      fireEvent.change(screen.getByLabelText(/File format/i), { target: { value: 'csv' } });
      await userEvent.click(screen.getByRole('button', { name: /Download full result/i }));
      await screen.findByText(/download was handed to your browser/i);
      expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
      expect(anchorClickSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    } finally {
      anchorClickSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }
  });

  test('T4-5: Invalid/blocked workflow recovery journey (legacy boolean + disabled step -> fix -> operator reset -> unified /dashboard/results/:id)', async () => {
    const orders = makeDataset(DS_ORDERS, 'orders.csv', 'csv', ORDERS_COLUMNS, ORDERS_ROWS);
    const brokenPipeline = {
      id: PIPE_1,
      name: 'Legacy broken pipeline',
      dataset_id: DS_ORDERS,
      step_count: 1,
      source_count: 1,
      configuration: {
        schemaVersion: 1,
        name: 'Legacy broken pipeline',
        datasetId: DS_ORDERS,
        steps: [
          { type: 'cast_type', enabled: false, config: { conversions: [{ column: 'quantity', toType: 'boolean' }] } },
        ],
      },
    };

    const { state } = renderAt(`/dashboard/pipelines?pipeline=${PIPE_1}`, {
      datasets: [orders],
      pipelines: [brokenPipeline],
    });
    await waitForPipelineReady();

    expect(screen.getByRole('button', { name: 'Run pipeline' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Run pipeline' })).toHaveAccessibleDescription(/step|boolean|target type/i);

    await userEvent.click(screen.getByRole('checkbox', { name: 'Enable step 1' }));
    await userEvent.selectOptions(screen.getByLabelText(/Rule 1 target type/i), 'int');

    await userEvent.click(screen.getByRole('button', { name: 'Filter', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Filter rows step' }));
    const colSelect = screen.getByLabelText('Rule 1 column');
    const opSelect = screen.getByLabelText('Rule 1 comparison');
    await userEvent.selectOptions(colSelect, 'city');
    await userEvent.selectOptions(opSelect, 'contains');
    await userEvent.selectOptions(colSelect, 'quantity');
    expect(NUMERIC_OPS).toContain(opSelect.value);
    expect(opSelect.value).not.toBe('contains');
    await userEvent.type(screen.getByLabelText('Rule 1 comparison value'), '2');

    expect(screen.getByRole('button', { name: 'Run pipeline' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Run pipeline' }));
    await waitFor(() => expect(window.location.pathname).toBe(`/dashboard/runs/${RUN_1}`));
    expect(state.submittedRuns[0].body.steps[0].config.conversions[0].toType).toBe('int');

    window.history.replaceState(null, '', `/dashboard/results/${RUN_1}`);
    act(() => { window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(await screen.findByRole('heading', { name: /Pipeline steps/i })).toBeInTheDocument();
    expect((await screen.findAllByRole('cell', { name: 'ORD01' })).length).toBeGreaterThanOrEqual(1);
  });

  test('T4-6: Multi-source join + result pagination + delete result file lifecycle keeps steps and summary intact', async () => {
    const orders = makeDataset(DS_ORDERS, 'orders.csv', 'csv', ORDERS_COLUMNS, ORDERS_ROWS);
    const customers = makeDataset(DS_CUSTOMERS, 'customers.tsv', 'tsv', CUSTOMERS_COLUMNS, CUSTOMERS_ROWS);
    const pagedResultRows = Array.from({ length: 28 }, (_, idx) => ({
      order_id: `RES_ORD_${idx + 1}`,
      customer_tier: 'VIP',
    }));

    const { state } = renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS},${DS_CUSTOMERS}`, {
      datasets: [orders, customers],
      runResultRowsHandler: (_id, { page, pageSize }) => jsonResponse(
        paginateRows(
          [{ name: 'order_id', type: 'string' }, { name: 'customer_tier', type: 'string' }],
          pagedResultRows,
          page,
          pageSize,
        ),
      ),
    });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Combine', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Join tables step' }));

    await userEvent.click(screen.getByRole('button', { name: 'Filter', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Filter rows step' }));
    await userEvent.selectOptions(screen.getByLabelText('Rule 1 column'), 'customer_tier');
    await userEvent.selectOptions(screen.getByLabelText('Rule 1 comparison'), 'equals');
    await userEvent.type(screen.getByLabelText('Rule 1 comparison value'), 'VIP');

    await userEvent.click(screen.getByRole('button', { name: 'Run pipeline' }));
    await waitFor(() => expect(window.location.pathname).toBe(`/dashboard/runs/${RUN_1}`));
    expect(state.submittedRuns[0].body.steps.map((s) => s.type)).toEqual(['join', 'filter_rows']);

    expect(await screen.findByRole('heading', { name: /Pipeline steps/i })).toBeInTheDocument();
    expect(await screen.findByRole('cell', { name: 'RES_ORD_1' })).toBeInTheDocument();

    const resultNav = screen.getByRole('navigation', { name: /Result row pages|Result pages/i });
    await userEvent.click(within(resultNav).getByRole('button', { name: 'Next' }));
    expect(await screen.findByRole('cell', { name: 'RES_ORD_26' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Delete result file/i }));
    await userEvent.click(await screen.findByRole('button', { name: /Confirm file deletion/i }));

    expect(await screen.findByRole('heading', { name: /Result file removed/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Pipeline steps/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Download full result/i })).not.toBeInTheDocument();
  });
});
