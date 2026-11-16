import { findWorkspacePage, getReturnPath } from './routes';

const id = '10000000-0000-0000-0000-000000000001';

test('run and result detail routes retain the parent navigation item and UUID', () => {
  expect(findWorkspacePage(`/dashboard/runs/${id}/`)).toMatchObject({ path: '/dashboard/runs', runId: id });
  expect(findWorkspacePage(`/dashboard/results/${id}`)).toMatchObject({ path: '/dashboard/results', runId: id });
  expect(findWorkspacePage(`/dashboard/RUNS/${id}`)).toMatchObject({ path: '/dashboard/runs', runId: id });
  expect(findWorkspacePage('/dashboard/runs/not-a-uuid')).toBeUndefined();
  expect(findWorkspacePage(`/dashboard/runs/${id}/other`)).toBeUndefined();
});

test('authentication return paths preserve pipeline source selections and run deep links', () => {
  for (const path of [`/dashboard/pipelines?datasets=${id}`, `/dashboard/runs/${id}`, `/dashboard/results/${id}`]) {
    expect(getReturnPath(`?next=${encodeURIComponent(path)}`)).toBe(path);
  }
});

test('authentication return paths reject external, malformed and unknown routes', () => {
  for (const path of ['https://example.com/dashboard', '//example.com', '/unknown', '/dashboard\\\\evil', '/dashboard/results/not-uuid', '/dashboard\n/runs']) {
    expect(getReturnPath(`?next=${encodeURIComponent(path)}`)).toBe('/dashboard');
  }
});
