import { request, ApiError as AuthApiError } from './client';

export { AuthApiError };

const authApi = {
  async getCurrentUser() {
    const csrfResponse = await request('/api/auth/csrf/');
    if (!csrfResponse || typeof csrfResponse.csrfToken !== 'string') {
      throw new AuthApiError('The service returned an unexpected response. Please try again.');
    }
    try {
      const response = await request('/api/auth/me/');
      if (!response || !isUser(response.user)) {
        throw new AuthApiError('The service returned an unexpected response. Please try again.');
      }
      return response.user;
    } catch (error) {
      if (error instanceof AuthApiError && error.status === 401) return null;
      throw error;
    }
  },

  async login(credentials) {
    const response = await request('/api/auth/login/', { method: 'POST', body: credentials });
    if (!response || !isUser(response.user) || typeof response.csrfToken !== 'string') {
      throw new AuthApiError('The service returned an unexpected response. Please try again.');
    }
    return response.user;
  },

  async register(details) {
    const response = await request('/api/auth/register/', { method: 'POST', body: details });
    if (!response || !isUser(response.user) || typeof response.csrfToken !== 'string') {
      throw new AuthApiError('The service returned an unexpected response. Please try again.');
    }
    return response.user;
  },

  async logout() {
    const response = await request('/api/auth/logout/', { method: 'POST' });
    if (!response || response.user !== null || typeof response.csrfToken !== 'string') {
      throw new AuthApiError('The service returned an unexpected response. Please try again.');
    }
  },
};

function isUser(user) {
  return Boolean(
    user
    && (typeof user.id === 'number' || typeof user.id === 'string')
    && typeof user.username === 'string'
    && typeof user.email === 'string'
  );
}

export default authApi;
