// Keep navigation and page metadata together. See docs/FRONTEND_HANDOFF.md before
// adding ETL behavior. Dataset uploads are live; other ETL routes remain previews.
export const workspacePages = [
  { path: '/dashboard', label: 'Overview', title: 'Overview' },
  {
    path: '/dashboard/datasets',
    label: 'Datasets',
    title: 'Datasets',
    description: 'Manage the source files for your workflows.',
  },
  {
    path: '/dashboard/pipelines',
    label: 'Pipelines',
    title: 'Pipelines',
    description: 'Organize the steps that prepare your data.',
    emptyTitle: 'Build a clear path for your data',
    emptyDescription: 'Your saved transformation pipelines will appear here.',
    action: 'Create pipeline',
    availability: 'The pipeline builder is coming soon.',
  },
  {
    path: '/dashboard/runs',
    label: 'Runs',
    title: 'Runs',
    description: 'Follow pipeline execution from start to finish.',
    emptyTitle: 'Keep track of every run',
    emptyDescription: 'Run progress and execution history will appear here.',
    availability: 'Pipeline execution is coming soon.',
  },
  {
    path: '/dashboard/results',
    label: 'Results',
    title: 'Results',
    description: 'Find the outputs of your completed workflows.',
    emptyTitle: 'A place for your processed data',
    emptyDescription: 'Your processed files will appear here after a pipeline finishes.',
    availability: 'Result previews and downloads are coming soon.',
  },
];

export function normalizePath(path) {
  return path.replace(/\/+$/, '') || '/';
}

export function findWorkspacePage(path) {
  return workspacePages.find((page) => page.path === normalizePath(path));
}

export function getReturnPath(search) {
  const requested = new URLSearchParams(search).get('next');
  // Accept only registered workspace URLs, never an arbitrary redirect target.
  return workspacePages.some((page) => page.path === requested) ? requested : '/dashboard';
}
