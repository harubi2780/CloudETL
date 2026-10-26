import { request } from './client';

const datasetsApi = {
  list(page = 1, { signal } = {}) {
    return request(`/api/datasets/?page=${encodeURIComponent(page)}`, { signal });
  },

  upload(file) {
    const body = new FormData();
    body.append('file', file);
    return request('/api/datasets/', { method: 'POST', body });
  },
};

export default datasetsApi;
