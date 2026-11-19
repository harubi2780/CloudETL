import billingApi from './billing';
import { ApiError, request } from './client';

jest.mock('./client', () => ({ ...jest.requireActual('./client'), request: jest.fn() }));

const id = '10000000-0000-0000-0000-000000000001';
const order = { id, plan_code: 'premium', plan_name: 'Premium', amount_vnd: 59000, currency: 'VND', period_days: 30,
  status: 'pending', created_at: '2026-11-19T10:00:00Z', expires_at: '2026-11-19T10:15:00Z', completed_at: null };
const billing = { demo_enabled: true, plans: [
  { code: 'free', name: 'Free', storage_limit_bytes: 500 * 1024 ** 2, amount_vnd: 0, period_days: null },
  { code: 'premium', name: 'Premium', storage_limit_bytes: 2 * 1024 ** 3, amount_vnd: 59000, period_days: 30 },
], subscription: { status: 'free', current_period_end: null }, orders: [order] };

beforeEach(() => jest.resetAllMocks());

test('reads server plans, demo enablement, subscription and latest orders using the shared request adapter', async () => {
  const { signal } = new AbortController();
  request.mockResolvedValue(billing);
  expect(await billingApi.get({ signal })).toEqual(billing);
  expect(request).toHaveBeenCalledWith('/api/billing/', { signal });
});

test('creates a Premium demo order with only the supported server-side plan choice', async () => {
  const { signal } = new AbortController();
  request.mockResolvedValue({ order });
  expect(await billingApi.createDemoOrder({ signal })).toEqual({ order });
  expect(request).toHaveBeenCalledWith('/api/billing/demo/orders/', { method: 'POST', body: { plan_code: 'premium' }, signal });
});

test.each(['succeeded', 'failed', 'cancelled'])('sends the explicit simulated %s outcome through the shared CSRF/session adapter', async (outcome) => {
  const { signal } = new AbortController();
  const completed = { ...order, status: outcome, completed_at: '2026-11-19T10:01:00Z' };
  request.mockResolvedValue({ order: completed });
  expect(await billingApi.completeDemoOrder(id, outcome, { signal })).toEqual({ order: completed });
  expect(request).toHaveBeenCalledWith(`/api/billing/demo/orders/${id}/complete/`, { method: 'POST', body: { outcome }, signal });
});

test('the local expiry action sends an empty JSON object and requires server confirmation', async () => {
  request.mockResolvedValue({ expired: true });
  expect(await billingApi.expireDemoSubscription()).toEqual({ expired: true });
  expect(request).toHaveBeenCalledWith('/api/billing/demo/expire/', { method: 'POST', body: {}, signal: undefined });
  request.mockResolvedValue({ expired: false });
  await expect(billingApi.expireDemoSubscription()).rejects.toThrow('unexpected billing response');
});

test.each([
  ['../../outside', 'succeeded'], [id, 'paid'], [null, 'failed'],
])('invalid identifiers or outcomes do not send requests', async (orderId, outcome) => {
  await expect(billingApi.completeDemoOrder(orderId, outcome)).rejects.toThrow('Choose a valid demo order');
  expect(request).not.toHaveBeenCalled();
});

test.each([
  null, {}, { ...billing, demo_enabled: 'true' }, { ...billing, subscription: null },
  { ...billing, orders: Array.from({ length: 21 }, () => order) },
  { ...billing, orders: [{ ...order, amount_vnd: -1 }] },
  { ...billing, orders: [{ ...order, currency: 'USD' }] },
  { ...billing, orders: [{ ...order, id: 'not-an-order-id' }] },
  { ...billing, plans: [{ ...billing.plans[0], storage_limit_bytes: Infinity }] },
])('rejects malformed billing success responses rather than inventing enabled checkout', async (data) => {
  request.mockResolvedValue(data);
  await expect(billingApi.get()).rejects.toThrow('unexpected billing response');
});

test('rejects malformed order responses and preserves HTTP401/410 errors for the panel', async () => {
  request.mockResolvedValue({ order: { ...order, status: 'paid' } });
  await expect(billingApi.createDemoOrder()).rejects.toThrow('unexpected billing response');
  for (const status of [401, 410]) {
    const error = new ApiError('Unavailable.', { status });
    request.mockRejectedValue(error);
    await expect(billingApi.completeDemoOrder(id, 'succeeded')).rejects.toBe(error);
  }
});
