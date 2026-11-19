import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import billingApi from '../../api/billing';
import BillingPanel from './BillingPanel';

jest.mock('../../api/billing', () => ({ __esModule: true, default: {
  get: jest.fn(), createDemoOrder: jest.fn(), completeDemoOrder: jest.fn(), expireDemoSubscription: jest.fn(),
} }));

const id = '10000000-0000-0000-0000-000000000001';
const order = { id, plan_code: 'premium', plan_name: 'Premium', amount_vnd: 59000, currency: 'VND', period_days: 30,
  status: 'pending', created_at: '2026-11-19T10:00:00Z', expires_at: '2026-11-19T10:15:00Z', completed_at: null };
const periodEnd = '2026-12-19T10:00:00Z';
const data = (extra = {}) => ({ demo_enabled: true, plans: [
  { code: 'free', name: 'Free', storage_limit_bytes: 500 * 1024 ** 2, amount_vnd: 0, period_days: null },
  { code: 'premium', name: 'Premium', storage_limit_bytes: 2 * 1024 ** 3, amount_vnd: 59000, period_days: 30 },
], subscription: { status: 'free', current_period_end: null }, orders: [], ...extra });
const active = (orders = []) => data({ subscription: { status: 'active', current_period_end: periodEnd }, orders });
const completed = (status) => ({ ...order, status, completed_at: '2026-11-19T10:01:00Z' });

beforeEach(() => {
  jest.resetAllMocks();
  billingApi.get.mockResolvedValue(data());
  billingApi.createDemoOrder.mockResolvedValue({ order });
  billingApi.completeDemoOrder.mockImplementation(async (orderId, status) => ({ order: completed(status) }));
  billingApi.expireDemoSubscription.mockResolvedValue({ expired: true });
});

async function loaded(props) {
  const view = render(<BillingPanel {...props} />);
  await screen.findByRole('button', { name: /^(Upgrade to Premium|Continue checkout|Renew Premium)$/ });
  return view;
}

async function createCheckout() {
  fireEvent.click(screen.getByRole('button', { name: 'Upgrade to Premium' }));
  await screen.findByRole('dialog', { name: 'Review your upgrade' });
}

test('loads server plan details and keeps payment simulation disclosures in checkout', async () => {
  let finish;
  billingApi.get.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  render(<BillingPanel />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading billing details');
  expect(screen.getByRole('button', { name: 'Refresh billing' })).toBeDisabled();
  await act(async () => { finish(data()); });
  expect(screen.getByText('Test mode')).toBeInTheDocument();
  expect(screen.getByRole('article', { name: 'Free plan' })).toHaveTextContent('500 MiB storage');
  const premium = screen.getByRole('article', { name: 'Premium plan' });
  expect(premium).toHaveTextContent('2 GiB storage');
  expect(premium).toHaveTextContent('59,000 VND / 30 days');
  expect(within(premium).getByText('More room for source files and processed results.')).toBeInTheDocument();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(billingApi.get).toHaveBeenCalledWith({ signal: expect.any(AbortSignal) });
});

test('disabled environments display plans/history but do not expose demo mutations or invent enablement', async () => {
  billingApi.get.mockResolvedValue(data({ demo_enabled: false, subscription: { status: 'active', current_period_end: periodEnd }, orders: [order] }));
  render(<BillingPanel />);
  expect(await screen.findByText('Plan changes are not available in this environment.')).toBeInTheDocument();
  expect(screen.getByRole('table')).toHaveTextContent('Pending');
  expect(screen.queryByRole('button', { name: /upgrade|renew|resume|expire|simulate|cancel/i })).not.toBeInTheDocument();
  expect(billingApi.createDemoOrder).not.toHaveBeenCalled();
});

test('load failures support retry without advertising a checkout before server approval', async () => {
  billingApi.get.mockRejectedValueOnce({ message: 'Billing unavailable.' });
  billingApi.get.mockResolvedValueOnce(data());
  render(<BillingPanel />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Billing unavailable.');
  expect(screen.queryByRole('button', { name: 'Upgrade to Premium' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry billing' }));
  expect(await screen.findByRole('button', { name: 'Upgrade to Premium' })).toBeEnabled();
});

test('HTTP401 while loading billing expires the account session', async () => {
  const expired = jest.fn();
  billingApi.get.mockRejectedValue({ status: 401, message: 'Please sign in.' });
  render(<BillingPanel onSessionExpired={expired} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Please sign in.');
  expect(expired).toHaveBeenCalledTimes(1);
});

test('creates one pending order on repeated clicks and offers explicit simulated outcomes', async () => {
  let finish;
  billingApi.createDemoOrder.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const changed = jest.fn();
  await loaded({ onAccountChanged: changed });
  const upgrade = screen.getByRole('button', { name: 'Upgrade to Premium' });
  fireEvent.click(upgrade);
  fireEvent.click(upgrade);
  expect(billingApi.createDemoOrder).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Preparing checkout...' })).toBeDisabled();
  await act(async () => { finish({ order }); });
  const checkout = screen.getByRole('dialog', { name: 'Review your upgrade' });
  expect(within(checkout).getByText('Premium')).toBeInTheDocument();
  expect(within(checkout).getByText('59,000 VND')).toBeInTheDocument();
  expect(within(checkout).getByText('Test mode — no money charged')).toBeInTheDocument();
  expect(within(checkout).getByRole('button', { name: 'Confirm upgrade' })).toBeEnabled();
  expect(within(checkout).getByText('Testing tools').closest('details')).not.toHaveAttribute('open');
  fireEvent.click(within(checkout).getByText('Testing tools'));
  expect(within(checkout).getByRole('button', { name: 'Simulate failed payment' })).toBeEnabled();
  expect(within(checkout).getByRole('button', { name: 'Cancel checkout' })).toBeEnabled();
  expect(changed).not.toHaveBeenCalled();
  fireEvent.click(within(checkout).getByRole('button', { name: 'Close checkout' }));
  expect(screen.getByRole('table')).toHaveTextContent('Pending');
});

test('simulated success refreshes account quota and billing, then offers manual renewal', async () => {
  const changed = jest.fn();
  billingApi.get.mockResolvedValueOnce(data()).mockResolvedValueOnce(active([completed('succeeded')]));
  await loaded({ onAccountChanged: changed });
  await createCheckout();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm upgrade' }));
  expect(await screen.findByRole('button', { name: 'Renew Premium' })).toBeEnabled();
  expect(billingApi.completeDemoOrder).toHaveBeenCalledWith(id, 'succeeded');
  expect(changed).toHaveBeenCalledTimes(1);
  expect(billingApi.get).toHaveBeenCalledTimes(2);
  expect(screen.getByText('Your Premium plan is active.')).toBeInTheDocument();
  expect(screen.queryByRole('dialog', { name: 'Review your upgrade' })).not.toBeInTheDocument();
  expect(screen.getByRole('table')).toHaveTextContent('Completed');
  expect(screen.getByLabelText('Subscription status')).toHaveTextContent('Premium active until');
  expect(screen.getByLabelText('Subscription status')).toHaveTextContent(new Date(periodEnd).toLocaleString());
});

test.each([
  ['Simulate failed payment', 'failed', 'Payment was unsuccessful. Your plan has not changed.'],
  ['Cancel checkout', 'cancelled', 'Checkout cancelled. Your plan has not changed.'],
])('%s produces its own history status without upgrading the account', async (label, outcome, message) => {
  const changed = jest.fn();
  billingApi.get.mockResolvedValueOnce(data()).mockResolvedValueOnce(data({ orders: [completed(outcome)] }));
  await loaded({ onAccountChanged: changed });
  await createCheckout();
  if (outcome === 'failed') fireEvent.click(within(screen.getByRole('dialog')).getByText('Testing tools'));
  fireEvent.click(screen.getByRole('button', { name: label }));
  expect(await screen.findByText(message)).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Upgrade to Premium' })).toBeEnabled());
  expect(billingApi.completeDemoOrder).toHaveBeenCalledWith(id, outcome);
  expect(changed).not.toHaveBeenCalled();
  expect(screen.getByRole('table')).toHaveTextContent(outcome === 'failed' ? 'Failed' : 'Cancelled');
});

test('resumes a server-persisted pending order without creating another one', async () => {
  billingApi.get.mockResolvedValue(data({ orders: [order] }));
  const view = await loaded();
  fireEvent.click(screen.getByRole('button', { name: `Continue payment for order ${id}` }));
  expect(screen.getByRole('dialog', { name: 'Review your upgrade' })).toBeInTheDocument();
  expect(view.container.querySelector('.billing-actions .button-primary')).toBeDisabled();
  expect(billingApi.createDemoOrder).not.toHaveBeenCalled();
});

test('renewal creates a fresh demo checkout while an active period remains visible', async () => {
  billingApi.get.mockResolvedValue(active());
  render(<BillingPanel />);
  fireEvent.click(await screen.findByRole('button', { name: 'Renew Premium' }));
  expect(await screen.findByRole('dialog', { name: 'Renew Premium' })).toBeInTheDocument();
  expect(billingApi.createDemoOrder).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('Subscription status')).toHaveTextContent('Premium active until');
});

test('a completion failure keeps the pending checkout usable for an explicit retry', async () => {
  billingApi.completeDemoOrder.mockRejectedValueOnce({ message: 'Outcome could not be applied.' });
  billingApi.completeDemoOrder.mockResolvedValueOnce({ order: completed('succeeded') });
  billingApi.get.mockResolvedValueOnce(data()).mockResolvedValueOnce(active([completed('succeeded')]));
  await loaded();
  await createCheckout();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm upgrade' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Outcome could not be applied.');
  expect(screen.getByRole('dialog', { name: 'Review your upgrade' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm upgrade' }));
  expect(await screen.findByRole('button', { name: 'Renew Premium' })).toBeEnabled();
  expect(billingApi.completeDemoOrder).toHaveBeenCalledTimes(2);
});

test('pending completion disables every checkout outcome and prevents a second terminal mutation', async () => {
  let finish;
  billingApi.completeDemoOrder.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  billingApi.get.mockResolvedValueOnce(data()).mockResolvedValueOnce(data({ orders: [completed('failed')] }));
  await loaded();
  await createCheckout();
  fireEvent.click(within(screen.getByRole('dialog')).getByText('Testing tools'));
  const fail = screen.getByRole('button', { name: 'Simulate failed payment' });
  fireEvent.click(fail);
  fireEvent.click(fail);
  fireEvent.click(screen.getByRole('button', { name: 'Confirm upgrade' }));
  expect(billingApi.completeDemoOrder).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Confirm upgrade' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Cancel checkout' })).toBeDisabled();
  expect(screen.getByText('Applying your test payment…')).toBeInTheDocument();
  await act(async () => { finish({ order: completed('failed') }); });
  expect(screen.getByText('Payment was unsuccessful. Your plan has not changed.')).toBeInTheDocument();
});

test('expired order HTTP410 closes checkout and reloads server history gracefully', async () => {
  billingApi.get.mockResolvedValueOnce(data({ orders: [order] })).mockResolvedValueOnce(data({ orders: [completed('expired')] }));
  billingApi.completeDemoOrder.mockRejectedValueOnce({ status: 410, message: 'Expired.' });
  const changed = jest.fn();
  await loaded({ onAccountChanged: changed });
  fireEvent.click(screen.getByRole('button', { name: `Continue payment for order ${id}` }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm upgrade' }));
  expect(await screen.findByText('Checkout expired. Start a new checkout when ready.')).toBeInTheDocument();
  expect(screen.getByRole('table')).toHaveTextContent('Expired');
  expect(screen.queryByRole('dialog', { name: 'Review your upgrade' })).not.toBeInTheDocument();
  expect(changed).not.toHaveBeenCalled();
});

test('early Premium expiry requires inline confirmation and refreshes account and subscription', async () => {
  const changed = jest.fn();
  billingApi.get.mockResolvedValueOnce(active()).mockResolvedValueOnce(data({ subscription: { status: 'expired', current_period_end: periodEnd } }));
  render(<BillingPanel onAccountChanged={changed} />);
  fireEvent.click(await screen.findByText('Testing tools'));
  fireEvent.click(await screen.findByRole('button', { name: 'End Premium access' }));
  expect(billingApi.expireDemoSubscription).not.toHaveBeenCalled();
  const confirmation = screen.getByRole('region', { name: 'End Premium access now?' });
  expect(confirmation).toHaveTextContent('Free with 500 MiB storage');
  expect(confirmation).toHaveTextContent('Existing files stay saved.');
  fireEvent.click(within(confirmation).getByRole('button', { name: 'Keep Premium' }));
  expect(screen.queryByRole('region', { name: 'End Premium access now?' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'End Premium access' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm expiry' }));
  expect(await screen.findByText('Premium period ended. Free storage limits apply.')).toBeInTheDocument();
  expect(billingApi.expireDemoSubscription).toHaveBeenCalledTimes(1);
  expect(changed).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: 'End Premium access' })).not.toBeInTheDocument();
});

test('HTTP401 from a mutation expires the session and does not claim a successful upgrade', async () => {
  const expired = jest.fn();
  billingApi.createDemoOrder.mockRejectedValueOnce({ status: 401, message: 'Please sign in.' });
  await loaded({ onSessionExpired: expired });
  fireEvent.click(screen.getByRole('button', { name: 'Upgrade to Premium' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Please sign in.');
  expect(expired).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Your Premium plan is active.')).not.toBeInTheDocument();
});

test('a failed history refresh keeps the last data visible but disables stale mutations until retry', async () => {
  billingApi.get.mockResolvedValueOnce(data()).mockRejectedValueOnce({ message: 'History unavailable.' }).mockResolvedValueOnce(data());
  await loaded();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh billing' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('History unavailable.');
  expect(screen.getByText('Showing the last loaded billing details.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Upgrade to Premium' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry billing' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Upgrade to Premium' })).toBeEnabled());
});

test('latest history displays all five server order states without fake payment methods', async () => {
  const states = ['pending', 'succeeded', 'failed', 'cancelled', 'expired'];
  billingApi.get.mockResolvedValue(data({ orders: states.map((status, index) => ({ ...order, id: `10000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`, status })) }));
  await loaded();
  const history = screen.getByRole('table', { name: 'Recent payments (up to 20)' });
  for (const status of ['Pending', 'Completed', 'Failed', 'Cancelled', 'Expired']) expect(within(history).getByRole('cell', { name: status })).toBeInTheDocument();
  expect(within(history).getAllByRole('row')).toHaveLength(6);
});

test('unmount aborts pending reads and ignores a late order-creation result', async () => {
  let finish;
  billingApi.createDemoOrder.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const changed = jest.fn();
  const { unmount } = await loaded({ onAccountChanged: changed });
  const signal = billingApi.get.mock.calls[0][0].signal;
  fireEvent.click(screen.getByRole('button', { name: 'Upgrade to Premium' }));
  unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => { finish({ order }); });
  expect(changed).not.toHaveBeenCalled();
});
