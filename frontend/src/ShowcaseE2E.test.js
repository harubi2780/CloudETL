import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App';

const DS_ORDERS = '10000000-0000-0000-0000-000000000001';
const DS_CUSTOMERS = '10000000-0000-0000-0000-000000000002';
const DS_EXTRA = '10000000-0000-0000-0000-000000000003';
const DS_UPLOADED_1 = '10000000-0000-0000-0000-000000000004';
const DS_UPLOADED_2 = '10000000-0000-0000-0000-000000000005';
const DS_JSON = '10000000-0000-0000-0000-000000000006';
const DS_NODATE = '10000000-0000-0000-0000-000000000007';

const PIPE_1 = '30000000-0000-0000-0000-000000000001';
const PIPE_2 = '30000000-0000-0000-0000-000000000002';
const RUN_1 = '20000000-0000-0000-0000-000000000001';

const NUMERIC_OPS = ['equals', 'not_equals', 'greater_than', 'less_than', 'greater_or_equal', 'less_or_equal'];
const STRING_OPS = ['equals', 'contains', 'starts_with', 'ends_with'];
const DATETIME_OPS = ['after', 'before', 'equals'];
const BOOLEAN_OPS = ['is_true', 'is_false'];

const DEFAULT_STORAGE = {
  limit_bytes: 104857600,
  used_bytes: 4096,
  reserved_bytes: 0,
  available_bytes: 104853504,
  over_limit: false,
  uploaded_bytes: 4096,
  result_bytes: 0,
  pending_cleanup_bytes: 0,
};

function createCapabilities(limitOverrides = {}) {
  return {
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
      ...limitOverrides,
    },
  };
}

const CANONICAL_CAPABILITIES = createCapabilities();

const ORDERS_COLUMNS = [
  { name: 'order_id', type: 'string' },
  { name: 'customer_id', type: 'string' },
  { name: 'city', type: 'string' },
  { name: 'amount', type: 'float' },
  { name: 'order_date', type: 'datetime' },
  { name: 'is_paid', type: 'boolean' },
];

const ORDERS_ROWS = [
  { order_id: 'ORD01', customer_id: 'CUST01', city: 'Hanoi', amount: 1500.0, order_date: '2026-10-01', is_paid: true },
  { order_id: 'ORD02', customer_id: 'CUST02', city: 'Danang', amount: 450.0, order_date: '2026-10-02', is_paid: false },
  { order_id: 'ORD03', customer_id: 'CUST01', city: 'HCM', amount: 950.0, order_date: '2026-10-03', is_paid: true },
];

const CUSTOMERS_COLUMNS = [
  { name: 'customer_id', type: 'string' },
  { name: 'customer_tier', type: 'string' },
  { name: 'region', type: 'string' },
];

const CUSTOMERS_ROWS = [
  { customer_id: 'CUST01', customer_tier: 'VIP', region: 'North' },
  { customer_id: 'CUST02', customer_tier: 'Standard', region: 'Central' },
  { customer_id: 'CUST03', customer_tier: 'Enterprise', region: 'South' },
];

const EXTRA_COLUMNS = [
  { name: 'customer_id', type: 'string' },
  { name: 'channel', type: 'string' },
];

const EXTRA_ROWS = [
  { customer_id: 'CUST01', channel: 'Web' },
  { customer_id: 'CUST02', channel: 'Mobile' },
];

const NODATE_COLUMNS = [
  { name: 'item_id', type: 'integer' },
  { name: 'raw_date', type: 'string' },
  { name: 'price', type: 'string' },
];

const NODATE_ROWS = [
  { item_id: 1, raw_date: '2026-10-01', price: '1200' },
  { item_id: 2, raw_date: '2026-10-02', price: '800' },
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

function makeOrdersDataset(overrides = {}) {
  return makeDataset(DS_ORDERS, 'orders.csv', 'csv', ORDERS_COLUMNS, ORDERS_ROWS, overrides);
}

function makeCustomersDataset(overrides = {}) {
  return makeDataset(DS_CUSTOMERS, 'customers.tsv', 'tsv', CUSTOMERS_COLUMNS, CUSTOMERS_ROWS, overrides);
}

function makeExtraDataset(overrides = {}) {
  return makeDataset(DS_EXTRA, 'extra.csv', 'csv', EXTRA_COLUMNS, EXTRA_ROWS, overrides);
}

function makeJsonDataset(overrides = {}) {
  return makeDataset(DS_JSON, 'archive.json', 'json', [], [], overrides);
}

function makeManyRows(prefix, count, baseRow) {
  return Array.from({ length: count }, (_, idx) => ({
    ...baseRow,
    [Object.keys(baseRow)[0]]: `${prefix}${String(idx + 1).padStart(2, '0')}`,
  }));
}

function jsonResponse(data, httpStatus = 200) {
  return {
    ok: httpStatus >= 200 && httpStatus < 300,
    status: httpStatus,
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
  authenticated = true,
  loginError = null,
  datasets = [],
  datasetsPageSize = 25,
  pipelines = [],
  runs = [],
  runPollSequences = {},
  capabilities = CANONICAL_CAPABILITIES,
  uploadDataset = null,
  uploadQueue = [],
  replaceHandler = null,
  datasetRowsHandler = null,
  submitHandler = null,
  runSourceRowsHandler = null,
  runResultRowsHandler = null,
  downloadBlobText = 'order_id,amount\nORD01,1500\n',
} = {}) {
  const pendingUploads = [...uploadQueue];
  const state = {
    datasets: datasets.map((d) => ({ ...d })),
    pipelines: pipelines.map((p) => ({ ...p })),
    runs: runs.map((r) => ({ ...r })),
    submittedRuns: [],
    savedPipelines: [],
    requests: [],
    csrfToken: 'showcase-csrf-token',
    downloadBlob: new Blob([downloadBlobText], { type: 'text/csv' }),
  };

  const fetchMock = jest.fn(async (url, options = {}) => {
    const parsed = new URL(url, window.location.origin);
    const { pathname, searchParams } = parsed;
    const method = (options.method || 'GET').toUpperCase();
    state.requests.push({
      method,
      pathname,
      search: parsed.search,
      headers: options.headers || {},
      body: options.body,
    });

    if (pathname === '/api/auth/csrf/' && method === 'GET') {
      return jsonResponse({ csrfToken: state.csrfToken });
    }
    if (pathname === '/api/auth/me/' && method === 'GET') {
      if (!authenticated) {
        return jsonResponse({ error: { code: 'unauthenticated', message: 'Authentication required.' } }, 401);
      }
      return jsonResponse({ user: { id: 1, username: 'alice', email: 'alice@example.com' } });
    }
    if (pathname === '/api/auth/login/' && method === 'POST') {
      if (loginError) {
        return jsonResponse(loginError, 400);
      }
      return jsonResponse({
        csrfToken: state.csrfToken,
        user: { id: 1, username: 'alice', email: 'alice@example.com' },
      });
    }

    if (pathname === '/api/account/' && method === 'GET') {
      return jsonResponse({
        account: {
          id: 1,
          username: 'alice',
          email: 'alice@example.com',
          status: 'active',
          joined_at: '2026-09-01T00:00:00Z',
          plan: { code: 'free', name: 'Starter' },
          storage: DEFAULT_STORAGE,
        },
      });
    }

    if (pathname === '/api/datasets/' && method === 'GET') {
      const page = Number(searchParams.get('page') || 1);
      const start = (page - 1) * datasetsPageSize;
      const slice = state.datasets.slice(start, start + datasetsPageSize).map(({ columns, rows, ...meta }) => meta);
      return jsonResponse({
        datasets: slice,
        page,
        total_pages: Math.max(1, Math.ceil(state.datasets.length / datasetsPageSize)),
        total_count: state.datasets.length,
        limits: { max_file_size_bytes: 26214400, extensions: ['csv', 'tsv'] },
        storage: DEFAULT_STORAGE,
      });
    }

    if (pathname === '/api/datasets/' && method === 'POST') {
      const nextUpload = pendingUploads.length > 0
        ? pendingUploads.shift()
        : (uploadDataset || makeDataset(DS_UPLOADED_1, 'uploaded.csv', 'csv', ORDERS_COLUMNS, ORDERS_ROWS));
      const created = { ...nextUpload };
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
        const custom = datasetRowsHandler(id, { page, pageSize, signal: options.signal, state });
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
      if (submitHandler) {
        const customSubmit = await submitHandler(body, { state });
        if (customSubmit) return customSubmit;
      }
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

    throw new Error(`Unhandled fetch route in ShowcaseE2E: ${method} ${pathname}${parsed.search}`);
  });

  fetchMock.state = state;
  return fetchMock;
}

function renderAt(route, fetchConfig) {
  const fetchMock = createFetchMock(fetchConfig);
  global.fetch = fetchMock;
  window.history.replaceState(null, '', route);
  const view = render(<App />);
  return { view, fetchMock, state: fetchMock.state };
}

async function waitForPipelineReady() {
  await screen.findByRole('heading', { name: /Source preview:/i });
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Add Clean text step' })).toBeEnabled();
  });
}

function createDataTransfer() {
  const store = {};
  return {
    dropEffect: 'move',
    effectAllowed: 'move',
    files: [],
    types: [],
    setData(type, value) {
      store[type] = String(value);
      if (!this.types.includes(type)) this.types.push(type);
    },
    getData(type) {
      return store[type] ?? '';
    },
    clearData() {
      Object.keys(store).forEach((key) => delete store[key]);
      this.types = [];
    },
  };
}

function dragAndDrop(source, target) {
  const dataTransfer = createDataTransfer();
  fireEvent.dragStart(source, { dataTransfer });
  fireEvent.dragEnter(target, { dataTransfer });
  fireEvent.dragOver(target, { dataTransfer });
  fireEvent.drop(target, { dataTransfer });
  fireEvent.dragEnd(source, { dataTransfer });
}

function getStepItems() {
  const inspector = screen.getByRole('complementary', { name: 'Pipeline settings' });
  return within(inspector)
    .queryAllByRole('listitem')
    .filter((item) => within(item).queryByRole('button', { name: /^\d+\s/ }));
}

function getStepButtonText(item) {
  return within(item).getByRole('button', { name: /^\d+\s/ }).textContent;
}

function getSourceTabs() {
  return within(screen.getByRole('tablist', { name: 'Source sheets' })).getAllByRole('tab');
}

function getAppendOrderItems() {
  return within(screen.getByRole('list', { name: 'Append order' })).getAllByRole('listitem');
}

function getOptionValues(selectEl) {
  return within(selectEl).getAllByRole('option').map((opt) => opt.value);
}

function listDatasetGetCount(state) {
  return state.requests.filter((r) => r.method === 'GET' && r.pathname === '/api/datasets/').length;
}

function buildSavedPipeline({
  id = PIPE_1,
  pipelineName = 'Saved Showcase Pipeline',
  datasetId = DS_ORDERS,
  steps = [],
  sourceCount = 1,
} = {}) {
  return {
    id,
    name: pipelineName,
    dataset_id: datasetId,
    step_count: steps.length,
    source_count: sourceCount,
    configuration: {
      schemaVersion: 1,
      name: pipelineName,
      datasetId,
      steps,
    },
  };
}

function buildRunRecord({
  id = RUN_1,
  runTitle = 'Showcase Run',
  datasetId = DS_ORDERS,
  steps = [],
  runStatus = 'succeeded',
  error = null,
  sourceDataset = makeOrdersDataset(),
  resultColumns = [
    { name: 'order_id', type: 'string' },
    { name: 'amount', type: 'float' },
  ],
  resultRows = [
    { order_id: 'ORD01', amount: 1500.0 },
    { order_id: 'ORD03', amount: 950.0 },
  ],
} = {}) {
  return {
    id,
    name: runTitle,
    status: runStatus,
    created_at: '2026-11-15T10:00:00Z',
    started_at: '2026-11-15T10:00:01Z',
    finished_at: runStatus === 'queued' || runStatus === 'running' ? null : '2026-11-15T10:00:03Z',
    configuration: {
      schemaVersion: 1,
      name: runTitle,
      datasetId,
      steps,
    },
    summary: runStatus === 'succeeded' ? {
      initial_rows: sourceDataset.rows.length,
      final_rows: resultRows.length,
      dropped_rows: Math.max(0, sourceDataset.rows.length - resultRows.length),
      added_rows: 0,
      columns: resultColumns,
    } : null,
    error,
    result_available: runStatus === 'succeeded',
    download_url: runStatus === 'succeeded' ? `/api/etl/runs/${id}/download/` : null,
    sources_meta: {
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

function validTodayStrings() {
  const now = new Date();
  const local = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const utc = now.toISOString().slice(0, 10);
  return [local, utc];
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.scrollTo = jest.fn();
  URL.createObjectURL = jest.fn(() => 'blob:showcase-download');
  URL.revokeObjectURL = jest.fn();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  delete global.fetch;
});

// =============================================================================
// TIER 1 — Feature Coverage (47 tests: F1:5, F2:5, F3:6, F4:5, F5:5, F6:5, F7:6, F8:5, F9:5)
// =============================================================================

describe('Tier 1 — Feature Coverage', () => {
  test('T1-F1-1: workspace navigation exposes aria-current="page" on active route and transfers on navigation', async () => {
    renderAt('/dashboard/datasets', { datasets: [makeOrdersDataset()] });
    await screen.findByRole('rowheader', { name: 'orders.csv' });

    const nav = screen.getByRole('navigation', { name: 'Workspace' });
    expect(within(nav).getByRole('link', { name: 'Datasets' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Pipelines' })).not.toHaveAttribute('aria-current');

    await userEvent.click(within(nav).getByRole('link', { name: 'Pipelines' }));
    await waitFor(() => expect(within(nav).getByRole('link', { name: 'Pipelines' })).toHaveAttribute('aria-current', 'page'));
    expect(within(nav).getByRole('link', { name: 'Datasets' })).not.toHaveAttribute('aria-current');
  });

  test('T1-F1-2: pipeline transformation group tabs toggle aria-pressed cleanly across groups', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, { datasets: [makeOrdersDataset()] });
    await waitForPipelineReady();

    const groupsNav = screen.getByRole('navigation', { name: 'Transformation groups' });
    expect(within(groupsNav).getByRole('button', { name: 'Clean', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(within(groupsNav).getByRole('button', { name: 'Filter', exact: true })).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(within(groupsNav).getByRole('button', { name: 'Filter', exact: true }));
    expect(within(groupsNav).getByRole('button', { name: 'Filter', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(within(groupsNav).getByRole('button', { name: 'Clean', exact: true })).toHaveAttribute('aria-pressed', 'false');
  });

  test('T1-F1-3: source tabs and side-by-side split toggle synchronize aria-selected and aria-pressed', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS},${DS_CUSTOMERS}`, {
      datasets: [makeOrdersDataset(), makeCustomersDataset()],
    });
    await waitForPipelineReady();

    const tabs = getSourceTabs();
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false');

    await userEvent.click(tabs[1]);
    expect(getSourceTabs()[1]).toHaveAttribute('aria-selected', 'true');
    expect(getSourceTabs()[0]).toHaveAttribute('aria-selected', 'false');

    const splitBtn = screen.getByRole('button', { name: 'Compare side-by-side' });
    expect(splitBtn).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(splitBtn);
    expect(splitBtn).toHaveAttribute('aria-pressed', 'true');
  });

  test('T1-F1-4: Sources and Saved triggers synchronize aria-expanded and aria-controls with overlay panels', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, { datasets: [makeOrdersDataset()] });
    await waitForPipelineReady();

    const sourcesBtn = screen.getByRole('button', { name: 'Sources (1)' });
    const savedBtn = screen.getByRole('button', { name: 'Saved' });
    expect(sourcesBtn).toHaveAttribute('aria-expanded', 'false');
    expect(sourcesBtn).toHaveAttribute('aria-controls', 'source-library');
    expect(savedBtn).toHaveAttribute('aria-expanded', 'false');
    expect(savedBtn).toHaveAttribute('aria-controls', 'saved-pipelines');

    await userEvent.click(sourcesBtn);
    expect(sourcesBtn).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('region', { name: 'Source library' })).toHaveAttribute('id', 'source-library');

    await userEvent.click(savedBtn);
    expect(savedBtn).toHaveAttribute('aria-expanded', 'true');
    expect(sourcesBtn).toHaveAttribute('aria-expanded', 'false');
    const savedPanel = screen.getByRole('region', { name: 'Saved pipelines' });
    expect(savedPanel).toHaveAttribute('id', 'saved-pipelines');
    await within(savedPanel).findByRole('navigation', { name: 'Saved pipeline pages' });
  });

  test('T1-F1-5: pipeline validation statusbar and submit failures expose accessible descriptions and alerts', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, {
      datasets: [makeOrdersDataset()],
      submitHandler: async () => jsonResponse({ error: { code: 'invalid', message: 'Backend rejected configuration.' } }, 400),
    });
    await waitForPipelineReady();

    const runBtn = screen.getByRole('button', { name: 'Run pipeline' });
    expect(runBtn).toHaveAttribute('aria-describedby', 'workbook-validation');
    expect(runBtn).toBeDisabled();
    expect(runBtn).toHaveAccessibleDescription(/Add at least one enabled transformation step/i);

    await userEvent.click(screen.getByRole('button', { name: 'Add Clean text step' }));
    expect(runBtn).toBeEnabled();
    expect(runBtn).toHaveAccessibleDescription(/Ready to run/i);

    await userEvent.click(runBtn);
    expect(await screen.findByRole('alert')).toHaveTextContent('Backend rejected configuration.');
  });

  test('T1-F2-1: workspace shell exposes Skip to content link, Workspace navigation, and main#main-content across views', async () => {
    renderAt('/dashboard/datasets', { datasets: [makeOrdersDataset()] });
    await screen.findByRole('rowheader', { name: 'orders.csv' });

    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main-content');
    expect(screen.getByRole('navigation', { name: 'Workspace' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
    expect(screen.getByRole('region', { name: 'Storage usage' })).toBeInTheDocument();

    await userEvent.click(within(screen.getByRole('navigation', { name: 'Workspace' })).getByRole('link', { name: 'Runs' }));
    await screen.findByRole('heading', { name: 'Runs' });
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
  });

  test('T1-F2-2: pipeline workspace renders complementary inspector, toolbar, tablist, tabpanel, and step settings regions', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, { datasets: [makeOrdersDataset()] });
    await waitForPipelineReady();

    expect(screen.getByRole('complementary', { name: 'Pipeline settings' })).toBeInTheDocument();
    expect(screen.getByRole('toolbar', { name: 'Transformations' })).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Source sheets' })).toBeInTheDocument();
    expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'workbook-sheet');
    expect(screen.getByRole('region', { name: 'Step settings' })).toBeInTheDocument();
  });

  test('T1-F2-3: side-by-side comparison mode exposes two independent preview panes and comparison file selector', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS},${DS_CUSTOMERS},${DS_EXTRA}`, {
      datasets: [makeOrdersDataset(), makeCustomersDataset(), makeExtraDataset()],
    });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Compare side-by-side' }));
    expect(screen.getByRole('heading', { name: 'Source preview: orders.csv' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Source preview: customers.tsv' })).toBeInTheDocument();

    const compareSelect = screen.getByLabelText('Compare dataset');
    expect(getOptionValues(compareSelect)).toEqual([DS_CUSTOMERS, DS_EXTRA]);
    await userEvent.selectOptions(compareSelect, DS_EXTRA);
    expect(await screen.findByRole('heading', { name: 'Source preview: extra.csv' })).toBeInTheDocument();
  });

  test('T1-F2-4: dataset review panel exposes labeled File, Rows per page, Close review, and review pagination controls', async () => {
    renderAt('/dashboard/datasets', { datasets: [makeOrdersDataset(), makeCustomersDataset()] });
    await screen.findByRole('rowheader', { name: 'orders.csv' });

    const row = screen.getByRole('row', { name: /orders\.csv/i });
    await userEvent.click(within(row).getByRole('button', { name: /Review data/i }));

    const panel = await screen.findByRole('region', { name: /Data review:/i });
    await within(panel).findByRole('cell', { name: 'ORD01' });
    expect(within(panel).getByLabelText(/^File$/i)).toHaveAttribute('id', 'dataset-review-file-select');
    expect(within(panel).getByLabelText(/Rows per page/i)).toHaveAttribute('id', 'dataset-review-page-size');
    expect(within(panel).getByRole('button', { name: 'Close review' })).toBeEnabled();
    expect(within(panel).getByRole('navigation', { name: 'Dataset review pages' })).toBeInTheDocument();
  });

  test('T1-F2-5: DataTable spreadsheet region renders interactive column selection buttons and read-only cell bar', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, { datasets: [makeOrdersDataset()] });
    await waitForPipelineReady();

    const tableRegion = screen.getByRole('region', { name: /Source preview · orders\.csv/i });
    const colBtn = within(tableRegion).getByRole('button', { name: 'Select column A: order_id' });
    expect(colBtn).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(colBtn);
    expect(colBtn).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(within(tableRegion).getByRole('cell', { name: 'Hanoi' }));
    expect(screen.getByLabelText('Selected cell value')).toHaveValue('Hanoi');
    expect(screen.getByLabelText('Selected cell value')).toHaveAttribute('readonly');
  });

  test('T1-F3-1: dragging first step onto last step reorders applied steps and updates step numbers', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, { datasets: [makeOrdersDataset()] });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Add Clean text step' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Replace values step' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Remove duplicates step' }));

    const initialItems = getStepItems();
    expect(initialItems).toHaveLength(3);
    initialItems.forEach((item) => expect(item).toHaveAttribute('draggable', 'true'));
    expect(getStepButtonText(initialItems[0])).toMatch(/^1\s*Clean text/);
    expect(getStepButtonText(initialItems[1])).toMatch(/^2\s*Replace values/);
    expect(getStepButtonText(initialItems[2])).toMatch(/^3\s*Remove duplicates/);

    dragAndDrop(initialItems[0], initialItems[2]);

    const reordered = getStepItems();
    expect(getStepButtonText(reordered[0])).toMatch(/^1\s*Replace values/);
    expect(getStepButtonText(reordered[1])).toMatch(/^2\s*Remove duplicates/);
    expect(getStepButtonText(reordered[2])).toMatch(/^3\s*Clean text/);
  });

  test('T1-F3-2: dragging a later step upward preserves step configuration and updates Configure step heading', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, { datasets: [makeOrdersDataset()] });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Add Clean text step' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Replace values step' }));
    await userEvent.selectOptions(screen.getByLabelText('Replace in column'), 'city');
    fireEvent.change(screen.getByLabelText('Old value'), { target: { value: 'HCM' } });
    fireEvent.change(screen.getByLabelText('New value'), { target: { value: 'Ho Chi Minh' } });
    await userEvent.click(screen.getByRole('button', { name: 'Add Remove duplicates step' }));
    await userEvent.selectOptions(screen.getByLabelText('Rule 1 duplicate row to keep'), 'last');

    dragAndDrop(getStepItems()[2], getStepItems()[0]);

    expect(screen.getByRole('heading', { name: 'Configure step 1' })).toBeInTheDocument();
    expect(screen.getByLabelText('Rule 1 duplicate row to keep')).toHaveValue('last');

    await userEvent.click(within(getStepItems()[2]).getByRole('button', { name: /^3\s/ }));
    expect(screen.getByRole('heading', { name: 'Configure step 3' })).toBeInTheDocument();
    expect(screen.getByLabelText('Old value')).toHaveValue('HCM');
    expect(screen.getByLabelText('New value')).toHaveValue('Ho Chi Minh');
  });

  test('T1-F3-3: reordered step sequence persists in sessionStorage draft across unmount and remount', async () => {
    const { view } = renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, { datasets: [makeOrdersDataset()] });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Add Clean text step' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Replace values step' }));
    dragAndDrop(getStepItems()[1], getStepItems()[0]);

    expect(getStepButtonText(getStepItems()[0])).toMatch(/^1\s*Replace values/);
    view.unmount();

    renderAt('/dashboard/pipelines', { datasets: [makeOrdersDataset()] });
    await waitForPipelineReady();

    const restored = getStepItems();
    expect(restored).toHaveLength(2);
    expect(getStepButtonText(restored[0])).toMatch(/^1\s*Replace values/);
    expect(getStepButtonText(restored[1])).toMatch(/^2\s*Clean text/);
  });

  test('T1-F3-4: reordered step sequence is sent accurately in createPipeline and submit JSON payloads', async () => {
    const { state } = renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, { datasets: [makeOrdersDataset()] });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Add Clean text step' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Replace values step' }));
    await userEvent.selectOptions(screen.getByLabelText('Replace in column'), 'city');
    fireEvent.change(screen.getByLabelText('Old value'), { target: { value: 'Hanoi' } });
    fireEvent.change(screen.getByLabelText('New value'), { target: { value: 'HN' } });

    dragAndDrop(getStepItems()[1], getStepItems()[0]);

    await userEvent.click(screen.getByRole('button', { name: 'Save pipeline' }));
    await screen.findByText(/Saved "/i);
    expect(state.savedPipelines).toHaveLength(1);
    expect(state.savedPipelines[0].body.steps.map((s) => s.type)).toEqual(['replace_value', 'string_transform']);

    await userEvent.click(screen.getByRole('button', { name: 'Run pipeline' }));
    await waitFor(() => expect(window.location.pathname).toBe(`/dashboard/runs/${RUN_1}`));
    expect(state.submittedRuns[0].body.steps.map((s) => s.type)).toEqual(['replace_value', 'string_transform']);
  });

  test('T1-F3-5: reordering steps via DnD recalculates schema projection and resolves column-missing error', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, { datasets: [makeOrdersDataset()] });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Columns', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Select columns step' }));

    await userEvent.click(screen.getByRole('button', { name: 'Clean', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Replace values step' }));
    await userEvent.selectOptions(screen.getByLabelText('Replace in column'), 'city');

    await userEvent.click(within(getStepItems()[0]).getByRole('button', { name: /^1\s/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'city' }));
    expect(screen.getByRole('button', { name: 'Run pipeline' })).toBeDisabled();

    dragAndDrop(getStepItems()[1], getStepItems()[0]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Run pipeline' })).toBeEnabled());
  });

  test('T1-F3-6: existing Move step up and Move step down buttons remain operable alongside DnD', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, { datasets: [makeOrdersDataset()] });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Add Clean text step' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Replace values step' }));

    await userEvent.click(within(getStepItems()[0]).getByRole('button', { name: /^1\s/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Move step 1 down' }));
    expect(getStepButtonText(getStepItems()[0])).toMatch(/^1\s*Replace values/);
    expect(getStepButtonText(getStepItems()[1])).toMatch(/^2\s*Clean text/);

    await userEvent.click(screen.getByRole('button', { name: 'Move step 2 up' }));
    expect(getStepButtonText(getStepItems()[0])).toMatch(/^1\s*Clean text/);
  });

  test('T1-F4-1: dragging source tabs reorders the tab list in SourceTabs', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS},${DS_CUSTOMERS},${DS_EXTRA}`, {
      datasets: [makeOrdersDataset(), makeCustomersDataset(), makeExtraDataset()],
    });
    await waitForPipelineReady();

    const tabs = getSourceTabs();
    tabs.forEach((tab) => expect(tab).toHaveAttribute('draggable', 'true'));
    dragAndDrop(tabs[0], tabs[2]);

    const reordered = getSourceTabs();
    expect(reordered[0]).toHaveTextContent(/customers\.tsv/);
    expect(reordered[1]).toHaveTextContent(/extra\.csv/);
    expect(reordered[2]).toHaveTextContent(/orders\.csv/);
  });

  test('T1-F4-2: Alt+ArrowRight and Alt+ArrowLeft reorder tabs while ArrowRight, ArrowLeft, Home, End select tabs', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS},${DS_CUSTOMERS},${DS_EXTRA}`, {
      datasets: [makeOrdersDataset(), makeCustomersDataset(), makeExtraDataset()],
    });
    await waitForPipelineReady();

    getSourceTabs()[0].focus();
    fireEvent.keyDown(getSourceTabs()[0], { key: 'ArrowRight', altKey: true });
    expect(getSourceTabs()[0]).toHaveTextContent(/customers\.tsv/);
    expect(getSourceTabs()[1]).toHaveTextContent(/orders\.csv/);

    fireEvent.keyDown(getSourceTabs()[1], { key: 'ArrowLeft', altKey: true });
    expect(getSourceTabs()[0]).toHaveTextContent(/orders\.csv/);

    fireEvent.keyDown(getSourceTabs()[0], { key: 'End' });
    expect(getSourceTabs()[2]).toHaveAttribute('aria-selected', 'true');
    expect(getSourceTabs()[2]).toHaveTextContent(/extra\.csv/);

    fireEvent.keyDown(getSourceTabs()[2], { key: 'Home' });
    expect(getSourceTabs()[0]).toHaveAttribute('aria-selected', 'true');
  });

  test('T1-F4-3: reordering source tabs preserves primaryId Starting dataset independently in UI and payload', async () => {
    const { state } = renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS},${DS_CUSTOMERS},${DS_EXTRA}`, {
      datasets: [makeOrdersDataset(), makeCustomersDataset(), makeExtraDataset()],
    });
    await waitForPipelineReady();

    dragAndDrop(getSourceTabs()[0], getSourceTabs()[2]);
    const tabs = getSourceTabs();
    expect(tabs[2]).toHaveTextContent(/orders\.csv/);
    expect(within(tabs[2]).getByLabelText('Starting dataset')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Combine', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Append rows step' }));
    await userEvent.click(screen.getByRole('button', { name: 'Run pipeline' }));

    await waitFor(() => expect(state.submittedRuns).toHaveLength(1));
    expect(state.submittedRuns[0].body.datasetId).toBe(DS_ORDERS);
  });

  test('T1-F4-4: reordered source tab order persists in sessionStorage draft across unmount and remount', async () => {
    const { view } = renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS},${DS_CUSTOMERS},${DS_EXTRA}`, {
      datasets: [makeOrdersDataset(), makeCustomersDataset(), makeExtraDataset()],
    });
    await waitForPipelineReady();

    dragAndDrop(getSourceTabs()[2], getSourceTabs()[0]);
    expect(getSourceTabs()[0]).toHaveTextContent(/extra\.csv/);
    view.unmount();

    renderAt('/dashboard/pipelines', {
      datasets: [makeOrdersDataset(), makeCustomersDataset(), makeExtraDataset()],
    });
    await waitForPipelineReady();

    const restored = getSourceTabs();
    expect(restored[0]).toHaveTextContent(/extra\.csv/);
    expect(restored[1]).toHaveTextContent(/orders\.csv/);
    expect(restored[2]).toHaveTextContent(/customers\.tsv/);
  });

  test('T1-F4-5: concat append-order list supports DnD reordering and persists to datasetIds payload', async () => {
    const { state } = renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS},${DS_CUSTOMERS},${DS_EXTRA}`, {
      datasets: [makeOrdersDataset(), makeCustomersDataset(), makeExtraDataset()],
    });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Combine', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Append rows step' }));

    const appendItems = getAppendOrderItems();
    expect(appendItems[0]).toHaveTextContent('1. customers.tsv');
    expect(appendItems[1]).toHaveTextContent('2. extra.csv');

    dragAndDrop(appendItems[1], appendItems[0]);
    expect(getAppendOrderItems()[0]).toHaveTextContent('1. extra.csv');
    expect(getAppendOrderItems()[1]).toHaveTextContent('2. customers.tsv');

    await userEvent.click(screen.getByRole('button', { name: 'Run pipeline' }));
    await waitFor(() => expect(state.submittedRuns).toHaveLength(1));
    expect(state.submittedRuns[0].body.steps[0].config.datasetIds).toEqual([DS_EXTRA, DS_CUSTOMERS]);
  });

  test('T1-F5-1: clicking outside #source-library closes the overlay and sets aria-expanded="false"', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, {
      datasets: [makeOrdersDataset(), makeCustomersDataset()],
    });
    await waitForPipelineReady();

    const sourcesBtn = screen.getByRole('button', { name: 'Sources (1)' });
    await userEvent.click(sourcesBtn);
    expect(screen.getByRole('region', { name: 'Source library' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('toolbar', { name: 'Transformations' }));
    expect(screen.queryByRole('region', { name: 'Source library' })).not.toBeInTheDocument();
    expect(sourcesBtn).toHaveAttribute('aria-expanded', 'false');
  });

  test('T1-F5-2: clicking outside #source-library onto Pipeline name closes it without stealing focus', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, {
      datasets: [makeOrdersDataset(), makeCustomersDataset()],
    });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Sources (1)' }));
    expect(screen.getByRole('region', { name: 'Source library' })).toBeInTheDocument();

    const nameInput = screen.getByLabelText('Pipeline name');
    await userEvent.click(nameInput);
    expect(screen.queryByRole('region', { name: 'Source library' })).not.toBeInTheDocument();
    expect(nameInput).toHaveFocus();
  });

  test('T1-F5-3: clicking outside #source-library preserves draft pipeline name, sources, and configured steps', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, {
      datasets: [makeOrdersDataset(), makeCustomersDataset()],
    });
    await waitForPipelineReady();

    const nameInput = screen.getByLabelText('Pipeline name');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Showcase Draft');
    await userEvent.click(screen.getByRole('button', { name: 'Add Clean text step' }));

    await userEvent.click(screen.getByRole('button', { name: 'Sources (1)' }));
    await userEvent.click(screen.getByRole('heading', { name: 'Source preview: orders.csv' }));

    expect(screen.queryByRole('region', { name: 'Source library' })).not.toBeInTheDocument();
    expect(nameInput).toHaveValue('Showcase Draft');
    expect(getStepItems()).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Sources (1)' })).toBeInTheDocument();
  });

  test('T1-F5-4: opening #source-library via + Add source tab button stays open and closes on outside click', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, {
      datasets: [makeOrdersDataset(), makeCustomersDataset()],
    });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Add source sheet' }));
    expect(screen.getByRole('region', { name: 'Source library' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('complementary', { name: 'Pipeline settings' }));
    expect(screen.queryByRole('region', { name: 'Source library' })).not.toBeInTheDocument();
  });

  test('T1-F5-5: document-level Escape closes #source-library restoring focus and #saved-pipelines dismisses on outside click and Escape', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, {
      datasets: [makeOrdersDataset()],
      pipelines: [buildSavedPipeline()],
    });
    await waitForPipelineReady();

    const sourcesBtn = screen.getByRole('button', { name: 'Sources (1)' });
    await userEvent.click(sourcesBtn);
    expect(screen.getByRole('region', { name: 'Source library' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Source library' })).not.toBeInTheDocument();
    expect(sourcesBtn).toHaveFocus();

    const savedBtn = screen.getByRole('button', { name: 'Saved' });
    await userEvent.click(savedBtn);
    expect(await screen.findByText('Saved Showcase Pipeline')).toBeInTheDocument();
    const nameInput = screen.getByLabelText('Pipeline name');
    await userEvent.click(nameInput);
    expect(screen.queryByRole('region', { name: 'Saved pipelines' })).not.toBeInTheDocument();
    expect(nameInput).toHaveFocus();

    await userEvent.click(savedBtn);
    expect(screen.getByRole('region', { name: 'Saved pipelines' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Saved pipelines' })).not.toBeInTheDocument();
    expect(savedBtn).toHaveFocus();
  });

  test('T1-F6-1: applied step rows render live describeStep summaries that update as config changes', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, { datasets: [makeOrdersDataset()] });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Add Replace values step' }));
    await userEvent.selectOptions(screen.getByLabelText('Replace in column'), 'city');
    fireEvent.change(screen.getByLabelText('Old value'), { target: { value: 'HCM' } });
    fireEvent.change(screen.getByLabelText('New value'), { target: { value: 'Ho Chi Minh' } });

    expect(within(getStepItems()[0]).getByText('In city, replace "HCM" with "Ho Chi Minh"')).toBeInTheDocument();
  });

  test('T1-F6-2: invalid step displays inline error badge even when inactive and clears badge when fixed', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, { datasets: [makeOrdersDataset()] });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Columns', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Select columns step' }));

    await userEvent.click(screen.getByRole('button', { name: 'Clean', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Clean text step' }));
    await userEvent.selectOptions(screen.getByLabelText('Rule 1 column'), 'city');

    await userEvent.click(within(getStepItems()[0]).getByRole('button', { name: /^1\s/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'city' }));
    expect(within(getStepItems()[1]).getByLabelText(/validation error/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('checkbox', { name: 'city' }));
    expect(within(getStepItems()[1]).queryByLabelText(/validation error/i)).not.toBeInTheDocument();
  });

  test('T1-F6-3: removing an active step automatically selects an adjacent remaining step', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, { datasets: [makeOrdersDataset()] });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Add Clean text step' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Replace values step' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Remove duplicates step' }));

    await userEvent.click(within(getStepItems()[1]).getByRole('button', { name: /^2\s/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove step 2' }));

    expect(getStepItems()).toHaveLength(2);
    expect(screen.getByRole('heading', { name: /Configure step \d+/i })).toBeInTheDocument();
    expect(getStepItems().some((item) => within(item).getByRole('button', { name: /^\d+\s/ }).getAttribute('aria-pressed') === 'true')).toBe(true);
  });

  test('T1-F6-4: ColumnChecks Select all and Clear buttons toggle all checkboxes and update validation', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, { datasets: [makeOrdersDataset()] });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Columns', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Select columns step' }));

    const group = screen.getByRole('group', { name: 'Columns to keep' });
    await userEvent.click(within(group).getByRole('button', { name: 'Clear' }));
    within(group).getAllByRole('checkbox').forEach((box) => expect(box).not.toBeChecked());
    expect(screen.getByRole('button', { name: 'Run pipeline' })).toBeDisabled();

    await userEvent.click(within(group).getByRole('button', { name: 'Select all' }));
    within(group).getAllByRole('checkbox').forEach((box) => expect(box).toBeChecked());
    expect(screen.getByRole('button', { name: 'Run pipeline' })).toBeEnabled();
  });

  test('T1-F6-5: removeSource updates primaryId, previewId, compareId, and focusId cleanly without duplicate split panes', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS},${DS_CUSTOMERS},${DS_EXTRA}`, {
      datasets: [makeOrdersDataset(), makeCustomersDataset(), makeExtraDataset()],
    });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Compare side-by-side' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove source orders.csv' }));

    const headings = screen.getAllByRole('heading', { name: /Source preview:/i }).map((h) => h.textContent);
    expect(headings).toEqual(['Source preview: customers.tsv', 'Source preview: extra.csv']);
    expect(within(getSourceTabs()[0]).getByLabelText('Starting dataset')).toBeInTheDocument();
  });

  test('T1-F7-1: clicking Rule 1 comparison value on datetime column opens portal Choose date and time dialog', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, { datasets: [makeOrdersDataset()] });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Filter', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Filter rows step' }));
    await userEvent.selectOptions(screen.getByLabelText('Rule 1 column'), 'city');
    await userEvent.click(screen.getByLabelText('Rule 1 comparison value'));
    expect(screen.queryByRole('dialog', { name: 'Choose date and time' })).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Rule 1 column'), 'order_date');
    await userEvent.click(screen.getByLabelText('Rule 1 comparison value'));
    const dialog = screen.getByRole('dialog', { name: 'Choose date and time' });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Previous month' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Next month' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Today' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Clear' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Done' })).toBeInTheDocument();
    expect(within(dialog).getByRole('checkbox', { name: /Include time/i })).toBeInTheDocument();
  });

  test('T1-F7-2: navigating months and picking a day populates YYYY-MM-DD and submits cleanly', async () => {
    const { state } = renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, { datasets: [makeOrdersDataset()] });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Filter', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Filter rows step' }));
    await userEvent.selectOptions(screen.getByLabelText('Rule 1 column'), 'order_date');

    await userEvent.click(screen.getByLabelText('Rule 1 comparison value'));
    const dialog = screen.getByRole('dialog', { name: 'Choose date and time' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Next month' }));
    await userEvent.click(within(dialog).getByRole('button', { name: /(?:^|[\s-])15(?:,.*|\s*\(.*\))?$/ }));

    expect(screen.queryByRole('dialog', { name: 'Choose date and time' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Rule 1 comparison value').value).toMatch(/^\d{4}-\d{2}-15$/);
    await userEvent.click(screen.getByRole('button', { name: 'Run pipeline' }));
    await waitFor(() => expect(state.submittedRuns).toHaveLength(1));
    expect(state.submittedRuns[0].body.steps[0].config.conditions[0].value).toMatch(/^\d{4}-\d{2}-15$/);
  });

  test('T1-F7-3: enabling Include time and setting Hour, Minute, Second emits YYYY-MM-DD HH:mm:ss', async () => {
    const { state } = renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, { datasets: [makeOrdersDataset()] });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Filter', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Filter rows step' }));
    await userEvent.selectOptions(screen.getByLabelText('Rule 1 column'), 'order_date');

    await userEvent.click(screen.getByLabelText('Rule 1 comparison value'));
    const dialog = screen.getByRole('dialog', { name: 'Choose date and time' });
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Include time/i }));
    await userEvent.click(within(dialog).getByRole('button', { name: /(?:^|[\s-])15(?:,.*|\s*\(.*\))?$/ }));
    fireEvent.change(within(dialog).getByLabelText(/hour/i), { target: { value: '14' } });
    fireEvent.change(within(dialog).getByLabelText(/minute/i), { target: { value: '30' } });
    fireEvent.change(within(dialog).getByLabelText(/second/i), { target: { value: '45' } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }));

    expect(screen.getByLabelText('Rule 1 comparison value').value).toMatch(/^\d{4}-\d{2}-15 14:30:45$/);
    await userEvent.click(screen.getByRole('button', { name: 'Run pipeline' }));
    await waitFor(() => expect(state.submittedRuns).toHaveLength(1));
    expect(state.submittedRuns[0].body.steps[0].config.conditions[0].value).toMatch(/^\d{4}-\d{2}-15 14:30:45$/);
  });

  test('T1-F7-4: Today, Clear, and Done actions populate today date, clear input, and close dialog', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, { datasets: [makeOrdersDataset()] });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Filter', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Filter rows step' }));
    await userEvent.selectOptions(screen.getByLabelText('Rule 1 column'), 'order_date');

    const input = screen.getByLabelText('Rule 1 comparison value');
    await userEvent.click(input);
    let dialog = screen.getByRole('dialog', { name: 'Choose date and time' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Today' }));
    expect(validTodayStrings()).toContain(input.value);

    await userEvent.click(input);
    dialog = screen.getByRole('dialog', { name: 'Choose date and time' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Clear' }));
    expect(input).toHaveValue('');

    await userEvent.click(input);
    dialog = screen.getByRole('dialog', { name: 'Choose date and time' });
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Include time/i }));
    await userEvent.click(within(dialog).getByRole('button', { name: /(?:^|[\s-])20(?:,.*|\s*\(.*\))?$/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog', { name: 'Choose date and time' })).not.toBeInTheDocument();
    expect(input.value).toMatch(/^\d{4}-\d{2}-20 00:00:00$/);
  });

  test('T1-F7-5: Escape and outside click close the datetime dialog without disrupting pipeline state', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, { datasets: [makeOrdersDataset()] });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Filter', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Filter rows step' }));
    await userEvent.selectOptions(screen.getByLabelText('Rule 1 column'), 'order_date');

    const input = screen.getByLabelText('Rule 1 comparison value');
    await userEvent.click(input);
    const dialog = screen.getByRole('dialog', { name: 'Choose date and time' });
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Include time/i }));
    await userEvent.click(within(dialog).getByRole('button', { name: /(?:^|[\s-])15(?:,.*|\s*\(.*\))?$/ }));

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Choose date and time' })).not.toBeInTheDocument();
    expect(input.value).toMatch(/^\d{4}-\d{2}-15 00:00:00$/);

    await userEvent.click(input);
    expect(screen.getByRole('dialog', { name: 'Choose date and time' })).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Pipeline name'));
    expect(screen.queryByRole('dialog', { name: 'Choose date and time' })).not.toBeInTheDocument();
    expect(getStepItems()).toHaveLength(1);
    expect(input.value).toMatch(/^\d{4}-\d{2}-15 00:00:00$/);
  });

  test('T1-F7-6: after, before, and equals operators on a datetime column all open the calendar dialog', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, { datasets: [makeOrdersDataset()] });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Filter', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Filter rows step' }));
    await userEvent.selectOptions(screen.getByLabelText('Rule 1 column'), 'order_date');

    for (const op of ['after', 'before', 'equals']) {
      await userEvent.selectOptions(screen.getByLabelText('Rule 1 comparison'), op);
      await userEvent.click(screen.getByLabelText('Rule 1 comparison value'));
      expect(screen.getByRole('dialog', { name: 'Choose date and time' })).toBeInTheDocument();
      fireEvent.keyDown(document, { key: 'Escape' });
    }
  });

  test('T1-F8-1: Combine tab with 1 source disables Join/Append with aria-describedby and requirement message', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, { datasets: [makeOrdersDataset()] });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Combine', exact: true }));
    const toolbar = screen.getByRole('toolbar', { name: 'Transformations' });
    const joinBtn = within(toolbar).getByRole('button', { name: 'Add Join tables step' });
    const concatBtn = within(toolbar).getByRole('button', { name: 'Add Append rows step' });

    expect(joinBtn).toBeDisabled();
    expect(concatBtn).toBeDisabled();
    expect(joinBtn).toHaveAttribute('aria-describedby', 'combine-source-requirement');
    expect(concatBtn).toHaveAttribute('aria-describedby', 'combine-source-requirement');

    const hint = within(toolbar).getByRole('status');
    expect(hint).toHaveAttribute('id', 'combine-source-requirement');
    expect(hint).toHaveTextContent(/Add another source file \(at least 2 files required\) to join tables or append rows\./i);
  });

  test('T1-F8-2: Combine tab with 0 sources disables combine actions and offers quick Add source button', async () => {
    renderAt('/dashboard/pipelines', { datasets: [makeOrdersDataset(), makeCustomersDataset()] });
    await screen.findByRole('heading', { name: 'Start with your data' });

    await userEvent.click(screen.getByRole('button', { name: 'Combine', exact: true }));
    const toolbar = screen.getByRole('toolbar', { name: 'Transformations' });
    expect(within(toolbar).getByRole('button', { name: 'Add Join tables step' })).toBeDisabled();
    expect(within(toolbar).getByRole('button', { name: 'Add Append rows step' })).toBeDisabled();
    expect(within(toolbar).getByRole('status')).toHaveTextContent(/at least 2 files required/i);
    expect(within(toolbar).getByRole('button', { name: /Add source/i })).toBeEnabled();
  });

  test('T1-F8-3: Combine tab with 2 sources enables Join tables and Append rows and hides requirement hint', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS},${DS_CUSTOMERS}`, {
      datasets: [makeOrdersDataset(), makeCustomersDataset()],
    });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Combine', exact: true }));
    const toolbar = screen.getByRole('toolbar', { name: 'Transformations' });
    expect(within(toolbar).getByRole('button', { name: 'Add Join tables step' })).toBeEnabled();
    expect(within(toolbar).getByRole('button', { name: 'Add Append rows step' })).toBeEnabled();
    expect(within(toolbar).queryByRole('status')).not.toBeInTheDocument();
  });

  test('T1-F8-4: Combine tab with 3 sources remains operable and allows adding both Join and Append steps', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS},${DS_CUSTOMERS},${DS_EXTRA}`, {
      datasets: [makeOrdersDataset(), makeCustomersDataset(), makeExtraDataset()],
    });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Combine', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Join tables step' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Append rows step' }));
    expect(getStepItems()).toHaveLength(2);
  });

  test('T1-F8-5: join step settings display empty-source status message when secondary source is removed', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS},${DS_CUSTOMERS}`, {
      datasets: [makeOrdersDataset(), makeCustomersDataset()],
    });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Combine', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Join tables step' }));
    await userEvent.click(getSourceTabs()[1]);
    await userEvent.click(screen.getByRole('button', { name: 'Remove source customers.tsv' }));

    const settings = screen.getByRole('region', { name: 'Step settings' });
    expect(within(settings).getByRole('status')).toHaveTextContent('Add another source file to select a file to join.');
  });

  test('T1-F9-1: #dataset-review-file-select renders labeled File dropdown when 2+ CSV/TSV datasets exist', async () => {
    renderAt('/dashboard/datasets', { datasets: [makeOrdersDataset(), makeCustomersDataset()] });
    await screen.findByRole('rowheader', { name: 'orders.csv' });

    const row = screen.getByRole('row', { name: /orders\.csv/i });
    await userEvent.click(within(row).getByRole('button', { name: /Review data/i }));

    const panel = await screen.findByRole('region', { name: /Data review:/i });
    await within(panel).findByRole('cell', { name: 'ORD01' });
    const fileSelect = within(panel).getByLabelText(/^File$/i);
    expect(fileSelect).toHaveAttribute('id', 'dataset-review-file-select');
    expect(fileSelect).toHaveValue(DS_ORDERS);
    expect(getOptionValues(fileSelect)).toEqual([DS_ORDERS, DS_CUSTOMERS]);
  });

  test('T1-F9-2: selecting another file in #dataset-review-file-select updates heading and rows with 0 extra list calls', async () => {
    const { state } = renderAt('/dashboard/datasets', { datasets: [makeOrdersDataset(), makeCustomersDataset()] });
    await screen.findByRole('rowheader', { name: 'orders.csv' });

    const row = screen.getByRole('row', { name: /orders\.csv/i });
    await userEvent.click(within(row).getByRole('button', { name: /Review data/i }));
    const panel = await screen.findByRole('region', { name: /Data review:/i });
    await within(panel).findByRole('cell', { name: 'ORD01' });

    const listCallsBefore = listDatasetGetCount(state);
    await userEvent.selectOptions(within(panel).getByLabelText(/^File$/i), DS_CUSTOMERS);

    expect(await within(panel).findByRole('heading', { name: /Data review:\s*customers\.tsv/i })).toBeInTheDocument();
    expect(await within(panel).findByRole('cell', { name: 'VIP' })).toBeInTheDocument();
    expect(within(panel).queryByRole('cell', { name: 'ORD01' })).not.toBeInTheDocument();
    expect(listDatasetGetCount(state)).toBe(listCallsBefore);
  });

  test('T1-F9-3: uploading a new CSV file and clicking Review data includes uploaded file in File selector', async () => {
    const uploaded = makeDataset(DS_UPLOADED_1, 'fresh_orders.csv', 'csv', ORDERS_COLUMNS, ORDERS_ROWS);
    renderAt('/dashboard/datasets', {
      datasets: [makeCustomersDataset()],
      uploadDataset: uploaded,
    });
    await screen.findByRole('rowheader', { name: 'customers.tsv' });

    const file = new File(['order_id,city\nORD01,Hanoi\n'], 'fresh_orders.csv', { type: 'text/csv' });
    fireEvent.change(screen.getByLabelText('Choose files'), { target: { files: [file] } });
    await userEvent.click(screen.getByRole('button', { name: 'Upload 1 file' }));

    const uploadResults = await screen.findByRole('list', { name: 'Upload results' });
    await within(uploadResults).findByText(/Uploaded/i);
    await userEvent.click(within(uploadResults).getByRole('button', { name: /Review data/i }));

    const panel = await screen.findByRole('region', { name: /Data review:/i });
    const fileSelect = within(panel).getByLabelText(/^File$/i);
    expect(getOptionValues(fileSelect)).toEqual([DS_UPLOADED_1, DS_CUSTOMERS]);
    expect(fileSelect).toHaveValue(DS_UPLOADED_1);
  });

  test('T1-F9-4: switching back to original file in #dataset-review-file-select restores its columns and rows', async () => {
    renderAt('/dashboard/datasets', { datasets: [makeOrdersDataset(), makeCustomersDataset()] });
    await screen.findByRole('rowheader', { name: 'orders.csv' });

    await userEvent.click(within(screen.getByRole('row', { name: /orders\.csv/i })).getByRole('button', { name: /Review data/i }));
    const panel = await screen.findByRole('region', { name: /Data review:/i });
    await within(panel).findByRole('cell', { name: 'ORD01' });

    const fileSelect = within(panel).getByLabelText(/^File$/i);
    await userEvent.selectOptions(fileSelect, DS_CUSTOMERS);
    await within(panel).findByRole('cell', { name: 'VIP' });

    await userEvent.selectOptions(fileSelect, DS_ORDERS);
    expect(await within(panel).findByRole('cell', { name: 'Hanoi' })).toBeInTheDocument();
    expect(within(panel).queryByRole('cell', { name: 'VIP' })).not.toBeInTheDocument();
  });

  test('T1-F9-5: Rows per page and Close review remain operable alongside #dataset-review-file-select and restore focus', async () => {
    const manyOrders = makeDataset(DS_ORDERS, 'orders.csv', 'csv', ORDERS_COLUMNS, makeManyRows('ORD', 15, ORDERS_ROWS[0]));
    const { state } = renderAt('/dashboard/datasets', { datasets: [manyOrders, makeCustomersDataset()] });
    await screen.findByRole('rowheader', { name: 'orders.csv' });

    const triggerBtn = within(screen.getByRole('row', { name: /orders\.csv/i })).getByRole('button', { name: /Review data/i });
    await userEvent.click(triggerBtn);
    const panel = await screen.findByRole('region', { name: /Data review:/i });
    await within(panel).findByRole('cell', { name: 'ORD01' });

    await userEvent.selectOptions(within(panel).getByLabelText(/Rows per page/i), '10');
    await within(panel).findByText(/Rows 1–10 of 15/i);
    expect(state.requests.some((r) => r.pathname === `/api/etl/datasets/${DS_ORDERS}/rows/` && r.search.includes('page_size=10'))).toBe(true);

    await userEvent.click(within(panel).getByRole('button', { name: 'Close review' }));
    expect(screen.queryByRole('region', { name: /Data review:/i })).not.toBeInTheDocument();
    expect(triggerBtn).toHaveFocus();
  });
});

// =============================================================================
// TIER 2 — Boundary & Corner Cases (50 tests: F1:5, F2:5, F3:6, F4:6, F5:6, F6:6, F7:6, F8:5, F9:5)
// =============================================================================

describe('Tier 2 — Boundary & Corner Cases', () => {
  test('T2-F1-1: auth login page exposes aria-current, aria-invalid, and role="alert" on invalid credentials', async () => {
    renderAt('/login', {
      authenticated: false,
      loginError: {
        error: {
          code: 'invalid_credentials',
          message: 'Invalid username or password.',
          fields: { username: ['Enter your username.'] },
        },
      },
    });

    await screen.findByRole('heading', { name: 'Welcome back' });
    const nav = screen.getByRole('navigation', { name: 'Account access' });
    expect(within(nav).getByRole('link', { name: 'Sign in' })).toHaveAttribute('aria-current', 'page');

    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid username or password.');
    expect(screen.getByLabelText('Username')).toHaveAttribute('aria-invalid', 'true');
  });

  test('T2-F1-2: public landing page exposes hero landmarks, workflow steps, and primary CTA without session dependency', async () => {
    const { state } = renderAt('/', { authenticated: false });
    expect(screen.getByRole('heading', { name: 'From raw data to ready.' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Three steps. One workflow.' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Get started' }).length).toBeGreaterThanOrEqual(1);
    await waitFor(() => expect(state.requests.some((r) => r.pathname === '/api/auth/me/')).toBe(true));
    await act(async () => {});
  });

  test('T2-F1-3: disabled pipeline steps render Off indicator alongside unchecked toggle and zero active count', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, { datasets: [makeOrdersDataset()] });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Add Clean text step' }));
    await userEvent.click(screen.getByLabelText('Enable step 1'));

    expect(within(getStepItems()[0]).getByText('Off')).toBeInTheDocument();
    expect(screen.getByText(/0 active steps/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run pipeline' })).toBeDisabled();
  });

  test('T2-F1-4: failed run detail page renders accessible error alert and recovery link', async () => {
    const failedRun = buildRunRecord({
      id: RUN_1,
      runTitle: 'Failed Showcase Run',
      runStatus: 'failed',
      error: { code: 'transform_failed', message: 'Division by zero in step 2.' },
    });
    renderAt(`/dashboard/runs/${RUN_1}`, { runs: [failedRun] });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Division by zero in step 2.');
    expect(screen.getByRole('link', { name: 'Edit and resubmit' })).toHaveAttribute('href', `/dashboard/pipelines?run=${RUN_1}`);
  });

  test('T2-F1-5: dataset delete confirmation focuses Cancel and restores focus to Delete button on cancel', async () => {
    renderAt('/dashboard/datasets', { datasets: [makeOrdersDataset()] });
    await screen.findByRole('rowheader', { name: 'orders.csv' });

    const deleteTrigger = screen.getByRole('button', { name: 'Delete orders.csv' });
    await userEvent.click(deleteTrigger);

    const cancelBtn = await screen.findByRole('button', { name: 'Cancel' });
    expect(cancelBtn).toHaveFocus();
    await userEvent.click(cancelBtn);

    expect(screen.queryByRole('button', { name: 'Confirm deletion' })).not.toBeInTheDocument();
    expect(deleteTrigger).toHaveFocus();
  });

  test('T2-F2-1: empty datasets and empty pipelines states expose guidance and primary navigation actions', async () => {
    const { view } = renderAt('/dashboard/datasets', { datasets: [] });
    await screen.findByText('No datasets yet');
    expect(screen.getByRole('button', { name: 'Upload files' })).toBeDisabled();
    view.unmount();

    renderAt('/dashboard/pipelines', { datasets: [] });
    await screen.findByRole('heading', { name: 'Start with your data' });
    expect(screen.getByRole('button', { name: 'Add source' })).toBeEnabled();
    expect(screen.getByRole('link', { name: 'Upload new files' })).toHaveAttribute('href', '/dashboard/datasets');
  });

  test('T2-F2-2: Runs history page exposes status filter, table caption, and Run pages pagination', async () => {
    const run = buildRunRecord({ id: RUN_1, runTitle: 'Orders ETL Run' });
    renderAt('/dashboard/runs', { runs: [run] });

    await screen.findByRole('link', { name: 'Orders ETL Run' });
    expect(screen.getByLabelText('Status')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Run pages' })).toHaveTextContent(/Page 1 of 1/i);
  });

  test('T2-F2-3: split-view pane headings and Compare dataset selector switch right pane independently', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS},${DS_CUSTOMERS},${DS_EXTRA}`, {
      datasets: [makeOrdersDataset(), makeCustomersDataset(), makeExtraDataset()],
    });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Compare side-by-side' }));
    const compareSelect = screen.getByLabelText('Compare dataset');
    expect(compareSelect).toHaveValue(DS_CUSTOMERS);

    await userEvent.selectOptions(compareSelect, DS_EXTRA);
    expect(screen.getByRole('heading', { name: 'Source preview: orders.csv' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Source preview: extra.csv' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Source preview: customers.tsv' })).not.toBeInTheDocument();
  });

  test('T2-F2-4: switching across all four toolbar groups updates visible command buttons cleanly', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, { datasets: [makeOrdersDataset()] });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Columns', exact: true }));
    expect(screen.getByRole('button', { name: 'Add Select columns step' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Clean', exact: true }));
    expect(screen.getByRole('button', { name: 'Add Format dates step' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Filter', exact: true }));
    expect(screen.getByRole('button', { name: 'Add Filter rows step' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Combine', exact: true }));
    expect(screen.getByRole('button', { name: 'Add Join tables step' })).toBeInTheDocument();
  });

  test('T2-F2-5: Source library and Saved pipelines overlays expose distinct landmarks and pagination controls', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, {
      datasets: [makeOrdersDataset(), makeCustomersDataset()],
      pipelines: [buildSavedPipeline()],
    });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Sources (1)' }));
    const sourceLib = screen.getByRole('region', { name: 'Source library' });
    expect(within(sourceLib).getByRole('navigation', { name: 'Saved dataset pages' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Saved' }));
    expect(screen.queryByRole('region', { name: 'Source library' })).not.toBeInTheDocument();
    const savedPanel = screen.getByRole('region', { name: 'Saved pipelines' });
    expect(await within(savedPanel).findByRole('navigation', { name: 'Saved pipeline pages' })).toBeInTheDocument();
  });

  test('T2-F3-1: dropping a step onto itself is a safe no-op leaving step order unchanged', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, { datasets: [makeOrdersDataset()] });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Add Clean text step' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Replace values step' }));

    const items = getStepItems();
    dragAndDrop(items[0], items[0]);
    expect(getStepButtonText(getStepItems()[0])).toMatch(/^1\s*Clean text/);
    expect(getStepButtonText(getStepItems()[1])).toMatch(/^2\s*Replace values/);
  });

  test('T2-F3-2: single-step pipeline drag-and-drop onto itself does not crash or duplicate', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, { datasets: [makeOrdersDataset()] });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Add Clean text step' }));
    dragAndDrop(getStepItems()[0], getStepItems()[0]);
    expect(getStepItems()).toHaveLength(1);
    expect(getStepButtonText(getStepItems()[0])).toMatch(/^1\s*Clean text/);
  });

  test('T2-F3-3: step DnD is disabled with draggable="false" and drop ignored while submission is busy', async () => {
    let resolveSubmit;
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, {
      datasets: [makeOrdersDataset()],
      submitHandler: () => new Promise((resolve) => {
        resolveSubmit = resolve;
      }),
    });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Add Clean text step' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Replace values step' }));
    await userEvent.click(screen.getByRole('button', { name: 'Run pipeline' }));

    await waitFor(() => expect(screen.getByRole('button', { name: /Submitting pipeline/i })).toBeDisabled());
    getStepItems().forEach((item) => expect(item).toHaveAttribute('draggable', 'false'));

    dragAndDrop(getStepItems()[0], getStepItems()[1]);
    expect(getStepButtonText(getStepItems()[0])).toMatch(/^1\s*Clean text/);

    await act(async () => {
      resolveSubmit(jsonResponse({
        run: {
          id: RUN_1,
          name: 'Data cleaning pipeline',
          status: 'queued',
          created_at: '2026-11-15T10:01:00Z',
          started_at: null,
          finished_at: null,
          summary: null,
          error: null,
          result_available: false,
          download_url: null,
        },
      }, 202));
    });
  });

  test('T2-F3-4: cancelled step drag ending without drop leaves step order unchanged', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, { datasets: [makeOrdersDataset()] });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Add Clean text step' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Replace values step' }));

    const items = getStepItems();
    const dataTransfer = createDataTransfer();
    fireEvent.dragStart(items[0], { dataTransfer });
    fireEvent.dragOver(items[1], { dataTransfer });
    fireEvent.dragEnd(items[0], { dataTransfer });

    expect(getStepButtonText(getStepItems()[0])).toMatch(/^1\s*Clean text/);
    expect(getStepButtonText(getStepItems()[1])).toMatch(/^2\s*Replace values/);
  });

  test('T2-F3-5: dropping on a step with empty or malformed dataTransfer without dragStart is ignored', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, { datasets: [makeOrdersDataset()] });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Add Clean text step' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Replace values step' }));

    const emptyTransfer = createDataTransfer();
    fireEvent.drop(getStepItems()[1], { dataTransfer: emptyTransfer });

    const malformedTransfer = createDataTransfer();
    malformedTransfer.setData('text/plain', 'not-an-index');
    fireEvent.drop(getStepItems()[1], { dataTransfer: malformedTransfer });

    expect(getStepButtonText(getStepItems()[0])).toMatch(/^1\s*Clean text/);
    expect(getStepButtonText(getStepItems()[1])).toMatch(/^2\s*Replace values/);
  });

  test('T2-F3-6: reordering a secondary-source step via DnD preserves its sourceId in submitted payload', async () => {
    const { state } = renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS},${DS_CUSTOMERS}`, {
      datasets: [makeOrdersDataset(), makeCustomersDataset()],
    });
    await waitForPipelineReady();

    await userEvent.click(getSourceTabs()[1]);
    await userEvent.click(screen.getByRole('button', { name: 'Add Clean text step' }));
    await userEvent.click(getSourceTabs()[0]);
    await userEvent.click(screen.getByRole('button', { name: 'Add Remove duplicates step' }));
    await userEvent.click(screen.getByRole('button', { name: 'Combine', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Join tables step' }));

    dragAndDrop(getStepItems()[0], getStepItems()[1]);
    await userEvent.click(screen.getByRole('button', { name: 'Run pipeline' }));

    await waitFor(() => expect(state.submittedRuns).toHaveLength(1));
    const submittedSteps = state.submittedRuns[0].body.steps;
    expect(submittedSteps[1].type).toBe('string_transform');
    expect(submittedSteps[1].sourceId).toBe(DS_CUSTOMERS);
  });

  test('T2-F4-1: Alt+ArrowLeft at index 0 and Alt+ArrowRight at last index are safe no-ops', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS},${DS_CUSTOMERS},${DS_EXTRA}`, {
      datasets: [makeOrdersDataset(), makeCustomersDataset(), makeExtraDataset()],
    });
    await waitForPipelineReady();

    fireEvent.keyDown(getSourceTabs()[0], { key: 'ArrowLeft', altKey: true });
    fireEvent.keyDown(getSourceTabs()[2], { key: 'ArrowRight', altKey: true });

    const tabs = getSourceTabs();
    expect(tabs[0]).toHaveTextContent(/orders\.csv/);
    expect(tabs[1]).toHaveTextContent(/customers\.tsv/);
    expect(tabs[2]).toHaveTextContent(/extra\.csv/);
  });

  test('T2-F4-2: single loaded source tab ignores Alt+Arrow and self-drop without errors', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, { datasets: [makeOrdersDataset()] });
    await waitForPipelineReady();

    const soleTab = getSourceTabs()[0];
    fireEvent.keyDown(soleTab, { key: 'ArrowLeft', altKey: true });
    fireEvent.keyDown(soleTab, { key: 'ArrowRight', altKey: true });
    dragAndDrop(soleTab, soleTab);

    expect(getSourceTabs()).toHaveLength(1);
    expect(within(getSourceTabs()[0]).getByLabelText('Starting dataset')).toBeInTheDocument();
  });

  test('T2-F4-3: self-drop and cancelled drag on source tabs leave tab order unchanged', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS},${DS_CUSTOMERS},${DS_EXTRA}`, {
      datasets: [makeOrdersDataset(), makeCustomersDataset(), makeExtraDataset()],
    });
    await waitForPipelineReady();

    dragAndDrop(getSourceTabs()[1], getSourceTabs()[1]);
    const dataTransfer = createDataTransfer();
    fireEvent.dragStart(getSourceTabs()[0], { dataTransfer });
    fireEvent.dragOver(getSourceTabs()[2], { dataTransfer });
    fireEvent.dragEnd(getSourceTabs()[0], { dataTransfer });

    const tabs = getSourceTabs();
    expect(tabs[0]).toHaveTextContent(/orders\.csv/);
    expect(tabs[1]).toHaveTextContent(/customers\.tsv/);
    expect(tabs[2]).toHaveTextContent(/extra\.csv/);
  });

  test('T2-F4-4: source tab DnD and Alt+Arrow are blocked while submission is busy', async () => {
    let resolveSubmit;
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS},${DS_CUSTOMERS}`, {
      datasets: [makeOrdersDataset(), makeCustomersDataset()],
      submitHandler: () => new Promise((resolve) => {
        resolveSubmit = resolve;
      }),
    });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Combine', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Join tables step' }));
    await userEvent.click(screen.getByRole('button', { name: 'Run pipeline' }));

    await waitFor(() => expect(screen.getByRole('button', { name: /Submitting pipeline/i })).toBeDisabled());
    getSourceTabs().forEach((tab) => expect(tab).toHaveAttribute('draggable', 'false'));

    fireEvent.keyDown(getSourceTabs()[0], { key: 'ArrowRight', altKey: true });
    dragAndDrop(getSourceTabs()[0], getSourceTabs()[1]);
    expect(getSourceTabs()[0]).toHaveTextContent(/orders\.csv/);

    await act(async () => {
      resolveSubmit(jsonResponse({
        run: {
          id: RUN_1,
          name: 'Data cleaning pipeline',
          status: 'queued',
          created_at: '2026-11-15T10:01:00Z',
          started_at: null,
          finished_at: null,
          summary: null,
          error: null,
          result_available: false,
          download_url: null,
        },
      }, 202));
    });
  });

  test('T2-F4-5: reordering tabs in Compare side-by-side split view keeps left and right panes distinct', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS},${DS_CUSTOMERS},${DS_EXTRA}`, {
      datasets: [makeOrdersDataset(), makeCustomersDataset(), makeExtraDataset()],
    });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Compare side-by-side' }));
    dragAndDrop(getSourceTabs()[0], getSourceTabs()[2]);

    const headings = screen.getAllByRole('heading', { name: /Source preview:/i }).map((h) => h.textContent);
    expect(headings).toHaveLength(2);
    expect(new Set(headings).size).toBe(2);
  });

  test('T2-F4-6: concat append-order self-drop and empty dataTransfer drop leave datasetIds unchanged', async () => {
    const { state } = renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS},${DS_CUSTOMERS},${DS_EXTRA}`, {
      datasets: [makeOrdersDataset(), makeCustomersDataset(), makeExtraDataset()],
    });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Combine', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Append rows step' }));

    dragAndDrop(getAppendOrderItems()[0], getAppendOrderItems()[0]);
    fireEvent.drop(getAppendOrderItems()[1], { dataTransfer: createDataTransfer() });

    expect(getAppendOrderItems()[0]).toHaveTextContent('1. customers.tsv');
    expect(getAppendOrderItems()[1]).toHaveTextContent('2. extra.csv');

    await userEvent.click(screen.getByRole('button', { name: 'Run pipeline' }));
    await waitFor(() => expect(state.submittedRuns).toHaveLength(1));
    expect(state.submittedRuns[0].body.steps[0].config.datasetIds).toEqual([DS_CUSTOMERS, DS_EXTRA]);
  });

  test('T2-F5-1: clicking inside #source-library on checkboxes, hints, and pagination keeps it open', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, {
      datasets: [makeOrdersDataset(), makeCustomersDataset(), makeExtraDataset()],
      datasetsPageSize: 2,
    });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Sources (1)' }));
    const lib = screen.getByRole('region', { name: 'Source library' });

    await userEvent.click(within(lib).getByRole('checkbox', { name: 'Select source customers.tsv' }));
    await userEvent.click(within(lib).getByText(/CSV\/TSV/));
    await userEvent.click(within(lib).getByRole('button', { name: 'Next datasets' }));

    expect(await within(lib).findByText('extra.csv')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Source library' })).toBeInTheDocument();
  });

  test('T2-F5-2: dismissing #source-library via outside click clears pending librarySelected and limit alert', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, {
      datasets: [makeOrdersDataset(), makeCustomersDataset()],
      capabilities: createCapabilities({ maxSources: 1 }),
    });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Sources (1)' }));
    const lib = screen.getByRole('region', { name: 'Source library' });
    await userEvent.click(within(lib).getByRole('checkbox', { name: 'Select source customers.tsv' }));
    await userEvent.click(within(lib).getByRole('button', { name: 'Add selected (1)' }));
    expect(await within(lib).findByRole('alert')).toHaveTextContent(/exceed the file count/i);

    await userEvent.click(screen.getByLabelText('Pipeline name'));
    expect(screen.queryByRole('region', { name: 'Source library' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Sources (1)' }));
    const reopened = screen.getByRole('region', { name: 'Source library' });
    expect(within(reopened).getByRole('checkbox', { name: 'Select source customers.tsv' })).not.toBeChecked();
    expect(within(reopened).getByRole('button', { name: 'Add selected (0)' })).toBeDisabled();
    expect(within(reopened).queryByRole('alert')).not.toBeInTheDocument();
  });

  test('T2-F5-3: clicking Sources (N) trigger while #source-library is open cleanly toggles it closed', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, {
      datasets: [makeOrdersDataset(), makeCustomersDataset()],
    });
    await waitForPipelineReady();

    const sourcesBtn = screen.getByRole('button', { name: 'Sources (1)' });
    await userEvent.click(sourcesBtn);
    expect(screen.getByRole('region', { name: 'Source library' })).toBeInTheDocument();

    await userEvent.click(sourcesBtn);
    expect(screen.queryByRole('region', { name: 'Source library' })).not.toBeInTheDocument();
    expect(sourcesBtn).toHaveAttribute('aria-expanded', 'false');
  });

  test('T2-F5-4: empty-state Add source opens #source-library and outside click preserves empty state', async () => {
    renderAt('/dashboard/pipelines', { datasets: [makeOrdersDataset()] });
    await screen.findByRole('heading', { name: 'Start with your data' });

    await userEvent.click(screen.getByRole('button', { name: 'Add source' }));
    expect(screen.getByRole('region', { name: 'Source library' })).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('Pipeline name'));
    expect(screen.queryByRole('region', { name: 'Source library' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Start with your data' })).toBeInTheDocument();
  });

  test('T2-F5-5: clicking directly onto a step configuration input outside #source-library closes library and edits cleanly', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, {
      datasets: [makeOrdersDataset(), makeCustomersDataset()],
    });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Add Replace values step' }));
    await userEvent.click(screen.getByRole('button', { name: 'Sources (1)' }));
    expect(screen.getByRole('region', { name: 'Source library' })).toBeInTheDocument();

    const oldInput = screen.getByLabelText('Old value');
    await userEvent.click(oldInput);
    expect(screen.queryByRole('region', { name: 'Source library' })).not.toBeInTheDocument();

    fireEvent.change(oldInput, { target: { value: 'HCM' } });
    expect(oldInput).toHaveValue('HCM');
  });

  test('T2-F5-6: switching directly between Sources (N) and Saved buttons transitions panels without leaving both open', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, {
      datasets: [makeOrdersDataset()],
      pipelines: [buildSavedPipeline()],
    });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Sources (1)' }));
    expect(screen.getByRole('region', { name: 'Source library' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Saved' }));
    expect(screen.queryByRole('region', { name: 'Source library' })).not.toBeInTheDocument();
    const savedPanel = screen.getByRole('region', { name: 'Saved pipelines' });
    expect(savedPanel).toBeInTheDocument();
    await within(savedPanel).findByRole('navigation', { name: 'Saved pipeline pages' });

    await userEvent.click(screen.getByRole('button', { name: 'Sources (1)' }));
    expect(screen.queryByRole('region', { name: 'Saved pipelines' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Source library' })).toBeInTheDocument();
  });

  test('T2-F6-1: removing the sole remaining active step clears active selection to empty-settings guidance', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, { datasets: [makeOrdersDataset()] });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Add Clean text step' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove step 1' }));

    expect(getStepItems()).toHaveLength(0);
    expect(screen.getByText('Select an applied step to adjust its settings. Source previews show the original saved data.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Configure step/i })).not.toBeInTheDocument();
  });

  test('T2-F6-2: removing the active first step selects successor step cleanly while preserving its config', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, { datasets: [makeOrdersDataset()] });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Add Clean text step' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Replace values step' }));
    fireEvent.change(screen.getByLabelText('Old value'), { target: { value: 'Hanoi' } });

    await userEvent.click(within(getStepItems()[0]).getByRole('button', { name: /^1\s/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove step 1' }));

    expect(getStepItems()).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Configure step 1' })).toBeInTheDocument();
    expect(screen.getByLabelText('Old value')).toHaveValue('Hanoi');
  });

  test('T2-F6-3: removing down to 1 source exits split view cleanly and hides Compare side-by-side', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS},${DS_CUSTOMERS}`, {
      datasets: [makeOrdersDataset(), makeCustomersDataset()],
    });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Compare side-by-side' }));
    expect(screen.getAllByRole('heading', { name: /Source preview:/i })).toHaveLength(2);

    await userEvent.click(screen.getByRole('button', { name: 'Remove source customers.tsv' }));
    expect(screen.getAllByRole('heading', { name: /Source preview:/i })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Compare side-by-side' })).not.toBeInTheDocument();
  });

  test('T2-F6-4: ColumnChecks Select all and Clear in merge_columns and empty-column state handle edges safely', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, { datasets: [makeOrdersDataset()] });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Columns', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Select columns step' }));
    await userEvent.click(within(screen.getByRole('group', { name: 'Columns to keep' })).getByRole('button', { name: 'Clear' }));

    await userEvent.click(screen.getByRole('button', { name: 'Add Merge columns step' }));
    const emptyMergeGroup = screen.getByRole('group', { name: 'Columns to merge' });
    expect(within(emptyMergeGroup).getByText('No columns available.')).toBeInTheDocument();

    await userEvent.click(within(getStepItems()[0]).getByRole('button', { name: /^1\s/ }));
    await userEvent.click(within(screen.getByRole('group', { name: 'Columns to keep' })).getByRole('button', { name: 'Select all' }));

    await userEvent.click(within(getStepItems()[1]).getByRole('button', { name: /^2\s/ }));
    const mergeGroup = screen.getByRole('group', { name: 'Columns to merge' });
    await userEvent.click(within(mergeGroup).getByRole('button', { name: 'Select all' }));
    within(mergeGroup).getAllByRole('checkbox').forEach((box) => expect(box).toBeChecked());
    await userEvent.click(within(mergeGroup).getByRole('button', { name: 'Clear' }));
    within(mergeGroup).getAllByRole('checkbox').forEach((box) => expect(box).not.toBeChecked());
  });

  test('T2-F6-5: ColumnChecks Select all and Clear in multi-rule drop_duplicates scope strictly to targeted rule', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, { datasets: [makeOrdersDataset()] });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Add Remove duplicates step' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    await userEvent.click(screen.getByLabelText('Rule 1: compare all columns'));
    await userEvent.click(screen.getByLabelText('Rule 2: compare all columns'));

    const rule1Group = screen.getByRole('group', { name: 'Rule 1 comparison columns' });
    const rule2Group = screen.getByRole('group', { name: 'Rule 2 comparison columns' });

    await userEvent.click(within(rule1Group).getByRole('button', { name: 'Select all' }));
    within(rule1Group).getAllByRole('checkbox').forEach((box) => expect(box).toBeChecked());
    expect(within(rule2Group).getByRole('checkbox', { name: 'order_id' })).toBeChecked();
    expect(within(rule2Group).getByRole('checkbox', { name: 'city' })).not.toBeChecked();

    await userEvent.click(within(rule1Group).getByRole('button', { name: 'Clear' }));
    within(rule1Group).getAllByRole('checkbox').forEach((box) => expect(box).not.toBeChecked());
    expect(within(rule2Group).getByRole('checkbox', { name: 'order_id' })).toBeChecked();
  });

  test('T2-F6-6: disabled step displays Off alongside describeStep summary without triggering missing-column errors', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, { datasets: [makeOrdersDataset()] });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Columns', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Select columns step' }));

    await userEvent.click(screen.getByRole('button', { name: 'Clean', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Clean text step' }));
    await userEvent.selectOptions(screen.getByLabelText('Rule 1 column'), 'city');
    await userEvent.click(screen.getByLabelText('Enable step 2'));

    await userEvent.click(within(getStepItems()[0]).getByRole('button', { name: /^1\s/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'city' }));

    const step2 = getStepItems()[1];
    expect(within(step2).getByText('Off')).toBeInTheDocument();
    expect(within(step2).getByText(/city \(trim whitespace\)/i)).toBeInTheDocument();
    expect(within(step2).queryByLabelText(/validation error/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run pipeline' })).toBeEnabled();
  });

  test('T2-F7-1: arbitrary invalid text typing and direct change are prevented in datetime filter input', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, { datasets: [makeOrdersDataset()] });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Filter', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Filter rows step' }));
    await userEvent.selectOptions(screen.getByLabelText('Rule 1 column'), 'order_date');

    const input = screen.getByLabelText('Rule 1 comparison value');
    await userEvent.type(input, 'not-a-date');
    expect(input.value).not.toBe('not-a-date');

    fireEvent.change(input, { target: { value: 'invalid-text' } });
    expect(input.value).not.toBe('invalid-text');
    expect(screen.getByRole('button', { name: 'Run pipeline' })).toBeDisabled();
  });

  test('T2-F7-2: saved pipeline validation rejects impossible calendar/time dates and accepts valid leap-year and time', async () => {
    const invalidDates = ['2026-02-30', '2025-02-29', '2026-13-01', '2026-04-31', '2026-01-01 25:00:00', 'not-a-date'];
    const invalidPipeline = buildSavedPipeline({
      id: PIPE_1,
      pipelineName: 'Invalid Dates Pipeline',
      datasetId: DS_ORDERS,
      steps: invalidDates.map((val) => ({
        type: 'filter_rows',
        enabled: true,
        config: { conditions: [{ column: 'order_date', operator: 'after', value: val }] },
      })),
    });

    const { view } = renderAt(`/dashboard/pipelines?pipeline=${PIPE_1}`, {
      datasets: [makeOrdersDataset()],
      pipelines: [invalidPipeline],
    });
    await waitForPipelineReady();

    expect(screen.getByRole('button', { name: 'Run pipeline' })).toBeDisabled();
    getStepItems().forEach((item) => {
      expect(within(item).getByLabelText(/validation error/i)).toBeInTheDocument();
    });
    view.unmount();

    const validPipeline = buildSavedPipeline({
      id: PIPE_2,
      pipelineName: 'Valid Leap Year Pipeline',
      datasetId: DS_ORDERS,
      steps: [
        {
          type: 'filter_rows',
          enabled: true,
          config: {
            conditions: [
              { column: 'order_date', operator: 'after', value: '2024-02-29' },
              { column: 'order_date', operator: 'before', value: '2026-11-22 14:30:45' },
            ],
          },
        },
      ],
    });

    renderAt(`/dashboard/pipelines?pipeline=${PIPE_2}`, {
      datasets: [makeOrdersDataset()],
      pipelines: [validPipeline],
    });
    await waitForPipelineReady();
    expect(screen.getByRole('button', { name: 'Run pipeline' })).toBeEnabled();
  });

  test('T2-F7-3: loading saved run with invalid datetime blocks submission until fixed via calendar picker', async () => {
    const badRun = buildRunRecord({
      id: RUN_1,
      runTitle: 'Bad Date Run',
      datasetId: DS_ORDERS,
      steps: [
        {
          type: 'filter_rows',
          enabled: true,
          config: { conditions: [{ column: 'order_date', operator: 'after', value: '2026-02-30' }] },
        },
      ],
    });

    renderAt(`/dashboard/pipelines?run=${RUN_1}`, {
      datasets: [makeOrdersDataset()],
      runs: [badRun],
    });
    await waitForPipelineReady();

    expect(screen.getByRole('button', { name: 'Run pipeline' })).toBeDisabled();
    expect(screen.getByRole('region', { name: 'Step settings' })).toHaveTextContent(/valid/i);

    await userEvent.click(screen.getByLabelText('Rule 1 comparison value'));
    const dialog = screen.getByRole('dialog', { name: 'Choose date and time' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Today' }));

    expect(screen.queryByRole('dialog', { name: 'Choose date and time' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run pipeline' })).toBeEnabled();
  });

  test('T2-F7-4: switching column from datetime to string or boolean closes open dialog and resets filter input', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, { datasets: [makeOrdersDataset()] });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Filter', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Filter rows step' }));
    await userEvent.selectOptions(screen.getByLabelText('Rule 1 column'), 'order_date');
    await userEvent.selectOptions(screen.getByLabelText('Rule 1 comparison'), 'after');

    await userEvent.click(screen.getByLabelText('Rule 1 comparison value'));
    expect(screen.getByRole('dialog', { name: 'Choose date and time' })).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Rule 1 column'), 'city');
    expect(screen.queryByRole('dialog', { name: 'Choose date and time' })).not.toBeInTheDocument();

    const stringInput = screen.getByLabelText('Rule 1 comparison value');
    expect(stringInput).toHaveValue('');
    fireEvent.change(stringInput, { target: { value: 'Hanoi' } });
    expect(stringInput).toHaveValue('Hanoi');

    await userEvent.selectOptions(screen.getByLabelText('Rule 1 column'), 'is_paid');
    expect(screen.queryByLabelText('Rule 1 comparison value')).not.toBeInTheDocument();
  });

  test('T2-F7-5: multiple filter_rows datetime rules Rule 1 and Rule 2 operate independently', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, { datasets: [makeOrdersDataset()] });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Filter', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Filter rows step' }));
    await userEvent.selectOptions(screen.getByLabelText('Rule 1 column'), 'order_date');
    await userEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    await userEvent.selectOptions(screen.getByLabelText('Rule 2 column'), 'order_date');
    await userEvent.selectOptions(screen.getByLabelText('Rule 2 comparison'), 'before');

    await userEvent.click(screen.getByLabelText('Rule 1 comparison value'));
    let dialog = screen.getByRole('dialog', { name: 'Choose date and time' });
    await userEvent.click(within(dialog).getByRole('button', { name: /(?:^|[\s-])15(?:,.*|\s*\(.*\))?$/ }));

    await userEvent.click(screen.getByLabelText('Rule 2 comparison value'));
    dialog = screen.getByRole('dialog', { name: 'Choose date and time' });
    await userEvent.click(within(dialog).getByRole('button', { name: /(?:^|[\s-])25(?:,.*|\s*\(.*\))?$/ }));

    expect(screen.getByLabelText('Rule 1 comparison value').value).toMatch(/^\d{4}-\d{2}-15$/);
    expect(screen.getByLabelText('Rule 2 comparison value').value).toMatch(/^\d{4}-\d{2}-25$/);
  });

  test('T2-F7-6: Previous month and Next month navigation crosses Dec <-> Jan year boundary accurately', async () => {
    const janPipeline = buildSavedPipeline({
      id: PIPE_1,
      pipelineName: 'January Boundary Pipeline',
      datasetId: DS_ORDERS,
      steps: [
        {
          type: 'filter_rows',
          enabled: true,
          config: { conditions: [{ column: 'order_date', operator: 'after', value: '2026-01-15' }] },
        },
      ],
    });

    renderAt(`/dashboard/pipelines?pipeline=${PIPE_1}`, {
      datasets: [makeOrdersDataset()],
      pipelines: [janPipeline],
    });
    await waitForPipelineReady();

    const input = screen.getByLabelText('Rule 1 comparison value');
    await userEvent.click(input);
    let dialog = screen.getByRole('dialog', { name: 'Choose date and time' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Previous month' }));
    await userEvent.click(within(dialog).getByRole('button', { name: /(?:^|[\s-])20(?:,.*|\s*\(.*\))?$/ }));
    expect(input).toHaveValue('2025-12-20');

    await userEvent.click(input);
    dialog = screen.getByRole('dialog', { name: 'Choose date and time' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Next month' }));
    await userEvent.click(within(dialog).getByRole('button', { name: /(?:^|[\s-])20(?:,.*|\s*\(.*\))?$/ }));
    expect(input).toHaveValue('2026-01-20');
  });

  test('T2-F8-1: single CSV plus storage-only JSON counts as 1 source and keeps Combine disabled', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, {
      datasets: [makeOrdersDataset(), makeJsonDataset()],
    });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Combine', exact: true }));
    const toolbar = screen.getByRole('toolbar', { name: 'Transformations' });
    expect(within(toolbar).getByRole('button', { name: 'Add Join tables step' })).toBeDisabled();
    expect(within(toolbar).getByRole('button', { name: 'Add Append rows step' })).toBeDisabled();
    expect(within(toolbar).getByRole('status')).toHaveTextContent(/at least 2 files required/i);

    await userEvent.click(within(toolbar).getByRole('button', { name: /Add source/i }));
    const lib = screen.getByRole('region', { name: 'Source library' });
    expect(within(lib).getByRole('checkbox', { name: 'Select source archive.json' })).toBeDisabled();
  });

  test('T2-F8-2: removing 2nd source while on Combine tab immediately disables Join/Append and shows guidance', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS},${DS_CUSTOMERS}`, {
      datasets: [makeOrdersDataset(), makeCustomersDataset()],
    });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Combine', exact: true }));
    const toolbar = screen.getByRole('toolbar', { name: 'Transformations' });
    expect(within(toolbar).getByRole('button', { name: 'Add Join tables step' })).toBeEnabled();

    await userEvent.click(getSourceTabs()[1]);
    await userEvent.click(screen.getByRole('button', { name: 'Remove source customers.tsv' }));
    expect(within(toolbar).getByRole('button', { name: 'Add Join tables step' })).toBeDisabled();
    expect(within(toolbar).getByRole('button', { name: 'Add Append rows step' })).toBeDisabled();
    expect(within(toolbar).getByRole('status')).toHaveTextContent(/at least 2 files required/i);
  });

  test('T2-F8-3: adding 2nd source via toolbar quick Add source button unlocks Combine actions', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, {
      datasets: [makeOrdersDataset(), makeCustomersDataset()],
    });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Combine', exact: true }));
    const toolbar = screen.getByRole('toolbar', { name: 'Transformations' });
    await userEvent.click(within(toolbar).getByRole('button', { name: /Add source/i }));

    const lib = screen.getByRole('region', { name: 'Source library' });
    await userEvent.click(within(lib).getByRole('button', { name: 'Add source customers.tsv' }));

    await waitFor(() => expect(within(toolbar).getByRole('button', { name: 'Add Join tables step' })).toBeEnabled());
    expect(within(toolbar).getByRole('button', { name: 'Add Append rows step' })).toBeEnabled();
    expect(within(toolbar).queryByRole('status')).not.toBeInTheDocument();
  });

  test('T2-F8-4: concat step settings display empty-source guidance when secondary source is removed', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS},${DS_CUSTOMERS}`, {
      datasets: [makeOrdersDataset(), makeCustomersDataset()],
    });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Combine', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Append rows step' }));
    await userEvent.click(getSourceTabs()[1]);
    await userEvent.click(screen.getByRole('button', { name: 'Remove source customers.tsv' }));

    const settings = screen.getByRole('region', { name: 'Step settings' });
    expect(within(settings).getByText('Add another source file to append rows.')).toBeInTheDocument();
  });

  test('T2-F8-5: reaching maxSources limit in source library shows alert without corrupting Combine availability', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS},${DS_CUSTOMERS}`, {
      datasets: [makeOrdersDataset(), makeCustomersDataset(), makeExtraDataset()],
      capabilities: createCapabilities({ maxSources: 2 }),
    });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Combine', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Sources (2)' }));
    const lib = screen.getByRole('region', { name: 'Source library' });
    await userEvent.click(within(lib).getByRole('button', { name: 'Add source extra.csv' }));

    expect(await within(lib).findByRole('alert')).toHaveTextContent(/exceed the file count/i);
    expect(screen.getByRole('button', { name: 'Sources (2)' })).toBeInTheDocument();
    const toolbar = screen.getByRole('toolbar', { name: 'Transformations' });
    expect(within(toolbar).getByRole('button', { name: 'Add Join tables step' })).toBeEnabled();
  });

  test('T2-F9-1: single CSV plus storage-only JSON hides #dataset-review-file-select while keeping Rows per page', async () => {
    renderAt('/dashboard/datasets', { datasets: [makeOrdersDataset(), makeJsonDataset()] });
    await screen.findByRole('rowheader', { name: 'orders.csv' });

    await userEvent.click(within(screen.getByRole('row', { name: /orders\.csv/i })).getByRole('button', { name: /Review data/i }));
    const panel = await screen.findByRole('region', { name: /Data review:/i });
    await within(panel).findByRole('cell', { name: 'ORD01' });

    expect(within(panel).queryByLabelText(/^File$/i)).not.toBeInTheDocument();
    expect(within(panel).getByLabelText(/Rows per page/i)).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Close review' })).toBeInTheDocument();
  });

  test('T2-F9-2: non-CSV/TSV datasets are excluded from #dataset-review-file-select options when 2+ CSV/TSV exist', async () => {
    renderAt('/dashboard/datasets', { datasets: [makeOrdersDataset(), makeCustomersDataset(), makeJsonDataset()] });
    await screen.findByRole('rowheader', { name: 'orders.csv' });

    await userEvent.click(within(screen.getByRole('row', { name: /orders\.csv/i })).getByRole('button', { name: /Review data/i }));
    const panel = await screen.findByRole('region', { name: /Data review:/i });
    await within(panel).findByRole('cell', { name: 'ORD01' });

    const values = getOptionValues(within(panel).getByLabelText(/^File$/i));
    expect(values).toEqual([DS_ORDERS, DS_CUSTOMERS]);
    expect(values).not.toContain(DS_JSON);
  });

  test('T2-F9-3: switching files via #dataset-review-file-select from page 2 resets reviewPage to 1', async () => {
    const bigOrders = makeDataset(DS_ORDERS, 'orders.csv', 'csv', ORDERS_COLUMNS, makeManyRows('ORD', 30, ORDERS_ROWS[0]));
    const bigCustomers = makeDataset(DS_CUSTOMERS, 'customers.tsv', 'tsv', CUSTOMERS_COLUMNS, makeManyRows('CUST', 30, CUSTOMERS_ROWS[0]));
    const { state } = renderAt('/dashboard/datasets', { datasets: [bigOrders, bigCustomers] });
    await screen.findByRole('rowheader', { name: 'orders.csv' });

    await userEvent.click(within(screen.getByRole('row', { name: /orders\.csv/i })).getByRole('button', { name: /Review data/i }));
    const panel = await screen.findByRole('region', { name: /Data review:/i });
    await within(panel).findByRole('cell', { name: 'ORD01' });

    await userEvent.click(within(within(panel).getByRole('navigation', { name: 'Dataset review pages' })).getByRole('button', { name: 'Next' }));
    expect(await within(panel).findByRole('cell', { name: 'ORD26' })).toBeInTheDocument();

    await userEvent.selectOptions(within(panel).getByLabelText(/^File$/i), DS_CUSTOMERS);
    expect(await within(panel).findByRole('cell', { name: 'CUST01' })).toBeInTheDocument();
    expect(within(panel).queryByRole('cell', { name: 'CUST26' })).not.toBeInTheDocument();
    expect(within(panel).getByRole('navigation', { name: 'Dataset review pages' })).toHaveTextContent(/Page 1 of 2/i);
    expect(state.requests.some((r) => r.pathname === `/api/etl/datasets/${DS_CUSTOMERS}/rows/` && r.search.includes('page=1'))).toBe(true);
  });

  test('T2-F9-4: deduplicates uploaded queue and list items in #dataset-review-file-select and syncs aria-expanded', async () => {
    const uploadedOrders = makeOrdersDataset({ id: DS_UPLOADED_1, filename: 'orders_new.csv' });
    renderAt('/dashboard/datasets', {
      datasets: [makeCustomersDataset()],
      uploadDataset: uploadedOrders,
    });
    await screen.findByRole('rowheader', { name: 'customers.tsv' });

    const file = new File(['order_id,city\nORD01,Hanoi\n'], 'orders_new.csv', { type: 'text/csv' });
    fireEvent.change(screen.getByLabelText('Choose files'), { target: { files: [file] } });
    await userEvent.click(screen.getByRole('button', { name: 'Upload 1 file' }));

    const uploadResults = await screen.findByRole('list', { name: 'Upload results' });
    await within(uploadResults).findByText(/Uploaded/i);
    await userEvent.click(within(uploadResults).getByRole('button', { name: /Review data/i }));

    const panel = await screen.findByRole('region', { name: /Data review:/i });
    const fileSelect = within(panel).getByLabelText(/^File$/i);
    expect(getOptionValues(fileSelect)).toEqual([DS_UPLOADED_1, DS_CUSTOMERS]);
    expect(screen.getAllByRole('button', { name: 'Review data for orders_new.csv' })[0]).toHaveAttribute('aria-expanded', 'true');

    await userEvent.selectOptions(fileSelect, DS_CUSTOMERS);
    await within(panel).findByRole('cell', { name: 'VIP' });
    expect(screen.getByRole('button', { name: 'Review data for customers.tsv' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('button', { name: 'Review data for orders_new.csv' })[0]).toHaveAttribute('aria-expanded', 'false');
  });

  test('T2-F9-5: aborts in-flight /rows/ request on rapid switch, ignores stale payload, and retries failed file cleanly', async () => {
    let capturedSignal;
    let resolveOrders;
    let failCustomersOnce = true;

    renderAt('/dashboard/datasets', {
      datasets: [makeOrdersDataset(), makeCustomersDataset()],
      datasetRowsHandler: (id, { signal }) => {
        if (id === DS_ORDERS) {
          capturedSignal = signal;
          return new Promise((resolve) => {
            resolveOrders = resolve;
          });
        }
        if (id === DS_CUSTOMERS && failCustomersOnce) {
          failCustomersOnce = false;
          return jsonResponse({ error: { code: 'unavailable', message: 'Preview service temporarily unavailable.' } }, 503);
        }
        return null;
      },
    });
    await screen.findByRole('rowheader', { name: 'orders.csv' });

    await userEvent.click(screen.getByRole('button', { name: 'Review data for orders.csv' }));
    await waitFor(() => expect(capturedSignal).toBeDefined());

    await userEvent.click(screen.getByRole('button', { name: 'Review data for customers.tsv' }));
    expect(capturedSignal.aborted).toBe(true);

    await act(async () => {
      resolveOrders(jsonResponse(paginateRows(ORDERS_COLUMNS, [{ order_id: 'STALE_ORD', customer_id: 'C0', city: 'Old', amount: 1, order_date: '2026-01-01', is_paid: true }], 1, 25)));
    });

    const panel = await screen.findByRole('region', { name: /Data review:/i });
    expect(await within(panel).findByRole('alert')).toHaveTextContent(/unavailable/i);
    expect(within(panel).queryByRole('cell', { name: 'STALE_ORD' })).not.toBeInTheDocument();
    expect(within(panel).getByLabelText(/^File$/i)).toHaveValue(DS_CUSTOMERS);

    await userEvent.click(within(panel).getByRole('button', { name: 'Retry review' }));
    expect(await within(panel).findByRole('cell', { name: 'VIP' })).toBeInTheDocument();
  });
});

// =============================================================================
// TIER 3 — Cross-Feature Combinations (9 tests: T3-1 through T3-9)
// =============================================================================

describe('Tier 3 — Cross-Feature Combinations', () => {
  test('T3-1 (F3 + F6): step DnD across schema dependency clears inline error badge, updates summary, and preserves selection on delete', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, { datasets: [makeOrdersDataset()] });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Columns', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Select columns step' }));

    await userEvent.click(screen.getByRole('button', { name: 'Clean', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Clean text step' }));
    await userEvent.selectOptions(screen.getByLabelText('Rule 1 column'), 'city');

    await userEvent.click(within(getStepItems()[0]).getByRole('button', { name: /^1\s/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'city' }));
    expect(within(getStepItems()[1]).getByLabelText(/validation error/i)).toBeInTheDocument();
    expect(within(getStepItems()[1]).getByText(/city \(trim whitespace\)/i)).toBeInTheDocument();

    dragAndDrop(getStepItems()[1], getStepItems()[0]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Run pipeline' })).toBeEnabled());
    expect(within(getStepItems()[0]).queryByLabelText(/validation error/i)).not.toBeInTheDocument();

    await userEvent.click(within(getStepItems()[0]).getByRole('button', { name: /^1\s/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove step 1' }));
    expect(getStepItems()).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Configure step 1' })).toBeInTheDocument();
  });

  test('T3-2 (F4 + F6): source tab Alt+Arrow reorder, concat append-order DnD, and removeSource in split view', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS},${DS_CUSTOMERS},${DS_EXTRA}`, {
      datasets: [makeOrdersDataset(), makeCustomersDataset(), makeExtraDataset()],
    });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Compare side-by-side' }));
    fireEvent.keyDown(getSourceTabs()[1], { key: 'ArrowRight', altKey: true });
    expect(getSourceTabs()[1]).toHaveTextContent(/extra\.csv/);

    await userEvent.click(screen.getByRole('button', { name: 'Combine', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Append rows step' }));
    dragAndDrop(getAppendOrderItems()[1], getAppendOrderItems()[0]);
    expect(getAppendOrderItems()[0]).toHaveTextContent('1. customers.tsv');

    await userEvent.selectOptions(screen.getByLabelText('Compare dataset'), DS_EXTRA);
    await userEvent.click(screen.getByRole('button', { name: 'Remove source extra.csv' }));
    const headings = screen.getAllByRole('heading', { name: /Source preview:/i }).map((h) => h.textContent);
    expect(headings).toEqual(['Source preview: orders.csv', 'Source preview: customers.tsv']);
  });

  test('T3-3 (F5 + F3 + F4): source library outside dismissal preserves reordered source tabs, reordered steps, and focus', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS},${DS_CUSTOMERS}`, {
      datasets: [makeOrdersDataset(), makeCustomersDataset(), makeExtraDataset()],
    });
    await waitForPipelineReady();

    fireEvent.keyDown(getSourceTabs()[0], { key: 'ArrowRight', altKey: true });
    expect(getSourceTabs()[0]).toHaveTextContent(/customers\.tsv/);

    await userEvent.click(screen.getByRole('button', { name: 'Add Clean text step' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Replace values step' }));
    dragAndDrop(getStepItems()[1], getStepItems()[0]);
    expect(getStepButtonText(getStepItems()[0])).toMatch(/^1\s*Replace values/);

    await userEvent.click(screen.getByRole('button', { name: 'Sources (2)' }));
    const lib = screen.getByRole('region', { name: 'Source library' });
    await userEvent.click(within(lib).getByRole('checkbox', { name: 'Select source extra.csv' }));

    const nameInput = screen.getByLabelText('Pipeline name');
    await userEvent.click(nameInput);
    expect(screen.queryByRole('region', { name: 'Source library' })).not.toBeInTheDocument();
    expect(nameInput).toHaveFocus();
    expect(getSourceTabs()[0]).toHaveTextContent(/customers\.tsv/);
    expect(getStepButtonText(getStepItems()[0])).toMatch(/^1\s*Replace values/);
  });

  test('T3-4 (F7 + F3): datetime filter step plus step DnD across cast_type schema change toggles validation accurately', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_NODATE}`, {
      datasets: [makeDataset(DS_NODATE, 'nodate.csv', 'csv', NODATE_COLUMNS, NODATE_ROWS)],
    });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Columns', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Convert data type step' }));
    await userEvent.selectOptions(screen.getByLabelText('Rule 1 column'), 'raw_date');
    await userEvent.selectOptions(screen.getByLabelText('Rule 1 target type'), 'date');

    await userEvent.click(screen.getByRole('button', { name: 'Filter', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Filter rows step' }));
    await userEvent.selectOptions(screen.getByLabelText('Rule 1 column'), 'raw_date');
    await userEvent.selectOptions(screen.getByLabelText('Rule 1 comparison'), 'after');
    await userEvent.click(screen.getByLabelText('Rule 1 comparison value'));
    const dialog = screen.getByRole('dialog', { name: 'Choose date and time' });
    await userEvent.click(within(dialog).getByRole('button', { name: /(?:^|[\s-])15(?:,.*|\s*\(.*\))?$/ }));
    expect(screen.getByRole('button', { name: 'Run pipeline' })).toBeEnabled();

    dragAndDrop(getStepItems()[1], getStepItems()[0]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Run pipeline' })).toBeDisabled());

    dragAndDrop(getStepItems()[0], getStepItems()[1]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Run pipeline' })).toBeEnabled());
  });

  test('T3-5 (F7 + F6): datetime filter with Include time updates describeStep summary and multi-rule error badge', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, { datasets: [makeOrdersDataset()] });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Filter', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Filter rows step' }));
    await userEvent.selectOptions(screen.getByLabelText('Rule 1 column'), 'order_date');
    await userEvent.selectOptions(screen.getByLabelText('Rule 1 comparison'), 'after');

    await userEvent.click(screen.getByLabelText('Rule 1 comparison value'));
    const dialog = screen.getByRole('dialog', { name: 'Choose date and time' });
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Include time/i }));
    await userEvent.click(within(dialog).getByRole('button', { name: /(?:^|[\s-])15(?:,.*|\s*\(.*\))?$/ }));
    fireEvent.change(within(dialog).getByLabelText(/hour/i), { target: { value: '14' } });
    fireEvent.change(within(dialog).getByLabelText(/minute/i), { target: { value: '30' } });
    fireEvent.change(within(dialog).getByLabelText(/second/i), { target: { value: '45' } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }));

    expect(within(getStepItems()[0]).getByText(/Keep rows where order_date after "\d{4}-\d{2}-15 14:30:45"/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    await userEvent.selectOptions(screen.getByLabelText('Rule 2 column'), 'order_date');
    expect(within(getStepItems()[0]).getByLabelText(/validation error/i)).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('Rule 2 comparison value'));
    const dialog2 = screen.getByRole('dialog', { name: 'Choose date and time' });
    await userEvent.click(within(dialog2).getByRole('button', { name: 'Today' }));
    expect(within(getStepItems()[0]).queryByLabelText(/validation error/i)).not.toBeInTheDocument();
  });

  test('T3-6 (F5 + F8): source library outside dismissal preserves 1-source Combine guidance until 2nd source added', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, {
      datasets: [makeOrdersDataset(), makeCustomersDataset()],
    });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Combine', exact: true }));
    const toolbar = screen.getByRole('toolbar', { name: 'Transformations' });
    expect(within(toolbar).getByRole('button', { name: 'Add Join tables step' })).toBeDisabled();

    await userEvent.click(within(toolbar).getByRole('button', { name: /Add source/i }));
    expect(screen.getByRole('region', { name: 'Source library' })).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Pipeline name'));
    expect(screen.queryByRole('region', { name: 'Source library' })).not.toBeInTheDocument();
    expect(within(toolbar).getByRole('status')).toHaveTextContent(/at least 2 files required/i);

    await userEvent.click(within(toolbar).getByRole('button', { name: /Add source/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Add source customers.tsv' }));
    await waitFor(() => expect(within(toolbar).getByRole('button', { name: 'Add Join tables step' })).toBeEnabled());
    expect(within(toolbar).getByRole('button', { name: 'Add Append rows step' })).toBeEnabled();
  });

  test('T3-7 (F9 + F8 + F1/F2): Datasets upload -> review selector switch -> Use uploaded files -> Combine -> Run', async () => {
    const upOrders = makeOrdersDataset({ id: DS_UPLOADED_1, filename: 'up_orders.csv' });
    const upCustomers = makeCustomersDataset({ id: DS_UPLOADED_2, filename: 'up_customers.tsv' });
    const { state } = renderAt('/dashboard/datasets', {
      datasets: [],
      uploadQueue: [upOrders, upCustomers],
    });
    await screen.findByText('No datasets yet');

    const files = [
      new File(['order_id,customer_id\nORD01,CUST01\n'], 'up_orders.csv', { type: 'text/csv' }),
      new File(['customer_id\tcustomer_tier\nCUST01\tVIP\n'], 'up_customers.tsv', { type: 'text/tab-separated-values' }),
    ];
    fireEvent.change(screen.getByLabelText('Choose files'), { target: { files } });
    await userEvent.click(screen.getByRole('button', { name: 'Upload 2 files' }));

    const uploadResults = await screen.findByRole('list', { name: 'Upload results' });
    await within(uploadResults).findByRole('button', { name: 'Review data for up_customers.tsv' });

    await userEvent.click(within(uploadResults).getByRole('button', { name: 'Review data for up_orders.csv' }));
    const panel = await screen.findByRole('region', { name: /Data review:/i });
    await within(panel).findByRole('cell', { name: 'ORD01' });

    const listCallsBefore = listDatasetGetCount(state);
    await userEvent.selectOptions(within(panel).getByLabelText(/^File$/i), DS_UPLOADED_2);
    expect(await within(panel).findByRole('cell', { name: 'VIP' })).toBeInTheDocument();
    expect(listDatasetGetCount(state)).toBe(listCallsBefore);

    await userEvent.click(screen.getByRole('button', { name: 'Use uploaded files' }));
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Combine', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Join tables step' }));
    await userEvent.click(screen.getByRole('button', { name: 'Run pipeline' }));

    await waitFor(() => expect(window.location.pathname).toBe(`/dashboard/runs/${RUN_1}`));
    expect(state.submittedRuns[0].body.steps[0].type).toBe('join');
  });

  test('T3-8 (F8 + F5 + F6): toolbar Add source -> outside dismiss -> reopen -> add source -> Join -> remove -> empty-source hint', async () => {
    renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, {
      datasets: [makeOrdersDataset(), makeCustomersDataset()],
    });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Combine', exact: true }));
    const toolbar = screen.getByRole('toolbar', { name: 'Transformations' });
    await userEvent.click(within(toolbar).getByRole('button', { name: /Add source/i }));
    await userEvent.click(screen.getByRole('heading', { name: 'Source preview: orders.csv' }));
    expect(screen.queryByRole('region', { name: 'Source library' })).not.toBeInTheDocument();

    await userEvent.click(within(toolbar).getByRole('button', { name: /Add source/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Add source customers.tsv' }));
    await waitFor(() => expect(within(toolbar).getByRole('button', { name: 'Add Join tables step' })).toBeEnabled());

    await userEvent.click(within(toolbar).getByRole('button', { name: 'Add Join tables step' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove source customers.tsv' }));

    expect(within(screen.getByRole('region', { name: 'Step settings' })).getByRole('status')).toHaveTextContent(
      'Add another source file to select a file to join.',
    );
  });

  test('T3-9 (F9 + F7 + F1/F2): Datasets review selector -> navigate to Pipelines -> datetime picker + landmarks -> Run detail', async () => {
    const { state } = renderAt('/dashboard/datasets', {
      datasets: [makeOrdersDataset(), makeCustomersDataset()],
    });
    await screen.findByRole('rowheader', { name: 'orders.csv' });

    await userEvent.click(screen.getByRole('button', { name: 'Review data for orders.csv' }));
    const panel = await screen.findByRole('region', { name: /Data review:/i });
    await within(panel).findByRole('cell', { name: 'ORD01' });
    await userEvent.selectOptions(within(panel).getByLabelText(/^File$/i), DS_CUSTOMERS);
    await within(panel).findByRole('cell', { name: 'VIP' });

    await userEvent.click(screen.getByRole('checkbox', { name: 'Select orders.csv for pipeline' }));
    await userEvent.click(screen.getByRole('button', { name: 'Create pipeline' }));
    await waitForPipelineReady();

    expect(within(screen.getByRole('navigation', { name: 'Workspace' })).getByRole('link', { name: 'Pipelines' })).toHaveAttribute('aria-current', 'page');

    await userEvent.click(screen.getByRole('button', { name: 'Filter', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Filter rows step' }));
    await userEvent.selectOptions(screen.getByLabelText('Rule 1 column'), 'order_date');

    await userEvent.click(screen.getByLabelText('Rule 1 comparison value'));
    const dialog = screen.getByRole('dialog', { name: 'Choose date and time' });
    await userEvent.click(within(dialog).getByRole('button', { name: /(?:^|[\s-])15(?:,.*|\s*\(.*\))?$/ }));

    await userEvent.click(screen.getByRole('button', { name: 'Run pipeline' }));
    await waitFor(() => expect(window.location.pathname).toBe(`/dashboard/runs/${RUN_1}`));
    expect(await screen.findByRole('heading', { name: 'Pipeline steps' })).toBeInTheDocument();
    expect(state.submittedRuns[0].body.steps[0].config.conditions[0].value).toMatch(/^\d{4}-\d{2}-15$/);
  });
});

// =============================================================================
// TIER 4 — Real-World Application Scenarios (5 tests: T4-1 through T4-5)
// =============================================================================

describe('Tier 4 — Real-World Application Scenarios', () => {
  test('T4-1: Multi-source Orders + Customers pipeline creation, DnD reordering, draft persistence, save, and execution', async () => {
    const { view } = renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS}`, {
      datasets: [makeOrdersDataset(), makeCustomersDataset(), makeExtraDataset()],
    });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Combine', exact: true }));
    const toolbar = screen.getByRole('toolbar', { name: 'Transformations' });
    expect(within(toolbar).getByRole('button', { name: 'Add Join tables step' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Sources (1)' }));
    const nameInput = screen.getByLabelText('Pipeline name');
    await userEvent.click(nameInput);
    expect(screen.queryByRole('region', { name: 'Source library' })).not.toBeInTheDocument();
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Orders Showcase ETL');

    await userEvent.click(screen.getByRole('button', { name: 'Add source sheet' }));
    const lib = screen.getByRole('region', { name: 'Source library' });
    await userEvent.click(within(lib).getByRole('checkbox', { name: 'Select source customers.tsv' }));
    await userEvent.click(within(lib).getByRole('checkbox', { name: 'Select source extra.csv' }));
    await userEvent.click(within(lib).getByRole('button', { name: 'Add selected (2)' }));
    await waitFor(() => expect(getSourceTabs()).toHaveLength(3));

    dragAndDrop(getSourceTabs()[0], getSourceTabs()[2]);
    expect(within(getSourceTabs()[2]).getByLabelText('Starting dataset')).toBeInTheDocument();
    await userEvent.click(getSourceTabs()[2]);

    await userEvent.click(screen.getByRole('button', { name: 'Columns', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Select columns step' }));
    await userEvent.click(within(screen.getByRole('group', { name: 'Columns to keep' })).getByRole('button', { name: 'Clear' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'order_id' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'customer_id' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'order_date' }));

    await userEvent.click(screen.getByRole('button', { name: 'Filter', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Filter rows step' }));
    await userEvent.selectOptions(screen.getByLabelText('Rule 1 column'), 'order_date');
    await userEvent.click(screen.getByLabelText('Rule 1 comparison value'));
    const dialog = screen.getByRole('dialog', { name: 'Choose date and time' });
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Include time/i }));
    await userEvent.click(within(dialog).getByRole('button', { name: /(?:^|[\s-])15(?:,.*|\s*\(.*\))?$/ }));
    fireEvent.change(within(dialog).getByLabelText(/hour/i), { target: { value: '14' } });
    fireEvent.change(within(dialog).getByLabelText(/minute/i), { target: { value: '30' } });
    fireEvent.change(within(dialog).getByLabelText(/second/i), { target: { value: '45' } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }));

    await userEvent.click(screen.getByRole('button', { name: 'Combine', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Join tables step' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Append rows step' }));
    dragAndDrop(getAppendOrderItems()[1], getAppendOrderItems()[0]);

    dragAndDrop(getStepItems()[1], getStepItems()[0]);
    expect(getStepButtonText(getStepItems()[0])).toMatch(/^1\s*Filter rows/);
    expect(getStepButtonText(getStepItems()[1])).toMatch(/^2\s*Select columns/);

    view.unmount();

    const { state } = renderAt('/dashboard/pipelines', {
      datasets: [makeOrdersDataset(), makeCustomersDataset(), makeExtraDataset()],
    });
    await waitForPipelineReady();
    expect(screen.getByLabelText('Pipeline name')).toHaveValue('Orders Showcase ETL');
    expect(getStepButtonText(getStepItems()[0])).toMatch(/^1\s*Filter rows/);

    await userEvent.click(screen.getByRole('button', { name: 'Save pipeline' }));
    await screen.findByText(/Saved "Orders Showcase ETL"/i);
    expect(state.savedPipelines[0].body.datasetId).toBe(DS_ORDERS);

    await userEvent.click(screen.getByRole('button', { name: 'Run pipeline' }));
    await waitFor(() => expect(window.location.pathname).toBe(`/dashboard/runs/${RUN_1}`));
    expect(state.submittedRuns[0].body.steps.map((s) => s.type)).toEqual(['filter_rows', 'select_columns', 'join', 'concat']);
  });

  test('T4-2: Flawed saved pipeline recovery (invalid datetime, schema order error, unused source, saved drawer dismissal)', async () => {
    const flawedPipeline = buildSavedPipeline({
      id: PIPE_1,
      pipelineName: 'Flawed Saved Pipeline',
      datasetId: DS_ORDERS,
      sourceCount: 2,
      steps: [
        { type: 'select_columns', enabled: true, config: { selectedColumns: ['order_id', 'order_date'] } },
        { type: 'string_transform', enabled: true, config: { rules: [{ column: 'city', trim: true, caseMode: 'lower' }] } },
        { type: 'filter_rows', enabled: true, config: { conditions: [{ column: 'order_date', operator: 'after', value: '2026-02-30' }] } },
        { type: 'replace_value', enabled: true, sourceId: DS_CUSTOMERS, config: { column: 'region', oldValue: 'North', newValue: 'N' } },
      ],
    });

    const { state } = renderAt(`/dashboard/pipelines?pipeline=${PIPE_1}`, {
      datasets: [makeOrdersDataset(), makeCustomersDataset()],
      pipelines: [flawedPipeline],
    });
    await waitForPipelineReady();

    expect(screen.getByRole('button', { name: 'Run pipeline' })).toBeDisabled();
    expect(within(getStepItems()[1]).getByLabelText(/validation error/i)).toBeInTheDocument();
    expect(within(getStepItems()[2]).getByLabelText(/validation error/i)).toBeInTheDocument();

    dragAndDrop(getStepItems()[1], getStepItems()[0]);
    expect(within(getStepItems()[0]).queryByLabelText(/validation error/i)).not.toBeInTheDocument();

    await userEvent.click(within(getStepItems()[2]).getByRole('button', { name: /^3\s/ }));
    await userEvent.click(screen.getByLabelText('Rule 1 comparison value'));
    const dialog = screen.getByRole('dialog', { name: 'Choose date and time' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Today' }));

    await userEvent.click(screen.getByRole('button', { name: 'Saved' }));
    const savedPanel = await screen.findByRole('region', { name: 'Saved pipelines' });
    await within(savedPanel).findByRole('navigation', { name: 'Saved pipeline pages' });
    await userEvent.click(screen.getByLabelText('Pipeline name'));
    expect(screen.queryByRole('region', { name: 'Saved pipelines' })).not.toBeInTheDocument();

    await userEvent.click(within(getStepItems()[3]).getByRole('button', { name: /^4\s/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove step 4' }));
    expect(getStepItems()).toHaveLength(3);
    expect(screen.getByRole('heading', { name: /Configure step \d+/i })).toBeInTheDocument();

    await userEvent.click(getSourceTabs()[1]);
    await userEvent.click(screen.getByRole('button', { name: 'Remove source customers.tsv' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Run pipeline' })).toBeEnabled());

    await userEvent.click(screen.getByRole('button', { name: 'Run pipeline' }));
    await waitFor(() => expect(window.location.pathname).toBe(`/dashboard/runs/${RUN_1}`));
    expect(state.submittedRuns[0].body.steps.map((s) => s.type)).toEqual(['string_transform', 'select_columns', 'filter_rows']);
  });

  test('T4-3: Side-by-side split comparison, secondary pre-cleaning, tab Alt+Arrow reorder, concat reorder, and source removal', async () => {
    const { state } = renderAt(`/dashboard/pipelines?datasets=${DS_ORDERS},${DS_CUSTOMERS},${DS_EXTRA}`, {
      datasets: [makeOrdersDataset(), makeCustomersDataset(), makeExtraDataset()],
    });
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Compare side-by-side' }));
    await userEvent.click(getSourceTabs()[1]);
    await userEvent.click(screen.getByRole('button', { name: 'Add Clean text step' }));

    fireEvent.keyDown(getSourceTabs()[2], { key: 'ArrowLeft', altKey: true });
    expect(getSourceTabs()[1]).toHaveTextContent(/extra\.csv/);

    await userEvent.click(screen.getByRole('button', { name: 'Combine', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Append rows step' }));
    dragAndDrop(getAppendOrderItems()[1], getAppendOrderItems()[0]);
    expect(getAppendOrderItems()[0]).toHaveTextContent('1. customers.tsv');

    await userEvent.click(screen.getByRole('checkbox', { name: 'extra.csv' }));
    await userEvent.selectOptions(screen.getByLabelText('Compare dataset'), DS_EXTRA);
    await userEvent.click(screen.getByRole('button', { name: 'Remove source extra.csv' }));
    const headings = screen.getAllByRole('heading', { name: /Source preview:/i }).map((h) => h.textContent);
    expect(headings).toEqual(['Source preview: orders.csv', 'Source preview: customers.tsv']);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Run pipeline' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Run pipeline' }));
    await waitFor(() => expect(state.submittedRuns).toHaveLength(1));
    expect(state.submittedRuns[0].body.steps[0].sourceId).toBe(DS_CUSTOMERS);
    expect(state.submittedRuns[0].body.steps[1].config.datasetIds).toEqual([DS_CUSTOMERS]);
  });

  test('T4-4: Multi-file dataset upload, #dataset-review-file-select pagination reset, deduplication, and Combine pipeline handoff', async () => {
    const bigOrders = makeDataset(DS_UPLOADED_1, 'big_orders.csv', 'csv', ORDERS_COLUMNS, makeManyRows('ORD', 30, ORDERS_ROWS[0]));
    const bigCustomers = makeDataset(DS_UPLOADED_2, 'big_customers.tsv', 'tsv', CUSTOMERS_COLUMNS, makeManyRows('CUST', 30, CUSTOMERS_ROWS[0]));

    const { state } = renderAt('/dashboard/datasets', {
      datasets: [makeJsonDataset()],
      uploadQueue: [bigOrders, bigCustomers],
    });
    await screen.findByRole('rowheader', { name: 'archive.json' });

    const files = [
      new File(['order_id,customer_id\nORD01,CUST01\n'], 'big_orders.csv', { type: 'text/csv' }),
      new File(['customer_id\tcustomer_tier\nCUST01\tVIP\n'], 'big_customers.tsv', { type: 'text/tab-separated-values' }),
    ];
    fireEvent.change(screen.getByLabelText('Choose files'), { target: { files } });
    await userEvent.click(screen.getByRole('button', { name: 'Upload 2 files' }));

    const uploadResults = await screen.findByRole('list', { name: 'Upload results' });
    await within(uploadResults).findByRole('button', { name: 'Review data for big_customers.tsv' });

    await userEvent.click(within(uploadResults).getByRole('button', { name: 'Review data for big_orders.csv' }));
    const panel = await screen.findByRole('region', { name: /Data review:/i });
    await within(panel).findByRole('cell', { name: 'ORD01' });

    const fileSelect = within(panel).getByLabelText(/^File$/i);
    expect(getOptionValues(fileSelect)).toEqual([DS_UPLOADED_1, DS_UPLOADED_2]);

    await userEvent.click(within(within(panel).getByRole('navigation', { name: 'Dataset review pages' })).getByRole('button', { name: 'Next' }));
    expect(await within(panel).findByRole('cell', { name: 'ORD26' })).toBeInTheDocument();

    const listCallsBefore = listDatasetGetCount(state);
    await userEvent.selectOptions(fileSelect, DS_UPLOADED_2);
    expect(await within(panel).findByRole('cell', { name: 'CUST01' })).toBeInTheDocument();
    expect(within(panel).getByRole('navigation', { name: 'Dataset review pages' })).toHaveTextContent(/Page 1 of 2/i);
    expect(listDatasetGetCount(state)).toBe(listCallsBefore);

    await userEvent.click(screen.getByRole('button', { name: 'Use uploaded files' }));
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Combine', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Join tables step' }));
    await userEvent.click(screen.getByRole('button', { name: 'Run pipeline' }));

    await waitFor(() => expect(window.location.pathname).toBe(`/dashboard/runs/${RUN_1}`));
    expect(state.submittedRuns[0].body.datasetId).toBe(DS_UPLOADED_1);
  });

  test('T4-5: Full capability showcase walkthrough from Datasets review selector through 3-source builder, split view, datetime filter, and Run detail', async () => {
    const bigOrders = makeDataset(DS_ORDERS, 'orders.csv', 'csv', ORDERS_COLUMNS, makeManyRows('ORD', 30, ORDERS_ROWS[0]));
    const bigCustomers = makeDataset(DS_CUSTOMERS, 'customers.tsv', 'tsv', CUSTOMERS_COLUMNS, makeManyRows('CUST', 30, CUSTOMERS_ROWS[0]));

    const { state } = renderAt('/dashboard/datasets', {
      datasets: [bigOrders, bigCustomers, makeExtraDataset(), makeJsonDataset()],
    });
    await screen.findByRole('rowheader', { name: 'orders.csv' });

    expect(within(screen.getByRole('navigation', { name: 'Workspace' })).getByRole('link', { name: 'Datasets' })).toHaveAttribute('aria-current', 'page');

    const reviewTrigger = screen.getByRole('button', { name: 'Review data for orders.csv' });
    await userEvent.click(reviewTrigger);
    const panel = await screen.findByRole('region', { name: /Data review:/i });
    await within(panel).findByRole('cell', { name: 'ORD01' });

    const fileSelect = within(panel).getByLabelText(/^File$/i);
    expect(getOptionValues(fileSelect)).toEqual([DS_ORDERS, DS_CUSTOMERS, DS_EXTRA]);
    await userEvent.click(within(within(panel).getByRole('navigation', { name: 'Dataset review pages' })).getByRole('button', { name: 'Next' }));
    expect(await within(panel).findByRole('cell', { name: 'ORD26' })).toBeInTheDocument();

    const listCallsBefore = listDatasetGetCount(state);
    await userEvent.selectOptions(fileSelect, DS_CUSTOMERS);
    expect(await within(panel).findByRole('cell', { name: 'CUST01' })).toBeInTheDocument();
    expect(within(panel).getByRole('navigation', { name: 'Dataset review pages' })).toHaveTextContent(/Page 1 of 2/i);
    expect(listDatasetGetCount(state)).toBe(listCallsBefore);

    await userEvent.click(within(panel).getByRole('button', { name: 'Close review' }));
    expect(reviewTrigger).toHaveFocus();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Select orders.csv for pipeline' }));
    await userEvent.click(screen.getByRole('button', { name: 'Create pipeline' }));
    await waitForPipelineReady();

    await userEvent.click(screen.getByRole('button', { name: 'Combine', exact: true }));
    const toolbar = screen.getByRole('toolbar', { name: 'Transformations' });
    expect(within(toolbar).getByRole('button', { name: 'Add Join tables step' })).toHaveAttribute('aria-describedby', 'combine-source-requirement');

    await userEvent.click(within(toolbar).getByRole('button', { name: /Add source/i }));
    const lib = screen.getByRole('region', { name: 'Source library' });
    await userEvent.click(within(lib).getByRole('checkbox', { name: 'Select source customers.tsv' }));
    await userEvent.click(within(lib).getByRole('checkbox', { name: 'Select source extra.csv' }));
    await userEvent.click(within(lib).getByRole('button', { name: 'Add selected (2)' }));
    await waitFor(() => expect(within(toolbar).getByRole('button', { name: 'Add Join tables step' })).toBeEnabled());
    await userEvent.click(getSourceTabs()[0]);

    const splitBtn = screen.getByRole('button', { name: 'Compare side-by-side' });
    await userEvent.click(splitBtn);
    expect(splitBtn).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'Filter', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Filter rows step' }));
    await userEvent.selectOptions(screen.getByLabelText('Rule 1 column'), 'order_date');
    await userEvent.click(screen.getByLabelText('Rule 1 comparison value'));
    const dialog = screen.getByRole('dialog', { name: 'Choose date and time' });
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Include time/i }));
    await userEvent.click(within(dialog).getByRole('button', { name: /(?:^|[\s-])15(?:,.*|\s*\(.*\))?$/ }));
    fireEvent.change(within(dialog).getByLabelText(/hour/i), { target: { value: '14' } });
    fireEvent.change(within(dialog).getByLabelText(/minute/i), { target: { value: '30' } });
    fireEvent.change(within(dialog).getByLabelText(/second/i), { target: { value: '45' } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }));

    await userEvent.click(screen.getByRole('button', { name: 'Combine', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Join tables step' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Append rows step' }));
    dragAndDrop(getStepItems()[2], getStepItems()[1]);

    await userEvent.click(screen.getByRole('button', { name: 'Save pipeline' }));
    await screen.findByText(/Saved "/i);
    await userEvent.click(screen.getByRole('button', { name: 'Run pipeline' }));

    await waitFor(() => expect(window.location.pathname).toBe(`/dashboard/runs/${RUN_1}`));
    expect(await screen.findByRole('heading', { name: 'Pipeline steps' })).toBeInTheDocument();
    expect(state.submittedRuns[0].body.steps.map((s) => s.type)).toEqual(['filter_rows', 'concat', 'join']);
  });
});
