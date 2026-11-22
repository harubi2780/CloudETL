// Keep navigation and page metadata together. See docs/FRONTEND_HANDOFF.md before
// adding ETL behavior. Dynamic detail routes retain their parent navigation item.
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
  },
  {
    path: '/dashboard/runs',
    label: 'Runs',
    title: 'Runs',
    description: 'Track pipeline execution, compare data, and download processed results.',
  },
  {
    path: '/dashboard/results',
    label: 'Results',
    title: 'Results',
    description: 'Find the outputs of your completed workflows.',
    hiddenInNav: true,
  },
  {
    path: '/dashboard/account',
    label: 'Account',
    title: 'Account',
    description: 'View your profile, plan, and storage allowance.',
  },
];

export function normalizePath(path) {
  return path.replace(/\/+$/, '') || '/';
}

export function findWorkspacePage(path) {
  const normalized = normalizePath(path);
  const direct = workspacePages.find((page) => page.path === normalized);
  if (direct) return direct;
  const detail = normalized.match(/^\/dashboard\/(runs|results)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  if (!detail) return undefined;
  return { ...workspacePages.find((page) => page.path === `/dashboard/${detail[1].toLowerCase()}`), runId: detail[2] };
}

export function getReturnPath(search) {
  const requested = new URLSearchParams(search).get('next');
  // Accept only registered workspace URLs, never an arbitrary redirect target.
  if (typeof requested !== 'string' || !requested.startsWith('/dashboard') || requested.includes('\\') || /[\r\n]/.test(requested)) return '/dashboard';
  const url = new URL(requested, 'https://cloudetl.invalid');
  return url.origin === 'https://cloudetl.invalid' && findWorkspacePage(url.pathname)
    ? url.pathname + url.search : '/dashboard';
}
