import { act, fireEvent, render, screen, within } from '@testing-library/react';
import accountApi from '../api/account';
import authApi from '../api/auth';
import billingApi from '../api/billing';
import App from '../App';
import { findWorkspacePage, getReturnPath } from '../routes';
import AccountPage from './AccountPage';

jest.mock('../api/account', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('../api/auth', () => ({ __esModule: true, default: { getCurrentUser: jest.fn(), login: jest.fn(), logout: jest.fn() } }));
jest.mock('../api/billing', () => ({ __esModule: true, default: {
  get: jest.fn(), createDemoOrder: jest.fn(), completeDemoOrder: jest.fn(), expireDemoSubscription: jest.fn(),
} }));

const MiB = 1024 * 1024;
const account = {
  id: 7, username: 'mira', email: 'mira@example.test', status: 'active', joined_at: '2026-11-01T10:00:00Z',
  plan: { code: 'free', name: 'Free' },
  storage: { limit_bytes: 10 * MiB, used_bytes: 2 * MiB, uploaded_bytes: MiB,
    result_bytes: MiB * .75, pending_cleanup_bytes: MiB * .25, reserved_bytes: MiB,
    available_bytes: 7 * MiB, over_limit: false },
};

beforeEach(() => {
  jest.resetAllMocks();
  accountApi.get.mockResolvedValue({ account });
  billingApi.get.mockResolvedValue({ demo_enabled: false, plans: [
    { code: 'free', name: 'Free', storage_limit_bytes: 500 * MiB, amount_vnd: 0, period_days: null },
    { code: 'premium', name: 'Premium', storage_limit_bytes: 2 * 1024 * MiB, amount_vnd: 59000, period_days: 30 },
  ], subscription: { status: 'free', current_period_end: null }, orders: [] });
  authApi.getCurrentUser.mockResolvedValue({ id: account.id, username: account.username, email: account.email });
  window.history.replaceState(null, '', '/dashboard/account');
  window.scrollTo = jest.fn();
});

test('loads a read-only profile, account status, Free plan and complete storage breakdown', async () => {
  let finish;
  accountApi.get.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  render(<AccountPage />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading account');
  expect(screen.getByRole('button', { name: 'Refresh account' })).toBeDisabled();
  await act(async () => { finish({ account }); });
  const profile = screen.getByRole('region', { name: 'Profile' });
  expect(within(profile).getByText('mira')).toBeInTheDocument();
  expect(within(profile).getByText('mira@example.test')).toBeInTheDocument();
  expect(within(profile).getByText('Active')).toBeInTheDocument();
  const joined = new Date(account.joined_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  expect(within(profile).getByText(joined)).toHaveAttribute('datetime', account.joined_at);
  const plan = screen.getByRole('region', { name: 'Plan and storage' });
  expect(within(plan).getByText('Free')).toBeInTheDocument();
  expect(within(plan).getByText('Uploaded files')).toBeInTheDocument();
  expect(within(plan).getByText('Processed results')).toBeInTheDocument();
  expect(within(plan).getByText('Pending cleanup')).toBeInTheDocument();
  expect(within(plan).getByText('256 KiB')).toBeInTheDocument();
  expect(within(plan).getByText('Reserved storage')).toBeInTheDocument();
  expect(within(plan).getByText('Files awaiting removal still count toward storage until cleanup finishes.')).toBeInTheDocument();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /upgrade|payment|subscribe/i })).not.toBeInTheDocument();
  expect(accountApi.get).toHaveBeenCalledWith({ signal: expect.any(AbortSignal) });
});

test('refreshing reloads current server data including changed storage use', async () => {
  accountApi.get.mockResolvedValueOnce({ account });
  accountApi.get.mockResolvedValueOnce({ account: { ...account, status: 'inactive', email: '', storage: { ...account.storage, used_bytes: 3 * MiB, available_bytes: 6 * MiB } } });
  render(<AccountPage />);
  await screen.findByText('2 MiB of 10 MiB used');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh account' }));
  expect(await screen.findByText('3 MiB of 10 MiB used')).toBeInTheDocument();
  expect(screen.getByText('6 MiB available')).toBeInTheDocument();
  expect(screen.getByText('Inactive')).toBeInTheDocument();
  expect(screen.getByText('No email address')).toBeInTheDocument();
  expect(accountApi.get).toHaveBeenCalledTimes(2);
});

test('account failures have a retry path and do not invent profile or quota values', async () => {
  accountApi.get.mockRejectedValueOnce({ message: 'Account service unavailable.' });
  accountApi.get.mockResolvedValueOnce({ account });
  render(<AccountPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Account service unavailable.');
  expect(screen.queryByRole('region', { name: 'Profile' })).not.toBeInTheDocument();
  expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry account' }));
  expect(await screen.findByText('mira')).toBeInTheDocument();
});

test('unauthorized account responses invoke the session-expired callback', async () => {
  const expired = jest.fn();
  accountApi.get.mockRejectedValue({ status: 401, message: 'Please log in.' });
  render(<AccountPage onSessionExpired={expired} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Please log in.');
  expect(expired).toHaveBeenCalledTimes(1);
});

test('unmount cancels the account request and ignores late data', async () => {
  let finish;
  accountApi.get.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const { unmount } = render(<AccountPage />);
  const signal = accountApi.get.mock.calls[0][0].signal;
  unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => { finish({ account }); });
});

test('the protected account route restores a session and selects its sidebar link', async () => {
  render(<App />);
  expect(await screen.findByRole('region', { name: 'Profile' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Account', level: 1 })).toBeInTheDocument();
  const sidebar = screen.getByRole('navigation', { name: 'Workspace' });
  expect(within(sidebar).getByRole('link', { name: 'Account' })).toHaveAttribute('aria-current', 'page');
  expect(within(sidebar).getByRole('link', { name: 'Account' })).toHaveAttribute('href', '/dashboard/account');
  expect(document.title).toBe('Account | CloudETL');
  expect(findWorkspacePage('/dashboard/account/').path).toBe('/dashboard/account');
  expect(getReturnPath('?next=%2Fdashboard%2Faccount')).toBe('/dashboard/account');
});

test('signed-out account visits redirect to login and preserve the account return path', async () => {
  authApi.getCurrentUser.mockResolvedValue(null);
  render(<App />);
  expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
  expect(window.location.pathname).toBe('/login');
  expect(new URLSearchParams(window.location.search).get('next')).toBe('/dashboard/account');
  expect(accountApi.get).not.toHaveBeenCalled();
});

test('an expired account request returns the guarded app to sign-in', async () => {
  accountApi.get.mockRejectedValue({ status: 401, message: 'Please log in.' });
  render(<App />);
  expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
  expect(window.location.pathname).toBe('/login');
  expect(new URLSearchParams(window.location.search).get('next')).toBe('/dashboard/account');
  expect(screen.queryByRole('region', { name: 'Profile' })).not.toBeInTheDocument();
});

const pendingOrder = { id: '20000000-0000-0000-0000-000000000001', plan_code: 'premium', plan_name: 'Premium', amount_vnd: 59000,
  currency: 'VND', period_days: 30, status: 'pending', created_at: '2026-11-19T10:00:00Z', expires_at: '2026-11-19T10:15:00Z', completed_at: null };
const paidOrder = { ...pendingOrder, status: 'succeeded', completed_at: '2026-11-19T10:01:00Z' };
const periodEnd = '2026-12-19T10:01:00Z';
const freeAccount = { ...account, storage: { ...account.storage, limit_bytes: 500 * MiB, available_bytes: 497 * MiB } };
const premiumAccount = { ...freeAccount, plan: { code: 'premium', name: 'Premium' }, storage: { ...account.storage, limit_bytes: 2 * 1024 * MiB, available_bytes: 2045 * MiB } };

function enableDemo() {
  return { demo_enabled: true, plans: [
    { code: 'free', name: 'Free', storage_limit_bytes: 500 * MiB, amount_vnd: 0, period_days: null },
    { code: 'premium', name: 'Premium', storage_limit_bytes: 2 * 1024 * MiB, amount_vnd: 59000, period_days: 30 },
  ], subscription: { status: 'free', current_period_end: null }, orders: [] };
}

test('successful demo checkout refreshes actual account quota while keeping payment history visible', async () => {
  accountApi.get.mockResolvedValueOnce({ account: freeAccount }).mockResolvedValueOnce({ account: premiumAccount });
  const initial = enableDemo();
  billingApi.get.mockResolvedValueOnce(initial).mockResolvedValueOnce({ ...initial, subscription: { status: 'active', current_period_end: periodEnd }, orders: [paidOrder] });
  billingApi.createDemoOrder.mockResolvedValueOnce({ order: pendingOrder });
  billingApi.completeDemoOrder.mockResolvedValueOnce({ order: paidOrder });
  render(<AccountPage />);
  expect(await screen.findByText('2 MiB of 500 MiB used')).toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: 'Upgrade to Premium' }));
  const checkout = await screen.findByRole('dialog', { name: 'Review your upgrade' });
  fireEvent.click(within(checkout).getByRole('button', { name: 'Confirm upgrade' }));
  expect(await screen.findByText('2 MiB of 2 GiB used')).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Plan and storage' })).getByText('Premium')).toBeInTheDocument();
  expect(screen.getByText('Your Premium plan is active.')).toBeInTheDocument();
  expect(screen.getByRole('table', { name: 'Recent payments (up to 20)' })).toHaveTextContent('Completed');
  expect(billingApi.completeDemoOrder).toHaveBeenCalledWith(pendingOrder.id, 'succeeded');
  expect(accountApi.get).toHaveBeenCalledTimes(2);
  expect(billingApi.get).toHaveBeenCalledTimes(2);
});

test('confirmed demo expiry refreshes Free allowance and reports existing data over the limit', async () => {
  const used = 600 * MiB;
  accountApi.get.mockResolvedValueOnce({ account: { ...premiumAccount, storage: { ...premiumAccount.storage, used_bytes: used } } });
  accountApi.get.mockResolvedValueOnce({ account: { ...freeAccount, storage: { ...freeAccount.storage, used_bytes: used, available_bytes: 0, over_limit: true } } });
  const initial = enableDemo();
  billingApi.get.mockResolvedValueOnce({ ...initial, subscription: { status: 'active', current_period_end: periodEnd } });
  billingApi.get.mockResolvedValueOnce({ ...initial, subscription: { status: 'expired', current_period_end: periodEnd } });
  billingApi.expireDemoSubscription.mockResolvedValueOnce({ expired: true });
  render(<AccountPage />);
  fireEvent.click(await screen.findByText('Testing tools'));
  fireEvent.click(screen.getByRole('button', { name: 'End Premium access' }));
  expect(accountApi.get).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Confirm expiry' }));
  expect(await screen.findByText('600 MiB of 500 MiB used')).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Storage usage' })).getByRole('alert')).toHaveTextContent('Storage limit exceeded.');
  expect(screen.getByText('Premium access ended. Your account now uses the Free allowance.')).toBeInTheDocument();
  expect(accountApi.get).toHaveBeenCalledTimes(2);
});

test('checkout success with failed account refresh labels the last profile snapshot and offers retry', async () => {
  accountApi.get.mockResolvedValueOnce({ account: freeAccount }).mockRejectedValueOnce({ message: 'Quota refresh unavailable.' }).mockResolvedValueOnce({ account: premiumAccount });
  const initial = enableDemo();
  billingApi.get.mockResolvedValueOnce(initial).mockResolvedValueOnce({ ...initial, subscription: { status: 'active', current_period_end: periodEnd }, orders: [paidOrder] });
  billingApi.createDemoOrder.mockResolvedValueOnce({ order: pendingOrder });
  billingApi.completeDemoOrder.mockResolvedValueOnce({ order: paidOrder });
  render(<AccountPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Upgrade to Premium' }));
  const checkout = await screen.findByRole('dialog', { name: 'Review your upgrade' });
  fireEvent.click(within(checkout).getByRole('button', { name: 'Confirm upgrade' }));
  expect(await screen.findByText('Showing the last loaded account details. Retry to update your plan and storage.')).toBeInTheDocument();
  expect(screen.getByText('2 MiB of 500 MiB used')).toBeInTheDocument();
  expect(screen.getByText('Your Premium plan is active.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry account' }));
  expect(await screen.findByText('2 MiB of 2 GiB used')).toBeInTheDocument();
  expect(screen.queryByText('Quota refresh unavailable.')).not.toBeInTheDocument();
});
