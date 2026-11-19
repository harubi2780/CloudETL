import { ApiError, request } from './client';

const orderStates = ['pending', 'succeeded', 'failed', 'cancelled', 'expired'];
const outcomes = ['succeeded', 'failed', 'cancelled'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const date = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const positiveInteger = (value) => integer(value) && value > 0;

function validOrder(order) {
  return order && typeof order.id === 'string' && uuid.test(order.id)
    && order.plan_code === 'premium' && typeof order.plan_name === 'string'
    && integer(order.amount_vnd) && order.currency === 'VND' && positiveInteger(order.period_days)
    && orderStates.includes(order.status) && date(order.created_at) && date(order.expires_at)
    && (order.completed_at === null || date(order.completed_at));
}

function validBilling(data) {
  return data && typeof data.demo_enabled === 'boolean' && Array.isArray(data.plans)
    && data.plans.length > 0 && data.plans.every((plan) => plan
      && ['free', 'premium'].includes(plan.code) && typeof plan.name === 'string'
      && integer(plan.storage_limit_bytes) && integer(plan.amount_vnd)
      && (plan.period_days === null || positiveInteger(plan.period_days)))
    && ['free', 'active', 'expired'].includes(data.subscription?.status)
    && (data.subscription.current_period_end === null || date(data.subscription.current_period_end))
    && Array.isArray(data.orders) && data.orders.length <= 20 && data.orders.every(validOrder);
}

function unexpected() {
  return new ApiError('The service returned an unexpected billing response. Please try again.');
}

async function orderResponse(path, body, signal) {
  const response = await request(path, { method: 'POST', body, signal });
  if (!validOrder(response?.order)) throw unexpected();
  return response;
}

const billingApi = {
  async get({ signal } = {}) {
    const response = await request('/api/billing/', { signal });
    if (!validBilling(response)) throw unexpected();
    return response;
  },
  createDemoOrder({ signal } = {}) {
    return orderResponse('/api/billing/demo/orders/', { plan_code: 'premium' }, signal);
  },
  async completeDemoOrder(id, outcome, { signal } = {}) {
    if (typeof id !== 'string' || !uuid.test(id) || !outcomes.includes(outcome)) {
      throw new ApiError('Choose a valid demo order and simulated outcome.');
    }
    return orderResponse(`/api/billing/demo/orders/${encodeURIComponent(id)}/complete/`, { outcome }, signal);
  },
  async expireDemoSubscription({ signal } = {}) {
    const response = await request('/api/billing/demo/expire/', { method: 'POST', body: {}, signal });
    if (response?.expired !== true) throw unexpected();
    return response;
  },
};

export default billingApi;
