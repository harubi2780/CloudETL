import accountApi from './account';
import { ApiError, request } from './client';

jest.mock('./client', () => ({ ...jest.requireActual('./client'), request: jest.fn() }));

const account = {
  id: 7, username: 'mira', email: 'mira@example.test', status: 'active', joined_at: '2026-11-01T10:00:00Z',
  plan: { code: 'free', name: 'Free' },
  storage: { limit_bytes: 1000, used_bytes: 300, uploaded_bytes: 200, result_bytes: 75,
    pending_cleanup_bytes: 25, reserved_bytes: 100, available_bytes: 600, over_limit: false },
};

beforeEach(() => jest.resetAllMocks());

test('reads the account using the shared authenticated request adapter and forwards cancellation', async () => {
  const { signal } = new AbortController();
  request.mockResolvedValue({ account });
  expect(await accountApi.get({ signal })).toEqual({ account });
  expect(request).toHaveBeenCalledWith('/api/account/', { signal });
});

test.each([
  null, {}, { account: null }, { account: { ...account, status: 'unknown' } },
  { account: { ...account, joined_at: 'not-a-date' } },
  { account: { ...account, plan: null } },
  { account: { ...account, storage: { ...account.storage, limit_bytes: -1 } } },
  { account: { ...account, storage: { ...account.storage, used_bytes: Infinity } } },
  { account: { ...account, storage: { ...account.storage, available_bytes: '600' } } },
])('rejects a malformed success payload without rendering invented profile/quota data', async (response) => {
  request.mockResolvedValue(response);
  await expect(accountApi.get()).rejects.toThrow('The service returned an unexpected account response.');
});

test('preserves the shared request error and its authentication status', async () => {
  const error = new ApiError('Please log in.', { status: 401, code: 'authentication_required' });
  request.mockRejectedValue(error);
  await expect(accountApi.get()).rejects.toBe(error);
});
