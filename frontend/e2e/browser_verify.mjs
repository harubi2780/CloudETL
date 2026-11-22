#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_CHROME_PATH = process.env.CHROME_PATH
  || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const DEFAULT_VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1280x800', width: 1280, height: 800 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '900x700', width: 900, height: 700 },
  { name: '1280x680', width: 1280, height: 680 },
];

const ALL_VIEWS = [
  'datasets_review',
  'pipelines_1_source',
  'pipelines_source_library',
  'pipelines_2_sources_dt_popup',
  'pipelines_compare_split',
  'runs',
  'account',
];

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function resolveDefaultPath(candidates) {
  for (const candidate of candidates) {
    const resolved = path.resolve(process.cwd(), candidate);
    if (fs.existsSync(resolved)) {
      return resolved;
    }
  }
  return path.resolve(process.cwd(), candidates[0]);
}

function parseArgs(argv) {
  const options = {
    outDir: '',
    buildDir: '',
    chromePath: DEFAULT_CHROME_PATH,
    strictContrast: false,
    allowBaseline: false,
    views: [...ALL_VIEWS],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out-dir') {
      options.outDir = path.resolve(process.cwd(), argv[++i] || '');
    } else if (arg.startsWith('--out-dir=')) {
      options.outDir = path.resolve(process.cwd(), arg.slice('--out-dir='.length));
    } else if (arg === '--build-dir') {
      options.buildDir = path.resolve(process.cwd(), argv[++i] || '');
    } else if (arg.startsWith('--build-dir=')) {
      options.buildDir = path.resolve(process.cwd(), arg.slice('--build-dir='.length));
    } else if (arg === '--chrome-path') {
      options.chromePath = argv[++i] || '';
    } else if (arg.startsWith('--chrome-path=')) {
      options.chromePath = arg.slice('--chrome-path='.length);
    } else if (arg === '--strict-contrast') {
      options.strictContrast = true;
    } else if (arg === '--allow-baseline') {
      options.allowBaseline = true;
    } else if (arg === '--views') {
      const raw = argv[++i] || '';
      options.views = raw.split(',').map((s) => s.trim()).filter(Boolean);
    } else if (arg.startsWith('--views=')) {
      const raw = arg.slice('--views='.length);
      options.views = raw.split(',').map((s) => s.trim()).filter(Boolean);
    } else if (arg === '--help' || arg === '-h') {
      console.log([
        'Usage: node frontend/e2e/browser_verify.mjs [options]',
        '',
        'Options:',
        '  --out-dir <path>       Directory for screenshots and report.json (default: frontend/e2e/artifacts)',
        '  --build-dir <path>     Path to CRA production build (default: frontend/build)',
        '  --chrome-path <path>   Path to Chrome executable (default: CHROME_PATH or standard Windows path)',
        '  --strict-contrast      Fail with non-zero exit code on WCAG AA contrast violations',
        '  --allow-baseline       Allow pre-M1/M2 builds lacking new selectors (reports presence without failing)',
        '  --views <csv>          Comma-separated subset of views to run',
      ].join('\n'));
      process.exit(0);
    } else {
      throw new Error(`Unknown CLI argument: ${arg}`);
    }
  }

  if (!options.buildDir) {
    options.buildDir = resolveDefaultPath(['frontend/build', 'build']);
  }
  if (!options.outDir) {
    const inFrontend = !fs.existsSync(path.resolve(process.cwd(), 'frontend/build'))
      && fs.existsSync(path.resolve(process.cwd(), 'build'));
    options.outDir = path.resolve(process.cwd(), inFrontend ? 'e2e/artifacts' : 'frontend/e2e/artifacts');
  }

  const invalidViews = options.views.filter((v) => !ALL_VIEWS.includes(v));
  if (invalidViews.length > 0 || options.views.length === 0) {
    throw new Error(`Invalid --views selection (${invalidViews.join(', ')}). Valid views: ${ALL_VIEWS.join(', ')}`);
  }

  return options;
}

function createMockFixtures() {
  const ds1Id = '10000000-0000-0000-0000-000000000001';
  const ds2Id = '10000000-0000-0000-0000-000000000002';
  const ds3Id = '10000000-0000-0000-0000-000000000003';

  const datasets = [
    {
      id: ds1Id,
      filename: 'orders.csv',
      format: 'csv',
      size_bytes: 18432,
      uploaded_at: '2026-11-20T10:00:00Z',
    },
    {
      id: ds2Id,
      filename: 'customers.tsv',
      format: 'tsv',
      size_bytes: 12288,
      uploaded_at: '2026-11-20T10:05:00Z',
    },
    {
      id: ds3Id,
      filename: 'events.csv',
      format: 'csv',
      size_bytes: 24576,
      uploaded_at: '2026-11-20T10:10:00Z',
    },
  ];

  const datasetSchemas = {
    [ds1Id]: {
      columns: [
        { name: 'order_id', type: 'integer' },
        { name: 'customer_id', type: 'integer' },
        { name: 'order_date', type: 'datetime' },
        { name: 'region', type: 'string' },
        { name: 'total_amount', type: 'float' },
        { name: 'is_priority', type: 'boolean' },
      ],
      totalRows: 42,
      makeRow: (idx) => ({
        order_id: 1001 + idx,
        customer_id: 500 + (idx % 12),
        order_date: `2026-11-${String((idx % 28) + 1).padStart(2, '0')} 09:${String((idx * 7) % 60).padStart(2, '0')}:00`,
        region: ['North', 'South', 'East', 'West'][idx % 4],
        total_amount: Number((49.5 + idx * 13.25).toFixed(2)),
        is_priority: idx % 3 === 0,
      }),
    },
    [ds2Id]: {
      columns: [
        { name: 'customer_id', type: 'integer' },
        { name: 'customer_name', type: 'string' },
        { name: 'segment', type: 'string' },
        { name: 'signup_date', type: 'datetime' },
        { name: 'active', type: 'boolean' },
      ],
      totalRows: 30,
      makeRow: (idx) => ({
        customer_id: 500 + idx,
        customer_name: `Customer ${idx + 1}`,
        segment: ['Enterprise', 'Growth', 'Starter'][idx % 3],
        signup_date: `2026-0${(idx % 9) + 1}-${String((idx % 27) + 1).padStart(2, '0')}`,
        active: idx % 4 !== 0,
      }),
    },
    [ds3Id]: {
      columns: [
        { name: 'event_id', type: 'integer' },
        { name: 'customer_id', type: 'integer' },
        { name: 'event_date', type: 'datetime' },
        { name: 'event_type', type: 'string' },
      ],
      totalRows: 28,
      makeRow: (idx) => ({
        event_id: 9001 + idx,
        customer_id: 500 + (idx % 10),
        event_date: `2026-10-${String((idx % 28) + 1).padStart(2, '0')} 14:15:00`,
        event_type: ['checkout', 'export', 'login'][idx % 3],
      }),
    },
  };

  const capabilities = {
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
          value: 'scalar',
        }],
        operatorsByType: {
          integer: ['equals', 'not_equals', 'greater_than', 'less_than', 'greater_or_equal', 'less_or_equal'],
          float: ['equals', 'not_equals', 'greater_than', 'less_than', 'greater_or_equal', 'less_or_equal'],
          string: ['equals', 'contains', 'starts_with', 'ends_with'],
          datetime: ['after', 'before', 'equals'],
          boolean: ['is_true', 'is_false'],
        },
      },
      merge_columns: { columns: 'column list (at least 2)', newColumnName: 'column', separator: 'string' },
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

  const savedPipelines = [
    {
      id: '30000000-0000-0000-0000-000000000001',
      name: 'Monthly Order Cleanup',
      dataset_id: ds1Id,
      step_count: 2,
      source_count: 2,
      created_at: '2026-11-20T12:00:00Z',
      updated_at: '2026-11-21T08:45:00Z',
      configuration: {
        schemaVersion: 1,
        name: 'Monthly Order Cleanup',
        datasetId: ds1Id,
        steps: [
          {
            type: 'filter_rows',
            enabled: true,
            config: {
              conditions: [{ column: 'order_date', operator: 'after', value: '2026-11-01' }],
            },
          },
          {
            type: 'join',
            enabled: true,
            config: { datasetId: ds2Id, on: 'customer_id', how: 'left' },
          },
        ],
      },
    },
  ];

  const runs = [
    {
      id: '20000000-0000-0000-0000-000000000001',
      name: 'Monthly Order Cleanup',
      status: 'succeeded',
      created_at: '2026-11-21T09:00:00Z',
      started_at: '2026-11-21T09:00:02Z',
      finished_at: '2026-11-21T09:00:08Z',
      summary: { final_rows: 42, column_count: 6 },
      error: null,
      result_available: true,
      download_url: '/api/etl/runs/20000000-0000-0000-0000-000000000001/download/',
      configuration: savedPipelines[0].configuration,
      sources_meta: [
        { dataset_id: ds1Id, filename: 'orders.csv' },
        { dataset_id: ds2Id, filename: 'customers.tsv' },
      ],
    },
    {
      id: '20000000-0000-0000-0000-000000000002',
      name: 'Customer Deduplication',
      status: 'failed',
      created_at: '2026-11-21T08:30:00Z',
      started_at: '2026-11-21T08:30:01Z',
      finished_at: '2026-11-21T08:30:04Z',
      summary: null,
      error: { code: 'invalid_column', message: "Column 'legacy_id' was not found." },
      result_available: false,
      download_url: null,
      configuration: {
        schemaVersion: 1,
        name: 'Customer Deduplication',
        datasetId: ds2Id,
        steps: [],
      },
      sources_meta: [{ dataset_id: ds2Id, filename: 'customers.tsv' }],
    },
  ];

  const storage = {
    limit_bytes: 524288000,
    used_bytes: 55296,
    uploaded_bytes: 55296,
    result_bytes: 0,
    pending_cleanup_bytes: 0,
    reserved_bytes: 0,
    available_bytes: 524232704,
    over_limit: false,
  };

  const account = {
    id: 1,
    username: 'showcase',
    email: 'showcase@cloudetl.test',
    status: 'active',
    joined_at: '2026-10-01T08:00:00Z',
    plan: { code: 'free', name: 'Free' },
    storage,
  };

  const billing = {
    demo_enabled: true,
    plans: [
      { code: 'free', name: 'Free', storage_limit_bytes: 524288000, amount_vnd: 0, period_days: null },
      { code: 'premium', name: 'Premium', storage_limit_bytes: 2147483648, amount_vnd: 59000, period_days: 30 },
    ],
    subscription: { status: 'free', current_period_end: null },
    orders: [
      {
        id: '40000000-0000-0000-0000-000000000001',
        plan_code: 'premium',
        plan_name: 'Premium',
        amount_vnd: 59000,
        currency: 'VND',
        period_days: 30,
        status: 'pending',
        created_at: '2026-11-21T10:00:00Z',
        expires_at: '2026-11-21T10:15:00Z',
        completed_at: null,
      },
    ],
  };

  return {
    datasets,
    datasetSchemas,
    capabilities,
    savedPipelines,
    runs,
    storage,
    account,
    billing,
  };
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

function paginateRows(schema, page, pageSize) {
  const safeSize = Math.max(1, Math.min(100, Number(pageSize) || 25));
  const totalCount = schema.totalRows;
  const totalPages = Math.max(1, Math.ceil(totalCount / safeSize));
  const safePage = Math.max(1, Math.min(totalPages, Number(page) || 1));
  const start = (safePage - 1) * safeSize;
  const end = Math.min(totalCount, start + safeSize);
  const rows = [];
  for (let i = start; i < end; i += 1) {
    rows.push(schema.makeRow(i));
  }
  return {
    columns: schema.columns,
    rows,
    page: safePage,
    page_size: safeSize,
    total_count: totalCount,
    total_pages: totalPages,
  };
}

async function startMockServer(buildDir) {
  const resolvedBuildDir = path.resolve(buildDir);
  const indexHtmlPath = path.join(resolvedBuildDir, 'index.html');
  if (!fs.existsSync(indexHtmlPath)) {
    throw new Error(`CRA build index.html not found at ${indexHtmlPath}. Run "npm run build" in frontend/ first.`);
  }

  const fixtures = createMockFixtures();

  const server = http.createServer(async (req, res) => {
    try {
      const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
      const pathname = decodeURIComponent(reqUrl.pathname);
      const method = (req.method || 'GET').toUpperCase();

      if (pathname.startsWith('/api/')) {
        if (pathname === '/api/auth/csrf/' && method === 'GET') {
          return sendJson(res, 200, { csrfToken: 'mock-csrf-token' });
        }
        if (pathname === '/api/auth/me/' && method === 'GET') {
          return sendJson(res, 200, { user: { id: 1, username: 'showcase', email: 'showcase@cloudetl.test' } });
        }
        if (pathname === '/api/auth/logout/' && method === 'POST') {
          return sendJson(res, 200, { user: null, csrfToken: 'mock-csrf-token' });
        }
        if ((pathname === '/api/auth/login/' || pathname === '/api/auth/register/') && method === 'POST') {
          return sendJson(res, 200, {
            user: { id: 1, username: 'showcase', email: 'showcase@cloudetl.test' },
            csrfToken: 'mock-csrf-token',
          });
        }
        if (pathname === '/api/datasets/' && method === 'GET') {
          return sendJson(res, 200, {
            datasets: fixtures.datasets,
            page: 1,
            total_pages: 1,
            total_count: fixtures.datasets.length,
            limits: { max_file_size_bytes: 26214400, extensions: ['csv', 'tsv'] },
            storage: fixtures.storage,
          });
        }
        if (pathname === '/api/etl/capabilities/' && method === 'GET') {
          return sendJson(res, 200, fixtures.capabilities);
        }

        const dsMatch = pathname.match(/^\/api\/etl\/datasets\/([^/]+)\/$/);
        if (dsMatch && method === 'GET') {
          const ds = fixtures.datasets.find((d) => d.id === dsMatch[1]);
          if (!ds) return sendJson(res, 404, { error: { message: 'Dataset not found.' } });
          return sendJson(res, 200, { dataset: ds });
        }

        const previewMatch = pathname.match(/^\/api\/etl\/datasets\/([^/]+)\/preview\/$/);
        if (previewMatch && method === 'GET') {
          const schema = fixtures.datasetSchemas[previewMatch[1]];
          if (!schema) return sendJson(res, 404, { error: { message: 'Dataset not found.' } });
          const previewRows = [];
          for (let i = 0; i < Math.min(10, schema.totalRows); i += 1) {
            previewRows.push(schema.makeRow(i));
          }
          return sendJson(res, 200, {
            preview: {
              columns: schema.columns,
              rows: previewRows,
              final_rows: schema.totalRows,
            },
          });
        }

        const dsRowsMatch = pathname.match(/^\/api\/etl\/datasets\/([^/]+)\/rows\/$/);
        if (dsRowsMatch && method === 'GET') {
          const schema = fixtures.datasetSchemas[dsRowsMatch[1]];
          if (!schema) return sendJson(res, 404, { error: { message: 'Dataset not found.' } });
          return sendJson(
            res,
            200,
            paginateRows(schema, reqUrl.searchParams.get('page'), reqUrl.searchParams.get('page_size')),
          );
        }

        if (pathname === '/api/etl/pipelines/' && method === 'GET') {
          return sendJson(res, 200, {
            pipelines: fixtures.savedPipelines.map(({ configuration, ...summary }) => summary),
            page: 1,
            total_pages: 1,
            total_count: fixtures.savedPipelines.length,
          });
        }

        if (pathname === '/api/etl/pipelines/' && method === 'POST') {
          const body = await readJsonBody(req);
          const id = `30000000-0000-0000-0000-${String(fixtures.savedPipelines.length + 1).padStart(12, '0')}`;
          const now = new Date().toISOString();
          const created = {
            id,
            name: body.name || 'Saved pipeline',
            dataset_id: body.datasetId || fixtures.datasets[0].id,
            step_count: Array.isArray(body.steps) ? body.steps.length : 0,
            source_count: 1,
            created_at: now,
            updated_at: now,
            configuration: body,
          };
          fixtures.savedPipelines.push(created);
          return sendJson(res, 201, { pipeline: created });
        }

        const pipelineMatch = pathname.match(/^\/api\/etl\/pipelines\/([^/]+)\/$/);
        if (pipelineMatch) {
          const idx = fixtures.savedPipelines.findIndex((p) => p.id === pipelineMatch[1]);
          if (idx === -1) return sendJson(res, 404, { error: { message: 'Pipeline not found.' } });
          if (method === 'GET') {
            return sendJson(res, 200, { pipeline: fixtures.savedPipelines[idx] });
          }
          if (method === 'PUT') {
            const body = await readJsonBody(req);
            const updated = {
              ...fixtures.savedPipelines[idx],
              name: body.name || fixtures.savedPipelines[idx].name,
              step_count: Array.isArray(body.steps) ? body.steps.length : 0,
              updated_at: new Date().toISOString(),
              configuration: body,
            };
            fixtures.savedPipelines[idx] = updated;
            return sendJson(res, 200, { pipeline: updated });
          }
          if (method === 'DELETE') {
            fixtures.savedPipelines.splice(idx, 1);
            return sendJson(res, 200, { deleted: true });
          }
        }

        if (pathname === '/api/etl/runs/' && method === 'GET') {
          const statusFilter = reqUrl.searchParams.get('status') || '';
          const filtered = statusFilter
            ? fixtures.runs.filter((r) => r.status === statusFilter)
            : fixtures.runs;
          return sendJson(res, 200, {
            runs: filtered.map(({ configuration, sources_meta, ...summary }) => summary),
            page: 1,
            total_pages: 1,
            total_count: filtered.length,
          });
        }

        if (pathname === '/api/etl/runs/' && method === 'POST') {
          const body = await readJsonBody(req);
          const id = `20000000-0000-0000-0000-${String(fixtures.runs.length + 1).padStart(12, '0')}`;
          const now = new Date().toISOString();
          const newRun = {
            id,
            name: body.name || 'Ad-hoc run',
            status: 'succeeded',
            created_at: now,
            started_at: now,
            finished_at: now,
            summary: { final_rows: 42, column_count: 6 },
            error: null,
            result_available: true,
            download_url: `/api/etl/runs/${id}/download/`,
            configuration: body,
            sources_meta: [{ dataset_id: body.datasetId || fixtures.datasets[0].id, filename: 'orders.csv' }],
          };
          fixtures.runs.unshift(newRun);
          return sendJson(res, 201, { run: newRun });
        }

        const runMatch = pathname.match(/^\/api\/etl\/runs\/([^/]+)\/$/);
        if (runMatch && method === 'GET') {
          const run = fixtures.runs.find((r) => r.id === runMatch[1]);
          if (!run) return sendJson(res, 404, { error: { message: 'Run not found.' } });
          return sendJson(res, 200, { run });
        }

        const runRowsMatch = pathname.match(/^\/api\/etl\/runs\/([^/]+)\/rows\/$/);
        if (runRowsMatch && method === 'GET') {
          const run = fixtures.runs.find((r) => r.id === runRowsMatch[1]);
          if (!run) return sendJson(res, 404, { error: { message: 'Run not found.' } });
          const schema = fixtures.datasetSchemas[fixtures.datasets[0].id];
          return sendJson(
            res,
            200,
            paginateRows(schema, reqUrl.searchParams.get('page'), reqUrl.searchParams.get('page_size')),
          );
        }

        const runSourceRowsMatch = pathname.match(/^\/api\/etl\/runs\/([^/]+)\/source-rows\/$/);
        if (runSourceRowsMatch && method === 'GET') {
          const run = fixtures.runs.find((r) => r.id === runSourceRowsMatch[1]);
          if (!run) return sendJson(res, 404, { error: { message: 'Run not found.' } });
          const datasetId = reqUrl.searchParams.get('dataset_id') || fixtures.datasets[0].id;
          const ds = fixtures.datasets.find((d) => d.id === datasetId) || fixtures.datasets[0];
          const schema = fixtures.datasetSchemas[ds.id];
          return sendJson(res, 200, {
            dataset_id: ds.id,
            filename: ds.filename,
            ...paginateRows(schema, reqUrl.searchParams.get('page'), reqUrl.searchParams.get('page_size')),
            matches_snapshot: true,
          });
        }

        if (pathname === '/api/account/' && method === 'GET') {
          return sendJson(res, 200, { account: fixtures.account });
        }

        if (pathname === '/api/billing/' && method === 'GET') {
          return sendJson(res, 200, fixtures.billing);
        }

        return sendJson(res, 404, { error: { message: `Unhandled mock API route: ${method} ${pathname}` } });
      }

      const relPath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const candidatePath = path.resolve(resolvedBuildDir, relPath);
      const isSafePath = candidatePath === resolvedBuildDir || candidatePath.startsWith(`${resolvedBuildDir}${path.sep}`);
      if (!isSafePath) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      let targetFile = candidatePath;
      if (!fs.existsSync(targetFile) || fs.statSync(targetFile).isDirectory()) {
        if (path.extname(pathname)) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        targetFile = indexHtmlPath;
      }

      const ext = path.extname(targetFile).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const data = fs.readFileSync(targetFile);
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: { message: error.message } }));
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.consoleErrors = [];
    this.readyPromise = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', (event) => {
        reject(new Error(`CDP WebSocket error: ${event.message || 'connection failed'}`));
      }, { once: true });
    });

    this.ws.addEventListener('message', (event) => {
      let msg;
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (msg.id !== undefined) {
        const entry = this.pending.get(msg.id);
        if (!entry) return;
        this.pending.delete(msg.id);
        clearTimeout(entry.timer);
        if (msg.error) {
          entry.reject(new Error(`CDP ${entry.method} failed: ${msg.error.message}`));
        } else {
          entry.resolve(msg.result || {});
        }
      } else if (msg.method === 'Page.javascriptDialogOpening') {
        this.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
      } else if (msg.method === 'Runtime.exceptionThrown') {
        const details = msg.params?.exceptionDetails;
        const text = details?.exception?.description || details?.text || 'Uncaught page exception';
        this.consoleErrors.push(text);
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
        const args = (msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
        if (args) this.consoleErrors.push(args);
      }
    });

    this.ws.addEventListener('close', () => {
      for (const [id, entry] of this.pending.entries()) {
        clearTimeout(entry.timer);
        entry.reject(new Error(`CDP WebSocket closed before ${entry.method} completed`));
        this.pending.delete(id);
      }
    });
  }

  async init() {
    await this.readyPromise;
    await this.send('Page.enable');
    await this.send('Runtime.enable');
  }

  send(method, params = {}, timeoutMs = 20000) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out (${timeoutMs}ms): ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async setViewport(width, height) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
  }

  async evaluate(fn, ...args) {
    const serializedArgs = args.map((arg) => JSON.stringify(arg)).join(', ');
    const expression = `(${fn.toString()})(${serializedArgs})`;
    const response = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.exceptionDetails) {
      const msg = response.exceptionDetails.exception?.description || response.exceptionDetails.text || 'Evaluation error';
      throw new Error(msg);
    }
    return response.result?.value;
  }

  async waitFor(predicateFn, args = [], timeoutMs = 10000, label = 'condition') {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const matched = await this.evaluate(predicateFn, ...args);
      if (matched) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`Timed out after ${timeoutMs}ms waiting for ${label}`);
  }

  async settleLayout() {
    await this.evaluate(() => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
  }

  async navigateAndWait(url, predicateFn, args = [], label = url, timeoutMs = 12000) {
    this.consoleErrors = [];
    await this.send('Page.navigate', { url });
    await this.waitFor(predicateFn, args, timeoutMs, label);
    await this.settleLayout();
  }

  async clickCenter(selector) {
    const coords = await this.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, selector);
    if (!coords) {
      throw new Error(`Cannot click missing element: ${selector}`);
    }
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: coords.x,
      y: coords.y,
    });
    await this.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: coords.x,
      y: coords.y,
      button: 'left',
      clickCount: 1,
    });
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: coords.x,
      y: coords.y,
      button: 'left',
      clickCount: 1,
    });
  }

  async capturePng(filePath) {
    const result = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(filePath, Buffer.from(result.data, 'base64'));
  }

  close() {
    try {
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
    } catch {
      // Ignore close errors during teardown.
    }
  }
}

async function launchChrome(chromePath) {
  if (!fs.existsSync(chromePath)) {
    throw new Error(`Chrome executable not found at: ${chromePath}`);
  }
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudetl-verify-'));
  const args = [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--window-size=1440,900',
    'about:blank',
  ];

  const proc = spawn(chromePath, args, { stdio: ['ignore', 'ignore', 'pipe'] });

  const devToolsUrl = await new Promise((resolve, reject) => {
    let stderrBuf = '';
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for Chrome DevTools listening URL. stderr:\n${stderrBuf}`));
    }, 15000);

    const onExit = (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`Chrome exited prematurely (code=${code}, signal=${signal}). stderr:\n${stderrBuf}`));
    };

    proc.once('exit', onExit);
    proc.stderr.on('data', (chunk) => {
      stderrBuf += chunk.toString('utf8');
      const match = stderrBuf.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        proc.removeListener('exit', onExit);
        resolve(match[1]);
      }
    });
  });

  const parsed = new URL(devToolsUrl);
  const jsonListUrl = `http://${parsed.host}/json/list`;
  let pageTarget = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const res = await fetch(jsonListUrl);
    const targets = await res.json();
    pageTarget = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (pageTarget) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!pageTarget) {
    throw new Error(`No inspectable page target found at ${jsonListUrl}`);
  }

  const cdp = new CdpClient(pageTarget.webSocketDebuggerUrl);
  await cdp.init();

  const cleanupChrome = async () => {
    try {
      await Promise.race([
        cdp.send('Browser.close').catch(() => {}),
        new Promise((r) => setTimeout(r, 400)),
      ]);
    } catch {
      // Ignore best-effort close errors.
    }
    cdp.close();

    if (proc.exitCode === null && proc.signalCode === null) {
      try {
        proc.kill('SIGKILL');
      } catch {
        // Ignore kill error if already exited.
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    if (process.platform === 'win32' && proc.exitCode === null && proc.signalCode === null && proc.pid) {
      try {
        execFileSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
      } catch {
        // Process may already be gone.
      }
    }

    fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  };

  return { cdp, proc, userDataDir, cleanupChrome };
}

function auditPageLayoutAndContrastInBrowser() {
  const describeEl = (el) => {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : '';
    const aria = el.getAttribute('aria-label');
    const cls = typeof el.className === 'string' && el.className.trim()
      ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}`
      : '';
    const txt = (el.textContent || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 32);
    return `${tag}${id}${cls}${aria ? `[aria-label="${aria}"]` : txt ? `("${txt}")` : ''}`;
  };

  const isHiddenByStyle = (el) => {
    if (el.classList.contains('skip-link') && document.activeElement !== el) return true;
    let curr = el;
    while (curr && curr.nodeType === 1) {
      const cs = getComputedStyle(curr);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return true;
      if (curr.classList.contains('sr-only')) return true;
      if (cs.clip === 'rect(0px, 0px, 0px, 0px)' || cs.clipPath === 'inset(50%)') return true;
      if (curr.tagName === 'DETAILS' && !curr.hasAttribute('open')) {
        if (el !== curr.querySelector('summary') && !curr.querySelector('summary')?.contains(el)) {
          return true;
        }
      }
      curr = curr.parentElement;
    }
    const rect = el.getBoundingClientRect();
    return rect.width < 2 || rect.height < 2;
  };

  const scrollWidth = document.documentElement.scrollWidth;
  const innerWidth = window.innerWidth;
  const innerHeight = window.innerHeight;
  const horizontalOverflow = scrollWidth > innerWidth;

  const isWorkbookShell = Boolean(document.querySelector('.dashboard-body-workbook'));
  const controls = Array.from(document.querySelectorAll(
    'button, a[href], input, select, textarea, summary, [role="button"], [role="tab"]',
  )).filter((el) => !isHiddenByStyle(el));

  const clippedControls = [];

  for (const el of controls) {
    const rect = el.getBoundingClientRect();
    let scrollableX = false;
    let scrollableY = false;
    let anc = el.parentElement;
    while (anc && anc !== document.documentElement) {
      const acs = getComputedStyle(anc);
      if (['auto', 'scroll'].includes(acs.overflowX) && anc.scrollWidth > anc.clientWidth + 1) {
        scrollableX = true;
      }
      if (['auto', 'scroll'].includes(acs.overflowY) && anc.scrollHeight > anc.clientHeight + 1) {
        scrollableY = true;
      }
      anc = anc.parentElement;
    }

    if (!scrollableX && (rect.left < -1 || rect.right > innerWidth + 1)) {
      clippedControls.push({
        control: describeEl(el),
        reason: 'viewport-x',
        rect: { left: Math.round(rect.left), right: Math.round(rect.right), innerWidth },
      });
      continue;
    }

    if (isWorkbookShell && !scrollableY && (rect.top < -1 || rect.bottom > innerHeight + 1)) {
      clippedControls.push({
        control: describeEl(el),
        reason: 'workbook-viewport-y',
        rect: { top: Math.round(rect.top), bottom: Math.round(rect.bottom), innerHeight },
      });
      continue;
    }

    // Check clipping against overflow: hidden/clip ancestors unless an intermediate scroll container exists.
    let curr = el.parentElement;
    let sawScrollX = false;
    let sawScrollY = false;
    while (curr && curr !== document.documentElement && curr !== document.body) {
      const ccs = getComputedStyle(curr);
      if (['auto', 'scroll'].includes(ccs.overflowX) && curr.scrollWidth > curr.clientWidth + 1) {
        sawScrollX = true;
      }
      if (['auto', 'scroll'].includes(ccs.overflowY) && curr.scrollHeight > curr.clientHeight + 1) {
        sawScrollY = true;
      }
      const hiddenX = ['hidden', 'clip'].includes(ccs.overflowX);
      const hiddenY = ['hidden', 'clip'].includes(ccs.overflowY);
      if ((hiddenX && !sawScrollX) || (hiddenY && !sawScrollY)) {
        const aRect = curr.getBoundingClientRect();
        if (hiddenX && !sawScrollX && (rect.left < aRect.left - 1.5 || rect.right > aRect.right + 1.5)) {
          clippedControls.push({
            control: describeEl(el),
            reason: `ancestor-clip-x:${describeEl(curr)}`,
            rect: { left: Math.round(rect.left), right: Math.round(rect.right) },
            ancestorRect: { left: Math.round(aRect.left), right: Math.round(aRect.right) },
          });
          break;
        }
        if (hiddenY && !sawScrollY && (rect.top < aRect.top - 1.5 || rect.bottom > aRect.bottom + 1.5)) {
          clippedControls.push({
            control: describeEl(el),
            reason: `ancestor-clip-y:${describeEl(curr)}`,
            rect: { top: Math.round(rect.top), bottom: Math.round(rect.bottom) },
            ancestorRect: { top: Math.round(aRect.top), bottom: Math.round(aRect.bottom) },
          });
          break;
        }
      }
      curr = curr.parentElement;
    }
  }

  const getOverlayRoot = (el) => el.closest('.dt-picker-popover, [role="dialog"], #source-library, #saved-pipelines');

  const getVisibleRect = (el) => {
    const r = el.getBoundingClientRect();
    let left = r.left;
    let top = r.top;
    let right = r.right;
    let bottom = r.bottom;
    let curr = el.parentElement;
    while (curr && curr !== document.documentElement && curr !== document.body) {
      const cs = getComputedStyle(curr);
      if (['hidden', 'clip', 'auto', 'scroll'].includes(cs.overflowX)) {
        const ar = curr.getBoundingClientRect();
        left = Math.max(left, ar.left);
        right = Math.min(right, ar.right);
      }
      if (['hidden', 'clip', 'auto', 'scroll'].includes(cs.overflowY)) {
        const ar = curr.getBoundingClientRect();
        top = Math.max(top, ar.top);
        bottom = Math.min(bottom, ar.bottom);
      }
      curr = curr.parentElement;
    }
    return {
      left,
      top,
      right,
      bottom,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
    };
  };

  const overlappingControls = [];
  const controlRects = controls
    .map((el) => ({
      el,
      rect: getVisibleRect(el),
      overlay: getOverlayRoot(el),
    }))
    .filter((item) => item.rect.width > 2 && item.rect.height > 2);

  for (let i = 0; i < controlRects.length; i += 1) {
    const a = controlRects[i];
    for (let j = i + 1; j < controlRects.length; j += 1) {
      const b = controlRects[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      if (a.overlay !== b.overlay) continue;
      const aLabel = a.el.closest('label');
      const bLabel = b.el.closest('label');
      if ((aLabel && aLabel === bLabel) || (aLabel && aLabel.contains(b.el)) || (bLabel && bLabel.contains(a.el))) continue;
      const ix = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
      const iy = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
      if (ix > 2 && iy > 2) {
        overlappingControls.push({
          a: describeEl(a.el),
          b: describeEl(b.el),
          intersection: { width: Math.round(ix), height: Math.round(iy) },
        });
      }
    }
  }

  const parseRgba = (str) => {
    const match = str && str.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i);
    if (!match) return { r: 0, g: 0, b: 0, a: 0 };
    return {
      r: Number(match[1]),
      g: Number(match[2]),
      b: Number(match[3]),
      a: match[4] === undefined ? 1 : Number(match[4]),
    };
  };

  const compositeOver = (fg, bg, alphaScale = 1) => {
    const a = Math.max(0, Math.min(1, fg.a * alphaScale));
    return {
      r: fg.r * a + bg.r * (1 - a),
      g: fg.g * a + bg.g * (1 - a),
      b: fg.b * a + bg.b * (1 - a),
      a: 1,
    };
  };

  const luminance = (rgb) => {
    const channel = (v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
  };

  const contrastRatio = (c1, c2) => {
    const l1 = luminance(c1);
    const l2 = luminance(c2);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };

  const rgbString = (c) => `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`;

  const contrastFailures = [];
  let checkedCount = 0;
  let disabledAdvisoryCount = 0;

  const allElements = Array.from(document.body.querySelectorAll('*'));
  for (const el of allElements) {
    const hasDirectText = Array.from(el.childNodes).some(
      (n) => n.nodeType === 3 && n.textContent.trim().length > 0,
    );
    const isFormText = ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
      && (el.type !== 'checkbox' && el.type !== 'radio' && el.type !== 'file');
    if (!hasDirectText && !isFormText) continue;
    if (isHiddenByStyle(el)) continue;

    const isDisabled = el.matches(':disabled') || Boolean(el.closest('fieldset:disabled'));

    const chain = [];
    let curr = el;
    while (curr && curr.nodeType === 1) {
      chain.push(curr);
      curr = curr.parentElement;
    }
    chain.reverse();

    let bg = { r: 255, g: 255, b: 255, a: 1 };
    let cumulativeOpacity = 1;
    for (const node of chain) {
      const ncs = getComputedStyle(node);
      const nodeOpacity = Number(ncs.opacity);
      cumulativeOpacity *= Number.isFinite(nodeOpacity) ? nodeOpacity : 1;
      const nodeBg = parseRgba(ncs.backgroundColor);
      if (nodeBg.a > 0) {
        bg = compositeOver(nodeBg, bg, cumulativeOpacity);
      }
    }

    const cs = getComputedStyle(el);
    const fgRaw = parseRgba(cs.color);
    const fg = compositeOver(fgRaw, bg, cumulativeOpacity);
    const ratio = contrastRatio(fg, bg);
    const fontSize = parseFloat(cs.fontSize) || 16;
    const fontWeight = parseFloat(cs.fontWeight) || 400;
    const isLarge = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
    const threshold = isLarge ? 3.0 : 4.5;

    if (isDisabled) {
      if (ratio < threshold) disabledAdvisoryCount += 1;
      continue;
    }

    checkedCount += 1;
    if (ratio < threshold) {
      contrastFailures.push({
        element: describeEl(el),
        text: (el.textContent || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 40),
        fg: rgbString(fg),
        bg: rgbString(bg),
        ratio: Number(ratio.toFixed(2)),
        threshold,
        fontSize,
        fontWeight,
      });
    }
  }

  return {
    layout: {
      scrollWidth,
      innerWidth,
      horizontalOverflow,
      clippedControls,
      overlappingControls,
    },
    contrast: {
      checkedCount,
      failureCount: contrastFailures.length,
      failures: contrastFailures,
      disabledAdvisoryCount,
    },
  };
}

async function runView(cdp, baseUrl, viewName, viewport, options) {
  const details = {};
  const failures = [];

  await cdp.evaluate(() => {
    try {
      sessionStorage.clear();
    } catch {
      // Ignore storage errors on about:blank.
    }
  });

  if (viewName === 'datasets_review') {
    await cdp.navigateAndWait(
      `${baseUrl}/dashboard/datasets`,
      () => Boolean(document.querySelector('button[aria-label="Review data for orders.csv"]')),
      [],
      'datasets page table',
    );
    await cdp.evaluate(() => {
      document.querySelector('button[aria-label="Review data for orders.csv"]')?.click();
    });
    await cdp.waitFor(
      () => Boolean(document.querySelector('#dataset-review-panel table tbody tr')),
      [],
      10000,
      'dataset review table rows',
    );
    await cdp.settleLayout();
    const reviewCheck = await cdp.evaluate(() => {
      const sel = document.querySelector('#dataset-review-file-select');
      return {
        panelOpen: Boolean(document.querySelector('#dataset-review-panel')),
        fileSelectPresent: Boolean(sel),
        fileOptionCount: sel ? sel.options.length : 0,
      };
    });
    Object.assign(details, reviewCheck);
    if (!reviewCheck.panelOpen) {
      failures.push('Expected #dataset-review-panel to be open.');
    }
    if (!reviewCheck.fileSelectPresent && !options.allowBaseline) {
      failures.push('Expected M1 #dataset-review-file-select dropdown to render for 3 reviewable datasets.');
    }
  } else if (viewName === 'pipelines_1_source') {
    await cdp.navigateAndWait(
      `${baseUrl}/dashboard/pipelines?datasets=10000000-0000-0000-0000-000000000001`,
      () => Boolean(
        document.querySelector('.workbook-sheet table tbody tr')
        && Array.from(document.querySelectorAll('nav[aria-label="Transformation groups"] button'))
          .some((b) => b.textContent.trim() === 'Combine'),
      ),
      [],
      '1-source pipeline preview',
    );
    await cdp.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('nav[aria-label="Transformation groups"] button'))
        .find((b) => b.textContent.trim() === 'Combine');
      btn?.click();
    });
    await cdp.waitFor(
      () => Boolean(document.querySelector('button[aria-label="Add Join tables step"]')),
      [],
      5000,
      'Combine toolbar commands',
    );
    await cdp.settleLayout();
    const combineCheck = await cdp.evaluate(() => {
      const joinBtn = document.querySelector('button[aria-label="Add Join tables step"]');
      const concatBtn = document.querySelector('button[aria-label="Add Append rows step"]');
      const hint = document.querySelector('#combine-source-requirement');
      return {
        joinDisabled: Boolean(joinBtn?.disabled),
        concatDisabled: Boolean(concatBtn?.disabled),
        combineHintPresent: Boolean(hint && hint.textContent.trim().length > 0),
      };
    });
    Object.assign(details, combineCheck);
    if (!combineCheck.joinDisabled || !combineCheck.concatDisabled) {
      failures.push('Expected Join and Append buttons to be disabled when only 1 source is loaded.');
    }
    if (!combineCheck.combineHintPresent && !options.allowBaseline) {
      failures.push('Expected M2 #combine-source-requirement guidance message when sourceCount < 2.');
    }
  } else if (viewName === 'pipelines_source_library') {
    await cdp.navigateAndWait(
      `${baseUrl}/dashboard/pipelines?datasets=10000000-0000-0000-0000-000000000001`,
      () => Boolean(
        document.querySelector('button[aria-controls="source-library"]')
        && document.querySelector('.workbook-sheet table tbody tr'),
      ),
      [],
      'pipeline page for source library',
    );
    await cdp.evaluate(() => {
      document.querySelector('button[aria-controls="source-library"]')?.click();
    });
    await cdp.waitFor(
      () => Boolean(document.querySelector('#source-library .workbook-library-list li')),
      [],
      5000,
      '#source-library items',
    );
    await cdp.settleLayout();
    const libCheck = await cdp.evaluate(() => ({
      sourceLibraryOpen: Boolean(document.querySelector('#source-library')),
      libraryItemCount: document.querySelectorAll('#source-library .workbook-library-list li').length,
    }));
    Object.assign(details, libCheck);
    if (!libCheck.sourceLibraryOpen || libCheck.libraryItemCount === 0) {
      failures.push('Expected #source-library to open with dataset items.');
    }
  } else if (viewName === 'pipelines_2_sources_dt_popup') {
    await cdp.navigateAndWait(
      `${baseUrl}/dashboard/pipelines?datasets=10000000-0000-0000-0000-000000000001,10000000-0000-0000-0000-000000000002`,
      () => Boolean(
        document.querySelectorAll('[role="tab"]').length >= 2
        && document.querySelector('.workbook-sheet table tbody tr'),
      ),
      [],
      '2-source pipeline preview',
    );
    await cdp.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('nav[aria-label="Transformation groups"] button'))
        .find((b) => b.textContent.trim() === 'Filter');
      btn?.click();
    });
    await cdp.waitFor(
      () => Boolean(document.querySelector('button[aria-label="Add Filter rows step"]')),
      [],
      5000,
      'Add Filter rows step button',
    );
    await cdp.evaluate(() => {
      document.querySelector('button[aria-label="Add Filter rows step"]')?.click();
    });
    await cdp.waitFor(
      () => Array.from(document.querySelectorAll('.workbook-step-settings label'))
        .some((l) => l.textContent.includes('Rule 1 column')
          && (l.control || (l.htmlFor ? document.getElementById(l.htmlFor) : null) || l.querySelector('select'))),
      [],
      5000,
      'Rule 1 column select',
    );
    await cdp.evaluate(() => {
      const label = Array.from(document.querySelectorAll('.workbook-step-settings label'))
        .find((l) => l.textContent.includes('Rule 1 column'));
      const sel = label?.control || (label?.htmlFor ? document.getElementById(label.htmlFor) : null) || label?.querySelector('select');
      if (sel) {
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
        setter.call(sel, 'order_date');
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await cdp.waitFor(
      () => Array.from(document.querySelectorAll('.workbook-step-settings label'))
        .some((l) => l.textContent.includes('Rule 1 comparison value')
          && (l.control || (l.htmlFor ? document.getElementById(l.htmlFor) : null) || l.querySelector('input'))),
      [],
      5000,
      'Rule 1 comparison value input',
    );

    // Mark the input temporarily with a deterministic attribute so cdpClick targets it cleanly.
    await cdp.evaluate(() => {
      const label = Array.from(document.querySelectorAll('.workbook-step-settings label'))
        .find((l) => l.textContent.includes('Rule 1 comparison value'));
      const inp = label?.control || (label?.htmlFor ? document.getElementById(label.htmlFor) : null) || label?.querySelector('input');
      if (inp) inp.setAttribute('data-cdp-dt-input', 'true');
    });
    await cdp.clickCenter('input[data-cdp-dt-input="true"]');

    let dtPopupOpen = false;
    try {
      await cdp.waitFor(
        () => {
          const dlg = document.querySelector('[role="dialog"][aria-label="Choose date and time"], .dt-picker-popover');
          if (!dlg) return false;
          const r = dlg.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        },
        [],
        1200,
        'datetime picker dialog',
      );
      dtPopupOpen = true;
    } catch {
      dtPopupOpen = false;
    }

    await cdp.settleLayout();
    details.dtPopupOpen = dtPopupOpen;
    if (!dtPopupOpen && !options.allowBaseline) {
      failures.push('Expected M2 datetime calendar popup ([role="dialog"][aria-label="Choose date and time"] / .dt-picker-popover) to open for order_date.');
    }
  } else if (viewName === 'pipelines_compare_split') {
    await cdp.navigateAndWait(
      `${baseUrl}/dashboard/pipelines?datasets=10000000-0000-0000-0000-000000000001,10000000-0000-0000-0000-000000000002`,
      () => Boolean(
        document.querySelector('button.workbook-split-toggle')
        && document.querySelector('.workbook-sheet table tbody tr'),
      ),
      [],
      '2-source pipeline before split toggle',
    );
    await cdp.evaluate(() => {
      document.querySelector('button.workbook-split-toggle')?.click();
    });
    await cdp.waitFor(
      () => document.querySelectorAll('.workbook-split .workbook-pane table tbody tr').length >= 2,
      [],
      5000,
      'split view dual panes',
    );
    await cdp.settleLayout();
    const splitCheck = await cdp.evaluate(() => ({
      splitActive: Boolean(document.querySelector('.workbook-split')),
      paneCount: document.querySelectorAll('.workbook-split .workbook-pane').length,
    }));
    Object.assign(details, splitCheck);
    if (!splitCheck.splitActive || splitCheck.paneCount !== 2) {
      failures.push('Expected .workbook-split with 2 .workbook-pane panels.');
    }
  } else if (viewName === 'runs') {
    await cdp.navigateAndWait(
      `${baseUrl}/dashboard/runs`,
      () => (document.body.textContent || '').includes('Monthly Order Cleanup'),
      [],
      'runs page list',
    );
    details.hasRunsTable = await cdp.evaluate(() => Boolean(document.querySelector('.etl-table tbody tr')));
    if (!details.hasRunsTable) {
      failures.push('Expected runs table rows on /dashboard/runs.');
    }
  } else if (viewName === 'account') {
    await cdp.navigateAndWait(
      `${baseUrl}/dashboard/account`,
      () => Boolean(
        document.querySelector('#account-plan-title')
        && (document.body.textContent || '').includes('Premium'),
      ),
      [],
      'account and billing page',
    );
    details.accountLoaded = true;
  }

  const audit = await cdp.evaluate(auditPageLayoutAndContrastInBrowser);
  const screenshotName = `${viewName}_${viewport.name}.png`;
  const screenshotPath = path.join(options.outDir, screenshotName);
  await cdp.capturePng(screenshotPath);

  const consoleErrors = [...cdp.consoleErrors];
  const layoutFailures = [];
  if (audit.layout.horizontalOverflow) {
    layoutFailures.push(`Horizontal overflow: scrollWidth=${audit.layout.scrollWidth} > innerWidth=${audit.layout.innerWidth}`);
  }
  if (audit.layout.clippedControls.length > 0) {
    layoutFailures.push(`${audit.layout.clippedControls.length} clipped interactive control(s)`);
  }
  if (audit.layout.overlappingControls.length > 0) {
    layoutFailures.push(`${audit.layout.overlappingControls.length} overlapping interactive control pair(s)`);
  }
  if (options.strictContrast && audit.contrast.failureCount > 0) {
    layoutFailures.push(`${audit.contrast.failureCount} WCAG contrast violation(s)`);
  }

  const allFailures = [...failures, ...layoutFailures];
  const currentUrl = await cdp.evaluate(() => window.location.pathname + window.location.search);

  return {
    view: viewName,
    viewport: viewport.name,
    width: viewport.width,
    height: viewport.height,
    screenshot: screenshotName,
    url: currentUrl,
    assertions: {
      passed: failures.length === 0,
      details,
      failures,
    },
    layout: audit.layout,
    contrast: audit.contrast,
    consoleErrors,
    passed: allFailures.length === 0 && consoleErrors.length === 0,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  fs.mkdirSync(options.outDir, { recursive: true });

  const { server, baseUrl } = await startMockServer(options.buildDir);
  let chromeHandle = null;

  const closeAll = async () => {
    if (chromeHandle) {
      const handle = chromeHandle;
      chromeHandle = null;
      await handle.cleanupChrome();
    }
    await new Promise((resolve) => {
      server.close(() => resolve());
      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
      }
      setTimeout(resolve, 500);
    });
  };

  const onSignal = async (signal) => {
    console.error(`Received ${signal}, cleaning up Chrome and HTTP server...`);
    await closeAll();
    process.exit(1);
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    chromeHandle = await launchChrome(options.chromePath);
    const { cdp } = chromeHandle;
    const results = [];

    for (const viewport of DEFAULT_VIEWPORTS) {
      await cdp.setViewport(viewport.width, viewport.height);
      for (const viewName of options.views) {
        const result = await runView(cdp, baseUrl, viewName, viewport, options);
        results.push(result);
        const statusTag = result.passed ? 'PASS' : 'FAIL';
        console.log(
          `[${statusTag}] ${viewName} @ ${viewport.name} | overflow=${result.layout.horizontalOverflow} `
          + `clipped=${result.layout.clippedControls.length} overlap=${result.layout.overlappingControls.length} `
          + `contrastFails=${result.contrast.failureCount} consoleErrs=${result.consoleErrors.length}`,
        );
      }
    }

    const summary = {
      totalChecks: results.length,
      passedChecks: results.filter((r) => r.passed).length,
      failedChecks: results.filter((r) => !r.passed).length,
      overflowFailures: results.filter((r) => r.layout.horizontalOverflow).length,
      clippingFailures: results.filter((r) => r.layout.clippedControls.length > 0).length,
      overlapFailures: results.filter((r) => r.layout.overlappingControls.length > 0).length,
      assertionFailures: results.filter((r) => !r.assertions.passed).length,
      contrastFailuresTotal: results.reduce((sum, r) => sum + r.contrast.failureCount, 0),
      consoleErrorsTotal: results.reduce((sum, r) => sum + r.consoleErrors.length, 0),
    };

    const report = {
      timestamp: new Date().toISOString(),
      buildDir: options.buildDir,
      outDir: options.outDir,
      strictContrast: options.strictContrast,
      allowBaseline: options.allowBaseline,
      viewports: DEFAULT_VIEWPORTS.map((v) => v.name),
      views: options.views,
      summary,
      results,
    };

    const reportPath = path.join(options.outDir, 'report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`Wrote report to ${reportPath}`);
    console.log(`Summary: ${JSON.stringify(summary)}`);

    if (summary.failedChecks > 0) {
      process.exitCode = 1;
    }
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    await closeAll();
  }
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
