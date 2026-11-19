import { ApiError, request } from './client';

const byteFields = ['limit_bytes', 'used_bytes', 'uploaded_bytes', 'result_bytes',
  'pending_cleanup_bytes', 'reserved_bytes', 'available_bytes'];

function validAccount(account) {
  return account && ['number', 'string'].includes(typeof account.id)
    && typeof account.username === 'string' && typeof account.email === 'string'
    && ['active', 'inactive'].includes(account.status)
    && typeof account.joined_at === 'string' && Number.isFinite(Date.parse(account.joined_at))
    && typeof account.plan?.code === 'string' && typeof account.plan?.name === 'string'
    && account.storage && typeof account.storage.over_limit === 'boolean'
    && byteFields.every((field) => Number.isSafeInteger(account.storage[field]) && account.storage[field] >= 0);
}

const accountApi = {
  async get({ signal } = {}) {
    const response = await request('/api/account/', { signal });
    if (!validAccount(response?.account)) {
      throw new ApiError('The service returned an unexpected account response. Please try again.');
    }
    return response;
  },
};

export default accountApi;
